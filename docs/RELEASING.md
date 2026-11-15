# Releasing

The package is distributed through the public npm registry and supports installation with npm and pnpm.

1. Confirm ownership/availability of the `astro-broken-links` npm name. If necessary, choose a scope and update all imports, metadata and examples together.
2. Update the package version and lockfile, and add release notes.
3. Run `npm ci`, `npm test`, `npm run test:stress`, `npm run test:package`, `npm audit` and `npm pack --dry-run`.
4. Confirm the packaged files include compiled JavaScript, type declarations, CLI executable, license and documentation. Consumers install the prebuilt package without running build scripts.
5. Configure an npm trusted publisher for this repository, workflow `release.yml`, environment `npm`. Create that GitHub environment and configure its approval rules as desired. The first publication may require the package owner's interactive npm authentication before a trusted publisher can be configured.
6. Run the release workflow manually with the exact package version. It checks the version, tests, inspects the archive and publishes with provenance.
7. Verify the registry release using both `npm install astro-broken-links@<version>` and `pnpm add astro-broken-links@<version>` in fresh Astro projects.

The release workflow never publishes on ordinary pushes or pull requests. Its availability does not imply that npm ownership, environment rules or trusted publishing are already configured.
