(function (root) {
  'use strict';
  if (root.XiaoshuStickerCore) return;

  var IMAGE_EXT = /\.(?:png|jpe?g|gif|webp)(?:[?#][^\s]*)?$/i;
  function normalize(value) { return String(value == null ? '' : value).trim(); }
  function hasUnsafePath(value) {
    if (/[\u0000-\u001f\u007f\\]/.test(value)) return true;
    var path = value.split(/[?#]/, 1)[0];
    try { path = decodeURIComponent(path); } catch (_) { return true; }
    return path.split('/').some(function (part) { return part === '..' || part === '.'; });
  }
  function safeResourceUrl(value, kind) {
    var raw = normalize(value);
    if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return '';
    if (/^(?:https?:\/\/|blob:|file:|content:)/i.test(raw)) return raw;
    if (kind === 'image' && /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(raw)) return raw;
    if (kind === 'video' && /^data:video\//i.test(raw)) return raw;
    if (kind === 'audio' && /^data:audio\//i.test(raw)) return raw;
    if (kind === 'font' && /^data:(?:font\/|application\/(?:font-|x-font-|octet-stream))/i.test(raw)) return raw;
    if (kind === 'image' && /^(?:\.\/)?assets\/stickers\//i.test(raw) && IMAGE_EXT.test(raw) && !hasUnsafePath(raw)) return raw;
    return '';
  }
  function withRetryToken(src, attempt) {
    src = normalize(src);
    if (!src || /^(?:data:|blob:|file:|content:)/i.test(src)) return src;
    var hashIndex = src.indexOf('#'), hash = hashIndex >= 0 ? src.slice(hashIndex) : '';
    var base = hashIndex >= 0 ? src.slice(0, hashIndex) : src;
    var separator = base.indexOf('?') >= 0 ? '&' : '?';
    return base + separator + '__xs_sticker_retry=' + encodeURIComponent(String(attempt)) + hash;
  }
  function requestUrl(src, attempt, bust) { return bust ? withRetryToken(src, attempt) : normalize(src); }
  function stickerId(src) {
    src = normalize(src); var h1 = 2166136261 >>> 0, h2 = 2246822519 >>> 0;
    for (var i = 0; i < src.length; i++) { var c = src.charCodeAt(i); h1 ^= c; h1 = Math.imul(h1, 16777619) >>> 0; h2 ^= c + i; h2 = Math.imul(h2, 3266489917) >>> 0; }
    return src ? 'stk_' + h1.toString(36) + '_' + h2.toString(36) + '_' + src.length.toString(36) : '';
  }
  function rebuildResourceMap(messages, existing, catalog) {
    var map = Object.create(null), byId = Object.create(null), missing = [];
    Object.keys(existing || {}).forEach(function (id) { var src = safeResourceUrl(existing[id], 'image'); if (src) map[id] = src; });
    (catalog || []).forEach(function (raw) { var src = safeResourceUrl(raw, 'image'); if (src) byId[stickerId(src)] = src; });
    (messages || []).forEach(function (m) { if (!m || !m.stickerId) return; var id = String(m.stickerId); if (!map[id] && byId[id]) map[id] = byId[id]; if (!map[id] && missing.indexOf(id) < 0) missing.push(id); });
    return { map: map, missing: missing };
  }
  function createLoadMachine(options) {
    options = options || {}; var current = 'pending-resource', id = '', src = '', generation = 0, requestActive = false, retryCount = 0, resolveAttempts = 0, resolveTimer = null, timeoutTimer = null;
    var schedule = options.schedule || function (fn, ms) { return setTimeout(fn, ms); };
    var cancel = options.cancel || function (token) { clearTimeout(token); };
    function emit(state) { current = state; if (options.onState) options.onState(state); }
    function clearTimers() { if (resolveTimer) cancel(resolveTimer); if (timeoutTimer) cancel(timeoutTimer); resolveTimer = timeoutTimer = null; }
    function resolveAgain() {
      src = safeResourceUrl(options.resolve ? options.resolve(id) : '', 'image');
      if (src) return load(false);
      if (resolveAttempts >= (options.maxResolveAttempts == null ? 4 : options.maxResolveAttempts)) { emit('resource-missing'); return; }
      resolveAttempts += 1; emit('pending-resource'); resolveTimer = schedule(resolveAgain, options.resolveDelayMs || 500);
    }
    function load(bust) {
      if (requestActive) return;
      if (!src) { resolveAgain(); return; }
      clearTimers(); requestActive = true; emit('loading'); var mine = ++generation;
      function finish(state) { if (!requestActive || mine !== generation) return; requestActive = false; clearTimers(); emit(state); }
      options.request(requestUrl(src, retryCount, bust), { load: function () { finish('loaded'); }, error: function () { finish('load-failed'); } });
      timeoutTimer = schedule(function () { finish('timeout'); }, options.timeoutMs || 15000);
    }
    return {
      start: function (nextId) { if (requestActive && nextId === id) return; if (nextId !== id) { clearTimers(); requestActive = false; generation += 1; id = String(nextId || ''); src = ''; retryCount = 0; resolveAttempts = 0; } resolveAgain(); },
      retry: function () { clearTimers(); requestActive = false; generation += 1; resolveAttempts = 0; src = safeResourceUrl(options.resolve ? options.resolve(id) : src, 'image') || src; if (!src) return resolveAgain(); retryCount += 1; load(true); },
      refresh: function () { if ((current !== 'pending-resource' && current !== 'resource-missing') || requestActive) return; resolveAttempts = 0; src = ''; resolveAgain(); },
      state: function () { return current; },
      source: function () { return src; },
      dispose: function () { clearTimers(); requestActive = false; generation += 1; },
    };
  }
  root.XiaoshuStickerCore = { safeResourceUrl: safeResourceUrl, withRetryToken: withRetryToken, requestUrl: requestUrl, stickerId: stickerId, rebuildResourceMap: rebuildResourceMap, createLoadMachine: createLoadMachine };
})(typeof window !== 'undefined' ? window : globalThis);

/* Runtime guard for uploaded-sticker deletion. Keep this in sticker-core.js so the existing page loads it. */
(function (root) {
  'use strict';
  if (!root || root.__xiaoshuStickerDeleteGuardV1) return;
  root.__xiaoshuStickerDeleteGuardV1 = true;

  var STORE_KEY_PREFIX = 'xiaoshu_deleted_upload_hashes_v1_';
  var HIDDEN_KEY = 'disabledStickerItems';
  var deleted = new Set();
  var loadedKey = '';
  var norm = function (value) { return String(value == null ? '' : value).trim(); };

  function sessionKey() {
    var sid = '';
    try {
      // __xiaoshuSessionDataReady is a readiness marker, not an ID unless it is a string.
      // Prefer the real active session ID so tombstones never land under "true".
      sid = String(root.SESSION_ID || (typeof root.__xiaoshuSessionDataReady === 'string' ? root.__xiaoshuSessionDataReady : '') || 'unscoped');
    } catch (_) { sid = 'unscoped'; }
    sid = sid.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'unscoped';
    return STORE_KEY_PREFIX + sid;
  }
  function addValidDeletedValues(values) {
    if (!Array.isArray(values)) return;
    values.forEach(function (value) {
      if (typeof value === 'string' && /^stk_[a-z0-9_]+$/i.test(value)) deleted.add(value);
    });
  }
  function loadDeleted(forceRefresh) {
    var key = sessionKey();
    if (key === loadedKey) {
      // A second browser tab has its own in-memory Set. Critical operations refresh
      // from localStorage so a deletion in the other tab takes effect immediately.
      if (forceRefresh) {
        try {
          var currentRaw = root.localStorage && root.localStorage.getItem(key);
          // A missing key can also mean storage is unavailable; preserve the in-memory
          // fail-closed tombstones in that case. An explicit [] is authoritative.
          if (currentRaw != null) {
            var currentValues = JSON.parse(currentRaw);
            if (Array.isArray(currentValues)) {
              deleted.clear();
              addValidDeletedValues(currentValues);
            }
          }
        } catch (_) {}
      }
      return;
    }

    // Keep tombstones created before the session ID finished initializing.
    // Otherwise a switch from the temporary "_unscoped" key clears those
    // in-memory deletions and lets old uploaded stickers re-enter the pool.
    var previousKey = loadedKey;
    var previousDeleted = new Set(deleted);
    loadedKey = key;
    deleted.clear();
    try {
      var raw = root.localStorage && root.localStorage.getItem(key);
      var values = raw ? JSON.parse(raw) : [];
      addValidDeletedValues(values);
    } catch (_) {}

    // Migrate only from the temporary unscoped key to the resolved key.
    // Do not leak one established session's deleted items into another.
    if (previousKey && previousKey !== key && /_(?:unscoped|true|false)$/.test(previousKey)) {
      // Migrate tombstones created by older builds before a real session ID was available,
      // including builds that accidentally used the boolean readiness flag as the ID.
      previousDeleted.forEach(function (value) { deleted.add(value); });
      saveDeleted();
    }
  }
  function hash(src) {
    try { return root.XiaoshuStickerCore && root.XiaoshuStickerCore.stickerId(norm(src)); } catch (_) { return ''; }
  }
  function isDeletedLoaded(src) {
    var id = hash(src);
    return !!id && deleted.has(id);
  }
  function isDeleted(src) {
    loadDeleted(true);
    return isDeletedLoaded(src);
  }
  function hiddenSourcesFromStorage() {
    var result = new Set();
    try {
      var raw = root.localStorage && root.localStorage.getItem(HIDDEN_KEY);
      var values = raw ? JSON.parse(raw) : [];
      if (Array.isArray(values)) values.forEach(function (value) {
        value = norm(value);
        if (value) result.add(value);
      });
    } catch (_) {}
    return result;
  }
  function saveDeleted() {
    try {
      if (!root.localStorage || typeof root.localStorage.setItem !== 'function' || typeof root.localStorage.getItem !== 'function') return false;
      var key = loadedKey || sessionKey();
      var payload = JSON.stringify(Array.from(deleted));
      root.localStorage.setItem(key, payload);
      return root.localStorage.getItem(key) === payload;
    } catch (error) {
      try { if (root.console && root.console.warn) root.console.warn('[表情删除保护] 删除标记保存失败；为避免另一标签页仍可发送，本次删除将被取消', error); } catch (_) {}
      return false;
    }
  }
  function markDeleted(src) {
    loadDeleted(true);
    var id = hash(src);
    if (!id) return false;
    var existed = deleted.has(id);
    deleted.add(id);
    if (saveDeleted()) return true;
    if (!existed) deleted.delete(id);
    return false;
  }
  function unmarkDeleted(src) {
    loadDeleted(true);
    var id = hash(src);
    if (!id || !deleted.delete(id)) return false;
    if (saveDeleted()) return true;
    deleted.add(id);
    return false;
  }
  function matches(list, src) {
    src = norm(src);
    return !!src && (list || []).some(function (item) { return norm(item) === src; });
  }

  function install(api) {
    if (!api) return false;
    if (api.__xsDeleteGuardPatched) return true;
    if (typeof api.getUploads !== 'function' || typeof api.getPool !== 'function') return false;
    api.__xsDeleteGuardPatched = true;
    loadDeleted();

    var rawGetUploads = api.getUploads.bind(api);
    var rawGetPool = api.getPool.bind(api);
    var rawRemoveUpload = api.removeUpload.bind(api);
    var rawClearUploads = api.clearUploads.bind(api);
    var rawHide = api.hide.bind(api);
    var rawSend = api.send.bind(api);
    var rawHydrate = api.hydrate.bind(api);
    var rawSync = api.sync.bind(api);
    var rawOpenAdmin = api.openAdmin.bind(api);
    var rawAddFiles = api.addFiles.bind(api);
    var rawRegister = typeof api.register === 'function' ? api.register.bind(api) : null;

    function purgeDeletedUploads() {
      loadDeleted(true);
      // Do not erase legacy IndexedDB keys before the controller has finished its first migration read.
      try {
        if (api.getMigrationState && !api.getMigrationState().hydrated) return 0;
      } catch (_) { return 0; }
      var stale = rawGetUploads().filter(function (src) { return isDeletedLoaded(src); });
      stale.forEach(function (src) { rawRemoveUpload(src, false); });
      return stale.length;
    }

    api.getUploads = function () {
      loadDeleted(true);
      return rawGetUploads().filter(function (src) { return !isDeletedLoaded(src); });
    };
    api.getPool = function () {
      loadDeleted(true);
      var hiddenSources = hiddenSourcesFromStorage();
      return rawGetPool().filter(function (src) {
        src = norm(src);
        return !!src && !isDeletedLoaded(src) && !hiddenSources.has(src);
      });
    };
    if (rawRegister) {
      // Registration creates the message-resource mapping used by all send paths.
      // Only allow sources that are still in the live shared pool. Internal history
      // migration keeps using the controller's private registerMessageResource(), so
      // old messages can still be migrated without re-enabling a deleted sticker.
      api.register = function (src) {
        src = norm(src);
        loadDeleted(true);
        if (!src || isDeletedLoaded(src)) return '';
        try {
          if (api.getMigrationState && !api.getMigrationState().hydrated) return '';
        } catch (_) { return ''; }
        if (!matches(api.getPool(), src)) return '';
        return rawRegister(src);
      };
    }
    api.markUploadsDeleted = function (sources) {
      loadDeleted(true);
      var available = new Set(rawGetUploads().map(norm));
      var requested = new Set();
      (Array.isArray(sources) ? sources : []).forEach(function (src) {
        src = norm(src);
        var id = src && available.has(src) ? hash(src) : '';
        if (id) requested.add(id);
      });
      if (!requested.size) return true;
      var before = new Set(deleted);
      requested.forEach(function (id) { deleted.add(id); });
      if (saveDeleted()) return true;
      deleted.clear();
      before.forEach(function (id) { deleted.add(id); });
      return false;
    };
    api.removeUpload = function (src, ask) {
      src = norm(src);
      loadDeleted(true);
      var exists = matches(rawGetUploads(), src);
      if (!exists) return rawRemoveUpload(src, ask);
      if (ask !== false) {
        var ok = false;
        try { ok = root.confirm('删除这张上传表情？'); } catch (_) {}
        if (!ok) return false;
      }
      if (!markDeleted(src)) {
        try { if (typeof root.showNotification === 'function') root.showNotification('无法保存表情删除保护，已取消本次删除；请检查浏览器存储权限后重试', 'warning', 2600); } catch (_) {}
        return false;
      }
      var removed = rawRemoveUpload(src, false);
      if (!removed) unmarkDeleted(src);
      return removed;
    };
    api.clearUploads = function (ask) {
      loadDeleted(true);
      var list = rawGetUploads();
      if (ask !== false) {
        var ok = false;
        try { ok = root.confirm('清空全部上传表情包？内置表情不会受影响。'); } catch (_) {}
        if (!ok) return false;
      }
      if (!api.markUploadsDeleted(list)) {
        try { if (typeof root.showNotification === 'function') root.showNotification('无法保存表情删除保护，已取消清空；请检查浏览器存储权限后重试', 'warning', 2600); } catch (_) {}
        return false;
      }
      return rawClearUploads(false);
    };
    api.hide = function (src, silent) {
      src = norm(src);
      loadDeleted(true);
      if (matches(rawGetUploads(), src)) return api.removeUpload(src, false);
      return rawHide(src, silent);
    };
    api.send = function (src) {
      src = norm(src);
      loadDeleted(true);
      if (isDeletedLoaded(src) || !matches(api.getPool(), src)) {
        try {
          if (typeof root.showNotification === 'function') root.showNotification('这张表情已删除或隐藏，请重新打开表情面板再选择', 'info', 1800);
        } catch (_) {}
        return false;
      }
      return rawSend(src);
    };
    api.sync = function () {
      purgeDeletedUploads();
      return rawSync.apply(api, arguments);
    };
    api.hydrate = function () {
      loadDeleted(true);
      return Promise.resolve(rawHydrate.apply(api, arguments)).then(function (result) {
        var removed = purgeDeletedUploads();
        if (removed) rawSync();
        return result;
      });
    };
    api.openAdmin = function () {
      purgeDeletedUploads();
      return rawOpenAdmin.apply(api, arguments);
    };
    api.addFiles = function () {
      purgeDeletedUploads();
      var before = new Set(rawGetUploads().map(norm));
      return Promise.resolve(rawAddFiles.apply(api, arguments)).then(function (result) {
        var restoredDeletedSource = false;
        rawGetUploads().forEach(function (src) {
          if (!before.has(norm(src)) && unmarkDeleted(src)) restoredDeletedSource = true;
        });
        // Re-publish only when a byte-identical image was intentionally uploaded again.
        if (restoredDeletedSource) rawSync();
        return result;
      });
    };

    // Final guard for the picker renderer: never leave a tile in the grid if its
    // source is no longer in the authoritative shared pool. The inline picker can
    // have an already-scheduled batch append; the MutationObserver prunes such stale
    // nodes before the browser paints them, preventing an empty cell while image retry
    // logic eventually removes the unavailable tile.
    function installPickerTilePruner() {
      var doc = root.document;
      if (!doc || doc.__xsStickerTilePrunerV1) return;
      doc.__xsStickerTilePrunerV1 = true;

      function allowedSources() {
        try {
          var store = root.xiaoshuStickerStore;
          var pool = store && typeof store.getPool === 'function' ? store.getPool() : [];
          return new Set((pool || []).map(norm));
        } catch (_) {
          return new Set();
        }
      }

      function pruneButton(button, allowed) {
        if (!button || !button.isConnected) return;
        var img = button.querySelector ? button.querySelector('img') : null;
        var src = norm(button.__stickerSrc || (img && img.__stickerSrc));
        if (src && allowed.has(src)) return;
        if (img) {
          try { if (typeof img.__xsCancelLoad === 'function') img.__xsCancelLoad(); } catch (_) {}
          img.onload = null;
          img.onerror = null;
          try { img.removeAttribute('src'); } catch (_) {}
        }
        button.remove();
      }

      function reconcile() {
        var area = doc.getElementById('combo-content-area');
        if (!area) return;
        var allowed = allowedSources();
        Array.prototype.slice.call(area.querySelectorAll('.xs-final-sticker-btn')).forEach(function (button) {
          pruneButton(button, allowed);
        });
      }

      function bindObserver() {
        var area = doc.getElementById('combo-content-area');
        if (!area || area.__xsStickerTilePrunerObserverV1 || typeof root.MutationObserver !== 'function') return;
        var observer = new root.MutationObserver(function (records) {
          var candidates = [];
          records.forEach(function (record) {
            Array.prototype.forEach.call(record.addedNodes || [], function (node) {
              if (!node || node.nodeType !== 1) return;
              if (node.matches && node.matches('.xs-final-sticker-btn')) candidates.push(node);
              if (node.querySelectorAll) candidates = candidates.concat(Array.prototype.slice.call(node.querySelectorAll('.xs-final-sticker-btn')));
            });
          });
          if (!candidates.length) return;
          var allowed = allowedSources();
          candidates.forEach(function (button) { pruneButton(button, allowed); });
        });
        observer.observe(area, { childList: true, subtree: true });
        area.__xsStickerTilePrunerObserverV1 = observer;
        reconcile();
      }

      root.addEventListener('stickerLibraryUpdated', reconcile);
      root.addEventListener('xiaoshu-sticker-resources-ready', reconcile);
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', bindObserver, { once: true });
      else bindObserver();
    }
    installPickerTilePruner();

    // Intercept the management dialog's single-delete button before its closure-level
    // handler runs. That handler bypasses api.removeUpload(), so without interception it
    // bypasses the deletion tombstone and stale legacy sources can re-enter the pool.
    try {
      if (root.document && !root.document.__xsDeleteGuardSingleBound) {
        root.document.__xsDeleteGuardSingleBound = true;
        root.document.addEventListener('click', function (event) {
          var target = event.target && event.target.closest ? event.target.closest('[data-xs-remove-upload]') : null;
          if (!target) return;
          var src = norm(target.getAttribute('data-xs-remove-upload'));
          if (!src) return;
          // Use the guarded API so the tombstone is persisted before runtime pool events fire.
          event.preventDefault();
          event.stopPropagation();
          if (event.stopImmediatePropagation) event.stopImmediatePropagation();
          api.removeUpload(src, true);
        }, true);
      }
    } catch (_) {}

    // The picker calls api.hide for its × control. Uploaded images must be permanently deleted;
    // built-in images still use the reversible hidden list.
    try {
      if (root.document && !root.document.__xsDeleteGuardBatchBound) {
        root.document.__xsDeleteGuardBatchBound = true;
        root.document.addEventListener('click', function (event) {
          var target = event.target && event.target.closest ? event.target.closest('#xs-delete-selected-stickers') : null;
          if (!target) return;
          loadDeleted();
          var before = rawGetUploads().map(norm);
          root.setTimeout(function () {
            var after = new Set(rawGetUploads().map(norm));
            var changed = false;
            before.forEach(function (src) { if (!after.has(src)) { markDeleted(src); changed = true; } });
            if (changed) purgeDeletedUploads();
          }, 0);
        }, true);
      }
      if (root.addEventListener && !root.__xsDeleteGuardReadyBound) {
        root.__xsDeleteGuardReadyBound = true;
        root.addEventListener('xiaoshu-sticker-resources-ready', function () {
          purgeDeletedUploads();
          // The controller assigns its legacy aliases immediately after creating the store.
          root.xiaoshuGetSharedStickerPool = api.getPool;
          root.xiaoshuSendSharedSticker = api.send;
          root.xiaoshuHideStickerNow = api.hide;
        });
      }
      if (root.addEventListener && !root.__xsDeleteGuardStorageBound) {
        root.__xsDeleteGuardStorageBound = true;
        root.addEventListener('storage', function (event) {
          if (!event) return;
          var key = sessionKey();
          if (event.key !== key && event.key !== HIDDEN_KEY) return;
          if (event.key === key) {
            loadDeleted(true);
            // Remove the stale upload from this tab's in-memory controller as well.
            // The guarded pool/register checks below remain authoritative even before
            // this asynchronous storage event is delivered.
            purgeDeletedUploads();
          }
          try {
            var changedEvent = typeof root.Event === 'function' ? new root.Event('stickerLibraryUpdated') : null;
            if (changedEvent) root.dispatchEvent(changedEvent);
          } catch (_) {}
        });
      }
    } catch (_) {}

    root.xiaoshuGetSharedStickerPool = api.getPool;
    root.xiaoshuSendSharedSticker = api.send;
    root.xiaoshuHideStickerNow = api.hide;
    purgeDeletedUploads();
    return true;
  }

  // Intercept the store's assignment so the guard is installed before its first session hydrate.
  var storeDescriptor = null;
  try { storeDescriptor = Object.getOwnPropertyDescriptor(root, 'xiaoshuStickerStore'); } catch (_) {}
  if (!storeDescriptor || storeDescriptor.configurable) {
    var storeValue = storeDescriptor && 'value' in storeDescriptor ? storeDescriptor.value : null;
    try {
      Object.defineProperty(root, 'xiaoshuStickerStore', {
        configurable: true,
        enumerable: true,
        get: function () { return storeValue; },
        set: function (value) {
          storeValue = value;
          if (value) install(value);
        }
      });
      if (storeValue) install(storeValue);
    } catch (_) {}
  }

  function attemptInstall() {
    var api = root.xiaoshuStickerStore;
    if (api && install(api)) {
      try { root.clearInterval(root.__xiaoshuStickerDeleteGuardTimer); } catch (_) {}
      root.__xiaoshuStickerDeleteGuardTimer = null;
      return true;
    }
    return false;
  }
  if (!attemptInstall()) {
    try {
      root.__xiaoshuStickerDeleteGuardTimer = root.setInterval(attemptInstall, 20);
      if (root.document) root.document.addEventListener('DOMContentLoaded', attemptInstall, { once: true });
      root.setTimeout(function () {
        try { if (root.__xiaoshuStickerDeleteGuardTimer) root.clearInterval(root.__xiaoshuStickerDeleteGuardTimer); } catch (_) {}
        root.__xiaoshuStickerDeleteGuardTimer = null;
      }, 15000);
    } catch (_) {}
  }
})(typeof window !== 'undefined' ? window : globalThis);
