# AC 逐条确认清单 — Issue #45（vfsl-codegen 生成物编译级加固）

> 门禁时点：SA4 pass + SA7 pass 双清之后、`.mabf-done` 之前。AC 来源：任务简报 `task_vfsl-codegen-hardening.md` §验收标准（issue body 验收节 + Owner comment 裁定改写）。

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC-1 | N1+N2 双愈：生成器对任意领域恒定发射 `import type { PathSchema } from '@nomicore/vfsl-protocol'`；生成物原样（孤立 program）`tsc --noEmit` 可编译，含零别名域（N2 形态） | ✅ | `packages/vfsl-codegen/test/generate-protocol-import.test.ts` 5 tests 全绿（首非注释行=import 行 / 恰一条 / 孤立编译零诊断 / 零别名域+消费方不毒化）；SA7 报告 §五 probe4：当前生成物 + N2 消费方同 program `tsc --noEmit -p` exit 0，基线差分 TS2305×2+TS2304 证探针灵敏度 | SA3 实现（commit 1c95341 emitter.ts 四段装配 + protocol-surface.ts `PROTOCOL_IMPORT_LINE`） |
| AC-2 | 契约断言：新增/修订契约测试锚定 import 行恒定存在（含零别名域形态） | ✅ | 同上 5 tests（SA6 锚定、SA3 零断言改动、SA4 Scope Guard 核验 SA6 owned 测试无篡改） | SA6 锚定（13 红灯之一组） |
| AC-3 | N3 守卫：领域别名与协议导入名碰撞 → 独立错误码响亮失败（非静默、非归并）+ 对应测试 | ✅ | `generate-alias-collision-guard.test.ts` 4 tests 全绿；SA7 报告 §五 probe5：协议入口 grep 独立取证 12 名逐一碰撞 12/12 throw `AliasProtocolExportCollisionError`，code=`alias-protocol-export-collision`（与 parse 层 E 码、接缝层三码可区分）；CLI 端到端 exit 2 + stderr `[alias-protocol-export-collision]` | SA3 实现（assertNoProtocolNameCollision 守卫 + 独立错误类） |
| AC-4 | emitter.ts 三处「由总控开后续票登记」→「见 #44」 | ✅ | `generate-error-message-tail.test.ts` 4 tests 全绿（三错误 endsWith('见 #44') + CLI stderr 尾串）；SA4 静态判据 `grep -c '由总控开后续票登记' emitter.ts` = 0（SA2 要求的 grep 判据）；L50 JSDoc 顺带同步（SA2 裁决接受） | SA3 实现 |
| AC-5 | 零回归：既有 408 测试全绿 + `pnpm typecheck` 三包 + `pnpm generate --check --allow-empty-domains` exit 0 | ✅ | 总控亲验（`.mabf-bg/sa3-verify.log`）：`Test Files 27 passed (27)` / `Tests 421 passed (421)`（408+13）/ Type Errors no errors / TEST_EXIT=0 / TSC_EXIT=0 / GEN_EXIT=0；SA7 基线复跑逐字一致（`task_vfsl-codegen-hardening_sa7_baseline.log`） | SA3 实现 + 总控/SA4/SA7 三重复跑 |

## Owner 三项裁定对照

| # | 裁定 | 状态 | 证据 |
|---|---|---|---|
| 1 | EACCES 附注已过期，本票无需处理，勿重复修改 | ✅（零触碰） | SA3 diff 不含 collect.ts/checkFreshness 任何改动（SA4 Scope Guard 实证 DENY 零触碰） |
| 2 | N3 本票自包含：独立错误码响亮守卫 | ✅ | 见 AC-3 |
| 3 | 三尾串随本票替换为「见 #44」 | ✅ | 见 AC-4 |

## 结论

**5/5 AC 全部 ✅，Owner 3/3 裁定全部遵守，无 ❌ 条目，无需追加派单。** 进入 Phase 4 收尾。
