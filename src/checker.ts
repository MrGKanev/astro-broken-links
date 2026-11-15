import { readdir, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readHtml } from './html.js';
import { checkExternal } from './external.js';
import { atomicJson, glob, pool, positive } from './utils.js';
import type { CheckOptions, CheckResult, Diagnostic, LinkContext } from './types.js';
export type * from './types.js';

export async function checkLinks(options: CheckOptions): Promise<CheckResult> {
  const root = await realpath(options.directory instanceof URL ? fileURLToPath(options.directory) : options.directory);
  const concurrency = positive(options.concurrency, 4, 'concurrency');
  const site = new URL(options.site ?? 'https://astro.local');
  if (!['http:', 'https:'].includes(site.protocol)) throw new TypeError('site must use HTTP or HTTPS');
  const base = '/' + (options.base ?? '/').replace(/^\/+|\/+$/g, '');
  const prefix = base === '/' ? '' : new URL(base, site).pathname;
  const files = new Set<string>();
  const pages: string[] = [];
  const excluded = (file: string) => options.exclude?.some(pattern => glob(pattern, file));
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(path.join(root, directory), { withFileTypes: true });
    for (const entry of entries) {
      const relative = path.posix.join(directory, entry.name);
      if (excluded(relative)) continue;
      if (entry.isDirectory()) await walk(relative);
      else if (entry.isFile()) { files.add(relative); if (relative.endsWith('.html')) pages.push(relative); }
      // Symlinks are deliberately not followed outside the build inventory.
    }
  }
  await walk('');
  pages.sort();
  function pagePath(file: string): string {
    const encoded = file.split('/').map(encodeURIComponent).join('/');
    let pathname = (encoded === 'index.html' || encoded.endsWith('/index.html')) ? encoded.slice(0, -10) : options.format === 'file' ? encoded.slice(0, -5) : encoded;
    if (options.trailingSlash === 'never' && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
    return `${prefix}/${pathname}` || '/';
  }
  const ids = new Map<string, Set<string>>();
  if (options.anchors !== false) await pool(pages, concurrency, async file => { ids.set(file, (await readHtml(path.join(root, file), false)).ids); });
  const result: CheckResult = { pages: pages.length, links: 0, externalRequests: 0, skipped: 0, diagnostics: [] };
  const external = new Map<string, Array<LinkContext & { url: string }>>();
  const redirects = options.redirects ?? {};
  function localFile(pathname: string): string | undefined {
    if (prefix && pathname !== prefix && !pathname.startsWith(prefix + '/')) return;
    let decoded: string;
    try { decoded = decodeURIComponent(pathname.slice(prefix.length)); } catch { return; }
    if (decoded.includes('\0') || decoded.includes('\\')) return;
    const relative = decoded.replace(/^\//, '');
    if (relative.split('/').some(part => part === '..' || part === '.')) return;
    if (files.has(relative)) return relative;
    const clean = relative.replace(/\/$/, '');
    for (const candidate of [clean ? `${clean}/index.html` : 'index.html', `${clean}.html`]) if (files.has(candidate)) return candidate;
  }
  await pool(pages, concurrency, async file => {
    const page = pagePath(file);
    const data = await readHtml(path.join(root, file), true, options.assets !== false);
    const documentUrl = new URL(page, site);
    let baseUrl = documentUrl;
    if (data.base !== undefined) { try { baseUrl = new URL(data.base, documentUrl); } catch { /* Invalid base falls back to document URL, as in a browser. */ } }
    for (const ref of data.references) {
      result.links++;
      const context: LinkContext = { page, tag: ref.tag, attribute: ref.attribute, line: ref.line, column: ref.column };
      const add = (code: Diagnostic['code'], message: string) => result.diagnostics.push({ ...context, url: ref.url, code, message });
      const ignored = (url: string) => options.ignore?.some(rule => {
        if (typeof rule === 'string') return glob(rule, url);
        if (typeof rule === 'function') return rule(url, context);
        rule.lastIndex = 0; return rule.test(url);
      });
      if (ignored(ref.url)) { result.skipped++; continue; }
      let url: URL;
      try { url = new URL(ref.url, baseUrl); } catch { add('invalid-url', 'Cannot resolve URL'); continue; }
      if (!['http:', 'https:'].includes(url.protocol)) { result.skipped++; continue; }
      if (ignored(url.href) || ignored(url.pathname)) { result.skipped++; continue; }
      if (url.origin !== site.origin) {
        if (!options.external) { result.skipped++; continue; }
        url.hash = '';
        const occurrences = external.get(url.href) ?? [];
        occurrences.push({ ...context, url: ref.url }); external.set(url.href, occurrences);
        continue;
      }
      const visited = new Set<string>();
      let loop = false;
      while (true) {
        const key = prefix && url.pathname.startsWith(prefix + '/') ? url.pathname.slice(prefix.length) : url.pathname;
        const redirect = redirects[key] ?? redirects[url.pathname];
        if (!redirect) break;
        if (visited.has(url.pathname) || visited.size >= 20) { add('redirect-loop', 'Redirect cycle or chain longer than 20 hops'); loop = true; break; }
        visited.add(url.pathname);
        const destination = typeof redirect === 'string' ? redirect : redirect.destination;
        try {
          const previous = url;
          url = new URL(destination, url);
          if (!destination.includes('#')) url.hash = previous.hash;
        } catch { add('invalid-url', 'Invalid redirect destination'); loop = true; break; }
        if (url.origin !== site.origin) break;
      }
      if (loop) continue;
      if (url.origin !== site.origin) {
        if (options.external) {
          url.hash = ''; const occurrences = external.get(url.href) ?? [];
          occurrences.push({ ...context, url: ref.url }); external.set(url.href, occurrences);
        } else result.skipped++;
        continue;
      }
      if (prefix && url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) { add('outside-base', `URL is outside the configured base ${prefix}/`); continue; }
      const target = localFile(url.pathname);
      if (!target) {
        const pathname = url.pathname.slice(prefix.length) || '/';
        if (options.dynamicRoutes?.some(pattern => { pattern.lastIndex = 0; return pattern.test(pathname); })) { result.skipped++; continue; }
        add('missing-file', `No built file for ${url.pathname}`); continue;
      }
      if (ref.navigation && target.endsWith('.html') && !url.pathname.endsWith('.html') && url.pathname !== '/') {
        if (options.trailingSlash === 'always' && !url.pathname.endsWith('/')) add('trailing-slash', 'Page URL must end with /');
        if (options.trailingSlash === 'never' && url.pathname.endsWith('/')) add('trailing-slash', 'Page URL must not end with /');
      }
      if (options.anchors !== false && ref.navigation && target.endsWith('.html') && url.hash && url.hash !== '#') {
        let fragment: string;
        try { fragment = decodeURIComponent(url.hash.slice(1).split(':~:text=')[0]); } catch { add('invalid-url', 'Malformed fragment encoding'); continue; }
        if (fragment && !ids.get(target)?.has(fragment) && !(fragment.toLowerCase() === 'top' && !ids.get(target)?.has('top'))) add('missing-anchor', `No anchor #${fragment} in ${url.pathname}`);
      }
    }
  });
  if (options.external) result.externalRequests = await checkExternal(external.keys(), typeof options.external === 'object' ? options.external : {}, (url, response) => {
    if (response.code) for (const context of external.get(url)!) result.diagnostics.push({ ...context, code: response.code, message: response.message, status: response.status });
  });
  result.diagnostics.sort((a, b) => a.page.localeCompare(b.page) || a.line - b.line || a.column - b.column || a.url.localeCompare(b.url) || a.code.localeCompare(b.code));
  if (options.report) await atomicJson(options.report, result);
  return result;
}
