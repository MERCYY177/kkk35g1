(function (global) {
  'use strict';

  function clampInteger(value, min, max, fallback) {
    var number = Number(value);
    if (!Number.isFinite(number)) number = fallback;
    return Math.max(min, Math.min(max, Math.round(number)));
  }

  function normalizeBehaviorSettings(source) {
    var input = source && typeof source === 'object' ? source : {};
    var output = Object.assign({}, input);
    output.autoStickerEnabled = input.autoStickerEnabled === true;
    output.autoStickerChance = clampInteger(input.autoStickerChance, 0, 100, 25);
    output.autoStickerInterval = clampInteger(
      input.autoStickerInterval,
      1,
      180,
      clampInteger(input.autoSendInterval, 1, 180, 5)
    );
    output.randomCardComboEnabled = input.randomCardComboEnabled === true;
    output.fixedCardReplyCount = clampInteger(input.fixedCardReplyCount, 1, 8, 1);
    output.randomCardComboMin = clampInteger(input.randomCardComboMin, 2, 8, 2);
    output.randomCardComboMax = clampInteger(input.randomCardComboMax, 2, 8, 3);
    if (output.randomCardComboMin > output.randomCardComboMax) {
      output.randomCardComboMax = output.randomCardComboMin;
    }
    return output;
  }

  function resolveCardReplyCount(source, randomFn) {
    var settings = normalizeBehaviorSettings(source);
    if (!settings.randomCardComboEnabled) return settings.fixedCardReplyCount;
    var random = typeof randomFn === 'function' ? randomFn : Math.random;
    var span = settings.randomCardComboMax - settings.randomCardComboMin + 1;
    return settings.randomCardComboMin + Math.min(span - 1, Math.floor(Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * span));
  }

  function uniqueCards(cards) {
    var seen = Object.create(null);
    return (Array.isArray(cards) ? cards : []).map(function (card) {
      return String(card == null ? '' : card).trim();
    }).filter(function (card) {
      if (!card || seen[card]) return false;
      seen[card] = true;
      return true;
    });
  }

  function selectUniqueCards(cards, count, randomFn) {
    var pool = uniqueCards(cards);
    var wanted = Math.min(pool.length, Math.max(0, Number(count) || 0));
    var random = typeof randomFn === 'function' ? randomFn : Math.random;
    var selected = [];
    while (selected.length < wanted && pool.length) {
      var value = Math.max(0, Math.min(0.999999999, Number(random()) || 0));
      selected.push(pool.splice(Math.floor(value * pool.length), 1)[0]);
    }
    return selected;
  }

  function combineCardTexts(cards) {
    return uniqueCards(cards).map(function (card) {
      return card.replace(/\s+/g, ' ').trim();
    }).filter(Boolean).reduce(function (result, card) {
      if (!result) return card;
      var previousMark = result.match(/[。！？!?….,，；;：:]$/);
      var next = card.replace(/^[。！？!?….,，；;：:]+/, '');
      if (!next) return result;
      return result + (previousMark ? '' : '。') + next;
    }, '');
  }

  function buildCardReplyPayloads(source, cards, randomFn) {
    var settings = normalizeBehaviorSettings(source);
    var selected = selectUniqueCards(cards, resolveCardReplyCount(settings, randomFn), randomFn);
    if (!selected.length) return [];
    if (settings.randomCardComboEnabled) {
      var combined = combineCardTexts(selected);
      return combined ? [{ text: combined, cardFragments: selected.slice() }] : [];
    }
    return selected.map(function (card) { return { text: card, cardFragments: [card] }; });
  }

  function trySendPartnerSticker(source, dependencies, randomFn) {
    var settings = normalizeBehaviorSettings(source);
    if (!settings.autoStickerEnabled) return false;
    var random = typeof randomFn === 'function' ? randomFn : Math.random;
    if ((Number(random()) || 0) * 100 >= settings.autoStickerChance) return false;
    var deps = dependencies && typeof dependencies === 'object' ? dependencies : {};
    var pool;
    try { pool = uniqueCards(typeof deps.getPool === 'function' ? deps.getPool() : []); }
    catch (error) { return false; }
    if (!pool.length || typeof deps.register !== 'function' || typeof deps.send !== 'function') return false;
    var raw = pool[Math.floor(Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * pool.length)];
    var id;
    try { id = deps.register(raw); }
    catch (error) { return false; }
    if (!id) return false;
    try { deps.send(id); return true; }
    catch (error) { return false; }
  }

  function getProactiveScheduleFlags(source) {
    var settings = source && typeof source === 'object' ? source : {};
    return { text: settings.autoSendEnabled === true, sticker: settings.autoStickerEnabled === true };
  }

  function shouldRunAutoStickerForPresence(source) {
    var state = source && typeof source === 'object' ? source : {};
    return state.enabled === true &&
      state.pageVisible === true &&
      state.hasFocus === true &&
      state.chatActive === true &&
      state.recentActivity === true &&
      state.batchFavoriteMode !== true;
  }

  function reconcileIncomingCallPlan(source, sessionId, now, delayFn) {
    var settings = Object.assign({}, source && typeof source === 'object' ? source : {});
    var enabled = settings.enabled !== false && settings.allowIncoming !== false &&
      (settings.allowVoiceIncoming !== false || settings.allowVideoIncoming !== false);
    if (!enabled || !sessionId) {
      settings.nextIncomingAt = 0;
      settings.plannedSessionId = '';
      return Object.assign(settings, { shouldSchedule: false, dueNow: false });
    }
    var current = Math.max(0, Number(now) || Date.now());
    var planned = Math.max(0, Number(settings.nextIncomingAt) || 0);
    if (settings.plannedSessionId !== sessionId || planned <= current) {
      var delay = Math.max(1, Number(typeof delayFn === 'function' ? delayFn(settings.frequency) : 1) || 1);
      planned = current + delay;
    }
    settings.nextIncomingAt = planned;
    settings.plannedSessionId = sessionId;
    settings.shouldSchedule = true;
    settings.dueNow = false;
    return settings;
  }

  function buildReplyComposeState(letter) {
    var source = letter && typeof letter === 'object' ? letter : null;
    return {
      replyToId: source && source.id != null ? String(source.id) : '',
      subject: source ? '回复 · ' + (String(source.title || '').trim() || '你的来信') : ''
    };
  }

  function buildConversationReplySchedule(replyCount, minDelay, maxDelay, randomFn) {
    var count = Math.max(0, Math.floor(Number(replyCount) || 0));
    var min = Math.max(0, Number(minDelay) || 0);
    var max = Math.max(min, Number(maxDelay) || min);
    var random = typeof randomFn === 'function' ? randomFn : Math.random;
    var elapsed = 0;
    var replyDelays = [];
    for (var index = 0; index < count; index += 1) {
      var value = Math.max(0, Math.min(1, Number(random()) || 0));
      elapsed += min + value * (max - min);
      replyDelays.push(elapsed);
    }
    var stickerRandom = Math.max(0, Math.min(1, Number(random()) || 0));
    return { replyDelays: replyDelays, stickerDelay: 200 + stickerRandom * 400 };
  }

  function captureChatScrollAnchor(metrics, userBrowsingHistory) {
    var source = metrics && typeof metrics === 'object' ? metrics : {};
    var scrollHeight = Math.max(0, Number(source.scrollHeight) || 0);
    var clientHeight = Math.max(0, Number(source.clientHeight) || 0);
    var scrollTop = Math.max(0, Number(source.scrollTop) || 0);
    var distance = Math.max(0, scrollHeight - clientHeight - scrollTop);
    var browsing = userBrowsingHistory === true;
    return {
      nearBottom: !browsing && distance <= 80,
      distanceFromBottom: distance,
      clientHeight: clientHeight,
      userBrowsingHistory: browsing,
      suppressHistoryLoad: true
    };
  }

  function restoreChatScrollTop(anchor, metrics) {
    var source = metrics && typeof metrics === 'object' ? metrics : {};
    var scrollHeight = Math.max(0, Number(source.scrollHeight) || 0);
    var clientHeight = Math.max(0, Number(source.clientHeight) || 0);
    var maxTop = Math.max(0, scrollHeight - clientHeight);
    if (!anchor || anchor.nearBottom) return maxTop;
    return Math.max(0, Math.min(maxTop, maxTop - Math.max(0, Number(anchor.distanceFromBottom) || 0)));
  }

  global.XiaoshuBehaviorCore = {
    normalizeBehaviorSettings: normalizeBehaviorSettings,
    resolveCardReplyCount: resolveCardReplyCount,
    selectUniqueCards: selectUniqueCards,
    combineCardTexts: combineCardTexts,
    buildCardReplyPayloads: buildCardReplyPayloads,
    trySendPartnerSticker: trySendPartnerSticker,
    getProactiveScheduleFlags: getProactiveScheduleFlags,
    shouldRunAutoStickerForPresence: shouldRunAutoStickerForPresence,
    reconcileIncomingCallPlan: reconcileIncomingCallPlan,
    buildReplyComposeState: buildReplyComposeState,
    buildConversationReplySchedule: buildConversationReplySchedule,
    captureChatScrollAnchor: captureChatScrollAnchor,
    restoreChatScrollTop: restoreChatScrollTop
  };
})(typeof window !== 'undefined' ? window : globalThis);
