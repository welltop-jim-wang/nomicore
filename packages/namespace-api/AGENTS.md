# Namespace API Agent Instructions

## Contract

This package owns the host-agnostic REST router for namespace lifecycle endpoints (ADR 0015). The router is a plain Module, **not** a Cordis plugin: it maps a standard Web `Request` to a discriminated `RestHandledResult` (`{matched:false}` or `{matched:true; response}`) and owns no listener, authentication, authorization, CORS, TLS, request ID, global concurrency, or graceful drain. Read `README.md`, ADR 0015, ADR 0009, ADR 0010, and ADR 0012 plus the root `CONTEXT.md` vocabulary before changing behavior.

## Boundaries

- Public surface is exactly `src/index.ts` and the `./rest` subpath (`src/rest.ts`). Create orchestration lives in `src/create-namespace.ts` and must stay **package-private**: never add it to `package.json` exports, never re-export it from `src/index.ts`.
- Construction reads, validates, copies, and freezes configuration; invalid construction config throws a plain `TypeError`. Both synchronous void observers (`metricsObserver`, `diagnosticObserver`) are mandatory — an explicit no-op is required (ADR 0015 L186). They receive typed events (`RestMetricsEvent` / `RestDiagnosticEvent`): every terminal path owned by the failure mapping below emits exactly one low-cardinality metrics event (`operation` constant, `outcome` from the five-value vocabulary, stable `code` on non-2xx/non-abort outcomes, `status` whenever a Response exists), and at most one diagnostic event from exactly three kinds (`registry-fatal`, `unknown-exception`, `lease-release-failure`, with the exact cause object reference). The 4xx/422 problem family and the 403/405 gates emit no metrics event yet — the `rejected` emission policy is deferred to a later ticket. Observer throws are isolated and never change the HTTP result.
- **Role single truth (ADR 0012):** `RestRouterOptions.role` must carry the value read from the composition root's Instance service (`instanceId + role`). Never add a role default, environment-variable read, or second role configuration source inside this package.
- Fixed order must not be reordered: raw path match → method gate (`405` + `Allow: POST`) → role gate (`403` + `INSTANCE_ROLE_FORBIDDEN`) → owner capture → body read → `deriveSchemaIdentity` → full SCHEMA envelope → `Registry.create({ owner, schema, root })` → copy the owned plain DTO → exactly one awaited `lease.release()` → `201`. Peer requests must not decode the owner, read the body, or touch the Registry.
- The `201` body contains exactly `namespaceId` and `schema { lang, version, id }` (never the envelope `text`), with no `Location` header. New namespaces stay `replication-disabled`; the router never touches replication identity.
- `release()` failures do not change the known creation fact: still `201`, never a retry or a second call.
- Request failures settle as 4xx/422 problem Responses with the fixed shape `{code, message, issues?, issuesTruncated?}` (stable UPPER_SNAKE `code` for client branching; `issues` only on 422, `issuesTruncated` only when actually truncated), built in `src/rest-problem.ts`: 400 (owner/query/empty body/malformed JSON/shape/number range), 413 (body/schemaText/JSON depth/JSON nodes), 415 (Content-Type/Content-Encoding), 422 (VFSL schema or ROOT invalid), plus the frozen 403/405 codes with `Allow: POST`. `src/request-body.ts` owns the bounded read (`Content-Length` early rejection plus an always-enforced stream byte cap), strict UTF-8 decoding, and the iterative depth/nodes/number checks — never recurse over parsed JSON. `src/create-namespace.ts`/`src/rest-problem.ts`/`src/request-body.ts` stay package-private like the create orchestration.
- Registry failure mapping (ADR 0015 §错误契约 L175–L182) settles the owned outcomes as Responses: `REGISTRY_NOT_ACCEPTING` → `503`; narrow issue `NAMESPACE_CREATE_FAILED` → `500`; `NamespaceRegistryFatalError` with `committed:true` → `500 NAMESPACE_CREATE_OUTCOME_UNKNOWN` (never auto-retry); fatal `committed:false`, unknown exceptions, and internal contract violations (`NAMESPACE_CREATE_INVALID_INPUT`, `NAMESPACE_ALREADY_EXISTS`) → `500 INTERNAL_ERROR` (the latter with a diagnostic report). The `5xx` bodies are the minimal `{code}` shape; the remaining unmapped narrow issues (e.g. `NAMESPACE_INVALID_IDENTITY`) still **reject** `handle` — this router never invents unreviewed HTTP mappings.
- Body reads observe `Request.signal`: an abort during the read settles `handle` with a bounded rejection (no fabricated HTTP status; fixed message plus `signal.reason` as `cause`), emits metrics `aborted`, and touches the Registry zero times. Inside the read segment an observed abort takes precedence over every read-phase outcome (including `413`), and the entry signal check runs before any read-phase validation. After admission the router never observes the signal again — the client cancel is not propagated, `create` is awaited, and `lease.release()` runs exactly once (still `201`).
- Deferred to later tickets (do not implement here): the metrics `rejected` emission policy (4xx/422 family) and a `message` field on the `5xx` bodies. The first version assumes a trusted localhost/trusted-network exposure (ADR 0015 L36) because it ships no authentication/authorization — body reads are bounded by `maxBodyBytes`.

## Verification

Run `pnpm install` after manifest changes, then from the repository root:

```
NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck packages/namespace-api/test
pnpm typecheck
```

The contract suite in `test/` is the frozen acceptance contract (SA6); do not edit it to accommodate an implementation. Package source is covered by the root `pnpm typecheck` chain via `packages/namespace-api/tsconfig.json`.
