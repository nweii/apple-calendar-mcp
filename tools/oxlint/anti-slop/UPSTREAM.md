# Vendored anti-slop

Source: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), the assets bundled with its `install-anti-slop` skill, captured 2026-11-13. The installed bundle did not include an upstream commit identity. `snapshot.sha256.json` records SHA-256 hashes of every pristine copied file; these files are retained unchanged, so the captured snapshot is recoverable from this repository. Do not substitute the latest upstream commit for the unknown source revision.

Entry point: `tools/oxlint/anti-slop/index.ts`. Oxlint and `@oxlint/plugins` are pinned together at 1.93.0. The nested Stylistic license and provenance are retained. Update from a separate pristine upstream snapshot and compare against these hashes before applying changes.

## Project adaptations

The generic rules run at error severity except for these deliberate choices in `.oxlintrc.json`:

- `no-conditional-empty-object-spread` is disabled. Conditional spreads represent absent optional iCalendar fields under `exactOptionalPropertyTypes`; replacing them with explicit `undefined` changes the contract.
- `no-runtime-typeof` is disabled only in the CalDAV and iCalendar adapters, where it validates untrusted upstream values. `no-unknown-parameters` has individual annotated exceptions at the string parser and public error boundaries. It remains enabled elsewhere.
- `no-module-mocking` is disabled only in the two existing CalDAV boundary suites. They mock the external DAV client to exercise network failure recovery without contacting iCloud.
- `no-unknown-parameters` is disabled in the recovery tests, which deliberately inspect arbitrary thrown values.

Readable spacing, precise inferred or named return contracts, descriptive schema-field names, and the prohibition on chained casts apply to existing code as well as additions. Every retained non-const assertion needs a local `SAFETY` explanation.

The Effect plugin is retained as upstream source but is not registered because Effect is not an application dependency. Generated files, dependencies, agent installations, and vendored rules are excluded from application linting. CI runs lint with warnings treated as failures.
