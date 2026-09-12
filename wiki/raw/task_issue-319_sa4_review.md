# SA4 实现静态审查 — Issue #319 number 值域收窄核心：validate 与 validate-patch 统一判定（ADR 0021）

- 角色：SA4（mabf-sa4）· 阶段 implementation-review · 迭代 0 · one-shot dispatch `sa-302a91bf-f169-4be1-841f-8548b71af977`
- 审查对象：SA3 实现报告 `wiki/raw/task_issue-319_sa3_impl.md` 所述变更集（工作树未提交 diff：6 modified + 2 new 测试文件）
- 审查方式：纯静态（源码/diff/测试源码/配置/git 状态逐行核对；未运行测试、未启动服务、未创建临时进程；未修改任何实现/设计/测试）
- Worktree：`/home/wangjian/nomicore-fix-issue-319` · HEAD `ff2dc64` · 分支 `mabf/issue-319`

## 1. Reviewed inputs

| 输入 | 状态 |
| --- | --- |
| `wiki/raw/task_issue-319.md`（任务简报 + AC1~AC5） | 已读 |
| `wiki/raw/task_issue-319_design.md`（SA1 迭代 1 修订版，449 行；D-A~D-H、§11 ALLOW/DENY、§12 验收映射） | 已读全文 |
| `wiki/raw/task_issue-319_sa2_review.md`（迭代 1 复审 approve；F1/F2 落实核验、O1~O6） | 已读全文 |
| `wiki/raw/task_issue-319_sa6_contract.md`（approve；T1/T2/D1 断言规格、消息规则①–④、反事实三态） | 已读全文 |
| `wiki/raw/task_issue-319_conflict_report.md`（SA8 clear；Required actions 1–4；requiresConflictRecheck=true 三复查项） | 已读全文 |
| `wiki/raw/task_issue-319_relevant_decisions.md`（SA8 决策摘录） | 已读全文 |
| `wiki/raw/task_issue-319_sa3_impl.md`（SA3 实现报告） | 已读全文 |
| `docs/adr/0021-vfsl-number-domain-narrowing.md`（裁决权威；决策 1/3/4/5/6/7 逐字比对） | 已读全文 |
| 实际 diff 全量：`git diff`（validate.ts / v1-spec.md / materialize.ts / replace.ts / 两 doc-runtime 测试）+ 两枚新建测试文件全文 | 已逐行核对 |
| 消费链与测试面：`validate-patch.ts`、`mutation-local.ts`、`write.ts`、`canonical-json.ts`、`projection/input.ts`、`helpers/base.ts`、`src/testing.ts`、`input-capture.test.ts`、`registry-create.test.ts`、`vitest.config.ts`、两包 `tsconfig.json`、changelog `package.json` | 已核对 |
| Issue #319 REST 评论 | 读取成功且为空数组——**无 Owner 评论要求**（与简报/SA6 §2/SA8 §4/设计 §4 四方一致） |

## 2. Verdict

**approve** —— 无 BLOCKER、无 MAJOR。

核心结论（证据锚点见下各表）：

1. 生产改动唯一收敛于 `packages/vfsl/src/validate.ts`（+56/−10），与设计 D-A/D-B/D-C 伪代码**逐符号一致**（`isJsonFaithfulNumber`/`renderNumberValue`/`scalarAccepts`/`scalarRejectMessage`/`NEG_ZERO_MEMO_KEY`/`memoKey` 全部模块局部；两判定点同步收窄；memo 恰三触点全部归一化，无第四值键触点）。
2. `-0/0` memo 正确性（设计自行新增的必做项）落地且经 SA3 mutation 探针证明测试敏感性；盘上 `sha256sum validate.ts = cab40cee…5841b` 与报告声称的探针后恢复哈希**逐字节一致**——恢复真实。
3. 消息兼容面零破坏：typeof 失配文案逐字节保持（AC5 + AC1-4 以 `toBe` 全等断言锁定）；emit 锚位/thunk 门控/单条量/遍历序/计费全部不变。
4. D-H 三用例迁移与两注释行逐条对规格落地，**不放宽任何拒绝、不删除覆盖**（唯一删除的 `toContain('non-finite number')` 为设计显式裁决）；G3 迁移用例保留全部原零写入/旧内容断言（L514–517）。
5. v1-spec §8 条款与 ADR 0021 决策 4 逐字一致（仅去 blockquote 换行），插入点为文本锚（规则 3 后、解释段前），三条既有规则与 `version` 未动，`git diff --check` 干净（本审查独立复跑）。
6. 文件范围恰为 ALLOW 七行枚举变更集 + 报告；DENY 全部未触碰（`validate-patch.ts`/`index.ts`/parser/derived/changelog src/namespace-runtime/persistence/ADR/§8 以外章节零 diff）。
7. SA3 声称的验证证据内部自洽（63 = 51+12；3361 = 3298+63；`--numstat` 与报告 stat 一致；vitest include + 两包 tsconfig 实覆盖新测试路径）。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
| --- | --- | --- |
| Issue L17：四值全拒 + 消息细分 + `-0` 经 `Object.is` + 双路径同口径 | `validate.ts` L172–206（六辅助）、L372（contradictsInner）、L506–509（validateValue）；`renderNumberValue` 以 `Object.is(v,-0)` 先于 `String` 回落 | 落实（与 ADR 0021 决策 1/3 逐字一致） |
| Issue AC1（validate 四值全拒/消息/有限放行） | T1 AC1-1~AC1-5（`validate-number-domain-narrowing.test.ts` L98–223）：四值 ×（ok:false + 恰 1 条 + path + 规则①–④ + 互异 + `-0` 尾 token 反例）、7 有限值 + 0.0 正控、嵌套四位、声明序 3 条 | 落实 |
| Issue AC2（validate-patch 同口径） | T1 AC2-1（L247–315）：validatePatch/append/insert/applyMutationAtBoundary（set + array-insert）× 四值，消息与 AC1-1 参考字面 `toBe` 全等 + path rebase | 落实；`validate-patch.ts` 零改动（共享 `validateSubtree` 结构达成，git status 证实未触碰） |
| Issue AC3（changelog 结构性闭合锁定） | T2 `write-path-number-domain-closure.test.ts`（AC3-1~4）；机制面 `canonical-json.ts` L61–63（非有限 throw）+ `projection/input.ts` L85–96（catch → unavailable）静态核实为既有代码未动；AC3-5 `input-capture.test.ts` 未在 git status 改动列表（原样保持） | 落实 |
| Issue AC4（IR/derived/codegen/fixture 指纹零改动） | git status：codegen/生成物/fixtures/lockfile 零 diff；`index.ts` 零改动；既有指纹 KAT 未触碰 | 落实（`generate --check` exit 0 为 SA3 声称，静态面无漂移路径——判定纯运行时） |
| Issue AC5（包测试、typecheck 全绿） | SA3 报告：315 files/3361 tests/typecheck exit 0；新增路径被 `vitest.config.ts` L15 include 与两包 tsconfig（`include: ["src/**","test/**"]`）实覆盖（本审查独立核实配置） | 声称自洽（动态复验项见 §11） |
| SA8 R1（§8 例外条款同变更集） | `docs/vfsl/v1-spec.md` +4 行：引导行 + 条款（与 ADR 0021 L80–83 逐字比对一致）；规则 1–3 与「对历史文本的解释」段逐字未动 | 落实 |
| SA8 R2（消息 emit 锚位/顺序/单错误量） | L506–509：仍为 scalar 分支单一 `ctx.emit([...path], thunk)`，消息构造留 thunk 内（R4 门控注释在案）；每标量节点至多 1 条 | 落实 |
| SA8 R3（排除面纪律） | parser/tokenizer/evaluate/derived/persistence 零 diff；T1 AC7 锁 `-0` 字面量 E100 ×3 形态 + int/range 四名 E301 + number 正常 parse；AC5 锁 unknown/枚举（`e:0\|1` 收 `-0` ok:true）不波及 | 落实 |
| SA8 R4（CONTEXT.md 术语，可选） | 不采纳（设计 §4 表末行裁决在案） | 知悉，无义务 |
| SA2 F1（BLOCKER：3 处旧语义断言 + 2 失准注释） | D-H 逐用例迁移全部落地（见 §9 测试质量审查表）；`materialize.ts` L128/`replace.ts` L120 各 ±1 行 comment-only | 落实 |
| SA2 F2（MAJOR：AC1-5 schema 非法） | T1 L181/L217 使用 `type U = number \| string; type ROOT = { xs: U[]; };` 与 `Record<string, number \| string>`；仓内既有 `Id[]` TypeRef 数组合法先例（`validate-snapshot-sa7.test.ts` L58）独立佐证 | 落实 |
| Owner 评论要求 | REST 评论空数组（dispatch 声明 + 四方报告一致） | 无可遗漏项 |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
| --- | --- | --- | --- |
| D-A 单一共享谓词 + 四值消息分支 | `validate.ts` L170–206（`ScalarTypeName`/`isJsonFaithfulNumber`/`renderNumberValue`/`scalarAccepts`/`scalarRejectMessage`，置于 `jsonTypeOf` L153 邻域）；L503–510 消费 | 与设计伪代码逐符号一致；`isJsonFaithfulNumber` = ADR 决策 1 公式逐字；typeof 失配消息经 `scalarRejectMessage` 通用分支输出与旧 L462 逐字节同文（AC5 以 `toBe` 锁定） | 无 |
| D-B 双判定点同步收窄（both 变体） | `contradictsInner` L369–372（`return !scalarAccepts(node.type, value)`——unknown→false/null→`!==null` 语义被等价吸收，逐分支推演等价）；`validateValue` L505–510 | 落实；联合无候选分支（L477–481）结构产出「汇总 + 下钻」恰 2 条，argmin 严格 `<` 平局取声明序在前 → 四值 detail 在 number 成员，与 D-B 锁定形态及 T1 AC1-3 断言（`[pathKey(['u']),pathKey(['u'])]`）一致 | 无 |
| D-C memo 哨兵键（三触点） | `NEG_ZERO_MEMO_KEY` L64 + `memoKey` L67–69；读 L338（countIssues）/L361（contradicts）；写 L429（memoStore，双 memo 共用唯一写点） | 恰三触点全归一化，grep 全文件无第四处值键读写（`.get(value)`/`.set(value` 零残留）；Symbol 身份唯一、不可与用户快照值相等（仅 number 型 -0 映射）；`MEMO_CAP` 清空重建/L418–423 与计数语义不变 | 无 |
| D-D 消息冻结粒度（规则①–④） | `scalarRejectMessage` L199–204：域短语逐字 + `renderNumberValue` 尾字面量（NaN/Infinity/-Infinity/-0）；消息不 `类型不匹配：` 开头、非 E100 | T1 `expectNarrowedMessage`（L74–80）逐规则断言，含 +Infinity 的 `-Infinity` 尾反例与 `-0` 的 `/(^|[^\d-])0$/` 反例（真判别力：`String(-0)="0"` 实现必红） | 无 |
| D-E §8 条款逐字落文 | `v1-spec.md` L468–472（+4 行） | 与 ADR 0021 决策 4 逐字一致（blockquote 换行合并）；插入点 = 规则 3（L467）后、解释段（L473）前文本锚；无 0020 保留名条款；`version` 不升；`git diff --check` 干净（独立复跑 CLEAN） | 无 |
| D-F 契约测试落位（Q4/Q5/Q6） | T1 在 vfsl 包（`../src/index.js`，同既有测试惯例）；T2 在 changelog 包（`@nomicore/vfsl` workspace 依赖 package.json L22 在案，`schema-freeze` 先例；复用 `helpers/base.ts`/`src/testing.ts` 导出 `jcs`/`sha256Hex`——本审查核实导出在案）；无新增哈希 fixture、无 runtime 端到端 | 与设计三裁决一致 | 无 |
| D-G 枚举不收窄 | `enumContains` L211–215 零改动；T1 AC5 枚举块锁定 | 落实 | 无 |
| D-H 既有测试迁移 | 见 §9 表 | 落实 | 无 |

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
| --- | --- | --- | --- |
| number 值域判定 | vfsl 校验核心（唯一值语义 Owner） | `validate.ts` 单文件，`scalarAccepts` 单一事实源供两判定点 | 正确——既有双谓词分叉被消除 |
| 测试语义迁移 | 测试文件自身 | 两 doc-runtime 测试文件内用例级；生产代码仅 2 注释行 | 正确 |
| 规范修订 | v1-spec §8 | 单点插入 | 正确 |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
| --- | --- | --- | --- | --- |
| 非有限数 loud 拒 | `extract.ts` L268–272 / `detached-build.ts` L183–186 | `isJsonFaithfulNumber` 独立谓词 | 一致 | 同款惯例；`-0` 补缺为 ADR 0021 显式裁决 |
| -0 识别 | `Object.is(v,-0)`（extract-nonfinite 测试先例；ADR 0010 SameValue） | 同 | 一致 | — |
| 模块级不可变常量 | `ISSUE_LIMIT`/`WORK_LIMIT`/`MEMO_CAP` | `NEG_ZERO_MEMO_KEY` 同区声明（L64） | 一致 | 非跨调用缓存、非第二事实源 |
| TypeRef 数组 schema | v1 文法 `ArrayType = PrimaryType {"[]"}`；`validate-snapshot-sa7.test.ts` L58 `Id[]` 先例 | AC1-5 用 `U[]` | 一致 | 既有绿色先例独立佐证合法性 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
| --- | --- | --- | --- |
| number 合法值域 | ADR 0021 决策 1 | `isJsonFaithfulNumber` + §8 条款（内嵌 ADR 引用，未复制定义到 CONTEXT.md——符合 docs/AGENTS「link to authoritative source」） | 低 |
| 判定实现 | `scalarAccepts`（两点共用） | — | 低（分叉消除） |
| 迁移用例失败面语义 | vfsl 收窄判定直调 | 两测试断言 `toEqual` 直调 issues（R2b L905 / G3 L513），无第二份判定 | 低 |

### 生命周期对称性

无运行时生命周期面（同步纯函数、无 register/dispose/后台任务/持久化新增）；`NEG_ZERO_MEMO_KEY` 为不可变模块常量，per-call Ctx 纪律不变。成立。

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
| --- | --- | --- | --- |
| 第二判定实现 | — | D-B 备选被拒绝，实际单谓词 | 无平行机制 |
| 字符串哨兵键 | — | 备选被拒绝（用户值可碰撞） | 无 |
| 新错误码/消息通道 | validate 消息通道 | 四值复用；AC6 测试断言内部符号不进公共面 + 非 `VFSL-Exxx` 形态 | 无 |
| 测试期反向依赖 | 包依赖方向 | T2 落 changelog 包（依赖方向正确） | 无 |

## 6. 文件范围审查

只读 git 核对（`git status --porcelain` + `git diff --numstat`，本审查独立执行）：

| Changed path | ALLOW entry | Purpose | Assessment |
| --- | --- | --- | --- |
| `packages/vfsl/src/validate.ts`（+56/−10） | ALLOW 行 1 | 谓词收窄 + 四值消息 + memo 键归一化（唯一生产改动） | 在范围；改动面 = 设计枚举的①②③，无额外 |
| `packages/vfsl/test/validate-number-domain-narrowing.test.ts`（新建，431 行/51 用例） | ALLOW 行 2 | T1 红灯契约 | 在范围 |
| `packages/namespace-diagnostic-log/test/write-path-number-domain-closure.test.ts`（新建，164 行/12 用例） | ALLOW 行 3 | T2 观测闭合锁定 | 在范围 |
| `docs/vfsl/v1-spec.md`（+4/−0） | ALLOW 行 4 | §8 例外条款 | 在范围（单点插入，其余零改动） |
| `packages/doc-runtime/test/materialize-root.test.ts`（+48/−4） | ALLOW 行 5（用例级） | C-7 迁移 + R2b 新增 + 头注同步（SA2 O1 授权的注释侧延伸） | 在范围（含 3 行迁移注释与头注 4 行——见观察 O2） |
| `packages/doc-runtime/test/replace-root-content.test.ts`（+22/−8） | ALLOW 行 6（用例级） | L486/L630 两用例迁移 + 文件头 AC-1 注一行 | 在范围 |
| `packages/doc-runtime/src/materialize.ts`（±1）、`src/replace.ts`（±1） | ALLOW 行 7（comment-only） | 失准注释更正 | 在范围（diff 证实仅注释文本，零代码语义） |
| `wiki/raw/task_issue-319_sa3_impl.md` 等 `wiki/raw/*` | Host 输入 + 报告产物 | 非实现面 | 知悉 |

DENY 核对：`validate-patch.ts`、`index.ts`、parser/tokenizer/evaluate/derived/schema-envelope、`jsonTypeOf`/`preview`/`enumContains` 与计费常量（diff 中均未出现）、changelog `src/**`（含 `input-capture.test.ts`）、namespace-runtime、persistence、`docs/adr/**`、§8 以外章节、CONTEXT.md、生成物/fixtures/lockfile——**全部零 diff**。无越界。

## 7. 契约连锁审查

生产调用方全量重扫（grep `validateLogicalSnapshot|validatePatch|validateAppendToArray|validateInsertIntoArray|applyMutationAtBoundary|validateSubtree`，src 非测试命中）：

| Contract | Caller | Actual handling | Risk | Finding |
| --- | --- | --- | --- | --- |
| validate 结果联合（四值 ok:true→ok:false） | `validate-patch.ts`（finish/validateBoundary） | 经 `validateSubtree` 共享判定；文件零改动 | 低（结构达成同口径，AC2-1 逐字面锁定） | 无 |
| 同上 | doc-runtime `mutation-local.ts` 四点 / `materialize.ts` / `mutation.ts` / `replace.ts` / `schema-replace.ts` / `create-initial-document.ts` | `!ok → {kind:'fail'}` 零写入通道既有；除两注释行外零改动 | 低 | 无 |
| 同上 | namespace-registry `create-document.ts` 双路径 | 建档失败通道既有；`registry-create.test.ts` L726–727 NaN/Infinity root 行断言即拒绝（`NAMESPACE_CREATE_INVALID_INPUT`），收窄后仍绿（静态核对断言方向） | 低 | 无 |
| 同上 | namespace-runtime `write.ts`（S3/R9）、`schema-write.ts` | S3 `copyFrozen` 只挡非有限数（`-0` 穿透后在 vfsl 新拒点被拒）；R9 透传既有 | 低 | 无 |
| 同上 | changelog adapters/reader（record 校验 memory.ts 等） | record 值域经投影期 finite 过滤/-0 归一（SA6 §10 行 5）；本包 src 零改动 | 低 | 无 |
| 测试级消费者 | 两 doc-runtime 测试（D-H 迁移）+ 全仓四值断言扫描 | 本审查独立 grep `NaN|±Infinity|-0` 于 `packages/*/test`：除已迁移 3 处与两枚新测试外，其余命中均为非 vfsl number 叶判定面（changelog 直投投影、retention 配置 JS 域、META epoch JS 域、persistence JS 域、unknown 位行）——与 SA2 §9「恰 3 处」triage 一致 | 低 | 无 |

无遗漏关键 caller；无未处理的新错误语义。

## 8. 错误、恢复与并发

- **失败语义**：四值拒绝 = `ok:false` + 单条 issue（path 精确/消息规则①–④）；无新 throw 面、无新错误码（AC6 测试锁非 `VFSL-Exxx` 形态）；E100/`WorkBudgetExceeded` 边界零触碰（diff 未涉及）。
- **无静默 fallback**：D-C 消除的两类静默错误（`[0,-0]` 静默接受 / `[-0,0]` 伪报）经哨兵键修复；T1 AC1-5 ①–⑤ + SA3 mutation 探针（移除 `memoKey` → ①④⑤ 红、恢复后 63/63 绿 + sha256 校验恢复——盘上哈希与本审查实测一致）证明敏感性。
- **纯函数/确定性**：辅助函数无状态；`renderNumberValue` 仅在 thunk 内执行（R4 门控——计数态/截断态不构造消息）；同输入同输出。
- **memo 边界**：`MEMO_CAP` 清空重建路径（L418–423）与哨兵共存无冲突；NaN/±Infinity 键 SameValueZero 无碰撞（仅 ±0 对需消歧，已覆盖）；别名共享节点（ref 解析同一对象）外键语义不变。
- **并发/重启**：无可变共享状态新增（模块级 Symbol 常量不可变）。
- **存量 breaking**（ADR 决策 5）：loud 失败为既定姿势，无缓解工具引入（正确——不侦察/不迁移）。

## 9. 测试质量审查

SA4 未运行测试，以下为测试源码与触发入口的静态审查。

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
| --- | --- | --- | --- | --- |
| T1 AC1-1（`validate-number-domain-narrowing.test.ts` L98–123） | 四值 ×（ok:false 前置 + 恰 1 条 + path + 规则①–④含反例）+ 互异 + `-0` 尾 token 反例 | 根 `vitest.config.ts` L15 include（本审查核实）；`pnpm test`/CI shard `*/*/test/**/*.test.ts` 均收录 | 无——取消息前无条件断言 `ok:false`（`issuesOf` 抛错即红），规避 SA6 §13 警告的「派生检查跳过伪绿」 | 无 |
| T1 AC1-2/AC2-1 正控 | 7 有限值 + 0.0 + 写路径四入口有限正控（含 `proposedBoundary` 值同一性） | 同上 | 无 | 无 |
| T1 AC1-3 嵌套/联合 | 四位嵌套 path 精确拒绝；联合位恰 2 条（汇总 + 四值 detail，D-B 锁定形态） | 同上 | 无 | 无 |
| T1 AC1-4 | 恰 3 条声明序 + typeof 失配消息 `toBe` 全等（兼容面字节锁定） | 同上 | 无 | 无 |
| T1 AC1-5 memo 序独立性 | ①`[0,-0]`→`[xs,1]` 拒（无 `[xs,0]`）；②`[-0,0]`→仅 `[xs,0]`；③NaN 对照；④混序；⑤Record 值位 | 同上 | 无——mutation 探针证明对哨兵键缺失真实敏感（SA3 报告 + 恢复哈希独立核实） | 无 |
| T1 AC5 相近负控 | 5 类 typeof 失配逐字节 + unknown 叶放行 + null/string/boolean + 枚举不收窄 | 同上 | 无 | 无 |
| T1 AC6/AC7 | 内部符号不进公共面（动态 import + Object.keys）+ 非 E100 形态；`-0` 字面量 E100 ×3 + int/range E301 ×4 + number 正常 parse | 同上 | 无 | 无 |
| T2 AC3-1~4（`write-path-number-domain-closure.test.ts`） | 写路径四值拒（path/message）；有限正控 `capture:'full'` + `digest===sha256Hex(jcs(...))` + 零事件；闭合不变量（4 拒 + 4 接受非空转）；机制锚（直投 NaN/±Inf → unavailable + 事件；`-0/0` digest 碰撞 + 内存保留） | 同上（changelog 包 tsconfig 含 test；`@nomicore/vfsl` workspace 依赖在案） | 无——`baseEmission({input:{snapshot}})`/`makeLog({inputPolicy:'full'})` 与既有 `input-capture.test.ts` L61/L182/L201 构造法逐字同型（复用既有夹具纪律） | 无 |
| D-H：`materialize-root.test.ts` RAC-2/R2b | C-7 行删除 + 原位迁移注释；R2b 直调 ok:false 恰 1 条（path/message 规则①–④）→ materialize ok:false + `issues` `toEqual` 直调 + 0 update + state 字节不变（R3 模板锚型 L826–875 复核同构）；其余 8 行（C-1~C-6）及其断言模板零改动 | 包 tsconfig + 根 include | 无——不放宽（该输入仍被拒，只是失败面上移 ①）；构造域支路由 C-3/C-4a/C-4b 结构性保留 | 无 |
| D-H：`replace-root-content.test.ts` G3 L487–518 | 前置翻转 ok:false + 直调 issues 前置捕获（SA2 O6 写法）+ 收窄消息三断言 + `toEqual` 零损透传 + **保留全部**原断言（0 update L514/state L515/`title==='old'` L516/`count===1` L517） | 同上 | 无——唯一删除的 `toContain('non-finite number')` 为设计 D-H 裁决 2 显式授权（构造域词非冻结兼容面） | 无 |
| D-H：`replace-root-content.test.ts` G5 L642–656 | 前置翻转 ok:false + mat/rep `issues` `toEqual` 等价保留 + 用例名/注释改「逻辑失败输入」 | 同上 | 无 | 无 |

无 skip/only/todo（两枚新文件 grep 零命中）；无源码字符串形态断言；fixture 均为每用例新建（`new Y.Doc()`/`makeLog`），无共享可变状态。

## 10. Required revisions

无 BLOCKER/MAJOR。**无 Required revisions。**

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
| --- | --- | --- | --- |
| SA3 声称的全仓绿/类型检查/生成物新鲜度（315 files/3361 tests/typecheck/generate exit 0） | Host runner / CI（SA4 静态审查未运行测试） | 全绿；两枚新文件 63 用例被发现并执行 | 任一红或新文件未被收录 |
| 实现前红灯证据的精确分布（SA3 报告 32 failed/31 passed；本审查静态分类推得 31/32——总数 63 一致、逐类方向一致，疑似数字转置） | 任意后续重放（checkout 基线 + 仅加两枚测试） | 失败全部为四值目标断言、负控全绿 | 出现非四值类失败 |
| runtime 端到端 `-0` 写零写入（设计 D-F Q6 裁定为冗余、SA7 活链路范围） | SA7 活链路验证 | `mutateData` 提交 `-0` → `validation/rejected` + doc 不变 | 出现写入或崩溃 |
| 存量四值 doc 在 rearm/重校验点 loud 失败（ADR 决策 5 既定姿势，非缺陷） | 运维认知/发版说明（运营项） | breaking 告知随发版发布 | — |

## 12. Non-blocking observations

| ID | Observation |
| --- | --- |
| O1 | SA3 报告 Verification 表中实现前红灯记为「32 failed / 31 passed」；本审查按测试源码逐用例静态分类推得 31 failed / 32 passed（总数 63 与全部类别方向一致，疑为转置笔误）。不影响结论（红灯成因分类与敏感性论证均成立），建议后续修订报告时勘正。 |
| O2 | D-H 规格写「原位留一行注释记录迁移」，实现留了 3 行（`materialize-root.test.ts` L842–844）；另有 RAC-2 头注 4 行与 replace 文件头 AC-1 注 2 行的同步更正——均为 comment-only 且在 ALLOW 两测试文件内，SA2 O1 已显式授权为「用例级修订的合理延伸」。知悉即可。 |
| O3 | T1 AC6 第一用例用动态 `import('../src/index.js')` + `Object.keys` 断言内部符号不外泄——运行时形状检查，比类型面更强（可捕获意外的具名导出），与 doc-runtime 既有公共面守卫测试惯例一致。 |
| O4 | ADR 0021（及随之逐字落入 §8 的条款）引「ADR 0008 L31」而实际在 L25——accepted ADR 既有行号偏差随「逐字落文」要求传播（SA2 O2 在案，留作未来 ADR 勘误项，本任务不改）。 |
| O5 | `preview` 在其他消息分支对 `-0` 渲染为 `0`——既有兼容面，设计 §13 follow-up 1 在案，本变更集正确未触碰。 |
| O6 | SA8 三项复查（(a) 消息面 / (b) §8 落文 / (c) 冻结面 diff）所需证据在本变更集与 SA3 报告中均已齐备（本审查静态复核 (b)(c) 通过、(a) 的锚位/顺序/单条量静态通过）；SA8 复查仍按流程执行，非本审查可替代。 |

## 13. 是否需要设计后 ADR 冲突复查

本审查**未发现新的 ADR 冲突面**，不额外置 `requiresConflictRecheck`。SA8 既有三项复查（消息面 / §8 落文 / 冻结面 diff）证据已就绪，仍由 SA8 按其流程执行。

## 14. 审查结论

实现与 SA1 批准设计（SA2 approve 的迭代 1 修订版）、SA6 验收契约（T1/T2/D1）、SA8 Required actions 1–4 及 ADR 0021 逐条对齐：共享谓词单点收窄双判定点、memo 哨兵键三触点全覆盖、消息兼容面字节级保持、D-H 三用例迁移不放宽不删覆盖、§8 条款逐字落文、文件范围恰为枚举变更集、DENY 全未触碰。SA3 声称的验证证据内部自洽且关键哈希（validate.ts 探针恢复）经独立核实一致。**approve**——SA8 复查与 SA7 活链路验证按流程接力。
