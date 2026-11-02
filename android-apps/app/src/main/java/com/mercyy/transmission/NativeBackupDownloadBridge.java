package com.mercyy.transmission;

import android.webkit.JavascriptInterface;

import java.io.OutputStream;

/**
 * Testable JavaScript-facing backup bridge. Android picker, WebView callbacks,
 * Base64 decoding and partial-document cleanup are injected by the Activity.
 */
public final class NativeBackupDownloadBridge {
    interface Decoder {
        byte[] decode(String encoded);
    }

    interface Host {
        void requestPicker(String requestId, String panelId, String name,
                           String mimeType, long expectedBytes);
        void notifyPicker(String requestId, boolean ok, String message);
        void onCompleted(String requestId, String panelId);
        void onCancelled(String requestId, String panelId);
    }

    private final Object lock = new Object();
    private final BackupSaveSession session;
    private final Decoder decoder;
    private final Host host;
    private String requestId;
    private String panelId;

    NativeBackupDownloadBridge(BackupSaveSession session, Decoder decoder, Host host) {
        if (session == null || decoder == null || host == null) throw new IllegalArgumentException("dependencies required");
        this.session = session;
        this.decoder = decoder;
        this.host = host;
    }

    @JavascriptInterface
    public void requestSave(String requestId, String panelId, String name,
                            String mimeType, long expectedBytes) {
        if (!validId(requestId) || !validId(panelId)
                || expectedBytes <= 0 || expectedBytes > 1024L * 1024L * 1024L) {
            notifyPickerResult(requestId, false, "备份文件为空、标识无效或超过 1 GB 的单文件保存上限");
            return;
        }
        synchronized (lock) {
            if (!session.begin(requestId, panelId, expectedBytes)) {
                notifyPickerResult(requestId, false, "已有保存任务正在进行，请完成或取消后再试");
                return;
            }
            this.requestId = requestId;
            this.panelId = panelId;
        }
        try {
            host.requestPicker(requestId, panelId, name, mimeType, expectedBytes);
        } catch (RuntimeException error) {
            cancelSave(requestId, panelId);
            notifyPickerResult(requestId, false, "系统文件保存窗口无法打开");
        }
    }

    @JavascriptInterface
    public boolean writeChunk(String requestId, String panelId, String base64) {
        if (!isActive(requestId, panelId)) return false;
        if (base64 == null || base64.isEmpty() || base64.length() > 43692
                || base64.length() % 4 != 0
                || !base64.matches("[A-Za-z0-9+/]*={0,2}")) {
            cancelSave(requestId, panelId);
            return false;
        }
        try {
            byte[] bytes = decoder.decode(base64);
            if (bytes == null || bytes.length == 0 || bytes.length > BackupSaveSession.MAX_CHUNK_BYTES) {
                cancelSave(requestId, panelId);
                return false;
            }
            boolean written = session.writeChunk(requestId, panelId, bytes);
            if (!written) cancelSave(requestId, panelId);
            return written;
        } catch (IllegalArgumentException error) {
            cancelSave(requestId, panelId);
            return false;
        }
    }

    @JavascriptInterface
    public boolean finishSave(String requestId, String panelId) {
        boolean completed;
        synchronized (lock) {
            if (!matchesLocked(requestId, panelId) || !session.isActive(requestId, panelId)) {
                return false;
            }
            // Serialize the terminal stream operation with cancelSave/onDestroy.
            // Otherwise cancellation can clear the bridge after finish() closes
            // the stream but before this method clears the request identity.
            completed = session.finish(requestId, panelId);
            this.requestId = null;
            this.panelId = null;
        }
        if (completed) host.onCompleted(requestId, panelId);
        else host.onCancelled(requestId, panelId);
        return completed;
    }

    @JavascriptInterface
    public void cancelSave(String requestId, String panelId) {
        synchronized (lock) {
            if (!matchesLocked(requestId, panelId)) return;
            session.cancel(requestId, panelId);
            this.requestId = null;
            this.panelId = null;
        }
        host.onCancelled(requestId, panelId);
    }

    boolean attachOutput(String requestId, String panelId, OutputStream output) {
        return isActive(requestId, panelId) && session.attachOutput(requestId, panelId, output);
    }

    String activeRequestId() {
        synchronized (lock) { return requestId; }
    }

    String activePanelId() {
        synchronized (lock) { return panelId; }
    }

    void notifyPickerResult(String requestId, boolean ok, String message) {
        if (validId(requestId)) host.notifyPicker(requestId, ok, message);
    }

    private boolean isActive(String requestId, String panelId) {
        synchronized (lock) { return matchesLocked(requestId, panelId) && session.isActive(requestId, panelId); }
    }

    private boolean matchesLocked(String requestId, String panelId) {
        return this.requestId != null && this.requestId.equals(requestId)
                && this.panelId != null && this.panelId.equals(panelId);
    }

    private static boolean validId(String value) {
        return value != null && !value.isEmpty() && value.length() <= 128
                && value.matches("[A-Za-z0-9_-]+");
    }
}
