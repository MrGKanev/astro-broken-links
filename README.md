# astro-broken-links

Validate links, fragments and assets in your finished Astro build. Get exact HTML locations, deterministic JSON reports and a failing CI build when something breaks.

## Install

Install in your Astro project with npm:

```sh
npm install astro-broken-links
```

Or with pnpm:

```sh
pnpm add astro-broken-links
```

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import brokenLinks from 'astro-broken-links';

export default defineConfig({
  integrations: [brokenLinks()],
});
```

Place the integration after integrations that modify generated HTML. It runs at `astro:build:done` and reads Astro's final `site`, `base`, `build.format`, `trailingSlash` and redirects configuration.

Node.js 22+ and Astro 5, 6 or 7. The installed Astro version can require a newer Node release; use Node 22.23.4+ for the development toolchain.

## Configuration

```js
brokenLinks({
  failOnError: true,
  anchors: true,
  assets: true,
  concurrency: 4,
  ignore: [
    '/sbom.spdx',               // Generated later in CI
    '/.netlify/images**',        // A deployed image service
    /^https:\/\/private\.example\//,
    (url, context) => context.tag === 'a' && url === '/account',
  ],
  exclude: ['drafts/**'],
  report: '.link-audit/report.json',
  external: {
    concurrency: 8,
    timeout: 10000,
    retries: 2,
    retryDelay: 250,
    cache: { file: '.link-audit/external.json', ttl: 86400000 },
  },
})
```

| Option | Default | Behavior |
| --- | --- | --- |
| `failOnError` | `true` | Fail the build after reporting diagnostics. Use `false` for warnings. |
| `anchors` | `true` | Check local HTML fragments against IDs and legacy named anchors. |
| `assets` | `true` | Check images, scripts, stylesheets, media, frames, objects and `srcset`. |
| `external` | `false` | Opt into HTTP checks with `true` or the object above. No network requests by default. |
| `concurrency` | `4` | Maximum simultaneous HTML readers. |
| `ignore` | `[]` | Skip matching references. Strings, regular expressions or synchronous predicates. |
| `exclude` | `[]` | Exclude files from the inventory by build-relative glob. Links to excluded files can still be reported missing; use `ignore` to suppress those links. |
| `report` | unset | Write a JSON result, including on a clean build. Parent directories are created. |

Ignore rules match the raw attribute, resolved absolute URL and resolved pathname. Predicates receive `{ page, tag, attribute, line, column }` and may be called for each URL form. String patterns are anchored: `*` matches within a segment, `**` crosses `/`; other characters are literal. Exclusion paths use forward slashes and no leading slash. Regular expression state is reset before each match.

External checks deduplicate URLs across every page, preserving query strings and dropping fragments. They use HEAD with GET fallback for 403, 405 and 501, follow HTTP redirects and cancel response bodies. Timeouts and retryable statuses (408, 429, 500, 502, 503, 504) get bounded exponential retries; `Retry-After` is honored up to 30 seconds. `external.headers` adds request headers. The timeout applies to each HTTP request. `retries` means additional attempts, from 0 to 10.

The optional versioned JSON cache stores successful responses only, expires entries after `ttl` milliseconds and recovers from malformed JSON. Writes use a temporary file and rename. Keep separate cache files for concurrent builds; merging concurrent cache writers is not supported. Protect cache/report files when URLs contain private query strings. Filesystem permission errors are surfaced.

## CLI and standalone API

```sh
npx astro-broken-links ./dist --site https://example.com --base /docs \
  --ignore '/.netlify/**' --report .link-audit/report.json
```

The CLI also accepts `--external`, `--no-anchors`, `--format directory|file|preserve`, and `--trailing-slash always|never|ignore`. Exit codes: 0 clean, 1 broken references, 2 invalid invocation or execution failure. It reads built files directly; it does not load Astro configuration. Supply `--format file` for extensionless page URLs from `build.format: 'file'`.

```js
import { checkLinks } from 'astro-broken-links/checker';

const result = await checkLinks({
  directory: new URL('./dist/', import.meta.url),
  site: 'https://example.com',
  base: '/docs',
  redirects: { '/old': '/docs/guide/' },
});
console.log(result.diagnostics);
```

The API returns `{ pages, links, externalRequests, skipped, diagnostics }` and never throws merely because references are broken. I/O and configuration errors still throw. `links` counts attribute references, including skipped ones. `externalRequests` counts actual HTTP operations initiated by the checker, including retries and GET fallbacks; redirect hops are handled by fetch. `skipped` includes opted-out external URLs, ignored references, non-HTTP protocols and recognized on-demand routes.

Each diagnostic includes the page URL, raw reference, tag, attribute, one-based line and column in **generated HTML**, code, message and HTTP status when available. The report preserves each occurrence, sorted by page and position. Columns are not source `.astro`/Markdown positions.

## What is checked

- Browser URL resolution, including relative URLs, `<base href>`, HTML entities, query strings and percent encoding.
- Same-origin absolute and protocol-relative links against the local build.
- Directory and file output, base path boundaries and navigation trailing-slash rules.
- Configured literal redirect chains, inherited fragments and redirect cycles. Redirect destinations follow browser URL rules; include the base prefix explicitly when needed.
- Local HTML IDs, named anchors, top-of-document links and text fragments.
- `a[href]`, `area[href]`, resource `link[href]`, supported `src` attributes, video posters, object data and image/source `srcset`.

## Boundaries

This validates build output, so client-generated URLs, hydrated DOM, CSS `url()`, external fragments, authenticated pages and runtime response bodies are outside its scope. Server-rendered routes recognized by Astro are skipped when no static file exists; this does not prove their runtime response is healthy. Custom adapters may expose deployed resources that need explicit ignore rules. Only literal configured redirect keys are followed; parameterized redirects and platform rewrites need deployment testing or ignore rules. An HTTP 403 or 429 may indicate bot protection rather than a nonexistent page.

Symlinks are not followed. Ignored files and unsupported URL protocols are not fetched. The checker keeps file paths, anchor IDs, diagnostics and external reference occurrences in memory; it streams HTML without retaining a DOM and limits active page readers. Extremely large diagnostic sets or unique external URL sets still consume proportional memory.

## Development

```sh
npm ci
npm test
npm run test:stress
npm run test:package
npm audit
npm pack --dry-run
```

Tests cover real Astro builds, offline resolution, ignores, fragments, redirects, HTTP deduplication, fallbacks, retries, timeout/cache behavior and CLI exits. The package test installs the published archive in isolated npm and pnpm projects and checks both exports and the CLI. The stress test validates 3,600 pages with 396,000 references under a 128 MiB V8 old-space limit. See [engineering notes](docs/ENGINEERING.md) and [release instructions](docs/RELEASING.md).

## License

MIT
