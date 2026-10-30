# Shared sticker deletion guard hardening

This copy contains a narrowly scoped hardening of the shared uploaded-sticker lifecycle.

## What changed

- Wrapped the public `register` API so an image can receive a message sticker ID only while it remains in the current hydrated, visible shared sticker pool.
- Kept the controller's private history-migration registration function unchanged so existing chat history can still be migrated without re-adding deleted images to the shareable pool.
- Added session-scoped deletion tombstones and refreshed them at send/registration boundaries, so another tab using the same origin and browser storage sees deletions even while its in-memory pool is stale.
- Revalidated main-window sends, Chat 2 iframe sends, proactive partner sends, and immediate/delayed automatic sticker replies at the point the message is created.
- Hardened individual deletion, batch deletion, and clear-all uploads so deletion markers are written before the underlying upload list changes. If the browser refuses to persist the marker, the deletion is cancelled rather than leaving another tab able to send the stale item.
- Kept legacy global aliases pointed at the guarded public API methods.

## Checks performed

- `node --test tests/*.js`: 25 tests passed.
- `node --check` on all 7 project JavaScript files: passed.
- Extracted and syntax-checked all 67 executable inline JavaScript blocks in `index.html`: passed. External scripts, data/template blocks, and empty script blocks were excluded from this inline check.

## Verification boundary

The regression tests simulate two tabs sharing `localStorage`, stale in-memory sticker pools, hydration, and the relevant send call paths. A real browser end-to-end run with the app's IndexedDB implementation, two live tabs, iframe interaction, and actual user timing was not available in this environment. The cross-tab tombstone mechanism relies on the tabs sharing the same browser origin and profile storage; it does not create server-side synchronization between independent devices or browser profiles.

The original project files and existing tests are retained. This archive is a local working copy; no changes were pushed to GitHub.
