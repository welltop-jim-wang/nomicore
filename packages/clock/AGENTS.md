# Clock Agent Instructions

## Contract

This package provides the Cordis wall-clock capability used by persistence and registry lifecycle code. Read `README.md` and ADR 0009 before changing its public behavior.

## Boundaries

- `Clock.now()` returns Unix epoch milliseconds; callers must tolerate wall-clock rollback and must not treat it as a monotonic timer.
- Keep scheduling in Cordis Timer. This package observes time and provides no timeout, interval, or cron behavior.
- Resolve the service through the Cordis context and fail loudly when it is absent; production consumers do not fall back to ambient system time.
- Keep deterministic manual clocks in the explicit `@nomicore/clock/testing` export and production assembly on the system-clock plugin.
- Add public APIs only through `src/index.ts`; keep test-only controls in `src/testing.ts`.

## Verification

Run the clock runtime, plugin-lifecycle, public-surface, and type-contract tests plus the package typecheck. Run root `pnpm typecheck` when an exported type or Cordis service contract changes.
