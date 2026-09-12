# SA1 架构与实现设计评估 — issue #316：codegen 与 readData 投影适配 int/range 叶子（ADR 0020 决策 7/8）

- Dispatch：`sa-6eb368a3-6e71-492e-b8a5-5514ef19fbe6`（mabf-sa1 / design / iteration 1）
- 基线 worktree：`/home/wangjian/nomicore-fix-issue-316`，分支 `mabf/issue-316`，HEAD `bd9fb93dd69d6b27f10113cd98d8dfca9184ce8c`（`feat(vfsl): add Int and Range number constraints (#351)`）——iteration 1 复核未漂移
- 上游输入：Host 简报 `wiki/raw/task_issue-316.md`（Issue #316 body：What to build + AC1~AC4 + Blocked by #315，§Comments 空）；SA6 验收契约 `wiki/raw/task_issue-316_sa6_contract.md`（iteration 0，verdict approve）；SA2 设计攻击评审 `wiki/raw/task_issue-316_sa2_review.md`（iteration 0，verdict reject，1 MAJOR F1 + 非阻断 F2~F5）
- **iteration 1 修订范围**：按 SA2 评审逐条落实 F1（必改：T-4 readData 测试装置的范围自洽性）与 F2~F5（建议采纳的命名/措辞/锚点精度），映射见 §14。**SA2 经独立只读复核确认成立的设计内核全部原样保留**：生产零改动结论、四个实现锚点、4 项覆盖缺口为真、门禁映射、非目标边界。本迭代未收到任何新的 owner 评论（REST snapshot 仍为空），无新增需求来源。
- **设计结论（先行，与 iteration 0 一致且经 SA2 独立复核确认）**：#316 的全部 4 条 AC 在 HEAD **已由 #315 的集成 PR #351 整体满足**；**生产实现零改动是本设计的硬性结论**——任何对 `valuetype.ts`/`emitter.ts`/`resolve-schema-at-path.ts`/`read-schema-projection.ts` 的再改动只会制造 `generate --check` 字节漂移或行为回归。本票剩余的唯一可交付价值 = 把 SA6 契约的 4 项覆盖缺口（C3b/C3c/C1c/C1e，可选 C1d）固化为回归哨兵测试；iteration 1 把其中 T-4 的测试装置从「不可执行的矛盾声明」修订为**可照抄落地的自包含装置**（§7 T-4），并使 ALLOW/DENY 与之一致（§10）。

---

## 1. 任务类型、目标与非目标

**任务类型**：Feature 的验收/回归收尾。票面是 Feature（codegen 与投影适配新叶子），但能力在基线提交已交付，故本设计的实际任务 = （i）架构评估「既有实现是否满足验收契约」（答案：满足，附证据）；（ii）若不满足给出精确改动（答案：生产代码无改动；仅测试覆盖缺口需要补齐）。

**目标**：

1. 对照 Issue #316 的 AC1~AC4 与 ADR 0020 决策 7/8，逐条判定 HEAD 既有实现是否已满足，并给出文件/符号级证据锚点（本设计 §2/§3）。
2. 给出「若要落地 SA6 契约的覆盖缺口」所需的精确改动设计：文件路径、装置构造路径、断言形状、突变敏感性依据（本设计 §7/§12），供测试侧直接实现——**每条 T-* 的装置必须可被实现者照抄执行且不与文件范围声明互斥**（iteration 1 对 T-4 的修订目标）。
3. 明确禁止事项：不得因误判「还需改生产代码」而打破字节稳定基线（§13 风险 R1）。

**非目标**：

- 品牌类型 codegen（ADR 0020 决策 7 明确不做，Considered Options 8 留独立 ADR）。
- `Int`/`Range` 文本/parser/IR/derived/validate 本体（#315 范围，已交付；#316 只消费其产物）。
- `domains/vfs3-assets/**` 任何改写（域文本无 Int/Range，生成物 sha256 钉值 `342d8c1f…e6707` 逐字节保持）。
- 修改错误码集合、指纹前缀、`ISSUE_LIMIT`、docs 切片文法（冻结面）。
- 本 SA 不实现、不编写、不运行测试（dispatch 明文；SA6 已在 HEAD 完成全部探针实测）。

## 2. 当前行为与证据锚点（SA1 独立复核；iteration 1 修正 F4/F5 锚点精度）

SA1 不复现 SA6 探针，只对源码/测试/门禁做只读复核。以下锚点均在本 worktree HEAD `bd9fb93` 逐一确认（SA2 评审已双向亲验）：

### 2.1 codegen 发射面（AC1）

| 事实 | 锚点（本设计亲验） |
| --- | --- |
| `projectValue` 对 `int`/`range` 叶发射 `'number'`，注释明引 ADR 0020 决策 7，判定语义留在 validate（生成器不重推导） | `packages/vfsl-codegen/src/valuetype.ts:35-39`（`case 'int': case 'range': return 'number'`） |
| `leaf` 结构位白名单显式放行 `scalar/enum/pattern/int/range/union`，其余 value kind → `desync` 响亮拒绝（无 catch-all 放行） | `packages/vfsl-codegen/src/emitter.ts:335` 起 `case 'leaf'` 分支（注释明引「★ 非 switch 位点（typecheck 不强制，手改；ADR 0020 决策 7）」；白名单条件块 `:339-348`） |
| `pattern` 叶保持 `'string'`（对照面，未被 number 泛化） | `packages/vfsl-codegen/src/valuetype.ts:33-34` |
| 既有测试锚定发射文本 + 真实编译器 0 诊断：fixture 覆盖裸 `Int`/带参 `Int<1,100>`/小数 `Range<0.5,1.5>`/负端点 `Range<-40,85>`/数组 `Int<0,9>[]`/单点区间，`it.each` 断言 `PathSchema<number, 'leaf'>`，数组元素位断言 `PathSchema<Record<\`${number}\`, PathSchema<number, 'leaf'>>, 'array'>`；生成文本写临时 `.ts` 后 `preEmitDiagnostics` 空 | `packages/vfsl-codegen/test/generate-int-range.test.ts`（10 用例：1 前置判别 + 6 each 发射 + 1 数组位 + 1 无 desync + 1 编译；helper `./tsc-helper.js`） |

### 2.2 resolve-schema-at-path 投影面（AC3 前半）

| 事实 | 锚点 |
| --- | --- |
| 值树逐段游走的 `default` 分支把 `int`/`range` 与 `enum/pattern/scalar/xml` 同列为**值级终态**（无匹配、不再下钻）——kind-agnostic，`#351` 对该文件仅补注释 | `packages/vfsl/src/resolve-schema-at-path.ts:289-291`（`default: return; // enum/pattern/scalar/int/range/xml：值级终态…`）；别名闭包访客同款 `default` 终态（`:413-414` 一带） |
| 失败码恰两枚冻结码：内容级 `SCHEMA_PATH_NOT_FOUND`、敌意段 `SCHEMA_PATH_INVALID`（非数组 path / 野段形状）；段被结构树拒绝时按 `classifyStructureReject` 二分 | `packages/vfsl/src/resolve-schema-at-path.ts:98`、`:102`、`:141`、`:161`、`:362-372`（`classifyStructureReject` 函数体；其前置 doc 注释自 `:355` 起——iteration 1 按 F5 修正行号口径为函数体 `:362-372`） |
| 既有测试锚定透传与两枚失败码：`['a']→{kind:'int'}` 且 `Object.keys===['kind']`（裸 Int 条件键）、`['b']`/`['c']`/`['d']` 深等、`['e']`/`['e',0]`、`['b','x']`/`['e',0,'x']` → `SCHEMA_PATH_NOT_FOUND`；**既有 FIXTURE 为文件内局部 const，已占用字段名 `p`（`number & Int<1, 1>`）与 `q`（`number & Range<0, 0>`）** | `packages/vfsl/test/resolve-schema-at-path-int-range.test.ts`（7 用例；FIXTURE `:16-25`，`p`/`q` 在 `:22-23`） |

### 2.3 readData 组合面（AC3 后半；iteration 1 按 F1/F4 改写装置事实与锚点）

| 事实 | 锚点 |
| --- | --- |
| `cloneValueSchema` 显式处理 `int`（`min`/`max` 条件键逐键携带，裸形不补 `undefined` 槽，`:172-178`）与 `range`（两键必在场，`:179-183`）；detached 纪律经既有 memo 机制继承 | `packages/namespace-runtime/src/read-schema-projection.ts:170-183` |
| readData 成功分支**恰三键** `{ ok:true, value, schema }`（`schema` 四件套由 `read-schema-projection.ts` 产出）；失败短路时 `PATH_NOT_ALLOWED` 原样透传且失败对象无 `schema` 键 | `packages/namespace-runtime/src/runtime.ts:474-486`（`readData` 实现：`:478` 三键 JSDoc、`:485` 透传）；类型面 JSDoc `:117-124`（「ok 成员恰三键」）。**锚点修正（F4）**：`read-schema-projection.ts:102-114` 是 `detachReadSchemaProjection` 的四件套深拷贝（D5），非三键分支本身 |
| **既有 readData 测试装置的真实形态（F1 事实基础）**：共享 fixture `readdata-schema-projection-fixture.ts` 的 `makeHandle(opts)` 只收 `text`/`seedSchema` 两项，且 `:87` **无条件**调用硬编码 `seedRoot`（只播种 273 载体键 count/title/meta/tags/skus/rogue）；`makeReadyRuntime()`（`:93-98`）**无参数**、固定 `TXT_273`。因此该 fixture **只能承载 #273 载体数据，不能承载 Int/Range 字段的预写值**；可复用的是其**构造配方**（memory persistence + Y.Doc 三载体播种 + seam + 有界 poll）与包级共享助手 `real-persistence-scheduler.ts`，而非 fixture 工件本身 | `packages/namespace-runtime/test/readdata-schema-projection-fixture.ts:73-98`（`makeHandle` opts 面 `:73-76`、硬编码 `seedRoot` 调用 `:87`、无参 `makeReadyRuntime` `:93-98`）；`text` 透传先例：`runtime-readdata-schema-projection-red.test.ts:207`（`makeHandle({ text: 'type ROOT = {' })`）；`real-persistence-scheduler.ts` 为非 vitest 收集的共享助手（scheduler 自 issue #107 起为必填注入） |
| **覆盖缺口确认**：`packages/namespace-runtime/test/**` 全目录 grep `Int<` 零命中——`cloneValueSchema` 的 int/range 分支（`#351` 新增 14 行）无任何测试 | SA1 本设计 grep 复核（SA2 评审独立复核同认）；既有 readData 测试仅 `runtime-readdata-schema-projection-{control,red}.test.ts`、`runtime-readdata-hostile-path-guard.test.ts`、`runtime-readdata-schema-red.test-d.ts` 四件（前两 .test.ts + fixture 构成 #273 契约组） |

### 2.4 字节稳定与门禁（AC2/AC4）

| 事实 | 锚点 |
| --- | --- |
| `pnpm generate --check` 挂在 CI `codegen-freshness` job | `.github/workflows/ci.yml:128`（job）、`:147`（`pnpm generate --check`） |
| 域生成物字节钉值与 SA6 契约一致 | SA1 实测 `sha256sum domains/vfs3-assets/generated.ts` = `342d8c1fe0814409f682852c13748260b9d6cbda125afe0e815a8de3298e6707`（= SA6 §4 钉值；SA2 独立实测一致） |
| 指纹漂移哨兵已存在（envelope/semantic 双 sha256:v1: 钉值在测试内） | `packages/vfsl/test/int-range-fixture-drift.test.ts`（5 用例） |
| 测试/typecheck 入口真实：CI typecheck job `pnpm typecheck` + `vitest run --typecheck.only`；test job 6 分片 `vitest run`（`--passWithNoTests=false`）；根 vitest include `packages/*/test/**/*.test.ts`（typecheck include `*.test-d.ts`）——**新测试文件零配置自动落入** | `.github/workflows/ci.yml:20/39/44/50/80`；根 `package.json` `generate` 脚本（`tsx packages/vfsl-codegen/src/cli.ts`）；根 `vitest.config.ts:15/20` |
| spec 已随 #315 落地（决策 10：spec 与实现同 PR） | `docs/vfsl/v1-spec.md` 含 Int/Range 条款（31 处提及） |

**入口与调用链（现状，无变化）**：

- codegen：`schema.vfsl` 文本 → `parseVfsl` → `evaluate`（derived 两树）→ `generateProjection`（emitter 消费 evaluator 输出，纯发射器）→ `generated.ts`；CLI `packages/vfsl-codegen/src/cli.ts`（`--check` 新鲜度闸门：陈旧 exit 1 且不写盘）。
- 投影：`resolveSchemaAtPath(derived, path)` 同步纯函数 → 判别联合 `{ok:true,valueSchema}` / `{ok:false,code,path}`。
- readData：memory/persistence + Y.Doc → runtime ready → `readData(path)` = `readLogicalValueAtPath`（值）+ `resolveSchemaAtPath` + `cloneValueSchema`（detached 深拷贝）→ 三键成功形状 / `PATH_NOT_ALLOWED`、`RUNTIME_READ_DISABLED` 等失败形状。

## 3. 根因 / 能力缺口评估

| 项 | 判定 | 依据 |
| --- | --- | --- |
| 生产能力缺口 | **无**。AC1（codegen 发射 `number` + 可编译）、AC3（投影同构 + 不新增拒绝路径/失败码）、AC2/AC4（门禁绿）全部在 HEAD 成立 | §2.1~2.4 源码锚点 + 既有测试（10+7+5 用例）+ SA6 §5 P1~P8 探针实测 + §4 溯源：`git show --stat bd9fb93` 中 #316 直接相关的 4 文件改动全部落在 #351 内（resolve-schema-at-path.ts 的 4 行为注释级）；**SA2 评审独立复核全部成立** |
| 票面与基线错位 | #316 是 #315（Blocked by）的后续票，但其实现范围已被 #315 集成 PR #351 吸收；基线 worktree 起点即在 #351 之后，不存在可诚实建立的红灯 | SA6 §8/§13；SA1 复核 HEAD log：`bd9fb93` 即 #351（SA2 `git log -1` 亲验） |
| 剩余缺口（唯一可交付项） | **验收覆盖缺口 4 项**：(a) 与 pattern 叶的比较型同构断言 + 失败码集合断言；(b) readData 端到端（`cloneValueSchema` int/range 分支零测试覆盖）；(c) typed-access 编译级投影（`PathAt`/`PathValue`/`PathPatchValue` 对 int/range 字段成立且 fail-closed）；(d) codegen 过宽放行负控（leaf 结构 + 未知 value kind → desync） | SA6 §12.6；SA1 grep 复核确认 (b) 缺口为真（SA2 独立 grep 同认零命中） |
| 语义依据 | ADR 0020 决策 7（TS 层 int/range 一律 `number`、品牌类型不做、生成物形状不胀）+ 决策 8（投影按标量叶下钻、终态/下钻与 pattern 同构、不新增拒绝路径与失败码） | `docs/adr/0020-vfsl-number-constraints.md` §决策 7/8（SA2 亲验 `:148-160`）；旁证决策 5（IR/derived 叶子、既有指纹不变） |

## 4. Owner 要求落实

Issue comments REST snapshot 为空（dispatch 明文，iteration 1 仍未变），简报 §Comments 亦为空 ⇒ **无超出 Issue body 的 owner 追加要求**，无适用评论映射表可填。需求全集 = Issue body 4 条 AC + ADR 0020 决策 7/8：

| Comment ID | Updated at | Requirement | Design section |
| --- | --- | --- | --- |
| （无评论） | — | — | — |

| Issue AC | 设计判定 | 设计落点 |
| --- | --- | --- |
| AC1 含 Int/Range 字段的 schema 生成 TS 为 `number`，生成物可编译 | **已满足**（§2.1） | §7 D-1（保持，零改动）；覆盖补强 C1c/C1e → §7 T-1/T-2 |
| AC2 `pnpm generate --check` 既有生成物零漂移 | **已满足**（§2.4，sha256 钉值一致） | §7 D-2（保持）；C2 门禁 → §12 |
| AC3 投影路径落在 int/range 叶子上与 pattern 叶子同构（终态/拒绝分类一致） | **已满足**（§2.2/§2.3） | §7 D-3/D-4（保持）；比较型同构 C3b/C3c → §7 T-3/T-4 |
| AC4 包测试、typecheck 全绿 | **已满足**（SA6 实测全量 353 文件/3863 用例 + typecheck 0） | §12 门禁映射 |

## 5. 复现和根因承接

| 上游事实（SA6 契约） | 证据位置 | 设计响应 |
| --- | --- | --- |
| 基线 HEAD `bd9fb93` = #351；#316 相关 4 文件改动全在其中；resolve 文件仅注释级改动 | SA6 §4 + `git show --stat bd9fb93` | §3 采纳：生产零改动是硬性结论；ALLOW/DENY 以此划界（§10） |
| 8 条目标行为（P1~P8）HEAD 全绿：发射 number、可编译、pattern 对照 string、终态透传、7 组配对同构、readData 三键 + detached、`generate --check` 0、CLI 端到端 | SA6 §5（探针 A/B/C/D，已清理） | §2 以源码锚点独立复核采纳；测试设计（§7 T-*）以这些观察为预期断言。**P6（readData 组合面，探针 C）本身即以自建 runtime + FIXTURE_PAIRED 形态实测**（值 50、docs `{'ROOT.b':[…]}`、配对 `PATH_NOT_ALLOWED`），是 §7 T-4 自包含装置可行性的直接上游证据 |
| 覆盖缺口 4 项（比较型同构 / readData 端到端 / typed-access 编译级 / 过宽放行负控） | SA6 §12.6 | §7 T-1~T-4 逐一转化为可执行测试设计；SA1 复核确认 (b) 缺口（namespace-runtime 测试零 `Int<` 命中） |
| SA6 §12.6 (b) 建议落点原文为「新增 `runtime-readdata-int-range.test.ts`，**沿 `readdata-schema-projection-fixture.ts` 装置**」 | SA6 §12.6；fixture 真实形态见本设计 §2.3 | **采纳其落点文件与装置配方，修订「沿 fixture」的字面表述**：该 fixture 的 `makeHandle`/`makeReadyRuntime` 被 273 载体数据锁定（§2.3），不能承载 Int/Range 预写值；T-4 改为**同配方的新文件内自包含装置**（§7 T-4，SA2 F1 裁定的方案 (b)）。这是对 SA6 建议测试路径的落地精度修订，**不与其任何事实性结论冲突**（缺口 (b) 为真、C3c 断言集原样保留） |
| 突变敏感性矩阵：回退 `number`→`string`、删白名单、catch-all 放行、新增拒绝码、补 `min: undefined` 槽、不 detached、字节漂移、`--check` 恒 0 均有对应变红契约项 | SA6 §12.7 | §12 验收映射直接对齐；T-* 的断言形状按「杀死对应弱实现」设计 |
| U1：票面语义与基线错位，建议关闭为已交付或转覆盖补票 | SA6 §15 | §13 残余问题 R4 转录（Host 处置项，非本设计可决） |
| 反伪绿证据链（TS2322 敏感性反证、desync 负控、陈旧 `--check` exit 1） | SA6 §9/§11 H7 | §12 断言纪律采纳（断言只观察公共接缝输出、前置判别、不冻结文案） |

未发现上游事实与源码矛盾：SA6 引用的全部行号/符号/钉值经 SA1 复核一致（含 sha256 逐字节一致；SA2 评审独立双向亲验同认）。

## 6. SA8 约束落实

`wiki/raw/task_issue-316_relevant_decisions.md` 与 `task_issue-316_conflict_report.md` 不存在（SA6 §1 同认，SA2 §1 复核同认）。按技能规则以权威 ADR + 模块 AGENTS.md + CI 替代，并逐条判定是否需要设计后冲突复查：

| 决议或义务 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
| --- | --- | --- | --- |
| ADR 0020 决策 7：codegen 对 int/range 发射 `number` 原样，品牌类型不做，生成物形状不胀 | §2.1（`valuetype.ts:35-39` 已实现）、§7 D-1 | 确认既有实现符合；零改动 | 否（确认对齐，非修订） |
| ADR 0020 决策 8：投影按标量叶处理、终态/下钻与 pattern 同构、不新增拒绝路径与失败码 | §2.2/§2.3（`resolve-schema-at-path.ts:289-291`、`read-schema-projection.ts:170-183`）、§7 D-3/D-4 | 确认既有实现符合；零改动 | 否（同上） |
| ADR 0020 决策 5：无 Int/Range 的 schema IR/指纹逐字节不变 | §2.4（drift 哨兵 + sha256 钉值）、§10 DENY | 域基线不动；测试禁改 `domains/vfs3-assets/**` | 否 |
| ADR 0005（codegen 确定性/字节稳定；`packages/vfsl-codegen/AGENTS.md`：消费 evaluator 输出、不重推导；不支持形状响亮失败） | §7 D-1/D-2、T-2 | 既有 emitter 白名单 + desync 保持；T-2 负控锚定 | 否 |
| ADR 0016（readData 三键成功形状、always-on、每次读 detached 深拷贝、两枚失败码冻结；`packages/vfsl/AGENTS.md` 例外条款） | §2.3、§7 T-4 | T-4 按同款纪律断言（不改变 API） | 否 |
| ADR 0019（docs 切片，成员 doc 行内前置） | §7 T-4（docs 断言只查键存在与切片内容） | 测试只观察既有行为 | 否 |
| ADR 0021 决策 3 先例（消息文案不进冻结面） | §12 断言纪律 | 测试只钉码/路径/键集/计数 | 否 |
| 根 `AGENTS.md`（Typed Namespace writes：`PathAt`/`PathPatchValue` fail-closed） | §7 T-1 | C1c 恰是对该义务的编译级哨兵（对 int/range 字段的既有验证，非新增写路径） | 否 |
| `packages/namespace-runtime/AGENTS.md`（读在 sequencer 外；公共面只暴露 detached 投影；生产构造器与测试 seam 保持内部） | §7 T-4 | T-4 只经 `readData`/`getStatus` 公共面观察；runtime 构造走既有测试同款 `../src/runtime.js` seam import，不触碰 sequencer/活 Y.Doc 写路径 | 否 |
| CI（typecheck / `--typecheck.only` / 6 分片 / codegen-freshness） | §12 门禁 | 新测试文件自动落入既有 include，零配置改动 | 否 |

## 7. 设计决策与主要备选方案

### D 系列：生产实现判定（全部「保持现状」）

- **D-1**：`projectValue` 的 `int`/`range → 'number'` 与 `emitter` leaf 白名单**原样保持**。理由：AC1 已满足；改动即字节漂移（AC2 红）或行为回归。备选「重新实现/微调发射」被拒绝——无需求来源，且 SA6 §8 放大因素明示此路径的回归风险。
- **D-2**：`generate --check`、域生成物、双指纹基线**零触碰**。理由：AC2 语义是「既有生成物零漂移」，任何生产 diff 都与本 AC 相斥。
- **D-3**：`resolveSchemaAtPath` 的 kind-agnostic `default` 终态**保持**，不为 int/range 增写显式 case。理由：决策 8 要求「不新增拒绝路径」；显式 case 不改变行为但引入「int/range 是特判」的误导，且 `classifyStructureReject` 复用已保证与 pattern 同构分类。
- **D-4**：`cloneValueSchema` 的 int（条件键）/range case **保持**。理由：C3c 缺口是「无测试」而非「实现缺失」；裸 Int 补 `undefined` 槽恰是被突变矩阵杀死的弱实现形态。

### T 系列：覆盖缺口补齐的精确测试设计（本票唯一推荐改动；SA1 只设计不编写）

通用断言纪律（承接 SA6 §12.0）：只观察公共接缝运行时输出（`parseVfsl`/`evaluate` 前置判别、`generateProjection` 发射文本、真实 TS 编译器诊断、`resolveSchemaAtPath`、`NamespaceRuntime.readData`）；正例先证明 fixture 走到目标叶子；不 skip/软化/吞错；不冻结文案（只钉码/路径/键集/计数与生成文本中的 TS 类型段）；不改 `domains/vfs3-assets/**`、指纹前缀、错误码集合。

**T-1（=C1c，缺口 c）typed-access 编译级投影** — 扩展 `packages/vfsl-codegen/test/generate-int-range.test.ts`（主落点）：

- 装置：沿用既有 `compileInTempDir`/`preEmitDiagnostics` helper（`tsc-helper.ts` 的孤立 program `paths` 已把 `@nomicore/vfsl-protocol`/`@nomicore/vfsl` 指到仓内源码），把「生成文本 + consumer 文本」写入同一临时目录、同一 program 编译。consumer 的类型来源（F3 修正措辞）：`PathAt`/`PathValue`/`PathPatchValue`/`VfslTypedAccess` 一律 **import 自 `@nomicore/vfsl-protocol`**（`packages/vfsl-protocol/src/index.ts:59/72/81/118-120`）；生成文本的作用只是对本 program 做 `VfslPathMap` 增广（生成物形态见 `domains/vfs3-assets/generated.ts:24-27` 同款）。即 `PathAt<M,['b']>` 中的 `M` := **该 program 中被生成文本增广后的 `VfslPathMap`**。
- consumer 断言内容（沿 `generate-number-literals.test-d.ts:15,30` 先例的访问面形态）：`const ok: PathValue<PathAt<VfslPathMap,['b']>> = 42` 通过、`access.patch(['b'], 42)` 通过（`declare const access: VfslTypedAccess<…>` 形态或运行时等价构造）；`access.patch(['b'], '42')` 与 `access.patch(['b'], true)` 各以 `@ts-expect-error` 锁定（若通过则 `@ts-expect-error` 反噬报「未使用」诊断 → 红）。
- 敏感性反证（非空转证明）：独立负例文件 `const bad: PathValue<PathAt<VfslPathMap,['b']>> = '42'` 必须恰产生 **1 条 TS2322**——若投影退化 `any`/`string` 则 0 条 ⇒ 本项红。此断言把「投影确为 `number`」从运行时文本断言升级到类型系统事实（SA6 探针 B 实测 1×TS2322）。
- 可选镜像形态：`packages/vfsl-codegen/test/generate-int-range.test-d.ts`（沿 `generate-number-literals.test-d.ts` 的 `declare module '@nomicore/vfsl-protocol' { interface VfslPathMap { … } }` + `declare const access` 先例，注释说明镜像来源；由 CI `--typecheck.only` 自动纳入）。二者择一即可，都做则互为冗余哨兵。

**T-2（=C1e，缺口 d）codegen 过宽放行负控** — 扩展 `generate-int-range.test.ts`：

- 装置：JSON 克隆既有 `DERIVED`（同文件模块级 const），把 ROOT 某 int 字段的值侧改为 `{kind:'xml'}`（结构侧仍 leaf），调 `generateProjection`。
- 断言：抛错且消息含稳定片段 `structure/value desync`（不钉全文；片段亲验于 `emitter.ts:533` 消息模板）。杀死「白名单放成 catch-all」的弱实现；同时锁定 `emitter.ts:335` 白名单是显式集合。

**T-3（=C3b，缺口 a）比较型同构 + 失败码集合** — 扩展 `packages/vfsl/test/resolve-schema-at-path-int-range.test.ts`：

- fixture 增补（F2 修正命名冲突：既有 FIXTURE 已占用 `p`/`q`，pattern 配对面改用无碰撞名；**既有 7 条断言与其目标字段 `a`~`e`/`p`/`q` 原样保留，零改动**）。在既有 FIXTURE 文本内追加字段（沿 SA6 §12.1 FIXTURE_PAIRED 的配对语义）：
  - int/range 容器侧（补齐配对所需的容器形态）：`u: number & Int<1, 3> | string;`、`r: Record<string, number & Int<0, 9>>;`
  - pattern 配对侧：`pp: string & Pattern<"^a+$">;`、`ppe: string & Pattern<"^a+$">[];`、`ppr: Record<string, string & Pattern<"^a+$">>;`、`ppu: string & Pattern<"^a+$"> | number;`
- 断言（逐组配对，共 7 组）：`['b','x']↔['pp','x']`、`['b',0]↔['pp',0]`、`['e',0,'x']↔['ppe',0,'x']`、`['e',1,0]↔['ppe',1,0]`、`['u','x']↔['ppu','x']`、`['r','k','x']↔['ppr','k','x']` 均 `ok:false` 且同码 `SCHEMA_PATH_NOT_FOUND`、`path` 为调用方入参新鲜回显；`['b',{}]↔['pp',{}]` 同码 `SCHEMA_PATH_INVALID`。全文件（含既有用例）失败码集合断言 ⊆ {两枚冻结码}。
- 价值：AC3 的字面表述是「同构」，只有配对断言能证明同构（单侧断言证明不了）；同时杀死「为 int/range 新增第三失败码或特判分支」的回退。

**T-4（=C3c，缺口 b）readData 端到端** — 新增 `packages/namespace-runtime/test/runtime-readdata-int-range.test.ts`，**文件内自包含装置**（iteration 1 按 F1 全量重写；SA2 裁定两方案中取 (b)，(a) 见备选 6）：

**装置构造路径（实现者可逐行照抄；不修改任何既有文件）**：

1. imports：`import * as Y from 'yjs'`；`import { expect } from 'vitest'`；`import { createMemoryPersistence } from '@nomicore/persistence'` + `import type { DocHandle, User } from '@nomicore/persistence'`；`import { realPersistenceScheduler } from './real-persistence-scheduler.js'`（**只读复用**包级共享助手——非 vitest 收集对象；scheduler 自 issue #107 起为必填注入，不得省略）；`import { createNamespaceRuntimeWithSeam } from '../src/runtime.js'`（测试 seam，与既有 readData 测试同款 import；生产构造器不入公共面）+ `import type { NamespaceRuntime } from '../src/index.js'`。
2. 文件内私有 schema 文本 `TXT_316`（沿 SA6 §12.1 FIXTURE_PAIRED 形态 + `b` 带 ADR 0019 行内前置 doc 供 docs 切片断言）：

   ```
   type ROOT = YMap<{
     /** 库存计数 */
     b: number & Int<1, 100>;
     bare: number & Int;
     c: number & Range<0.5, 1.5>;
     e: number & Int<0, 9>[];
     r: Record<string, number & Int<0, 9>>;
     u: number & Int<1, 3> | string;
     p: string & Pattern<"^a+$">;
   }>;
   ```

3. 文件内私有常量与播种函数（镜像 #273 fixture 配方，载体值换为 Int/Range 目标值）：`ENV_316 = { lang: 'vfsl', version: 1, id: 'ns-316', text: TXT_316 }`；`OWNER_316: User = { userId: 'u-316' }`；`seedRoot316(root: Y.Map<unknown>)`：`b=50`、`bare=7`、`c=1`、`e = new Y.Array<number>()` push `[4,7]`、`r = new Y.Map<number>()` set `'k'→5`、`u=2`、`p='aaa'`。
4. 文件内私有 handle 构造 `makeHandle316()`（镜像 `readdata-schema-projection-fixture.ts:73-90` 配方）：`createMemoryPersistence({ scheduler: realPersistenceScheduler })` → `new Y.Doc()` → SCHEMA map 逐键写入 `ENV_316` 各项 → META map 写 `docId:'ns-316'`（**必须与 `createDoc` 的 docId 一致**——persistence 对 `META.docId` 违约即拒，见 `packages/persistence/src/testing.ts` createDoc 契约）与 `createdAt` → `seedRoot316(doc.getMap('ROOT'))` → `await persistence.createDoc(OWNER_316, 'ns-316', doc)`。
5. 文件内私有 ready 构造 `makeReadyRuntime316()`（镜像 fixture `:93-98`）：`createNamespaceRuntimeWithSeam({ handle })` → `await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready')`（有界等待，超时即测试失败——fail loud，不静默跳过）。SA6 探针 C 实测即时 ready（§7 时序面）。
6. 生命周期收尾：每个 `it` 自建 runtime 并以 `await runtime.close()` 结束（与既有 #273 readData 测试逐例收尾同款）。

**断言清单**（全部为公共接缝 `readData`/`getStatus` 上的观察）：

- `readData(['b'])`：`Object.keys(r).sort()` 恰 `['ok','schema','value']`、`r.value === 50`（**预写值可观察——F1 验收锚**）、`r.schema.valueSchema` 深等 `{kind:'int',min:1,max:100}`。
- `readData(['bare'])`：`r.value === 7`；`Object.keys(r.schema.valueSchema)` 恰 `['kind']`（条件键哨兵，杀死补 `min/max: undefined` 槽的弱实现）。
- `readData(['c'])`：`r.value === 1`；`r.schema.valueSchema` 深等 `{kind:'range',min:0.5,max:1.5}`（覆盖 `cloneValueSchema` 的 range 分支）。
- `readData(['e',1])`：`r.value === 7`；`r.schema.valueSchema` 深等 `{kind:'int',min:0,max:9}`（数组元素叶）。
- docs 切片：`readData(['b'])` 的 `r.schema.docs` 含键 `'ROOT.b'` 且切片内容非空（内容不冻结全文；SA6 P6 实测 `{'ROOT.b':[' 库存计数 ']}` 形态）。
- detached（ADR 0016）：两次 `readData(['b'])` 的 `schema`/`valueSchema` 引用不同且 `Object.isFrozen(...) === false`；对首次返回投影做改写（valueSchema 附加污染键 / docs 条目替换）后重读，逐字等于 pristine 且非同一对象。
- 失败面配对：`readData(['b','x'])` 与 `readData(['p','x'])` 均 `ok:false` 且**同码 `PATH_NOT_ALLOWED`**、失败对象无 `schema` 键、`path` 回显入参（resolve 侧 `SCHEMA_PATH_NOT_FOUND` 经 `runtime.ts:485` 透传为 readData 失败联合；SA6 P6 实测配对同码）。

**价值与平行装置声明**（SA2 §10 平行机制检查要求的显式说明）：`cloneValueSchema` int/range 分支（`#351` +14 行）从零覆盖变为有哨兵；同时锚定 ADR 0016 detached 纪律在新叶子上成立。本文件存在 ~20 行与 #273 fixture 同配制的私有构造（TXT/seed/handle/ready 四件），**为何不扩展现有 fixture 见备选 6**；被真实复用的共享件只有 `real-persistence-scheduler.ts`（只读 import），无第二套调度器/持久化实现。

**T-5（可选，=C1d）CLI 领域端到端**：临时领域（表头 + ROOT 含三形态）`pnpm generate --domains <tmp>` exit 0、生成文本含 `number` 叶、编译 0 诊断；新鲜 `--check` exit 0、追加陈旧标记后 exit 1。价值：把 AC1/AC2 锚到真实产品入口；SA6 已实测可行。若 Host 只要求最小集可缓做（既有 `generate-cli-check.test.ts` 已覆盖新鲜度语义本体）。

### 备选方案与拒绝理由

1. **「按票面继续改生产实现」**（拒绝）：§3 已证能力缺口为零；改动只会破坏 AC2 字节基线或引入回归（SA6 §8 放大因素）。
2. **「为 int/range 增显式 resolve case / 新失败码」**（拒绝）：直接违反决策 8「不新增拒绝路径与失败码」与 ADR 0016 冻结面。
3. **「品牌类型 codegen」**（拒绝）：决策 7 明确不做；改变全部生成物形状（Considered Options 8）。
4. **「只交付设计、不补测试」**（部分采纳为下限）：AC1~AC4 在 HEAD 已绿，纯评估也能关票；但 4 项覆盖缺口是真实脆弱面（尤以 (b) 零覆盖），SA6 契约与 Host「覆盖补票」处置均指向补齐，故 T-1~T-4 为推荐项、T-5 可选。
5. **「新增 `.test-d.ts` 而非 program 级编译断言」**（择一）：两者都能锚编译级投影；program 级（T-1 主落点）直接编译真实生成物、免镜像漂移，`declare module` 镜像则需要注释声明镜像来源。主落点选 program 级，`.test-d.ts` 为可选冗余。
6. **「向后兼容扩展共享 fixture（F1 方案 (a)）」**（拒绝，iteration 1 显式记录）：即给 `readdata-schema-projection-fixture.ts` 的 `makeHandle`/`makeReadyRuntime` 增可选 `seed?: (root: Y.Map<unknown>) => void`（默认现 `seedRoot`）与 opts 透传，既有调用方签名不变。技术上可行，但被拒因：(i) 该 fixture 是 **#273 的契约工件**——其 `TXT_273`/`seedRoot` 载体形状（rogue/skus.ZZ1 等覆盖位）本身是 #273 red/control 两套件的断言素材与文档化意图（fixture 头注），为 #316 扩其签名会把两个 issue 的证据基线耦合进同一工件；(ii) 仓内先例相反——vfsl 侧 #351 的 int/range 测试（`resolve-schema-at-path-int-range.test.ts:16-25`）选择**新文件内局部 FIXTURE**而非扩展 #272 共享 fixture `resolve-schema-at-path-fixture.ts`，readData 侧沿用同构决策；(iii) 本设计的硬保证「T-* 全部为加法、零修改既有文件」在方案 (a) 下不再字面成立，装置缺陷的爆炸半径从新文件扩大到既有 readData 契约组；(iv) SA2 F1 验收要求「不触碰既有 readData 测试」，方案 (b) 以最强形式满足。方案 (b) 的代价（~20 行同配制私有构造）已通过显式平行装置声明（T-4）与只读复用 `real-persistence-scheduler.ts` 最小化。

## 8. 接口、状态机和数据流

**接口变化：无。** 本设计零生产改动；T-* 只新增/扩展测试文件，不触碰任何公共 API（`generateProjection`、`resolveSchemaAtPath`、`NamespaceRuntimeReadDataResult`、CLI 参数面全部不变）。

**状态机变化：无。** `generate --check` 新鲜度语义（新鲜 0 / 陈旧 1 不写盘）、runtime `schema.state`（detached → ready）状态机不变。T-4 装置等待 ready 的有界轮询与既有 fixture 纪律同款（S-1 攻击面经 SA2 复核无缺口）。

**数据流路线（现状确认，无运行时数据变化）**：

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A 生成链 | `schema.vfsl` 文本（CLI 或测试 fixture） | `generated.ts`（仅非 `--check` 模式写盘） | parse→evaluate→emit，包内纯函数边界 | 仓库工作区文件 | 下游 typed-access 消费方 import | `number` 叶的 PathMap 增广 | desync/环 → 响亮抛错；`--check` 陈旧 exit 1 不写盘 | C1a/C1b、T-1/T-2、C2a/C2d |
| B 投影链 | `resolveSchemaAtPath(derived, path)` | 无（纯函数，fresh 结果对象） | 值级终态判定（int/range 与 pattern 同层 default） | 无持久化 | 调用方读判别联合 | `{ok,valueSchema}` 透传 / 两枚冻结码 | 敌意段 INVALID；内容级 NOT_FOUND | C3a/C3d、T-3 |
| C readData 链 | `readData(path)`（runtime ready 后） | 每次读新建 detached 深拷贝 wrapper | B 的输出经 `cloneValueSchema` 克隆（memo 环/共享处理） | 内存（Y.Doc 活文档为事实源，投影零缓存） | 公共面消费者 | 三键成功形状 / `PATH_NOT_ALLOWED` 等 | 失败对象不带 `schema` 键；投影永不污染活 schema | T-4 |
| D T-4 装置链（仅测试内，iteration 1 新增说明） | 测试构造 `TXT_316` + `seedRoot316` 预写值 | memory persistence `createDoc` 提交 SCHEMA/META/ROOT 三载体 | 不经 sequencer/写路径——**在 runtime 构造前于源 Y.Doc 上播种**（与 #273 fixture `:87` 同款先于 `createDoc` 的播种时点，非绕过 sequencer 的运行中改写） | 进程内 memory persistence | `readData`/`getStatus` 公共面 | `['b']` 可观察预写值 50 | persistence 对 `META.docId` 违约即拒；装置错误使测试红（fail loud） | T-4 装置路径 + §12 |

T-* 对数据流的唯一影响是**在既有路线上增加观察点**（D 路线是测试装置的构造时播种，发生在 runtime 创建与任何读之前，不触碰运行中状态），不创建、不改变任何写入/传输/投影路径。

## 9. 错误、恢复、并发和幂等

- **错误**：无新增错误路径。既有语义保持——codegen 不支持形状 `structure/value desync` 响亮抛错（T-2 锚定）；resolve 两枚冻结码（T-3 锚定集合不增不减）；readData 失败分支形状（失败对象无 `schema` 键；`PATH_NOT_ALLOWED`/`RUNTIME_READ_DISABLED` 不变，T-4 锚定配对同码）。
- **恢复/重试**：全链同步纯函数（A/B）+ 同步快照读（C），无重试语义需要设计。T-4 的 ready 轮询为有界等待（5s 上限，与既有 fixture `:96` 同款），超时即测试失败（fail loud，不静默跳过）。
- **装置失败路径（iteration 1 补齐，对应 SA2 E-4）**：T-4 装置的每一步失败都以测试红的形式可见——`META.docId` 与 `createDoc` docId 不一致 → persistence 拒绝（构造期抛错）；schema 文本解析失败 → `schema.state` 轮询超时（5s）红；播种遗漏 → 值断言（`value===50` 等）红。**无任何静默 fallback 或「装置不可用则跳过」路径**。
- **并发**：无变化。`cloneValueSchema` 单线程假设由既有 memo「先登记后递归」注释锚定；投影零缓存无共享态。
- **幂等**：`generateProjection` 两次调用逐字节相等（SA6 §7 实测；T-1 可顺带断言）；`resolveSchemaAtPath`/`readData` 无副作用、可重复调用且每次读全新 wrapper（T-4 断言）。
- **正常路径不变量缺失 → fail loud**：desync 负控（T-2）本身就是该纪律的哨兵——不设计任何静默 fallback。

## 10. 文件范围

### ALLOW LIST

当前 dispatch（SA1 design，iteration 1）产物：

| 路径 | 预期改动 | 原因 |
| --- | --- | --- |
| `wiki/raw/task_issue-316_design.md` | 原位修订（本设计，iteration 1） | SA1 唯一允许的设计产物 |

若 Host 按 SA6 U1 处置为「覆盖补票」并路由测试侧（下游 SA 的实施范围，非本 dispatch 执行）：

| 路径 | 预期改动 | 原因 |
| --- | --- | --- |
| `packages/vfsl-codegen/test/generate-int-range.test.ts` | 扩展：T-1（typed-access program 级编译断言，类型 import 自 `@nomicore/vfsl-protocol`）、T-2（desync 负控）；可选附 `.test-d.ts` | 缺口 (c)/(d)；§7 T-1/T-2 |
| `packages/vfsl/test/resolve-schema-at-path-int-range.test.ts` | 扩展：T-3（FIXTURE 增补 `u`/`r` + 无碰撞 pattern 配对面 `pp`/`ppe`/`ppr`/`ppu` + 7 组配对同构 + 码集合断言；**既有 7 断言与既有字段零改动**） | 缺口 (a)；§7 T-3 |
| `packages/namespace-runtime/test/runtime-readdata-int-range.test.ts` | 新增：T-4（readData 端到端；**文件内自包含装置**——私有 TXT_316/seedRoot316/makeHandle316/makeReadyRuntime316，只读复用 `./real-persistence-scheduler.js`；不修改 `readdata-schema-projection-fixture.ts`） | 缺口 (b)；§7 T-4（F1 方案 (b)） |
| （可选）`packages/vfsl-codegen/test/generate-int-range.test-d.ts` | 新增：T-1 的 `declare module` 镜像形态 | C1c 冗余哨兵；与 program 级二择一 |

以上测试路径零配置改动即可被 CI 发现（`*.test.ts` 落根 vitest include `packages/*/test/**/*.test.ts` 的磁盘枚举分片、`*.test-d.ts` 落 `--typecheck.only` include）。

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
| --- | --- | --- |
| `packages/vfsl-codegen/src/**`（`valuetype.ts`、`emitter.ts` 等） | AC1 承载实现 | 已满足（§2.1）；改动即字节漂移/回归（D-1/D-2） |
| `packages/vfsl/src/**`（`resolve-schema-at-path.ts`、`ir.ts`、`derived.ts`、`parser`、`validate` 等） | AC3 承载实现 + #315 本体 | 已满足（§2.2）；决策 8 禁新增拒绝路径；#315 范围非本票 |
| `packages/namespace-runtime/src/**`（`read-schema-projection.ts`、`runtime.ts` 等） | AC3 组合面实现 | 已满足（§2.3）；ADR 0016 冻结面 |
| `domains/vfs3-assets/**`（`schema.vfsl`、`generated.ts`） | 字节稳定基线 | AC2 钉值 sha256 必须逐字节保持；为过测试改域文本是伪绿 |
| `docs/adr/**`、`docs/vfsl/v1-spec.md`、`CONTEXT.md` | 决策与规范 | 本设计零决策变化；spec 已随 #315 落地，无行为变化无须改文档 |
| `.github/workflows/ci.yml`、根 `package.json`、`vitest.config.ts` | 门禁配置 | 新测试自动纳入；改配置无需求且放大影响面 |
| `packages/namespace-runtime/test/readdata-schema-projection-fixture.ts` | #273 readData 契约共享 fixture | **只读**（iteration 1 与 T-4 自包含装置一致）：`makeHandle`/`makeReadyRuntime` 被 273 载体数据锁定（§2.3），其形状是 #273 red/control 两套件的装置事实；T-4 只参照其构造配方（§7 T-4 步骤 4/5），不改文件（备选 6 记录了扩展方案的拒绝理由） |
| `packages/namespace-runtime/test/real-persistence-scheduler.ts` | 包级共享调度器助手 | 只读复用（T-4 import）；为单一测试改共享助手放大影响面 |
| 其余既有测试/fixture（含 `runtime-readdata-schema-projection-{control,red}.test.ts`、`runtime-readdata-hostile-path-guard.test.ts`、`runtime-readdata-schema-red.test-d.ts`、`resolve-schema-at-path-fixture.ts` 等） | 既有契约证据 | T-* 全部为加法：不改任何既有断言/字段/装置；改动会波及既有契约组 |
| `wiki/raw/` 下其他任务的产物 | 其他任务证据 | 跨任务产物只读（硬门禁） |

## 11. 调用方影响矩阵

生产零改动 ⇒ 无任何调用方的运行时/类型/时序行为变化。受影响者仅为「新增观察点」的测试面：

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
| --- | --- | --- | --- | --- |
| codegen 消费方（`domains/*/generated.ts` 的 typed-access 使用者） | `int`/`range` 字段投影 `number` | 不变（T-1 增加编译级哨兵） | 无 | §2.1；ADR 0020 决策 7 |
| `resolveSchemaAtPath` 调用方（namespace-runtime readData 组合、直接测试） | 判别联合两枚失败码 | 不变（T-3 增配对哨兵） | 无 | §2.2；ADR 0016 |
| `readData` 调用方（agent 类消费者） | 三键成功形状 / 既有失败形状 | 不变（T-4 增端到端哨兵） | 无 | §2.3；ADR 0016 |
| `generate --check`（CI codegen-freshness、开发者本地） | 新鲜 exit 0 / 陈旧 exit 1 | 不变 | 无 | §2.4；ci.yml:128/147 |
| #273 readData 契约组（共享 fixture 的既有消费方） | fixture 提供 273 载体装置 | **完全不变**（T-4 自包含，fixture 零触碰——iteration 1 起 ALLOW/DENY 与此一致） | 无 | §2.3；§10 DENY |
| 既有测试套件（353 文件 3863 用例） | 全绿 | 保持全绿；新增用例并入分片，不改任何既有断言 | 无 | SA6 §4；T-* 全部为加法 |

## 12. 验收与验证映射

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
| --- | --- | --- | --- |
| AC1 发射 `number` + 可编译 | `generate-int-range.test.ts` 10 用例（发射文本 + `preEmitDiagnostics` 0） | 无新增必需项；可选 T-5 CLI 端到端 | `PathSchema<number,'leaf'>` 逐字相等；0 诊断；CLI exit 0 |
| AC1 强化：typed-access 编译级（根 AGENTS.md 写路径义务的读侧投影对偶） | **缺**（既有只编译生成物自身） | **T-1**：generated+consumer 同 program；类型 import 自 `@nomicore/vfsl-protocol`；`@ts-expect-error` 写 `'42'`/`true`；负例恰 1×TS2322 | consumer 0 诊断；负例恰 1 条 TS2322（投影退化则 0 条 ⇒ 红） |
| AC1 强化：白名单不过宽 | **缺** | **T-2**：tampered leaf+xml derived → `generateProjection` | 抛错含 `structure/value desync` |
| AC2 字节稳定/新鲜度 | `generate --check` exit 0；sha256 钉值；drift 哨兵 5 用例；`generate-cli-check.test.ts` | 既有门禁重跑即可（C2a~C2d） | exit 0；sha256 不变；陈旧夹具 exit 1 不写盘 |
| AC3 同构（终态/拒绝分类一致） | 单侧断言（int/range 侧 7 用例）；**缺配对与码集合** | **T-3**：7 组 pattern 配对（无碰撞命名 `pp`/`ppe`/`ppr`/`ppu`）+ `SCHEMA_PATH_INVALID` 配对 + 码集合断言 | 逐组同 ok 性、同码、同 path 回显；码集合 ⊆ 两枚冻结码 |
| AC3 readData 组合面 | **零覆盖**（`cloneValueSchema` int/range 分支） | **T-4**：自包含装置上的 `readData` 三键/预写值/条件键/range 叶/元素叶/docs/detached/配对失败 | §7 T-4 断言清单全绿；**`readData(['b'])` 可观察预写值 50**（F1 验收锚）；变异投影后重读不污染 |
| 装置可实施性（F1 新增行） | SA6 探针 C 以同形态装置实测全绿 | T-4 装置构造路径逐行照抄、零既有文件修改 | `git status` 下既有 readData 测试/fixture 零 diff；新文件单独成立 |
| AC4 包测试、typecheck 全绿 | SA6 实测 353 文件/3863 用例、typecheck 0、spec 机检 22/22 | T-* 落地后重跑：`pnpm typecheck`；焦点 3+1 文件；全量 `vitest run --typecheck` | 全部 exit 0；若加 `.test-d.ts` 另跑 `vitest run --typecheck.only` |
| 风险 R1（误改生产代码） | — | §10 DENY LIST + C2 门禁即哨兵 | 任何生产 diff → `generate --check` 或全量测试红 |

每条设计路线（D-1~D-4 保持 + T-1~T-5 补齐）均至少关联一个可执行验收行为；已有测试不足处（T-*）已给出建议路径与可观察断言，不指定执行角色。

## 13. 风险、回滚和残余问题

| # | 风险/问题 | 等级 | 缓解/处置 |
| --- | --- | --- | --- |
| R1 | 实现者误判「#316 还需改生产代码」→ 重新改 `valuetype`/`emitter`，打破 `generate --check` 基线或引入回归 | 高（SA6 §8 放大因素同认；SA2 复核同认） | 本设计把「生产零改动」定为硬性结论（§7 D 系列 + §10 DENY）；C2 门禁天然拦截 |
| R2 | T-4 装置复杂度（memory persistence + Y.Doc + ready 轮询）引入脆弱等待或构造即兴 | 低（iteration 1 已消除「即兴」面：装置路径逐步写明，SA2 E-4 缺口关闭） | 装置配方与既有 fixture `:73-98` 逐行同构、只换载体（§7 T-4）；有界轮询 5s 超时即红；SA6 探针 C 实测即时 ready；装置错误全部 fail loud（§9） |
| R3 | T-1 的 `@ts-expect-error` 若实现漂移会「反噬」（诊断消失时报未使用） | 低 | 该反噬恰是敏感性设计意图（fail loud）；镜像 `.test-d.ts` 为可选冗余 |
| R4 | 票面语义与基线错位的 Host 处置未决（关闭为已交付 vs 转覆盖补票） | 中（流程项，非技术项） | 转录 SA6 U1：两种处置都不需要生产改动；本设计对两种处置均可用（纯评估关票，或按 §10 ALLOW 下半段路由测试） |
| R5 | 全量测试时长（~597s，maxWorkers=1）随新增用例增长 | 低 | T-* 集中落焦点文件（SA6 U4 同款建议）；CI 分片自动均衡 |
| R6（iteration 1 新增） | T-4 自包含装置与 #273 fixture 的构造配方未来漂移（fixture 改形后新文件未跟） | 低 | 两文件分属不同 issue 契约，漂移只影响新文件自身红（fail loud）；装置配方锚定在 §7 T-4 步骤 4/5 并注明镜像来源行号，评审可对账 |
| 回滚 | 本设计零生产改动 ⇒ 无需回滚；T-* 为纯加法测试（含 T-4 新文件整体自包含），revert 即回到当前 HEAD 状态 | — | — |
| Follow-up（明确非本票必要条件） | 品牌类型 codegen（独立 ADR）；指数记号字面量（纯拓宽）；`cloneValueSchema` 其余叶子种类的覆盖面扩展 | — | 均已有 ADR/票面归属，不在 #316 范围 |

无未解决的任务内必要条件：设计不含阻塞项（SA2 唯一阻断项 F1 已在本次修订落实）。

## 14. 评审修订映射

评审输入：`wiki/raw/task_issue-316_sa2_review.md`（SA2 design-review，iteration 0，verdict reject）。逐条落实如下；SA2 经独立复核确认成立的内容（生产零改动、四锚点、4 项缺口、门禁映射、非目标边界）**全部原样保留**，本迭代未删除任何经独立验证的需求或结论。

| Finding | 严重度 | 修订位置 | 处理结果 |
| --- | --- | --- | --- |
| F1：T-4「沿既有 fixture」与其真实形态（`makeReadyRuntime` 无参、`makeHandle` 无条件硬编码 `seedRoot`、只播种 273 载体键）及 §10 DENY（fixture 只读）三方互斥——`value===50` 不可达，实现者被迫即兴 | MAJOR（阻断） | §2.3（fixture 真实形态改为事实行）；§7 T-4（全量重写为自包含装置：imports/TXT_316/seedRoot316/makeHandle316/makeReadyRuntime316 逐步可照抄 + 断言清单 + 平行装置声明）；§7 备选 6（方案 (a) 的显式拒绝理由）；§8 数据流新增 D 路线（装置构造时播种说明）；§9（装置失败路径补齐，关闭 E-4）；§10 ALLOW（T-4 行改自包含表述）与 DENY（fixture/scheduler 只读理由精确化）；§11（#273 契约组「完全不变」行）；§12（T-4 行 + 装置可实施性新增行）；§13 R2/R6 | **已落实**：采用 SA2 裁定的方案 (b)（自包含装置，fixture 保持只读）。装置路径可逐行照抄、不触碰任何既有 readData 测试/fixture，ALLOW/DENY 与之一致，`readData(['b'])` 在预写值 50 下可观察——满足 F1 验收三条件 |
| F2：T-3 pattern 配对字段名 `p` 与既有 FIXTURE 的 `p: number & Int<1,1>` 冲突，「增补」按字面不可执行 | 非阻断（建议） | §2.2（既有 FIXTURE 字段占用记为事实）；§7 T-3（配对面改名 `pp`/`ppe`/`ppr`/`ppu` + 补齐 `u`/`r` 容器侧 + 「既有 7 断言与其目标字段零改动」声明）；§10 ALLOW（T-3 行）；§12（T-3 行） | **已采纳**：命名无碰撞（全仓 `VfslPathMap` 增广键与既有测试字段均无 `pp*` 冲突——SA2 §9 已核），既有断言原样保留，与「纯加法」自洽 |
| F3：T-1「import 生成的 PathAt/PathValue/PathPatchValue」措辞不准——三类型是 `@nomicore/vfsl-protocol` 导出，生成物只供 `VfslPathMap` 增广；`M` 未定义 | 非阻断（建议） | §7 T-1（类型来源改为 protocol import `index.ts:59/72/81/118-120`；`M` := 被 生成文本增广后的 `VfslPathMap`；先例锚 `generate-number-literals.test-d.ts:15,30`；`tsc-helper.ts` paths 说明）；§12（T-1 行） | **已采纳**：consumer 形态有仓内先例可照抄，编译单元解析面经 SA2 §9 核验无碰撞 |
| F4：§2.3 把「三键成功形状」错锚到 `read-schema-projection.ts:109-111`（实为 `detachReadSchemaProjection` 四件套深拷贝；三键分支在 `runtime.ts`） | 非阻断（建议） | §2.3（锚点拆分：三键 → `runtime.ts:474-486` + JSDoc `:117-124`；`:102-114` 标注为 D5 四件套深拷贝）；§2.3 失败面行；附录速查表 | **已采纳**：锚点细分，结论不变 |
| F5：`classifyStructureReject` 实际行号 `:362-372`（原写 `:355-371`，含前置 doc 注释起点） | 非阻断（建议） | §2.2；附录速查表 | **已采纳**：函数体口径 `:362-372`，注明 doc 注释自 `:355` 起 |

## 15. 是否需要设计后 ADR 冲突复查及理由

**不需要（`requiresConflictRecheck: false`）。** 理由：

1. 本设计（含 iteration 1 修订）**零生产改动、零接口/协议/wire/schema/持久化/状态机语义变化**——推荐项 T-* 是纯加法测试（T-4 为自包含新文件），不触碰任何公共 API 面。
2. 设计与 ADR 0020 决策 7/8 的关系是**确认对齐而非修订**：四个实现锚点（`valuetype.ts:35-39`、`emitter.ts:335`、`resolve-schema-at-path.ts:289-291`、`read-schema-projection.ts:170-183`）经 SA1 亲验均与决策文本一致（SA2 独立亲验同认）。
3. 不触碰任何 ADR 冻结面：错误码集合（ADR 0016）、指纹前缀与字节基线（ADR 0005/0020 决策 5）、docs 切片（ADR 0019）全部保持。
4. iteration 1 的修订内容（F1 测试装置范围自洽化 + F2~F5 命名/措辞/锚点精度）均为**测试侧落地路径**，不新增任何 ADR 冲突面——与 SA2 评审结论一致（其 §13 明示 `requiresConflictRecheck: false`：新增发现均为测试装置/命名/锚点精度问题）。
5. 缺失的 316 专属 SA8 产物（relevant_decisions/conflict_report）已按 §6 以权威 ADR 原文 + 模块 AGENTS.md + CI 门禁逐条替代核验，未发现任何与决策文本冲突的设计内容，故无须机械要求复查。

---

## 附：证据锚点速查（iteration 1 口径）

| 主题 | 锚点 |
| --- | --- |
| int/range → number | `packages/vfsl-codegen/src/valuetype.ts:35-39` |
| leaf 白名单 + desync | `packages/vfsl-codegen/src/emitter.ts:335`（`case 'leaf'`；白名单条件 `:339-348`；desync 消息模板 `:533`） |
| 值级终态 default | `packages/vfsl/src/resolve-schema-at-path.ts:289-291`（别名访客 `:413-414` 一带） |
| 失败分类 | `packages/vfsl/src/resolve-schema-at-path.ts:362-372`（`classifyStructureReject` 函数体；doc 注释自 `:355` 起）；码定义 `:68`、`:98`、`:102`、`:141`、`:161` |
| detached 克隆 int/range | `packages/namespace-runtime/src/read-schema-projection.ts:170-183`（`case 'int'` `:172-178`、`case 'range'` `:179-183`）；四件套深拷贝 `detachReadSchemaProjection` `:102-114` |
| readData 三键成功形状 / 失败透传 | `packages/namespace-runtime/src/runtime.ts:474-486`（`:478` 三键 JSDoc、`:485` `PATH_NOT_ALLOWED` 原样透传）；类型面 JSDoc `:117-124` |
| typed-access 类型来源 | `packages/vfsl-protocol/src/index.ts:59`（`PathAt`）、`:72`（`PathValue`）、`:81`（`PathPatchValue`）、`:118-120`（`VfslTypedAccess`）；先例 `packages/vfsl-codegen/test/generate-number-literals.test-d.ts:15,30`；孤立 program paths `packages/vfsl-codegen/test/tsc-helper.ts:44-46` |
| T-4 装置配方镜像源 | `packages/namespace-runtime/test/readdata-schema-projection-fixture.ts:73-90`（makeHandle 配方）、`:93-98`（makeReadyRuntime 配方）；`text` 透传先例 `runtime-readdata-schema-projection-red.test.ts:207`；scheduler 必填背景 `real-persistence-scheduler.ts` 头注（issue #107）；`META.docId` 违约即拒 `packages/persistence/src/testing.ts`（createDoc 契约组） |
| 既有测试 | `packages/vfsl-codegen/test/generate-int-range.test.ts`（10）、`packages/vfsl/test/resolve-schema-at-path-int-range.test.ts`（7；FIXTURE `:16-25`，`p`/`q` 已占用）、`packages/vfsl/test/int-range-fixture-drift.test.ts`（5） |
| readData 测试装置（只读参照） | `packages/namespace-runtime/test/readdata-schema-projection-fixture.ts`（273 载体锁定：`makeHandle` opts `:73-76`、硬编码 `seedRoot` `:87`、无参 `makeReadyRuntime` `:93-98`）；共享助手 `real-persistence-scheduler.ts` |
| 门禁 | `.github/workflows/ci.yml:20`（typecheck）、`:44`（`--typecheck.only`）、`:50/80`（分片）、`:128/147`（codegen-freshness）；根 `package.json` `generate` 脚本；根 `vitest.config.ts:15/20`（include 面） |
| 基线钉值 | `domains/vfs3-assets/generated.ts` sha256 `342d8c1f…e6707`（SA1 与 SA6 双向一致；SA2 独立实测一致） |
| 决策文本 | `docs/adr/0020-vfsl-number-constraints.md` 决策 5/7/8（SA2 亲验 `:148-160`）、决策 10、Considered Options 8；`docs/adr/0016-*.md` readData 投影契约 |
