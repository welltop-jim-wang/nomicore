# Namespace API Agent Instructions

## Contract

This package owns the host-agnostic REST router for namespace lifecycle endpoints (ADR 0015). The router is a plain Module, **not** a Cordis plugin: it maps a standard Web `Request` to a discriminated `RestHandledResult` (`{matched:false}` or `{matched:true; response}`) and owns no listener, authentication, authorization, CORS, TLS, request ID, global concurrency, or graceful drain. Read `README.md`, ADR 0015, ADR 0009, ADR 0010, and ADR 0012 plus the root `CONTEXT.md` vocabulary before changing behavior.

## Boundaries

- Public surface is exactly `src/index.ts` and the `./rest` subpath (`src/rest.ts`). Create orchestration lives in `src/create-namespace.ts` and must stay **package-private**: never add it to `package.json` exports, never re-export it from `src/index.ts`.
- Construction reads, validates, copies, and freezes configuration; invalid construction config throws a plain `TypeError`. Both synchronous void observers (`metricsObserver`, `diagnosticObserver`) are mandatory — an explicit no-op is required (ADR 0015 L186); this version emits no events.
- **Role single truth (ADR 0012):** `RestRouterOptions.role` must carry the value read from the composition root's Instance service (`instanceId + role`). Never add a role default, environment-variable read, or second role configuration source inside this package.
- Fixed order must not be reordered: raw path match → method gate (`405` + `Allow: POST`) → role gate (`403` + `INSTANCE_ROLE_FORBIDDEN`) → owner capture → body read → `deriveSchemaIdentity` → full SCHEMA envelope → `Registry.create({ owner, schema, root })` → copy the owned plain DTO → exactly one awaited `lease.release()` → `201`. Peer requests must not decode the owner, read the body, or touch the Registry.
- The `201` body contains exactly `namespaceId` and `schema { lang, version, id }` (never the envelope `text`), with no `Location` header. New namespaces stay `replication-disabled`; the router never touches replication identity.
- `release()` failures do not change the known creation fact: still `201`, never a retry or a second call.
- Unmapped outcomes (body/JSON errors, malformed top-level shape, VFSL issues, Registry narrow issues or fatals) **reject** `handle` — this skeleton never invents HTTP error mappings. Later error-contract tickets replace rejections with Responses additively.
- Deferred to later tickets (do not implement here): request shape validation and owner grammar/percent-encoding/query/Content-Type/Encoding rejection, limits enforcement and `Request.signal`, Registry failure mapping and problem shape, observer event emission. The first version assumes a trusted localhost/trusted-network exposure (ADR 0015 L36) because body reads are not yet bounded.

## Verification

Run `pnpm install` after manifest changes, then from the repository root:

```
NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck packages/namespace-api/test
pnpm typecheck
```

The contract suite in `test/` is the frozen acceptance contract (SA6); do not edit it to accommodate an implementation. Package source is covered by the root `pnpm typecheck` chain via `packages/namespace-api/tsconfig.json`.
