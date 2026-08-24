# 任务简报（修订轮 round 2）— namespace-runtime replaceSchema：provided-root 静默投影偏差修复（issue #91）

## 元数据

- run_id: issue-91-1787570858-562378
- round: 2（post-publish 修订轮；round 1 已交付 commit 7770f2f、PR #101 CI 全绿）
- branch: fix/issue-91-on-docs-namespace-runtime
- worktree: /home/wangjian/nomicore-fix-issue-91
- 任务类型: **Bug 修复**（规格偏差导致静默数据丢失 + 拼写错误掩盖——merge-blocking）
- 前一轮档案: wiki/raw/task_namespace-runtime-replace-schema*.md（设计 D7、锚 15、AC 清单等——本论全部以本简报为准，D7 投影裁决被本修订**取代**）

## 触发：人工 review 反馈（merge-blocking，原文要点）

Issue #91 AC3 与 ADR 0008 规定：调用方提供 `root` 时，它是**完整最终 logical ROOT snapshot**，应原样接受封闭对象校验；出现未声明字段时应 `ok:false`、零写入，而不是先修改输入再校验。

当前偏差：`packages/doc-runtime/src/schema-replace.ts` 在 provided-root 路径的校验与 detached 构造前调用 `projectDeclaredRootKeys()`，**静默删除 proposed schema 未声明的顶层键**——例如 root 里多传 `email` 会被悄悄剥离并返回 `ok:true`，造成永久数据丢失，字段拼写错误也被掩盖。

## 权威依据

- Issue #91 AC3（TASK.md）：「提供 root 时，将其视为完整最终 logical ROOT，完成验证与 detached 构造后整体替换内容」
- ADR 0008 §ROOT write 与 SCHEMA write 第 3 条：「提供 `root` 时，将其视为最终完整 logical ROOT snapshot，验证并 detached 构造完整新内容」
- ADR 0008 §Fatal 与失败通道 / 0007 底层决策：可预期失败走领域结果联合、零写入；「未声明字段拒绝」（CONTEXT.md 封闭对象条目）
- round 1 的 D7「顶层声明域投影」是**本仓库自创的越权语义**，ADR 0008 全文无任何投影授权——本修订将其废止

## 必须修订（7 条，逐条验收）

1. 删除 provided-root 路径中的 `projectDeclaredRootKeys()` 静默投影。
2. 将调用方提供的完整 ROOT **原样**传给 `validateLogicalSnapshot()` 和 detached builder（buildTopEntries），以及 ⑥ verifySnapshotIntact。
3. 未声明顶层键与嵌套未知键一样响亮失败：返回 `ok:false` 和明确指向该未知键的 issue（vfsl validate.ts 封闭对象「未知字段 "<k>"」天然覆盖顶层——path=[<k>]）。
4. 失败时保持 SCHEMA、ROOT、active tools 完全不变，且不调用 dirty notifier（0 Yjs update）。
5. 删除或修订把静默剥离定义为正式契约的文档：`CONTEXT.md`（"顶层声明域投影"相关段落）、`packages/namespace-runtime/src/schema-write.ts` 的公共 JSDoc、以及其他设计材料中的同类表述（含 schema-replace.ts 头部/函数注释）。
6. 修订测试 `runtime-replace-schema-sa7-dynamic.test.ts`（及相关用例）：把"顶层未知键 → ok:true 并剥离"改为断言 `ok:false`、issue 指向未知键、0 Yjs update、0 dirty notifier、SCHEMA/ROOT/active tools 均不变。
7. 保留既有正确行为，全量门禁必须绿：`pnpm typecheck`、`pnpm test`、`tsc -p tsconfig.typecheck.json --noEmit`（基线：84 files / 1078 tests）。

## 侦察清单（总控已核实，行号为 round 1 交付态）

**代码**
- `packages/doc-runtime/src/schema-replace.ts:170` `projectDeclaredRootKeys()` 调用（provided-root 分支）；函数本体 :318-337；头部/注释引用 :18-19、:37、:46-47、:134、:168-169、:300-316；`narrowed` 字段 :89-90、:128、:188（⑥ 现喂投影形态，修订后喂原样 snapshot）
- `packages/namespace-runtime/src/schema-write.ts:69-85` `ReplaceSchemaInput.root` JSDoc（"未声明顶层键不进入新 generation…被剥离且 ok:true 不携带任何反馈"段必须改写为响亮拒绝契约）

**测试**（相关用例）
- `packages/namespace-runtime/test/runtime-replace-schema-sa7-dynamic.test.ts`：
  - :439-463「A2-顶层剥离」断言 ok:true + 剥离 → **必须翻转为 ok:false 契约**（review 第 6 条主靶）
  - :465-491「A2-嵌套 loud」保持（既有正确行为）
  - :493-518「A2-union 不投影」保持（union 本就 loud）
  - :24-25、:436-438 头部/describe 表述同步修订
- `packages/namespace-runtime/test/runtime-replace-schema-sequencer.test.ts:672-697`「AC3 排队期间输入引用可变化」：当前 root 含 `b:true` 且槽起点 schema 换成 ns-2b（只声明 {a,n}）——**新契约下该输入将 ok:false**；该用例的测试意图是"槽起点快照获胜"，须改输入数据保持原意图（如 root 去掉 b，或换用声明 b 的 schema），不得削弱快照时点断言

**文档**
- `CONTEXT.md:17-19`「顶层声明域投影」术语条目 → 删除或改写为"provided root 原样封闭校验、未声明键响亮拒绝"
- docs/ 全集无其他同类表述（已扫描）；wiki/raw/ 下 round 1 档案为历史记录，**不改写历史**，由本轮 rev1 档案显式记录取代关系

**版本 bump**（HG #9）
- `packages/doc-runtime/package.json` 0.1.9 → 0.1.10
- `packages/namespace-runtime/package.json` 0.1.3 → 0.1.4

## 红灯锚定要求（SA6）

新契约红灯（当前代码下必须真实红）：
- R2-1 顶层未声明键（map 形 ROOT）：`{schema: ns-2b(声明{a,n}), root:{n:999,a:'x',b:true}}` → `ok:false`、issue message 含 `"b"` 且 path 指向 `['b']`、0 update、0 notifier、state 字节不变、SCHEMA/ROOT/active tools 三不变
- R2-2 保持项回归锚：嵌套 loud / union loud / 合法 provided-root 幸福路径（ns-2 × {n,a,b}）ok:true 不变
- R2-3 sequencer 快照时点用例修订后仍锚定"槽起点快照获胜"语义

## 既有正确行为（不得回归）

keep-root 提取验证、envelope 形状守卫、probeSchemaMap 级联、单事务恰 1 update、SCHEMA 恰四键、双顶层 identity 保持、⑤-S/⑤-R/⑥ 写后校验、fatal 三分类（E201/E203/E204 与槽位 schema-compile-throw 等）、AC1–AC10 其余各条、84 文件 1078 用例基线。

## 完成事务边界

总控只写 REPORT.md（status: complete / run_id / branch / round: 2）；**禁止** git push、PR、.mabf-done、GitHub label——发布由 Host 唯一执行。

## SA6 红灯记录（round 2，2026-02-20 实跑）

### 修订/新增用例清单（只改测试文件，零生产代码触碰）

**`packages/namespace-runtime/test/runtime-replace-schema-sa7-dynamic.test.ts`**
- R2-1（新增契约红灯，替换原「A2-顶层剥离」用例）：ns-2b（声明 {a,n}）× root `{n:999, a:'x', b:true}` → 断言 `ok:false`、存在 path 恰为 `["b"]` 且 message 含 `"b"` 的 issue、0 Yjs update、0 dirty notifier、state 字节不变、SCHEMA（ns-1）/ROOT（identity 保持 + 键集恰 {a,n} + 无 b）/active tools（ns-1）三不变、非 fatal 且 schemaWrite 仍 enabled。
- 头部/describe 表述同步修订（:4、:18、:24-25、:437-440）：「顶层静默剥离」→「rev2 契约：provided root 原样封闭校验、未声明键响亮拒绝」；γ/⑥ 注释中 `projectDeclaredRootKeys`/`narrowed` 措辞改为 `buildTopEntries`/原样 snapshot（行为断言零改动）。
- 保持不动（既有正确行为锚）：A2-嵌套 loud（:486）、A2-union 不投影（:514）、α/β/γ fatal 注入、A1 四变体、AC9 时序、⑥ 快乐路径。

**`packages/namespace-runtime/test/runtime-replace-schema-sequencer.test.ts`**
- R2-3（:672-697 快照时点用例修订）：输入初始 root 由 `{n:1, a:'x', b:true}` 改为 `{n:1, a:'x'}`——b 是调用时 schema（ns-2）才声明的键，新契约下保留它会让槽起点快照（ns-2b × {n:999,a:'x'}）校验 ok:false，遮蔽原测试意图。快照时点断言原样保留：排队期间改 schema→ns-2b、root.n→999，最终 `ok:true`、notifier 恰 1、`read(['n'])===999`、`getSchemaEnvelope().id==='ns-2b'`（槽起点快照获胜）。

### 红灯实跑证据（当前代码 = 投影仍在，后台独立进程）

```bash
./node_modules/.bin/vitest run --no-typecheck packages/namespace-runtime/test/runtime-replace-schema-sa7-dynamic.test.ts packages/namespace-runtime/test/runtime-replace-schema-sequencer.test.ts
# exit=1（1 failed | 21 passed）
```

- **R2-1 真实转红**：`AssertionError: expected { ok: true } to match object { ok: false }`（runtime-replace-schema-sa7-dynamic.test.ts:461）——当前代码静默剥离顶层键 b 并返回 ok:true，新契约断言逐一不成立，红灯成立；
- **R2-2 保持项回归锚全绿**：A2-嵌套 loud ✓、A2-union 不投影 ✓、⑥ 快乐路径 ✓、α/β/γ fatal、A1 四变体、AC9 时序 ✓（sa7-dynamic 9 tests 中仅 R2-1 红）；
- **R2-3 修订后全绿**：sequencer 13 tests 全过（快照时点断言未削弱）。
- 基线对照（修订前，当前代码）：2 files / 22 tests 全绿（round 1 交付态）。
- 全量对照（修订后，当前代码）：`vitest run --no-typecheck` → **Test Files 1 failed | 75 passed (76)；Tests 1 failed | 1020 passed (1021)**——全仓唯一失败即 R2-1 新契约红灯，其余 75 文件 1020 用例全部保持绿（含 keep-root/AC1–AC10/fatal 三分类等既有锚，无一受修订影响）。

### 修绿方向提示（供 SA3，非约束）

删投影后 provided-root 路径为 validateLogicalSnapshot(原样)→buildTopEntries(原样)→probeRoot→⑥(原样)；顶层未知键由 validate.ts 封闭对象「未知字段 "<k>"」以 path=[k] 自然覆盖（R2-1 断言兼容 validate 与 detached-build F7 双 loud 任一来源）；γ 用例的 E204 经 buildTopEntries 内 makeRefResolver 环守卫保持可达。
