# SA10 Spec 审查报告 — Issue #319 number 值域收窄核心：validate 与 validate-patch 统一判定（ADR 0021）

- 角色：SA10（mabf-sa10）· 阶段 spec-review · 迭代 0 · one-shot dispatch `sa-7f1c5468-6ecb-46d4-a403-7ae1719d2319`
- 审查对象：交付 commit `a6053a756da8a993618b66c45b6e569b4b26b888`（`fix(#319): 裸 number 值域收窄为 JSON 可忠实表示数（ADR 0021）`），parent = `ff2dc64`（ADR 0021 docs 提交），8 文件 +727/−24
- 审查方式：纯静态（交付 diff 逐行核对 + 规范文本/ADR 逐字比对 + 消费链结构核实）；未运行测试、未启动服务、未修改任何实现/设计/测试
- Issue #319 REST 评论：读取成功且为空数组——**无 owner 评论要求**（与简报、SA6 §2、SA8 §4、设计 §4、SA2/SA3/SA4/SA7 九方一致）

## 1. 输入清单

| 输入 | 位置 | 状态 |
| --- | --- | --- |
| 任务简报（Issue 正文 + AC1–AC5） | `wiki/raw/task_issue-319.md` | 已读全文 |
| SA1 设计（迭代 1，SA2 approve） | `wiki/raw/task_issue-319_design.md`（D-A~D-H、§11 ALLOW/DENY、§12 验收映射） | 已读关键区段 |
| SA2 设计复审（approve） | `wiki/raw/task_issue-319_sa2_review.md` | 已读结论与 F1/F2 |
| SA6 验收契约（approve） | `wiki/raw/task_issue-319_sa6_contract.md`（T1/T2/D1 断言规格、消息规则①–④、反事实三态） | 已读全文 |
| SA3 实现报告 | `wiki/raw/task_issue-319_sa3_impl.md` | 已读全文 |
| SA4 静态审查（approve） | `wiki/raw/task_issue-319_sa4_review.md` | 已读全文 |
| SA7 动态验证（approve） | `wiki/raw/task_issue-319_sa7_report.md` | 已读全文 |
| SA8 前置冲突报告（clear，recheck=true） | `wiki/raw/task_issue-319_conflict_report.md` | 已读结论 |
| SA8 实现后复查（clear，recheck=false） | `wiki/raw/task_issue-319_implementation_conflict_report.md` | 已读全文 |
| 裁决权威 | `docs/adr/0021-vfsl-number-domain-narrowing.md`（156 行，accepted） | 已读全文（决策 1/2/3/4/5/6/7） |
| 规范文本 | `docs/vfsl/v1-spec.md` §8 | 已读当前形态 |
| SA9 产物 | — | **不存在**（SA8 复查 §2 已声明，本审查 `ls wiki/raw | grep -i 319` 复核一致） |

## 2. 交付 diff 与枚举变更集核对

交付 commit 改动**恰好 8 个文件**，与设计 §11 ALLOW LIST 七行一一对应，无 ALLOW 外改动：

| 文件 | diff | ALLOW 行 | 核对 |
| --- | --- | --- | --- |
| `packages/vfsl/src/validate.ts` | +56/−10 | 行 1（唯一生产改动点） | ✅ |
| `packages/vfsl/test/validate-number-domain-narrowing.test.ts` | 新建 431 行（T1） | 行 2 | ✅ |
| `packages/namespace-diagnostic-log/test/write-path-number-domain-closure.test.ts` | 新建 164 行（T2） | 行 3 | ✅ |
| `docs/vfsl/v1-spec.md` | +4/−0 | 行 4（§8 例外条款） | ✅ |
| `packages/doc-runtime/test/materialize-root.test.ts` | +48/−4 | 行 5（D-H 用例级） | ✅ |
| `packages/doc-runtime/test/replace-root-content.test.ts` | +22/−8 | 行 6（D-H 用例级） | ✅ |
| `packages/doc-runtime/src/materialize.ts` / `src/replace.ts` | 各 ±1（comment-only） | 行 7 | ✅ |

DENY LIST 全量零 diff（本审查独立执行 `git diff a6053a7^ a6053a7 -- <paths>` 计 0 行）：`validate-patch.ts`、`index.ts`、parser/tokenizer/evaluate/derived、changelog `src/**`、`input-capture.test.ts`、namespace-runtime、persistence、`docs/adr/**`、§8 以外章节、CONTEXT.md、生成物/fixtures/`pnpm-lock.yaml`/`.github`。`git diff --check` 干净；worktree HEAD = 交付 commit，`git status` 仅 wiki 输入 untracked。

## 3. 逐项验收核对（Issue AC1–AC5 + 正文「What to build」）

### AC1 — validate：四值全拒（消息细分正确）；0、0.0、有限小数放行 → **met**

- **判定公式**：`isJsonFaithfulNumber`（validate.ts L174–176）= `typeof v === 'number' && Number.isFinite(v) && !Object.is(v, -0)`——与 ADR 0021 决策 1（L43–45）和 Issue 正文公式逐字一致。
- **单事实源**：`scalarAccepts`（L190–195）同时供 `validateValue`（L506）与 `contradictsInner`（L372）消费——旧双谓词分叉消除，符合 SA6 §15 Q1 建议与设计 D-B「both」裁决；unknown→true / null→严格等值 / 其余 typeof 三分支逐分支等价于旧实现。
- **消息细分**：`scalarRejectMessage`（L199–204）——typeof 非 number 走通用分支 `类型不匹配：期望 ${type}，实际 ${jsonTypeOf(value)}`，与 diff 删除的旧行**逐字节相同**（本审查比对 ±行）；四值走 `期望 number（有限数且非 -0），实际 ${renderNumberValue(value)}`。`renderNumberValue`（L180–186）以 `Object.is(v,-0)` 先于 `String` 回落——-0 尾字面量为 `-0` 而非 `0`（ADR 0021 决策 3 的 `String(-0)==="0"` 误导规避）。
- **T1 锁定**：AC1-1（四值 × ok:false/恰 1 条/path `['n']`/消息规则①–④/两两互异/-0 尾 token 反例）、AC1-2（7 有限值 + 0.0 正控）、AC1-3（嵌套四位 + 联合位 D-B 锁定形态「汇总+detail 恰 2 条同 path」）、AC1-4（恰 3 条声明序 + typeof 失配 `toBe` 字节锁定）、AC1-5（memo 序独立性，v1 合法 schema 形）。
- SA6 消息规则①–④逐条可满足且已被断言：① 域短语逐字在场（L201）；② 非 `类型不匹配：` 前缀（独立分支）；③ 非 `VFSL-E100` banner（既有 validate 消息通道）；④ 尾值字面量（`renderNumberValue`）。

### AC2 — validate-patch：写路径同口径四值全拒 → **met**

- `validate-patch.ts` **零 diff**（本审查核实）；写路径经共享解释器 `validateSubtree`（validate-patch.ts L35 import、L563 调用；validate.ts L704 定义）自动同口径——结构达成，无第二判定实现。
- T1 AC2-1：`validatePatch`/`validateAppendToArray`/`validateInsertIntoArray`/`applyMutationAtBoundary`（set + array-insert 两边界）× 四值，issue 恰 1 条、path rebase 正确（`['n']` / `['list',0]`）、消息与 AC1-1 参考字面 `toBe` **逐字节相同**；有限正控含 `proposedBoundary` 值同一性。
- SA7 活链路独立证据（§3 R2/R1）：三接缝消息逐字节相同；`-0` 穿透 runtime S3 后在 vfsl 边界被拒（path `['n']` + 收窄消息的跳点归属证明）；NaN/±Inf 维持 S3 `MUTATION_INPUT_NOT_PLAIN_DATA` 既有拒绝面（不变路线）。

### AC3 — changelog 结构性闭合锁定测试 → **met**

- T2 交付于 `packages/namespace-diagnostic-log/test/write-path-number-domain-closure.test.ts`，依赖方向正确（`@nomicore/vfsl: workspace:*` 在 changelog `package.json` L22 声明；复用本包 `testing.js`/`helpers/base.ts` 既有夹具）。
- AC3-1（四值写拒，path `['inner','n']`）、AC3-2（有限正控 → `capture:'full'` + `digest === sha256Hex(jcs(proposedBoundary))` + 零 `input-projection-failed`）、AC3-3（闭合不变量非空转：4 拒 + 4 接受双断言）、AC3-4（机制锚：直投 NaN/±Inf → unavailable+事件；`-0`/`0` digest 碰撞 + 内存保留 -0——新旧同绿，解释机制非红灯）。
- AC3-5：既有 `input-capture.test.ts` **零 diff**（本审查核实）——投影契约原样保持。
- changelog `src/**` 零 diff（record schema/JSONL 未动，ADR 0014 冻结面兑现）。

### AC4 — IR / derived / codegen / 既有 fixture 指纹逐字节不变 → **met**

- 零 diff 面（本审查独立核实）：codegen 生成物、fixtures、IR/derived 两树相关源码（parser/tokenizer/evaluate/derived/schema-envelope）、指纹 KAT（`compile-schema-envelope.test.ts`）、`pnpm-lock.yaml`。
- 公共 API 面：`index.ts` 零 diff；六枚新符号（`isJsonFaithfulNumber`/`renderNumberValue`/`scalarAccepts`/`scalarRejectMessage`/`memoKey`/`NEG_ZERO_MEMO_KEY`）全模块局部——grep 全 `packages/vfsl/src/` 除 validate.ts 外零引用；T1 AC6 以动态 import + `Object.keys` 负向锁定。
- 无新增错误码：diff 中唯一 `VFSL-E` 命中为 T1 负向断言（`startsWith('VFSL-E100')).toBe(false)`）。
- `pnpm generate --check` exit 0：SA3 与 SA7 两次独立证据在案（SA10 边界不运行验证命令，采信在案证据链）。

### AC5 — 包测试、typecheck 全绿 → **met（证据链采信）**

- SA3：全仓 `pnpm test` 315 files / 3361 tests passed / Type Errors none；增量 63 = 51（T1）+12（T2）恰为两枚新文件；`pnpm typecheck` exit 0。
- SA7：探针删除后聚焦复跑 8 files / 186 tests 绿 + `pnpm typecheck`/`pnpm generate --check` 双 exit 0；红灯契约（63 用例）实现前红→实现后绿，失败全为四值目标断言（与 SA6 反事实三态互证）。
- SA10 边界不运行测试；上述证据内部自洽且经 SA4 静态复核（63=51+12、3361=3298+63、vitest include + 两包 tsconfig 实覆盖）。

### Issue 正文「What to build」附加要求 → **met**

- 「typeof 非 number 维持现有『类型不匹配：期望 number，实际 X』」：通用分支模板与旧行逐字节相同（diff ± 行比对）；T1 AC5 五类 typeof 失配以 `toBe` 全等锁定且不含收窄短语。
- 「-0 经 `Object.is` 单独识别（不被显示为 "0")」：`renderNumberValue` 的 `Object.is(v,-0)` 分支先于 `String(v)` 回落；T1 AC1-1 的 `-0` 尾 token 反例（不得匹配裸 `0` 尾）真实判别（`String(-0)="0"` 实现必红）。
- 「写入路径与校验路径同口径」：共享 `validateSubtree` + AC2-1 逐字节同字面锁定（见 AC2 行）。

## 4. dispatch 指定的五项重点核验

| 核验点 | 结论 | 证据 |
| --- | --- | --- |
| **裸 number 四值拒绝** | ✅ 落实 | 公式逐字（validate.ts L174–176）；双判定点同源（L372/L506）；T1 AC1-1 锁定四值 × 恰 1 条/path/规则①–④ |
| **写路径一致性** | ✅ 落实 | `validate-patch.ts` 零 diff + 共享 `validateSubtree` 结构；AC2-1 四入口 × 四值逐字节同字面；SA7 三接缝活链路互证 |
| **changelog 闭合** | ✅ 落实 | T2 AC3-1~4 交付 + AC3-5 `input-capture.test.ts` 零 diff + changelog src 零 diff；SA7 runtime 级三记录闭合（committed+full / rejected×2、零投影失败） |
| **v1-spec §8 例外** | ✅ 落实 | +4 行插入于规则 3 后、解释段前（L469–472）；条款正文与 ADR 0021 决策 4（L80–83）**逐字一致**（仅 blockquote 换行合并）；三条既有规则/「只增不改」表述/解释段/`version`/错误码逐字未动；未引入 ADR 0020 保留名例外；`git diff --check` 干净；与代码同变更集（同 commit） |
| **声明排除面** | ✅ 全部保持 | 见 §5 |

## 5. 排除面与冻结面核对（stated exclusions）

| 排除面 | 依据 | 实际 | 结论 |
| --- | --- | --- | --- |
| 文本侧 `-0` 字面量 E100（不实现） | ADR 0021 决策 2 依赖缺席的 ADR 0020；SA8 §8-R3 | parser/tokenizer 零 diff；T1 AC7 锁现状：`-0`/`-0 | 1`/`-0.0` → `E100 未知记号: -` | ✅ 未顺带实现 |
| `int`/`Int`/`range`/`Range` 三形态（不实现） | 同上；`ValueSchema` 无 int/range kind | evaluate/derived 零 diff；AC7 锁 `E301 未知名引用` ×4 名 | ✅ |
| 种子/手工 Yjs 直构面（不收窄） | ADR 0021 决策 7 L104–105 | persistence 零 diff；doc-runtime `extract.ts`/`detached-build.ts` 消费侧守卫零 diff | ✅ |
| 枚举分支（不收窄） | 设计 D-G；SA6 Q2 | `enumContains` 零改动；AC5 锁 `0\|1` 收 `-0`（=== 命中）、拒 NaN/1.5 走「值不在枚举内」 | ✅ |
| `unknown` 叶（不收窄） | SA8 override 不得扩大（仅裸 number） | `scalarAccepts` unknown→true 等价旧行为；AC5 锁 NaN/嵌套 NaN/Infinity 放行 | ✅ |
| CONTEXT.md（SA8 R4 可选项不采纳） | 设计 §4 表末行裁决 | 零 diff（本审查核实） | ✅ |
| changelog record schema/JSONL、namespace-runtime S3/R9、复制 wire | ADR 0014/0010/0007/0008 | 全部零 diff；SA7 实测 S3 对 NaN/±Inf 的既有拒绝面逐字保持 | ✅ |
| 既有 `jsonTypeOf`/`preview`/`enumContains`/计费常量（ISSUE_LIMIT/WORK_LIMIT/MEMO_CAP） | packages/vfsl AGENTS.md 兼容行为面 | 零改动（diff 无对应 hunk）；emit 锚位仍为 scalar 分支单一 `ctx.emit([...path], thunk)`，消息构造留 thunk 内（R4 门控）；遍历序/单条量不变 | ✅ |

## 6. D-H 既有测试迁移核对（ADR 0021 决策 5 的测试侧后果）

3 处把旧四值语义编码为前置的 doc-runtime 断言按设计 D-H 逐用例规格迁移，**不放宽任何拒绝、不删除覆盖**：

| 用例 | 迁移内容 | 核对 |
| --- | --- | --- |
| materialize-root RAC-2 C-7 | 迁出构造失败矩阵（原位 3 行迁移注释）→ 新增 R2b 逻辑失败用例：直调 ① 拒（恰 1 条/path/规则①–④）→ materialize 同拒 + `issues` toEqual 零损透传 + 0 update + state 字节不变；构造域支路由 C-3/C-4a/C-4b unknown 位行结构性保留；RAC-2 头注矩阵行数同步 | ✅ 与设计 §301 行规格逐条一致 |
| replace-root-content G3 L486 | 前置翻转 `ok:false` + 收窄消息三断言 + 删 `toContain('non-finite number')`（设计 D-H 裁决 2 显式授权：构造域词非冻结兼容面）+ `issues` toEqual 直调（SA2 O6 前置捕获写法）+ **保留全部**原零写入/旧内容断言 | ✅ |
| replace-root-content G5 L630 | 前置翻转 `ok:false` + mat/rep `issues` toEqual 等价锚保留 + 用例名改「同一逻辑失败输入」 | ✅ |
| `materialize.ts` L128 / `replace.ts` L120 注释 | 「① 逻辑校验（值域宽域）」→「① 逻辑校验（number 值域经 ADR 0021 收窄）」——comment-only、各 1 行、措辞与设计 D-H 裁决 3 建议逐字一致 | ✅ |

## 7. 设计自由度与新增必做项的落实

| 项 | 来源 | 落实 | 核对 |
| --- | --- | --- | --- |
| D-C memo 哨兵键（设计自行新增必做项） | SameValueZero `-0≡0` 共键双向碰撞（-0 静默接受 / 0 伪报） | `NEG_ZERO_MEMO_KEY`（Symbol，不可变模块常量，L64）+ `memoKey`（L67–69）；恰三触点：countIssues 读 L338 / contradicts 读 L361 / memoStore 写 L429；grep 无第四值键触点 | ✅；T1 AC1-5 五用例序矩阵锁定；SA3 mutation 探针（移除 memoKey → ①④⑤ 红）+ 恢复 sha256 经 SA4 独立核实 |
| D-B 联合位报告形态锁定 | 「both」变体：无候选 → 汇总 + argmin 平局取声明序在前（number 成员） | T1 AC1-3 锁恰 2 条同 path（`['u'],['u']`）+ 汇总条 + 收窄 detail | ✅ |
| SA6 Q1（contradicts 同步收窄） | 建议同步收窄 | 已采纳（`scalarAccepts` 双点消费） | ✅ |
| SA6 Q4/Q5/Q6（T2 落位/无强哈希 fixture/无 runtime 端到端强制） | 设计 D-F 裁决 | T2 在 changelog 包（依赖方向正确）；无新 fixture；runtime 端到端由 SA7 活链路自愿覆盖且通过 | ✅ |

## 8. 未达成项披露（PR 必须披露项）

**无**。Issue AC1–AC5、正文「What to build」、SA6 契约 T1/T2/D1、SA8 Required actions 1–4、设计 D-A~D-H 全部落实；无遗漏、无部分实现、无错误实现、无 scope creep。

非阻塞记录（继承自 SA4/SA8 在案观察，非 SA10 新发现，均不影响 approve）：

1. **O1（报告勘误项）**：SA3 报告实现前红灯记「32 failed / 31 passed」，SA4 静态分类推得 31/32——总数 63 与成因分类一致，疑为转置笔误（SA4 O1 / SA7 §10 在案）。
2. **O2（行号偏差随逐字落文传播）**：ADR 0021（及 §8 条款）引「ADR 0008 L31」实为 L25——accepted ADR 既有偏差，语义指称正确（ADR 0008 该声明文本在场），留作未来 ADR 勘误项（SA2 O2 / SA4 O4 / SA8 §8.1 在案）。
3. **O3（comment-only 延伸）**：D-H 迁移注释 3 行（规格写「一行」）+ 两处测试头注同步——SA2 O1 已显式授权「用例级修订的合理延伸」，限 ALLOW 两测试文件内（SA4 O2 / SA8 §8.2 在案）。
4. **O4（commit message 无正文）**：实际交付 commit 仅主题行，未采用 SA3 建议的正文要点——不影响交付物正确性，主题行语义准确。
5. **运营 follow-up（非代码义务）**：发版说明 breaking 告知（ADR 0021 决策 5 / 设计 §13 follow-up 4）属发布流程项，不在本变更集代码面。

## 9. Verdict

**approve** —— 交付 commit `a6053a7` 忠实满足 Issue #319 正文与 AC1–AC5、SA6 验收契约（T1/T2/D1 + 消息规则①–④）、ADR 0021 决策 1/3/4/5/6/7 与全部声明排除面：裸 number 四值经 ADR 公式全拒且消息细分正确（-0 经 `Object.is` 识别），写路径经共享 `validateSubtree` 零改动同口径（逐字节同字面锁定），changelog 闭合锁定测试交付且投影契约原样保持，v1-spec §8「语义收窄例外」条款与代码同变更集逐字落文且 override 未扩大，IR/derived/codegen/fixtures/错误码/公共 API 零改动锁定兑现，文件范围恰为 ALLOW 枚举变更集、DENY 全未触碰，无 scope creep。测试/typecheck 全绿证据链（SA3 全仓 315/3361 + SA7 聚焦 186 + 双 exit 0）内部自洽并经 SA4 静态复核。无关键 AC partial/unmet/unachievable。
