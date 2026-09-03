# Nomicore

English | [中文](README_zh.md)

[![CI](https://github.com/welltop-jim-wang/nomicore/actions/workflows/ci.yml/badge.svg)](https://github.com/welltop-jim-wang/nomicore/actions/workflows/ci.yml)

> **The database built for agents.**
>
> **面向 Agent 的数据库**

Nomicore is a self-describing Namespace runtime built on Yjs. Each Namespace stores its VFSL schema alongside its data in the `SCHEMA` envelope. A host project uses the same `schema.vfsl` to generate TypeScript path projections, then performs controlled reads and writes through Registry leases. Hub/Peer replication maintains complete replicas across instances and independent Persistence roots.

## Capabilities

- **VFSL v1**: parsing, evaluation, schema envelopes, logical ROOT validation, and path/carrier projections.
- **TypeScript code generation**: generates a `VfslPathMap` augmentation from the host-owned `schema.vfsl`, providing typed mutation paths and values.
- **Namespace Runtime**: synchronous reads, VFSL-validated writes, a strict FIFO write sequencer, and SCHEMA replacement.
- **Namespace Registry**: namespace creation/opening, leases, idle retention, lifecycle management, and ordered shutdown.
- **Persistence**: Memory and File adapters, dirty tracking and flush scheduling, recovery, archival, and replica reset. A File root is exclusively owned by one active process.
- **Instance identity**: an immutable `instanceId + role` Cordis service.
- **WebSocket replication**: role-specific Hub/Peer Cordis plugins with authentication, authorization, bootstrap/reconcile, backpressure, liveness, GOAWAY drain, and controlled recovery.
- **Standalone server**: the `@nomicore/yjs-server` CLI plus embeddable Node Hub-listen and Peer-dial adapters.

See [`CONTEXT.md`](CONTEXT.md) for authoritative terminology, [`docs/adr/`](docs/adr/) for architecture decisions, and [`docs/protocols/instance-replication-v1.md`](docs/protocols/instance-replication-v1.md) for the wire contract.

## Core usage rules

1. The host project owns its `schema.vfsl`, generated types, business code, configuration, tests, and deployment. Nomicore is a dependency; it does not take ownership of the host domain.
2. Namespace writes must use the generated `VfslPathMap` projection and a projection-aware typecheck. Route writes through a host-owned typed adapter over `NamespaceLease.mutateData()`. Runtime SCHEMA validation does not replace compile-time path/value checking.
3. Business mutations should be minimal, mergeable, and semantic. Do not read and replace an entire ROOT or parent object when updating one leaf.
4. A File Persistence `rootDir` is private to one process; it is not a shared database directory. Cross-process changes must use the owner application's API or Hub/Peer replication between independent roots. Never open the same root concurrently or edit snapshots directly.
5. Only a Hub may replace SCHEMA through an existing namespace lease. After replacement, regenerate the type projection and coordinate Peer reset/re-bootstrap or restart as documented.

Related guides:

- [VFSL code generation and type-safe access in external projects](docs/integration/external-project-vfsl-codegen.md)
- [Hosting Nomicore in a third-party Cordis application](docs/integration/cordis-plugin-hosting.md)
- [Standalone Hub/Peer deployment and operations](docs/integration/hub-peer-deployment.md)
- [Local source linking](docs/integration/local-package-linking.md)

## Packages and repository layout

```text
packages/
├── vfsl-protocol/          # path-access protocol consumed by generated types
├── vfsl/                   # VFSL parser, evaluator, and validator
├── vfsl-codegen/           # TypeScript projection generator
├── doc-runtime/            # Yjs materialization, reads, and validated mutations
├── namespace-runtime/      # Namespace capabilities and write sequencer
├── clock/                  # Cordis wall-clock service
├── instance/               # instanceId + role service
├── persistence/            # Memory/File persistence
├── namespace-registry/     # Registry, leases, and replication sessions
├── replication-protocol/   # instance replication v1 codec
├── ws-replication/         # Hub/Peer controllers and Cordis plugins
└── dsh-persistence/        # DSH development/probe profile

apps/yjs-server/            # standalone Hub/Peer composition and Node WS adapters
domains/                    # repository examples and test domains
docs/                       # ADRs, protocols, VFSL, and integration guides
artifacts/local-packages/   # generated local integration tarballs and manifest
```

## Install from npm

All `@nomicore/*` packages are publicly available on npm. Independent consumers should prefer registry packages so the package manager resolves released versions and transitive dependencies:

```bash
pnpm add @nomicore/namespace-registry @nomicore/persistence
# To embed Hub/Peer replication:
pnpm add @nomicore/instance @nomicore/clock @nomicore/ws-replication @nomicore/yjs-server
# To generate typed projections:
pnpm add -D @nomicore/vfsl-codegen @nomicore/vfsl-protocol
```

Do not clone the Nomicore checkout, link `src`, or maintain a complete local tarball closure for ordinary consumption. Commit the selected npm versions and lockfile for reproducible production deployments. Source linking and local tarballs are only for Nomicore development, testing unreleased changes, or release preparation.

## Build local tarballs

Build a local tarball set only when integrating unreleased repository changes or preparing an npm release.

### 1. Prepare the checkout

```bash
git switch main
git pull --ff-only origin main
pnpm install --frozen-lockfile
```

Node.js 20+ and the pnpm version declared by the repository are required.

### 2. Build the complete package set

```bash
pnpm run pack:local
```

The command:

1. clears `artifacts/local-packages/`;
2. builds each publishable package's `dist` in dependency order;
3. packs each package into a deterministic tarball;
4. writes `artifacts/local-packages/manifest.json`.

Default output:

```text
artifacts/local-packages/
├── manifest.json
├── nomicore-vfsl-protocol-<version>.tgz
├── nomicore-vfsl-<version>.tgz
├── nomicore-vfsl-codegen-<version>.tgz
├── nomicore-doc-runtime-<version>.tgz
├── nomicore-clock-<version>.tgz
├── nomicore-instance-<version>.tgz
├── nomicore-persistence-<version>.tgz
├── nomicore-dsh-persistence-<version>.tgz
├── nomicore-namespace-runtime-<version>.tgz
├── nomicore-namespace-registry-<version>.tgz
├── nomicore-replication-protocol-<version>.tgz
├── nomicore-ws-replication-<version>.tgz
└── nomicore-yjs-server-<version>.tgz
```

To write to another directory:

```bash
pnpm run pack:local -- /absolute/path/to/output
```

`manifest.json` is the authoritative package-name-to-versioned-filename mapping. Do not hard-code the versions shown in examples. Generated `*.tgz` files are local/CI build artifacts and are ignored by Git; run `pnpm pack:local` after cloning instead of expecting archives in the repository. The tracked manifest declares the current package set and filename baseline and is rewritten during each build.

> If package contents change, bump the corresponding package version before release. Never publish different contents under the same version.

### 3. Test an unreleased build in an independent project

Use `file:` dependencies only to test unreleased repository changes. Point the relevant `@nomicore/*` dependency closure to tarballs from the same manifest; do not mix registry and local builds accidentally.

Example `package.json` (use the filenames from the generated manifest):

```jsonc
{
  "dependencies": {
    "@nomicore/instance": "file:../nomicore/artifacts/local-packages/nomicore-instance-0.1.0.tgz",
    "@nomicore/clock": "file:../nomicore/artifacts/local-packages/nomicore-clock-0.1.0.tgz",
    "@nomicore/persistence": "file:../nomicore/artifacts/local-packages/nomicore-persistence-0.2.2.tgz",
    "@nomicore/namespace-registry": "file:../nomicore/artifacts/local-packages/nomicore-namespace-registry-0.1.6.tgz",
    "@nomicore/replication-protocol": "file:../nomicore/artifacts/local-packages/nomicore-replication-protocol-0.1.0.tgz",
    "@nomicore/ws-replication": "file:../nomicore/artifacts/local-packages/nomicore-ws-replication-0.1.3.tgz",
    "@nomicore/yjs-server": "file:../nomicore/artifacts/local-packages/nomicore-yjs-server-0.1.1.tgz"
  }
}
```

The actual closure may also include `vfsl-protocol`, `vfsl`, `doc-runtime`, and `namespace-runtime`; use the package manager's report and `manifest.json`. Re-run the consumer's package-manager install after rebuilding tarballs so its lockfile captures the new files and integrity values.

### 4. Verify tarball consumption

A consumer should import packed `dist` output, not run production integration through the `nomicore-source` condition, source paths, or checkout-internal subpaths. At minimum, run:

```bash
pnpm install
pnpm typecheck
pnpm test
```

For typed Namespace writers, also run the host project's generation checks:

```bash
pnpm nomicore:generate
pnpm nomicore:generate:check
pnpm exec tsc -p <projection-aware-tsconfig> --listFilesOnly
```

The `--listFilesOnly` output must contain the exact projection file used by the business package.

## npm release preparation and publication

All `@nomicore/*` packages use the MIT license and are configured as public npm scoped packages. `scripts/package-catalog.mjs` is the single source of truth for package ordering across build, verification, and publication.

### Build and verify

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm pack:local
pnpm publish:verify
pnpm publish:reproducible
```

For each tarball, `publish:verify` checks:

- package `name` and `version` match the manifest filename;
- the package is public, non-private, MIT-licensed, and targets the public npm registry;
- dependencies contain no `workspace:` or `file:` protocols;
- all packed `exports` and `bin` targets exist;
- `npm publish --dry-run --json --ignore-scripts` succeeds for versions not yet published.

By default, `publish:verify` queries npm: an already-published version must have the same integrity as the local tarball, while an unpublished version must pass npm's dry run. Ordinary source PR CI sets `NOMICORE_VERIFY_REGISTRY_INTEGRITY=0` and checks tarball structure only; registry integrity, version-bump enforcement, and npm publish dry runs remain release gates.

`publish:reproducible` independently builds two tarball sets from the same source and requires identical SHA-256 values for every package. The Node 20/24 CI matrix validates both package structure and reproducibility.

### Safe dry run

```bash
pnpm publish:packages
```

This mode verifies again and executes `npm publish --dry-run` for every package in dependency order without creating a release.

### Publish

A real publication requires:

- the current branch is `main`;
- the Git working tree is clean;
- `npm whoami` identifies an account authorized to publish under the `nomicore` organization;
- every package/version selected for publication is not already present on npm;
- every changed package has been version-bumped before rebuilding the manifest and tarballs.

Run:

```bash
pnpm publish:packages -- --publish
```

For npm provenance:

```bash
pnpm publish:packages -- --publish --provenance
```

The script publishes in dependency order and stops at the first failure. After publishing, install the top-level packages from npm in a fresh temporary project and run typecheck/runtime smoke tests to prove registry consumption does not depend on checkout sources.

## Third-party Cordis hosting

Embedded hosts start public plugin factories in this dependency order:

```text
Instance
→ Clock
→ Host-owned Timer
→ Memory/File Persistence
→ Namespace Registry
→ role-specific Hub/Peer replication plugin
→ namespace lease / replication readiness
→ domain service
```

Node hosts can import these adapters from `@nomicore/yjs-server`:

- `createNodeHubListenAdapter()`
- `createNodePeerDial()`

See the [Cordis hosting guide](docs/integration/cordis-plugin-hosting.md) for readiness, Timer ownership, File roots, Peer reconnect, and teardown requirements.

## Standalone Hub/Peer

`@nomicore/yjs-server` provides the `nomicore-yjs-server` CLI. Install it from npm and run:

```bash
pnpm exec nomicore-yjs-server --config /path/to/config.json
# or
NOMICORE_CONFIG=/path/to/config.json pnpm exec nomicore-yjs-server
```

See the [Hub/Peer deployment guide](docs/integration/hub-peer-deployment.md) for configuration, the NDJSON management interface, TLS, root locking, Hub restart, Peer recovery, and the reset runbook.

## Development and verification

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm run pack:local
```

Common tools:

```bash
pnpm schema:check /absolute/path/to/schema.vfsl
pnpm generate --domains /absolute/path/to/host
```

CI runs on Node 20 and Node 24 via `.github/workflows/ci.yml`.
