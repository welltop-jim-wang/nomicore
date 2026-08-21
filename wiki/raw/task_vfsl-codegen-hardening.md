# 任务简报 — fix(vfsl-codegen): 生成物编译级加固（Issue #45）

> 来源：TASK.md（issue body + owner 派发前补充说明）。证据档案：`wiki/raw/task_vfsl-codegen_sa7_report.md` §二（N1–N3 tsc 干跑实证）、`wiki/raw/task_vfsl-codegen_design.md`（F2 生成器设计）。

## 任务类型

**Bug 修复**（生成物编译级缺陷，SA7 已实证复现；修复含新行为：恒定 import 行 + 别名碰撞响亮守卫）

## 背景

Issue #26（F2 投影生成器）SA7 动态验证对生成物做 `tsc --noEmit` 干跑发现三项编译级风险——生成物在 F2 内无消费者接线（G 票 #27 dogfood 首领域时才显影），不违 F2 既有 AC/契约，登记本票在 G 落地前处置。

## 三项发现（本票范围）

1. **N1（缺 import 行）**：生成物使用 `PathSchema<…>` 但无 `import type { PathSchema } from '@nomicore/vfsl-protocol'`——原样编译 TS2304/TS2664（消费者态手工补 import 后全绿，含 D2 判别联合窄化断言）。
2. **N2（零别名域 script 退化）**：零别名域的生成物无 export 语句 → TS 视为 script，`declare module '@nomicore/vfsl-protocol'` 退化为整体模块声明并**遮蔽协议模块**（TS2305 实测）。**与 N1 同票双愈**：生成器恒定补一行 import（import 本身即令文件成为 module）。
3. **N3（别名碰撞无守卫）**：领域别名命名 `PathSchema` 与协议导入名碰撞（TS2315/2314 实测）。

## Owner 裁定（issue comment，2026-08-20，优先级高于附注原文）

1. **EACCES 附注已过期**：PR #46 评审修复（commit 567c64b）已改为仅 ENOENT 按缺失、EACCES 等重新抛出走 exit 2。**本票无需处理此项，勿照附注重复修改。**
2. **N3 处置定夺（本票自包含）**：生成器加命名碰撞响亮检查——领域别名与协议导入名（PathSchema 等）碰撞时以**独立错误码**响亮失败，不依赖 G 票的命名规约。
3. **错误消息尾串**：emitter.ts 三处「由总控开后续票登记」替换为「见 #44」，随本票一并完成（前缀已被契约断言锚定，尾串替换零测试风险）。

## 验收标准（AC）

- **AC-1（N1+N2 双愈）**：生成器对任意领域恒定发射 `import type { PathSchema } from '@nomicore/vfsl-protocol'` 行；生成物原样（孤立 program）`tsc --noEmit` 可编译——含零别名域（N2 实证形态）。
- **AC-2（契约断言）**：新增/修订契约测试锚定 import 行的恒定存在（含零别名域形态）。
- **AC-3（N3 守卫）**：领域别名与协议导入名碰撞时，生成器以独立错误码响亮失败（非静默、非归并）；有对应测试。
- **AC-4（尾串）**：emitter.ts 三处「由总控开后续票登记」→「见 #44」。
- **AC-5（零回归）**：既有 408 测试全绿 + `pnpm typecheck` 三包通过 + `pnpm generate --check --allow-empty-domains` exit 0。

## 附注（仅背景，勿重复处置）

- EACCES 归并已修（见 Owner 裁定 1）。
- 生成物样本与 tsc 干跑探针细节见 `wiki/raw/task_vfsl-codegen_sa7_report.md` §一·6 / §二 / §四。

## Blocked by

None（F2/#26 已闭环，PR #46 已合入；本分支基于其 merge commit）

## Branch

fix/issue-45-on-adr-vfsl-protocol（base: adr/vfsl-protocol，stacked on PR #23 集成链）

## SA6 红灯测试记录（2026-08-21，基点 5907dc3）

### 测试设计（三项契约 → 三测试文件 + 一共享辅助，全部在 `packages/vfsl-codegen/test/`）

| 契约 | 文件 | 断言锚（全部运行时行为，零源码 grep） | 红灯根因（实测） |
|---|---|---|---|
| ① AC-1/AC-2 恒定 import 行 + 孤立可编译 | `generate-protocol-import.test.ts`（5 条） | 文案锚：具名别名域/零别名域生成物**首非注释行** = `import type { PathSchema } from '@nomicore/vfsl-protocol';` 且全文恰一条；编译锚：生成物原样孤立 program（tsc API = `tsc --noEmit` 同语义，paths 指仓内协议源码）零诊断；N2 形态：零别名生成物 + 消费方（`import { PathAt, VfslKind }`）同 program 零诊断 | 现首非注释行 = `export type Box = …`（具名域）/ `declare module …`（零别名域，script 形）；孤立 program 诊断 4 条（TS2304×3+TS2664）/ 3 条（TS2305×2+TS2304）——与 SA5 p1/p2 逐码一致 |
| ② AC-3 独立错误码守卫 | `generate-alias-collision-guard.test.ts`（4 条） | 生成器级：协议导出面 12 名逐一作碰撞别名（n3 同构 fixture）→ `generateProjection` 必须抛错（非静默产出）；错误带独立 `code`（string、∉ 既有 SchemaSourceError 三码 `missing-directive/dialect-mismatch/unknown-id`，非归并）；消息含碰撞别名；CLI 级：`pnpm generate --domains <碰撞域>` → exit 2 + stderr `[<code>]` + 别名 | 12 名全部 NO-THROW 静默产出（probe6 实测）；CLI exit 0（SA5 E5 同） |
| ③ AC-4 消息尾串 | `generate-error-message-tail.test.ts`（4 条） | 三错误运行时 `err.message` endsWith(`见 #44`)：UnsupportedRootShapeError（联合形 ROOT）/ UnsupportedRootReferenceError（死别名字段引用 ROOT——`type X = ROOT` 直引被 E106 拒，本形态不构成循环）/ UnsupportedUnionKindError（map×array 异形联合，E309 只拒标量×容器，沿用既有测试同款 fixture）；CLI 端异形 ROOT 域 stderr 尾串同锚 | 三消息现尾串均为「由总控开后续票登记」→ endsWith 全红；CLI stderr 同红（exit 2 已符合，仅尾串红） |
| 共享辅助 | `tsc-helper.ts` | 仓内 typescript 经 `createRequire` 取（规避 verbatimModuleSyntax 下 CJS 默认导入禁令）；`preEmitDiagnostics` 孤立 program 编译；`protocolExportNames` 经 `checker.getExportsOfModule` 枚举协议包**实测**导出面（12 名；协议包为纯类型模块，运行时取不到键）——导出面漂移测试自动跟随，不靠手工名单 | — |

### 红灯运行证据

命令（仓根）：`./node_modules/.bin/vitest run packages/vfsl-codegen/test/generate-protocol-import.test.ts packages/vfsl-codegen/test/generate-alias-collision-guard.test.ts packages/vfsl-codegen/test/generate-error-message-tail.test.ts`

结果：**3 files / 13 tests 全红**（EXIT=1），失败断言逐条：
- ① 5 failed：首非注释行 = `export type Box …` / `declare module …`（≠ import 行）；import 行 0 条；孤立 program 4/3 条诊断（TS2304/TS2664/TS2305，行号与 SA5 p1/p2 逐字一致）
- ② 4 failed：12 名全部未抛错（silent 清单 = 12 名全量）；code/消息断言 err=null；CLI exit 0 ≠ 2（stderr 空）
- ③ 4 failed：三消息 endsWith('见 #44')=false（现尾串 =「由总控开后续票登记」）；CLI stderr 尾串同红

既有测试零破坏复核：`vitest run packages/vfsl-codegen` 全量 = 新 13 红 + 既有 **32 passed**（generate-cli-check 3 / generate-mapping-table 13 / generate-discriminated-emission 10 / test-d 6）零回归；`tsc -p packages/vfsl-codegen/tsconfig.json` exit 0（新测试文件类型检查通过，AC-5 三包 typecheck 前提不破坏）。

### 绿灯形态（已实证可达，供 SA3 参照）

- ①：头注空行后、段② 前恒定发射一行 import（SA5 p1-fixed/p2-fixed 最小补丁形态；probe4 实测补行后两 program 均 0 诊断）。
- ②：段② 发射前对别名名 × `protocolExportNames()` 实测 12 名做碰撞检查，命中抛带独立 `code` 的命名错误；CLI 顶层 catch 已具 `[<code>]` 前缀打印 + exit 2（`cli.ts printStructuredError`，零改动）。
- ③：emitter.ts L39/L58/L76 三消息尾串「由总控开后续票登记」→「见 #44」（L50 为文档注释非消息，AC-4「三处」字面不含；前缀已被既有契约断言锚定，尾串替换零既有测试风险——SA5 锚点 3）。

### 测试纪律备注

- 零源码 grep：全部断言锚 `generateProjection` 发射输出 / 抛错行为 / 错误对象属性 / CLI 退出码与 stderr / 孤立 program 编译诊断。
- 未新增依赖与端口：typescript、vitest 均为既有 devDependency；仓内无 `scripts/test-lock.sh`，无更新项。
- 测试独立性：每文件可独立运行（`vitest run <file>`），无执行顺序依赖；临时目录走 `mkdtemp` 且编译用例 try/finally 清理。
