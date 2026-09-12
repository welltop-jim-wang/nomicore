# SA6 诊断与验收契约 — Issue #319 number 值域收窄核心：validate 与 validate-patch 统一判定（ADR 0021）

- 角色：SA6（mabf-sa6）· 阶段 acceptance-contract · 迭代 0 · one-shot dispatch `sa-eeb5bf8f-113a-4640-b6ae-4244e98baf7a`
- 任务类型：**bug**（运行时判定缺口：旧实现放行 NaN / +Infinity / -Infinity / -0；契约 = 红灯行为契约 + 相近负控 + 零改动锁定 + 文档同变更集义务）
- 报告文件：`wiki/raw/task_issue-319_sa6_contract.md`（本文件；worktree 内此前无 issue-319 的 SA6 报告或契约测试）
- 裁决：**approve** —— 缺口 100% 确定性复现、根因双点定位（`validate.ts` 两处同一判定）、反事实模拟 104/104 翻绿、基线 35/35 红灯全部同因、相近负控 49/49 全绿、测试入口真实（vitest include + 包 tsconfig 实测）

## 1. Task type and inputs

| 输入 | 位置 | 用途 |
| --- | --- | --- |
| 任务简报 | `wiki/raw/task_issue-319.md` | What to build（四值全拒 + 消息细分 + 双路径同口径）+ AC1–AC5 |
| SA8 冲突报告 | `wiki/raw/task_issue-319_conflict_report.md` | verdict clear；Required actions 1–4；override（v1-spec §8 例外条款）；frozen surfaces；requiresConflictRecheck=true |
| SA8 决策摘录 | `wiki/raw/task_issue-319_relevant_decisions.md` | ADR 0021 逐条摘录；ADR 0020 不在本分支决策集 |
| 裁决权威 | `docs/adr/0021-vfsl-number-domain-narrowing.md`（156 行） | 决策 1（判定公式）/3（消息形态）/4（§8 条款全文）/5（存量姿势）/6（指纹零影响）/7（观测与出口闭合、种子直构面排除） |
| 现产实现（诊断对象） | `packages/vfsl/src/validate.ts`（L320–325 `contradictsInner`、L458–464 `validateValue`、L658–660 `validateSubtree`）、`packages/vfsl/src/validate-patch.ts`（L35、L562–569、L620–848、L951–1019） | 根因定位与写路径消费链 |
| 下游消费者 | `packages/doc-runtime/src/mutation-local.ts`（L234/L267/L310/L366 `applyMutationAtBoundary`）、`packages/namespace-runtime/src/write.ts`（L138–146 S3 快照、L187、L205–209 validation 拒绝） | 写路径同口径的证据链 |
| 观测面 | `packages/namespace-diagnostic-log/src/canonical-json.ts` L62、`src/projection/input.ts` L85–96、`test/input-capture.test.ts` L190–210 | changelog 结构性闭合锁定的组成面 |
| Issue 评论 | REST 读取成功且为空数组 | **无 owner 评论要求**（简报 + SA8 报告即全部输入） |
| 测试入口 | `vitest.config.ts` L14–23、`packages/vfsl/tsconfig.json`、`packages/namespace-diagnostic-log/tsconfig.json` | runner 触发与 typecheck 覆盖实证 |

无缺失输入；无既有 SA6 报告/测试需原位修订（`ls wiki/raw | grep 319` 仅三枚输入文件）。

## 2. Owner comment mapping

Issue #319 REST 评论读取成功但返回**空数组** —— 无 owner 评论级要求、无 override、无补充验收项。契约完全由任务简报 AC1–AC5、ADR 0021（accepted，2026-09-11）与 SA8 冲突报告 Required actions 驱动。**无待并入的 owner 要求**。

## 3. SA8 constraints（逐条落入本契约）

| SA8 约束 | 来源 | 契约落点 |
| --- | --- | --- |
| **必做（同变更集）**：`docs/vfsl/v1-spec.md` §8 增补「语义收窄例外」条款（ADR 0021 决策 4 原文，含 (a)(b)(c) 三条件） | 冲突报告 §3/§4/§6/§8-R1；ADR 0021 L75–85；`docs/AGENTS.md` Editing | **§12 D1**（文档交付物 + review 门；不得以源码/文档字符串测试替代） |
| 实现期核对：四值消息保持原 emit 锚位、issue 顺序、单错误量契约；文案本身自由 | 冲突报告 §8-R2；ADR 0021 L65–73；`packages/vfsl/AGENTS.md` Boundaries | T1-AC1-1（单条/路径/非 E100）、T1-AC1-4（全收集顺序）、§12 消息规则（只冻结 ADR 短语 + 尾值 token） |
| 边界纪律：不得顺带实现文本侧 `-0` 字面量 E100、int/range 三形态、seed/手工 Yjs 直构面收窄 | 冲突报告 §8-R3；ADR 0021 决策 2（依赖 ADR 0020，缺席）/决策 7（L99–105）；决策摘录 L14 | **§12 排除面清单 + T1-AC7/T2-AC3-5 边界负控**（`-0` 字面量现状 = E100「未知记号: -」；`int/Int/range/Range` 现状 = E301；`seedForTest`/手工 Y.Doc 不在断言面） |
| override 不得扩大（仅裸 `number`） | 冲突报告 §4；task L17 | 契约只锚裸 `number` 叶子；`unknown`/enum 分支显式负控（T1-AC5） |
| 冻结面：指纹逐字节、IR/derived/codegen 零改动、错误码集合不变、公共 API 不新增、record schema/JSONL 不动 | 冲突报告 §5；ADR 0021 决策 6、Consequences L133–134；ADR 0017 | **T1-AC6 零改动锁定**（基线套件 + typecheck + generate --check 全绿；不新增导出/错误码） |
| requiresConflictRecheck=true 的三项复查（消息面、§8 落文、冻结面 diff） | 冲突报告 §10 | §12 D1 + T1-AC6 + §15 Q3；证据供 SA8 复查 |

## 4. Environment and baseline

- Worktree：`/home/wangjian/nomicore-fix-issue-319`；branch `mabf/issue-319`；HEAD `ff2dc6476e758be0f6adda307931d6f5c46e8bc0`（docs(#312): ADR 0021，仅 156 行 ADR 新增，`git show --stat` 已核）；起点 `git status` 仅三枚 Host 输入 untracked（本报告写盘后新增第四枚），`packages/`/`docs/`/`apps/`/`domains/` 零 diff。
- Node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7 / typescript 5.9.3；`pnpm install --frozen-lockfile` 成功（65 pkgs，504ms；esbuild 构建脚本被忽略但 vitest 实测可用）。
- 基线（生产源码未触碰）：
  - 全仓 `pnpm test`（vitest run --typecheck）：**Test Files 313 passed / Tests 3298 passed / Type Errors no errors**（600.33s）。
  - 聚焦两包 `vitest run packages/vfsl/test packages/namespace-diagnostic-log/test --typecheck`：**62 files / 1059 tests passed / no type errors**（73.0s）。
  - `pnpm typecheck`：exit 0（14 包）。
  - `pnpm generate --check`：exit 0（投影生成物新鲜，零漂移）。
- 规范文本基线：`docs/vfsl/v1-spec.md` §8（L461–473）只有「只增不改」三条规则，**无任何例外条款**；`grep -c '语义收窄例外'` 在 `HEAD` / `origin/docs/issue-312-vfsl-number-domain`（PR #318）/ `origin/docs/issue-310-vfsl-number-constraints` 三处均为 **0**（`git log --all -S` 零命中）；`docs/adr/0020*` 在本分支不存在。

## 5. Positive reproduction（旧实现放行四值，100% 复现）

最小输入：`type ROOT = { n: number; };` → `{ n: <四值之一> }`。全部经公共面调用，无 mock、无夹具代理。临时探针 1/2/6 输出（探针命令与三态对照见 §9/§13；探针脚本为临时诊断物，收尾清理见 §16）：

```
== A. validateLogicalSnapshot: bare number leaf (type ROOT = { n: number; }) ==
  n=NaN            -> ok:true
  n=+Infinity      -> ok:true
  n=-Infinity      -> ok:true
  n=-0             -> ok:true
  n=0 / 0.5 / -1 / 1e308 / 5e-324 -> ok:true（正控，正确）
== A3. 嵌套位置覆盖（数组元素 / Record 值 / 联合成员 / optional 内层）==
  list[0]=NaN          -> ok:true
  rec.k=Infinity       -> ok:true
  u=-0                 -> ok:true
  o.v=-Infinity        -> ok:true
== B. validatePatch（路径级写校验，base={n:1}）==
  set n=NaN / +Infinity / -Infinity / -0 -> 全 ok:true
== B2. applyMutationAtBoundary（doc-runtime 写热路径，base={n:1}）==
  set n=NaN -> ok:true proposedBoundary=NaN；+Infinity/-Infinity/-0 同（ok:true 且 proposedBoundary 保留原值）
== B3. 数组写入 ==
  append NaN/+Infinity/-Infinity/-0 -> 全 ok:true；array-insert 同（proposedBoundary=[四值]）
== B4. validateInsertIntoArray（index 0）==
  insert NaN/+Infinity/-Infinity/-0 -> 全 ok:true（正控 0.5 -> ok:true）
```

写路径（doc-runtime 消费点 `mutation-local.ts` L234 等）与校验路径（`validateLogicalSnapshot`）**同口径地放行四值**——即 ADR 0021 背景表里「VFSL validate 放行」的执行侧现状。

## 6. Negative control（相近负控，旧实现全绿）

同一探针/同一进程内，与故障面相邻但不应受收窄波及的行为全部为绿（探针 1/3 输出）：

```
== A2. typeof 非 number 失配（既有消息锚）==
  n=string "x"  -> ok:false [{"p":["n"],"m":"类型不匹配：期望 number，实际 string"}]
  n=null        -> ok:false [… 实际 null]      n=boolean true -> ok:false [… 实际 boolean]
  n=array []    -> ok:false [… 实际 array]     n=object {}    -> ok:false [… 实际 object]
== H. 同款失配在写路径的锚位（四值拒绝必须复制该锚位）==
  validatePatch set ['n']='x'   -> ok:false n=1 [{"p":["n"],"m":"类型不匹配：期望 number，实际 string"}]
  append ['list']='x'          -> ok:false n=1 [{"p":["list",0],…}]     （数组元素位 path 含下标）
  array-insert ['list']+['x']  -> ok:false n=1 [{"p":["list",0],…}]
== J. unknown / 非 number 标量分支（相近负控：不得被收窄波及）==
  {…,anyv:NaN} / {…,anyv:{deep:NaN}} -> ok:true（unknown 叶现状放行）
  {…,str:1}    -> ok:false ['str'] 类型不匹配：期望 string，实际 number
  {…,bool:0}   -> ok:false ['bool'] 类型不匹配：期望 boolean，实际 number
  {z:null}     -> ok:true；{z:0} -> ok:false ['z'] 类型不匹配：期望 null，实际 number
== L. 枚举分支（非本任务收窄面）==
  enum {e:0} ok:true；{e:-0} ok:true（=== 命中 0）；{e:NaN} ok:false（值不在枚举内）；{e:1.5} ok:false
== C. JS 语义事实 ==
  String(-0)="0"（Object.is(-0,0)=false）；Number.isFinite(-0)=true；JSON.stringify(-0)=0；JSON.stringify(NaN)=null
  String(NaN)="NaN"；String(Infinity)="Infinity"；String(-Infinity)="-Infinity"
```

反事实断言集（§9 探针 5）在未修改源码上：**PASS=49 / FAIL=35**，35 条失败**全部**为四值相关目标断言（见 §13），负控 49 条全绿——红灯不来自夹具、超时、环境或入口错误。

## 7. Stability, scale and timing

- 被测面为同步纯函数（validate/validate-patch 族公共契约：同步、纯函数、不抛错），无异步、无并发、无时钟依赖。复现率 **100%**（探针 5 的 base 侧首跑即红：35/35 失败全属四值目标断言；探针 1、2、5(both) 各重复 2 次输出逐字节相同）。
- 规模维度：判定是单点谓词收窄，无新增遍历/无新增计费点；`WORK_LIMIT=2×10⁸` 与 issue 计数上限语义不变（收窄只改变既有 emit 分支的选择，不改变计费）。时间上为常数级条件判断，不存在规模曲线。
- 边界输入：`0`、`0.0`（JS 同一值）、有限小数、次正规 `5e-324`、`1e308`、`MAX_SAFE_INTEGER`、负有限数全部放行（§6/§13）；`-0` 是唯一「有限但须拒」的取值，须 `Object.is` 识别（`Number.isFinite` 挡不住）。
- 无竞态、无概率性、无性能敏感性；无需 Job 服务或常驻进程。

## 8. Root-cause chain

| Step | Fact | Evidence | Confidence |
| --- | --- | --- | --- |
| 症状 | 裸 `number` 叶子在 validate 与 patch 写路径上放行 NaN / +Infinity / -Infinity / -0 | 探针 A/B/B2/B3 实测；`validate.ts` L460 `typeof value === t.type` | 高（运行时） |
| 直接故障点 1 | 值校验分支谓词 `t.type === 'number'` 只做 `typeof` 判定，f64 全域（含四值）放行 | `packages/vfsl/src/validate.ts` L458–464（L460 谓词、L462 消息） | 高 |
| 直接故障点 2 | 硬矛盾判定（联合候选过滤）同款谓词：`return typeof value !== node.type`——同一「number 判定」在第二处重复实现 | `validate.ts` L320–325（L322–325）；全仓扫描确认仅有此两处 schema 值域 number 谓词 | 高 |
| 共享核心 | validate 与 validate-patch 共用 `validateSubtree`（同一解释器）：`validatePatch` L562–569 `finish`、`applyMutationAtBoundary` L1012–1018 `validateBoundary` | `validate-patch.ts` L35 导入；`validate.ts` L658–660 | 高（结构+实测：两路径行为逐条一致） |
| 触发条件 | 任意入参即可触发；无需时序/并发/规模条件 | 探针 1/2 单次调用 | 高 |
| 最深根因 | **声明值域与执行值域错位**：ADR 0008 L25 声明「JSON-compatible plain value」、L49 写路径 snapshotter 只收 finite number；执行侧 `typeof` 判定却大于该声明域 | ADR 0021 背景（L9–35）；ADR 0008 L25/L49；探针 C（-0 是有限数，现有 finite 守卫挡不住） | 高 |
| 放大因素 | ① 四值在 Yjs 载体/复制 wire 上忠实存活，错误不早响；② 既有 finite 守卫（namespace-runtime `write.ts` L344–346；doc-runtime `detached-build.ts` L183–184、`extract.ts` L268–270）只挡非有限数，`-0` 穿透；③ changelog JCS 分支对 NaN/±Inf 退化 `capture:'unavailable'`、对 `-0` 静默输出 `"0"`（与内部 SameValue 判据矛盾） | ADR 0021 背景表；探针 E/F/G（NaN→unavailable + input-projection-failed；-0 digest 与 0 碰撞）；ADR 0010 R2-4 | 高 |
| 未证实假设 | 无材料级未证实假设。实现自由度仅剩 union 报告形态（`contradicts` 是否同步收窄）与消息文案细节——见 §15 Q1/Q3 | —— | —— |
| 排除项 | 环境/夹具/入口错误（负控同进程全绿）；路径 rebase 缺陷（typeof 失配在四类写路径的 path 已实测正确）；IR/derived/codegen 参与（判定纯运行时，见 §10） | 探针 H、§13 | 高 |

## 9. Causal experiments

1. **反事实模拟（断言敏感性 / mutation 式验证）**——离仓副本（`/tmp/sa6-319/sim/`，生产 worktree 零改动）：
   - 变体 A `both`：按 ADR 0021 决策 1 公式同时收窄 `contradictsInner`（L322–325）与 `validateValue`（L458–464）→ 同一断言集 **PASS=104 / FAIL=0**。
   - 变体 B `accept-only`：只收窄 `validateValue` → **PASS=104 / FAIL=0**（四值仍全拒）。
   - 变体 C `base`：未修改源码 → **PASS=49 / FAIL=35**（35 条全为四值目标断言）。
   - 结论：契约断言对根因敏感（旧实现必红），对实现自由度中立（两种收窄点位都绿）；A/B 唯一可观测差异 = union 报告形态（A：`不匹配任何联合成员…` 汇总 + 下钻 2 条；B：`联合成员 1/2：…` 前缀 1 条）→ §15 Q1。
2. **观测闭合机制实验**（探针 2 E/F/G）：合法写路径（`applyMutationAtBoundary`）产出快照后经真实 emitter + `inputPolicy:'full'`：
   - 旧实现 NaN/±Inf 快照 → `capture:'unavailable'` + `input-projection-failed`（数值分支可达）；
   - 旧实现 `-0` 快照 → `capture:'full'` 且 digest 与 `0` 完全相同（静默腐化、SameValue 不可区分）；
   - 正控 0/0.5/-1/1e308 → `capture:'full'` 且 digest = sha256(JCS(snapshot))、零健康事件；
   - 收窄后四值写被拒 → 不再存在「合法写入产出的四值快照」→ 两类腐化对合法写入结构性不可达（ADR 0021 决策 7）。
   - 建模边界（诚实声明）：namespace-runtime 的 ROOT emission 在 S3 捕获的是**写输入快照**（`write.ts` L138–146），不是 doc 本身；本实验把「合法写路径产出的逻辑快照」（`applyMutationAtBoundary.proposedBoundary`，doc-runtime 实际消费物）送进 changelog 投影，正是决策 7 所指的 doc 内容面。附加事实：NaN/±Inf 输入在 runtime S3 已被 `copyFrozen`（L344–346）拦下，本变更集在 runtime 层的增量主要落在 `-0` 与 vfsl 公共面直用者。
3. **文本侧/语法边界实验**（探针 4，确认排除面无需动作）：`-0`/`-0.0`/`-1` 字面量 → tokenizer `E100 未知记号: -`（`tokenize('{ e: -0 | 1 }')` 产出 `error` 记号）；`int`/`Int`/`range`/`Range` → `E301 未知名引用`；`number` 正常 parse。
4. **断言敏感性的反例检查**：若实现用 `String(value)` 生成值 token，`-0` 消息尾值将为 `0` → 尾 token 断言必红；若对四值输出同一消息 → 两两互异断言必红；若只改 `validateValue` 而让 `contradicts` 保留旧域 → 契约仍绿但留下双谓词分叉（Q1 记录该自由度）。

## 10. Impact surface

| 面 | 本变更集应有影响 | 已核对事实 |
| --- | --- | --- |
| `packages/vfsl/src/validate.ts` | 唯一生产改动点：两处 number 判定（L322–325、L458–464）统一为 ADR 0021 谓词 + 四值消息细分 | 全仓仅此两处 schema 值域 number 谓词（其余 `typeof === 'number'` 均为路径段/下标/preview 用途） |
| `packages/vfsl/src/validate-patch.ts` | 零改动（经 `validateSubtree` 自动同口径） | L562–569/L1012–1018 共享解释器；四类写路径（validatePatch/append/insert/boundary）实测行为一致 |
| `packages/doc-runtime`（普通写） | 零改动；`applyMutationAtBoundary` 拒绝即返回 `{kind:'fail'}` → 零写入 | `mutation-local.ts` L234/L267/L310/L366；CONTEXT.md「零写入」 |
| `packages/namespace-runtime` | 零改动；写拒绝按既有 R9 通道 `validation/rejected` + issue 透传，零写入；`-0` 输入在 S3 之后被 vfsl 拦下 | `write.ts` L138–146（S3 不改）、L205–209（R9 通道） |
| `packages/namespace-diagnostic-log` | 零源码改动；新增闭合锁定测试（T2） | record schema `input.value: unknown`（`record.ts` L166）→ 收窄不改变 record 校验；`issues[].path` 的 -0 已归一（`projection/issues.ts` L102/L130–132）、`replicationEpoch`/`durationMs` 已 finite 过滤（`pipeline.ts` L197–203/L255–259）→ 无 record 校验回归；既有 `input-capture.test.ts` L200–209（-0 full 视图：内存保留 -0、JSON 视图 0、digest 归一）是**投影契约**，必须原样保持绿 |
| `packages/persistence`（`seedForTest`）、手工 `new Y.Doc()` 直构 | **不在覆盖面**（ADR 0021 决策 7 L104–105）；不得新增断言要求其拒绝四值 | `file.ts` L149/L151、`lifecycle.ts` L767 现状不动 |
| doc-runtime 消费侧守卫（`extract.ts` L268–270、`detached-build.ts` L183–184） | 零改动；仍只挡非有限数（`-0` 穿透），消费侧兜底姿势不变 | 与决策 7「种子/直构面由消费侧判据继续兜底」一致 |
| IR / derived 两树 / codegen 生成物 / 指纹 | 逐字节不变（决策 6） | `pnpm generate --check` exit 0 基线；`compile-schema-envelope.test.ts` 指纹 KAT 既有 |
| 公共 API / 错误码 | 不新增导出、不新增错误码（四值拒绝走 validate 消息通道） | ADR 0021 L133–134；`packages/vfsl/src/index.ts` 现有导出足够 |

## 11. Ruled-out hypotheses

- **「四值是边缘/不可达输入」**：排除——公共面直接可达（探针 A/B），且 `write.ts` S3 只挡非有限数、`-0` 可一路进入 doc（探针 B2 proposedBoundary=-0）。
- **「只需收窄 validate，写路径会另有一套判定」**：排除——validate-patch 四类写路径与 validate 共享 `validateSubtree`（结构 + 实测：四值在两条路径的当前结论逐条一致）。
- **「负控红是环境/夹具问题」**：排除——同一进程同一夹具内，49 条负控全绿（含未知叶、枚举、null/string/boolean、有限数、typeof 失配、机制锚）。
- **「IR/derived/codegen 需要同步改」**：排除——判定是纯运行时值域收窄，IR/派生树是文本求值产物、与运行时值无关（ADR 0021 决策 6；`pnpm generate --check` 基线绿）。
- **「record schema/JSONL 指纹会受影响」**：排除——record 的 `input.value` 为 `unknown`，number 型字段（计数/epoch/path 段）在投影期已 finite 过滤与 -0 归一（§10 行 5）。
- **「文本侧 -0 需要 E100」**：排除（本任务）——`-0` 字面量在 HEAD 连 tokenizer 都不通过（`E100 未知记号: -`）；ADR 0021 决策 2 依赖缺席的 ADR 0020，SA8 已裁不得顺带实现。
- **「int/range 需要同基线收窄」**：排除（本任务）——`ValueSchema` 无 int/range kind（`derived.ts` L51），文本侧 `int/Int/range/Range` 均 E301；无对象可改。
- **「消息会退化为『期望 number，实际 number』」**：已识别为风险并锚定——四值走独立消息分支（不含 `类型不匹配：` 前缀、含收窄域短语），契约 T1-AC1-1 针对性断言。

## 12. Acceptance contract and test paths

交付物（worktree-relative 新文件；实现者 = SA3；SA6 不编写可执行测试，只给可执行规格）：

| 编号 | 文件 | 角色 | 覆盖 |
| --- | --- | --- | --- |
| T1 | `packages/vfsl/test/validate-number-domain-narrowing.test.ts` | **红灯行为契约**（AC1/AC2/AC5/AC6/AC7） | 见下表 |
| T2 | `packages/namespace-diagnostic-log/test/write-path-number-domain-closure.test.ts` | **观测闭合锁定**（AC3） | vfsl 写路径（声明依赖 `@nomicore/vfsl`，包内已有 `schema-freeze.test.ts` 同款导入先例）× 本包真实 emitter |
| D1 | `docs/vfsl/v1-spec.md` §8（修改现有文件） | **同变更集规范修订**（AC4-doc，非可执行测试） | ADR 0021 决策 4 例外条款 |

### T1 断言规格（旧实现预期 = 红；目标实现 = 绿）

| ID | 最小输入 | 可观察断言（运行时行为） | 旧实现 | 目标实现 |
| --- | --- | --- | --- | --- |
| AC1-1 | `type ROOT = { n: number; }` + `{n: NaN / +Infinity / -Infinity / -0}`（逐值） | `ok:false`；`issues.length === 1`；`path === ['n']`；消息规则①-④（见下）；四值消息两两互异；`-0` 消息尾值 = `-0` 而非 `0`；非 `VFSL-E100` banner | 全部 `ok:true`（红） | 四值全拒（绿） |
| AC1-2 | 同 schema + `{n: 0 / 0.5 / -1 / 1e308 / 5e-324 / MAX_SAFE_INTEGER / -2.5e-7}` | 逐值 `ok:true` | 绿（负控） | 绿（回归锁） |
| AC1-3 | 嵌套位置：`list: number[]`→`['list',0]`；`rec: Record<string,number>`→`['rec','k']`；`o?: {v:number}`→`['o','v']`；`u: number \| string` 成员位 | 每处 `ok:false` 且在该精确 `path` 上有满足消息规则的 issue；联合位不锁汇总条数（Q1） | 全部 `ok:true`（红） | 全拒（绿） |
| AC1-4 | `{num: number; str: string; bool: boolean}` + `{num:NaN,str:1,bool:'x'}` | `ok:false`；**恰 3 条** issue；路径按声明序 `num→str→bool`；各 1 条 | 2 条（num 静默放行，顺序错位；红） | 3 条声明序（绿） |
| AC2-1 | `validatePatch(derived,{n:1},['n'],v)`；`validateAppendToArray(list,{list:[]},['list'],v)`；`validateInsertIntoArray(…,0,v)`；`applyMutationAtBoundary`（`set` 目标边界 / `array-insert`） | 四值逐值 `ok:false`（boundary 为 `{ok:false, result.issues}`）；issue 消息与 AC1-1 **逐字节相同**；path 各自 rebase 正确（`['n']` / `['list',0]`）；恰 1 条 | 全部 `ok:true`（红） | 全拒且同字面（绿） |
| AC5 | typeof 失配 5 类（string/null/boolean/array/object）；`unknown` 叶 `NaN`/嵌套 `NaN`；`null`/`string`/`boolean` 叶；枚举 `0\|1` 收 `-0`/`NaN` | typeof 失配：`类型不匹配：期望 number，实际 X`（前缀 + 尾 token 精确），不含收窄短语，恰 1 条；`unknown` 叶放行；非 number 标量分支不变；枚举分支不变 | 绿（相近负控） | 绿（不得被收窄波及） |
| AC6 | 零改动锁定 | 基线 `pnpm test`（313 files/3298 tests）、`pnpm typecheck`、`pnpm generate --check` 在实现后仍全绿；不改任何 fixture/指纹/生成物；`index.ts` 无新导出；无新错误码 | 绿（基线） | 绿（回归锁） |
| AC7 | 排除面边界 | `-0` 字面量仍 `E100 未知记号: -`；`int`/`Int`/`range`/`Range` 仍 `E301 未知名引用`；parser/tokenizer/evaluate/derived、doc-runtime `extract`/`detached-build`、persistence `seedForTest` 文件零改动 | 绿（基线） | 绿（不得扩散） |

**T1 消息规则（AC1-1 用，normative）**：设 `m` 为四值拒绝的 issue message——
① `m.includes('期望 number（有限数且非 -0）')`（ADR 0021 决策 3 给出的域短语，逐字）；
② `!m.startsWith('类型不匹配：')`（不得退化为 typeof 分支，杜绝「期望 number，实际 number」自相矛盾）；
③ `!m.startsWith('VFSL-E100')`（不得走崩溃收编）；
④ 消息**以期望值字面量结尾**（允许尾随空白与单个 `。`/`.`）：`NaN` → `/NaN\s*[。.]?$/` 且不匹配 `/-\s*Infinity\s*[。.]?$/`；`+Infinity` → `/Infinity\s*[。.]?$/` 且不匹配 `/-\s*Infinity\s*[。.]?$/`；`-Infinity` → `/-\s*Infinity\s*[。.]?$/`；`-0` → `/-\s*0\s*[。.]?$/`（`String(-0)="0"` 的实现必红）。
消息整句文案仍不冻结（ADR 0021 决策 3「文案不进冻结面」），仅冻结上述①④两处 + 互异 + 非 typeof 分支；若 SA1 认为①也应解冻，须显式重议「消息细分正确」验收（Q3）。

### T2 断言规格（AC3 — changelog 结构性闭合）

| ID | 输入 | 断言 | 旧实现 | 目标实现 |
| --- | --- | --- | --- | --- |
| AC3-1 | `type ROOT = { inner: { n: number } }`；`planMutationBoundary(derived,['inner'],'set')`；`applyMutationAtBoundary(…, {op:'set',value:{n:v}})` 逐值四值 | 写路径 `ok:false`（无 proposed boundary 可入观测） | `ok:true`（红） | 全拒（绿） |
| AC3-2 | 同路径 + 有限正控 `0 / 0.5 / -1 / 1e308` | 写接受 → 真实 emitter（`createBoundedMemoryDiagnosticLog({inputPolicy:'full'})`）→ `input.capture === 'full'`；`digest === sha256Hex(jcs(proposedBoundary))`；零 `input-projection-failed` 事件 | 绿（负控） | 绿（回归锁） |
| AC3-3 | 闭合不变量：对任一经写路径接受的快照 | `capture !== 'unavailable'` | **红**（NaN 被接受 → 投影 `unavailable` + 事件） | 绿 |
| AC3-4 | 机制锚：直接投影 `{n:NaN}` 与 `{n:-0}`/`{n:0}` 快照 | NaN → `unavailable` + `input-projection-failed`；`-0` 与 `0` digest 相同（内存值保留 `-0`） | 绿（新旧同） | 绿（解释闭合机制，不当作红灯） |
| AC3-5 | 既有 `test/input-capture.test.ts` | 不改一行、保持绿（changelog 投影契约是观测侧故事，不属写路径收窄） | 绿 | 绿 |

T2 组合语义：`applyMutationAtBoundary` 是 doc-runtime 普通写实际消费的接缝（`mutation-local.ts` L234/L267/L310/L366），其 `proposedBoundary` 即「合法写路径产出的逻辑快照」；把它送进本包真实 emitter 的输入投影，直接观测 ADR 0021 决策 7 的「JCS 数值分支对合法写入结构性不可达」。**不锁** runtime 级 S3 行为（NaN 输入更早已被 `copyFrozen` 拦下，属既有契约）。

### D1 文档交付物（AC4-doc，同变更集强制）

- 修改 `docs/vfsl/v1-spec.md` §8（L461–473 区段）增补**第二类例外**「语义收窄例外」，条款文本采用 ADR 0021 决策 4 L80–83 已给出的表述（逐条含三条件）：
  > 语义收窄例外：缩小既有合法值域/文本域的变更，仅当满足下列全部条件时允许，且须逐一经 ADR 显式裁决：(a) 收窄使执行语义与已声明的架构契约对齐（本次：ADR 0008 L31「JSON-compatible plain value」）；(b) 影响面与存量姿势在 ADR 中显式记录（本次：决策 5）；(c) owner 显式裁决。
- 依据：ADR 0021 决策 4（override 已由 accepted ADR 授权）+ `docs/AGENTS.md`「When code behavior changes, update every normative document whose stated contract changed」+ SA8 Required action 1。
- 验证属 **review 门**（SA8 recheck），不得写成源码/文档字符串断言测试：`§8` 条款在场且与 ADR 0021 决策 4 语义一致；三条既有规则（L465–467）与「只增不改」表述不被改写；不引入 ADR 0020 的保留名例外；不升方言 `version`、不重编错误码；`git diff --check` 干净；实现报告携带 §8 diff 供 SA8 复查。

### 旧实现红/目标实现绿的判定原则（避免伪红/伪绿）

全部断言走公共面运行时可观察输出（`ValidateResult` 联合 / issue message+path / emitter record 的 `input.capture` 与 digest），无源码 grep、无字符串形态断言、无 skip/only/todo、无 env override、无 fallback、无吞错；红灯原因 = 四值被放行（探针实证），非夹具/超时/入口错误（同进程负控 49/49 绿）。

## 13. Red/green or baseline evidence

证据 1 — **反事实断言集三态**（离仓副本；同一断言集）：

```
SIM=base（worktree 未修改）      : PASS=49 FAIL=35（共执行 84 项检查）
SIM=accept-only（只收窄校验分支） : PASS=104 FAIL=0
SIM=both（两处判定同收窄）        : PASS=104 FAIL=0
```

说明：base 执行 84 项、both/accept-only 执行 104 项，差额 20 = 4 值 × 5 条消息派生检查（`path`/含短语/非 typeof 分支/尾值 token/非 E100）——旧实现里四值被放行、`issues.length===0`，这些派生检查按设计被前置分支跳过。**跳过不是绿灯**：契约测试必须在取消息前无条件断言 `ok:false` 与 `issues.length === 1`（T1-AC1-1 的前两条），旧实现因此必然硬红。

35 条 base 失败**全部**属于四值目标断言（validate 四值 ×2 项 = 8；四值消息互异 1；issue 顺序/数量 2；嵌套位 4；写路径同口径 4 值 ×4 类 = 16；闭合写拒 4）= 35，无一例外：

```
FAIL validate {n:NaN} ok:false / 恰 1 条 issue（n=0）
FAIL validate {n:+Infinity} … / {n:-Infinity} … / {n:-0} …（同）
FAIL 四值消息两两互异
FAIL 3 条 issue / 顺序 num→str→bool（旧实现仅 2 条：num 静默放行）
FAIL 数组元素 -0/NaN path / Record 值 path / optional 内层 path / 联合成员位拒绝 + 收窄消息在场
FAIL validatePatch / append / insert / boundary-set × {NaN,+Infinity,-Infinity,-0} 拒 + 消息同字面
FAIL 合法写路径 {四值} 拒（无快照可入观测）
```

证据 2 — **base 侧负控全绿**（49 项）：有限数放行 7；typeof 失配 5 类 ×4 断言 = 20；unknown/null/string/boolean/枚举负控 7；`-0` 尾 token ≠ `0`（旧实现无消息，属 vacuous 项，也在目标实现上真实成立）1；闭包正控 4 值 ×3 = 12；机制锚 2 —— 合计 49，证明断言集对根因敏感而不误伤相邻行为。

证据 3 — **T2 观测链三态**（探针 2，旧实现）：

```
NaN         写路径 -> ok:true 快照 inner.n=NaN | changelog capture=unavailable events=[input-projection-failed]
+Infinity   … capture=unavailable events=[input-projection-failed]
-Infinity   … capture=unavailable events=[input-projection-failed]
-0          写路径 -> ok:true 快照 inner.n=-0  | changelog capture=full digest=f3013f933b9fb80ab6d9…
0（正控）    写路径 -> ok:true 快照 inner.n=0   | changelog capture=full digest=f3013f933b9fb80ab6d9…   ← 与 -0 碰撞
0.5/-1（正控）… capture=full digest 各自互异
```

证据 4 — **基线绿**（实现前，生产源码零改动）：全仓 `pnpm test` = 313 files / 3298 tests passed、Type Errors none；聚焦两包 = 62 files / 1059 tests passed；`pnpm typecheck` exit 0；`pnpm generate --check` exit 0。

证据 5 — **确定性**：探针 1/2/5(both) 各重复 2 次，输出逐字节相同（`diff` 无差异）。

证据 6 — **旧实现红不在错误原因**：探针只调用公共接缝（`parseVfsl`/`evaluate`/`validateLogicalSnapshot`/`validatePatch`/`validateAppendToArray`/`validateInsertIntoArray`/`planMutationBoundary`/`applyMutationAtBoundary` + changelog emitter），无 mock、无超时设置；同一批运行里负控全绿；实现变更点收窄后同一断言集 104/104 翻绿（反事实模拟）。

## 14. Runner trigger evidence

- 根 `vitest.config.ts` L15 `include: ['packages/*/test/**/*.test.ts', …]` → T1/T2 两条路径天然被收录；`typecheck.include: ['packages/*/test/**/*.test-d.ts', …]` 不涉及本契约（无类型面新增）。
- 包级 typecheck 覆盖测试：`packages/vfsl/tsconfig.json` 与 `packages/namespace-diagnostic-log/tsconfig.json` 均 `include: ["src/**/*.ts","test/**/*.ts"]` → 新测试文件同时进入根 `pnpm typecheck`。
- 实测发现：聚焦运行 `vitest run packages/vfsl/test packages/namespace-diagnostic-log/test --typecheck` 已发现两目录 **62 files / 1059 tests**（含 changelog 包从 `@nomicore/vfsl` 导入未收窄代码的既有测试）；CI 侧 `.github/workflows/ci.yml` L76–80 以 `scripts/ci-test-shard.mjs` 分片运行全量 `*/*/test/**/*.test.ts`，L39 `pnpm typecheck`、L147 `pnpm generate --check` 为独立门。
- 新增依赖方向：T2 位于 changelog 包（其 `package.json` 已声明 `@nomicore/vfsl` 依赖，`node_modules/@nomicore/vfsl` 链接在装；`schema-freeze.test.ts` L10 已有导入先例）——不引入反向依赖；T1 只依赖 vfsl 包内公共面。

## 15. Unknowns and blockers（设计自由度与请求，不阻塞契约执行）

- **Q1（建议 SA1 裁决）`contradicts`（硬矛盾判定）是否随收窄同步**：`validate.ts` L322–325 与 L458–464 是同一「number 判定」的两份实现；若只收窄值校验分支，候选过滤仍把四值当作合法 `number` 候选（谓词分叉）。契约只断言「联合成员位拒绝且收窄消息在场」（两种实现都绿），但**建议同步收窄**以满足 ADR 0021 决策 1「number 判定」单谓词与 `packages/vfsl/AGENTS.md` 的 issue 顺序/报告兼容纪律。可观测差异已实测：both → `不匹配任何联合成员（any-of 全拒绝）…` 汇总 + 下钻（2 条）；accept-only → `联合成员 1/2：期望 number（有限数且非 -0），实际 NaN`（1 条）。
- **Q2（边界注记）枚举数值字面量不在收窄面**：`type ROOT = { e: 0 | 1 }` 收 `-0` 经 `===` 命中 `0`（现状 ok:true），`enumContains` 用严格相等（L162–165）。ADR 0021 决策 1 的适用面列举为「裸 number 与 int/range 叶子」，未含枚举字面量；本契约按此不纳入。若 owner 要求枚举分支也 JSON 保真（SameValue），需另行裁决（属范围扩张）。
- **Q3（消息冻结粒度）**：契约冻结 ADR 决策 3 给出的域短语 `期望 number（有限数且非 -0）` + 消息尾值字面量 + 互异 + 非 typeof 分支；整句文案不冻结。若 SA1 认为短语也可解冻，需重议「消息细分正确」的可执行判据（备选：仅尾值字面量 + `实际` 在场 + 互异）。
- **Q4（T2 位置）**：锁定测试置于 `packages/namespace-diagnostic-log/test/`（依赖方向正确、可复用本包 emitter 与 `testing/` 子路径）。若 SA1 要求 vfsl 包自持该测试，需接受 vfsl 测试对 changelog 包的测试期反向导入（仓内已有相对路径导入先例，但会打破包依赖方向纪律）。
- **Q5（零改动锁定的强度）**：当前锁定 = 既有 313/3298 套件 + 指纹 KAT（`compile-schema-envelope.test.ts`）+ `generate --check`。若 SA1 要求「派生两树逐字节快照基线」的更强锁定，需在契约外追加 fixture 哈希（本契约不新增，避免越出 SA6 可写面）。
- **Q6（runtime 端到端层，可选）**：namespace-runtime 级 `mutateData` 写 `-0` 的零写入/文档不变断言（需 registry+persistence+Yjs 装配，且 NaN 已被 S3 拦下，增量仅 `-0`）——任务 AC 未要求，本契约不强制；如 SA4 认为必要可加，属已验证链路的冗余覆盖。
- **无 blocker**：不缺环境、不缺事实、入口真实、复现稳定。

## 16. Temporary diagnostics cleanup

- 临时探针 6 枚（`/tmp/sa6-319/probe1.ts`、`probe2.ts`、`probe3.ts`、`probe4.ts`、`probe5.ts`、`probe6.ts`）、全部输出文件与离仓反事实副本（`/tmp/sa6-319/sim/vfsl-both`、`vfsl-accept-only`、`vfsl-src`）**已删除**（收尾执行 `rm -rf /tmp/sa6-319`，删除后核对不存在）。
- **生产实现零改动**：起点 `git status` 仅三枚 Host 输入 untracked；收尾后为三枚 Host 输入 + 本报告（`wiki/raw/task_issue-319_sa6_contract.md`），`packages/`、`docs/`、`apps/`、`domains/` 无 diff。
- 无服务启动、无后台任务遗留（`pnpm install`/`pnpm test`/`pnpm typecheck`/`pnpm generate --check`/探针进程全部已退出，exit code 均已回收）。
- 报告内嵌探针输出即为证据原件（探针脚本不复留，避免临时诊断物进入交付面）。

## Verdict

**approve** ——
1. **缺口已稳定复现**：旧实现在 validate / validatePatch / append / insert / applyMutationAtBoundary 五面 100% 放行 NaN / +Infinity / -Infinity / -0（探针 A–B4、重复 2/2 一致）。
2. **根因已证实**：`validate.ts` 两处 `typeof` 谓词（L322–325、L458–464）与 ADR 0008 声明值域错位；写路径经 `validateSubtree` 共享同核，单一收窄点即可统一双路径（结构 + 实测）。
3. **契约可执行且对根因敏感**：同一断言集在未修改源码上 49 PASS / 35 FAIL（失败全为四值目标断言），在 ADR 谓词反事实实现上 104/104 绿；负控 49/49 全绿；harness 入口（vitest include + 包 tsconfig）实测真实。
4. **SA8 约束全部落入**：§8「语义收窄例外」条款列为同变更集强制文档交付物（review 门，非字符串断言）；消息锚位/顺序/单条量、冻结面零改动、文本侧 -0 与 int/range 与 seed/直构面排除均写成可验证边界。
5. 无 blocker；`requiresConflictRecheck=true` 的三项复查（消息面、§8 落文、冻结面 diff）已在本契约中给出可核对项。
