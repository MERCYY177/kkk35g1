package com.mercyy177.kkk35g1;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.util.TypedValue;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import java.io.OutputStream;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int SAVE_FILE_REQUEST = 1002;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private WebViewAssetLoader assetLoader;
    private byte[] pendingDownloadBytes;
    private String pendingDownloadName = "export.bin";
    private String pendingDownloadMime = "application/octet-stream";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // The Android theme is resolved from values/ vs values-night/.
        // This exposes the correct isLightTheme to WebView's prefers-color-scheme on API 33+.
        Window window = getWindow();
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        webView.setBackgroundColor(resolveThemeColor(android.R.attr.colorBackground));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setDefaultTextEncodingName("UTF-8");
        // Keep CSS generic font families mapped to Android WebView/system font fallback.
        settings.setStandardFontFamily("sans-serif");
        settings.setSansSerifFontFamily("sans-serif");
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.addJavascriptInterface(new AndroidDownloadBridge(), "AndroidDownload");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("appassets.androidplatform.net".equals(uri.getHost())) {
                    return false;
                }
                String scheme = uri.getScheme();
                if ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (ActivityNotFoundException ignored) {
                        Toast.makeText(MainActivity.this, "没有可打开此链接的应用", Toast.LENGTH_SHORT).show();
                    }
                    return true;
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                installBlobDownloadBridge();
                installSystemFontFollowBridge();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams fileChooserParams
            ) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                try {
                    Intent intent = fileChooserParams.createIntent();
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (RuntimeException exception) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "无法打开文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        setContentView(webView);
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html");
    }

    private int resolveThemeColor(int attr) {
        TypedValue value = new TypedValue();
        if (getTheme().resolveAttribute(attr, value, true)) {
            if (value.resourceId != 0) {
                return getResources().getColor(value.resourceId);
            }
            return value.data;
        }
        return 0xFFFAFAFA;
    }


    /**
     * Prefer Android's generic sans-serif family for page text. This gives WebView
     * the best chance to resolve the device's current system font instead of the
     * website's cross-platform system-ui/fallback stack.
     */
    private void installSystemFontFollowBridge() {
        String script =
                "(function(){"
                + "if(window.__systemFontFollowBridgeInstalled)return;"
                + "window.__systemFontFollowBridgeInstalled=true;"
                + "function apply(doc){"
                + "if(!doc||!doc.documentElement)return;"
                + "var root=doc.documentElement;"
                + "root.style.setProperty('--font-family','sans-serif','important');"
                + "root.style.setProperty('--message-font-family','sans-serif','important');"
                + "var style=doc.getElementById('__system_font_follow_bridge_css');"
                + "if(!style){style=doc.createElement('style');style.id='__system_font_follow_bridge_css';(doc.head||root).appendChild(style);}"
                + "style.textContent='html,body{font-family:sans-serif!important} body :not(svg):not(path):not(i):not([class*=icon]):not([class*=Icon]):not([class*=symbol]):not([class*=fa-]){font-family:sans-serif!important} input,textarea,select,button{font-family:sans-serif!important}';"
                + "}"
                + "function scan(){apply(document);document.querySelectorAll('iframe').forEach(function(frame){try{apply(frame.contentDocument);frame.addEventListener('load',function(){try{apply(frame.contentDocument)}catch(e){}})}catch(e){}})}"
                + "scan();new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});"
                + "})();";
        webView.evaluateJavascript(script, null);
    }

    private void installBlobDownloadBridge() {
        String script =
                "(function(){"
                + "if(window.__androidBlobDownloadBridgeInstalled)return;"
                + "window.__androidBlobDownloadBridgeInstalled=true;"
                + "var create=URL.createObjectURL.bind(URL);"
                + "var blobs=new Map();"
                + "URL.createObjectURL=function(obj){var u=create(obj);if(obj instanceof Blob)blobs.set(u,obj);return u;};"
                + "document.addEventListener('click',function(e){"
                + "var el=e.target;var a=el&&el.closest?el.closest('a[download]'):null;if(!a)return;"
                + "var href=a.href||'';if(!href.startsWith('blob:'))return;"
                + "var b=blobs.get(href);if(!b)return;"
                + "e.preventDefault();e.stopImmediatePropagation();"
                + "var reader=new FileReader();reader.onload=function(){"
                + "var result=String(reader.result||'');var comma=result.indexOf(',');"
                + "if(comma>=0&&window.AndroidDownload){window.AndroidDownload.saveBase64(a.download||'export.bin',b.type||'application/octet-stream',result.substring(comma+1));}"
                + "};reader.readAsDataURL(b);"
                + "},true);"
                + "})();";
        webView.evaluateJavascript(script, null);
    }

    private class AndroidDownloadBridge {
        @JavascriptInterface
        public void saveBase64(String fileName, String mimeType, String base64) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                runOnUiThread(() -> {
                    pendingDownloadBytes = bytes;
                    pendingDownloadName = sanitizeFileName(fileName);
                    pendingDownloadMime = (mimeType == null || mimeType.trim().isEmpty())
                            ? "application/octet-stream" : mimeType;
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType(pendingDownloadMime);
                    intent.putExtra(Intent.EXTRA_TITLE, pendingDownloadName);
                    try {
                        startActivityForResult(intent, SAVE_FILE_REQUEST);
                    } catch (ActivityNotFoundException exception) {
                        pendingDownloadBytes = null;
                        Toast.makeText(MainActivity.this, "无法打开保存位置选择器", Toast.LENGTH_LONG).show();
                    }
                });
            } catch (IllegalArgumentException exception) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "导出文件失败", Toast.LENGTH_LONG).show());
            }
        }
    }

    private String sanitizeFileName(String name) {
        if (name == null || name.trim().isEmpty()) return "export.bin";
        String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        return safe.isEmpty() ? "export.bin" : safe;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback != null) {
                Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
            return;
        }

        if (requestCode == SAVE_FILE_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingDownloadBytes != null) {
                try (OutputStream stream = getContentResolver().openOutputStream(data.getData())) {
                    if (stream != null) {
                        stream.write(pendingDownloadBytes);
                        Toast.makeText(this, "文件已保存", Toast.LENGTH_SHORT).show();
                    } else {
                        Toast.makeText(this, "保存失败", Toast.LENGTH_LONG).show();
                    }
                } catch (Exception exception) {
                    Toast.makeText(this, "保存失败：" + exception.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
            pendingDownloadBytes = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
