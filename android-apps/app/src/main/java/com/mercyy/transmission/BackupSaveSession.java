package com.mercyy.transmission;

import java.io.IOException;
import java.io.OutputStream;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * One in-flight SAF backup write. Every operation is scoped to both the
 * originating panel and its unique request id.
 */
final class BackupSaveSession {
    private static final Logger LOGGER = Logger.getLogger(BackupSaveSession.class.getName());
    static final int MAX_CHUNK_BYTES = 32 * 1024;

    private String requestId;
    private String panelId;
    private long expectedBytes;
    private long writtenBytes;
    private OutputStream output;

    synchronized boolean begin(String requestId, String panelId, long expectedBytes) {
        if (isActive() || !validId(requestId) || !validId(panelId)
                || expectedBytes <= 0 || expectedBytes > 1024L * 1024L * 1024L) {
            return false;
        }
        this.requestId = requestId;
        this.panelId = panelId;
        this.expectedBytes = expectedBytes;
        this.writtenBytes = 0;
        this.output = null;
        return true;
    }

    synchronized boolean attachOutput(String requestId, String panelId, OutputStream output) {
        if (!matches(requestId, panelId) || this.output != null || output == null) {
            closeQuietly(output);
            return false;
        }
        this.output = output;
        return true;
    }

    synchronized boolean writeChunk(String requestId, String panelId, byte[] bytes) {
        if (!matches(requestId, panelId) || output == null) return false;
        if (bytes == null || bytes.length == 0 || bytes.length > MAX_CHUNK_BYTES
                || writtenBytes + bytes.length > expectedBytes) {
            abortLocked();
            return false;
        }
        try {
            output.write(bytes);
            writtenBytes += bytes.length;
            return true;
        } catch (IOException error) {
            abortLocked();
            return false;
        }
    }

    synchronized boolean finish(String requestId, String panelId) {
        if (!matches(requestId, panelId)) return false;
        if (output == null || writtenBytes != expectedBytes) {
            abortLocked();
            return false;
        }
        try {
            output.flush();
            output.close();
            resetLocked();
            return true;
        } catch (IOException error) {
            abortLocked();
            return false;
        }
    }

    synchronized boolean cancel(String requestId, String panelId) {
        if (!matches(requestId, panelId)) return false;
        abortLocked();
        return true;
    }

    synchronized boolean isActive(String requestId, String panelId) {
        return matches(requestId, panelId);
    }

    synchronized boolean isActive() {
        return requestId != null;
    }

    private boolean matches(String requestId, String panelId) {
        return this.requestId != null && this.requestId.equals(requestId)
                && this.panelId.equals(panelId);
    }

    private static boolean validId(String value) {
        return value != null && !value.isEmpty() && value.length() <= 128
                && value.matches("[A-Za-z0-9_-]+");
    }

    private void abortLocked() {
        closeQuietly(output);
        resetLocked();
    }

    private void resetLocked() {
        requestId = null;
        panelId = null;
        expectedBytes = 0;
        writtenBytes = 0;
        output = null;
    }

    private static void closeQuietly(OutputStream stream) {
        if (stream == null) return;
        try { stream.close(); } catch (IOException error) { LOGGER.log(Level.WARNING, "Failed to close partial backup output", error); }
    }
}
