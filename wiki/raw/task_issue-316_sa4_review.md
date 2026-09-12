# SA4 实现静态审查 — issue #316：codegen 与 readData 投影适配 int/range 叶子

- Dispatch：`sa-e4f23566-c1d5-43d9-bd8c-f4047a76b247`（mabf-sa4 / implementation-review / iteration 0）
- 审查对象：SA3 实现（dispatch `sa-2a810e4e…`，iteration 0）——测试-only 改动（2 修改 + 1 新增测试文件），生产零改动
- Worktree：`/home/wangjian/nomicore-fix-issue-316`（分支 `mabf/issue-316`，HEAD `bd9fb93` = #315 集成 PR #351，`git log -1` 本轮复核未漂移）
- 审查方式：静态只读（源码、测试、设计、ADR、AGENTS、CI、git status/diff、sha256 钉值复核）；不运行测试、不修改实现（SA4 技能约束）

---

## 1. Reviewed inputs

| 输入 | 状态 |
| --- | --- |
| `wiki/raw/task_issue-316.md`（Host 简报） | 存在；Issue body 4 AC + Blocked by #315；§Comments 空 |
| `wiki/raw/task_issue-316_design.md`（SA1 设计 **iteration 1**，SA2 approve 后的批准版） | 存在；§7 T-1~T-4（+可选 T-5）、§10 ALLOW/DENY、§12 验收映射为本轮对照基准 |
| `wiki/raw/task_issue-316_sa2_review.md`（SA2 设计评审 iteration 1，approve；F1~F5 修订映射、N1~N3 非阻断） | 存在；逐条核对 SA3 对 F1~F5/N1 的落实 |
| `wiki/raw/task_issue-316_sa3_impl.md`（SA3 实现报告 iteration 0） | 存在；Changed paths / Verification / Deviations 逐项复核 |
| `wiki/raw/task_issue-316_sa6_contract.md`（SA6 验收契约 iteration 0，approve） | 存在；C1c/C1e/C3b/C3c/C1d 与 §12.0 断言纪律为契约基准 |
| `wiki/raw/task_issue-316_relevant_decisions.md` / `_conflict_report.md` | 不存在（SA1/SA2/SA3/SA6 四方同认；以 ADR 0020 决策 7/8 + ADR 0016 + 模块 AGENTS.md + CI 替代，本轮沿用） |
| Issue comments REST snapshot | 空（派工单明文）——无 owner 追加要求，无评论映射义务 |
| 实际 diff/源码 | `git status --short`：` M packages/vfsl-codegen/test/generate-int-range.test.ts`、` M packages/vfsl/test/resolve-schema-at-path-int-range.test.ts`、`?? packages/namespace-runtime/test/runtime-readdata-int-range.test.ts` + 5 件 wiki 产物（Host 4 件 + SA3 报告 1 件）；`git diff --name-only` 仅上列 2 个 tracked 测试文件 |
| 冻结面复核（本轮实测） | `sha256sum domains/vfs3-assets/generated.ts` = `342d8c1fe0814409f682852c13748260b9d6cbda125afe0e815a8de3298e6707`（= SA6 §4 / SA1 / SA2 钉值逐字节一致）；`git diff --check` exit 0 |

## 2. Verdict

**`approve`** —— 无 BLOCKER / MAJOR。SA3 实现是对批准设计（iteration 1）的**忠实、纯加法**落地：

1. **文件范围与 ALLOW 逐字吻合**（3 个测试路径；生产 `src/**`、`domains/vfs3-assets/**`、`docs/**`、CI/vitest 配置、`readdata-schema-projection-fixture.ts`、`real-persistence-scheduler.ts` 及其余既有测试/fixture 零触碰——`git status`/`git diff` 亲验）。
2. **设计 T-1~T-4 的断言清单逐项落实**（含设计指定的敏感性行状：负例恰 1×TS2322、`@ts-expect-error` 反噬、desync 稳定片段、7 组配对同码、失败码集合 ⊆ 两枚冻结码、裸 Int 条件键、detached 污染重读、配对同码 `PATH_NOT_ALLOWED`）；既有断言/字段零改动（两文件 diff 逐行核验：仅新增 + FIXTURE 注释行替换，既有 7/10 条用例与字段 a~e/p/q 原样）。
3. **两项偏差均在报告中显式记录且断言强度不降**（详见 §4 偏差行）；生产零改动使 AC2 字节基线不可破坏（钉值本轮再实测一致）。
4. 测试质量面无 skip/only/todo、无软化、fail loud、非空转前置判别齐全；新文件被根 vitest include 与 CI 磁盘枚举分片自动发现（`vitest.config.ts:15`、`scripts/ci-test-shard.mjs` 头注/枚举逻辑亲验）。

非阻断观察见 §12（N1~N3）；静态无法确认的运行事实列入 §11 后续动态验证项。

## 3. 上游要求落实

Issue comments REST snapshot 为空（派工单明文）⇒ 需求全集 = Issue body 4 AC + ADR 0020 决策 7/8（SA6 §2 同认）。无评论映射表可填（无评论即无遗漏）。

| Requirement or finding | Implementation evidence | Assessment |
| --- | --- | --- |
| AC1 含 Int/Range 字段生成 TS `number`、可编译（既有） | 生产零改动（`valuetype.ts:35-39` 原样；本轮亲验锚点在位）；既有 10 用例零改动 | 满足（HEAD 既绿保持） |
| AC1 补强 C1c typed-access 编译级（SA6 §12.2/根 AGENTS.md 写路径义务的读侧对偶） | `generate-int-range.test.ts` 新增 `TYPED_ACCESS_CONSUMER`/`TYPED_ACCESS_NEGATIVE` + 2 用例：generated+consumer 同 program 0 诊断；负例恰 1 条 TS2322 | 满足（断言与设计 §7 T-1 逐条对应，见 §4） |
| AC1 补强 C1e 过宽放行负控 | 同文件新增篡改用例：leaf 结构 + `{kind:'xml'}` 值 → `toThrow(/structure\/value desync/)` | 满足（白名单 `emitter.ts:339-348` 排除 xml → 必抛；消息模板 `:533` 含该片段，本轮亲验） |
| AC2 `pnpm generate --check` 零漂移 | 生产零改动 + 钉值本轮实测一致；SA3 报告 `pnpm generate --check` exit 0 | 满足（无 src diff ⇒ 漂移不可达；CI `codegen-freshness` 为持久哨兵） |
| AC3 投影与 pattern 叶同构（既有 C3a/C3d） | 生产零改动；既有 7 用例零改动 | 满足 |
| AC3 补强 C3b 比较型同构 + 码集合 | `resolve-schema-at-path-int-range.test.ts` 新增 FIXTURE 六字段（u/r/pp/ppe/ppr/ppu）+ 前提用例 + 7 组 `it.each` 配对 + 码集合用例 | 满足（配对矩阵与设计 §7 T-3 / SA6 §12.4 C3b 逐行一致） |
| AC3 补强 C3c readData 端到端 | 新文件 `runtime-readdata-int-range.test.ts`（10 用例）：三键/预写值/条件键/range 双键/元素叶/Record 值叶/union 叶/docs 切片/detached 隔离/失败配对 | 满足（装置为设计 F1 方案 (b) 的自包含形态，断言清单全覆盖设计 §7 T-4） |
| AC4 包测试、typecheck 全绿 | SA3 报告：焦点 3+1 文件 44 用例、`pnpm typecheck` exit 0、新文件单检 strict tsc exit 0 | 静态结构一致（用例计数 13/16/10/44 与代码逐条可数吻合）；运行事实由门禁/SA7 复核（§11） |
| SA2 F1（MAJOR，T-4 装置自洽） | 新文件私有 TXT_316/ENV_316/seedRoot316/makeHandle316/makeReadyRuntime316；fixture/scheduler 零 diff | 已落实（`git status` 亲验 fixture 无改动；装置配方与 fixture `:73-98` 逐行同构，META docId→createdAt→seedRoot→createDoc 顺序一致） |
| SA2 F2（命名碰撞） | pattern 侧用 `pp`/`ppe`/`ppr`/`ppu`；既有 `p`/`q` 原样 | 已落实（FIXTURE 亲验无碰撞） |
| SA2 F3（类型 import 自 protocol） | consumer 首行 `import type { PathAt, PathElementValue, PathPatchValue, PathValue, VfslPathMap, VfslTypedAccess } from '@nomicore/vfsl-protocol'`；生成文本只做 `VfslPathMap` 增广 | 已落实（六名均为 protocol 实导出，`index.ts:59/72/81/96/118/157` 本轮亲验） |
| SA2 F4/F5、N1（机制归因/锚点精度） | T-4 失败面按 N1 修正后机制断言（`PATH_NOT_ALLOWED`、无 `schema` 键、path 回显），文件注释说明 resolve 侧失败收敛 `schema:null` 不进失败联合 | 已落实（与 `runtime.ts:485` + `read-schema-projection.ts:57` 源码事实一致，本轮亲验） |
| SA2 N2/N3 | 设计文本级观察，无测试落点 | 无需动作（确认） |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
| --- | --- | --- | --- |
| D-1~D-4 生产零改动（硬性结论） | `git diff --name-only` 仅 2 个测试文件；`valuetype.ts`/`emitter.ts`/`resolve-schema-at-path.ts`/`read-schema-projection.ts` 零 diff；钉值一致 | 落实 | — |
| T-1（C1c）consumer 断言：`PathValue<PathAt<M,['b']>>=42` 通过、`access.patch(['b'],42)` 通过、`patch(['b'],'42')`/`patch(['b'],true)` 各 `@ts-expect-error` 锁定、负例文件恰 1×TS2322 | `generate-int-range.test.ts:152-217`（`TYPED_ACCESS_CONSUMER`/`TYPED_ACCESS_NEGATIVE` + C1c describe 2 用例） | 逐条落实，另加 `c` 标量与 `e` 元素位正向断言（加强） | — |
| T-1 偏差（SA3 报告 Deviations 第 1 行）：数组元素锚由 `PathValue<PathAt<M,['e',0]>>` 改为 `PathElementValue<PathAt<M,['e']>>` | 同上 `:167` | **接受**：原形态在类型系统内不可行——访问面 path 段约束 `readonly string[]`（`VfslTypedAccess` 六方法签名，protocol `index.ts:120/126` 等），数字字面量段不落入键空间 ⇒ 必产 `UnknownPath<[0]>` 假红；替换形态锚定同一事实（元素叶投影 = `number`，经 `PathElementValue` 的 `Record<\`${number}\`, elem>` 解包，protocol `:96-103`）。设计强制的 `['b']` 标量/patch 正负例/负例文件均按原文实现，断言强度不降；偏差已在报告显式记录 | 非阻断偏差（记录） |
| T-2（C1e）JSON 克隆 DERIVED、`b` 值侧改 `{kind:'xml'}`、断言抛错含 `structure/value desync` | `generate-int-range.test.ts:221-231` | 落实：`{kind:'xml'}` 是 `ValueSchema` 合法变体（`derived.ts:47`）故可赋值；leaf 白名单（`emitter.ts:339-348`）排除 xml ⇒ `desync(node, value, path)`（`:533` 模板含稳定片段，本轮亲验）；前置守卫 fail loud | — |
| T-3（C3b）FIXTURE 增补 u/r + pp/ppe/ppr/ppu（零碰撞）；7 组配对同 ok/同码/path 新鲜回显；码集合 ⊆ 两枚冻结码；既有 7 断言零改动 | `resolve-schema-at-path-int-range.test.ts:29-34`（FIXTURE 追加）、`:107-192`（FROZEN_CODES/failureCode/WILD_SEG/PAIRED_FAILURES + describe 3 用例） | 落实：7 组配对与设计 §7 T-3 列表逐行一致；`failureCode` 断言 `result.path` 深等入参副本且 `not.toBe`（新鲜回显是文档化契约——`resolve-schema-at-path.ts:63-71/85-87`）；失败分类静态核验：形状守卫 `:100-104` 对 `{}` 段判 `SCHEMA_PATH_INVALID`（`[...path]` 新鲜副本），叶终态下钻经 `classifyStructureReject` `:362-372` 判内容级 `SCHEMA_PATH_NOT_FOUND`（hasTerminal 分支）——int/range 与 pattern 同走 `default` 值级终态（`:289-291`） | — |
| T-3 偏差（SA3 报告 Deviations 第 2 行）：野段 `{}` 经 `{} as unknown as string` 驱动 | `:121`（WILD_SEG） | **接受**：公共签名为 `readonly (string \| number)[]`，注入非 string|number 段必经 cast；仓内先例亲验（`runtime-readdata-hostile-path-guard.test.ts:59` `as unknown as readonly (string \| number)[]`）；被测行为是公共敌意通道（path 形状守卫），非可信域违规 | 非阻断偏差（记录） |
| T-4（C3c）自包含装置六步（imports/TXT_316/常量与播种/makeHandle316/makeReadyRuntime316/逐例 close） | `runtime-readdata-int-range.test.ts:21-83` | 逐步落实：imports 全真实（`compileSchemaEnvelope`/`resolveSchemaAtPath`/`ReadDataSchemaProjection` 均为 `@nomicore/vfsl` 实导出，`index.ts:125/126/324` 亲验；`@nomicore/vfsl` 是 namespace-runtime 依赖，package.json:25）；TXT_316 七字段与设计 §7 T-4 步骤 2 逐字一致（含 `/** 库存计数 */` 行内 doc）；seedRoot316 值（50/7/1/[4,7]/k→5/2/'aaa'）逐项一致；META docId/createdAt→seedRoot→createDoc 顺序与 fixture `:84-88` 同构；`expect.poll(interval 10, timeout 5_000)` 同款 `:96`；每个 `it` `try/finally await runtime.close()` | — |
| T-4 断言清单（三键/50/条件键/range/元素叶/docs/detached/失败配对） | `:114-264`（10 用例） | 全覆盖且加强（另加 `['r','k']` Record 值叶、`['u']` union 叶、`oracle` 独立预言机全四件套深等对照）；失败配对按 SA2 N1 修正后机制断言（`PATH_NOT_ALLOWED` + 无 `schema` 键 + path 回显）——与 `doc-runtime/src/read.ts:46`（失败形状无 schema 键）与 `runtime.ts:485`（原样透传）一致 | — |
| T-4 平行装置声明 | 文件头注 `:8-14` | 落实（配方镜像来源行号、不扩共享 fixture 的理由、唯一复用件 `real-persistence-scheduler.ts` 只读 import 均显式） | — |
| T-5（C1d，可选） | 未实现 | 设计明示可选（「若 Host 只要求最小集可缓做」）；SA3 报告 Deferred 表显式记录并给出既有 `generate-cli-check.test.ts` 覆盖理由 | 非阻断（按设计） |
| `.test-d.ts` 镜像（T-1 二择一可选项） | 未实现（选 program 级主落点） | 设计明示二择一；主落点已落地且更直接（编译真实生成物、免镜像漂移、无全局增广外溢） | 非阻断（按设计） |
| 设计 §10 DENY 全表 | `git status`/`git diff` | 全部未触碰（生产 src、domains、docs、CI、根配置、fixture、scheduler、既有测试断言） | — |

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
| --- | --- | --- | --- |
| codegen 编译级/负控测试 | `packages/vfsl-codegen/test/` | 扩展 `generate-int-range.test.ts`（复用 `tsc-helper.ts` 既有 helper） | 正确 |
| resolve 同构配对测试 | `packages/vfsl/test/` | 扩展 `resolve-schema-at-path-int-range.test.ts` | 正确 |
| readData 端到端 | `packages/namespace-runtime/test/` | 新文件自包含装置 | 正确；符合 `packages/namespace-runtime/AGENTS.md`（读在 sequencer 外、公共面只暴露 detached 投影、测试 seam 保持内部——`../src/runtime.js` import 与既有 #273 测试同款先例，观察面仅 `readData`/`getStatus`） |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
| --- | --- | --- | --- | --- |
| 孤立 program 编译断言 | `tsc-helper.ts` + `compileInTempDir`（既有 `generate-int-range.test.ts:92-106`） | T-1 直接复用同 helper 与 try/finally cleanup | 一致 | 零新装置 |
| `.test-d.ts` 镜像 / program 级 | `generate-number-literals.test-d.ts:15,30` | 选 program 级（设计备选 5 的主落点） | 一致 | 二择一按设计 |
| readData 测试装置 | `readdata-schema-projection-fixture.ts:73-98`（#273 契约工件） | 同配方新文件私有四件（TXT/seed/handle/ready） | 一致（经显式声明） | F1 方案 (b) + 设计备选 6 四条理由；共享件仅 `real-persistence-scheduler.ts` 只读 import（该助手头注自证非 vitest 收集，issue #107 必填背景） |
| 局部 FIXTURE 先例 | #351 的 `resolve-schema-at-path-int-range.test.ts` 文件内局部 FIXTURE | T-4 同构决策 | 一致 | 备选 6 (ii) |
| 野段 cast 先例 | `runtime-readdata-hostile-path-guard.test.ts:59` | `WILD_SEG` 同款 `as unknown as` | 一致 | 敌意通道注入惯例 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
| --- | --- | --- | --- |
| 域生成物字节 | `domains/vfs3-assets/generated.ts` + CI `--check` | 钉值（本轮再实测一致） | 无（零生产 diff） |
| 失败码集合 | `resolve-schema-at-path.ts:68` 等源码定义 | `FROZEN_CODES` 测试内字面量（断言素材，非第二实现） | 无（ADR 0016 冻结契约的字面引用） |
| T-4 投影期望 | `@nomicore/vfsl` 公共 API（`compileSchemaEnvelope`+`resolveSchemaAtPath`） | `oracle()` 经同一公共 API 构造 | 无（非旁路第二实现；与 runtime 组合面同源同库） |
| 装置配方 | fixture `:73-98`（只读参照） | 新文件私有四件 | 低且已显式管理（设计 R6：漂移只使新文件自身红，fail loud） |

### 生命周期对称性

| Start or acquire | Stop or release | Failure recovery | Assessment |
| --- | --- | --- | --- |
| T-4 每 `it` 自建 runtime（P0→ready 有界 poll 5s） | `finally { await runtime.close() }` 逐例收尾（`close` 幂等） | poll 超时/构造抛错即红（fail loud，无静默跳过） | 对称，与 #273 red 测试逐例收尾同款 |
| T-1/T-1n 临时目录 `mkdtempSync` | `finally { cleanup() }`（rmSync recursive） | 编译诊断失败即红 | 对称（复用既有 helper 形态） |

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
| --- | --- | --- | --- |
| T-4 自建装置（~30 行私有构造） | fixture 的 makeHandle/makeReadyRuntime | 新文件内镜像配方 | 已显式声明（设计 F1 方案 (b) + 备选 6 + 文件头注）——非未声明平行装置；无第二套调度器/持久化/编译实现（oracle 走公共 API） |
| 其余（cleanup worker/重试循环/新 API wrapper/新状态字段） | — | — | 无：全部为既有入口上的加法观察点 |

## 6. 文件范围审查

| Changed path | ALLOW entry | Purpose | Assessment |
| --- | --- | --- | --- |
| `packages/vfsl-codegen/test/generate-int-range.test.ts`（M） | 设计 §10 ALLOW 下半段第 1 行「扩展：T-1 + T-2」 | 缺口 (c)/(d) | 吻合；纯加法（diff 仅注释段 + 新代码块；既有 10 用例零改动） |
| `packages/vfsl/test/resolve-schema-at-path-int-range.test.ts`（M） | ALLOW 第 2 行「扩展：T-3（FIXTURE 增补 … 既有 7 断言与既有字段零改动）」 | 缺口 (a) | 吻合；diff 逐行核验：FIXTURE 追加 6 字段 + 首行 JSDoc 注释替换，既有 7 用例与 a~e/p/q 字段原样 |
| `packages/namespace-runtime/test/runtime-readdata-int-range.test.ts`（??新增） | ALLOW 第 3 行「新增：T-4（文件内自包含装置 …）」 | 缺口 (b) | 吻合；自包含装置落实 F1 方案 (b) |
| `wiki/raw/task_issue-316_sa3_impl.md`（??新增） | 技能固定产物 | SA3 报告 | 合规（非本 SA4 职责内产物，存在性记录） |
| （未改动）`readdata-schema-projection-fixture.ts` / `real-persistence-scheduler.ts` / 生产 src / domains / docs / CI / 根配置 | DENY 各行 | — | 零触碰（`git status --short` 亲验；fixture 与 scheduler 无 diff） |

无 ALLOW 外路径、无 DENY 触碰。`git diff --check` exit 0。

## 7. 契约连锁审查

生产零改动 ⇒ 无运行时/类型/时序契约变化；受影响者仅为测试观察点。逐项核对新增测试对公共契约的消费是否正确：

| Contract | Caller | Actual handling | Risk | Finding |
| --- | --- | --- | --- | --- |
| `resolveSchemaAtPath` 失败联合（两枚冻结码 + path 新鲜副本） | T-3 `failureCode` | 断言 ok:false、码 ∈ 冻结集、path 深等且非同一引用——与 `resolve-schema-at-path.ts:63-71` 契约一致 | 无 | — |
| path 形状守卫（敌意通道，`SCHEMA_PATH_INVALID`） | T-3 WILD_SEG 配对 | `:100-104` 亲验：非 string/number 段 → INVALID + `[...path]` 副本 | 无 | — |
| `VfslTypedAccess` 访问面（`patch/read` 签名、`PathElementValue` 元素投影） | T-1 consumer | 六个 import 名均实导出（protocol `index.ts:59/72/81/96/118/157`）；`patch` 值参 = `PathPatchValue<PathAt<Map, NoInfer<P>>>`（`:120-124`）⇒ `'42'`/`true` 必拒；`PathElementValue` 对 `Record<\`${number}\`,elem>` 解包元素节点 | 无 | — |
| 生成物 `declare module` 增广合并 | T-1 同 program（generated+consumer 双 rootName） | `emitter.ts:193-196` 亲验生成 `declare module '@nomicore/vfsl-protocol'`；`tsc-helper.ts:44-47` paths 把协议指到仓内源码 ⇒ 增广与 consumer import 解析到同一模块符号（与 `domains/vfs3-assets/generated.ts:24-27` 消费形态同款） | 无 | — |
| `NamespaceRuntime.readData` 三键成功 / 失败无 schema 键 | T-4 各用例 | `runtime.ts:486` 恰三键亲验；`doc-runtime/src/read.ts:46` 失败形状 `{ok,code,path,message?}` 无 schema 键亲验；断言 `Object.keys(r).sort()` 恰三键 / `Object.hasOwn(r,'schema')===false` | 无 | — |
| `cloneValueSchema` int 条件键 / range 双键（ADR 0016 detached） | T-4 bare/c 用例 + 键集断言 | `read-schema-projection.ts:172-183` 亲验：裸 int 不补 undefined 槽（`Object.keys===['kind']` 断言可杀补槽弱实现）、range 双键必在 | 无 | — |
| `compileSchemaEnvelope` 公共入口（oracle） | T-4 `oracle()` | `index.ts:324` 实导出；ENV 四键（lang/version/id/text）与 fixture `:79` 同形（envelopeStrictGate 兼容） | 无 | — |
| CI/vitest 发现面 | 3 个测试文件 | 根 include `packages/*/test/**/*.test.ts`（`vitest.config.ts:15`）；`scripts/ci-test-shard.mjs` 磁盘枚举（头注明示新增文件必落入某片）；两个修改文件的包 tsconfig include `test/**` ⇒ `pnpm typecheck` 覆盖其类型面；新文件所属包 tsconfig 仅 src/**（见 §12 N2） | 无（发现性成立） | — |

## 8. 错误、恢复与并发

- **无新增错误路径**：生产零改动。测试侧全部 fail loud——前置判别失败/装置失败均以抛错或断言红呈现（`derive()`/`oracle()`/`readOk()`/篡改前提守卫都带实际 issues/code 的诊断信息）；无 try/catch 吞错、无静默 fallback、无「装置不可用则跳过」。
- **恢复/等待**：T-4 ready 轮询有界（5s）超时即红；T-1 临时目录 finally 清理。无重试语义引入。
- **并发**：无变化（`maxWorkers:1` 既有配置；readData 同步快照读；每 `it` 独立 runtime + 独立 Y.Doc，无跨用例共享可变状态；`WILD_SEG` 为无状态共享对象，多行复用无污染）。
- **诚实部分失败**：T-2 篡改前置（ROOT 非 object / 字段缺失）显式 throw 而非静默通过；T-4 `readOk` 对 ok:false 抛出携带 code 的错误——杜绝把失败伪装成通过的假绿。
- **静态无法确认项**（不猜通过）：三条测试文件在真实 runner 的实际通过性、全量回归无串扰（§11 转动态验证）。

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
| --- | --- | --- | --- | --- |
| `generate-int-range.test.ts` C1c-1（consumer 同 program） | generated+consumer 0 诊断：读投影（b/c 标量、e 元素）= number、`patch` 正例、`'42'`/`true` 两条 `@ts-expect-error` 锁定 | 根 vitest include → CI 6 分片磁盘枚举 | 无：正例在前（非空转——负例文件单独证明投影非 any/string）；`@ts-expect-error` 反噬机制在（投影退化 any ⇒ TS2578 ⇒ 0 诊断断言红） | — |
| C1c-2（负例恰 1×TS2322） | `PathValue<…>='42'` 恰 1 条且 code=2322 | 同上 | 无：恰 1 条同时杀死「投影退化 any/string（0 条）」与「无关额外诊断（>1 条）」两种假形态 | — |
| C1e（desync 负控） | leaf+xml 篡改必抛含 `structure/value desync` | 同上 | 无：白名单放成 catch-all 即红；消息只钉稳定片段不冻结全文（SA6 §12.8 纪律） | — |
| `resolve-…-int-range.test.ts` C3b-前提 | u/r/pp/ppe/ppr/ppu 投影深等（union 首成员 int、pattern 各形） | 同上 | 无：配对断言非空转的直接证明 | — |
| C3b-配对（7 组 it.each） | 逐组双侧同码（6×NOT_FOUND + 1×INVALID）、path 深等入参 + 非同引用 | 同上 | 无：与 SA6 探针 A 的 7 组完全同集；`['b',0]↔['pp',0]` 等数字段配对覆盖既有用例未覆盖面 | — |
| C3b-码集合 | 14 条失败路径（含既有例复算）观测码 ⊆ 两枚冻结码且非空 | 同上 | 无：为 int/range 新增第三码即红 | — |
| `runtime-readdata-int-range.test.ts` 前提~docs（8 用例） | ready 可观察预写值 50；三键；`{kind:'int',min,max}` 深等 + oracle 全四件套对照；裸 Int 键恰 `['kind']`；range 双键；`['e',1]`/`['r','k']`/`['u']` 叶形；docs 含 `ROOT.b` 非空 | 同上 | 无：值断言锚 F1 验收点（预写值可观察）；键集断言可杀「补 undefined 槽」弱实现（`toEqual` 对 undefined 键不敏感，故显式 `Object.keys` 断言是必要且在场的） | — |
| detached 隔离（1 用例） | 两读内容全等但引用不共享；`isFrozen===false`；污染 valueSchema/docs 后重读逐字等于 pristine | 同上 | 无：同时杀死「返回活 schema」「共享缓存」「冻结伪装 detached」三种弱实现 | — |
| 失败配对（1 用例） | `['b','x']↔['p','x']` 同码 `PATH_NOT_ALLOWED`、无 `schema` 键、path 回显 | 同上 | 无：与 pattern 叶同码断言即 AC3 在组合面的同构证据 | — |
| skip/only/todo/failing 扫描 | — | grep 三个改动文件 | 零命中（本轮亲验） | — |

**测试发现性**：三文件均匹配根 include；两修改文件类型面进 `pnpm typecheck`（包 tsconfig 含 `test/**`）；SA3 另对新文件做单文件 strict tsc（补偿该包 tsconfig 不含 test 的存量缺口，见 §12 N2）。SA3 报告的通过计数（13/16/10、4 文件 44 用例）与代码逐条可数的用例结构吻合（13=10+3、16=7+9、10、44=13+16+10+5），静态自洽。

## 10. Required revisions

| Finding ID | Severity | Evidence | Problem | Required change | Acceptance | Suggested routing |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | — | 无 BLOCKER / MAJOR / MINOR 阻断项 | — | — | — |

（两项装置级偏差与两项可选项未做均属设计许可范围且已显式记录，见 §4；非阻断观察见 §12。）

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
| --- | --- | --- | --- |
| 三条测试文件在真实入口的实际通过性（SA4 静态不运行） | 全量 `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck`（或焦点 3+1 文件） | 新增/扩展用例全绿、`Type Errors no errors`、总数较基线 3863 净增 22 | 任一新用例红或既有用例回归 |
| C1c 两条编译断言在当前 TS 版本的诊断计数稳定性 | 焦点跑 `generate-int-range.test.ts` | consumer 0 诊断；负例恰 1×TS2322 | 计数漂移（>1 或 0）——若出现属协议/TS 交互漂移，须回 routed 设计面评估 |
| T-4 装置在 CI 分片环境的 ready 时序 | CI test 分片（Node 20/24 × 6） | 10 用例稳定绿（SA6 探针 C 实测即时 ready；poll 5s 上限） | 间歇性 poll 超时红（环境慢）⇒ 按设计 §13 R2 处置 |
| `pnpm generate --check` + 全量门禁（AC2/AC4 终验） | CI codegen-freshness / typecheck / test 作业 | 双 exit 0；钉值不变 | 任何 exit≠0 |
| 突变敏感性实证（可选加固，非本票必要条件） | SA7/复核面按 SA6 §12.7 矩阵抽查（如回退 `number`→`string`） | 对应变红（C1a/C1c/C3b/C3c） | 突变不红 ⇒ 哨兵失效需回炉 |

## 12. Non-blocking observations

| ID | Observation | Suggested precision fix（不阻断） |
| --- | --- | --- |
| N1 | T-4 首条用例标题「writeData/readData 装置可观察预写值」中 `writeData` 一词有误导性：runtime 无 `writeData` 公共键（写路径是 `mutateData`），且装置预写值是 runtime 构造前经 Y.Doc 播种的，全文件无任何写路径调用 | 标题改为「seeding/readData 装置可观察预写值」类措辞；纯文案，无行为影响 |
| N2 | 新文件 `runtime-readdata-int-range.test.ts` 的类型面不在任何**持久**门禁内（`packages/namespace-runtime/tsconfig.json` 仅 include `src/**`；vitest typecheck 仅收 `*.test-d.ts`）——SA3 以一次性 strict tsc 单检补偿，且该包全部既有 `*.test.ts` 同处此存量缺口（非本票引入） | 记录为包级存量观察；如需收口属独立工程决策（改包 tsconfig include 面），不属本票 |
| N3 | C1e 的 `JSON.parse(JSON.stringify(DERIVED))` 往返会丢弃值为 `undefined` 的自有键（如裸 Int 的 `min`/`max` 本就整键缺席，语义不变；`keyPattern: undefined` 类条件键同理无害），篡改目标 b 带参不受影响 | 若未来扩展篡改面到条件键敏感路径，改用 structuredClone；当前无影响 |
| N4 | T-3 码集合用例以「复算失败清单」而非字面遍历「既有 7 用例」表达「全文件失败码 ⊆ 冻结集」——清单覆盖了既有两例路径（`['b','x']`/`['e',0,'x']`）并扩至 14 条，语义等价且更强 | 无需动作（记录口径） |

---

## 收尾结论

- **Verdict：`approve`**。SA3 实现与批准设计（iteration 1）逐项对应、纯加法、零生产改动；ALLOW/DENY 严丝合缝；AC2 字节钉值本轮再实测一致；测试断言非空转、fail loud、敏感性行状齐全；两项装置偏差显式记录且强度不降；两项可选项未做均系设计明示许可。
- `requiresConflictRecheck: false`：零生产改动、零接口/协议/wire/schema/持久化/状态机语义变化；测试-only 加法不触碰任何 ADR 冻结面（错误码集合、指纹前缀、docs 切片、域字节基线全部原样）。
- 运行事实（三条文件实际绿灯、全量回归、CI 作业）未由 SA4 复跑（静态技能约束），已列 §11 供 Controller 路由动态验证。
