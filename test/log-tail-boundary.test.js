import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLogTail } from '../src/log-tail.js';
const line = (i) => JSON.stringify({ time: new Date(i * 1000).toISOString(), level: 'info', component: 'tray', status: 'ok', code: `C${String(i).padStart(2, '0')}` }) + '\n';
test('log tail keeps a whole line when the read window starts exactly on a line boundary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tail-'));
  try {
    const file = join(dir, 'app.log');
    const lines = Array.from({ length: 10 }, (_, i) => line(i));
    await writeFile(file, lines.join(''));
    const size = lines[0].length;
    const exact = await readLogTail(file, { maxBytes: size * 4 });
    assert.deepEqual(exact.map((e) => e.code), ['C06', 'C07', 'C08', 'C09']);
    const cut = await readLogTail(file, { maxBytes: size * 4 + 1 });
    assert.deepEqual(cut.map((e) => e.code), ['C06', 'C07', 'C08', 'C09']);
    const mid = await readLogTail(file, { maxBytes: size * 4 - 10 });
    assert.deepEqual(mid.map((e) => e.code), ['C07', 'C08', 'C09']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
