package com.mercyy.transmission;

import android.content.Intent;
import android.net.Uri;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.os.Build;
import android.content.res.Configuration;
import android.graphics.Color;
import android.view.View;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

public class MainActivity extends ComponentActivity {
    private static final String HOME_URL = "file:///android_asset/site/index.html";
    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    private static final int FILE_CHOOSER_REQUEST = 4107;
    private static final int FONT_PICKER_REQUEST = 4108;
    private static final String FONT_URL = "https://app-fonts.local/fonts/current";
    private static final String FONT_PREFS = "transmission_custom_font";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applySystemBars();

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        webView.addJavascriptInterface(new FontBridge(), "TransmissionNative");

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setDefaultTextEncodingName("UTF-8");
        settings.setTextZoom(getSystemTextZoom());

        // Resolve generic web font families through Android's system font aliases.
        // On Android/HarmonyOS builds that expose the selected system font through
        // the Android font configuration, WebView can then use that same family.
        // Keep the web page's own font-size and weight styling unchanged.
        applySystemFontFamilies(settings);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
                WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            WebSettingsCompat.setForceDark(settings, WebSettingsCompat.FORCE_DARK_AUTO);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse response = serveCustomFont(request.getUrl().toString());
                return response != null ? response : super.shouldInterceptRequest(view, request);
            }
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                WebResourceResponse response = serveCustomFont(url);
                return response != null ? response : super.shouldInterceptRequest(view, url);
            }
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                injectFontSettingsUi();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception e) {
                    fileChooserCallback = null;
                    Toast.makeText(MainActivity.this, "无法打开文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        if (savedInstanceState == null) webView.loadUrl(HOME_URL);
        else if (webView.restoreState(savedInstanceState) == null) webView.loadUrl(HOME_URL);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (webView != null && webView.canGoBack()) webView.goBack();
                else finish();
            }
        });
    }


    private File getCustomFontFile() {
        String extension = getSharedPreferences(FONT_PREFS, MODE_PRIVATE).getString("extension", "ttf");
        return new File(getFilesDir(), "custom-font." + ("otf".equals(extension) ? "otf" : "ttf"));
    }

    private WebResourceResponse serveCustomFont(String url) {
        if (url == null || !url.startsWith(FONT_URL)) return null;
        File font = getCustomFontFile();
        if (!font.isFile()) return null;
        try {
            String extension = getSharedPreferences(FONT_PREFS, MODE_PRIVATE).getString("extension", "ttf");
            String mime = "otf".equals(extension) ? "font/otf" : "font/ttf";
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-store");
            return new WebResourceResponse(mime, null, 200, "OK", headers, new FileInputStream(font));
        } catch (Exception e) {
            return null;
        }
    }

    private void openFontPicker() {
        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
                    "font/ttf", "font/otf", "application/x-font-ttf",
                    "application/x-font-opentype", "application/octet-stream"
            });
            startActivityForResult(intent, FONT_PICKER_REQUEST);
        } catch (Exception e) {
            Toast.makeText(this, "无法打开字体文件选择器", Toast.LENGTH_SHORT).show();
        }
    }

    private String getDisplayName(Uri uri) {
        String name = null;
        try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) name = cursor.getString(index);
            }
        } catch (Exception ignored) {}
        return name == null ? "custom-font.ttf" : name;
    }

    private void importCustomFont(Uri uri) {
        if (uri == null) return;
        String displayName = getDisplayName(uri);
        String lower = displayName.toLowerCase(java.util.Locale.ROOT);
        String extension = lower.endsWith(".ttf") ? "ttf" : (lower.endsWith(".otf") ? "otf" : "");
        if (extension.isEmpty()) {
            Toast.makeText(this, "目前只支持 .ttf 和 .otf 字体文件", Toast.LENGTH_LONG).show();
            return;
        }
        File target = new File(getFilesDir(), "custom-font." + extension);
        File temp = new File(getFilesDir(), "custom-font.tmp");
        long total = 0;
        try (InputStream input = getContentResolver().openInputStream(uri);
             FileOutputStream output = new FileOutputStream(temp)) {
            if (input == null) throw new IllegalStateException("无法读取字体文件");
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > 50L * 1024L * 1024L) throw new IllegalArgumentException("字体文件不能超过 50 MB");
                output.write(buffer, 0, count);
            }
            output.flush();
            File old = new File(getFilesDir(), "custom-font." + ("ttf".equals(extension) ? "otf" : "ttf"));
            if (old.exists()) old.delete();
            if (target.exists() && !target.delete()) throw new IllegalStateException("无法替换旧字体");
            if (!temp.renameTo(target)) throw new IllegalStateException("无法保存字体文件");
            getSharedPreferences(FONT_PREFS, MODE_PRIVATE).edit()
                    .putString("extension", extension).putString("name", displayName).apply();
            notifyFontChanged(true, displayName);
        } catch (Exception e) {
            if (temp.exists()) temp.delete();
            Toast.makeText(this, "字体导入失败：" + (e.getMessage() == null ? "文件无法读取" : e.getMessage()),
                    Toast.LENGTH_LONG).show();
        }
    }

    private void removeCustomFont() {
        File ttf = new File(getFilesDir(), "custom-font.ttf");
        File otf = new File(getFilesDir(), "custom-font.otf");
        if (ttf.exists()) ttf.delete();
        if (otf.exists()) otf.delete();
        getSharedPreferences(FONT_PREFS, MODE_PRIVATE).edit().clear().apply();
        notifyFontChanged(false, "");
    }

    private void injectFontSettingsUi() {
        if (webView != null) webView.evaluateJavascript(FONT_SETTINGS_SCRIPT, null);
    }

    private void notifyFontChanged(boolean enabled, String name) {
        if (webView == null) return;
        String script = "if(window.__transmissionFontChanged){window.__transmissionFontChanged("
                + enabled + "," + org.json.JSONObject.quote(name == null ? "" : name) + ");}";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private final class FontBridge {
        @JavascriptInterface public void chooseFont() { runOnUiThread(() -> openFontPicker()); }
        @JavascriptInterface public void removeFont() { runOnUiThread(() -> removeCustomFont()); }
        @JavascriptInterface public boolean hasCustomFont() { return getCustomFontFile().isFile(); }
        @JavascriptInterface public String getSavedFontName() {
            return getSharedPreferences(FONT_PREFS, MODE_PRIVATE).getString("name", "");
        }
    }

    private static final String FONT_SETTINGS_SCRIPT = "(function(){"
            + "if(window.__transmissionFontUiInstalled)return;window.__transmissionFontUiInstalled=true;"
            + "var style=document.createElement('style');style.id='transmission-user-font-style';document.head.appendChild(style);"
            + "function applyFont(on){style.textContent=on?\"@font-face{font-family:'TransmissionUserFont';src:url('https://app-fonts.local/fonts/current');font-display:swap;}html.transmission-custom-font body,html.transmission-custom-font body :not(i):not(svg):not(path):not(.fa):not(.fas):not(.far):not(.fab):not([class*='fa-']):not([class*='icon']){font-family:'TransmissionUserFont',sans-serif!important;}\":'';document.documentElement.classList.toggle('transmission-custom-font',!!on);}"
            + "function bridge(){return window.TransmissionNative||null;}"
            + "function refresh(){var b=bridge(),name='';try{if(b&&b.hasCustomFont())name=b.getSavedFontName()||'已导入字体';}catch(e){}var label=document.getElementById('transmission-font-current');if(label)label.textContent=name||'系统默认字体';var remove=document.getElementById('transmission-font-remove');if(remove)remove.style.display=name?'':'none';applyFont(!!name);}"
            + "window.__transmissionFontChanged=function(on,name){applyFont(on);refresh();var label=document.getElementById('transmission-font-current');if(label)label.textContent=on?(name||'已导入字体'):'系统默认字体';};"
            + "function panel(){var old=document.getElementById('transmission-font-modal');if(old){old.style.display='flex';refresh();return;}var o=document.createElement('div');o.id='transmission-font-modal';o.style.cssText='position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.48);display:flex;align-items:center;justify-content:center;padding:18px;';"
            + "o.innerHTML='<div style=\"width:min(100%,440px);max-height:85dvh;overflow:auto;border-radius:20px;background:var(--primary-bg,#fff);color:var(--text-primary,#111);padding:20px;box-shadow:0 12px 40px rgba(0,0,0,.22);\"><div style=\"display:flex;justify-content:space-between;font-size:18px;font-weight:750;margin-bottom:16px;\"><span>字体设置</span><button id=\"transmission-font-close\" style=\"border:0;background:transparent;color:inherit;font-size:22px;\">×</button></div><div style=\"padding:14px;border-radius:14px;background:var(--secondary-bg,#f5f5f5);margin-bottom:14px;\"><div style=\"font-size:12px;color:var(--text-secondary,#777);margin-bottom:6px;\">当前字体</div><div id=\"transmission-font-current\" style=\"font-weight:700;overflow-wrap:anywhere;\">系统默认字体</div><div style=\"font-size:15px;line-height:1.8;margin-top:12px;\">你好，今天想和你聊些什么？<br>字体预览：Aa 你好 123</div></div><button id=\"transmission-font-import\" style=\"width:100%;padding:13px;border:0;border-radius:12px;background:var(--accent-color,#5f8ff7);color:white;font-size:15px;font-weight:700;\">＋ 导入 TTF / OTF 字体</button><button id=\"transmission-font-remove\" style=\"display:none;width:100%;padding:12px;margin-top:9px;border:1px solid var(--border-color,#ddd);border-radius:12px;background:transparent;color:var(--text-primary,#111);font-size:14px;\">恢复系统默认字体</button><div style=\"font-size:11px;color:var(--text-secondary,#777);line-height:1.6;margin-top:12px;\">字体仅保存在本应用内，不会上传网络。支持 .ttf 和 .otf，单个文件最大 50 MB。</div></div>';"
            + "document.body.appendChild(o);o.addEventListener('click',function(e){if(e.target===o)o.remove();});document.getElementById('transmission-font-close').onclick=function(){o.remove();};document.getElementById('transmission-font-import').onclick=function(){var b=bridge();if(b)b.chooseFont();};document.getElementById('transmission-font-remove').onclick=function(){var b=bridge();if(b)b.removeFont();};refresh();}"
            + "function addEntry(){var body=document.querySelector('#xiaoshu-settings-hub-modal .xs-settings-body');if(!body||document.getElementById('transmission-font-section'))return;var section=document.createElement('section');section.id='transmission-font-section';section.className='xs-settings-section';section.innerHTML='<div class=\"xs-settings-section-title\">显示与字体</div><div class=\"xs-settings-list\"><button type=\"button\" class=\"xs-settings-row\" id=\"transmission-font-open\"><span class=\"xs-settings-icon\"><i class=\"fas fa-font\"></i></span><span style=\"min-width:0\"><span style=\"display:block;font-weight:700\">自定义字体</span><span id=\"transmission-font-current\" style=\"display:block;font-size:12px;color:var(--text-secondary,#777);margin-top:3px\">系统默认字体</span></span><span>›</span></button></div>';body.appendChild(section);document.getElementById('transmission-font-open').onclick=panel;refresh();}"
            + "new MutationObserver(addEntry).observe(document.documentElement,{childList:true,subtree:true});addEntry();try{var b=bridge();if(b&&b.hasCustomFont())applyFont(true);}catch(e){}"
            + "})();";

    /** Use Android generic aliases so WebView resolves the active system font configuration. */
    private void applySystemFontFamilies(WebSettings settings) {
        settings.setStandardFontFamily("sans-serif");
        settings.setSansSerifFontFamily("sans-serif");
        settings.setSerifFontFamily("serif");
        settings.setFixedFontFamily("monospace");
    }

    /** Keep native system bars in step with the current Android light/dark appearance. */
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

    /** Mirrors Android's font-size/accessibility scaling in the embedded WebView. */
    private int getSystemTextZoom() {
        float scale = getResources().getConfiguration().fontScale;
        int zoom = Math.round(scale * 100f);
        return Math.max(50, Math.min(300, zoom));
    }

    @Override
    protected void onResume() {
        super.onResume();
        applySystemBars();
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            applySystemFontFamilies(settings);
            settings.setTextZoom(getSystemTextZoom());
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FONT_PICKER_REQUEST) {
            if (resultCode == RESULT_OK && data != null) importCustomFont(data.getData());
            return;
        }
        if (requestCode == FILE_CHOOSER_REQUEST && fileChooserCallback != null) {
            fileChooserCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileChooserCallback = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        if (fileChooserCallback != null) { fileChooserCallback.onReceiveValue(null); fileChooserCallback = null; }
        if (webView != null) { webView.stopLoading(); webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
