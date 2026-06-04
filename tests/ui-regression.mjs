import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(html, /id="range-select"/, 'range should be controlled by a select');
assert.match(html, /id="focus-select"/, 'fixed operand should be controlled by a select');
assert.match(html, /id="guide-toggle"/, 'answer guide toggle should be available');
assert.match(html, /id="practice-guide"/, 'game screen should contain an answer guide panel');
assert.match(html, /class="game-shell"/, 'game screen should use a responsive shell');
assert.match(html, /function updateFocusOptions\(/, 'focus options should react to range changes');
assert.match(html, /function renderPracticeGuide\(/, 'guide should render answer rows');
assert.match(html, /function getOperandPair\(/, 'question generator should support a fixed operand');
assert.match(html, /grid-template-columns:\s*minmax\(0,\s*520px\)\s+minmax\(260px,\s*1fr\)/, 'desktop game layout should use the free horizontal space');
