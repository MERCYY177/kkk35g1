const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');

// Mailbox-generated letters retain the exact fragments used to compose them.
assert.match(html, /function makeReply\(source\)[\s\S]*?cardFragments:cards/);
assert.match(html, /function makeIncoming\(\)[\s\S]*?cardFragments:cards/);

// Only fragments on arrived/persisted letters are sent to the shared recent-drawn recorder.
const processStart = html.indexOf('async function processDue(sid)');
const processEnd = html.indexOf('function checkDueFresh(', processStart);
assert.notEqual(processStart, -1, 'processDue exists');
assert.notEqual(processEnd, -1, 'processDue boundary exists');
const processDue = html.slice(processStart, processEnd);
assert.match(processDue, /await save\(sid\)/, 'letter state is persisted before recording');
assert.match(processDue, /if\(readySessionId\(sid\)!==sid\|\|mailboxInitializedSessionId!==sid\)return false;arrived\.forEach\(function\(letter\)/,
  'recording occurs only after the active-session guard');
assert.match(processDue, /Array\.isArray\(letter&&letter\.cardFragments\)\?letter\.cardFragments:\[\]/,
  'only cardFragments actually used by each letter are recorded');
assert.match(processDue, /window\.xiaoshuRecordRecentDrawnReply\(fragment\)/,
  'letter cards use the existing shared recent-drawn recorder');
assert.match(html, /window\.xiaoshuRecordRecentDrawnReply\s*=\s*function\(text\)/,
  'shared recent-drawn recorder exists');

console.log('Mailbox recent-drawn regression checks passed (6 assertions).');
