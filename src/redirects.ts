import type { CheckOptions } from './types.js';

interface Route { pattern: RegExp; destination: string; names: string[]; rank: number[]; key: string }
const token = /\[(\.\.\.)?([A-Za-z_$][\w$]*)\]/g;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Compile Astro-style route parameters once, preserving URL-encoded captures during substitution. */
export function redirectMatcher(redirects: CheckOptions['redirects']): (pathname: string) => string | undefined {
  const routes: Route[] = [];
  for (const [key, value] of Object.entries(redirects ?? {})) {
    if (!key.startsWith('/') || key.startsWith('//') || /[?#]/.test(key)) throw new TypeError(`Invalid redirect route: ${key}`);
    const names: string[] = [];
    const rank: number[] = [];
    let source = '^';
    for (const segment of key.replace(/\/$/, '').split('/').slice(1)) {
      const rest = /^\[\.\.\.([A-Za-z_$][\w$]*)\]$/.exec(segment);
      if (rest) { names.push(rest[1]); rank.push(0); source += '(?:/(.*?))?'; continue; }
      const parts = [...segment.matchAll(token)];
      rank.push(parts.length ? (segment.replace(token, '').length ? 2 : 1) : 3);
      source += '/';
      let offset = 0;
      for (const part of parts) {
        if (part[1]) throw new TypeError(`Rest parameters must occupy a whole path segment: ${key}`);
        source += escape(encodeURI(segment.slice(offset, part.index))) + '([^/]+?)';
        names.push(part[2]); offset = part.index! + part[0].length;
      }
      source += escape(encodeURI(segment.slice(offset)));
    }
    if (new Set(names).size !== names.length) throw new TypeError(`Duplicate redirect parameter: ${key}`);
    const destination = typeof value === 'string' ? value : value.destination;
    for (const part of destination.matchAll(token)) if (!names.includes(part[2])) throw new TypeError(`Unknown destination parameter ${part[2]} in redirect ${key}`);
    routes.push({ key, pattern: new RegExp(source + '/?$'), names, rank, destination });
  }
  routes.sort((a, b) => {
    for (let i = 0; i < Math.max(a.rank.length, b.rank.length); i++) {
      const difference = (b.rank[i] ?? 4) - (a.rank[i] ?? 4);
      if (difference) return difference;
    }
    return a.key.localeCompare(b.key);
  });
  return pathname => {
    for (const route of routes) {
      const match = route.pattern.exec(pathname);
      if (!match) continue;
      const params = new Map(route.names.map((name, index) => [name, match[index + 1] ?? '']));
      return route.destination.replace(token, (_, _rest: string, name: string) => params.get(name)!);
    }
  };
}
