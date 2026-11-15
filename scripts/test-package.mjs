import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), 'astro-links-package-'));
const run = (command, args, cwd) => exec(command, args, { cwd, maxBuffer: 4 * 1024 * 1024 });
try {
  // npm pack runs prepack, exactly as publication does. Consumers receive compiled files.
  const packed = await run('npm', ['pack', '--json', '--pack-destination', temporary], root);
  const [archive] = JSON.parse(packed.stdout);
  const files = new Set(archive.files.map(file => file.path));
  for (const name of ['dist/index.js', 'dist/index.d.ts', 'dist/checker.js', 'dist/checker.d.ts', 'dist/cli.js', 'LICENSE', 'README.md']) assert.ok(files.has(name), `Missing package file: ${name}`);
  assert.ok(archive.files.every(file => !/^(?:src|test|scripts|node_modules|\.github)\//.test(file.path)), 'Development files leaked into package');

  for (const manager of ['npm', 'pnpm']) {
    const project = path.join(temporary, manager);
    await mkdir(path.join(project, 'site'), { recursive: true });
    await writeFile(path.join(project, 'package.json'), JSON.stringify({ name: `package-test-${manager}`, private: true, type: 'module' }));
    const tarball = path.join(temporary, archive.filename);
    await run(manager, manager === 'npm' ? ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball] : ['add', '--ignore-scripts', tarball], project);
    const manifest = JSON.parse(await readFile(path.join(project, 'node_modules/astro-broken-links/package.json'), 'utf8'));
    assert.equal(manifest.name, 'astro-broken-links');
    assert.ok(!manifest.scripts?.install && !manifest.scripts?.postinstall, 'Consumers must not need install scripts');
    await writeFile(path.join(project, 'site/index.html'), '<a href="#ok">OK</a><h1 id="ok">OK</h1>');
    await run(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import integration from 'astro-broken-links';
      import { checkLinks } from 'astro-broken-links/checker';
      assert.equal(integration().name, 'astro-broken-links');
      assert.deepEqual((await checkLinks({ directory: 'site' })).diagnostics, []);
    `], project);
    const cli = manager === 'npm' ? ['exec', '--offline', '--', 'astro-broken-links', 'site'] : ['exec', 'astro-broken-links', 'site'];
    const result = await run(manager, cli, project);
    assert.match(result.stdout, /0 problems/);
    await writeFile(path.join(project, 'site/index.html'), '<a href="/missing">Broken</a>');
    await assert.rejects(run(manager, cli, project), error => error.code === 1 && error.stderr.includes('missing-file'));
    console.log(`${manager}: packaged imports and CLI passed, with install scripts disabled`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
