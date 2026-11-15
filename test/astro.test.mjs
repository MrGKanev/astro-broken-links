import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'astro';
import brokenLinks from '../dist/index.js';

test('real Astro builds: base, file/directory output, redirects, strict failure and report-only mode', async t => {
  const root = await mkdtemp(path.resolve('test/.fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src/pages'), { recursive: true });
  await writeFile(path.join(root, 'src/pages/index.astro'), '<a href="/docs/guide#hello">Guide</a><a href="/docs/old">Old</a>');
  await writeFile(path.join(root, 'src/pages/guide.astro'), '<h1 id="hello">Hello</h1><a href="/docs/">Home</a>');
  for (const format of ['directory', 'file']) {
    const report = path.join(root, `report-${format}.json`);
    await build({ root: pathToFileURL(root + '/'), configFile: false, site: 'https://example.com', base: '/docs', trailingSlash: 'ignore', build: { format }, redirects: { '/old': '/docs/guide' }, integrations: [brokenLinks({ report })], logLevel: 'silent' });
    assert.deepEqual(JSON.parse(await readFile(report, 'utf8')).diagnostics, [], format);
  }
  await writeFile(path.join(root, 'src/pages/index.astro'), '<a href="/docs/missing">Missing</a>');
  const settings = { root: pathToFileURL(root + '/'), configFile: false, base: '/docs', logLevel: 'silent' };
  await assert.rejects(build({ ...settings, integrations: [brokenLinks()] }), /Link validation failed/);
  const report = path.join(root, 'broken.json');
  await build({ ...settings, integrations: [brokenLinks({ failOnError: false, report })] });
  assert.equal(JSON.parse(await readFile(report, 'utf8')).diagnostics[0].code, 'missing-file');
});

test('recognizes on-demand Astro routes without pretending to check their response bodies', async t => {
  const root = await mkdtemp(path.resolve('test/.fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src/pages/api'), { recursive: true });
  await writeFile(path.join(root, 'src/pages/index.astro'), '---\nexport const prerender = true;\n---\n<a href="/docs/api/test">API</a>');
  await writeFile(path.join(root, 'src/pages/api/[slug].ts'), "export const GET = () => new Response('ok');");
  await writeFile(path.join(root, 'entry.mjs'), 'export function createExports() { return { handler() {} }; }');
  const report = path.join(root, 'report.json');
  const adapter = { name: 'fixture-adapter', hooks: { 'astro:config:done': ({ setAdapter }) => setAdapter({ name: 'fixture-adapter', serverEntrypoint: pathToFileURL(path.join(root, 'entry.mjs')), supportedAstroFeatures: { staticOutput: 'stable', serverOutput: 'stable', hybridOutput: 'stable' } }) } };
  await build({ root: pathToFileURL(root + '/'), configFile: false, base: '/docs', output: 'server', adapter, integrations: [brokenLinks({ report })], logLevel: 'silent' });
  const result = JSON.parse(await readFile(report, 'utf8'));
  assert.deepEqual(result.diagnostics, []); assert.equal(result.skipped, 1); assert.equal(result.pages, 1);
});
