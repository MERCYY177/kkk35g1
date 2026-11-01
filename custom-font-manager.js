/*
 * ChuanXun local font library
 * - Stores the actual font Blob and metadata in this app's IndexedDB origin.
 * - Each document (main page, Chat 2 srcdoc, Moments srcdoc) registers its own
 *   FontFace. srcdoc frames inherit the appassets origin from the parent page.
 * - No font URL, CDN, cloud drive, or remote font host is used.
 */
(function (global) {
  'use strict';

  if (global.ChuanXunFontManager) return;

  var DB_NAME = 'chuanxun-local-font-library';
  var DB_VERSION = 1;
  var FONT_STORE = 'fonts';
  var META_STORE = 'meta';
  var CURRENT_KEY = 'currentFontId';
  var MAX_FILE_SIZE = 50 * 1024 * 1024;
  var CHANNEL_NAME = 'chuanxun-local-font-library-v1';
  var MIME_BY_FORMAT = {
    ttf: 'font/ttf',
    otf: 'font/otf',
    woff: 'font/woff',
    woff2: 'font/woff2'
  };
  var dbPromise = null;
  var activeFace = null;
  var activeFontId = null;
  var activeFamily = null;
  var previewFace = null;
  var previewFamily = null;
  var channel = null;
  var modalId = 'chuanxun-local-font-modal';
  var entryId = 'chuanxun-local-font-entry';

  function error(message) { return new Error(message); }

  function openDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB || typeof global.indexedDB.open !== 'function') {
        reject(error('当前 WebView 不支持 IndexedDB，无法安全保存字体文件'));
        return;
      }
      var request;
      try { request = global.indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { reject(e); return; }
      var settled = false;
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(FONT_STORE)) db.createObjectStore(FONT_STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
      };
      request.onsuccess = function () {
        var db = request.result;
        if (settled) { try { db.close(); } catch (_) {} return; }
        settled = true;
        db.onversionchange = function () { try { db.close(); } catch (_) {} dbPromise = null; };
        resolve(db);
      };
      request.onerror = function () {
        if (settled) return;
        settled = true;
        reject(request.error || error('打开本地字体库失败'));
      };
      request.onblocked = function () {
        if (settled) return;
        settled = true;
        reject(error('字体库正在被其他页面升级，请关闭其他传讯页面后重试'));
      };
    }).catch(function (e) {
      dbPromise = null;
      throw e;
    });
    return dbPromise;
  }

  function transactionDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error || error('字体数据写入失败')); };
      tx.onabort = function () { reject(tx.error || error('字体数据写入已取消')); };
    });
  }

  function requestValue(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || error('读取字体数据失败')); };
    });
  }

  function getMeta(key) {
    return openDatabase().then(async function (db) {
      var tx = db.transaction(META_STORE, 'readonly');
      var done = transactionDone(tx);
      var record = await requestValue(tx.objectStore(META_STORE).get(key));
      await done;
      return record ? record.value : null;
    });
  }

  function setCurrentId(id) {
    return openDatabase().then(function (db) {
      var tx = db.transaction(META_STORE, 'readwrite');
      var done = transactionDone(tx);
      tx.objectStore(META_STORE).put({ key: CURRENT_KEY, value: id || null, updatedAt: Date.now() });
      return done;
    });
  }

  function getFont(id) {
    return openDatabase().then(async function (db) {
      var tx = db.transaction(FONT_STORE, 'readonly');
      var done = transactionDone(tx);
      var record = await requestValue(tx.objectStore(FONT_STORE).get(id));
      await done;
      return record;
    });
  }

  function listFonts() {
    return openDatabase().then(async function (db) {
      var tx = db.transaction(FONT_STORE, 'readonly');
      var done = transactionDone(tx);
      var items = await requestValue(tx.objectStore(FONT_STORE).getAll());
      await done;
      return (items || []).sort(function (a, b) { return Number(b.createdAt || 0) - Number(a.createdAt || 0); });
    });
  }

  function detectFormat(buffer, filename) {
    var bytes = new Uint8Array(buffer || new ArrayBuffer(0));
    if (bytes.length < 12) throw error('字体文件过短或已损坏');
    var signature = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    var format = null;
    if (signature === 'wOFF') format = 'woff';
    else if (signature === 'wOF2') format = 'woff2';
    else if (signature === 'OTTO') format = 'otf';
    else if ((bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) || signature === 'true') format = 'ttf';
    if (!format) throw error('无法识别字体文件内容；请提供有效的 TTF、OTF、WOFF 或 WOFF2 文件');
    var extMatch = String(filename || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    var extension = extMatch ? extMatch[1] : '';
    if (extension && ['ttf', 'otf', 'woff', 'woff2'].indexOf(extension) === -1) {
      throw error('不支持 .' + extension + ' 格式');
    }
    if (extension && extension !== format) throw error('文件扩展名与字体实际格式不一致（检测为 ' + format.toUpperCase() + '）');
    return format;
  }

  function makeFamily(id) {
    return 'ChuanXunLocalFont_' + String(id).replace(/[^a-zA-Z0-9_]/g, '_');
  }

  function buildFontFace(record) {
    if (typeof global.FontFace !== 'function') return Promise.reject(error('当前 WebView 不支持 FontFace，无法应用自定义字体'));
    if (!record || !record.blob) return Promise.reject(error('字体文件数据不存在'));
    var family = makeFamily(record.id);
    var url;
    try { url = global.URL.createObjectURL(record.blob); }
    catch (e) { return Promise.reject(e); }
    var face;
    try {
      face = new global.FontFace(family, 'url("' + url + '")', { display: 'swap' });
    } catch (e) {
      try { global.URL.revokeObjectURL(url); } catch (_) {}
      return Promise.reject(e);
    }
    return face.load().then(function (loaded) {
      try { global.URL.revokeObjectURL(url); } catch (_) {}
      return { face: loaded, family: family };
    }).catch(function (e) {
      try { global.URL.revokeObjectURL(url); } catch (_) {}
      throw error('字体解析或加载失败，原来启用的字体未被更改：' + (e && e.message ? e.message : '字体文件无效'));
    });
  }

  function applyLoadedFace(record, loaded, shouldPersist) {
    var oldFace = activeFace;
    var oldId = activeFontId;
    var oldFamily = activeFamily;
    try {
      global.document.fonts.add(loaded.face);
      activeFace = loaded.face;
      activeFontId = record.id;
      activeFamily = loaded.family;
      var root = global.document.documentElement;
      root.classList.add('chuanxun-local-font-active');
      root.style.setProperty('--chuanxun-local-font-family', '"' + loaded.family + '", sans-serif');
      root.style.setProperty('--font-family', '"' + loaded.family + '", sans-serif');
      root.style.setProperty('--message-font-family', '"' + loaded.family + '", sans-serif');
      if (global.settings && typeof global.settings === 'object') global.settings.messageFontFamily = '"' + loaded.family + '", sans-serif';
    } catch (e) {
      try { global.document.fonts.delete(loaded.face); } catch (_) {}
      activeFace = oldFace;
      activeFontId = oldId;
      activeFamily = oldFamily;
      throw e;
    }
    if (oldFace && oldFace !== loaded.face) {
      try { global.document.fonts.delete(oldFace); } catch (_) {}
    }
    if (shouldPersist) {
      return setCurrentId(record.id).then(function () {
        publish({ type: 'font-current-changed', fontId: record.id });
        refreshUi();
        return record;
      }).catch(function (e) {
        try { global.document.fonts.delete(loaded.face); } catch (_) {}
        if (oldFace) {
          try { global.document.fonts.add(oldFace); } catch (_) {}
          activeFace = oldFace; activeFontId = oldId; activeFamily = oldFamily;
          if (oldFamily) {
            global.document.documentElement.style.setProperty('--chuanxun-local-font-family', '"' + oldFamily + '", sans-serif');
            global.document.documentElement.style.setProperty('--font-family', '"' + oldFamily + '", sans-serif');
            global.document.documentElement.style.setProperty('--message-font-family', '"' + oldFamily + '", sans-serif');
          }
        } else {
          restoreCssDefault();
        }
        throw e;
      });
    }
    refreshUi();
    return Promise.resolve(record);
  }

  function restoreCssDefault() {
    if (activeFace) {
      try { global.document.fonts.delete(activeFace); } catch (_) {}
    }
    activeFace = null;
    activeFontId = null;
    activeFamily = null;
    var root = global.document.documentElement;
    root.classList.remove('chuanxun-local-font-active');
    root.style.removeProperty('--chuanxun-local-font-family');
    root.style.removeProperty('--font-family');
    root.style.removeProperty('--message-font-family');
    if (global.settings && typeof global.settings === 'object') global.settings.messageFontFamily = 'sans-serif';
  }

  function clearLegacyFontPreference() {
    try {
      if (global.settings && typeof global.settings === 'object') {
        global.settings.customFontUrl = '';
        global.settings.messageFontFamily = 'sans-serif';
      }
      if (typeof global.saveData === 'function') global.saveData({ skipChatMessages: true });
    } catch (_) {}
  }

  function installGlobalFontCss() {
    var doc = global.document;
    if (!doc || !doc.head || doc.getElementById('chuanxun-local-font-global-css')) return;
    var style = doc.createElement('style');
    style.id = 'chuanxun-local-font-global-css';
    style.textContent = [
      'html.chuanxun-local-font-active body,',
      'html.chuanxun-local-font-active body :not(i):not(svg):not(path):not(.fa):not(.fas):not(.far):not(.fab):not(.fa-solid):not(.fa-regular):not(.fa-brands):not([class*="fa-"]):not(.material-icons):not(.material-symbols-outlined):not(.iconfont):not(.emoji):not(.sticker):not([data-preserve-font]){',
      'font-family:var(--chuanxun-local-font-family,sans-serif)!important;',
      '}',
      'html.chuanxun-local-font-active input,html.chuanxun-local-font-active textarea,html.chuanxun-local-font-active select,html.chuanxun-local-font-active button,',
      'html.chuanxun-local-font-active input::placeholder,html.chuanxun-local-font-active textarea::placeholder{',
      'font-family:var(--chuanxun-local-font-family,sans-serif)!important;',
      '}'
    ].join('\n');
    doc.head.appendChild(style);
  }

  function publish(message) {
    message = message || {};
    message.origin = 'chuanxun-font-manager';
    message.sentAt = Date.now();
    try { if (channel) channel.postMessage(message); } catch (_) {}
    try { global.localStorage.setItem('__chuanxun_font_signal__', JSON.stringify(message)); } catch (_) {}
    try { global.dispatchEvent(new global.CustomEvent('chuanxunfontchange', { detail: message })); } catch (_) {}
  }

  function receive(message) {
    if (!message || message.origin !== 'chuanxun-font-manager' || message.type !== 'font-current-changed') return;
    restoreCurrent({ silent: true }).catch(function (e) { console.warn('[本地字体] 跨页面同步失败', e); });
  }

  function restoreCurrent(options) {
    options = options || {};
    return getMeta(CURRENT_KEY).then(function (id) {
      if (!id) {
        if (global.document.documentElement.classList.contains('chuanxun-local-font-active')) restoreCssDefault();
        refreshUi();
        return null;
      }
      return getFont(id).then(function (record) {
        if (!record) {
          if (global.document.documentElement.classList.contains('chuanxun-local-font-active')) restoreCssDefault();
          if (!options.silent) return setCurrentId(null).then(function () { return null; });
          return null;
        }
        if (activeFontId === record.id && activeFace && activeFace.status === 'loaded') return record;
        return buildFontFace(record).then(function (loaded) {
          return applyLoadedFace(record, loaded, false);
        });
      });
    }).catch(function (e) {
      console.warn('[本地字体] 恢复字体失败，保留系统默认字体', e);
      return null;
    });
  }

  function saveFontRecord(record) {
    return openDatabase().then(async function (db) {
      var tx = db.transaction([FONT_STORE, META_STORE], 'readwrite');
      var done = transactionDone(tx);
      try {
        tx.objectStore(FONT_STORE).add(record);
        tx.objectStore(META_STORE).put({ key: CURRENT_KEY, value: record.id, updatedAt: Date.now() });
        await done;
      } catch (writeError) {
        try { tx.abort(); } catch (_) {}
        try { await done; } catch (_) {}
        throw writeError;
      }
      return true;
    });
  }

  function importFont(file) {
    if (!file) return Promise.reject(error('没有选择字体文件'));
    if (!file.size || file.size > MAX_FILE_SIZE) return Promise.reject(error('字体文件不能为空，且不能超过 50 MB'));
    return file.arrayBuffer().then(function (buffer) {
      var format = detectFormat(buffer, file.name);
      var blob = new Blob([buffer], { type: MIME_BY_FORMAT[format] });
      var id = (global.crypto && global.crypto.randomUUID) ? global.crypto.randomUUID() : ('font_' + Date.now() + '_' + Math.random().toString(36).slice(2));
      var record = {
        id: id,
        name: String(file.name || ('自定义字体.' + format)).replace(/\.[^.]+$/, '') || '自定义字体',
        fileName: String(file.name || ('custom-font.' + format)),
        format: format,
        mimeType: MIME_BY_FORMAT[format],
        size: blob.size,
        blob: blob,
        createdAt: Date.now()
      };
      // Preflight the actual binary before touching the current library selection.
      return buildFontFace(record).then(function (loaded) {
        try {
          global.document.fonts.add(loaded.face);
          return saveFontRecord(record).then(function () {
            var oldFace = activeFace;
            activeFace = loaded.face;
            activeFontId = record.id;
            activeFamily = loaded.family;
            var root = global.document.documentElement;
            root.classList.add('chuanxun-local-font-active');
            root.style.setProperty('--chuanxun-local-font-family', '"' + loaded.family + '", sans-serif');
            root.style.setProperty('--font-family', '"' + loaded.family + '", sans-serif');
            root.style.setProperty('--message-font-family', '"' + loaded.family + '", sans-serif');
            if (global.settings && typeof global.settings === 'object') global.settings.messageFontFamily = '"' + loaded.family + '", sans-serif';
            if (oldFace && oldFace !== loaded.face) { try { global.document.fonts.delete(oldFace); } catch (_) {} }
            publish({ type: 'font-current-changed', fontId: record.id });
            refreshUi();
            return record;
          }).catch(function (e) {
            try { global.document.fonts.delete(loaded.face); } catch (_) {}
            throw e;
          });
        } catch (e) {
          try { global.document.fonts.delete(loaded.face); } catch (_) {}
          throw e;
        }
      });
    });
  }

  function applyFont(id) {
    return getFont(id).then(function (record) {
      if (!record) throw error('找不到选中的字体文件');
      return buildFontFace(record).then(function (loaded) { return applyLoadedFace(record, loaded, true); });
    });
  }

  function previewFont(id, target) {
    if (previewFace) { try { global.document.fonts.delete(previewFace); } catch (_) {} previewFace = null; }
    if (!id || !target) return Promise.resolve(false);
    return getFont(id).then(function (record) {
      if (!record) throw error('找不到字体文件');
      return buildFontFace(record).then(function (loaded) {
        global.document.fonts.add(loaded.face);
        previewFace = loaded.face;
        previewFamily = loaded.family;
        target.style.fontFamily = '"' + loaded.family + '", sans-serif';
        return true;
      });
    });
  }

  function deleteFont(id) {
    if (!id) return Promise.reject(error('请先选择要删除的字体'));
    return getMeta(CURRENT_KEY).then(function (currentId) {
      return openDatabase().then(function (db) {
        var tx = db.transaction([FONT_STORE, META_STORE], 'readwrite');
        var done = transactionDone(tx);
        tx.objectStore(FONT_STORE).delete(id);
        if (currentId === id) tx.objectStore(META_STORE).put({ key: CURRENT_KEY, value: null, updatedAt: Date.now() });
        return done.then(function () {
          if (activeFontId === id) {
            restoreCssDefault();
            clearLegacyFontPreference();
          }
          if (previewFamily && previewFamily === makeFamily(id)) {
            if (previewFace) { try { global.document.fonts.delete(previewFace); } catch (_) {} }
            previewFace = null; previewFamily = null;
          }
          publish({ type: 'font-current-changed', fontId: currentId === id ? null : currentId });
          refreshUi();
          return true;
        });
      });
    });
  }

  function restoreDefault() {
    return setCurrentId(null).then(function () {
      restoreCssDefault();
      clearLegacyFontPreference();
      publish({ type: 'font-current-changed', fontId: null });
      refreshUi();
      return true;
    });
  }

  function bytesLabel(size) {
    if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB';
    return Math.max(1, Math.round(size / 1024)) + ' KB';
  }

  function makeModal() {
    var modal = global.document.getElementById(modalId);
    if (modal) return modal;
    modal = global.document.createElement('div');
    modal.id = modalId;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.style.cssText = 'position:fixed;inset:0;z-index:2147483600;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.48);';
    modal.innerHTML = '<div style="width:min(100%,460px);max-height:88dvh;overflow:auto;border-radius:20px;background:var(--primary-bg,var(--card-bg,#fff));color:var(--text-primary,var(--text-color,#171717));padding:20px;box-shadow:0 18px 55px rgba(0,0,0,.25)">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:18px;font-weight:750;margin-bottom:15px"><span>本地自定义字体</span><button type="button" data-font-action="close" aria-label="关闭" style="border:0;background:transparent;color:inherit;font-size:24px">×</button></div>' +
      '<div style="padding:14px;border-radius:14px;background:var(--secondary-bg,#f4f5f7);margin-bottom:14px"><div style="font-size:12px;opacity:.7;margin-bottom:6px">预览</div><div id="chuanxun-font-preview" style="font-size:17px;line-height:1.8">你好，欢迎使用传讯。<br>Aa Bb 0123456789<br>聊天、朋友圈和设置将统一应用当前字体。</div></div>' +
      '<label for="chuanxun-font-list" style="display:block;font-size:13px;font-weight:650;margin-bottom:6px">已导入字体</label><select id="chuanxun-font-list" style="width:100%;padding:11px;border:1px solid var(--border-color,#ddd);border-radius:11px;background:var(--primary-bg,#fff);color:inherit;font:inherit"><option value="">系统默认字体</option></select>' +
      '<div id="chuanxun-font-meta" style="font-size:12px;opacity:.7;line-height:1.6;margin-top:8px;min-height:20px">字体文件只保存在此 App 的本地数据空间。</div>' +
      '<input id="chuanxun-font-file" type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" style="display:none" />' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:14px"><button type="button" data-font-action="import" style="padding:12px;border:0;border-radius:11px;background:var(--accent-color,#5d8ef7);color:white;font-weight:700">＋ 导入字体</button><button type="button" data-font-action="apply" style="padding:12px;border:1px solid var(--border-color,#ddd);border-radius:11px;background:transparent;color:inherit">应用所选字体</button><button type="button" data-font-action="delete" style="padding:11px;border:1px solid var(--border-color,#ddd);border-radius:11px;background:transparent;color:inherit">删除所选字体</button><button type="button" data-font-action="default" style="padding:11px;border:1px solid var(--border-color,#ddd);border-radius:11px;background:transparent;color:inherit">恢复默认字体</button></div>' +
      '<div style="font-size:11px;opacity:.65;line-height:1.65;margin-top:13px">支持 TTF、OTF、WOFF、WOFF2，单个文件最大 50 MB。文件会先检查格式并尝试解析，验证成功后才替换当前字体。Chat 1、Chat 2 和朋友圈各自注册当前字体。</div></div>';
    modal.addEventListener('click', function (event) {
      if (event.target === modal) closeModal();
      var button = event.target && event.target.closest ? event.target.closest('[data-font-action]') : null;
      if (!button) return;
      var action = button.getAttribute('data-font-action');
      if (action === 'close') closeModal();
      else if (action === 'import') {
        var input = modal.querySelector('#chuanxun-font-file');
        if (input) { input.value = ''; input.click(); }
      } else if (action === 'apply') {
        var select = modal.querySelector('#chuanxun-font-list');
        var id = select && select.value;
        if (!id) restoreDefault().catch(showError);
        else applyFont(id).then(function () { setMetaText('字体已应用到整个传讯。'); }).catch(showError);
      } else if (action === 'delete') {
        var select2 = modal.querySelector('#chuanxun-font-list');
        if (select2 && select2.value) deleteFont(select2.value).then(function () { setMetaText('字体已删除。'); }).catch(showError);
        else setMetaText('请先选择要删除的字体。');
      } else if (action === 'default') {
        restoreDefault().then(function () { setMetaText('已恢复默认字体。'); }).catch(showError);
      }
    });
    var select = modal.querySelector('#chuanxun-font-list');
    if (select) select.addEventListener('change', function () {
      var recordId = select.value;
      var preview = modal.querySelector('#chuanxun-font-preview');
      if (!recordId) { if (preview) preview.style.fontFamily = ''; return; }
      previewFont(recordId, preview).catch(showError);
      getFont(recordId).then(function (record) {
        setMetaText(record ? (record.fileName + ' · ' + record.format.toUpperCase() + ' · ' + bytesLabel(record.size)) : '');
      }).catch(showError);
    });
    var fileInput = modal.querySelector('#chuanxun-font-file');
    if (fileInput) fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      setMetaText('正在检查并导入字体…');
      importFont(file).then(function (record) {
        setMetaText('已导入并应用：' + record.fileName);
        refreshUi();
      }).catch(showError);
    });
    global.document.body.appendChild(modal);
    return modal;
  }

  function setMetaText(message) {
    var node = global.document.getElementById('chuanxun-font-meta');
    if (node) node.textContent = message || '';
  }

  function showError(e) {
    var message = e && e.message ? e.message : String(e || '字体操作失败');
    setMetaText(message);
    console.error('[本地字体]', e);
    try {
      if (typeof global.showNotification === 'function') global.showNotification(message, 'error', 4000);
    } catch (_) {}
  }

  function closeModal() {
    var modal = global.document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
  }

  function openModal() {
    var modal = makeModal();
    modal.style.display = 'flex';
    refreshUi();
  }

  function ensureSettingsEntry() {
    var body = global.document.querySelector('#xiaoshu-settings-hub-modal .xs-settings-body');
    if (!body || global.document.getElementById(entryId)) return;
    var section = global.document.createElement('section');
    section.id = entryId;
    section.className = 'xs-settings-section';
    section.innerHTML = '<div class="xs-settings-section-title">显示与字体</div><div class="xs-settings-list"><button type="button" class="xs-settings-row" id="chuanxun-local-font-open"><span class="xs-settings-icon"><i class="fas fa-font" aria-hidden="true"></i></span><span style="min-width:0"><span style="display:block;font-weight:700">本地自定义字体</span><span id="chuanxun-local-font-current" style="display:block;font-size:12px;color:var(--text-secondary,#777);margin-top:3px">系统默认字体</span></span><span aria-hidden="true">›</span></button></div>';
    body.appendChild(section);
    var button = section.querySelector('#chuanxun-local-font-open');
    if (button) button.addEventListener('click', openModal);
    refreshUi();
  }

  function refreshUi() {
    var label = global.document.getElementById('chuanxun-local-font-current');
    if (label) label.textContent = activeFontId ? '已启用自定义字体' : '系统默认字体';
    var modal = global.document.getElementById(modalId);
    if (!modal) return;
    var select = modal.querySelector('#chuanxun-font-list');
    if (!select) return;
    listFonts().then(function (items) {
      var previous = select.value || activeFontId || '';
      select.innerHTML = '<option value="">系统默认字体</option>';
      items.forEach(function (item) {
        var option = global.document.createElement('option');
        option.value = item.id;
        option.textContent = item.name + '（' + String(item.format || '').toUpperCase() + '）';
        select.appendChild(option);
      });
      var exists = items.some(function (item) { return item.id === previous; });
      select.value = exists ? previous : (activeFontId || '');
      if (activeFontId && select.value !== activeFontId) select.value = activeFontId;
      var current = items.find(function (item) { return item.id === select.value; });
      setMetaText(current ? (current.fileName + ' · ' + current.format.toUpperCase() + ' · ' + bytesLabel(current.size)) : '字体文件只保存在此 App 的本地数据空间。');
    }).catch(function (e) { setMetaText(e && e.message ? e.message : '无法读取本地字体库'); });
  }

  function init() {
    try {
      if (typeof global.BroadcastChannel === 'function') {
        channel = new global.BroadcastChannel(CHANNEL_NAME);
        channel.onmessage = function (event) { receive(event.data); };
      }
    } catch (_) { channel = null; }
    global.addEventListener('storage', function (event) {
      if (event && event.key === '__chuanxun_font_signal__' && event.newValue) {
        try { receive(JSON.parse(event.newValue)); } catch (_) {}
      }
    });
    global.addEventListener('message', function (event) {
      if (event && event.data && event.data.origin === 'chuanxun-font-manager') receive(event.data);
    });
    installGlobalFontCss();
    ensureSettingsEntry();
    if (global.MutationObserver && global.document.documentElement) {
      var observer = new global.MutationObserver(ensureSettingsEntry);
      observer.observe(global.document.documentElement, { childList: true, subtree: true });
    }
    restoreCurrent().catch(function (e) { console.warn('[本地字体] 启动恢复失败', e); });
  }


  function checksumBlob(blob) {
    if (!blob || typeof blob.arrayBuffer !== 'function') return Promise.reject(error('字体二进制数据不可读取'));
    return blob.arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer), hash = 2166136261;
      for (var i = 0; i < bytes.length; i++) {
        hash ^= bytes[i];
        hash = Math.imul(hash, 16777619);
      }
      return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
    });
  }

  function validateBackupSnapshot(snapshot) {
    if (!snapshot || snapshot.schema !== 'chuanxun-font-library-backup' || Number(snapshot.formatVersion) !== 1 || !Array.isArray(snapshot.fonts)) {
      return Promise.reject(error('字体备份格式或版本不受支持'));
    }
    var seen = Object.create(null);
    var fontsPromise = Promise.all(snapshot.fonts.map(function (record) {
      return Promise.resolve().then(async function () {
        if (!record || typeof record !== 'object') throw error('字体备份中存在无效记录');
        var id = String(record.id || '').trim();
        var fileName = String(record.fileName || '').trim();
        if (!id || id.length > 256 || !fileName) throw error('字体备份缺少有效 ID 或文件名');
        if (seen[id]) throw error('字体备份存在重复字体 ID：' + id);
        seen[id] = true;
        var blob = record.blob;
        if (!blob || typeof blob.arrayBuffer !== 'function' || !Number(blob.size)) throw error('字体 ' + fileName + ' 缺少有效二进制文件');
        if (Number(record.size) !== Number(blob.size)) throw error('字体 ' + fileName + ' 的文件大小与记录不一致');
        if (Number(blob.size) > MAX_FILE_SIZE) throw error('字体 ' + fileName + ' 超过 50 MB 安全限制');
        var actualFormat = detectFormat(await blob.arrayBuffer(), fileName);
        var format = String(record.format || '').toLowerCase();
        if (format !== actualFormat) throw error('字体 ' + fileName + ' 的格式声明与文件内容不一致');
        var mimeType = MIME_BY_FORMAT[actualFormat];
        if (String(record.mimeType || '').toLowerCase() !== mimeType || String(blob.type || '').toLowerCase() !== mimeType) throw error('字体 ' + fileName + ' 的 MIME 类型与格式不一致');
        var checksum = await checksumBlob(blob);
        if (!record.checksum || String(record.checksum).toLowerCase() !== checksum) throw error('字体 ' + fileName + ' 缺少有效二进制校验值或校验失败');
        return {
          id: id,
          name: String(record.name || fileName.replace(/\\.[^.]+$/, '') || '自定义字体'),
          fileName: fileName,
          format: actualFormat,
          mimeType: mimeType,
          size: Number(blob.size),
          blob: blob,
          createdAt: Number(record.createdAt) || 0,
          checksum: checksum
        };
      });
    }));
    return fontsPromise.then(function (fonts) {
      var currentFontId = snapshot.currentFontId == null || snapshot.currentFontId === '' ? null : String(snapshot.currentFontId);
      if (currentFontId && !seen[currentFontId]) throw error('字体备份的当前字体 ID 不在字体清单中');
      return { schema: 'chuanxun-font-library-backup', formatVersion: 1, currentFontId: currentFontId, fonts: fonts };
    });
  }

  async function exportBackupSnapshot() {
    var db = await openDatabase();
    var tx = db.transaction([FONT_STORE, META_STORE], 'readonly');
    var done = transactionDone(tx);
    var values = await Promise.all([
      requestValue(tx.objectStore(FONT_STORE).getAll()),
      requestValue(tx.objectStore(META_STORE).get(CURRENT_KEY))
    ]);
    await done;
    var snapshot = {
      schema: 'chuanxun-font-library-backup',
      formatVersion: 1,
      currentFontId: values[1] && values[1].value != null ? String(values[1].value) : null,
      fonts: await Promise.all((values[0] || []).map(async function (record) {
        return {
          id: record.id,
          name: record.name,
          fileName: record.fileName,
          format: record.format,
          mimeType: record.mimeType,
          size: record.size,
          blob: record.blob,
          createdAt: record.createdAt,
          checksum: await checksumBlob(record.blob)
        };
      }))
    };
    return validateBackupSnapshot(snapshot);
  }

  async function rollbackBackupRestore(snapshot, addedIds) {
    if (!snapshot || snapshot.schema !== 'chuanxun-font-library-backup' || Number(snapshot.formatVersion) !== 1) {
      throw error('字体恢复回滚快照无效');
    }
    var currentFontId = snapshot.currentFontId == null || snapshot.currentFontId === '' ? null : String(snapshot.currentFontId);
    if (!Array.isArray(snapshot.fonts)) throw error('字体恢复回滚快照缺少原字体清单');
    var originalIds = Object.create(null);
    snapshot.fonts.forEach(function (record) { if (record && record.id != null) originalIds[String(record.id)] = true; });
    if (currentFontId && !originalIds[currentFontId]) throw error('字体恢复回滚快照的当前字体不在原字体清单中');
    var removeIds = Array.isArray(addedIds) ? Array.from(new Set(addedIds.map(String).filter(Boolean))) : [];
    removeIds.forEach(function (id) { if (originalIds[id]) throw error('拒绝回滚删除恢复前已存在的字体：' + id); });
    if (currentFontId && removeIds.indexOf(currentFontId) !== -1) throw error('字体恢复回滚快照与新增字体列表冲突');
    if (currentFontId && !(await getFont(currentFontId))) throw error('字体恢复回滚找不到原当前字体：' + currentFontId);
    var db = await openDatabase();
    var tx = db.transaction([FONT_STORE, META_STORE], 'readwrite');
    var done = transactionDone(tx);
    var store = tx.objectStore(FONT_STORE);
    try {
      removeIds.forEach(function (id) { store.delete(id); });
      tx.objectStore(META_STORE).put({ key: CURRENT_KEY, value: currentFontId, updatedAt: Date.now() });
      await done;
    } catch (rollbackError) {
      try { tx.abort(); } catch (_) {}
      try { await done; } catch (_) {}
      throw error('字体库回滚事务失败，整笔回滚已中止：' + (rollbackError && rollbackError.message ? rollbackError.message : String(rollbackError)));
    }
    return { ok: true, removed: removeIds.length, currentFontId: currentFontId };
  }

  async function restoreBackupSnapshot(snapshot) {
    var clean = await validateBackupSnapshot(snapshot);
    var existing = await listFonts();
    var existingById = Object.create(null);
    existing.forEach(function (record) { existingById[String(record.id)] = record; });
    var toAdd = [], skipped = [];
    for (var i = 0; i < clean.fonts.length; i++) {
      var incoming = clean.fonts[i], old = existingById[incoming.id];
      if (!old) { toAdd.push(incoming); continue; }
      var oldChecksum = await checksumBlob(old.blob);
      var same = String(old.name || '') === incoming.name &&
        String(old.fileName || '') === incoming.fileName &&
        String(old.format || '').toLowerCase() === incoming.format &&
        String(old.mimeType || '').toLowerCase() === incoming.mimeType &&
        Number(old.size) === incoming.size &&
        oldChecksum === incoming.checksum;
      if (!same) throw error('字体 ID 冲突，拒绝覆盖现有字体：' + incoming.id);
      skipped.push(incoming.id);
    }
    var currentFontId = clean.currentFontId;
    var previousCurrentId = await getMeta(CURRENT_KEY);
    var rollbackState = { schema: 'chuanxun-font-library-backup', formatVersion: 1, currentFontId: previousCurrentId == null ? null : String(previousCurrentId), fonts: existing.map(function (record) { return { id: String(record.id) }; }) };
    var addedIds = toAdd.map(function (x) { return x.id; });
    var db = await openDatabase();
    var tx = db.transaction([FONT_STORE, META_STORE], 'readwrite');
    var done = transactionDone(tx);
    try {
      var store = tx.objectStore(FONT_STORE);
      toAdd.forEach(function (record) {
        store.add({
          id: record.id,
          name: record.name,
          fileName: record.fileName,
          format: record.format,
          mimeType: record.mimeType,
          size: record.size,
          blob: record.blob,
          createdAt: record.createdAt
        });
      });
      tx.objectStore(META_STORE).put({ key: CURRENT_KEY, value: currentFontId, updatedAt: Date.now() });
      await done;
    } catch (writeError) {
      try { tx.abort(); } catch (_) {}
      try { await done; } catch (_) {}
      throw error('字体库事务写入失败，已中止整笔事务：' + (writeError && writeError.message ? writeError.message : String(writeError)));
    }
    try {
      for (var j = 0; j < clean.fonts.length; j++) {
        var expected = clean.fonts[j], actual = await getFont(expected.id);
        if (!actual || Number(actual.size) !== expected.size || await checksumBlob(actual.blob) !== expected.checksum) {
          throw error('字体恢复后的回读校验失败：' + expected.fileName);
        }
      }
      return { ok: true, added: addedIds.length, skipped: skipped.length, addedIds: addedIds, currentFontId: currentFontId };
    } catch (verifyError) {
      try {
        await rollbackBackupRestore(rollbackState, addedIds);
      } catch (rollbackError) {
        throw error('字体恢复回读失败，且自动回滚失败。恢复错误：' + (verifyError.message || verifyError) + '；回滚错误：' + (rollbackError.message || rollbackError));
      }
      throw error('字体恢复回读失败，已回滚本次新增字体：' + (verifyError.message || verifyError));
    }
  }

  var api = {
    importFont: importFont,
    applyFont: applyFont,
    previewFont: previewFont,
    deleteFont: deleteFont,
    restoreDefault: restoreDefault,
    restoreCurrent: restoreCurrent,
    listFonts: listFonts,
    exportBackupSnapshot: exportBackupSnapshot,
    validateBackupSnapshot: validateBackupSnapshot,
    restoreBackupSnapshot: restoreBackupSnapshot,
    rollbackBackupRestore: rollbackBackupRestore,
    getCurrentFontId: function () { return activeFontId; },
    openSettings: openModal,
    _detectFormat: detectFormat,
    _dbName: DB_NAME
  };
  global.ChuanXunFontManager = api;

  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', init, { once: true });
  } else if (global.document) {
    init();
  }
})(window);
