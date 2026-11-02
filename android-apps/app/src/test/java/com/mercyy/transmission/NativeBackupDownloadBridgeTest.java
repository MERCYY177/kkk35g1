package com.mercyy.transmission;

import static org.junit.Assert.*;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.Test;

public class NativeBackupDownloadBridgeTest {
    @Test public void requestSaveInvokesPickerWithTheExactRequestAndPanel() {
        Harness h = new Harness();
        h.bridge.requestSave("req-1", "panel-a", "backup.zip", "application/zip", 3);
        assertEquals("req-1", h.bridge.activeRequestId());
        assertEquals("panel-a", h.bridge.activePanelId());
        assertEquals("req-1|panel-a|backup.zip|application/zip|3", h.pickerRequests.get(0));
    }

    @Test public void duplicateRequestDoesNotReplaceTheActivePickerRequest() {
        Harness h = new Harness();
        h.bridge.requestSave("req-1", "panel-a", "one.zip", "application/zip", 3);
        h.bridge.requestSave("req-2", "panel-b", "two.zip", "application/zip", 3);
        assertEquals("req-1", h.bridge.activeRequestId());
        assertEquals(1, h.pickerRequests.size());
        assertEquals("req-2:false", h.notifications.get(0));
    }

    @Test public void writeChunkDecodesBase64AndFinishCallsCompletion() {
        Harness h = new Harness();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        h.bridge.requestSave("req-1", "panel-a", "backup.zip", "application/zip", 5);
        assertTrue(h.bridge.attachOutput("req-1", "panel-a", output));
        assertTrue(h.bridge.writeChunk("req-1", "panel-a", Base64.getEncoder().encodeToString(new byte[]{1, 2})));
        assertTrue(h.bridge.writeChunk("req-1", "panel-a", Base64.getEncoder().encodeToString(new byte[]{3, 4, 5})));
        assertTrue(h.bridge.finishSave("req-1", "panel-a"));
        assertArrayEquals(new byte[]{1, 2, 3, 4, 5}, output.toByteArray());
        assertEquals(List.of("req-1|panel-a"), h.completed);
        assertNull(h.bridge.activeRequestId());
    }

    @Test public void wrongPanelCannotWriteFinishOrCancelAnotherPanelRequest() {
        Harness h = new Harness();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        h.bridge.requestSave("req-1", "panel-a", "backup.zip", "application/zip", 1);
        assertTrue(h.bridge.attachOutput("req-1", "panel-a", output));
        String oneByte = Base64.getEncoder().encodeToString(new byte[]{9});
        assertFalse(h.bridge.writeChunk("req-1", "panel-b", oneByte));
        assertFalse(h.bridge.finishSave("req-1", "panel-b"));
        h.bridge.cancelSave("req-1", "panel-b");
        assertEquals("req-1", h.bridge.activeRequestId());
        assertTrue(h.bridge.writeChunk("req-1", "panel-a", oneByte));
        assertTrue(h.bridge.finishSave("req-1", "panel-a"));
    }

    @Test public void malformedBase64CancelsAndNotifiesHostCleanup() {
        Harness h = new Harness();
        TrackingOutput output = new TrackingOutput();
        h.bridge.requestSave("req-1", "panel-a", "backup.zip", "application/zip", 1);
        assertTrue(h.bridge.attachOutput("req-1", "panel-a", output));
        assertFalse(h.bridge.writeChunk("req-1", "panel-a", "%%%"));
        assertTrue(output.closed);
        assertEquals(List.of("req-1|panel-a"), h.cancelled);
        assertNull(h.bridge.activeRequestId());
    }

    @Test public void cancelSaveClosesStreamAndOnlyCleansMatchingRequest() {
        Harness h = new Harness();
        TrackingOutput output = new TrackingOutput();
        h.bridge.requestSave("req-1", "panel-a", "backup.zip", "application/zip", 20);
        assertTrue(h.bridge.attachOutput("req-1", "panel-a", output));
        h.bridge.cancelSave("req-1", "other-panel");
        assertFalse(output.closed);
        h.bridge.cancelSave("req-1", "panel-a");
        assertTrue(output.closed);
        assertEquals(List.of("req-1|panel-a"), h.cancelled);
    }

    @Test public void pickerLaunchFailureResetsSessionAndReportsFailure() {
        Harness h = new Harness();
        h.failPicker = true;
        h.bridge.requestSave("req-1", "panel-a", "backup.zip", "application/zip", 1);
        assertNull(h.bridge.activeRequestId());
        assertEquals(List.of("req-1|panel-a"), h.cancelled);
        assertEquals("req-1:false", h.notifications.get(0));
    }

    @Test public void finishIsAtomicAgainstConcurrentLifecycleCancellation() throws Exception {
        Harness h = new Harness();
        BlockingFlushOutput output = new BlockingFlushOutput();
        h.bridge.requestSave("req-1", "panel-a", "backup.zip", "application/zip", 1);
        assertTrue(h.bridge.attachOutput("req-1", "panel-a", output));
        assertTrue(h.bridge.writeChunk("req-1", "panel-a",
                Base64.getEncoder().encodeToString(new byte[]{7})));

        AtomicBoolean finishResult = new AtomicBoolean(false);
        Thread finish = new Thread(() ->
                finishResult.set(h.bridge.finishSave("req-1", "panel-a")));
        finish.start();
        assertTrue("finish did not reach flush", output.flushEntered.await(2, TimeUnit.SECONDS));

        CountDownLatch cancelStarted = new CountDownLatch(1);
        Thread cancel = new Thread(() -> {
            cancelStarted.countDown();
            h.bridge.cancelSave("req-1", "panel-a");
        });
        cancel.start();
        assertTrue(cancelStarted.await(2, TimeUnit.SECONDS));
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        while (cancel.getState() != Thread.State.BLOCKED && System.nanoTime() < deadline) {
            Thread.yield();
        }
        assertEquals("cancellation must wait for the terminal finish operation",
                Thread.State.BLOCKED, cancel.getState());

        output.allowFlush.countDown();
        finish.join(2000);
        cancel.join(2000);
        assertFalse("finish thread did not terminate", finish.isAlive());
        assertFalse("cancel thread did not terminate", cancel.isAlive());
        assertTrue(finishResult.get());
        assertEquals(List.of("req-1|panel-a"), h.completed);
        assertTrue(h.cancelled.isEmpty());
        assertNull(h.bridge.activeRequestId());
    }

    @Test public void shortWriteAndOverrunAreRejectedThroughTheBridgeMethod() {
        Harness shortWrite = new Harness();
        TrackingOutput shortOutput = new TrackingOutput();
        shortWrite.bridge.requestSave("req-1", "panel-a", "backup.zip", "application/zip", 2);
        assertTrue(shortWrite.bridge.attachOutput("req-1", "panel-a", shortOutput));
        assertTrue(shortWrite.bridge.writeChunk("req-1", "panel-a",
                Base64.getEncoder().encodeToString(new byte[]{1})));
        assertFalse(shortWrite.bridge.finishSave("req-1", "panel-a"));
        assertTrue(shortOutput.closed);

        Harness overrun = new Harness();
        TrackingOutput overrunOutput = new TrackingOutput();
        overrun.bridge.requestSave("req-2", "panel-a", "backup.zip", "application/zip", 1);
        assertTrue(overrun.bridge.attachOutput("req-2", "panel-a", overrunOutput));
        assertFalse(overrun.bridge.writeChunk("req-2", "panel-a",
                Base64.getEncoder().encodeToString(new byte[]{1, 2})));
        assertTrue(overrunOutput.closed);
    }

    private static final class Harness implements NativeBackupDownloadBridge.Host {
        final BackupSaveSession session = new BackupSaveSession();
        final List<String> pickerRequests = new ArrayList<>();
        final List<String> notifications = new ArrayList<>();
        final List<String> completed = new ArrayList<>();
        final List<String> cancelled = new ArrayList<>();
        boolean failPicker;
        final NativeBackupDownloadBridge bridge = new NativeBackupDownloadBridge(session,
                value -> Base64.getDecoder().decode(value), this);

        @Override public void requestPicker(String requestId, String panelId, String name,
                                            String mimeType, long expectedBytes) {
            pickerRequests.add(requestId + "|" + panelId + "|" + name + "|" + mimeType + "|" + expectedBytes);
            if (failPicker) throw new IllegalStateException("injected picker failure");
        }
        @Override public void notifyPicker(String requestId, boolean ok, String message) {
            notifications.add(requestId + ":" + ok);
        }
        @Override public void onCompleted(String requestId, String panelId) {
            completed.add(requestId + "|" + panelId);
        }
        @Override public void onCancelled(String requestId, String panelId) {
            cancelled.add(requestId + "|" + panelId);
        }
    }

    private static final class BlockingFlushOutput extends OutputStream {
        final CountDownLatch flushEntered = new CountDownLatch(1);
        final CountDownLatch allowFlush = new CountDownLatch(1);
        @Override public void write(int value) {}
        @Override public void flush() throws java.io.IOException {
            flushEntered.countDown();
            try {
                if (!allowFlush.await(5, TimeUnit.SECONDS)) {
                    throw new java.io.IOException("timed out waiting to finish flush");
                }
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new java.io.IOException("flush interrupted", error);
            }
        }
    }

    private static final class TrackingOutput extends OutputStream {
        boolean closed;
        @Override public void write(int value) {}
        @Override public void close() { closed = true; }
    }
}
