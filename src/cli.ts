#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { checkLinks } from './checker.js';
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, external: { type: 'boolean' }, 'no-anchors': { type: 'boolean' },
    site: { type: 'string' }, base: { type: 'string' }, report: { type: 'string' }, ignore: { type: 'string', multiple: true },
    'trailing-slash': { type: 'string' }, format: { type: 'string' },
  } });
  if (values.help) console.log('Usage: astro-broken-links [dist] [--site URL] [--base /docs] [--external] [--no-anchors] [--ignore GLOB] [--report file.json] [--format directory|file|preserve] [--trailing-slash always|never|ignore]');
  else {
    if (positionals.length > 1) throw new Error('Expected at most one build directory');
    const slash = values['trailing-slash'] ?? 'ignore';
    const format = values.format ?? 'directory';
    if (!['always', 'never', 'ignore'].includes(slash)) throw new Error('Invalid --trailing-slash');
    if (!['directory', 'file', 'preserve'].includes(format)) throw new Error('Invalid --format');
    const result = await checkLinks({ directory: positionals[0] ?? 'dist', site: values.site, base: values.base, report: values.report, ignore: values.ignore, external: values.external, anchors: !values['no-anchors'], trailingSlash: slash as 'always' | 'never' | 'ignore', format: format as 'directory' | 'file' | 'preserve' });
    for (const item of result.diagnostics) console.error(`${item.page}:${item.line}:${item.column} [${item.code}] ${item.url}: ${item.message}`);
    console.log(`${result.pages} pages, ${result.links} references, ${result.diagnostics.length} problems`);
    process.exitCode = result.diagnostics.length ? 1 : 0;
  }
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; }
