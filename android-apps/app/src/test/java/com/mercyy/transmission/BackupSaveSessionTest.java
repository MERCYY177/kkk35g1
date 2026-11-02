package com.mercyy.transmission;

import static org.junit.Assert.*;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import org.junit.Test;

public class BackupSaveSessionTest {
    @Test public void writesMultipleChunksInOrderAndFinishesOnlyAtExactLength() {
        BackupSaveSession session = new BackupSaveSession();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        assertTrue(session.begin("r1", "panel-a", 5));
        assertTrue(session.attachOutput("r1", "panel-a", output));
        assertTrue(session.writeChunk("r1", "panel-a", new byte[]{1, 2}));
        assertTrue(session.writeChunk("r1", "panel-a", new byte[]{3, 4, 5}));
        assertTrue(session.finish("r1", "panel-a"));
        assertArrayEquals(new byte[]{1, 2, 3, 4, 5}, output.toByteArray());
        assertFalse(session.isActive());
    }

    @Test public void rejectsDuplicateRequestsWithoutReplacingTheActiveRequest() {
        BackupSaveSession session = new BackupSaveSession();
        assertTrue(session.begin("r1", "panel-a", 1));
        assertFalse(session.begin("r2", "panel-b", 1));
        assertTrue(session.isActive("r1", "panel-a"));
        assertFalse(session.isActive("r2", "panel-b"));
    }

    @Test public void panelAndRequestIdsAreBothRequiredForEveryOperation() {
        BackupSaveSession session = new BackupSaveSession();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        assertTrue(session.begin("r1", "panel-a", 1));
        assertTrue(session.attachOutput("r1", "panel-a", output));
        assertFalse(session.writeChunk("r1", "panel-b", new byte[]{7}));
        assertFalse(session.finish("r1", "panel-b"));
        assertFalse(session.cancel("r1", "panel-b"));
        assertTrue(session.isActive("r1", "panel-a"));
        assertTrue(session.writeChunk("r1", "panel-a", new byte[]{7}));
        assertTrue(session.finish("r1", "panel-a"));
    }

    @Test public void rejectsOversizedChunkAndClosesThePartialOutput() {
        BackupSaveSession session = new BackupSaveSession();
        TrackingOutputStream output = new TrackingOutputStream();
        assertTrue(session.begin("r1", "panel-a", BackupSaveSession.MAX_CHUNK_BYTES + 1L));
        assertTrue(session.attachOutput("r1", "panel-a", output));
        assertFalse(session.writeChunk("r1", "panel-a",
                new byte[BackupSaveSession.MAX_CHUNK_BYTES + 1]));
        assertTrue(output.closed);
        assertFalse(session.isActive());
    }

    @Test public void byteOverrunAndShortFinishBothAbortAndClose() {
        BackupSaveSession overrun = new BackupSaveSession();
        TrackingOutputStream first = new TrackingOutputStream();
        assertTrue(overrun.begin("r1", "panel-a", 1));
        assertTrue(overrun.attachOutput("r1", "panel-a", first));
        assertFalse(overrun.writeChunk("r1", "panel-a", new byte[]{1, 2}));
        assertTrue(first.closed);
        assertFalse(overrun.isActive());

        BackupSaveSession shortWrite = new BackupSaveSession();
        TrackingOutputStream second = new TrackingOutputStream();
        assertTrue(shortWrite.begin("r2", "panel-a", 2));
        assertTrue(shortWrite.attachOutput("r2", "panel-a", second));
        assertTrue(shortWrite.writeChunk("r2", "panel-a", new byte[]{1}));
        assertFalse(shortWrite.finish("r2", "panel-a"));
        assertTrue(second.closed);
        assertFalse(shortWrite.isActive());
    }

    @Test public void writeAndFlushFailuresAbortTheSession() {
        BackupSaveSession writeFailure = new BackupSaveSession();
        TrackingOutputStream brokenWrite = new TrackingOutputStream();
        brokenWrite.failWrite = true;
        assertTrue(writeFailure.begin("r1", "panel-a", 1));
        assertTrue(writeFailure.attachOutput("r1", "panel-a", brokenWrite));
        assertFalse(writeFailure.writeChunk("r1", "panel-a", new byte[]{1}));
        assertTrue(brokenWrite.closed);
        assertFalse(writeFailure.isActive());

        BackupSaveSession flushFailure = new BackupSaveSession();
        TrackingOutputStream brokenFlush = new TrackingOutputStream();
        brokenFlush.failFlush = true;
        assertTrue(flushFailure.begin("r2", "panel-a", 1));
        assertTrue(flushFailure.attachOutput("r2", "panel-a", brokenFlush));
        assertTrue(flushFailure.writeChunk("r2", "panel-a", new byte[]{1}));
        assertFalse(flushFailure.finish("r2", "panel-a"));
        assertTrue(brokenFlush.closed);
        assertFalse(flushFailure.isActive());
    }

    @Test public void cancellationClosesAndResetsOnlyTheMatchingRequest() {
        BackupSaveSession session = new BackupSaveSession();
        TrackingOutputStream output = new TrackingOutputStream();
        assertTrue(session.begin("r1", "panel-a", 100));
        assertTrue(session.attachOutput("r1", "panel-a", output));
        assertFalse(session.cancel("r1", "panel-b"));
        assertTrue(session.cancel("r1", "panel-a"));
        assertTrue(output.closed);
        assertFalse(session.isActive());
    }

    private static final class TrackingOutputStream extends OutputStream {
        boolean closed;
        boolean failWrite;
        boolean failFlush;

        @Override public void write(int value) throws IOException {
            if (failWrite) throw new IOException("injected write failure");
        }

        @Override public void write(byte[] bytes) throws IOException {
            if (failWrite) throw new IOException("injected write failure");
        }

        @Override public void flush() throws IOException {
            if (failFlush) throw new IOException("injected flush failure");
        }

        @Override public void close() {
            closed = true;
        }
    }
}
