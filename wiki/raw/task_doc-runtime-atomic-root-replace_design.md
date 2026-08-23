# SA1 设计 — doc-runtime：复用 detached builder 并原子替换 ROOT 内容（issue #88）

- 任务：`wiki/raw/task_doc-runtime-atomic-root-replace.md`（Issue #88，功能开发，ADR-0008「必要的底层演进」第 3 条直接落实）
- 红灯锚点：`packages/doc-runtime/test/replace-root-content.test.ts`（SA6 Phase 1，13 用例 / G1–G7）——红灯构成（R2 更正，SA2 攻击点 1）：**12/13 构造性红灯**（缺导出）+ **G1 为 fixture 二次集成缺陷**（任何实现下不可转绿；登记与修复裁决见 §1.5/D12）
- 决议基准：`wiki/raw/task_doc-runtime-atomic-root-replace_relevant_decisions.md`（ADR-0008 授权 + ADR-0007 继续有效条款）
- 改动基线：branch `fix/issue-88-on-docs-namespace-runtime`（base `docs/namespace-runtime`，`pnpm test` 927 绿 / typecheck 六包绿）

---

## 摘要（一页看懂）

本设计把 `materialize.ts`（711 行）中已定谳的 detached 构造资产**收敛为三个包内 seam 模块**（纯移动、
逐字不变，先例 `resolve.ts` 自 extract.ts 的纯移动），再新增编排 `replace.ts`：`replaceRootContent(derived,
snapshot, doc)` 与 `materializeRoot` 共享同一 ⓪ guard / ② builder / ⑤⑥ 校验，唯一编排差异是 ③ 不做
「ROOT 空置」判定、④ 在**同一 doc.transact 内** `clear()` + 安装——这正是 ADR-0008 授权的独立职责
（materializeRoot = 创建路径只装空 ROOT；replaceRootContent = 替换路径清空并装任意 ROOT）。顶层
`doc.getMap('ROOT')` identity 由「在原实例上 clear」结构性保持（实测 P1）；旧子类型引用自然失效（不
diff、不补偿）。嵌套事务语境（简报 ⚠️ 设计决策点）**裁决为最外层语境专用**（SD-6/D6）：与冻结测试
G7、materializeRoot rev2 RD7-P1 hard contract 同族；ADR-0008 SCHEMA write 的同事务组合需求由**未来
组合 seam 自开事务**满足（本设计的 builder 收敛正是为它预留的单源构造点），不通过放开嵌套调用解决。

**R2 修订（SA2 R1 reject → 逐条落实）**：① 登记冻结 G1 fixture 二次集成缺陷（三重证据 + SA1 独立
复现），裁定最小接线修复——断言逐字保留、不变量「每个手工 Y 实例恰被集成一次」、授权 SA3 执行
（§1.5/D12/§12）；② detached-build 的 `@internal` 辅助/类型共享接缝显式写死（§3.1，SA2 攻击点 2）；
③ E200 命名定调模块名制（D8，SA2 攻击点 4）；④ RA-9 增补 + 可重跑脚本清单（§9，SA2 攻击点 3 补偿）。

### 决策总表（D1–D11）

| # | 决策 | 一句话结论 | 章节 |
|---|---|---|---|
| D1 | 公共接缝与结果联合 | `replaceRootContent(derived, snapshot, doc)` → `{ok:true} \| {ok:false; issues: ReplaceIssue[]}`，经 index.ts 导出；同步、可预期失败经返回值传递（ADR-0008） | §2 |
| D2 | 模块分解：builder 收敛为包内 seam | 新建 `detached-build.ts`（② 构造规则单源 + `@internal` 辅助/类型共享面——R2 显式写死，SA2 攻击点 2）/ `tx-guard.ts`（⓪）/ `install-verify.ts`（⑤⑥），全部自 materialize.ts **纯移动逐字不变**（resolve.ts 纯移动 + walk @internal 两先例）；replace.ts 与 materialize.ts 均为薄编排 | §3 |
| D3 | 六阶段编排镜像 | ⓪①②③④⑤⑥ 与 materializeRoot 逐阶段同构；唯二差异 = ③ 无空置判定、④ clear+install | §4 |
| D4 | 单事务语义与 update 计数法则 | clear+install 在恰一个 doc.transact 内；对外可观测 update 事件数 = 变更集非空 ? 1 : 0（实测 P1/P4/P5）；observer 重入写开新事务属 yjs 机制，其偏离由 ⑤ 检测 | §4.3 |
| D5 | 顶层 identity 保持机制 | 永不重建/替换 ROOT 实例：`getMap('ROOT')` 惰性取得同一实例，clear 在原实例上删键；旧子类型引用自然失效（ADR-0007「不做 identity-preserving diff」+ ADR-0008「旧子类型 identity 可失效」） | §4.3 |
| D6 | 嵌套调用裁决（简报设计决策点定谳） | 最外层语境专用：未闭合外层事务 / 派发窗口 / 不可判定 → throw DOCRT-E202 零写入（G7 锚定不收窄）；SCHEMA write 同事务组合 = 未来组合 seam 自开事务，消费 buildTopEntries 产物 | §5 |
| D7 | ⓪ guard 参数化 | `assertOutermostTransactionContext(doc, api)`——A/B 变体消息 `${api}` 插值，materializeRoot 侧渲染结果与 rev2 §3.4 逐字定稿**字节相同**（既有测试文本锚不受影响）；C 变体共享常量原样 | §4.1 |
| D8 | 消息族 | E201（⑤ 变体 + ⑥ 变体 C/D）沿用现有 generic 文案（不点名，天然两用）；**E200 点名模块名**（R2 定调，SA2 攻击点 4）——replace 侧 `DOCRT-E200: replace 内部错误（意外异常）`，与 materialize 侧 `materialize 内部错误` 同基调（两制并存且均兼容既有 `/DOCRT-E200/` 正则锚）；ROOT 载体 issue 沿 materialize 同款结构（载体词 + 拒因尾巴，不点名） | §4.2/§4.4 |
| D9 | issues 透传纪律 | 逻辑失败 = validateLogicalSnapshot 完整 issues **引用透传**（G3-1 `toEqual` 直调结果）；构造/载体失败 = 恰 1 issue fail-fast（G3-2/G3-3） | §4.2 |
| D10 | 版本 bump | `@nomicore/doc-runtime` 0.1.5 → 0.1.6（新增公共 seam，rev2 RD11 先例） | §12 |
| D11 | 依赖方向无环 | 模块 DAG（边全集 §3.1）：replace/materialize → {detached-build, tx-guard, install-verify}；install-verify → detached-build（`@internal` 辅助/类型）+ extract/resolve/xml-parse；detached-build → resolve/xml-parse/carrier——单向无环；无新增第三方依赖 | §3.1 |
| D12 | 冻结 fixture 缺陷裁决（R2，SA2 攻击点 1） | G1 fixture 对 `oldFileTags` 二次集成 → 构造期原生 TypeError、G1 永红（根因更正：12/13 构造性红灯 + G1 fixture 缺陷）；裁定最小接线修复——**断言逐字保留**、不变量「每个手工 Y 实例恰被集成一次」（推荐 `oldFile.tags` 改独立实例）、授权 SA3 执行（回退路径：SA6 重发）；机制知识面入 §1.4 注脚 + RA-9 | §1.5/§8/§9/§12 |

---

## §1. 背景与需求推演（Feature）

### 1.1 任务定位

ADR-0008「必要的底层演进」第 3 条：**「SCHEMA replacement 可复用 detached builder 与原子
ROOT-content replacement helper，不复制 materialization 逻辑。」** 其 SCHEMA write 第 3/4 步进一步定义
行为契约：「提供 `root` 时，将其视为最终完整 logical ROOT snapshot，验证并 detached 构造完整新内容」
「在一个 transaction 中原子替换 SCHEMA 与必要的 ROOT generation」，并明确
「保留顶层 `doc.getMap('ROOT')` identity，在同一 transaction 内清空并安装已 detached 构造的内容；其下
旧 Yjs 子类型 identity 可失效」「新 SCHEMA 的编译、最终 ROOT 校验或 detached 构造失败均发生在
transaction 前，SCHEMA/ROOT 零写入」。

即：本任务 = 把 materialization 的构造能力**去私有化成包内可复用 seam**（但不上公共面），并交付第二个
消费方 `replaceRootContent`。ADR-0007 的取代范围节明文：「detached materialization、validated
mutation、零写入与 observer no-rollback 的底层决策继续有效」——本设计全部服从。

### 1.2 现状锚定：materialize.ts 的可复用资产（改动基线）

`packages/doc-runtime/src/materialize.ts`（711 行）已定谳的资产，按本设计的去向标注：

| 资产 | 现位置（行号） | 去向 |
|---|---|---|
| ⓪ 事务语境 guard（三窗口谓词 + E202 三变体消息） | 113–146 | → `tx-guard.ts`（+api 参数，D7） |
| ② detached 构造：`buildTopEntries` / `rootEntries` / `buildValue` / `buildUnion` / `mapEntries` / `copyJsonDomain` + 形状/域/issue/renderPath 辅助 | 196–210, 477–711 | → `detached-build.ts`（逐字） |
| ⑤ `verifyInstall`（顶层 size + 逐键同一性双断言） | 148–176 | → `install-verify.ts`（逐字） |
| ⑥ `verifySnapshotIntact`（对称重物化）+ `buildScratchInstall` + `productEqual` + `deepEqualValue` + 诊断辅助 + `e201C/e201D`（注：源文件中 196–210 的 `buildTopEntries` 物理上位于 ⑥ 注释块内，逻辑上属 ②——源注释自述「② 顶层 detached 构造（⑥ scratch 与 prepare 共用）」，去向随 ② 行） | 178–194, 212–439 | → `install-verify.ts`（逐字） |
| ①②③ 编排 `prepare`（含 ROOT 空置判定 + E200 崩溃边界） | 441–475 | 留 materialize.ts（创建路径专属） |
| 公共函数 `materializeRoot` + `MaterializeIssue/MaterializeResult` | 43–53、59–111 | 留 materialize.ts（公共契约零变化） |
| 内部遍历类型 `BuildResult/EntriesResult/Path/Resolver` | 54–58 | → detached-build.ts（R2 订正，SA2 攻击点 2：初轮「43–111 留 materialize」区间含混已拆分；`Path/Resolver` 随迁并 `@internal` 导出供 ⑤⑥，`BuildResult/EntriesResult` 模块私有——与 §3.1 导出面清单一致） |

**关键观察**：②⑤⑥ 与 ⓪ 是「管线资产」，①③ 编排里的「ROOT 空置判定」才是 materializeRoot 的创建路径
私货。复用的正确切面 = 按资产性质分模块，而不是让 replace.ts 深依赖 materialize.ts。

### 1.3 差分推演：replace 与 materialize 的语义差集

| 维度 | materializeRoot（创建路径） | replaceRootContent（替换路径，本设计） | 依据 |
|---|---|---|---|
| 目标 ROOT 状态 | 必须空置（非空 → fail「不覆盖、不合并、不 fallback」） | **非空/空/缺席均可**（清空并安装） | ADR-0008「清空并安装」；G1/G2 |
| 旧内容 | 无 | 事务内 `clear()` 整体清除（含快照外键） | G1 `stale` 键消失锚 |
| 顶层 identity | 保持（装到 getMap('ROOT') 本身） | **保持**（clear 在原实例上删键） | ADR-0008；G1 `toBe` 锚 |
| 旧子类型 identity | N/A | **可失效**（全新 detached 实例替换，不 diff） | ADR-0008/0007；G1 `not.toBe` 锚 |
| 事务体 | `set` 循环 | `clear()` + `set` 循环（同一事务） | ADR-0008；G1 恰 1 update 锚 |
| ② 构造失败 / ① 逻辑失败 / ⓪ 嵌套 | 同左 | **逐字同面**（共享同一实现） | AC-1；G3/G5/G7 |
| ⑤⑥ 写后校验 | 顶层完整性 + 对称重物化 | 同左（共享同一实现） | AC-6；G4 |

除「③ 空置判定有无」与「④ clear 有无」两处编排差异外，两入口的行为面**按构造**逐位一致——这是
AC-1「不复制 Y.Map/Y.Array/XML/plain 构造规则」的结构性兑现：不存在第二份构造代码，等价锚 G5 不可能
发散。

### 1.4 根因式澄清：为什么顶层 identity 能保持而子类型必失效

yjs 的 `doc.getMap('ROOT')` 按 name 缓存并返回**同一个集成实例**；`Y.Map.prototype.clear()` 在该实例上
逐键删除（源码 `YMap.js:255-265`，经 `transact` 归并进外层事务）——只要替换管线**永不**对 'ROOT' 名字
空间执行 delete-map/set-other-type，顶层 identity 跨调用恒保持。而安装产物是 detached 构造的**新**
Y.Map/Y.Array/Y.XmlFragment 实例（INV-7 输入引用隔离 + 全容器重建），旧子树实例随 clear 成为不可达
垃圾。此机制已实测（§9 P1）。

**机制注脚（R2，SA2 攻击点 1 知识面）**：同一 detached Y 实例**二次集成** → 首次 `_integrate` 已消费
并置空 `_prelimContent`（`YArray.js:76-80` `this.insert(0, this._prelimContent); this._prelimContent
= null`；`YMap.js:76-82` 同款 `forEach`），二次集成以 null 执行 `insert(0, null)`（Y.Array → 读
`.length`）/ `null.forEach`（Y.Map）→ yjs 原生 TypeError，无防护。这正是 INV-7「一切容器重建新实例」
与本设计「安装全新 detached 实例、旧实例仅由 clear 回收从不复用」（§4.3）的机制必要性；也是冻结 G1
fixture 崩溃的根因（缺陷登记与修复裁决见 §1.5/RA-9）。

### 1.5 冻结验收锚缺陷登记与修复裁决（R2，SA2 攻击点 1 / D12）

**缺陷**：G1 fixture（`replace-root-content.test.ts:337–374`）对同一 `Y.Array` 实例二次集成——
`oldFile.set('tags', oldFileTags)` 经 `root.set('assets', oldAssets)`（test:370）完成 `oldFileTags`
的**首次**集成后，`root.set('keywords', oldFileTags)`（test:373，行内注释「复用 array 实例作为旧
keywords」）对该实例执行**第二次**集成 → yjs 在 **fixture 构造期**确定性抛原生
`TypeError: Cannot read properties of null (reading 'length')`（机制见 §1.4 注脚）。G1 在任何实现下
都到不了 `replaceRootContent` 调用点——**永红、AC-3/AC-4/AC-7 验收门结构性不可达**。

**根因更正（简报 Phase 1 节归纳）**：简报「全部 13 用例红=构造性红灯（包入口未导出）」对 G1 不实；
实跑分解为 **12/13 构造性红灯**（`(0, replaceRootContent) is not a function`）+ **G1 为 fixture 二次
集成崩溃**。本设计以本节登记代更正（SA1 无简报写权）。

**三重证据 + SA1 独立复现（四方一致）**：

1. SA2 隔离复现（`/tmp/sa2-pinpoint.mjs`）：二次集成 Y.Array → `reading 'length'` of null /
   Y.Map → `reading 'forEach'` of null（确定性崩溃）；对照「全新 detached array 装进非空 root
   （clear+set 单事务）」OK——**设计自身安装路径不受影响**（builder 产物每实例恰集成一次）。
2. SA2 健康版 fixture（每实例恰集成一次）：G1 全量断言通过（恰 1 update / identityKept /
   oldAssets·oldAudit·oldKeywords 三组 `not.toBe` / staleKeyGone / plainSameRef——报告 P1 输出）。
3. SA1 R2 独立复现（`/tmp/sa1-r2-verify.mjs`，2026-08-23，yjs@13.6.32 / Node v24）：
   `R2-A: THREW TypeError: Cannot read properties of null (reading 'length')`；`R2-B`（Y.Map 二次
   集成）`reading 'forEach'`；`R2-C` 健康版构造 OK + clear+set 单事务恰 1 update。
4. SA2 冻结测试本机实跑：G1 失败根因即该 TypeError，其余 12 例为缺导出错误——红灯构成实证。

**最小修复裁定（断言逐字保留）**：只修 fixture 接线，不变量 = **每个手工 Y 实例恰被集成一次**。
推荐形态（采纳 SA2 建议）：`oldFile` 的 `tags` 改用独立 `Y.Array` 实例，使 `root.set('keywords',
oldFileTags)`（test:373）成为 `oldFileTags` 的首次（唯一）集成。G1 全部断言语义不变：
`not.toBe(oldFileTags)` 仍验证「旧 keywords 实例替换后不可达」（`oldFileTags` 仍是被替换前的旧
keywords 实例）、`stale` 消失 / 恰 1 update / extract 读回全等与接线无关——SA2 健康版已实测全绿
（证据 2）。允许改动范围 = 该接线区（test:344–345 / 353 / 373 附近）+ 一行防回归注释（「每实例恰
集成一次（yjs 二次集成 `_prelimContent=null` 崩溃）」）；**断言逻辑逐字锁定**。

**归属裁决（SA2 要求二选一，显式定谳）**：**授权 SA3 凭本节登记理由执行上述最小修复**（仍不得动
任何断言）。理由：① fixture 接线属测试基础设施范畴——SKILL 立法先例明文将「隔离 fixture」列入
SA3 合法操作（断言锁定不受影响）；② 修复面已被三重证据钉死为单点接线、断言零牵连（SA2 健康版
实测背书）；③ 免去 SA6 重发派发环，不阻塞实现→验收主链。**回退路径**：若 SA3 执行中发现任何断言
语义受牵连（预期不存在——证据 2 已验证），立即停止改动并上报总控，改走 SA6 重发该文件路径。

---

## §2. 公共接缝契约（冻结面复述 + 不收窄承诺）

以下为 SA6 Phase 1 冻结契约（简报「契约冻结」节），本设计**全量接受、不收窄、仅补充**：

```ts
// packages/doc-runtime/src/replace.ts（新建）
export interface ReplaceIssue {
  message: string;
  path: Array<string | number>; // 段数组：map/object/Record 用 string，Y.Array 用 number；[] 即 ROOT 自身
}

export type ReplaceResult =
  | { ok: true } // 成功不携带额外载荷（exactOptionalPropertyTypes：无多余键——G6-2 toEqual 精确形状锚）
  | { ok: false; issues: ReplaceIssue[] };

export function replaceRootContent(
  derived: DerivedSchema,
  snapshot: unknown,
  doc: Y.Doc,
): ReplaceResult;
```

- 经 `src/index.ts` 包公共入口导出（与 materializeRoot 同文件同款 `exports["."]`）；**同步**、可预期失败经
  返回值传递（ADR-0008「普通、可预期且零写入的失败使用领域化结果联合」）；⓪/④/⑤/⑥ 的 throw 是唯一
  例外（与 materializeRoot 同族，D1/RINV-8）。
- 结果联合语义：逻辑校验失败**保留完整 issues**（与 `validateLogicalSnapshot` 直调逐条一致——引用透传，
  D9）；materialization 失败（构造失败 / ROOT 载体非 Y.Map）**恰 1 条** issue（fail-fast，ADR-0007）。
- 前置保证：未闭合外层 `doc.transact` 内调用 → 任何写入前 throw `DOCRT-E202`、本函数零写入（G7）。

**JSDoc 契约文档义务**（SA3 落地时写入 replace.ts 头部 + index.ts 接缝清单，措辞要点见 §4.5）。

---

## §3. D2 模块分解——detached builder 收敛为包内 seam

### 3.1 三新内部模块 + 依赖 DAG

```
                    ┌──────────── index.ts（公共面：恰 4 值导出，G6） ────────────┐
                    │ extractYjsSnapshot / readLogicalValueAtPath               │
                    │ materializeRoot / replaceRootContent（+ 各自 Issue/Result │
                    │ 类型导出，运行时擦除不入 Object.keys）                      │
                    └───────┬──────────────────────────────┬────────────────────┘
                            │                              │
                   materialize.ts（瘦编排）         replace.ts（新编排）
                   ⓪①②③④⑤⑥ 创建路径             ⓪①②③④⑤⑥ 替换路径
                            │  共享 ↓（同一实现，零复制）  │
        ┌───────────────────┼──────────────────────────────┼──────────────────┐
        │                   │                              │                  │
   tx-guard.ts         detached-build.ts             install-verify.ts         │
   ⓪ assertOutermost    ② buildTopEntries +            ⑤ verifyInstall          │
   TransactionContext    @internal 辅助与类型          ⑥ verifySnapshotIntact   │
   (doc, api)            （plainObjectOf 等，          （productEqual/          │
   E202 A/B/C            供 ⑤⑥ 共享——walk             buildScratchInstall      │
                          先例）+ 构造私有            内部私有；@internal 辅助  │
                          （buildValue 等）           /类型自 detached-build）  │
        │                   │                              │                  │
        │                   └──────────┬───────────────────┘                  │
        │                              ↓                                        │
        │            extract.ts（walk/extractYjsSnapshot）· resolve.ts          │
        │            （makeRefResolver）· xml-parse.ts（parseXmlToFragment/     │
        │            canonicalXmlOf）· carrier.ts（carrierOf/probeRoot）        │
        │            （全部既有叶子模块，零改动）                                 │
        └───────────────────────────────────────────────────────────────────────┘
```

**DAG 边全集（R2 显式化，SA2 攻击点 2）**：materialize → {tx-guard, detached-build,
install-verify}；replace → {tx-guard, detached-build, install-verify}；install-verify →
{detached-build（`buildTopEntries` + `@internal` 辅助/类型）, extract, resolve, xml-parse}；
detached-build → {resolve, xml-parse, carrier}；tx-guard →（仅 yjs 类型）。全部单向、无环。

- **detached-build.ts**（~320 行）：自 materialize.ts 迁出 §1.2 所列 ② 全部函数与内部类型
  （`BuildResult/EntriesResult/Path/Resolver`（54–58）+ 新增名义类型 `BuildIssue`——形状
  `{message; path}`，与 `MaterializeIssue`/`ReplaceIssue` 结构同一，纯 TS 结构化兼容，无运行时转换）。
  **导出面（R2 定稿，SA2 攻击点 2——写死，无 SA3 自由裁量）**：
  - `buildTopEntries`——构造接缝（materialize/replace 的 ② 与 install-verify 的 scratch 构造共用）；
  - `@internal plainObjectOf / recordSlotOf / declaredFieldOf`——形状守卫 / Record 判定 / 字段查询
    辅助，供 install-verify 的 `productEqual`（map 分支 309–319）、`deepEqualValue`（388–389）、
    `keysetOf`（419）消费（**walk `@internal` 先例直援**：extract.ts:86-88 同款「包内复用接缝……不经
    index.ts 公共入口导出」）；
  - `@internal makeIssue`（R3 增补，SA2 R2-A1）——issue 构造器**统一出口**：跨模块消费方 =
    materialize 留守 `prepare` 的载体 issue / 非空 ROOT issue 两处（实源码 464/467）；builder 内部
    `issue/shapeIssue/domainIssue` 同源收敛（实源码 665 行自述「shapeIssue / domainIssue /
    makeIssue 全部收敛到此」）——共享单点纪律最自然的落点；
  - `@internal` 类型 `Path / Resolver / BuildIssue`——供 install-verify 的
    `ScratchInstall/ProductComparison/productEqual` 签名消费；
  - 其余一切（`buildValue/rootEntries/buildUnion/mapEntries/copyJsonDomain/wordOf/shapeIssue/
    domainIssue/issue/renderPath/BuildResult/EntriesResult`）保持模块私有。
  **不选「显式第四共享模块」方案的理由**：三辅助与 builder 同属 ② 构造域语义（形状守卫/Record 判定
  本身就是构造规则的一部分），拆出第四模块反而制造域漂移与多一个 ALLOW 面；`@internal` 导出面已由
  G6（只锚 index.ts 公共面，与其正交）+ SA4 静态门禁（grep 三辅助定义恰一处——零复制体）双重锁定。
- **tx-guard.ts**（~45 行）：E202 三变体消息模板（D7）+ `assertOutermostTransactionContext(doc, api)`
  谓词（三窗口模型逐字保持：窗口 A `doc._transaction` truthy / 窗口 B `_transactionCleanups` 非空 /
  窗口 C fall-through fail-closed；`afterAllTransactions` 队列重置例外放行——rev2 §9 PA-1/2/9 定谳，零
  改动复用）。
- **install-verify.ts**（~240 行）：⑤⑥ 全量迁出（含 `ScratchInstall/buildScratchInstall/
  ProductComparison/productEqual/deepEqualValue/valueDiff/detailOf/keysetOf/summarize/errDetail/
  e201C/e201D`）。导出 `verifyInstall(ready: { rootMap; entries })` 与
  `verifySnapshotIntact(derived, snapshot, doc)`。**import 面（R2 显式化）**：detached-build
  （`buildTopEntries` + `@internal` `plainObjectOf/recordSlotOf/declaredFieldOf` + 类型
  `Path/Resolver/BuildIssue`——`productEqual` map 分支/`deepEqualValue`/`keysetOf` 消费辅助、
  `ScratchInstall/ProductComparison` 消费类型；DAG 边全集见上）+ extract + resolve + xml-parse。
  两个导出均不点名 API（E201 文案本为 generic：
  「DOCRT-E201: ROOT 顶层安装完整性偏离……」/「DOCRT-E201: ROOT 逻辑快照安装后语义校验偏离……」），
  天然两用，无需参数化（D8）。
- **materialize.ts**（711 → ~180 行）：保留公共函数 + 类型 + `prepare`（①③ + E200 + ROOT 空置判定）
  + ④ set 循环；三处 import 替代迁出体（其中 detached-build import 含 `@internal makeIssue`——留守
  prepare 464/467 的 issue 构造依赖，R3/SA2 R2-A1）。**公共契约零变化**：签名、返回类型、E202/E201/E200 消息
  （api='materializeRoot' 渲染字节相同，§4.1）、行为逐位不变——回归面 = 既有 215 用例全绿。
- **replace.ts**（~170 行）：新编排（§4）。

### 3.2 架构一致性：与仓内两个既有先例同构

1. **`resolve.ts` 纯移动先例**（issue #74 设计 §4.9）：resolve.ts 头部自述「自 extract.ts 纯移动……
   签名与实现逐字不变……移动使两侧共享同一实现，杜绝复制漂移」。本设计对 ②⑤⑥⓪ 采取同一手法与同一
   纪律（逐字不变 + 头部 JSDoc 登记「自 materialize.ts 纯移动（issue #88 设计 §3）」）。
2. **`walk` @internal 接缝先例**（issue #75）：extract.ts 将 `walk` 以 `@internal 包内复用接缝` 导出供
   read.ts 复用，「不经 index.ts 公共入口导出」。本设计的三个 seam 模块同理：**只被同包模块相对路径
   import，绝不进 index.ts**——G6 的模块级黑盒断言（`Object.keys(pkg).sort()` 恰四接缝）由
   index.ts 的导出面单独保证，与内部模块的存在正交。**R2 显式化（SA2 攻击点 2）**：detached-build
   的 `@internal` 辅助/类型导出即本先例的直援——`walk` 是「单函数包内共享接缝」的最小形态，本设计
   将同一纪律用于三个形状/查询辅助与三个类型（导出面清单 §3.1 写死）。

### 3.3 封装边界（AC-2 / G6 的结构性兑现）

- 公共面 = index.ts 恰 4 个值导出（`extractYjsSnapshot` / `materializeRoot` /
  `readLogicalValueAtPath` / `replaceRootContent`）+ 各自 Result/Issue **类型**导出（运行时擦除）。
- detached builder / guard / verifier **不是业务公共 API**（ADR-0008「Runtime 不公开……生产构造器」），
  也**不是可跨时间执行的 prepared mutation**（ADR-0007 TOCTOU 禁令）：`replaceRootContent` 同步完结，
  产物 entries 是函数内局部量，调用方拿不到任何 deferred 句柄；同参二次调用重新走完整管线、无跨调用
  捕获状态（G6-2 锚）。

---

## §4. D3/D4/D5 六阶段编排规格（replace.ts）

### 4.1 ⓪ 活动事务语境 guard（D7 参数化，逐字保持）

```ts
// tx-guard.ts —— 三窗口谓词逐字保持（rev2 RD7-P1 定稿），唯一变化 = 消息 api 插值
const E202_MSG_A = (api: string) =>
  `DOCRT-E202: 在未闭合的外层 doc.transact 内调用 ${api}（运行时检测：doc._transaction 非空）——` +
  `内部事务将并入外层、observer 延迟至外层 cleanup，成功保证与 DOCRT-E201 检测面失效；` +
  `已在任何写入前拒绝，本函数零写入（doc 状态不因本调用改变）。请将调用移出外层事务回调后重试`;
const E202_MSG_B = (api: string) =>
  `DOCRT-E202: 在 Yjs 事务 cleanup/observer 派发期间调用 ${api}（运行时检测：doc._transactionCleanups 非空）——` +
  `……（其余逐字 = materialize.ts:119-120 原文，含「请勿在 observer/事务事件回调内调用……队列异常残留」末句）`;
const E202_MSG_C = // C 变体不含 API 名 → 共享常量，原文逐字不变（materialize.ts:122-123）
  'DOCRT-E202: 无法确认 doc 的事务状态（……请核对 @nomicore/doc-runtime 声明的 yjs 版本兼容性（^13.6.30））';

export function assertOutermostTransactionContext(doc: Y.Doc, api: string): void {
  // 谓词体 = materialize.ts:132-146 逐字：窗口 A truthy throw → B 队列非空 throw →
  // 干净语境（tx===null 且队列空）唯一放行口 → C fall-through fail-closed
}
```

**字节同一性证明**：现行 A/B 消息中 API 名只出现于前导短语「内调用 materializeRoot（运行时检测…」。
以 `${api}` 替换该 token，`api='materializeRoot'` 时渲染结果与 rev2 §3.4 逐字定稿**逐字节相同**；既有
测试文本锚（`doc._transaction 非空`/`派发期间`/`队列异常残留`/`无法确认`/`版本兼容性`）全部保留。
`replaceRootContent` 侧同模板渲染自有 API 名——异常归因诚实（G7 只锚 `/DOCRT-E202/`，兼容）。
调用点：函数体第一句、prepare 之前、一切 try/catch 之外（绝不落入 E200 崩溃边界）。

### 4.2 prepareReplace：①②③（D9 透传纪律 + E200 崩溃边界）

```ts
type PreparedReplace =
  | { kind: 'ready'; rootMap: Y.Map<unknown>; entries: Array<[string, unknown]> }
  | { kind: 'fail'; issues: ReplaceIssue[] };

function prepareReplace(derived: DerivedSchema, snapshot: unknown, doc: Y.Doc): PreparedReplace {
  try {
    if (derived.structure.kind !== 'root') {
      throw new Error('derived.structure 非 root（手造派生物）'); // B8 loud 边界，对齐 extract/materialize
    }
    // ① 逻辑校验（值域宽域）：失败 → issues 引用零损透传（D9；validateLogicalSnapshot 自身不抛错，
    //    其 E100/预算截断形态原样返回——G3-1 toEqual 直调结果锚的兑现方式）
    const logical = validateLogicalSnapshot(derived, snapshot);
    if (!logical.ok) return { kind: 'fail', issues: logical.issues };

    // ② detached 构造（结构域窄域）：共享 seam（detached-build.buildTopEntries——与
    //    materializeRoot/⑥ scratch 同一实现，AC-1 单源）；失败 → 单 issue fail-fast（G3-2/G5）
    const top = buildTopEntries(derived, snapshot);
    if (top.kind === 'issue') return { kind: 'fail', issues: [top.issue] };

    // ③ ROOT 探针 + 载体判定（只读触碰 'ROOT'，INV 镜像：SCHEMA/META 零接触）：
    //    非 Y.Map → 恰 1 issue path=[]（G3-3；探针级联零写入——实测 P7）
    const probe = probeRoot(doc);
    if (probe.carrier !== 'Y.Map') {
      return { kind: 'fail', issues: [{
        message: `ROOT 载体不是 Y.Map（期望 Y.Map，实际 ${probe.carrier}）——无法执行原子内容替换`,
        path: [],
      }] };
    }
    // ⚠️ 与 materializeRoot prepare 的唯一编排差异：无「ROOT 空置」判定（materialize.ts:466-468 的
    //    「目标 ROOT 非空……不覆盖、不合并、不 fallback」在替换路径不适用）——非空 ROOT 正是本接缝
    //    的目标语境（ADR-0008 授权的职责二分，§1.3）。缺席 ROOT 经探针惰性创建空 map（零 update，
    //    实测 P4）→ 与空 ROOT 同为 happy path（G2）。
    return { kind: 'ready', rootMap: probe.map, entries: top.entries };
  } catch (err) {
    // 崩溃边界（①②③ 范围）：实现缺陷 / 手造派生物 / 对抗输入（getter/Proxy 抛出）/ 深栈溢出
    // （② 装配递归溢出 → RangeError，RT-1 先例）→ DOCRT-E200 单 issue
    const detail = err instanceof Error ? err.message : String(err);
    // E200 点名模块名（D8/R2 定调，SA2 攻击点 4）：与 materialize 侧「materialize 内部错误」同基调；
    // 既有锚均为 /DOCRT-E200/ 正则，兼容
    return { kind: 'fail', issues: [{
      message: `DOCRT-E200: replace 内部错误（意外异常）: ${detail}`, path: [],
    }] };
  }
}
```

### 4.3 ④ 单事务 clear + 安装（D4/D5 核心）

```ts
export function replaceRootContent(derived: DerivedSchema, snapshot: unknown, doc: Y.Doc): ReplaceResult {
  assertOutermostTransactionContext(doc, 'replaceRootContent');            // ⓪
  const ready = prepareReplace(derived, snapshot, doc);                    // ①②③ + E200
  if (ready.kind === 'fail') return { ok: false, issues: ready.issues };   // 零写入失败面（G3）
  // ④ 单事务清空并安装 —— 函数体内无任何 try/catch（INV-5 镜像：observer/引擎异常唯一抛源 → 原样
  //    loud 传播，⑤⑥ 不运行）。事务体只含对已验证载荷的 clear + set 循环（copyJsonDomain 产物 +
  //    detached 类型均不可使 yjs 抛错——D10 同款论证；clear 为引擎级删键操作，同理）。
  doc.transact(() => {
    ready.rootMap.clear(); // 在【原实例】上删全部键（顶层 identity 保持的唯一机制性要求，D5）
    for (const [key, value] of ready.entries) ready.rootMap.set(key, value); // 安装全新 detached 实例
  });
  verifyInstall(ready);                                      // ⑤（install-verify 共享，逐字）
  verifySnapshotIntact(derived, snapshot, doc);              // ⑥（install-verify 共享，逐字）
  return { ok: true };
}
```

**D4 update 计数法则**（实测定谳，§9 RA-1/RA-4/RA-5）：clear 与 set 并入**同一** yjs transaction
（`YMap.clear` 内部 `transact` 归并，`Transaction.js:412` `doc._transaction === null` 才建新事务）→
对外可观测 `update` 事件数 = **变更集非空 ? 1 : 0**：

| 场景 | 变更集 | update 计数 | 测试锚 |
|---|---|---|---|
| 非空 ROOT → 新快照（G1） | delete ops（旧键）+ set ops（新键） | **1** | G1 `events.count === 1` |
| 空/缺席 ROOT → 非空快照（G2） | set ops | **1** | G2 ×2 |
| 非空 ROOT → 空快照 `{}` | delete ops | **1**（实测 P5） | 无锚（诚实边界） |
| 空/缺席 ROOT → 空快照 `{}` | 无 ops | **0**（实测 P4：clear 无键可删 = 零操作） | 无锚（诚实边界） |

「恰 1 次 update」的精确表述：**凡产生实际变更，全部变更恰好在一个 transaction 内提交（单 update
单元，ADR-0006）**。空变更集零 update 是 yjs 零操作事务的自然语义，不与任何冻结断言冲突（G1/G2 的
fixture 均非空快照）。observer 同步重入写会开启**独立** yjs 新事务（实测 P3：额外 update）——这正
是「不补偿、不声称回滚」的机制根源，其偏离由 ⑤ 检测（§4.4）。

**D5 顶层 identity 保持的机制性论证**：管线对 'ROOT' 名字空间的全部操作 = `probeRoot` 只读探针（缺席
时惰性创建 map——yjs 按 name 缓存实例）+ 原实例 `clear()` + 原实例 `set()`。全程不存在 delete
ROOT-map / set 异型 / 换名操作 → `doc.getMap('ROOT')` 跨调用返回严格同一实例（实测 P1
`identityKept:true`）。旧子类型引用（旧 Y.Map/Y.Array/Y.XmlFragment 实例）随 clear 被删且不被重新安装
→ `root.get(k)` 返回**新** detached 实例（实测 P1 `oldChildStale:true`）——ADR-0007「不做
identity-preserving diff」+ ADR-0008「旧 Yjs 子类型 identity 可失效」的行为兑现，无任何补偿性 diff。

### 4.4 ⑤⑥ 写后校验（共享实现，W1 唯一相容形态）

- **⑤ `verifyInstall(ready)`**（install-verify.ts，自 materialize.ts:148-176 逐字）：`rootMap.size ===
  entries.length` + 逐键 `rootMap.get(key) === value`（安装值严格同一性；yjs set 按引用存储，实测 P6，
  标量按值 `===` 亦成立）。任一偏离 → throw `DOCRT-E201`（消息含「写入已提交，不回滚、不补偿，doc
  保持 observer 留下的实际状态」）。对 G4-2：observer 事务内 delete 计划键 `count` → size 1 ≠ 2 →
  throw E201 ✓；title 已提交、count 缺席、无补偿 ✓。
- **⑥ `verifySnapshotIntact(derived, snapshot, doc)`**（自 materialize.ts:236-289 逐字）：scratch 一次性
  doc 同管线安装（`buildScratchInstall` 经 `buildTopEntries`——与 real 侧 ② 同一 seam）→ 双侧
  `extractYjsSnapshot` → `productEqual`（全键集 + 逐元素 + XML canonical + union any-of）。偏离 →
  throw E201 变体 C；校验未能运行 → 变体 D。对替换路径的覆盖论证：⑥ 比较的是 extract 投影，与 real
  侧安装前 ROOT 是否有旧内容无关（clear 后投影只含新内容）——与创建路径完全同构。

**时序与异常纪律**（INV-5 镜像）：④⑤⑥ 物理上位于一切 try/catch 之外。事务内 observer 抛错 →
`doc.transact` 同步抛出原始错误（yjs `cleanupTransactions` 的 try/finally 保证 update 照发、cleanups
队列照常重置——实测 P2 + 源码 `Transaction.js:265-320` + lib0 `callAll` 逐回调续跑）→ 原样传播出
`replaceRootContent`（G4-1 `toThrow('observer-boom')` 精确 message），⑤⑥ 不运行；写入已实际提交
（update 恰 1、新值落盘）——**不吞并成伪 ok:true、不虚假回滚**（ADR-0007 失败边界 + ADR-0008
committed-aware no-rollback 的本任务服从面）。

### 4.5 JSDoc 契约措辞要点（SA3 落地义务）

replace.ts 头部 + 函数 JSDoc 须登记（与 materialize.ts 同款密度）：

1. 前置条件（运行时强制）：最外层事务语境——三窗口命中 → throw DOCRT-E202、本函数零写入
   （`afterAllTransactions` 例外放行）；嵌套调用使「单 transaction 清空并安装」可观测承诺与 ⑤⑥ 检测
   窗口失效（§5/D6）。
2. 成功语义（ok:true 完整承诺）：(a) 全部计划变更（旧键清除 + 新内容安装）已在单次 Y.transact 提交
   （update 计数法则 §4.3）；(b) 返回时 `doc.getMap('ROOT')` 与调用前严格同一实例且顶层恰为计划键集、
   逐键值与安装值严格同一（⑤）；(c) extract 读回投影与同一输入经同一管线在一次性 doc 上的未修改安装
   读回投影语义等价（⑥，XML 经 canonical 归一化，不承诺逐字相同）。
3. 失败语义：①②③ 任一失败 → `{ok:false, issues}` + doc 零变化（0 update + state 字节不变）；
   ④ 内 observer 抛错 → 原样传播；⑤⑥ 偏离 → throw DOCRT-E201（不补偿、不声称回滚）。
4. 与 materializeRoot 的职责二分（§1.3 表格原文）+ 共享 seam 清单（tx-guard/detached-build/
   install-verify，「不复制 materialization 逻辑」的落点）。

---

## §5. D6 嵌套调用裁决（简报 ⚠️ 设计决策点定谳）

**裁决：`replaceRootContent` 为最外层事务语境专用接缝；嵌套调用（未闭合外层 `doc.transact` / 派发窗口 /
不可判定）在任何写入前 throw `DOCRT-E202`、本函数零写入。** 论证：

1. **契约冻结不可收窄**：G7 已锚定此行为（SA3 唯一行为锚点）；与本包 materializeRoot rev2 RD7-P1
   hard contract 同族——两公共写入口同纪律，无特例。
2. **嵌套调用破坏三个可观测承诺**（技术上不可兼得，非设计偏好）：
   - 「单 transaction 清空并安装」：并入外层后 update 时机/计数由外层事务决定，「恰 1 次 update」
     不可承诺；
   - ⑤⑥ 检测窗口：observer 延迟至外层 cleanup 派发，⑤ 顶层校验与 ⑥ 对称重物化在外层提交前空转
     ——owner P1 假成功链（rev2 §1.1 已定谳的攻击面）；
   - 「失败 → doc 零变化」：①②③ 失败时若外层事务已写入其它内容，「本函数零写入」无法升级为
     「doc 字节不变」（G3/G7 的零写入双证将被外层写入污染）。
3. **ADR-0008 SCHEMA write 组合需求的正确满足路径**（前瞻登记，非本任务范围）：其第 4 步「在一个
   transaction 中原子替换 SCHEMA 与必要的 ROOT generation」要求**同事务**替换 SCHEMA 四键与 ROOT
   内容。该组合的正确载体是**未来的包内组合 seam**（如 SCHEMA write 落地时新增的内部函数）：由该
   seam **自开** `doc.transact`，事务体内直接消费 `buildTopEntries` 产物执行「SCHEMA clear+四键重写 +
   ROOT clear+install」——本设计 §3 的 builder 收敛正是为此预留的单源构造点（builder 是组合点，
   公共 helper 不是）。届时无需放宽 `replaceRootContent` 的 ⓪，也无需 owner 裁决调整本接缝契约。
4. **边界声明**：ADR-0008 第 2 条「transaction helper 提供 committed-aware branded fatal contract」
   是另一独立 seam（Runtime 层 fatal 契约），本任务不建设；`replaceRootContent` 的 E201/E202 是其
   预备件（throw 家族 + committed 语义措辞已在消息内），不越权提前实现。

---

## §6. 不变量（RINV）与失败面总表

### RINV 清单（ok:true / ok:false / throw 三态完整承诺面）

| # | 不变量 | 锚定 |
|---|---|---|
| RINV-1 | 单事务原子性：全部计划变更（旧键清除 + 新内容安装）在恰一次 `doc.transact` 内提交；凡变更集非空，对外恰 1 次 update 事件 | G1/G2；RA-1/4/5 |
| RINV-2 | 顶层 identity：`doc.getMap('ROOT')` 实例跨调用严格同一（`toBe`） | G1；D5/RA-1 |
| RINV-3 | 子类型 identity 可失效：旧 Y.Map/Y.Array/Y.XmlFragment 引用替换后不可达；快照外键清除；无 identity-preserving diff；实例从不复用——同实例二次集成即 yjs 原生崩溃（机制注脚 §1.4，RA-9） | G1；D5；§1.4 |
| RINV-4 | 前置零写入：①②③ 任一失败 → 0 update + `encodeStateAsUpdate` 逐字节不变 + 旧内容原封不动 | G3/G7 |
| RINV-5 | issues 语义：逻辑失败 = 完整 issues 引用透传（与直调逐条一致）；构造/载体失败 = 恰 1 issue（fail-fast） | G3-1/2/3；D9 |
| RINV-6 | observer no-rollback：④ 内 observer 抛错 → 原始错误原样传播、恰 1 次回调、update 已发、新值已落盘；⑤⑥ 不运行 | G4-1；RA-2 |
| RINV-7 | 写后偏离 loud：⑤⑥ 偏离 → throw DOCRT-E201 家族；不补偿、不回滚、不返回 ok:false（事务已提交） | G4-2；W1 |
| RINV-8 | 最外层语境：⓪ 三窗口命中 → throw DOCRT-E202、零写入；`afterAllTransactions` 例外放行 | G7；D6/D7 |
| RINV-9 | seam 单源：② 构造 / ⓪ guard / ⑤⑥ 校验与 materializeRoot 共享同一实现（detached-build/tx-guard/install-verify），仓内不存在第二份构造规则 | G5/G6；D2 |
| RINV-10 | 封装：三个 seam 模块不经 index.ts 暴露；无 prepared mutation / deferred 句柄；同参二次调用无跨调用状态 | G6；§3.3 |

### 失败面总表（全量）

| 阶段 | 失败形态 | 外显 | doc 状态 |
|---|---|---|---|
| ⓪ | 未闭合外层事务（A）/ 派发窗口（B）/ 不可判定（C） | throw `DOCRT-E202`（api=replaceRootContent） | 零变化（0 update + 字节不变 + 旧内容原封） |
| ① | 逻辑校验失败 | `ok:false` + 完整 issues（引用透传） | 零变化（G3-1 双证） |
| ② | detached 构造失败（形状/纯值域/XML/联合全拒/深栈溢出） | `ok:false` + 恰 1 issue | 零变化（G3-2 双证） |
| ③ | ROOT 载体非 Y.Map（Y.Array/XmlFragment/Text） | `ok:false` + 恰 1 issue path `[]` | 零变化（G3-3 双证；探针只读 RA-7） |
| ①–③ | 意外异常（手造派生物 / 对抗输入 / Proxy 抛出） | `ok:false` + `DOCRT-E200` 单 issue | 零变化 |
| ④ | observer 抛错 | throw 原始错误（原样） | **已提交**（update 恰 1、新值落盘；不回滚） |
| ⑤ | 顶层完整性偏离（delete/insert/overwrite 向量） | throw `DOCRT-E201`（顶层偏离文案） | 已提交（不补偿，保持 observer 留下状态） |
| ⑥ | 投影偏离（变体 C）/ 校验未能运行（变体 D） | throw `DOCRT-E201`（C/D 文案） | 已提交（不补偿） |

---

## §7. AC 对齐表（AC-1~AC-8 → 设计章节）

| AC | 设计落点 | 红灯锚 |
|---|---|---|
| AC-1 复用同一 detached builder，不复制构造规则 | §3.1/§3.2（detached-build.ts 单源，两入口同一 `buildTopEntries`）+ §4.2② | G5 双锚（读回全等 + 失败面逐条一致） |
| AC-2 包内能力，不作公共 API / prepared mutation 暴露 | §3.3（index.ts 恰 4 值导出；seam 模块不进公共面；同步完结无句柄） | G6 两锚 |
| AC-3 验证+构造成功后才允许事务内清空并安装 | §4.2（prepareReplace 先行）→ §4.3（④ 后置单事务） | G1/G2 恰 1 update；G3 先于任何事务 |
| AC-4 顶层 identity 保持，旧子类型可失效 | §4.3 D5（原实例 clear 机制论证 + 实测） | G1 `toBe` + `not.toBe` + stale 清除 |
| AC-5 前置失败零变化 | §4.2 + RINV-4 | G3 三用例双证（0 update + 字节不变） |
| AC-6 observer/fatal 服从 committed-aware no-rollback | §4.4（④⑤⑥ 无 try/catch；E201 家族；实测 RA-2/RA-3） | G4 两锚 |
| AC-7 行为覆盖空/非空 ROOT、全载体、构造失败、observer 边界 | 全设计不收窄冻结面（§2 承诺）+ §6 总表 | G1–G7 全组 |
| AC-8 全量 typecheck/test + Node 20/24 CI | §8（回归面）+ §12（零新依赖，tsconfig include 自动覆盖新文件） | dispatch 基线 927 绿 |

**G1–G7 → 设计章节可追溯性**：G1→§4.3/§4.4；G2→§4.2③（缺席惰性创建 RA-4）+§4.3（计数法则）；G3→
§4.2（三支）+RINV-4；G4→§4.4（P2/P3 机理）；G5→§3.1（单源）+§4.2②；G6→§3.3；G7→§4.1/§5。

**R2 注记（G1 锚可达性）**：AC-3/AC-4/AC-7 的 G1 锚当前被 fixture 二次集成缺陷阻断（§1.5）；修复
裁决（§12 R2 授权窗口）落地后 G1 即恢复为有效验收锚——断言面零变化、AC 语义不受影响，SA2 健康版
fixture 已实测全绿（§1.5 证据 2）。

---

## §8. 风险与回退

| 风险 | 等级 | 缓解 |
|---|---|---|
| **冻结 G1 fixture 二次集成缺陷（R2 登记，SA2 攻击点 1 / D12）** | **高**——不修复则 G1 永红、AC-3/4/7 验收门结构性不可达 | §1.5 登记（三重证据 + SA1 独立复现）+ 最小接线修复裁定（**断言逐字保留**、不变量「每实例恰集成一次」、SA2 健康版实测全绿背书）+ 归属裁决授权 SA3 执行（§12 R2 窗口；回退路径 SA6 重发）+ 知识面 RA-9 / §1.4 机制注脚 |
| materialize.ts 大规模搬迁引入行为漂移（回归风险） | 中 | 三模块**逐字纯移动**（resolve.ts 先例纪律）；E202 A/B 经 `${api}` 渲染对 materializeRoot 字节同一（§4.1 证明）；E201/E200/载体 issue 文案不动；回归门 = 既有 215 用例（materialize/read/extract 全组）+ 全仓 927 用例必须保持绿 |
| yjs `clear()` 事务语义假设错误 | 低 | 设计期实测 P1/P4/P5（§9）+ SA6 Phase 1 断言可达性实证（简报 90–96 行）双独立验证 |
| observer 抛错时 update/清理队列行为假设错误 | 低 | 源码三重依据（`Transaction.js` try/finally + lib0 `callAll` 逐回调续跑 + 队列重置在 finally 内）+ 实测 P2 + materialize 既有 F10 锚（materialize-root.test.ts:581）三方一致 |
| ⑤ 身份断言对 plain 值（YPlainArray 等按值存储）误报 | 低 | P6 实测 + materialize verifyInstall 既有论证（标量按值 `===`、引用按引用 `===`，215 绿含 plain fixture） |
| 空快照 × 空 ROOT 的 0 update 边缘被误读为契约破坏 | 低 | §4.3 计数法则显式登记（变更集空 ⇔ 0 update），无冻结断言覆盖该角落；JSDoc 措辞用「凡产生实际变更则恰一事务」 |
| 深树 ② 溢出（RT-1 类比） | 低 | 共享崩溃边界：RangeError → prepareReplace catch → E200 单 issue（与 materialize 同面，G5 失败面一致性不受影响——同一实现） |
| ⑥ 双重构造成本（real + scratch 各一次全量 build） | 低 | 与 materializeRoot 现状相同（rev2 RD8 已接受）；替换路径无额外放大 |
| 回退 | — | 单 commit 粒度回退即恢复 materialize.ts 原状；红灯测试文件独立，不阻回退 |

---

## §9. 协议假设依据 (Protocol Assumption Evidence)

本设计的协议级假设集中于 **yjs 事务/clear/observer 生命周期**。SA1 于本 worktree 设计期实测
（2026-08-23，yjs@13.6.32 / Node v24，脚本 `/tmp/sa1-yjs-verify.mjs` 本地 scratch 不入仓，node 直跑
`import * as Y from '.../node_modules/yjs/dist/yjs.mjs'`）：

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|---|
| RA-1 | 非空 ROOT 上单事务 `clear()+set()×N` → 恰 1 次 update；`getMap('ROOT')` 实例不变（===）；旧子引用失效；快照外键清除 | 设计期实测（SA1）+ 源码引用 | 实测输出 `P1: {"updates":1,"identityKept":true,"oldChildStale":true,"staleKeyGone":true,...}`；`YMap.js:255-265` clear 经 `transact` 归并（`Transaction.js:412` 嵌套不建新事务）；SA6 Phase 1 独立实证（简报 94–96 行「yjs 实证非空 ROOT 上 clear+set 单事务 identity 保持 + 恰 1 update」） | 低 |
| RA-2 | 事务内 type-observer 抛错 → 原始错误原样冒泡出 `doc.transact`；update 仍恰 1 次；值已提交；cleanups 队列照常重置（后续调用不误入窗口 B） | 设计期实测（SA1）+ 源码引用 + 现有测试引用 | 实测 `P2: {"threw":"observer-boom","calls":1,"updates":1,"title":"new","count":7,"cleanupsEmpty":true,"txNull":true}`；`Transaction.js:265-320`（cleanupTransactions try/finally：finally 内 emit afterTransactionCleanup → emit update → 重置队列）+ lib0 `function.js:17-27` callAll（try/finally 逐回调续跑，异常最终上抛）；materialize 既有同构锚 `materialize-root.test.ts:581-595`（F10） | 低 |
| RA-3 | observer 同步重入写（不抛错）→ 在 observer 派发窗口开启**独立** yjs 新事务（额外 update 事件）；终态 = observer 留下的状态；⑤ size/同一性断言可检测 | 设计期实测（SA1）+ 源码引用 | 实测 `P3: {"updates":2,"title":"new","countUndefined":true,"size":1}`；机理：observer 派发时 `doc._transaction === null`（`Transaction.js:432-435` 外层 finally 先置 null 再 cleanup）→ 重入 `delete` 建新事务入 cleanups 队列（rev2 §9 PA-3 同款）。G4-2 无 update 计数断言，兼容 | 低 |
| RA-4 | 变更集为空 → 0 update（空 map `clear()` 无键可删 = 零操作；全新 doc 惰性 `getMap('ROOT')` 零 update） | 设计期实测（SA1）+ 现有结论引用 | 实测 `P4: {"lazyGetMapUpdates":0,"emptyClearUpdates":0}`；carrier.ts 头部 P4 实证同款（「缺席分支的创建实测零 update 事件」） | 低 |
| RA-5 | 非空 ROOT → 空快照（entries=[]）：clear 产生 delete ops → 恰 1 update | 设计期实测（SA1） | 实测 `P5: {"updates":1,"size":0}` | 低 |
| RA-6 | yjs set 按引用存储：集成后 `get(k) === 安装实例`（⑤ 身份断言对标量与引用类型均成立） | 设计期实测（SA1）+ 现有测试引用 | 实测 `P6: {"mapIdentity":true,"arrIdentity":true}`；materialize verifyInstall 既有论证与 215 绿（含 YPlainArray fixture：plain 值 ContentAny 本地同引用） | 低 |
| RA-7 | Y.Array ROOT 下 `getMap('ROOT')` throw（类型冲突）→ probeRoot 级联收敛 carrier 'Y.Array'；探针全程零 state 变化 | 设计期实测（SA1）+ 源码引用 + 现有测试引用 | 实测 `P7: {"probe":"throw: Type with the name ROOT has already been defined with a different constructor","updates":0,...}`；`carrier.ts:52-68` 四级探针；extract T1/T2 锚（extract.ts:58-61 F5） | 低 |
| RA-8 | ⓪ guard 谓词依据：`doc._transaction`/`doc._transactionCleanups` 窗口模型 + afterAllTransactions 例外 + 类型面公开声明 | 既有定谳引用（rev2 §9） | rev2 设计 §9 PA-1/PA-2/PA-4/PA-9（源码 `Doc.js:79`、`Transaction.js:412-435`、`Doc.d.ts:49/53` + SA1/SA2 双实测 + RT-2/RT-3/RT-4 测试锚全绿）——本任务**零改动复用**，仅消息 api 插值 | 低 |
| RA-9（R2 新增，SA2 攻击点 1） | 冻结 fixture 手工 yjs 构造的负载性假设：同一 detached Y 实例二次集成 → 首次 `_integrate` 已消费并置空 `_prelimContent`，二次以 null 执行 `insert(0,null)`（Y.Array）/ `null.forEach`（Y.Map）→ yjs 原生 TypeError——手工 fixture 必须保证**每实例恰集成一次** | SA2 三重取证 + SA1 独立复现 + 源码引用 | SA2 报告 §攻击点 1/§实测记录（pinpoint A/B/D 隔离复现 + 健康版 P1 + 冻结测试实跑取证）；SA1 `/tmp/sa1-r2-verify.mjs`（R2-A/B/C 输出，§1.5 证据 3）；`YArray.js:76-80`、`YMap.js:76-82`；下方最小复现片段自包含可重跑 | 高（未修复 G1 永红）→ 已由 §1.5 修复裁决消除（SA2 健康版实测全绿） |

**RA-9 最小复现片段（自包含，任意 yjs@13.6.x 环境可重跑）**：

```js
import * as Y from 'yjs';
const doc = new Y.Doc(); const root = doc.getMap('ROOT');
const tags = new Y.Array(); tags.insert(0, ['a']);
const file = new Y.Map(); file.set('tags', tags);
const assets = new Y.Map(); assets.set('f', file);
root.set('assets', assets);   // tags 首次集成
root.set('keywords', tags);   // 二次集成 → TypeError: Cannot read properties of null (reading 'length')
```

**可重跑脚本清单（R2，SA2 攻击点 3 补偿）**：RA-1~RA-8 复核以 SA2 `/tmp/sa2-protocol-battery.mjs`
（报告 §独立实测复测记录节，全量复测通过）或等价脚本为准——SA1 初轮 `/tmp/sa1-yjs-verify.mjs` 已
清理、不再作为可重跑锚（其输出摘录保留在 RA 表内作为历史依据）；RA-9 用上方内联片段（自包含）。

**其余无新协议级假设**：除 RA-1~RA-9 外，本设计不引入新端点/端口/进程/CI 时序/第三方库行为假设
（零新依赖，§12）。初轮「无其他协议级假设」的表述失实（冻结 fixture 手工构造负载面属盲区，SA2
攻击点 1 揭示）——以 RA-9 登记为更正。

---

## §10. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数

| 函数 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `replaceRootContent`（新增公共） | `packages/doc-runtime/src/replace.ts` | （不存在） | `(derived, snapshot, doc) => {ok:true} \| {ok:false; issues}`；throw DOCRT-E202/E201 例外面（§2/§6） |
| `assertOutermostTransactionContext`（内部搬迁 + 参数化） | materialize.ts:132 → tx-guard.ts | `(doc) => void`（throw E202） | `(doc, api: string) => void`（谓词逐字不变；A/B 消息 `${api}` 插值，materializeRoot 侧渲染字节同一） |
| `buildTopEntries`（内部搬迁） | materialize.ts:198 → detached-build.ts | `(derived, snapshot) => {kind:'ok';entries} \| {kind:'issue';issue}` | 同左（逐字不变；issue 名义类型 `MaterializeIssue`→`BuildIssue`，结构同一） |
| `plainObjectOf` / `recordSlotOf` / `declaredFieldOf`（内部搬迁 + `@internal` 导出，R2 显式化） | materialize.ts:643–663 → detached-build.ts | 模块私有 | `@internal` 包内共享导出（唯一消费方 = install-verify 的 productEqual/deepEqualValue/keysetOf；walk 先例；G6 只锚 index.ts 公共面，不受影响）；实现逐字不变 |
| `makeIssue`（内部搬迁 + `@internal` 导出，R3 显式化） | materialize.ts:670 → detached-build.ts | 模块私有 | `@internal` 包内共享导出（跨模块消费方 = materialize 留守 prepare 的载体 issue/非空 ROOT issue 两处，源码 464/467——SA2 R2-A1 补登；builder 内部 issue/shapeIssue/domainIssue 同源，源码 665「统一出口」）；实现逐字不变（2 行 `{message, path}` 构造器，行为零变化） |
| 类型 `Path`/`Resolver`（迁出）+ `BuildIssue`（新建名义类型，R2 显式化） | materialize.ts:57–58 → detached-build.ts | 模块私有类型 | `@internal` 类型导出（消费方 = install-verify 的 ScratchInstall/ProductComparison/productEqual 签名；结构同一，无运行时转换） |
| `verifyInstall` / `verifySnapshotIntact`（内部搬迁） | materialize.ts:155/242 → install-verify.ts | 见现签名 | 逐字不变 |
| `materializeRoot`（公共） | materialize.ts | `MaterializeResult` | **零变化**（签名/消息/行为逐位不变；仅内部 import 改道） |

### Caller 清单（全仓 `git grep` 证据，2026-08-23）

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| index.ts（公共重导出） | `packages/doc-runtime/src/index.ts:29-30` | N/A（同步 re-export） | N/A | N/A | 不变（materializeRoot 路径）；新增 replaceRootContent 两行 |
| materializeRoot 内 ⓪ 调用 | `packages/doc-runtime/src/materialize.ts:98` → 迁后同位 | 同步 | ❌（有意：⓪ 在一切 try/catch 之外，INV-5） | 函数级无 catch（throw 是契约面） | 保持；改为 `assertOutermostTransactionContext(doc, 'materializeRoot')` |
| materializeRoot 内 ② 调用（prepare 直调 + 经 buildScratchInstall 间接调） | `materialize.ts:458`（prepare 直调；buildScratchInstall 迁入 install-verify.ts 后经其内部调） | 同步 | ✅ prepare try/catch → E200（② 位）；⑥ 位变体 D 收编 | 同左 | 保持；两处均 import 改道 detached-build.js |
| materialize 留守 prepare → `makeIssue`（R3 补登，SA2 R2-A1 唯一未闭合符号） | `materialize.ts:464/467`（③ 载体 issue + 非空 ROOT issue 构造） | 同步 | ✅ prepare try/catch → E200 崩溃边界内（既有失败面，返回值传递） | 函数级无 catch（ok:false 是契约面） | `@internal` import 自 detached-build.js（§3.1 导出面 R3 增补；SA3 零裁量） |
| materializeRoot 内 ⑤⑥ 调用 | `materialize.ts:107-109` | 同步 | ❌（有意：try/catch 之外，W1） | 函数级无 catch（E201 throw 是契约面） | 保持；import 改道 install-verify.js |
| install-verify（新消费方，R2 显式化） | `packages/doc-runtime/src/install-verify.ts`（productEqual map 分支/deepEqualValue/keysetOf 调用点，迁自 materialize.ts:309–319/388–389/419） | 同步 | N/A（纯函数调用；既有语义——异常由 ⑥ 变体 D 收编） | N/A | `@internal` import `plainObjectOf/recordSlotOf/declaredFieldOf` + `Path/Resolver/BuildIssue` 自 detached-build.js（DAG 单向边 §3.1；SA2 攻击点 2） |
| replaceRootContent（新 caller） | `packages/doc-runtime/src/replace.ts`（新） | 同步 | 同 materializeRoot 同位纪律（⓪④⑤⑥ 外、①②③ 内） | E200/E202/E201 契约面 | §4 规格 |
| 测试导入 | `packages/doc-runtime/test/*.test.ts`（全部经 `../src/index.js` 黑盒） | N/A | N/A | N/A | 不受内部模块搬家影响（无测试深 import materialize.js——`git grep "from '../src"` 证据：仅 read.js 一例且与本设计无关） |
| 包外消费者 | （无）——`git grep -ln "@nomicore/doc-runtime" -- ':!packages/doc-runtime' ':!wiki'` 仅命中 docs/adr 文档 | N/A | N/A | N/A | 无连锁 |

**风险声明**：无 `return→throw` 类契约翻转、无同步变异步、无 nullable→non-null 签名翻转；唯一 throw 面
（E202/E201）为**新增函数的自有契约** + 既有函数的既有契约（逐字保持）。caller 总数 < 10，变更半径
收敛于包内。

---

## §11. 一致性自检记录（SA1 交稿前）

- `grep -n "replaceRootContent\|buildTopEntries\|assertOutermostTransactionContext\|clear()" <本文件>`：
  各术语跨章节语义一致（replaceRootContent 恒为最外层语境接缝；buildTopEntries 恒为唯一 ② 构造
  接缝【非唯一导出——`@internal` 辅助/类型共享面见 §3.1 定稿清单】；clear 恒指原实例删键、无「重建/
  换实例」表述）。
- 无死引用：§4 伪代码只引用 §3 定义的三个 seam + 既有叶子模块（probeRoot/validateLogicalSnapshot/
  extractYjsSnapshot）；无引用已删除或假设中的 API。
- 无自相矛盾：§4.3「恰 1 update」与 §4.4「observer 重入额外 update」已由计数法则（§4.3 表）显式划界
  （前者 = ④ 变更集自身的可观测面，后者 = 独立新事务）；§5 裁决与 §4.1 guard、G7、rev2 RD7-P1 四方
  同向。
- 与冻结契约逐条对照：简报「契约冻结」节 5 要点（接缝签名/结果联合/非空可替换/E202 前置/设计决策点）
  分别落 §2、§2、§1.3+§4.2③、§4.1、§5——零收窄，仅补充（计数法则、消息措辞、模块边界）。
- R2 修订自检（2026-08-23，SA2 R1 reject 逐条落实后）：
  - 攻击点 1 七处联动一致：头部红灯表述 → §1.4 机制注脚 → §1.5 登记/修复裁定/归属裁决 → D12 →
    §8 首行 → RA-9（含内联复现片段）→ §12 测试文件 R2 窗口；「13 用例=构造性红灯」旧表述全文
    清除（更正为「12/13 构造性 + G1 fixture 缺陷」，grep 验证仅存于更正语境）。
  - 攻击点 2 三方一致：§1.2 行号表（54–58 去向拆分）≡ §3.1 导出面清单（`@internal` 三辅助 +
    三类型，写死）≡ §10（新增 2 行改动 + 1 行 caller）≡ §12 detached-build 条目；「唯一导出」
    歧义表述全文清除；DAG 边全集补 install-verify → detached-build 单向边（D11 同步）。
  - 攻击点 3：§9 附可重跑脚本清单 + RA-9 自包含片段；初轮 scratch 清理如实登记。
  - 攻击点 4：D8 决策行 ≡ §4.2 伪代码 E200 消息（模块名 `replace 内部错误`）一致。

---

## SA2 反馈逐条回应（R2 修订）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| 攻击点 1（CRITICAL）：登记 G1 fixture 二次集成缺陷与三重证据；更正简报根因归纳（12/13 构造性红灯，G1 为 fixture 缺陷）；裁定最小接线修复（断言逐字保留、每实例恰集成一次、推荐 `oldFile.tags` 改独立实例）；归属裁决二选一写明；§1.4/INV-7 机制注脚 | ✅ | §1.5（新节）+ §1.4 注脚 + D12 + 头部红灯表述 + §8 首行 + RA-9 + §12 测试文件窗口 + RINV-3 | 缺陷登记（test:337–374，`oldFileTags` 双集成）；证据 = SA2 三重 + SA1 独立复现（R2-A/B/C）；根因更正（12/13 构造性 + G1 fixture 崩溃，SA1 无简报写权以设计登记代更正）；最小修复裁定 = 断言逐字锁定 + 不变量「每实例恰集成一次」+ 推荐形态采纳 + 防回归注释一行；归属裁决 = **授权 SA3 执行**（三理由）+ SA6 重发回退路径；机制注脚（`YArray.js:76-80`/`YMap.js:76-82`：`_prelimContent` 消费置 null → 二次 `_integrate` 以 null 调 `insert`/`forEach`） |
| 攻击点 2（MEDIUM）：显式定义 install-verify→detached-build 共享接缝（@internal 或第四模块，写死不留 SA3 自由裁量）；修正 §1.2 与 §3.1 类型归属矛盾（54–58 行）；同步 §10 | ✅ | §3.1（导出面清单 + DAG 边全集 + 不选第四模块理由）+ §1.2（54–58 行拆分订正）+ §3.2（walk 先例直援）+ D2/D11 + §10（新增 2 行改动 + 1 行 caller）+ §12 | 选型写死：`@internal` 导出 `plainObjectOf/recordSlotOf/declaredFieldOf` + 类型 `Path/Resolver/BuildIssue`（walk 先例；不选第四模块理由：三辅助属 ② 构造域语义，拆出徒增域漂移与 ALLOW 面）；「唯一导出」歧义全文清除；54–58 行归属与 §3.1 对齐 |
| 攻击点 3（MINOR）：脚本可重跑性补偿 | ✅ | §9（可重跑脚本清单 + RA-9 内联最小复现片段） | RA-1~8 复核锚定 SA2 battery 脚本（全量复测通过）；RA-9 片段自包含可重跑；初轮 SA1 scratch 已清理如实登记、输出摘录降为历史依据 |
| 攻击点 4（MINOR）：E200 命名基调一句话 | ✅ | D8 + §4.2 伪代码 | 定调**模块名制**：replace 侧 `DOCRT-E200: replace 内部错误（意外异常）`，与 materialize 侧 `materialize 内部错误` 同基调（两制并存，既有锚均 `/DOCRT-E200/` 正则，兼容） |

## SA2 反馈逐条回应（R3 修订——SA2 R2 复审 R2-A1 外科闭合）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| R2-A1（MEDIUM，唯一放行障碍）：`makeIssue` 跨模块归属未闭合——留守 prepare（源码 464/467）调用 × §3.1 私有清单 × §12「三处 import」授权，SA3 按字面不可编译；按方案 A（推荐）修订 | ✅ | §3.1（`@internal` 导出面增补 `makeIssue` 新 bullet + 私有清单剔除 + materialize bullet import 注记）+ §10（改动函数表 +1 行 `makeIssue` 行 + caller 表 +1 行补登 464/467）+ §12（detached-build 导出面 / materialize.ts import 授权两处） | 方案 A 采纳：`@internal makeIssue`（issue 构造器**统一出口**——源码 665 行自述「shapeIssue / domainIssue / makeIssue 全部收敛到此」；跨模块消费方 = materialize 留守 prepare 载体/非空 issue 两处 464/467；builder 内部同源）；三处同步、SA3 零裁量、行为零变化（2 行构造器逐字搬迁） |
| NIT-R2-1（MINOR，非阻塞）：§1.5 证据 2「G1 全量断言通过」措辞超出 SA2 battery 枚举面 | ☐ 未处理（显式登记） | — | SA2 明示「不要求本轮处理」；总控 R3 指令为单点外科「不动其他章节」——§1.5 不在本轮授权面，避免超范围改动。建议措辞已存 SA2 R2 报告，留待后续修订轮或 SA6 重发时顺带 |

---

## §12. 文件清单（File Scope）

### ALLOW LIST

- `packages/doc-runtime/src/detached-build.ts` — 新建（~320 行）：② detached builder 收敛 seam。自
  materialize.ts 纯移动（196–210、477–711 区段 + 54–58 内部类型），逐字不变；导出面（R2 定稿 + R3
  增补 `makeIssue`，SA2 R2-A1，§3.1）= `buildTopEntries` + `@internal` 辅助
  `plainObjectOf/recordSlotOf/declaredFieldOf/makeIssue` + 类型 `Path/Resolver/BuildIssue`，其余私有
  （AC-1 单源落点；G6 只锚 index.ts 公共面，不受影响）。
- `packages/doc-runtime/src/tx-guard.ts` — 新建（~45 行）：⓪ 事务语境 guard 收敛 seam。自 materialize.ts
  迁出（113–146），谓词逐字不变，A/B 消息 `${api}` 插值且 materializeRoot 侧渲染字节同一（§4.1/D7）。
- `packages/doc-runtime/src/install-verify.ts` — 新建（~240 行）：⑤⑥ 写后校验收敛 seam。自
  materialize.ts 迁出（148–194、212–439 区段），逐字不变；导出 `verifyInstall`/`verifySnapshotIntact`
  （§3.1/§4.4）；import 面含 detached-build 的 `@internal` 辅助/类型（DAG 边 §3.1，R2 显式化）。
- `packages/doc-runtime/src/materialize.ts` — 修改：删三段迁出体 + 改三处 import（其中 detached-build
  import 含 `@internal makeIssue`——留守 prepare 载体/非空 issue 构造依赖，源码 464/467，R3/SA2
  R2-A1）+ 头部 JSDoc 登记收敛
  （711 → ~180 行）。公共契约零变化（§10；回归门 = 215 既有用例全绿）。
- `packages/doc-runtime/src/replace.ts` — 新建（~170 行）：`replaceRootContent` 六阶段编排 +
  `ReplaceIssue/ReplaceResult`（§2/§4；D1/D3/D4/D5/D9 落点）。
- `packages/doc-runtime/src/index.ts` — 修改（~10 行）：新增 `replaceRootContent` 值导出 + Issue/Result
  类型导出 + 头部接缝清单注释（公共面恰 4 值导出，G6 锚）。
- `packages/doc-runtime/package.json` — 修改（1 行）：version 0.1.5 → 0.1.6（D10，rev2 RD11 先例）。
- `packages/doc-runtime/test/replace-root-content.test.ts` — `[SA6 owned]` Phase 1 验收红灯（已落盘，
  13 用例）。断言逻辑**逐字锁定**，任何 SA 不得改。**R2 修订（SA2 攻击点 1 / D12 裁决）**：授权
  SA3 凭 §1.5 登记理由执行 G1 fixture **最小接线修复**——不变量「每个手工 Y 实例恰被集成一次」
  （推荐 `oldFile.tags` 改用独立 `Y.Array` 实例，使 test:373 成为 `oldFileTags` 首次集成）+ 一行
  防回归注释（「每实例恰集成一次（yjs 二次集成 `_prelimContent=null` 崩溃）」）；断言零改动
  （SA2 健康版实测全绿背书，§1.5 证据 2）；若发现断言语义受牵连 → 停止并上报总控，回退 SA6 重发
  路径。除此之外仅允许 vitest 环境级修正且须设计修订登记理由。

### DENY LIST

- `packages/doc-runtime/src/extract.ts` / `read.ts` / `carrier.ts` / `resolve.ts` / `xml-parse.ts` —
  既有叶子模块与公共读入口零改动（⑥ 仅调用 extract/resolve/xml-parse/carrier，不改其实现）。
- `packages/doc-runtime/test/` 其余既有测试文件（materialize-root*.test.ts、extract-*.test.ts、
  read-logical-*.test.ts 等）— 不得改动（回归锚完整性）。
- `packages/vfsl/**`、`packages/vfsl-protocol/**`、`packages/vfsl-codegen/**` — 上游/编译期轨道零交集。
- `packages/persistence/**`、`packages/dsh-persistence/**` 及其余 packages / apps — 与本任务无涉。
- `docs/adr/**` — ADR-0008 已直接授权本任务，无需修订；SA1 无 ADR 写权。
- `.github/workflows/**` — 无 CI 变更需求（零新依赖，Node 20/24 既有矩阵覆盖）。
