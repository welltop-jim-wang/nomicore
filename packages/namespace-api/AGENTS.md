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
- Request failures settle as 4xx/422 problem Responses with the fixed shape `{code, message, issues?, issuesTruncated?}` (stable UPPER_SNAKE `code` for client branching; `issues` only on 422, `issuesTruncated` only when actually truncated), built in `src/rest-problem.ts`: 400 (owner/query/empty body/malformed JSON/shape/number range), 413 (body/schemaText/JSON depth/JSON nodes), 415 (Content-Type/Content-Encoding), 422 (VFSL schema or ROOT invalid), plus the frozen 403/405 codes with `Allow: POST`. `src/request-body.ts` owns the bounded read (`Content-Length` early rejection plus an always-enforced stream byte cap), strict UTF-8 decoding, and the iterative depth/nodes/number checks — never recurse over parsed JSON. `src/create-namespace.ts`/`src/rest-problem.ts`/`src/request-body.ts` stay package-private like the create orchestration.
- **Remaining unmapped outcomes still reject** `handle` (fail loud, no invented HTTP mapping): abort during the body read, Registry fatals, and the deferred 503/500 family below.
- Deferred to later tickets (do not implement here): 503 `REGISTRY_NOT_ACCEPTING`, the 500 family (`NAMESPACE_CREATE_FAILED` / `NAMESPACE_CREATE_OUTCOME_UNKNOWN` / `INTERNAL_ERROR`, plus the safe-500 mapping of `NAMESPACE_CREATE_INVALID_INPUT` / `NAMESPACE_ALREADY_EXISTS`), and observer event emission (FR-4). The first version assumes a trusted localhost/trusted-network exposure (ADR 0015 L36) because it ships no authentication/authorization — body reads are bounded by `maxBodyBytes`.

## Verification

Run `pnpm install` after manifest changes, then from the repository root:

```
NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck packages/namespace-api/test
pnpm typecheck
```

The contract suite in `test/` is the frozen acceptance contract (SA6); do not edit it to accommodate an implementation. Package source is covered by the root `pnpm typecheck` chain via `packages/namespace-api/tsconfig.json`.
