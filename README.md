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
    perHostConcurrency: 2,
    timeout: 10000,
    retries: 2,
    retryDelay: 250,
    cache: { file: '.link-audit/external.json', ttl: 86400000 },
  },
})
```

| Option | Default | Behavior |
| --- | --- | --- |
| `failOnError` | `true` | Fail on new error-level diagnostics. Warnings and baseline findings do not fail the build. Use `false` for report-only mode. |
| `anchors` | `true` | Check local HTML fragments against IDs and legacy named anchors. |
| `assets` | `true` | Check images, scripts, stylesheets, media, frames, objects and `srcset`. |
| `external` | `false` | Opt into HTTP checks with `true` or the object above. No network requests by default. |
| `concurrency` | `4` | Maximum simultaneous HTML readers. |
| `ignore` | `[]` | Skip matching references. Strings, regular expressions or synchronous predicates. |
| `exclude` | `[]` | Exclude files from the inventory by build-relative glob. Links to excluded files can still be reported missing; use `ignore` to suppress those links. |
| `report` | unset | Write a JSON result, including on a clean build. Parent directories are created. |
| `rules` | built-in severities | Set `error` or `warning` per diagnostic code, or supply a severity callback. |
| `baseline` | unset | `{ file, update?: boolean }` records or accepts existing findings. |

Ignore rules match the raw attribute, resolved absolute URL and resolved pathname. Predicates receive `{ page, tag, attribute, line, column }` and may be called for each URL form. String patterns are anchored: `*` matches within a segment, `**` crosses `/`; other characters are literal. Exclusion paths use forward slashes and no leading slash. Regular expression state is reset before each match.

External checks allow up to `external.concurrency` active checks globally (default 8) and `external.perHostConcurrency` active HTTP requests per hostname (default 2), including cross-host redirect hops. Hostnames share a limit across ports and protocols. Requests are interleaved across hostnames. Authorization and cookie headers are removed on cross-origin redirects.

External checks deduplicate URLs across every page, preserving query strings and dropping fragments. They use HEAD with GET fallback for 403, 405 and 501, follow HTTP redirects and cancel response bodies. Timeouts and retryable statuses (408, 429, 500, 502, 503, 504) get bounded exponential retries; `Retry-After` is honored up to 30 seconds. `external.headers` adds request headers. The timeout applies to each HTTP request. `retries` means additional attempts, from 0 to 10.

The optional versioned JSON cache stores successful responses only, expires entries after `ttl` milliseconds and recovers from malformed JSON. Writes use a temporary file and rename. Keep separate cache files for concurrent builds; merging concurrent cache writers is not supported. Protect cache/report files when URLs contain private query strings. Filesystem permission errors are surfaced.

## CLI and standalone API

```sh
npx astro-broken-links ./dist --site https://example.com --base /docs \
  --ignore '/.netlify/**' --report .link-audit/report.json
```

The CLI also accepts `--external`, `--per-host-concurrency N`, `--no-anchors`, `--format directory|file|preserve`, `--trailing-slash always|never|ignore`, repeated `--rule code=error|warning`, `--baseline file.json` and `--update-baseline`. Exit codes: 0 no new errors, 1 new error-level findings, 2 invalid invocation or execution failure. It reads built files directly; it does not load Astro configuration. Supply `--format file` for extensionless page URLs from `build.format: 'file'`.

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

The API returns `{ pages, links, externalRequests, skipped, diagnostics, summary }` and never throws merely because references are broken. I/O and configuration errors still throw. `links` counts attribute references, including skipped ones. `externalRequests` counts actual HTTP operations initiated by the checker, including retries, GET fallbacks and every HTTP redirect hop. `skipped` includes opted-out external URLs, ignored references, non-HTTP protocols and recognized on-demand routes.

Each diagnostic includes the page URL, raw reference, tag, attribute, one-based line and column in **generated HTML**, code, severity, baseline membership (`known`), message and HTTP status when available. The report preserves each occurrence, sorted by page and position. Columns are not source `.astro`/Markdown positions.

`summary` contains total `errors` and `warnings`, accepted baseline occurrences (`known`), actionable `newErrors` and `newWarnings`, and `resolved` baseline occurrences no longer present. The integration and CLI fail only when `summary.newErrors > 0`. Terminal output groups repeated findings by URL and reason, lists every location, and ends with a summary. JSON preserves individual occurrences. `formatReport(result)` is exported from both package entry points for custom terminal consumers.

## Error and warning rules

Missing internal files, fragments, invalid URLs, slash violations, outside-base references and configured redirect loops are errors by default. External network failures/timeouts and HTTP 429 responses are warnings. Other HTTP failures are errors. Override a code with a severity or a synchronous callback:

```js
brokenLinks({
  external: true,
  rules: {
    'network-error': 'warning',
    'trailing-slash': 'warning',
    'http-error': finding => finding.status === 429 || finding.status >= 500
      ? 'warning'
      : 'error',
  },
})
```

The supported codes are `missing-file`, `missing-anchor`, `trailing-slash`, `invalid-url`, `outside-base`, `redirect-loop`, `http-error` and `network-error`. CLI example: `npx astro-broken-links dist --rule trailing-slash=warning`.

## Baseline existing findings

To adopt the checker in a site with existing problems, capture a baseline explicitly for one build:

```js
brokenLinks({ baseline: { file: 'link-baseline.json', update: true } })
```

After that build, commit `link-baseline.json` and remove `update: true` from the configuration. Normal builds then accept those recorded occurrences and fail on new errors. Keep the baseline file outside ignored cache/report folders. To refresh it after fixes, use `update: true` for one build again, review the changes, then remove the flag. Never leave update mode enabled in CI: it accepts the current findings and exits successfully.

The CLI supports the same explicit workflow for already-built output:

```sh
npx astro-broken-links dist --baseline link-baseline.json --update-baseline
npx astro-broken-links dist --baseline link-baseline.json
```

Use the same site/base/format and checking options when capturing and comparing. Identity includes page, raw URL, diagnostic code, severity and HTTP status, with an occurrence count; line/column movement does not create a new finding. Additional occurrences on the same page, new pages, changed HTTP statuses and severity escalations are new findings. Resolved occurrences are reported during comparison and removed when the snapshot is updated. Missing or invalid baselines fail explicitly. A baseline and report must use different files.

## What is checked

- Browser URL resolution, including relative URLs, `<base href>`, HTML entities, query strings and percent encoding.
- Same-origin absolute and protocol-relative links against the local build.
- Directory and file output, base path boundaries and navigation trailing-slash rules.
- Configured literal and parameterized redirect chains (`[slug]`, `[...path]`, embedded parameters), inherited fragments and redirect cycles. Redirect destinations follow browser URL rules; include the base prefix explicitly when needed.
- Local HTML IDs, named anchors, top-of-document links and text fragments.
- `a[href]`, `area[href]`, resource `link[href]`, supported `src` attributes, video posters, object data and image/source `srcset`.

## Boundaries

This validates build output, so client-generated URLs, hydrated DOM, CSS `url()`, external fragments, authenticated pages and runtime response bodies are outside its scope. Server-rendered routes recognized by Astro are skipped when no static file exists; this does not prove their runtime response is healthy. Custom adapters may expose deployed resources that need explicit ignore rules. Configured redirects support named and rest parameters, prioritize literal routes over parameter routes, and preserve encoded parameter values. Regular built pages take precedence over redirect patterns; generated meta-refresh stubs follow configured redirects. Runtime `Astro.redirect()`, custom parameter matchers and platform rewrites still require deployment testing. An HTTP 403 or 429 may indicate bot protection rather than a nonexistent page.

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

Tests cover real Astro builds, offline resolution, ignores, fragments, parameterized redirects, severity policies, baseline comparison/update, grouped reports, HTTP deduplication and host limits, fallbacks, retries, timeout/cache behavior and CLI exits. The package test installs the published archive in isolated npm and pnpm projects and checks both exports and the CLI. The stress test validates 3,600 pages with 396,000 references under a 128 MiB V8 old-space limit. See [engineering notes](docs/ENGINEERING.md) and [release instructions](docs/RELEASING.md).

## License

MIT
