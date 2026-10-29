package com.mercyy.transmission;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import java.util.Locale;

public class MainActivity extends ComponentActivity {
    private static final String HOME_URL = "file:///android_asset/site/index.html";
    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    private static final int FILE_CHOOSER_REQUEST = 4107;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(getColor(android.R.color.black));
        getWindow().setNavigationBarColor(getColor(android.R.color.black));
        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));

        Button diagnosticButton = new Button(this);
        diagnosticButton.setText("字体诊断");
        diagnosticButton.setTextSize(12f);
        diagnosticButton.setTextColor(Color.WHITE);
        diagnosticButton.setAllCaps(false);
        diagnosticButton.setMinWidth(0);
        diagnosticButton.setMinimumWidth(0);
        diagnosticButton.setMinHeight(0);
        diagnosticButton.setMinimumHeight(0);
        diagnosticButton.setPadding(dp(12), dp(5), dp(12), dp(5));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.rgb(35, 35, 35));
        bg.setCornerRadius(dp(20));
        bg.setStroke(dp(1), Color.LTGRAY);
        diagnosticButton.setBackground(bg);
        diagnosticButton.setElevation(dp(8));
        FrameLayout.LayoutParams bp = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.END);
        bp.setMargins(dp(8), dp(8), dp(12), dp(24));
        root.addView(diagnosticButton, bp);
        setContentView(root);
        diagnosticButton.setOnClickListener(v -> runFontDiagnostic());

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

        // Diagnostic build: do not force a font; inspect the actual WebView/page configuration.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
                WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            WebSettingsCompat.setForceDark(settings, WebSettingsCompat.FORCE_DARK_AUTO);
        }
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
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
                if (webView != null && webView.canGoBack()) webView.goBack(); else finish();
            }
        });
    }

    private int dp(float v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private String getThemeFontFamily() {
        android.content.res.TypedArray a = obtainStyledAttributes(R.style.AppTheme, new int[]{android.R.attr.fontFamily});
        try {
            TypedValue v = new TypedValue();
            if (a.getValue(0, v)) {
                CharSequence s = v.coerceToString();
                return s == null ? "(未解析)" : s.toString();
            }
            return "(未设置/未解析)";
        } finally { a.recycle(); }
    }

    private void runFontDiagnostic() {
        if (webView == null) return;
        String nativeInfo = String.format(Locale.US,
                "Android SDK=%d；fontScale=%.2f；WebView textZoom=%d%%；AppTheme fontFamily=%s",
                Build.VERSION.SDK_INT, getResources().getConfiguration().fontScale,
                webView.getSettings().getTextZoom(), getThemeFontFamily());
        String escaped = nativeInfo.replace("\\", "\\\\").replace("'", "\\'");
        String js = "(function(){"
          + "var old=document.getElementById('__font_diag_panel');if(old)old.remove();"
          + "var p=document.createElement('div');p.id='__font_diag_panel';"
          + "p.style.cssText='position:fixed;z-index:2147483647;inset:12px 8px;overflow:auto;background:#fff;color:#171717;border:2px solid #333;border-radius:12px;padding:14px;font:14px/1.45 sans-serif;box-shadow:0 4px 30px #0008';"
          + "var c=document.createElement('button');c.textContent='关闭诊断';c.style.cssText='float:right;padding:7px 10px';c.onclick=function(){p.remove()};p.appendChild(c);"
          + "var h=document.createElement('h3');h.textContent='字体诊断（不修改字体）';h.style.cssText='margin:0 0 10px;font:bold 18px sans-serif';p.appendChild(h);"
          + "var info=document.createElement('pre');info.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f2f2;padding:9px;font:12px/1.5 monospace';"
          + "info.textContent='原生信息：'+'" + escaped + "'+'\\n页面 URL：'+location.href+'\\nUser agent：'+navigator.userAgent+'\\nCSS --font-family：'+getComputedStyle(document.documentElement).getPropertyValue('--font-family')+'\\nCSS --message-font-family：'+getComputedStyle(document.documentElement).getPropertyValue('--message-font-family')+'\\nbody computed font-family：'+getComputedStyle(document.body).fontFamily+'\\nbody font-size：'+getComputedStyle(document.body).fontSize;p.appendChild(info);"
          + "var d=document.createElement('p');d.textContent='各行尝试不同 CSS 字体族。请比较字形，并截图整个面板。';p.appendChild(d);"
          + "var ss=[['system-ui','system-ui'],['sans-serif','sans-serif'],['ui-sans-serif','ui-sans-serif'],['serif','serif'],['monospace','monospace'],['页面变量','var(--font-family)']];"
          + "ss.forEach(function(s){var b=document.createElement('div');b.style.cssText='border-top:1px solid #ddd;padding:8px 0';var l=document.createElement('div');l.textContent=s[0]+'；computed='+s[1];l.style.cssText='font:12px monospace;color:#555;margin-bottom:4px';var x=document.createElement('div');x.textContent='字体样本：传讯 你好世界 中文 ABC abc 0123 鬼龙红郎';x.style.cssText='font-family:'+s[1]+' !important;font-size:20px;line-height:1.5';b.appendChild(l);b.appendChild(x);p.appendChild(b)});document.body.appendChild(p)})();";
        webView.evaluateJavascript(js, null);
    }

    private int getSystemTextZoom() {
        int zoom = Math.round(getResources().getConfiguration().fontScale * 100f);
        return Math.max(50, Math.min(300, zoom));
    }
    @Override protected void onResume() {
        super.onResume();
        if (webView != null) webView.getSettings().setTextZoom(getSystemTextZoom());
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && fileChooserCallback != null) {
            fileChooserCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileChooserCallback = null;
        }
    }
    @Override protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }
    @Override protected void onDestroy() {
        if (fileChooserCallback != null) { fileChooserCallback.onReceiveValue(null); fileChooserCallback = null; }
        if (webView != null) { webView.stopLoading(); webView.destroy(); webView = null; }
        super.onDestroy();
    }
}