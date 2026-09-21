
# Releases and versioning

Automated, versioned releases use `.github/workflows/release.yml`. No stable release has been published yet. This guide defines the live process and the checks required before creating the first protected tag.

The release workflow runs only for semantic version tags, separates verification from publication, and requires the protected `release` environment for the write-capable job.

## Goals

A release should be:

- traceable to one reviewed commit and signed or protected tag;
- built and tested by CI, not a maintainer laptop;
- reproducible from the repository and lockfile;
- distributed as immutable artifacts;
- accompanied by checksums and provenance where supported;
- documented with compatibility, configuration and security notes;
- safe to roll back without guessing which source produced it.

## Version policy

The project will use Semantic Versioning after the first published version:

```text
MAJOR.MINOR.PATCH
```

- **MAJOR**: incompatible public API or configuration changes.
- **MINOR**: backward-compatible providers, outputs, settings or features.
- **PATCH**: backward-compatible fixes and documentation corrections that warrant a release.

Before `1.0.0`, minor versions may contain breaking changes. Every such change must be called out under **Breaking changes** with migration steps. Patch releases remain backward-compatible within their minor line.

Tags use a `v` prefix, for example `v0.1.0`.

## Public compatibility surface

Version decisions consider:

- package export paths and exported function names;
- provider constructor options and query shape;
- normalized presence fields and semantics;
- settings schema, defaults and preset names;
- CLI names, flags, environment names and exit codes once shipped;
- hosted card route and query contract once shipped;
- generated configuration and state-file formats;
- supported Node.js versions;
- release artifact names and platform support.

Internal module layout is not a compatibility promise unless exported.

## Release artifacts

The current `npm run build` produces copied ESM source, a sample SVG and a manifest under `dist/`. The release pipeline will turn the verified build into named artifacts such as:

```text
nowplaying-v0.1.0-source.tar.gz
nowplaying-v0.1.0-node.tar.gz
SHA256SUMS
```

Platform packages or container images should be added only when the corresponding runtime exists and can be tested.

Every release must include or carry:

- `LICENSE`;
- `NOTICE`;
- package metadata;
- version and source commit;
- README and relevant operational docs;
- checksums outside the archive;
- software-bill-of-materials or provenance data when supported.

Generated test reports and development caches are not release artifacts.

## Proposed release workflow

### 1. Prepare

Create a small release-preparation pull request that:

- sets the intended version in package metadata;
- updates the changelog from merged user-facing changes;
- updates supported-version tables;
- confirms configuration examples and migrations;
- verifies license/notice changes for adapted code;
- contains no unrelated feature work.

The version must not be inferred from a mutable branch after the release begins.

### 2. Validate the pull request

Required checks:

```bash
npm ci
npm run check
npm test
npm run test:coverage
npm run build
```

CI runs supported Node versions, repository checks and artifact smoke tests. Future release CI should also scan dependencies, validate licenses, inspect the packaged file list and verify that the tree is clean after building.

### 3. Merge and tag

After required checks pass, merge the release-preparation PR. Create the tag from the exact merge commit. The tag and GitHub Release title must contain the same version.

Protected environments should require explicit approval for publishing credentials, while build and verification remain automatic.

### 4. Build once

The tagged workflow checks out the tag by immutable commit, installs from the lockfile and runs the full validation suite. It then creates release archives in one job or passes a verified artifact to publishing jobs.

Publishing jobs must not rebuild source independently. Rebuilding after approval can produce bytes different from the checked artifact.

### 5. Verify

The workflow should:

- compare package version to tag;
- reject a dirty working tree;
- list packaged files and reject secrets or unexpected paths;
- smoke-import the packaged public exports;
- render and parse a sample SVG;
- verify notices are included;
- generate SHA-256 checksums;
- attest provenance using GitHub's supported mechanism;
- upload artifacts with retention sufficient for investigation.

### 6. Publish

Create a GitHub Release from the tag and attach only the verified artifacts, checksums and attestations. Mark pre-1.0 builds as pre-releases when appropriate.

Package-registry publishing is optional and should be enabled only after package naming, ownership, token strategy and provenance are settled. A GitHub Release can precede registry publication.

### 7. Post-release check

From a clean environment:

- download the public artifact;
- verify its checksum;
- import the package through documented export paths;
- run a synthetic provider/render smoke test;
- check release notes and artifact links;
- record the result without using real provider credentials.

A failed post-release check stops promotion and triggers a fix or withdrawal decision.

## Workflow permissions

GitHub Actions permissions should default to read-only:

```yaml
permissions:
  contents: read
```

Grant write scopes only to the release job that needs them. Provenance/attestation may require an identity-token or attestation scope; use the narrow current GitHub recommendation when implementing it.

Release credentials belong in a protected environment, not repository variables or workflow text. Pull-request workflows from untrusted branches must never receive publishing secrets.

Pin third-party actions to full commit SHAs. Document and review updates to those pins.

## Release notes

Each release should contain:

```markdown
## Highlights

## Added

## Changed

## Fixed

## Security

## Breaking changes

## Migration

## Compatibility

## Checksums and provenance

## Full diff
```

Omit empty marketing copy, but keep explicit **Breaking changes: none** and **Security: no known release-specific changes** where that prevents ambiguity.

Notes should tell a user what changes in setup, privacy or output. Commit subjects alone are not enough.

## Changelog

A future `CHANGELOG.md` will use a Keep a Changelog-style structure with an **Unreleased** section. Entries are user-facing and grouped by Added, Changed, Deprecated, Removed, Fixed and Security.

Do not duplicate every internal refactor. Link to pull requests for details. Move the Unreleased entries to the tagged version in the release-preparation PR, then restore an empty Unreleased section.

## Configuration migrations

A settings-schema change needs:

- old and new examples;
- affected versions;
- whether startup rejects or migrates old configuration;
- a deterministic migration or exact manual steps;
- rollback behavior;
- tests for the prior shape;
- removal timeline for deprecated keys.

Unknown privacy settings must never be silently ignored. If compatibility mode exists, it warns with the exact path and expiry version.

## Supported versions

Until the first version, only current `main` receives fixes. After releases begin, the default policy should support the latest minor line. Additional security-fix lines should be listed explicitly in [SECURITY.md](../SECURITY.md).

Dropping a Node.js version is a compatibility change and must be announced before or with the release that drops it.

## Hotfixes

For a release-blocking regression or vulnerability:

1. create a focused fix from the supported release line or current `main`;
2. add a regression test;
3. run the complete validation suite;
4. update security/release notes without exposing an uncoordinated vulnerability;
5. publish a patch version through the normal tagged workflow;
6. never replace artifacts attached to an existing tag.

If an artifact is unsafe, mark the release and artifact status clearly. Do not delete and recreate a tag with different content.

## Rollback and yanking

A release is immutable. Rollback means redeploying an earlier verified version or publishing a new patch, not moving the tag.

If registry publication is enabled later, follow registry policy for deprecation or yanking and keep GitHub notes clear. Checksums and provenance for a withdrawn release remain useful evidence and should not be overwritten.

## First-release checklist

Before creating `v0.1.0`:

- [ ] issue #28 implementation is merged;
- [ ] package name and ownership are confirmed;
- [ ] package version is no longer `0.0.0`;
- [ ] lockfile installation is enforced;
- [ ] public exports and packed files are smoke-tested;
- [ ] all supported Node versions pass;
- [ ] coverage and build artifact checks pass;
- [ ] `LICENSE` and `NOTICE` are included;
- [ ] release workflow permissions are minimal;
- [ ] actions are pinned to immutable revisions;
- [ ] release archives are built once;
- [ ] SHA-256 checksums are attached;
- [ ] provenance/attestation is generated where supported;
- [ ] release notes include compatibility and migrations;
- [ ] clean-environment download verification succeeds;
- [ ] rollback instructions name the prior verified version.
