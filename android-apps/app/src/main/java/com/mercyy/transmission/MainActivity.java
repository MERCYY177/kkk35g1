package com.mercyy.transmission;

import android.app.Activity;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.IOException;
import java.io.OutputStream;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

/**
 * Android shell for the complete, locally packaged ChuanXun web application.
 * All first-party HTML, JavaScript, CSS and media are served from APK assets
 * through WebViewAssetLoader; the home page never navigates to GitHub Pages.
 */
public class MainActivity extends Activity {
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String HOME_URL = "https://" + APP_HOST + "/assets/site/index.html";
    private static final int FILE_CHOOSER_REQUEST = 4107;
    private static final int BACKUP_SAVE_REQUEST = 4108;
    private static final long MAX_BACKUP_BYTES = 1024L * 1024L * 1024L;

    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    private WebViewAssetLoader assetLoader;
    private final Object backupSaveLock = new Object();
    private OutputStream backupOutputStream;
    private long backupExpectedBytes;
    private long backupWrittenBytes;

    private static final String INSTALL_BACKUP_DOWNLOAD_BRIDGE_JS = """
            (function () {
              if (window.__chuanxunNativeBackupBridgeInstalled) return;
              function install() {
                var original = window.xiaoshuOfferBlobDownload;
                if (typeof original !== 'function') { setTimeout(install, 120); return; }
                if (original.__chuanxunNativeWrapper) {
                  window.__chuanxunNativeBackupBridgeInstalled = true;
                  return;
                }
                var wrapped = function (blob, name, opt) {
                  var result = original.apply(this, arguments);
                  var link = document.getElementById('xiaoshu-rescue-save-link');
                  var bridge = window.ChuanXunBackupBridge;
                  if (link && bridge && typeof bridge.requestSave === 'function' && blob instanceof Blob) {
                    link.removeAttribute('href');
                    link.removeAttribute('download');
                    link.onclick = function (event) {
                      if (event) { event.preventDefault(); event.stopPropagation(); }
                      if (link.dataset.saving === '1') return false;
                      link.dataset.saving = '1';
                      link.textContent = '请选择保存位置…';
                      window.__chuanxunBackupPickerResult = function (ok, message) {
                        if (!ok) {
                          delete link.dataset.saving;
                          link.textContent = '重新保存文件';
                          if (message) alert('未能选择保存位置：' + message);
                          return;
                        }
                        (async function () {
                          var offset = 0;
                          var chunkSize = 32 * 1024;
                          while (offset < blob.size) {
                            var bytes = new Uint8Array(await blob.slice(offset, Math.min(offset + chunkSize, blob.size)).arrayBuffer());
                            var binary = '';
                            for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                            if (!bridge.writeChunk(btoa(binary))) throw new Error('文件数据写入手机失败');
                            offset += bytes.length;
                          }
                          if (!bridge.finishSave()) throw new Error('文件长度校验或最终保存失败');
                          delete link.dataset.saving;
                          link.textContent = '已保存到手机文件';
                          if (typeof window.showNotification === 'function') window.showNotification('备份文件已保存到你选择的位置', 'success', 6000);
                        })().catch(function (error) {
                          try { bridge.cancelSave(); } catch (_) {}
                          delete link.dataset.saving;
                          link.textContent = '重新保存文件';
                          alert('备份文件保存失败：' + (error && error.message ? error.message : String(error)));
                        });
                      };
                      try {
                        bridge.requestSave(String(name || '传讯备份.bin'), String(blob.type || 'application/octet-stream'), Number(blob.size));
                      } catch (error) {
                        delete link.dataset.saving;
                        link.textContent = '重新保存文件';
                        alert('无法打开系统保存窗口：' + (error && error.message ? error.message : String(error)));
                      }
                      return false;
                    };
                  }
                  return result;
                };
                wrapped.__chuanxunNativeWrapper = true;
                window.xiaoshuOfferBlobDownload = wrapped;
                window.__chuanxunNativeBackupBridgeInstalled = true;
              }
              install();
            })();
            """;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applySystemBars();

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        webView.addJavascriptInterface(new BackupDownloadBridge(), "ChuanXunBackupBridge");

        assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(APP_HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setLoadsImagesAutomatically(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setDefaultTextEncodingName("UTF-8");
        settings.setTextZoom(getSystemTextZoom());
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        applySystemFontFamilies(settings);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                && WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            WebSettingsCompat.setForceDark(settings, WebSettingsCompat.FORCE_DARK_AUTO);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (url != null && url.startsWith("https://" + APP_HOST + "/")) {
                    view.evaluateJavascript(INSTALL_BACKUP_DOWNLOAD_BRIDGE_JS, null);
                }
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return assetLoader.shouldInterceptRequest(Uri.parse(url));
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equalsIgnoreCase(uri.getScheme()) && APP_HOST.equalsIgnoreCase(uri.getHost())) {
                    return false;
                }
                // Keep first-party application navigation local. External links may
                // be opened by Android's browser instead of replacing the app shell.
                String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
                if ("https".equals(scheme) || "http".equals(scheme)
                        || "mailto".equals(scheme) || "tel".equals(scheme)) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception e) {
                    fileChooserCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
            }
        });

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(HOME_URL);
        }
    }

    private final class BackupDownloadBridge {
        @JavascriptInterface
        public void requestSave(String name, String mimeType, long expectedBytes) {
            if (expectedBytes <= 0 || expectedBytes > MAX_BACKUP_BYTES) {
                notifyBackupPicker(false, "备份文件为空或超过 1 GB 的单文件保存上限");
                return;
            }
            synchronized (backupSaveLock) {
                closeBackupOutputLocked();
                backupExpectedBytes = expectedBytes;
                backupWrittenBytes = 0;
            }
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType(safeBackupMimeType(mimeType));
                    intent.putExtra(Intent.EXTRA_TITLE, safeBackupFileName(name));
                    startActivityForResult(intent, BACKUP_SAVE_REQUEST);
                } catch (Exception e) {
                    cancelBackupSave();
                    notifyBackupPicker(false, "系统文件保存窗口无法打开");
                }
            });
        }

        @JavascriptInterface
        public boolean writeChunk(String base64) {
            if (base64 == null || base64.length() > 100000) return false;
            synchronized (backupSaveLock) {
                if (backupOutputStream == null) return false;
                try {
                    byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                    if (backupWrittenBytes + bytes.length > backupExpectedBytes) return false;
                    backupOutputStream.write(bytes);
                    backupWrittenBytes += bytes.length;
                    return true;
                } catch (Exception e) {
                    return false;
                }
            }
        }

        @JavascriptInterface
        public boolean finishSave() {
            synchronized (backupSaveLock) {
                if (backupOutputStream == null || backupWrittenBytes != backupExpectedBytes) return false;
                try {
                    backupOutputStream.flush();
                    backupOutputStream.close();
                    backupOutputStream = null;
                    backupExpectedBytes = 0;
                    backupWrittenBytes = 0;
                    return true;
                } catch (IOException e) {
                    closeBackupOutputLocked();
                    return false;
                }
            }
        }

        @JavascriptInterface
        public void cancelSave() {
            cancelBackupSave();
        }
    }

    private void cancelBackupSave() {
        synchronized (backupSaveLock) {
            closeBackupOutputLocked();
            backupExpectedBytes = 0;
            backupWrittenBytes = 0;
        }
    }

    private void closeBackupOutputLocked() {
        if (backupOutputStream != null) {
            try { backupOutputStream.close(); } catch (IOException ignored) {}
            backupOutputStream = null;
        }
    }

    private void notifyBackupPicker(boolean ok, String message) {
        if (webView == null) return;
        String safe = message == null ? "" : message.replace("\\", "\\\\")
                .replace("'", "\\'").replace("\r", "\\r").replace("\n", "\\n");
        String js = "if(window.__chuanxunBackupPickerResult){window.__chuanxunBackupPickerResult(" + ok
                + ", '" + safe + "');}";
        runOnUiThread(() -> { if (webView != null) webView.evaluateJavascript(js, null); });
    }

    private String safeBackupMimeType(String mimeType) {
        if (mimeType != null && mimeType.toLowerCase().contains("zip")) return "application/zip";
        if (mimeType != null && mimeType.toLowerCase().contains("json")) return "application/json";
        return "application/octet-stream";
    }

    private String safeBackupFileName(String name) {
        String value = name == null ? "chuanxun-backup.bin" : name.trim();
        StringBuilder safe = new StringBuilder();
        for (int i = 0; i < value.length() && safe.length() < 120; i++) {
            char ch = value.charAt(i);
            safe.append(ch < 32 || "\\/:*?\"<>|".indexOf(ch) >= 0 ? '_' : ch);
        }
        return safe.length() == 0 ? "chuanxun-backup.bin" : safe.toString();
    }

    private void applySystemFontFamilies(WebSettings settings) {
        settings.setStandardFontFamily("sans-serif");
        settings.setSansSerifFontFamily("sans-serif");
        settings.setSerifFontFamily("serif");
        settings.setFixedFontFamily("monospace");
    }

    private int getSystemTextZoom() {
        float scale = getResources().getConfiguration().fontScale;
        return Math.max(50, Math.min(300, Math.round(scale * 100f)));
    }

    private void applySystemBars() {
        boolean dark = (getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int barColor = Color.parseColor(dark ? "#121212" : "#f9f9f9");
        getWindow().setStatusBarColor(barColor);
        getWindow().setNavigationBarColor(barColor);
        View decor = getWindow().getDecorView();
        int flags = decor.getSystemUiVisibility();
        int lightFlags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            lightFlags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        if (dark) flags &= ~lightFlags;
        else flags |= lightFlags;
        decor.setSystemUiVisibility(flags);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        applySystemBars();
        if (webView != null) {
            applySystemFontFamilies(webView.getSettings());
            webView.getSettings().setTextZoom(getSystemTextZoom());
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && fileChooserCallback != null) {
            fileChooserCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileChooserCallback = null;
            return;
        }
        if (requestCode == BACKUP_SAVE_REQUEST) {
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                cancelBackupSave();
                notifyBackupPicker(false, "已取消保存");
                return;
            }
            try {
                OutputStream stream = getContentResolver().openOutputStream(data.getData(), "w");
                if (stream == null) throw new IOException("无法打开目标文件");
                synchronized (backupSaveLock) {
                    closeBackupOutputLocked();
                    backupOutputStream = stream;
                    backupWrittenBytes = 0;
                }
                notifyBackupPicker(true, "");
            } catch (Exception e) {
                cancelBackupSave();
                notifyBackupPicker(false, "无法写入所选文件");
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        if (fileChooserCallback != null) {
            fileChooserCallback.onReceiveValue(null);
            fileChooserCallback = null;
        }
        cancelBackupSave();
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
