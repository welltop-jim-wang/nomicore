# Dispatch Log — issue #168 ws-replication hello-timeout synchronous peer transport close

| # | 派发时间 | SA | 阶段 | 完成时间 | 决策逻辑 |
|---|---------|-----|------|---------|---------|
| 1 | 13:15 | SA8 | Phase 0 conflict gate | 13:18 | Verdict: clear; task aligns with ADR-0010 and wire contract §18. Baseline mismatch identified. |
| 2 | 13:24 | Controller | Baseline correction | 13:24 | Rebased b264aae task branch onto origin/docs/phase-5-websocket-replication@ffca4f6: it contains ws-replication source, peer connection, SA7 D5 anchor, ADR-0010, and wire contract; newer issue-164 head only adds unrelated yjs-server composition/CI repair changes. |
| 3 | 13:25 | SA5 | Phase 0 analysis/reproduction | 13:31 | Root cause confirmed: armHello only transitions to backoff and leaves old transport open; D5 anchors existing faulty behavior. |
| 4 | 13:32 | SA6 | Phase 1 red contract | 13:39 | Red contract established: T1/D5 fail on orphan close, frozen dial-throw/onClose checks remain green. |
| 5 | 13:41 | SA1 | Phase 2 design | 13:49 | Design proposes guarded shared timeout detach-close helper; frozen dial-throw/onClose and hub paths remain unchanged. |
| 6 | 13:50 | SA8 | Phase 2 design conflict review | 13:58 | Verdict: clear; implementation aligns with wire contract and registered R4 detach-close order. |
| 7 | 14:00 | SA2 | Phase 2 adversarial design review | 14:09 | Verdict: pass; document #1/#4 corrections and record helper identity/close-throw considerations during implementation. |
| 8 | 14:11 | SA3 | Phase 3 implementation | (pending) | SA2 passed design; implement guarded synchronous hello-timeout close and make SA6 contracts green. |
