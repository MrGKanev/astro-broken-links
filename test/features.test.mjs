import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { checkLinks, formatReport } from '../dist/checker.js';
const exec = promisify(execFile);
async function fixture(t, files) {
  const directory = await mkdtemp(path.join(tmpdir(), 'links-features-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries(files)) { const file = path.join(directory, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, contents); }
  return directory;
}
async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return server.address().port;
}

test('rule severities, default HTTP 429 warnings, and invalid rule results', async t => {
  const port = await serve(t, (_req, res) => { res.writeHead(429); res.end(); });
  const directory = await fixture(t, { 'index.html': `<a href="/missing">internal</a><a href="http://localhost:${port}/rate">rate</a>` });
  const result = await checkLinks({ directory, external: { retries: 0 }, rules: { 'missing-file': 'warning' } });
  assert.deepEqual(result.diagnostics.map(x => x.severity), ['warning', 'warning']);
  assert.equal(result.summary.newErrors, 0); assert.equal(result.summary.newWarnings, 2);
  const strict = await checkLinks({ directory, external: { retries: 0 }, rules: { 'http-error': item => item.status === 429 ? 'error' : 'warning' } });
  assert.equal(strict.summary.newErrors, 2);
  await assert.rejects(checkLinks({ directory, rules: { 'missing-file': () => 'typo' } }), /Invalid severity/);
});

test('per-host concurrency includes cross-host redirects and allows other hosts to progress', async t => {
  const active = new Map(); const peaks = new Map(); let total = 0; let globalPeak = 0;
  let forwardedAuthorization;
  const handler = (req, res) => {
    const hostname = req.headers.host.split(':')[0];
    active.set(hostname, (active.get(hostname) ?? 0) + 1); total++; globalPeak = Math.max(globalPeak, total);
    peaks.set(hostname, Math.max(peaks.get(hostname) ?? 0, active.get(hostname)));
    if (req.url === '/arrived') forwardedAuthorization = req.headers.authorization;
    setTimeout(() => {
      active.set(hostname, active.get(hostname) - 1); total--;
      if (req.url === '/redirect') res.writeHead(302, { location: `http://127.0.0.1:${port}/arrived` });
      else res.writeHead(200);
      res.end();
    }, 20);
  };
  const port = await serve(t, handler);
  const links = [...Array.from({ length: 5 }, (_, i) => `http://localhost:${port}/${i}`), `http://localhost:${port}/redirect`, ...Array.from({ length: 5 }, (_, i) => `http://127.0.0.1:${port}/${i}`)];
  const directory = await fixture(t, { 'index.html': links.map(url => `<a href="${url}">x</a>`).join('') });
  const result = await checkLinks({ directory, external: { concurrency: 6, perHostConcurrency: 1, retries: 0, headers: { authorization: 'test-local-only' } } });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(peaks.get('localhost'), 1); assert.equal(peaks.get('127.0.0.1'), 1); assert.ok(globalPeak >= 2 && globalPeak <= 6);
  assert.equal(result.externalRequests, links.length + 1); assert.equal(forwardedAuthorization, undefined);
  await assert.rejects(checkLinks({ directory, external: { perHostConcurrency: 0 } }), /positive integer/);
});

test('host slots are released after a request times out', async t => {
  const port = await serve(t, (req, res) => { if (req.url === '/ok') res.end(); });
  const directory = await fixture(t, { 'index.html': `<a href="http://localhost:${port}/hang">hang</a><a href="http://localhost:${port}/ok">ok</a>` });
  const result = await checkLinks({ directory, external: { perHostConcurrency: 1, timeout: 100, retries: 0 } });
  assert.equal(result.diagnostics.length, 1); assert.equal(result.diagnostics[0].severity, 'warning'); assert.equal(result.externalRequests, 2);
});

test('dynamic redirect parameters, rest paths, root rest, exact precedence, embedded parameters and cycles', async t => {
  const directory = await fixture(t, {
    'index.html': '<a href="/docs/old/a%20b#ok">a</a><a href="/docs/legacy/nested/page#ok">b</a><a href="/docs/empty/">c</a><a href="/docs/old/special">d</a><a href="/docs/v-12.html">e</a><a href="/docs/cycle/test">f</a><a href="/docs/grow/x">g</a>',
    'new/a b/index.html': '<h1 id="ok">OK</h1>', 'new/nested/page/index.html': '<h1 id="ok">OK</h1>', 'new/index.html': '', 'special.html': '', 'version/12.html': '',
  });
  const redirects = {
    '/old/[slug]': '/docs/new/[slug]/', '/legacy/[...path]': { destination: '/docs/new/[...path]/' },
    '/empty/[...path]': '/docs/new/[...path]', '/old/special': '/docs/special.html', '/v-[id].html': '/docs/version/[id].html',
    '/cycle/[slug]': '/docs/back/[slug]', '/back/[slug]': '/docs/cycle/[slug]', '/grow/[...path]': '/docs/grow/more/[...path]',
  };
  const result = await checkLinks({ directory, base: '/docs', redirects });
  assert.deepEqual(result.diagnostics.map(x => x.code), ['redirect-loop', 'redirect-loop']);
  await assert.rejects(checkLinks({ directory, redirects: { '/old/[slug]': '/new/[missing]' } }), /Unknown destination parameter/);
});

test('baseline survives line movement, detects additional occurrences, and prunes fixed entries on update', async t => {
  const directory = await fixture(t, { 'index.html': '<a href="/one">one</a><a href="/two">two</a>' });
  const baseline = { file: path.join(directory, 'baseline.json') };
  const captured = await checkLinks({ directory, baseline: { ...baseline, update: true } });
  assert.equal(captured.summary.known, 2); assert.equal(captured.summary.newErrors, 0);
  await writeFile(path.join(directory, 'index.html'), '\n\n<a href="/one">one</a><a href="/one">extra one</a><a href="/three">new</a>');
  const result = await checkLinks({ directory, baseline });
  assert.equal(result.summary.known, 1); assert.equal(result.summary.newErrors, 2); assert.equal(result.summary.resolved, 1);
  assert.equal(result.diagnostics[0].known, true); assert.equal(result.diagnostics[1].known, false);
  await checkLinks({ directory, baseline: { ...baseline, update: true } });
  const data = JSON.parse(await readFile(baseline.file, 'utf8'));
  assert.ok(!data.entries.some(x => x.url === '/two'));
  assert.equal(data.entries.find(x => x.url === '/one').count, 2);
  assert.equal((await checkLinks({ directory, baseline })).summary.newErrors, 0);
});

test('baseline cannot hide a severity escalation, missing/corrupt baselines fail, and report stays separate', async t => {
  const directory = await fixture(t, { 'index.html': '<a href="/one">one</a>' });
  const file = path.join(directory, 'baseline.json');
  await assert.rejects(checkLinks({ directory, baseline: { file } }), /Cannot read baseline/);
  await checkLinks({ directory, rules: { 'missing-file': 'warning' }, baseline: { file, update: true } });
  assert.equal((await checkLinks({ directory, baseline: { file } })).summary.newErrors, 1);
  await assert.rejects(checkLinks({ directory, report: file, baseline: { file, update: true } }), /different files/);
  await writeFile(file, '{"version":1,"entries":[{"count":-1}]}');
  await assert.rejects(checkLinks({ directory, baseline: { file } }), /Invalid baseline entry/);
});

test('terminal report groups repeated URLs and preserves every source location in JSON', async t => {
  const directory = await fixture(t, { 'index.html': '<a href="/gone">a</a>\n<a href="/gone">b</a>', 'other.html': '<a href="/gone">c</a>' });
  const result = await checkLinks({ directory });
  const report = formatReport(result).join('\n');
  assert.equal((report.match(/\[error\] \/gone/g) ?? []).length, 1);
  assert.match(report, /\/:1:4/); assert.match(report, /\/:2:4/); assert.match(report, /\/other.html:1:4/);
  assert.equal(result.diagnostics.length, 3); assert.match(report, /3 new errors/);
});

test('CLI supports severity and explicit baseline updates with correct exits', async t => {
  const directory = await fixture(t, { 'index.html': '<a href="/gone">x</a>' });
  const cli = path.resolve('dist/cli.js');
  const baseline = path.join(directory, 'baseline.json');
  const warning = await exec(process.execPath, [cli, directory, '--rule', 'missing-file=warning']);
  assert.match(warning.stdout, /1 new warnings/);
  await exec(process.execPath, [cli, directory, '--baseline', baseline, '--update-baseline']);
  const accepted = await exec(process.execPath, [cli, directory, '--baseline', baseline]); assert.match(accepted.stdout, /1 baseline occurrences/);
  await writeFile(path.join(directory, 'index.html'), '<a href="/new">x</a>');
  await assert.rejects(exec(process.execPath, [cli, directory, '--baseline', baseline]), e => e.code === 1);
  for (const args of [['--update-baseline'], ['--rule', 'typo=error'], ['--rule', 'missing-file=typo'], ['--per-host-concurrency', '0', '--external']]) await assert.rejects(exec(process.execPath, [cli, directory, ...args]), e => e.code === 2);
});

test('regular built pages take precedence over a redirect pattern; refresh stubs follow redirects even with anchors off', async t => {
  const directory = await fixture(t, {
    'index.html': '<a href="/blog/special#ok">special</a><a href="/old#ok">old</a>',
    'blog/special/index.html': '<h1 id="ok">Actual page</h1>',
    'old/index.html': '<meta http-equiv="refresh" content="0;url=/new/">',
    'new/index.html': '<h1 id="ok">New</h1>',
  });
  const redirects = { '/blog/[slug]': '/missing/[slug]', '/old': '/new/' };
  assert.deepEqual((await checkLinks({ directory, redirects })).diagnostics, []);
  assert.deepEqual((await checkLinks({ directory, redirects, anchors: false })).diagnostics, []);
});


test('external HEAD 404 falls back to GET before declaring a URL broken', async t => {
  const methods = [];
  const port = await serve(t, (req, res) => { methods.push(req.method); res.writeHead(req.method === 'HEAD' ? 404 : 200); res.end(); });
  const directory = await fixture(t, { 'index.html': `<a href="http://localhost:${port}/valid">Valid</a>` });
  const result = await checkLinks({ directory, external: { retries: 0 } });
  assert.deepEqual(result.diagnostics, []); assert.deepEqual(methods, ['HEAD', 'GET']); assert.equal(result.externalRequests, 2);
});
