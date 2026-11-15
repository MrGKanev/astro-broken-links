import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { checkLinks } from '../dist/checker.js';
const exec = promisify(execFile);
async function fixture(t, files) {
  const directory = await mkdtemp(path.join(tmpdir(), 'link-audit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) { await mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await writeFile(path.join(directory, name), content); }
  return directory;
}

test('resolves base, relative URLs, same-origin absolute URLs, entities, queries and fragments', async t => {
  const directory = await fixture(t, {
    'index.html': '<a href="/docs/guide/#hello%20world">guide</a><a href="https://example.com/docs/guide/?a=1&amp;b=2#old">absolute</a><img src="/docs/logo.svg?v=2">',
    'guide/index.html': '<h2 id="hello world">Hi</h2><a name="old"></a><a href="../">Home</a><a href="#top">top</a><a href="#:~:text=Hi">text</a>',
    'logo.svg': '<svg/>',
  });
  const result = await checkLinks({ directory, site: 'https://example.com', base: '/docs/' });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.pages, 2);
});

test('reports every broken occurrence with attribute positions and specific reasons', async t => {
  const directory = await fixture(t, { 'index.html': '<a href="/missing">one</a>\n<a href="/missing">two</a>\n<a href="/guide/#absent">anchor</a>\n<a href="http://[bad">bad</a>', 'guide/index.html': '<h1 id="exists">Hi</h1>' });
  const { diagnostics } = await checkLinks({ directory });
  assert.deepEqual(diagnostics.map(x => x.code), ['missing-file', 'missing-file', 'missing-anchor', 'invalid-url']);
  assert.deepEqual(diagnostics.map(x => x.line), [1, 2, 3, 4]);
  assert.equal(diagnostics[0].column, 4);
});

test('supports exact/glob/regexp/predicate ignores, page excludes, offline default', async t => {
  const directory = await fixture(t, { 'index.html': '<a href="/sbom.spdx">a</a><img src="/.netlify/images?url=x"><a href="/skip-me">s</a><a href="/conditional">c</a><a href="https://never.invalid">e</a>', 'draft/index.html': '<a href="/bad">bad</a>' });
  const result = await checkLinks({ directory, exclude: ['draft/**'], ignore: ['/sbom.spdx', '/.netlify/**', /^\/skip/g, (url, ctx) => url === '/conditional' && ctx.tag === 'a'] });
  assert.deepEqual(result.diagnostics, []); assert.equal(result.pages, 1); assert.equal(result.skipped, 5); assert.equal(result.externalRequests, 0);
});

test('only applies trailingSlash to navigation to HTML pages, with both output formats', async t => {
  const directory = await fixture(t, { 'index.html': '<a href="/guide">a</a><a href="/guide/">b</a><img src="/logo.svg"><a href="/feed.xml">feed</a>', 'guide.html': '', 'logo.svg': '', 'feed.xml': '' });
  for (const trailingSlash of ['always', 'never']) {
    const result = await checkLinks({ directory, format: 'file', trailingSlash });
    assert.equal(result.diagnostics.length, 1); assert.equal(result.diagnostics[0].code, 'trailing-slash');
  }
});

test('redirect chains, fragments, cycles, dynamic routes and base segment boundaries', async t => {
  const directory = await fixture(t, { 'index.html': '<a href="/docs/old#ok">a</a><a href="/docs/loop">b</a><a href="/docs/api/test">c</a><a href="/docs-other/x">d</a>', 'new/index.html': '<h1 id="ok">ok</h1>' });
  const result = await checkLinks({ directory, base: '/docs', redirects: { '/old': '/docs/middle', '/middle': { destination: '/docs/new/' }, '/loop': '/docs/loop' }, dynamicRoutes: [/^\/api\/.+$/] });
  assert.deepEqual(result.diagnostics.map(x => x.code), ['redirect-loop', 'outside-base']);
  assert.equal(result.skipped, 1);
});

test('HTML base, encoded filenames, raw-text/comments, assets and srcset data URLs', async t => {
  const directory = await fixture(t, { 'index.html': '<base href="/nested/"><!-- <a href="/fake"> --><script>const x = `<a href="/fake">`;</script><a href="caf%C3%A9.html#id">a</a><img srcset="data:image/png;base64,AAAA 1x, /two.png 2x"><video poster="/two.png"><source src="/two.png"></video><link href="/two.png">', 'nested/café.html': '<p id="id">a</p>', 'two.png': '' });
  assert.deepEqual((await checkLinks({ directory })).diagnostics, []);
});

test('asset and anchor checks can be disabled; reports are deterministic and overwritten', async t => {
  const directory = await fixture(t, { 'index.html': '<a href="#missing">a</a><img src="/missing.png">' });
  const report = path.join(directory, 'report.json');
  await checkLinks({ directory, report });
  const result = await checkLinks({ directory, report, anchors: false, assets: false });
  assert.deepEqual(result.diagnostics, []); assert.deepEqual(JSON.parse(await readFile(report, 'utf8')), result);
});

test('external deduplication, GET fallback, retries, redirects, bounded concurrency and TTL cache', async t => {
  const hits = new Map(); let active = 0; let peak = 0;
  const server = createServer((req, res) => {
    const key = req.method + ' ' + req.url; hits.set(key, (hits.get(key) ?? 0) + 1); active++; peak = Math.max(peak, active);
    setTimeout(() => {
      active--;
      if (req.url === '/fallback' && req.method === 'HEAD') res.writeHead(405);
      else if (req.url === '/retry' && hits.get(key) === 1) res.writeHead(503);
      else if (req.url === '/redirect') res.writeHead(302, { location: '/ok' });
      else if (req.url === '/bad') res.writeHead(404);
      else res.writeHead(200);
      res.end();
    }, 10);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const directory = await fixture(t, { 'index.html': ['/ok#one', '/ok#two', '/fallback', '/retry', '/redirect', '/bad'].map(x => `<a href="${origin}${x}">x</a>`).join(''), 'other.html': `<a href="${origin}/ok">x</a>` });
  const cache = { file: path.join(directory, 'cache.json'), ttl: 10000 };
  const options = { directory, external: { concurrency: 2, retries: 1, retryDelay: 1, cache } };
  const first = await checkLinks(options);
  assert.equal(hits.get('HEAD /ok'), 2); // One direct request and one HTTP redirect.
  assert.equal(hits.get('GET /fallback'), 1); assert.equal(hits.get('HEAD /retry'), 2);
  assert.equal(first.diagnostics.length, 1); assert.equal(first.diagnostics[0].status, 404); assert.ok(peak <= 2);
  const second = await checkLinks(options); assert.equal(second.externalRequests, 2); assert.equal(second.diagnostics.length, 1);
  const data = JSON.parse(await readFile(cache.file, 'utf8'));
  for (const entry of Object.values(data.entries)) entry.checked = 0;
  await writeFile(cache.file, JSON.stringify(data));
  assert.ok((await checkLinks(options)).externalRequests > 1);
});

test('timeouts produce network diagnostics and corrupt cache is recovered', async t => {
  const server = createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const directory = await fixture(t, { 'index.html': `<a href="http://127.0.0.1:${server.address().port}">a</a>`, 'cache.json': '{bad' });
  const result = await checkLinks({ directory, external: { timeout: 25, retries: 0, cache: { file: path.join(directory, 'cache.json') } } });
  assert.equal(result.diagnostics[0].code, 'network-error');
});

test('validates options and CLI exit codes', async t => {
  const directory = await fixture(t, { 'index.html': '<a href="/missing">x</a>' });
  await assert.rejects(checkLinks({ directory, concurrency: 0 }), /positive integer/);
  const cli = path.resolve('dist/cli.js');
  const help = await exec(process.execPath, [cli, '--help']); assert.match(help.stdout, /Usage:/);
  await assert.rejects(exec(process.execPath, [cli, directory]), error => error.code === 1 && error.stderr.includes('missing-file'));
  await assert.rejects(exec(process.execPath, [cli, '--format', 'invalid']), error => error.code === 2);
});

test('keeps legacy name alongside id and handles text fragments and non-HTTP protocols', async t => {
  const directory = await fixture(t, { 'index.html': '<a id="modern" name="legacy"></a><a href="#legacy">old</a><a href="#modern:~:text=hello">text</a><a href="mailto:hi@example.com">mail</a><a href="tel:123">tel</a><a href="javascript:void(0)">js</a>' });
  const result = await checkLinks({ directory });
  assert.deepEqual(result.diagnostics, []); assert.equal(result.skipped, 3);
});

test('does not follow build symlinks and does not retain results across calls', async t => {
  const { symlink } = await import('node:fs/promises');
  const directory = await fixture(t, { 'index.html': '<a href="/linked.html">link</a>', 'target.html': '' });
  await symlink(path.join(directory, 'target.html'), path.join(directory, 'linked.html'));
  assert.equal((await checkLinks({ directory })).diagnostics.length, 1);
  await writeFile(path.join(directory, 'index.html'), '<a href="/target.html">target</a>');
  assert.deepEqual((await checkLinks({ directory })).diagnostics, []);
});

test('supports Unicode deployment bases and filenames', async t => {
  const directory = await fixture(t, { 'index.html': '<a href="/документи/страница/#раздел">БГ</a>', 'страница/index.html': '<h1 id="раздел">БГ</h1><a href="../">Начало</a>' });
  assert.deepEqual((await checkLinks({ directory, base: '/документи' })).diagnostics, []);
});
