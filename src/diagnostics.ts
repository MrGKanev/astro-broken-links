import { readFile } from 'node:fs/promises';
import { atomicJson } from './utils.js';
import type { CheckOptions, CheckResult, Diagnostic, Finding, Severity } from './types.js';

interface BaselineEntry {
  page: string;
  url: string;
  code: string;
  severity: Severity;
  status?: number;
  count: number;
}
const codes = new Set(['missing-file', 'missing-anchor', 'trailing-slash', 'invalid-url', 'outside-base', 'redirect-loop', 'http-error', 'network-error']);
function identity(entry: Omit<BaselineEntry, 'count'>): string {
  // Locations and wording change as generated HTML moves; occurrence counts still detect extra links.
  return JSON.stringify([entry.page, entry.url, entry.code, entry.severity, entry.status ?? null]);
}
export function classify(finding: Finding, rules: CheckOptions['rules']): Diagnostic {
  const rule = rules?.[finding.code];
  const severity = typeof rule === 'function' ? rule(Object.freeze({ ...finding })) : rule ?? (finding.code === 'network-error' || (finding.code === 'http-error' && finding.status === 429) ? 'warning' : 'error');
  if (severity !== 'error' && severity !== 'warning') throw new TypeError(`Invalid severity for ${finding.code}: expected error or warning`);
  return { ...finding, severity, known: false };
}
export async function applyBaseline(result: CheckResult, options: CheckOptions['baseline']): Promise<void> {
  const remaining = new Map<string, number>();
  if (options && !options.update) {
    let data: unknown;
    try { data = JSON.parse(await readFile(options.file, 'utf8')); }
    catch (error) { throw new Error(`Cannot read baseline ${options.file}. Use baseline.update or --update-baseline to create it.`, { cause: error }); }
    const baseline = data as { version?: unknown; entries?: unknown } | null;
    if (!baseline || baseline.version !== 1 || !Array.isArray(baseline.entries)) throw new TypeError(`Invalid baseline format: ${options.file}`);
    for (const raw of baseline.entries) {
      const entry = raw as BaselineEntry;
      if (!entry || typeof entry.page !== 'string' || typeof entry.url !== 'string' || !codes.has(entry.code) || !['error', 'warning'].includes(entry.severity) || !Number.isSafeInteger(entry.count) || entry.count < 1 || (entry.status !== undefined && (!Number.isInteger(entry.status) || entry.status < 100 || entry.status > 599))) throw new TypeError(`Invalid baseline entry: ${options.file}`);
      const key = identity(entry);
      if (remaining.has(key)) throw new TypeError(`Duplicate baseline entry: ${options.file}`);
      remaining.set(key, entry.count);
    }
  }
  const snapshot = new Map<string, BaselineEntry>();
  for (const item of result.diagnostics) {
    const key = identity(item);
    const allowance = remaining.get(key) ?? 0;
    item.known = Boolean(options?.update) || allowance > 0;
    if (allowance > 0) remaining.set(key, allowance - 1);
    const entry = snapshot.get(key);
    if (entry) entry.count++;
    else snapshot.set(key, { page: item.page, url: item.url, code: item.code, severity: item.severity, ...(item.status === undefined ? {} : { status: item.status }), count: 1 });
    if (item.severity === 'error') { result.summary.errors++; if (!item.known) result.summary.newErrors++; }
    else { result.summary.warnings++; if (!item.known) result.summary.newWarnings++; }
    if (item.known) result.summary.known++;
  }
  result.summary.resolved = [...remaining.values()].reduce((total, count) => total + count, 0);
  if (options?.update) await atomicJson(options.file, { version: 1, entries: [...snapshot.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, entry]) => entry) });
}

/** Group terminal output without dropping any occurrences from the JSON result. */
export function formatReport(result: CheckResult): string[] {
  const groups = new Map<string, Diagnostic[]>();
  for (const item of result.diagnostics) {
    const key = JSON.stringify([item.url, item.code, item.severity, item.message, item.known, item.status]);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const lines: string[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    lines.push(`[${first.severity}${first.known ? ', baseline' : ''}] ${first.url} (${first.code}) — ${first.message}`, '  Found in:');
    for (const item of group) lines.push(`    ${item.page}:${item.line}:${item.column} <${item.tag} ${item.attribute}>`);
  }
  const s = result.summary;
  lines.push(`${result.pages} pages, ${result.links} references — ${result.diagnostics.length} problems: ${s.newErrors} new errors, ${s.newWarnings} new warnings, ${s.known} baseline occurrences.`);
  if (s.resolved) lines.push(`${s.resolved} baseline occurrences resolved. Update the baseline to remove them.`);
  return lines;
}
