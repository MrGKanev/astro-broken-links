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
| Baseline adoption | Versioned occurrence counts independent of generated HTML positions | Capture, comparison, escalation and pruning tests |
| Diagnostic policy | Per-code error/warning settings and callbacks | Warning-only builds and strict CLI exits |
| Terminal reports | Grouped URLs with all locations and a compact summary | Grouping regression test |
| Package distribution | Compiled ESM, type declarations and CLI executable | Isolated npm and pnpm installations |
| Maintenance | Lockfile, native Node test runner, CI and scheduled dependency updates | Audit and Astro compatibility matrix |

## Architecture

1. Walk the output once to inventory regular files. Do not traverse symlinks.
2. Read HTML with a SAX parser to index anchor IDs and identify meta-refresh redirect stubs. Skip this pass only when both anchor checks and configured redirects are disabled.
3. Read a bounded number of pages again, resolve each reference with the URL API, and check inventory/anchor indexes synchronously. Retain only the current pages' reference arrays.
4. Check unique external URLs with globally bounded workers and per-host HTTP request limits, including redirect hops, if explicitly enabled. Preserve occurrences for reporting.
5. Classify severity, sort diagnostics, compare or explicitly update the baseline, compute the summary, and atomically write the optional report. The integration fails on new errors only.

The integration reads final Astro configuration and build-hook output directories. On-demand route patterns prevent false missing-file reports; response validation requires a running deployment. Parameterized configured redirects are compiled once, ordered by specificity and resolved with browser URL rules. Encoded captures remain encoded during substitution. Neither queries nor fragments are used as local filesystem names.

The core has no Astro runtime imports. Published JavaScript and type declarations are generated from TypeScript; the CLI and checker subpath can run without installing Astro.

## Validation limits

A stress fixture demonstrates bounded processing for repeated links, not a constant-memory guarantee for every possible input. Anchor IDs, inventories, external occurrences and diagnostics grow with input. HTTP tests are deterministic local-server tests rather than a claim that all third-party bot protections can be bypassed. Package audit results describe the installed lockfile at the time of the check.

Baseline snapshots are explicit writes, never silently updated during ordinary CI runs. The identity includes severity and HTTP status so accepting a warning does not accept a later error. The JSON report always retains both accepted and new occurrences.
