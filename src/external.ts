import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { atomicJson, pool, positive } from './utils.js';
import type { ExternalOptions } from './types.js';
export interface HttpResult { code?: 'http-error' | 'network-error'; message: string; status?: number }
type Cache = Record<string, { checked: number; status: number }>;

export async function checkExternal(urls: Iterable<string>, options: ExternalOptions, receive: (url: string, result: HttpResult) => void): Promise<number> {
  const concurrency = positive(options.concurrency, 8, 'external.concurrency');
  const timeout = positive(options.timeout, 10000, 'external.timeout');
  const retries = options.retries ?? 2;
  if (!Number.isSafeInteger(retries) || retries < 0 || retries > 10) throw new TypeError('external.retries must be an integer from 0 to 10');
  const retryDelay = positive(options.retryDelay, 250, 'external.retryDelay');
  const ttl = positive(options.cache ? options.cache.ttl : undefined, 86400000, 'external.cache.ttl');
  let cache: Cache = Object.create(null);
  if (options.cache) {
    try {
      const data = JSON.parse(await readFile(options.cache.file, 'utf8'));
      if (data && data.version === 1 && data.entries && typeof data.entries === 'object' && !Array.isArray(data.entries)) {
        for (const [url, raw] of Object.entries(data.entries)) {
          const entry = raw as Cache[string];
          if (entry && Number.isFinite(entry.checked) && entry.checked <= Date.now() && Date.now() - entry.checked < ttl && Number.isInteger(entry.status) && entry.status >= 200 && entry.status < 400) cache[url] = entry;
        }
      }
    } catch (error) {
      if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  let requests = 0;
  await pool(urls, concurrency, async url => {
    if (Object.hasOwn(cache, url)) { receive(url, { status: cache[url].status, message: 'Cached' }); return; }
    let result: HttpResult = { code: 'network-error', message: 'Request failed' };
    for (let attempt = 0; attempt <= retries; attempt++) {
      let retryAfter = 0;
      try {
        const request = async (method: string) => {
          requests++;
          const response = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(timeout), headers: { 'user-agent': 'astro-broken-links/0.1', ...options.headers } });
          // Never buffer response bodies, including the GET fallback.
          await response.body?.cancel();
          return response;
        };
        let response = await request('HEAD');
        if ([403, 405, 501].includes(response.status)) response = await request('GET');
        result = { status: response.status, message: `HTTP ${response.status}`, ...(response.ok ? {} : { code: 'http-error' as const }) };
        if (response.ok) { cache[url] = { status: response.status, checked: Date.now() }; break; }
        if (![408, 429, 500, 502, 503, 504].includes(response.status)) break;
        const after = response.headers.get('retry-after');
        if (after) retryAfter = Math.max(0, /^\d+$/.test(after) ? Number(after) * 1000 : Date.parse(after) - Date.now());
      } catch (error) { result = { code: 'network-error', message: error instanceof Error ? error.message : String(error) }; }
      if (attempt < retries) await delay(Math.min(30000, Math.max(retryAfter || 0, retryDelay * 2 ** attempt)));
    }
    receive(url, result);
  });
  if (options.cache) await atomicJson(options.cache.file, { version: 1, entries: cache });
  return requests;
}
