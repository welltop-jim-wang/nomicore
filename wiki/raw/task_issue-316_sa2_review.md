# SA2 设计攻击评审 — issue #316：codegen 与 readData 投影适配 int/range 叶子（iteration 1）

- Dispatch：`sa-646f4942-d0c2-4e7f-a5b5-778707774d7b`（mabf-sa2 / design-review / iteration 1）
- 评审对象：`wiki/raw/task_issue-316_design.md`（SA1，dispatch `sa-6eb368a3…`，**iteration 1 修订版**）
- 基线 worktree：`/home/wangjian/nomicore-fix-issue-316`，分支 `mabf/issue-316`，HEAD `bd9fb93dd69d6b27f10113cd98d8dfca9184ce8c`（SA2 本轮 `git log -1` 复核未漂移；`git status` 仅 Host 未跟踪的 4 件 wiki/raw 产物）
- 评审方式：独立只读复核（源码、ADR、AGENTS、既有测试、CI、钉值），不修改设计/生产/测试，不运行测试
- 本轮任务（派工单）：核验 iteration 0 唯一阻断项 **F1 是否落实**、修订后的**测试-only 覆盖计划**是否正确、完整、架构一致

---

## 1. Reviewed inputs

| 输入 | 状态 |
| --- | --- |
| `wiki/raw/task_issue-316.md`（Host 简报） | 存在；Issue body 4 AC + Blocked by #315；§Comments 空 |
| `wiki/raw/task_issue-316_design.md`（SA1 设计 **iteration 1**） | 存在；本轮评审对象（§14 含对 iteration 0 F1~F5 的逐条修订映射） |
| `wiki/raw/task_issue-316_sa6_contract.md`（SA6 契约，iteration 0，approve） | 存在；已交叉核对（§12.6 四缺口、P1~P8、探针 C 上游证据） |
| `wiki/raw/task_issue-316_relevant_decisions.md` / `task_issue-316_conflict_report.md` | 不存在（SA1/SA6 同认；以权威 ADR + 模块 AGENTS + CI 替代核验） |
| Issue comments REST snapshot | 空（派工单明文；无 owner 追加要求） |
| `wiki/raw/task_issue-316_sa2_review.md` | 本产物；iteration 0 版原位更新为 iteration 1（F1 已解决，从阻断表移除，ID 保留用于映射） |

## 2. Verdict

**`approve`** —— iteration 0 唯一阻断项 **F1（MAJOR）已按裁定的方案 (b) 完整落实并经 SA2 独立逐行复核成立**：T-4 改为文件内自包含装置（`runtime-readdata-int-range.test.ts` 私有 TXT_316/seedRoot316/makeHandle316/makeReadyRuntime316 + 只读复用 `real-persistence-scheduler.ts`），§10 ALLOW/DENY 与之一致，#273 fixture 维持只读，`readData(['b'])` 预写值 50 可观察——F1 验收三条件全部满足（详见 §6/§12）。设计内核（生产零改动、四锚点、4 项覆盖缺口、门禁映射、非目标边界）本轮再次独立复核全部成立；HEAD/钉值/测试清单未漂移。本轮新增发现均为措辞/锚点精度级（N1~N3，非阻断），无 BLOCKER/MAJOR。`pass` 仅指设计通过审查；实现与活链路验证仍归 SA4/SA7。

## 3. 需求覆盖

| Requirement | Design section | Assessment |
| --- | --- | --- |
| AC1 含 Int/Range 字段的 schema 生成 TS 为 `number`，生成物可编译 | §2.1、§7 D-1/T-1/T-2、§12 | **成立**（本轮复验）。`valuetype.ts:35-39` `case 'int': case 'range': return 'number'`（注释明引 ADR 0020 决策 7）；`generate-int-range.test.ts` 结构亲验恰 10 用例（:101 前置 + :109 `it.each` 6 行 + :113 数组位 + :119 无 desync + :126 编译）；`preEmitDiagnostics` 在场 |
| AC2 `pnpm generate --check` 既有生成物零漂移 | §2.4、§7 D-2、§12 | **成立**（本轮复验）。SA2 实测 `sha256sum domains/vfs3-assets/generated.ts` = `342d8c1f…e6707`，与 SA1/SA6 钉值逐字节一致；CI `codegen-freshness` job（ci.yml:128）与 `pnpm generate --check` 步骤（:147）亲验；根 `package.json:14` generate 脚本亲验 |
| AC3 投影路径落在 int/range 叶上与 pattern 叶同构（终态/拒绝分类一致） | §2.2/§2.3、§7 D-3/D-4/T-3/T-4、§12 | **成立**。实现面：`resolve-schema-at-path.ts:289-291` 值级终态 default（注释列 int/range）、别名闭包访客 `:413-414` 同款、`classifyStructureReject` `:362-372`（本轮亲验函数体行号，F5 口径正确）；`read-schema-projection.ts` `case 'int'` `:172-178` / `case 'range'` `:179-183`（本轮亲验）。测试面：T-3 配对断言（含 `['b',{}]↔['pp',{}]` 同码 `SCHEMA_PATH_INVALID`）经 SA2 静态核验**分类正确**——敌意段 `{}` 由 `resolve-schema-at-path.ts:100-104` path 形状守卫前置判 `SCHEMA_PATH_INVALID`（非 classifyStructureReject 路径）；T-4 readData 配对经核验可观察（见 §6 N1 的机制措辞修正） |
| AC4 包测试、typecheck 全绿 | §2.4、§12 | **成立**。CI typecheck job（:20）、`pnpm typecheck`（:39）、`vitest run --typecheck.only --passWithNoTests=false`（:44）、test job 6 分片（job `test:` 起 :50 附近、分片运行 :80 附近）亲验；根 `vitest.config.ts:15`（`packages/*/test/**/*.test.ts`）/`:20`（`*.test-d.ts`）亲验——新测试文件零配置自动落入 |
| What to build：resolve-schema-at-path 不新增拒绝路径与失败码 | §2.2、§7 D-3、备选 2 | **成立**。失败码定义亲验（`:98`/`:102`/`:141`/`:161`）；ADR 0020 决策 8 原文（`docs/adr/0020-vfsl-number-constraints.md` 决策 7 标题 :147、决策 8 节 :155-160，本轮亲验）与设计引用语义一致 |
| Blocked by #315 | §3/§5 | 成立：HEAD 即 #351，`git log -1` 本轮亲验 |
| 非目标（品牌类型、#315 本体、`domains/vfs3-assets/**`、冻结面） | §1 | 与 ADR 0020 决策 7（:147-153）、决策 10「明确不做」（:179/:186）一致，无静默扩大 |

## 4. Owner评论覆盖

REST snapshot 为空（派工单明文），简报 §Comments 为空。设计 §4 如实记录且声明 iteration 1 仍未变——**正确**，无遗漏义务。

| Comment ID | Updated at | Design section | Assessment |
| --- | --- | --- | --- |
| （无评论） | — | §4 | 与派工事实一致 |

## 5. 上游事实与SA8约束

| Fact or constraint | Design response | Assessment |
| --- | --- | --- |
| SA6 §4 溯源：#316 相关 4 文件改动全在 #351 内，resolve 仅注释级 | §3/§5 采纳 | 本轮 `git log -1` 复核 HEAD = `bd9fb93`（#351）一致 |
| SA6 §5 P1~P8 全绿；**P6（探针 C）以自建 runtime + FIXTURE_PAIRED 形态实测**（值 50、docs `{'ROOT.b':[…]}`、配对 `PATH_NOT_ALLOWED`） | §5 明确引为 T-4 自包含装置可行性的直接上游证据 | 定位准确；SA2 静态复核同构装置的全部接缝真实（见 §6 F1 行）——上游证据与源码事实互洽 |
| SA6 §12.6 覆盖缺口 4 项 | §7 T-1~T-4（+可选 T-5） | (b) 缺口本轮复验为真：`grep -rn "Int<\|Range<" packages/namespace-runtime/test/` **零命中**；既有 readData 测试清单亲验恰为 control/red/hostile-guard/schema-red.test-d 四件 + 共享 fixture |
| SA6 §12.6 (b) 建议落点原文「沿 readdata-schema-projection-fixture.ts 装置」 | §5/§7 T-4 **修订为「同配方自包含装置」**并声明不与 SA6 事实性结论冲突 | 修订正当：fixture 真实形态（本轮亲验 `:73-76` opts 仅 text/seedSchema、`:87` 无条件硬编码 `seedRoot`、`:93-98` 无参 `makeReadyRuntime`）确不能承载 Int/Range 预写值；缺口 (b) 为真、C3c 断言集原样保留，仅装置路径精确化 |
| ADR 0020 决策 5/7/8/10 | §2/§6/§7 | 原文本轮亲验（决策 7 :147-153、决策 8 :155-160、决策 10 :179 起），引用无失真 |
| ADR 0016（readData 三键/detached/两码冻结）+ `packages/vfsl/AGENTS.md` 例外条款 | §2.3、§7 T-4 | `runtime.ts:474-486`（`:486` 恰三键、`:485` 失败短路透传且无 `schema` 键）、`detachReadSchemaProjection` `:106-114`（每次读全新 wrapper 四件套）本轮亲验支持 |
| `packages/namespace-runtime/AGENTS.md`（读在 sequencer 外；公共面只暴露 detached 投影；生产构造器与测试 seam 保持内部） | §6、§7 T-4 | 条款原文亲验；T-4 走 `../src/runtime.js` seam import 与既有 #273 fixture `:16` 同款先例，只经 `readData`/`getStatus` 公共面观察——一致 |
| 根 `AGENTS.md` Typed Namespace writes（PathAt/PathPatchValue fail-closed） | §6/§7 T-1 | C1c 为读侧编译级哨兵，定位准确；协议导出面亲验：`PathAt` `index.ts:59`、`PathValue` `:72`、`PathPatchValue` `:81`、`VfslTypedAccess` `:118`（接口体延至 :120 附近，`patch` 成员 `value: PathPatchValue<PathAt<Map, NoInfer<P>>>` 在场） |
| persistence `createDoc` 的 META.docId 契约 | §7 T-4 步骤 4 引 `packages/persistence/src/testing.ts` | 本轮亲验：`testing.ts:622-642`「validates only META.docId: rejects mismatch, tolerates missing ROOT/SCHEMA and arbitrary createdAt」——T-4 步骤 4 的「docId 必须与 createDoc 一致、违约即拒」准确 |
| SA6 U1（票面错位，Host 处置未决） | §13 R4 如实转录 | 正确路由给 Host，设计对两种处置均可用 |
| 无 316 专属 SA8 产物 | §6 以 ADR+AGENTS+CI 替代 | 可接受；替代核验内容经本轮复核无冲突；`requiresConflictRecheck` 维持 false |

## 6. 设计内部一致性

| 检查点 | 结论 |
| --- | --- |
| **F1 落实（iteration 0 阻断项）**：§2.3 fixture 真实形态 → §7 T-4 自包含装置 → §10 DENY fixture 只读 | **三方自洽，矛盾消除**。装置构造路径（步骤 1~6）经 SA2 逐项对源码核验**可照抄执行**：(i) imports 全部真实——`createMemoryPersistence`/`DocHandle`/`User` 自 `@nomicore/persistence`（fixture `:13-14` 同款）、`realPersistenceScheduler` 为非 vitest 收集共享助手（其头注 `:14-15` 自证不匹配 include；scheduler 必填自 issue #107 的背景在 `:2-7`）、`createNamespaceRuntimeWithSeam` 导出于 `runtime.ts:343`、`NamespaceRuntime` 类型自 `../src/index.js` 再导出（index.ts:31）；(ii) ENV 四键（lang/version/id/text）与 `envelopeStrictGate` 入口契合（`compileSchemaEnvelope` = gate→parseVfslImplementation→evaluate，`packages/vfsl/src/index.ts:324-344` 亲验——int/range 文本经 #315 parser/evaluator 正常编译，TXT_316 形态有 resolve 测试 FIXTURE 与既有 `Record<string,…>` 先例（`evaluate-derived-schema.test.ts:45`、`evaluate-derived-docs-audit.test.ts:95`）双重支撑）；(iii) 播种时点「runtime 构造前、先于 createDoc」与 fixture `:84-88` 逐行同构（META docId/createdAt → seedRoot → createDoc）；(iv) `expect.poll(…, { interval:10, timeout:5_000 })` 与 fixture `:96` 同款；(v) 每 `it` 以 `await runtime.close()` 收尾有既有先例（red 测试 `:203/:214/:230`；`close` 为公共键 `runtime.ts:217/:600`）；(vi) 断言清单全部锚到已核验行为——三键（`runtime.ts:486`）、`value===50`（seed b=50 → ROOT 载体 → `readLogicalValueAtPath`）、`{kind:'int',min:1,max:100}` 深等（P4 + `cloneValueSchema` 条件键 `:172-178`）、裸 Int 键恰 `['kind']`、range 两键 `:179-183`、`['e',1]`→7（seed [4,7]）、docs 键 `'ROOT.b'`（sliceDocs 脊柱键形如 `ROOT.a`，`resolve-schema-at-path.ts:432` 注释自证）、detached（`:106-114` 每读全新 wrapper）、失败配对同码 `PATH_NOT_ALLOWED`（`doc-runtime/src/read.ts:27/:46` 失败单通道 + `runtime.ts:485` 透传） |
| §7 T-4 断言「`readData(['b','x'])`/`['p','x']` 同码 `PATH_NOT_ALLOWED`、无 `schema` 键、`path` 回显」 | **断言正确**；但其括注「resolve 侧 `SCHEMA_PATH_NOT_FOUND` 经 `runtime.ts:485` 透传为 readData 失败联合」**机制归因有误**（→ N1，非阻断）：`:485` 透传的是 doc-runtime 值读失败的 `PATH_NOT_ALLOWED`（`read.ts:147` `notAllowed`），resolve 侧失败在成功分支内收敛 `schema:null`（`read-schema-projection.ts:57` `if (!resolved.ok) return null`），**从不进入 readData 失败联合**。断言集本身不受影响 |
| §7 T-3（F2 落实）：配对面改名 `pp`/`ppe`/`ppr`/`ppu` + 容器侧补 `u`/`r`；既有 7 断言零改动 | **自洽**。既有 FIXTURE 字段亲验为 `a,b,c,d,e,p,q`（`resolve-schema-at-path-int-range.test.ts:16-25`，`p` `:22`/`q` `:23` 为 int/range 单点）——新名零碰撞；既有 7 用例（`:52-:91`）仅按路径取投影，fixture 纯增字段不影响其断言；配对断言的失败分类经静态核验正确（见 §3 AC3 行） |
| §7 T-1（F3 落实）：类型 import 自 `@nomicore/vfsl-protocol`；`M` := 被生成文本增广后的 `VfslPathMap`；先例 `generate-number-literals.test-d.ts:15,30` | **自洽**。先例形态亲验（`:15` protocol import、`:30` `declare const access: VfslTypedAccess<import('@nomicore/vfsl-protocol').VfslPathMap>`）；生成物增广形态亲验（`domains/vfs3-assets/generated.ts:23-27` `declare module '@nomicore/vfsl-protocol' { interface VfslPathMap {…} }`）；`tsc-helper.ts` `paths` 把 `@nomicore/vfsl-protocol`/`@nomicore/vfsl` 指到仓内源码（`:44-47`） |
| §7 T-2：JSON 克隆 `DERIVED`（同文件 `:47` 模块级 const 亲验）值侧改 `{kind:'xml'}` → 抛错含 `structure/value desync` | 一致；消息模板亲验 `emitter.ts:532-533`；白名单条件块 `:339-348` 亲验 |
| §7 备选 6（方案 (a) 拒绝理由四条） | 理由 (i)(ii)(iv) 成立且经核验（#273 fixture 头注确将 rogue/skus.ZZ1 等载体形状文档化为契约素材；vfsl 侧 #351 确选新文件局部 FIXTURE 而非扩展共享 `resolve-schema-at-path-fixture.ts`；F1 验收要求不触碰既有 readData 测试）；理由 (iii) 的引语「T-\* 全部为加法、零修改既有文件」**表述过强**（→ N2，非阻断）：T-1/T-2/T-3 按 §10 ALLOW 是对既有文件的**加法式扩展**，字面「零修改既有文件」仅对 T-4 成立 |
| §2.3 锚点（F4 落实）：三键 → `runtime.ts:474-486` + JSDoc `:117-124`；`:102-114` = detach 四件套 | 一致（`:102-105` doc 注释 + `:106-114` 函数体，口径正确；「ok 成员恰三键」短语在 `:124`）；断言与结论不变 |
| 其余：D 系列「保持现状」与 §2 证据、§8 接口/状态机/数据流「无变化」（含新增 D 路线的构造时播种说明）、§11 调用方矩阵（#273 契约组「完全不变」）、§12 验收映射、§13 R1~R6 | 一致，无死引用、无旧 API、无前后相反描述；iteration 1 新增的 §8 D 路线/§9 装置失败路径/§13 R6 与 §7 T-4 相互印证 |
| §14 修订映射 | F1~F5 五行与正文修订位置逐一对应，声明属实 |

## 7. 状态机与并发攻击

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
| --- | --- | --- | --- | --- | --- |
| S-1 | runtime `schema.state` 未 ready | T-4 测试在 ready 前调 `readData` | 有界等待后 ready（`expect.poll` interval 10/timeout 5s 与 fixture `:96` 同款），超时 fail loud | 无 | 无 |
| S-2 | `generate --check` 新鲜 | 生成物陈旧 | exit 1 且不写盘 | 无（既有 `generate-cli-check.test.ts` 覆盖；T-5 可选项定位准确） | 无 |
| S-3 | 任意 | 生产代码被误改（R1） | `generate --check` / 全量测试红 | 无（DENY + C2 门禁拦截） | 无 |
| S-4 | T-4 装置构造中 | schema 文本解析失败 | poll 等待 `'ready'` 超时（5s）红——state 实际转 `'unavailable'`（red 测试 `:207-209` 先例），fail loud 无静默跳过 | 无 | 无 |

生产链路（parse→evaluate→emit；resolve 纯函数；readData 同步快照读）无状态机/并发语义变化——§8 声明与源码形态一致。**无新增攻击面。**

## 8. 错误与恢复攻击

| ID | Failure | Current design behavior | Risk | Required revision |
| --- | --- | --- | --- | --- |
| E-1 | codegen 遇不支持形状 | `structure/value desync` 响亮抛错（T-2 锚定稳定片段，不钉全文） | 无——`emitter.ts:533` 模板亲验含该片段 | 无 |
| E-2 | resolve 失败 | 恰两枚冻结码；敌意段经 `:100-104` path 形状守卫前置判 `INVALID`，其余按 `classifyStructureReject` 二分 | 无——T-3 码集合断言 ⊆ 两枚，分类经静态核验正确 | 无 |
| E-3 | readData 值读失败 | `PATH_NOT_ALLOWED` 原样透传（`runtime.ts:485`；`read.ts:27/:46/:147` 失败单通道：ok/code/path 新鲜副本/message），失败对象无 `schema` 键 | 无——T-4 配对同码断言与源码一致 | 无 |
| E-4（iteration 0 缺口） | T-4 装置无法构造目标场景 | **已关闭**：§7 T-4 步骤 1~6 给出可照抄构造路径（本轮逐项核验真实），§9 补齐装置失败路径（META.docId 违约 → persistence 拒绝 `testing.ts:630/:636`；解析失败 → poll 超时红；播种遗漏 → 值断言红），无任何静默 fallback | 无 | 无 |

无静默失败、无伪成功、无 fallback 掩盖不变量的设计内容。

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
| --- | --- | --- | --- |
| `generateProjection` / `resolveSchemaAtPath` / `NamespaceRuntime.readData` / CLI 参数面 | 无——零生产改动，§11 矩阵与真实消费者核对一致 | §8/§11；源码亲验 | 无 |
| 新增 `.test-d.ts` 镜像（可选）对全局 `VfslPathMap` 的增广 | 无碰撞：仓内既有增广键 `numberLiterals*`/`entityList`/`name`/`portraitResourceId`/`tree` 与 T-1 镜像键无交集 | `generate-number-literals.test-d.ts:19` 等先例 | 无 |
| T-1 临时 program 的模块解析 | 无——`tsc-helper.ts` `paths`（`:44-47`）已把 protocol/vfsl 指到仓内源码 | `packages/vfsl-codegen/test/tsc-helper.ts` | 无 |
| T-4 新文件对 vitest/CI 入口的发现 | 无——根 include `packages/*/test/**/*.test.ts`（`vitest.config.ts:15`）零配置落入分片 | vitest.config.ts；ci.yml :50/:80 附近 | 无 |
| #273 readData 契约组（fixture 既有消费方） | 无——T-4 自包含，fixture/scheduler 零触碰（DENY 行与装置路径一致） | §10/§11 | 无 |

## 10. 架构一致性与惯例审查

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
| --- | --- | --- | --- |
| codegen 编译级/负控测试 | `packages/vfsl-codegen/test/` | T-1/T-2 扩展 `generate-int-range.test.ts` | 正确 |
| resolve 同构配对测试 | `packages/vfsl/test/` | T-3 扩展 `resolve-schema-at-path-int-range.test.ts` | 正确 |
| readData 端到端 | `packages/namespace-runtime/test/` | T-4 新增文件（自包含装置） | 正确；装置归属已决（F1 方案 (b)），与包内 fixture/seam 惯例一致 |

### 相似能力对照

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
| --- | --- | --- | --- | --- |
| 孤立 program 编译断言 | `tsc-helper.ts` + `compileInTempDir`（`generate-int-range.test.ts:84`） | T-1 复用同 helper/形态 | 一致 | 先例亲验在場 |
| `.test-d.ts` 镜像 | `generate-number-literals.test-d.ts`（#314 C4） | T-1 可选镜像沿其形态 | 一致 | `:15/:30` 亲验 |
| readData 测试装置 | `readdata-schema-projection-fixture.ts`（#273） | T-4 **同配方新文件自包含装置**（配方镜像源 `:73-90`/`:93-98` 逐行注明） | 一致（经显式声明） | 平行装置已按 F1 要求显式声明（T-4「价值与平行装置声明」+ 备选 6 四条理由）；被真实复用的共享件仅 `real-persistence-scheduler.ts`（只读 import），无第二套调度器/持久化实现 |
| 局部 FIXTURE 先例 | vfsl 侧 #351 新文件局部 FIXTURE（不扩展 #272 共享 fixture） | T-4/T-3 同构决策 | 一致 | 备选 6 (ii) 引证属实 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
| --- | --- | --- | --- |
| 域生成物字节 | `domains/vfs3-assets/generated.ts` + CI `--check` | sha256 钉值（SA2 本轮再实测一致） | 无 |
| 失败码集合 | 源码定义 | T-3/T-4 断言 ⊆ 冻结集 | 无 |
| T-4 装置配方 | `readdata-schema-projection-fixture.ts:73-98`（只读参照，行号锚定） | 新文件私有四件构造 | 低且已显式管理（R6：漂移只使新文件自身红，fail loud） |

### 生命周期对称性

| Start or acquire | Stop or release | Failure recovery | Assessment |
| --- | --- | --- | --- |
| T-4 每 `it` 自建 runtime（P0 settle→ready 有界 poll） | `await runtime.close()` 逐例收尾（§7 T-4 步骤 6；与既有 #273 red 测试 `:203/:214/:230` 同款；close 幂等） | poll 超时/构造抛错即红 | 对称，与既有 suite 惯例一致 |

### 平行机制检查

| Candidate duplicate | Existing path | Proposed path | Disposition |
| --- | --- | --- | --- |
| T-4 自建装置（~20 行私有构造） | fixture 的 makeHandle/makeReadyRuntime | 新文件内镜像配方 | **已显式声明并给出不复用理由**（F1 方案 (b) + 备选 6）——不再构成「未声明的平行装置」 |
| 其余（cleanup worker/重试循环/第二状态字段/新 API wrapper/新调度器） | — | — | 无：T-\* 全部为既有入口上的加法观察点 |

## 11. 文件范围审查

| Path or scope issue | Evidence | Required revision |
| --- | --- | --- |
| （无）ALLOW/DENY 与正文一致：T-4 行（自包含装置 + 只读复用 scheduler + 不修改 fixture）与 §7 T-4 装置路径吻合；fixture/scheduler 的 DENY 理由（273 载体锁定/共享助手）与 §2.3 事实一致；T-1~T-3 的 ALLOW 行为既有文件加法式扩展且声明「既有断言/字段零改动」；生产 src、`domains/vfs3-assets/**`、CI 配置、冻结面 DENY 理由与 §2/§3 证据自洽；follow-up（品牌类型、指数记号、cloneValueSchema 其余叶子覆盖）均有归属，不掩盖本任务必要项 | §7/§10 本轮全文复核 | 无 |

## 12. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
| --- | --- | --- | --- |
| AC1 发射/编译 | 既有 10 用例 + T-1（program 级 typed-access）+ T-2（desync 负控） | 无 | 无 |
| T-1 断言形状 | consumer 0 诊断；`@ts-expect-error` 写 `'42'`/`true`；独立负例恰 1×TS2322（投影退化则 0 条 ⇒ 红） | 无——机制经 SA6 探针 B 实测 + `VfslTypedAccess.patch` 签名（`index.ts:118-122`）亲验可承载 | 无 |
| AC3 配对同构（T-3） | 7 组配对同 ok 性/同码/path 回显 + 码集合断言 | 无——命名零碰撞（F2 已落实）、敌意段 `INVALID` 分类经 `:100-104` 守卫静态核验正确 | 无 |
| AC3 readData 端到端（T-4） | 三键/预写值 50/条件键/range 叶/元素叶/docs/detached/配对失败 | **无（F1 已解决）**：装置路径可逐行照抄（本轮对源码逐项核验），`value===50` 断言可达 | 无 |
| 装置可实施性（iteration 1 新增行） | `git status` 下既有 readData 测试/fixture 零 diff；新文件单独成立 | 无——与 ALLOW/DENY 一致 | 无 |
| AC2/AC4 | 既有门禁 + T-\* 落地后重跑（`pnpm typecheck`、焦点 3+1 文件、全量 `vitest run --typecheck`） | 无——vitest include/CI 分片亲验自动发现 | 无 |
| 反伪绿 | TS2322 计数敏感性、`@ts-expect-error` 反噬、desync 负控、`--check` 陈旧 exit 1 | 无 | 无 |

## 13. Required revisions

| Finding ID | Severity | Evidence | Problem | Required change | Acceptance |
| --- | --- | --- | --- | --- | --- |
| ~~F1~~（iteration 0，MAJOR） | — | `readdata-schema-projection-fixture.ts:73-98`；设计 iteration 0 §2.3/§7 T-4/§10 三方互斥 | **已解决**（本表保留 ID 供修订映射）：iteration 1 采用方案 (b)——§7 T-4 自包含装置（步骤 1~6 可照抄，本轮逐项对源码核验：imports 真实、ENV 四键契合 envelopeStrictGate、播种先于 createDoc 与 fixture `:84-88` 同构、poll 参数同款 `:96`、逐例 close 有先例）、§10 ALLOW/DENY 一致、fixture/scheduler 只读、备选 6 显式记录方案 (a) 拒绝理由 | — | F1 验收三条件全部满足：装置路径可照抄且不触碰既有 readData 测试；DENY/ALLOW 与路径一致；`readData(['b'])` 可观察预写值 50 |
| — | — | — | 无 BLOCKER/MAJOR。生产零改动结论、四锚点、4 项覆盖缺口、门禁映射、非目标边界、F1~F5 修订均经本轮独立复核成立 | — | — |

## 14. Non-blocking observations

| ID | Observation | Suggested precision fix（实现时可采纳，不阻断） |
| --- | --- | --- |
| N1 | §7 T-4 失败面配对的括注「resolve 侧 `SCHEMA_PATH_NOT_FOUND` 经 `runtime.ts:485` 透传为 readData 失败联合」机制归因有误：`:485` 透传的是 doc-runtime **值读失败**的 `PATH_NOT_ALLOWED`（`packages/doc-runtime/src/read.ts:27/:46/:147`）；resolve 侧失败在成功分支内收敛 `schema:null`（`read-schema-projection.ts:57`），从不进入 readData 失败联合。断言集本身（ok:false、同码 `PATH_NOT_ALLOWED`、无 `schema` 键、path 回显）与源码一致、不受影响 | 括注改为「doc-runtime 值读终态短路（`runtime.ts:485` 透传 `readLogicalValueAtPath` 失败）；resolve 侧同路径分类为 `SCHEMA_PATH_NOT_FOUND` 但在 readData 组合面收敛 `schema:null`，不进失败联合——配对断言锚的是前者」 |
| N2 | §7 备选 6 (iii) 引语「T-\* 全部为加法、零修改既有文件」表述过强：T-1/T-2/T-3 按 §10 ALLOW 是对既有测试文件的加法式扩展（新用例/新 FIXTURE 字段），字面「零修改既有文件」仅对 T-4 成立。设计他处（§10 ALLOW、§11、§12「既有 readData 测试/fixture 零 diff」）的准确口径为「不改任何既有断言/字段/装置」 | 引语改为「T-4 零新增既有文件修改、T-1~T-3 为既有文件内纯加法（不改既有断言/字段）；方案 (a) 会把 #273 契约工件本身纳入修改面」 |
| N3 | 残余亚行级锚点精度：§2.3「类型面 JSDoc `:117-124`」实为 `:121-125`（「ok 成员恰三键」短语在 `:124`）；附录「`tsc-helper.ts:44-46`」的 paths 块实为 `:44-47` | 行号微调，不影响任何结论 |

---

## 评审结论

- **Verdict：`approve`**（无 BLOCKER/MAJOR；N1~N3 为措辞/锚点精度级非阻断观察）。
- **F1 已验证解决**：iteration 1 的 T-4 自包含装置经 SA2 对源码逐项独立核验（imports/导出、ENV 契约、播种时点、poll/close 纪律、断言所锚行为、META.docId 契约、`Record<string,…>` 语法先例）可照抄落地；ALLOW/DENY 与装置路径一致；#273 契约组零触碰。iteration 0 的 F2~F5 修订（命名、类型来源措辞、锚点细分）亦逐一复核属实。
- 设计的正确性内核（生产零改动、4 项覆盖缺口、门禁映射、非目标边界、ADR 0020 决策 7/8 对齐）本轮再次独立复核**全部成立**；HEAD、sha256 钉值、测试清单（10/7/5 用例；namespace-runtime readData 四件 + fixture；`Int<` 零命中）未漂移。
- `requiresConflictRecheck: false`：iteration 1 修订均为测试侧落地路径与措辞精度，不触碰任何 ADR 冻结面、接口、wire/schema 或持久化语义。
- 后续路由建议（Controller 决断）：设计可进入测试侧落地（SA3/SA4 路径）；N1/N2/N3 可由实现者顺手采纳，无须再走设计迭代。`approve` 不替代 SA4/SA7 对实现与活链路的验证。
