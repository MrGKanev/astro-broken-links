# Engineering notes

## Design and verification

| Capability | Implementation | Verification |
| --- | --- | --- |
| Ignore rules | Raw/resolved URL strings, globs, regular expressions and predicates | Ignore/exclusion tests |
| Offline checks | HTTP requests require explicit opt-in | Offline-default test |
| Large builds | SAX parsing with bounded page readers | 3,600-page stress test with 128 MiB old-space |
| Deployment paths | Segment-aware base prefix and browser URL resolution | Unit tests and real Astro builds |
| Navigation slash policy | HTML navigation checked separately from assets | Always/never tests |
| HTTP checks | URL deduplication, expiring cache, deadlines, retries and GET fallback | Local HTTP server tests |
| Package distribution | Compiled ESM, type declarations and CLI executable | Isolated npm and pnpm installations |
| Maintenance | Lockfile, native Node test runner, CI and scheduled dependency updates | Audit and Astro compatibility matrix |

## Architecture

1. Walk the output once to inventory regular files. Do not traverse symlinks.
2. Read HTML with a SAX parser to index anchor IDs. Disable this pass when anchor checks are off.
3. Read a bounded number of pages again, resolve each reference with the URL API, and check inventory/anchor indexes synchronously. Retain only the current pages' reference arrays.
4. Check unique external URLs with bounded HTTP workers if explicitly enabled. Preserve occurrences for reporting.
5. Sort diagnostics, atomically write the optional report, and let the integration decide whether to fail the build.

The integration reads final Astro configuration and build-hook output directories. On-demand route patterns prevent false missing-file reports; response validation requires a running deployment. Redirect destinations are literal browser URLs. Neither queries nor fragments are used as local filesystem names.

The core has no Astro runtime imports. Published JavaScript and type declarations are generated from TypeScript; the CLI and checker subpath can run without installing Astro.

## Validation limits

A stress fixture demonstrates bounded processing for repeated links, not a constant-memory guarantee for every possible input. Anchor IDs, inventories, external occurrences and diagnostics grow with input. HTTP tests are deterministic local-server tests rather than a claim that all third-party bot protections can be bypassed. Package audit results describe the installed lockfile at the time of the check.
