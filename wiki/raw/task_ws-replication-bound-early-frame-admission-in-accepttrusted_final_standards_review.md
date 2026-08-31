# Final standards review — issue #190

**Verdict: PASS**

**Blockers:** None.

**Scope reviewed:** `git diff b66615c...HEAD` (commit `6fde7ea`), plus the two uncommitted SA7 dynamic test files.

**Evidence**

- No repository `CONTRIBUTING*` or `CODING_STANDARDS*` file exists; the applicable documented protocol contract is `docs/protocols/instance-replication-v1.md`. The change conforms: §14 maps policy rejection to WS 1008 and oversized outer frames to 1009 (lines 384–391); §23 explicitly permits `auth-upgrade-rejected` reasons `frame-too-large` and `early-frame-limit` (line 636).
- `installEarlyFrameAdmission()` consolidates the previously duplicated admission lifecycle into one module-private helper, used by both `accept()` and `acceptTrusted()`. This resolves the divergent-change/duplicated-code risk without adding public API, knobs, speculative abstraction, or unnecessary message indirection.
- Naming is domain-specific and readable (`admission`, `frames`, `isRejected`, `isEarlyClosed`, `detach`); the small state object groups related lifecycle state rather than creating a problematic data clump. The guarded close contains a clear, narrow responsibility: preserve rejection state/event behavior when a contract-violating transport throws during synchronous replay.
- Boundary behavior is covered by committed tests (frame-size and 17-frame limits, rejected replay, legal HELLO, and throwing-close replay) and by SA7 tests: exact 16-frame and max-size acceptance, token/trusted parity, normal token flow, and real `wrapWs` transport behavior. The SA7 real-transport test correctly distinguishes its asynchronous production timing from the synchronous-replay admission seam.
- Validation run: `git diff --check b66615c...HEAD`, `git diff --check`, targeted issue190 tests, both SA7 test commands, and `pnpm exec tsc --noEmit -p packages/ws-replication/tsconfig.json` all completed successfully (exit 0).

No actionable standards or code-smell finding was identified.
