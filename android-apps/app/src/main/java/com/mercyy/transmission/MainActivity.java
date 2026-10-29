package com.mercyy.transmission;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

public class MainActivity extends ComponentActivity {
    private static final String HOME_URL = "file:///android_asset/site/index.html";
    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    private static final int FILE_CHOOSER_REQUEST = 4107;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(getColor(android.R.color.black));
        getWindow().setNavigationBarColor(getColor(android.R.color.black));

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

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

        // Use Android's generic system sans-serif family for WebView fallback fonts.
        // The page's CSS prefers "system-ui" and writes its own font stack at runtime,
        // so the app also enforces the system family after each page load below.
        settings.setStandardFontFamily("sans-serif");
        settings.setSansSerifFontFamily("sans-serif");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
                WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            WebSettingsCompat.setForceDark(settings, WebSettingsCompat.FORCE_DARK_AUTO);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                applySystemFontOverride();
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

    /**
     * The site defines system-ui first and re-applies its stored font stack after startup.
     * Force normal UI text to Android's sans-serif family, but preserve Font Awesome icon
     * classes so their glyphs do not turn into missing-character squares.
     */
    private void applySystemFontOverride() {
        if (webView == null) return;
        String js = "(function(){try{"
                + "var id='android-system-font-follow-v1';"
                + "var css=':root{--font-family:sans-serif!important;--message-font-family:sans-serif!important;}"
                + "html body,html body *:not(.fa):not(.fas):not(.far):not(.fab):not(.fa-solid):not(.fa-regular):not(.fa-brands):not(.fa-classic):not([class^='fa-']):not([class*=' fa-']){font-family:sans-serif!important;}';"
                + "var style=document.getElementById(id);"
                + "if(!style){style=document.createElement('style');style.id=id;}"
                + "style.textContent=css;"
                + "(document.head||document.documentElement).appendChild(style);"
                + "document.documentElement.style.setProperty('--font-family','sans-serif','important');"
                + "document.documentElement.style.setProperty('--message-font-family','sans-serif','important');"
                + "}catch(e){}})();";
        webView.evaluateJavascript(js, null);
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
        if (webView != null) {
            webView.getSettings().setTextZoom(getSystemTextZoom());
            applySystemFontOverride();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
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
