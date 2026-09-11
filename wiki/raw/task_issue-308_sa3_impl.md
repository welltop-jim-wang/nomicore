# SA3 Implementation Report — issue #308（readData 语义投影 docs 切片并入 memberDocs）

- Dispatch：`sa-3a19d85f-1176-4502-97fa-88eb5d5c939e`（mabf-sa3 / implementation / iteration 0）
- 证据基线：worktree `/home/wangjian/nomicore-fix-issue-308`，分支 `mabf/issue-308`，HEAD `4d4208b`（#306 已合入；起点工作树仅 Host 拥有的未跟踪 wiki 工件）
- 结论：**实现完成、契约红转绿、规定验证全绿**；无阻塞、无越界改动。verdict 未提交（成功路径）。

## Inputs consumed

| 输入 | 位置 | 用途 |
|---|---|---|
| 任务简报 | `wiki/raw/task_issue-308.md`（Issue REST comments `[]`，无附加 Owner 要求） | 需求全集（What to build + AC1–AC3） |
| SA1 设计（iteration 1，SA2 approve） | `wiki/raw/task_issue-308_design.md` | §7-D1（三源合并单点）/D2（选键零改动）/D3（M4-free 逐字节）/D4（窄守卫）/D5（键序）/D6（深读不扩展）/D7（源码注释）/D8（ADR 0016 append-only 增补节）；§10 验证命令；§11 ALLOW/DENY |
| SA2 设计评审 | `wiki/raw/task_issue-308_sa2_review.md`（approve；F-SA2-1 已闭环 + N-1–N-4 + O-1/O-2） | 复核实现是否落实 Required revisions 与观察项 |
| SA6 验收契约 | `wiki/raw/task_issue-308_sa6_contract.md`（approve） | §12.1 fixture 逐字节、§12.2 M1–M9 目标值、§12.3 EXPECTED_DOCS、§12.4 冻结摘要（表 1/2/3）、§12.5 C1–C9 |
| SA8 冲突门禁 | `wiki/raw/task_issue-308_sa8_conflict.md`（clear；F1/F2/F3.1–F3.3） | 约束落实与红线核对 |
| 源码/既有测试 | `packages/vfsl/src/{resolve-schema-at-path,derived,evaluate}.ts`、`packages/vfsl/test/resolve-schema-at-path*.ts`、`evaluate-derived-member-docs.test.ts`、两份既有 fixture、`packages/namespace-runtime/src/read-schema-projection.ts` | 锚点核对、夹具复用（只读） |

无缺失输入；未做设计、评审或冲突裁决。

## Existing worktree reconciliation

- 起点 `git status --short` 仅 5 份 Host 拥有的未跟踪 wiki 工件（brief/design/sa2/sa6/sa8），**无既有 `wiki/raw/task_issue-308_sa3_impl.md`、无未提交实现** → 本报告为新建，无过时实现需修正/删除。
- 未发现与设计冲突的既有改动；生产文件、既有测试、既有 fixture 起点全部为 HEAD 原样（`git status` 收尾复核：既有测试文件零修改）。
- 不涉及 `git add/commit/push`（收尾限制遵守）。

## Changed paths

| Path | Design section | Change |
|---|---|---|
| `packages/vfsl/src/resolve-schema-at-path.ts` | §7-D1/D4/D7（§11 ALLOW 行 1） | `sliceDocs` 增加第三遍扫描 `memberDocs`（条件稀疏键）+ 单点 `merged(k)` 三源合并（field → marker → member 末位）+ 在场畸形的窄 `InternalError` 守卫；L54 接口注释与 `sliceDocs` docstring 措辞同步（合并式、扫描序、条件键缺席语义）。`+41/-9` 行 |
| `docs/adr/0016-readdata-semantic-schema-projection.md` | §7-D8（§11 ALLOW 行 2） | 文件末尾追加 dated 修订节「ADR 0019 修订：docs 切片并入 memberDocs 第三来源（2026-09-11，issue #308）」（授权链 + 三条款 + 保持句）；**正文零改动**，`git diff --numstat` = `20 0`（纯新增） |
| `packages/vfsl/test/resolve-schema-at-path-member-docs-fixture.ts` | §11 ALLOW 行 3；SA6 §12.1/§12.3/§12.4 | 新建 fixture：`M4_TEXT`（逐字节 = SA6 §12.1）、`EXPECTED_DOCS`（23 键 = §12.3）、`M4_CONTRACT_PATHS`（16 路径）、冻结摘要常量（表 1/2/3）、前提常量 |
| `packages/vfsl/test/resolve-schema-at-path-member-docs.test.ts` | §11 ALLOW 行 4；SA6 §12.2 | 新建红契约：前提断言 2 条 + M1–M9（13 个 it）+ D4 辅助断言 2 条（非 SA6 契约项，设计 §10 明示可选）；共 16 tests |
| `packages/vfsl/test/resolve-schema-at-path-member-docs-control.test.ts` | §11 ALLOW 行 5；SA6 §12.5 | 新建负控：C1–C9（9 个 it）+ C9 镜像 M4-free 不变量族 |

副作用覆核：未改 `DerivedSchema`/可信域必填键清单/`index.ts`/`namespace-runtime`/codegen/既有测试/既有 fixture/v1-spec/CONTEXT.md/ADR 0019/0003（`git status` 全量列举见下）。

## SA2 Finding落实

| Finding ID | Implementation | Result |
|---|---|---|
| F-SA2-1（MAJOR，iter 0；iter 1 已闭环） | ADR 0016 只做 append-only：末尾追加 dated 增补节（三条款逐条「旧文 → 新文」登记 + 「除下列明示条款外，正文其余条款维持原文效力（「考虑的备选」节为决策时历史记录）」保持句）；正文 L35–36/L42/L84 一字未动。机械证据：`git diff --numstat` = `20 0`（零删除行）、`git diff --check` 干净 | 落实（设计选项 a） |
| N-1（MINOR） | append-only 下 L84「考虑的备选」旧措辞随全文保留；增补节保持句显式声明该节为决策时历史记录、不随条款改写 | 落实 |
| N-2（MINOR） | 设计锚点修正（`${path}.<member ${i}>`）为插值模板：实现未复制为字符串字面量，`merged()`/第三遍扫描均为类型安全代码 | 无实现面影响（已核对） |
| N-3（MINOR） | 行号锚点为设计文档修正项；实现未新增/移动外部锚点，`sliceDocs` 结构位置保持 | 无实现面影响（已核对） |
| N-4（MINOR，守卫位置偏好） | 守卫留在 `sliceDocs` 内（设计首选）：键缺席短路、路径解析失败时 `sliceDocs` 不被调用；红契约辅助断言「畸形表 + 不可解析路径 → 两码结果联合、不额外 throw」锚定该偏好 | 落实 |
| O-1/O-2（非阻断观察） | 无实现动作（O-1 为引证措辞精度；O-2 为增补节 outline 归属，与 0008 惯例一致） | 记录不处理（非必需） |

## SA8 约束落实

| 约束 | 实现 | 证据 |
|---|---|---|
| C1 三来源 / C3 合并序 | 第三遍扫描 + 单点 `merged(k)`（field → marker → member） | M1–M9；M7 `[' 载体甲 ', ' 成员甲 ']`（JSON 逐字次序断言） |
| C2 选键规则不变 | `want()`、`spine`、终点候选、闭包构造零改动 | M3/M4/M5b/M6（终点子树腿，闭包 `[]`）+ M1/M2/M5a/M8a（闭包别名腿） |
| C4 空条目过滤不变 | `if (content.length > 0)` 三遍一致 | C4（`U.<member 0>` 置空 → 不成键）+ M7（`Mixed.<member 1>` 空合并不成键） |
| C5 四件套形状不变 | 公共类型/结果联合/`index.ts` 零改动 | C7（ok 分支恰 5 键）+ `git status`（index.ts 未改） |
| C6 detached 克隆零改动 | `packages/namespace-runtime/**` 未触碰 | C3/C6 + namespace-runtime 投影测试 21 passed（补充证据） |
| C9 M4-free 逐字节不变 | 条件键缺席 → 第三遍整遍跳过；`merged` 对无 member 键等价旧表达式 | C1（6 路径）/C2（7 路径）/C3（剥离克隆 17 路径）sha256 冻结摘要逐路径相等 + docs 无 `<member ` 键 |
| F1 ADR 0016 回写 | append-only dated 增补节 | 见 SA2 行 + §12 F1 机械判据 |
| F3.1 守卫不得要求 memberDocs | 函数头六键必填清单零改动；仅「在场且畸形」窄 loud | C3/C6（剥离克隆与含表派生物均 `ok:true`）；D4 辅助断言（畸形 → `InternalError`） |
| F3.2 member-only 键插入序 | 第三遍扫描 = 表声明序（evaluate `walkDocs` 成员声明序），逐调用确定 | M8b 用 `toEqual`（键序不敏感）；C1–C3 摘要只涉 M4-free 面 |
| F3.3 合并只在 docs 表层面 | 改动局限 `sliceDocs` docs 分支 | C8（16 路径非 docs 摘要逐路径相等） |

## File scope check

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| `packages/vfsl/src/resolve-schema-at-path.ts` | §11 ALLOW 行 1（唯一待接线消费点） | 第三来源 + 单点合并 + D4 守卫 + D7 注释同步 |
| `docs/adr/0016-readdata-semantic-schema-projection.md` | §11 ALLOW 行 2（末尾追加，正文零改动） | D8 dated 增补节（F1 同票归属） |
| `packages/vfsl/test/resolve-schema-at-path-member-docs-fixture.ts` | §11 ALLOW 行 3（SA6 §12 文件表第 1 行） | 契约 fixture（数据，非 `.test.ts`） |
| `packages/vfsl/test/resolve-schema-at-path-member-docs.test.ts` | §11 ALLOW 行 4（SA6 §12 文件表第 2 行） | 红契约 M1–M9 + 前提断言 + D4 辅助 |
| `packages/vfsl/test/resolve-schema-at-path-member-docs-control.test.ts` | §11 ALLOW 行 5（SA6 §12 文件表第 3 行） | 负控 C1–C9 |
| `wiki/raw/task_issue-308_sa3_impl.md` | 非 ALLOW/DENY 路径；skill 规定的 SA 过程工件（wiki/raw，Host 拥有的工件区） | 本实现报告 |

DENY 核对（`git status --short` 全量输出）：未改 `derived.ts`、`parser/ir/semantic/evaluate.ts`、可信域必填键清单、`packages/namespace-runtime/**`、既有测试/夹具（`resolve-schema-at-path*.ts`、`evaluate-derived-member-docs.test.ts`、`union-member-docs-fixture.ts`）、`index.ts`、`packages/vfsl-codegen/**`、`docs/vfsl/v1-spec.md`、`docs/vfsl/schema-authoring-guide.md`、`CONTEXT.md`、ADR 0019、ADR 0003、ADR 0016 正文（diff 无删除/改写行）。

## Verification

| Command | Result | Evidence |
|---|---|---|
| 实现前：`npx vitest run packages/vfsl/test/resolve-schema-at-path-member-docs.test.ts packages/vfsl/test/resolve-schema-at-path-member-docs-control.test.ts` | **红契约 13 failed / 控制 9 passed**（TDD 红灯基线） | 红：M1、M2、M8a、M3、M4、M5b、M6、M5a、M7、M8b、M9a、M9b、D4-loud（13）；前提断言 2 绿、D4 路径失败联合 1 绿；控制文件 9/9 绿（C1–C9 在旧实现即绿，符合 SA6 §13） |
| 实现后：同两文件 | **25 passed（16 + 9）**，Type Errors 无 | 红契约全绿（M1–M9 + 前提 + D4）；控制全绿 |
| 设计 §10 ①：`pnpm vitest run <6 文件> --typecheck` | **6 files / 80 tests passed；Type Errors 无 errors**（基线 4 files / 55 tests） | 6 文件：既有 red/control/pattern-errors/evaluate-derived-member-docs + 新增红契约 + 新增负控 |
| 设计 §10 ②：`npx tsc -p packages/vfsl/tsconfig.json` | **exit 0** | 包级类型检查（含 test glob） |
| 设计 §10 ③：`pnpm typecheck`（14 个 tsconfig 串行） | **exit 0** | 公共类型未变，根级全量绿 |
| 补充（超设计最低门槛）：`npx vitest run packages/vfsl/test` | **36 files / 644 tests passed；Type Errors 无** | 全包回归；既有文件零修改仍绿（C9 的 runner 面） |
| 补充（零改动消费方）：`npx vitest run packages/namespace-runtime/test/runtime-readdata-schema-projection-{red,control}.test.ts` | **2 files / 21 tests passed** | detached 克隆组合边界零改动成立 |
| 文档面（§12 F1 行）：`git diff --numstat -- docs/adr/0016-...md` / `git diff --check` | **`20 0`（纯新增）/ 干净** | append-only 机械可验；正文 L1–98 无改动 |
| 工作树范围：`git status --short`、`git diff --numstat` | 仅 2 个 M（源码 + ADR）+ 3 个新增测试文件（+ Host wiki 工件） | `packages/vfsl/src/resolve-schema-at-path.ts` `41 9`；ADR `20 0` |

红因复核：红灯全部落在 `docs` 合并处（`valueSchema`/`aliases`/`aliasDocs` 断言在旧实现即通过），与 SA6 §5/§8 能力缺口一致；未以 fallback、env override、skip/only/todo 或源码字符串断言伪造通过。

## Deferred verification

- SA4 / SA7 独立评审与真实环境验收（不属 SA3 范围）。
- 全仓 `pnpm test`、CI（公共类型/协议/wire 面未变；本次已跑全 `packages/vfsl/test` 与 namespace-runtime 投影两文件作补充证据）。
- SA8 F2 集成支中间态（v1-spec §5 / ADR 0016 正文滞后）由 #309 收官（PR #305 收官清单）。
- ADR 0003 回写指针（SA8 F1 对称项）未认领，按设计 §12 残余 1 移交 Controller 钉给 #309/#306 收尾。
- 设计 §13 残余 4：`fieldDocs`/`markerDocs` 在场 mistype 的存量裸 TypeError 加固（独立小票）。
- 设计 §13 残余 3：穿过联合的深读是否携带途经成员 doc（本票显式不做；若纳入需另立票 + SA6 扩契约）。
- SA3 未执行 commit / push / PR。

## Deviations or blockers

无阻塞。实现期两点如实记录（均在设计/契约口径内）：

1. **C4 负控断言按 SA6 §12.5 收窄**：初版在 C4 中额外断言 `U.<member 1>` 在场，导致控制文件在旧实现即红（旧实现不消费 memberDocs）。SA6 §12.5 明示 C4「仅断言缺席；`'U.<member 1>'` 的在场由 M1 锚定」→ 删除该额外断言，控制文件恢复「实现前后均绿」契约性质；presence 由红契约 M1 覆盖（未弱化任何契约断言）。
2. **ADR 0016 增补节条款 3 措辞**：SA1 设计 §7-D8 规格中该句为「不使用 M4 的投影输出逐字\n节不变」（换行断句产生的残句）。按 AC2 原文与设计语义转写为「不使用 M4 的投影输出逐字节不变」，未改变条款语义（其余条款与设计规格逐字一致）。
3. **D4 守卫的 TS 表达**：为在 `exactOptionalPropertyTypes` 下保留「null / 非对象 / 数组」三形谓词而不触发 TS2367，先用 `const rawMemberDocs: unknown = derived.memberDocs` 收窄再断言为 `Record<string, string[]> | undefined`；谓词语义与设计伪代码逐条一致（`null` 显式分支必要且在场）。经 `tsc`（包级 + 根级）验证。
4. **D4 辅助断言**（非 SA6 契约项，设计 §10 明示可选且「不得替代任何 M/C 用例」）：新增 `memberDocs = null/[]/'not-a-record'/42` → `InternalError`，以及畸形表 + 不可解析路径 → 两码结果联合（N-4 偏好锚定）。M/C 用例全部独立存在且未被替代。

## Suggested commit message

```
feat(vfsl): readData 语义投影 docs 切片并入 memberDocs 第三来源 (#308)

- resolveSchemaAtPath.sliceDocs 增加 memberDocs 条件稀疏表第三遍扫描，三源合并
  单点（field → marker → member 末位）；选键规则与空条目过滤不变
- memberDocs 在场但表级畸形 → InternalError（可信域 loud；不加入必填键清单，
  无 M4 的投影输出逐字节不变）
- 同步 L54 接口注释与 sliceDocs docstring（ADR 0019 §7 / 决策 5）
- 新增 SA6 §12 契约：fixture + 红契约 M1–M9 + 负控 C1–C9
- ADR 0016 末尾追加 dated 增补节，登记 ADR 0019 §7 条款级修订（正文零改动）

Verification: 6 files/80 tests green（--typecheck 无类型错误）；npx tsc -p
packages/vfsl；pnpm typecheck（14 tsconfig）；全 vfsl 36 files/644 tests；
ADR 0016 diff +20/-0
```
