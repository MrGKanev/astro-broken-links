import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { checkLinks } from '../dist/checker.js';
const root = await mkdtemp(path.join(tmpdir(), 'links-stress-'));
try {
  const count = 3600;
  for (let i = 0; i < count; i++) {
    await mkdir(path.join(root, String(i)));
    const links = Array.from({ length: 110 }, (_, n) => `<a href="/${(i + n) % count}/#heading">page</a>`).join('');
    await writeFile(path.join(root, String(i), 'index.html'), `<h1 id="heading">Hi</h1>${links}`);
  }
  const start = performance.now();
  const result = await checkLinks({ directory: root });
  assert.equal(result.pages, count); assert.equal(result.links, count * 110); assert.equal(result.diagnostics.length, 0);
  console.log(JSON.stringify({ pages: result.pages, references: result.links, seconds: ((performance.now() - start) / 1000).toFixed(2), maxRssMiB: (process.resourceUsage().maxRSS / 1024).toFixed(1), heapLimitMiB: 128 }));
} finally { await rm(root, { recursive: true, force: true }); }
