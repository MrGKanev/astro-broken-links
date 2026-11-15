#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { checkLinks, formatReport } from './checker.js';
import type { DiagnosticCode, Severity } from './types.js';
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, external: { type: 'boolean' }, 'no-anchors': { type: 'boolean' },
    site: { type: 'string' }, base: { type: 'string' }, report: { type: 'string' }, ignore: { type: 'string', multiple: true },
    'trailing-slash': { type: 'string' }, format: { type: 'string' },
    rule: { type: 'string', multiple: true }, baseline: { type: 'string' }, 'update-baseline': { type: 'boolean' },
    'per-host-concurrency': { type: 'string' },
  } });
  if (values.help) console.log('Usage: astro-broken-links [dist] [--site URL] [--base /docs] [--external] [--no-anchors] [--ignore GLOB] [--report file.json] [--format directory|file|preserve] [--trailing-slash always|never|ignore] [--rule code=error|warning] [--baseline file.json] [--update-baseline] [--per-host-concurrency N]');
  else {
    if (positionals.length > 1) throw new Error('Expected at most one build directory');
    const slash = values['trailing-slash'] ?? 'ignore';
    const format = values.format ?? 'directory';
    if (!['always', 'never', 'ignore'].includes(slash)) throw new Error('Invalid --trailing-slash');
    if (!['directory', 'file', 'preserve'].includes(format)) throw new Error('Invalid --format');
    if (values['update-baseline'] && !values.baseline) throw new Error('--update-baseline requires --baseline file.json');
    if (values['per-host-concurrency'] && !values.external) throw new Error('--per-host-concurrency requires --external');
    const rules: Partial<Record<DiagnosticCode, Severity>> = {};
    const codes = ['missing-file', 'missing-anchor', 'trailing-slash', 'invalid-url', 'outside-base', 'redirect-loop', 'http-error', 'network-error'];
    for (const rule of values.rule ?? []) {
      const [code, severity, extra] = rule.split('=');
      if (!codes.includes(code) || !['error', 'warning'].includes(severity) || extra !== undefined) throw new Error(`Invalid --rule ${rule}; expected code=error|warning`);
      rules[code as DiagnosticCode] = severity as Severity;
    }
    const perHost = values['per-host-concurrency'] === undefined ? undefined : Number(values['per-host-concurrency']);
    if (perHost !== undefined && (!Number.isSafeInteger(perHost) || perHost < 1)) throw new Error('--per-host-concurrency must be a positive integer');
    const result = await checkLinks({
      directory: positionals[0] ?? 'dist', site: values.site, base: values.base, report: values.report,
      ignore: values.ignore, external: values.external ? { perHostConcurrency: perHost } : false, anchors: !values['no-anchors'],
      trailingSlash: slash as 'always' | 'never' | 'ignore', format: format as 'directory' | 'file' | 'preserve', rules,
      baseline: values.baseline ? { file: values.baseline, update: values['update-baseline'] } : undefined,
    });
    const lines = formatReport(result);
    for (const line of lines.slice(0, -1)) console.error(line);
    console.log(lines.at(-1));
    process.exitCode = result.summary.newErrors ? 1 : 0;
  }
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; }
