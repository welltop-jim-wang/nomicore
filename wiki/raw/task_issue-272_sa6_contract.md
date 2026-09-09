# SA6 诊断与验收契约 — Issue #272 vfsl: resolveSchemaAtPath 路径解析器（ADR 0016）

- 角色：SA6（mabf-sa6）· 阶段 acceptance-contract · 迭代 0
- 任务类型：**feature**（能力缺口 = 公共接缝缺失；契约 = 目标行为验收）
- 报告文件：`wiki/raw/task_issue-272_sa6_contract.md`（本文件）
- 裁决：**approve**（契约可执行、红灯原因真实、负控全绿、测试入口真实）

## 1. Task type and inputs

| 输入 | 位置 | 用途 |
|---|---|---|
| 任务简报 | `wiki/raw/task_issue-272.md` | 「What to build」解析语义 6 条 + AC1–AC4 |
| 冲突门禁报告 | `wiki/raw/task_issue-272_conflict_report.md` | SA8 裁决 clear；下游红线 5 条（红线 1 = InternalError 必须以 throw 逃逸公共面，不得收编进结果联合） |
| 权威母法 | `docs/adr/0016-readdata-semantic-schema-projection.md`（98 行全文） | 签名块、结果联合两枚失败码、投影体四件套、解析语义、docs/aliasDocs 键规约 |
| 写侧对偶 | `packages/vfsl/src/validate-patch.ts`（drillStep L114–178、消息取序 L180–202） | 同构基准：union any-member / Record 槽 / 数组位 / 终态拒绝 / 类型错误分类 |
| 数据形状 | `packages/vfsl/src/derived.ts`（冻结形状 + 文档三表）、`src/evaluate.ts`、`src/index.ts` | ValueSchema 全部种类、docs 键文法、公共入口纪律 |
| InternalError | `packages/vfsl/src/resolve.ts` L26 | 畸形派生物通道先例 |
| Issue comments | REST 读取为空响应 | 无 owner 附加要求（简报与冲突报告同载） |

## 2. Owner comment mapping

Issue comments 经 REST 读取为**空**（无响应内容）——无任何 owner 要求/override 需要并入。契约仅由简报 + ADR-0016 + SA8 冲突报告驱动。

## 3. SA8 constraints

1. **InternalError 通道（红线 1）**：ref 目标缺失必须以 throw 逃逸公共面、不进结果联合、不降级 NOT_FOUND。→ 红契约两枚 throw 断言 + 文件头注释；实现不得加顶层 catch 收编（本契约断言 `.toThrow(InternalError)` + 明确排除联合失败）。
2. **深拷贝边界归属（红线 2）**：vfsl 层返回子树「引用 vs 深拷贝」由 SA1 钉死；AC1 新鲜副本仅覆盖失败 path。→ 契约全部用**内容相等**（toEqual）断言，两方案均绿——不锁实现。
3. **同构不许分叉（红线 3）**：解析不得按值收窄/依赖判别式缓存。→ 契约含「剥光 discriminator 的派生 schema 产生同内容结果」锚 + fixture 注释。
4. **引用精确性（红线 4）**：本文档引用「drillStep」均指 validate-patch.ts 现行实现（其注释引 ADR 0003 §3.3 规则 1，母法 ADR-0003 §3 any-of）。
5. **文档跟进（红线 5，非阻塞）**：`packages/vfsl/AGENTS.md` normative 清单未列 ADR-0016/0016-修订-0008——属实现随行文档位（SA6 不动 docs）。

## 4. Environment and baseline

- Worktree：`/home/wangjian/nomicore-fix-issue-272`；branch `mabf/issue-272`；HEAD `a6b2a79`（docs(adr): ADR 0016 readData 语义 schema 投影 + ADR 0008 D8 修订节）；工作树起点干净（仅任务简报/冲突报告两枚 untracked 输入）。
- Node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7 / typescript 5.9.3；`pnpm install --frozen-lockfile` 成功（65 pkgs）。
- 基线（契约文件加入前）：vfsl 包测试入口可跑（冒烟 evaluate-derived-docs-typecls 8/8 绿）；加入契约后 vfsl 全套 `vitest run packages/vfsl/test` = **29 文件 560 测试绿 + 仅两枚新文件红**（见 §13）。
- 根 `pnpm typecheck`（14 包）：**除新 test-d 的类型级红灯（TS2305 ×3 + 级联 ×3）外零错误**——其余 13 包 + vfsl src 全绿。
- 能力缺口实据：`resolveSchemaAtPath` / `SCHEMA_PATH_NOT_FOUND` / `SCHEMA_PATH_INVALID` / `ReadDataSchemaProjection` 在 packages/apps/domains/tests 全仓源码零命中（SA8 冲突报告同载）；`packages/vfsl/src/index.ts` 无任何读投影导出。

## 5. Positive reproduction（能力缺口证明）

Feature 无运行时故障可复现；可复现的是**能力缺口**与**目标行为矩阵**：

- 缺口：`resolveSchemaAtPath(derived, path)` 不存在于公共入口。最小复现 = 从 `packages/vfsl/src/index.js` 请求该导出 → 运行时报「无此导出」（红契约文件 34/34 以该原因红，见 §13 证据 1）。
- 行为矩阵（目标实现预期，全部由共享 fixture 求值输出固化，见 §12 契约表）：
  - `[]` → `{ok:true, valueSchema: 整棵 ROOT 值子树, aliases: {AssetEntity,Audit,U} 闭包, docs/aliasDocs 切片}`；
  - `['u','x']` → 合成 union 终点（两枚成员 string / array<number>，**无判别式缓存**）；`['assets','img1','url']` → scalar string（Record 正则 + union any-member）；`['assets','img1']` → ref AssetEntity 按名保留 + 闭包 {AssetEntity,Audit}；
  - `['assets','bad key!']` → NOT_FOUND（keyPattern fail-closed）；`['assets']` → Record 子树含 `'<key>'` 槽与 keyPattern 原文；
  - `['notes']`/`['config']` → optional 包装原样保留；`['config','retries']` → 透明展开 scalar number；`['notes','x']` → NOT_FOUND；
  - `['nope']` → NOT_FOUND（封闭对象）；`[0]`/`['keywords','0']`/`['keywords',-1]` → INVALID（形状守卫）；`['attachments',0]` → NOT_FOUND（YPlainArray 终态同构位）而 `['attachments']` → array<string>；
  - 畸形派生物（删 values/aliases 双表目标）→ **throw InternalError**（游走中/终点两态）；
  - docs/aliasDocs 切片键 ⊆ 派生三表键、内容逐字；非空 docs 键集随读路径（脊柱 + 闭包别名内部）精确收敛；递归别名闭包单名终止、JSON 可序列化。
- 每一条的期望值都先经真实求值器输出对账（负控 C2，§6），非纸面推测。

## 6. Negative control（负控全绿，证明红灯非夹具/工具链错误）

`packages/vfsl/test/resolve-schema-at-path-control.test.ts`（11/11 绿；**不 import 目标接缝**）：

- C1 夹具 parse+evaluate ok；五大槽位齐全；index `<key>` 条目 keyPattern 在场。
- C2 期望字面量与派生输出**逐字对账**：values.ROOT/Audit 精确一致；U/AssetEntity 剥判别式后按语义一致；文档三表非空条目全集 == 红契约非空切片全集（`ALL_NONEMPTY_DOCS`/`ALL_NONEMPTY_ALIAS_DOCS`）；markerDocs 全空；ROOT 别名级无注释（设计消歧位）；判别式在场确认。
- C3 写侧对偶（validatePatch 现行实现 = 同构基准的机制性前提）：
  - C3a 写合法路径集 7 条（union 位 / Record+union 位 / 数组元素位 / 别名深位 / optional 整位 / optional 内层 / YPlainArray 整位）→ 红契约对应 ok:true；
  - C3b 「路径不存在」类 4 条（未知字段 ×2 / 标量 leaf 下钻 / YPlainArray 内部）→ 红契约对应 NOT_FOUND；
  - C3c 「路径段类型错误」类 3 条（对象位 number / 数组位 string / 数组位负数）→ 红契约对应 INVALID；
  - C3d 数组越界 = base 运行时判定（不属结构拒绝）——读侧无 base、无越界概念，契约不锁；
  - C3e Record 键 Pattern 失配 = 写侧**值级**拒绝（"Record 键 … 不满足 Pattern 正则"）——读侧 fail-closed 同向（NOT_FOUND）。

## 7. Stability, scale and timing

- 解析器契约为同步纯函数：全部断言单次调用完成；无异步/计时/并发维度。
- 别名闭包递归安全：契约以「自引用别名 → 单名闭包、终止、可序列化」锚定（访问名集去重），并含深拷贝派生上的变异夹具。
- 复现/翻绿路径确定：34 红测试 100% 同因（接缝缺失）；负控 100% 绿。无概率性。

## 8. Root-cause chain / capability gap

Feature 无「缺陷根因」；能力缺口定位如下：

| 层 | 事实 | 证据 | 置信 |
|---|---|---|---|
| 症状 | readData 成功分支无法获得路径语义 schema（ADR-0016 动机） | ADR-0016 §背景 | 高 |
| 直接缺口 | vfsl 无读投影解析函数导出 | 全仓符号零命中；index.ts 无导出 | 高（运行时实证） |
| 上游依据 | ADR-0016 把该能力指派给 `@nomicore/vfsl` 新增公开 API，语义 6 条为明文决策 | ADR-0016 §解析语义/§投影体；SA8 clear | 高 |
| 写侧对偶 | drillStep 已实现（union/Record/数组/终态/消息分类） | validate-patch.ts L114–202 | 高（C3 实测） |
| 未证实假设 | docs 切片算法细节（union `<member N>` 位归属、双表合并序、空条目保留）ADR 未逐字钉死 | ADR-0016 §投影体（类别级描述） | 见 §15 设计决策请求 |

## 9. Causal experiments

1. **判别式无关性实验**：对同一夹具派生做 JSON 克隆后剥光全部 `discriminator` 键 → 契约断言剥后/原样派生在 5 条路径上结果全等（对 union 静态扩展 + 失败路径）。当前无法执行（接缝缺失）——翻绿后为可执行断言；机制依据 = ADR-0003 §3「缺失/存在不改变可观测行为」+ SA8 红线 3。
2. **写侧消息类 ↔ 读侧码映射实验（负控已执行）**：validatePatch 现行实现对 10 条路径的拒绝/放行类别与契约码映射逐条一致（C3a–C3e）——「同一路径写守卫合法 ⟺ 读可解析」的机制性前提在写侧实测成立。
3. **期望字面量实证（负控已执行）**：全部 docs 内容、值子树、keyPattern 解码原文（含 `\-` 转义）经真实求值器输出对账，夹具零漂移（C2）。

## 10. Impact surface

- 新增公共面仅 `@nomicore/vfsl`：index 值导出 `resolveSchemaAtPath` + 类型名目（`ReadDataSchemaProjection` / `ResolveSchemaAtPathResult`——名称按 ADR-0016 签名块锚定）。
- 不动：doc-runtime（读取 schema 无关，ADR-0016 §分层）；namespace-runtime 组合（深拷贝边界/活引用纪律归后续组合票）；registry（仅类型别名跟随）；derived/evaluate/validate-patch 零改动（SA6 亦未改 src——git status 证实）。
- 兼容面：现有 560 vfsl 测试 + 其余 13 包 typecheck 零回归（§13）。

## 11. Ruled-out hypotheses

- 「解析器已存在（他名/他包）」：全仓符号零命中 → 排除。
- 「derived.index 可直接充当解析」：index 是**语法路径**键空间（`ROOT.assets.<key>`），不含运行时段语义（union 静态扩展、optional 展开、keyPattern 实测、终态分类），且 ADR-0016 明示解析与值无关 → 排除（index 仅作派生形状佐证）。
- 「docs 切片无法以既有表表达」：fieldDocs/markerDocs/aliasDocs 键文法（§3 绝对语法路径 + `<item>`/`<key>`/`<member N>` 合成段 + 别名名）实证存在且与投影键同构 → 排除；内容逐字纪律实证成立（C2）。
- 「YPlainArray 值位与写侧终态冲突使契约不可执行」：契约把整位可解析（值语义照常）与内部位不可下钻（NOT_FOUND，写守卫同构）拆成两枚断言；夹具只锚整位 ok + 内部 NOT_FOUND，不锁值/结构树实现路线（§15-Q1）。

## 12. Acceptance contract and test paths

交付物（均为 worktree-relative 新文件；发现入口 = vitest include `packages/*/test/**/*.test.ts` + typecheck `**/*.test-d.ts`）：

| 文件 | 角色 | 契约覆盖 |
|---|---|---|
| `packages/vfsl/test/resolve-schema-at-path-fixture.ts` | 共享夹具/字面量单源 | 夹具文本 + 全部期望字面量（红/负控共用，防漂移） |
| `packages/vfsl/test/resolve-schema-at-path.test.ts` | **红灯契约（34 断言）** | AC1 接缝与结果形状（4）；AC1 失败码 + path 新鲜副本（9）；AC2 union 扩展/合成 union/判别式无关（5）；AC2 Record keyPattern（3）；AC2 optional（5）；AC2 ref 缺失 InternalError（2）；AC3 docs/aliasDocs/闭包（6） |
| `packages/vfsl/test/resolve-schema-at-path-control.test.ts` | 负控/基线（11 断言，现绿） | C1 夹具；C2 字面量对账；C3 写侧对偶矩阵 |
| `packages/vfsl/test/resolve-schema-at-path.test-d.ts` | 类型面红灯（3 断言） | 签名 `(derived: DerivedSchema, path: readonly (string\|number)[])`；判别联合两码；投影四件套；ok 分支无 code（@ts-expect-error） |

关键断言纪律：全部锚定运行时可观测行为（toEqual/内容多集/键集/throw 实例），无源码 grep、无 skip/only/todo、无 env override/fallback；期望值全部先经真实求值器对账（负控 C2）——旧实现（无接缝）在目标断言处失败的原因 = 公共导出缺失（运行时 + TS2305 双重实证），非夹具/超时/入口错误。合成 union 成员**顺序**与 docs **空条目保留**不锁（设计自由度）；判别式在场不锁（剥光比较）。

## 13. Red/green or baseline evidence

证据 1 — 红契约运行（`vitest run packages/vfsl/test/resolve-schema-at-path.test.ts`）：
```
Test Files  1 failed (1)      Tests  34 failed (34)
Error: 红灯基线：vfsl 公共入口 index 尚未导出 resolveSchemaAtPath
（Issue #272 能力缺口 = 接缝缺失；实现公共导出后本断言自动翻绿）
```
34/34 同因红灯；文件顶层不静态 import 缺失名目（动态接缝）→ vfsl 包 tsc 对运行时红文件零报错。

证据 2 — 负控运行（同命令 control 文件）：`Test Files 1 passed`、`11 tests passed`、`Type Errors no errors`。

证据 3 — vfsl 全套（`vitest run packages/vfsl/test`，含 typecheck）：`Test Files 2 failed | 29 passed (31)`、`Tests 36 failed | 560 passed`——2 失败文件 = 本契约红文件 + 类型面 test-d（TypeCheckError：TS2305 ×3 + 级联）；其余 29 文件（含负控）全绿，零回归。

证据 4 — 根 `pnpm typecheck`：14 包中仅 vfsl test-d 报 TS2305 ×3（+ 其级联 3 条）；其余全部通过。类型面翻绿路径已用**同形状模拟模块**（临时 twin 文件置于 test 目录编译后删除）验证：模拟导出存在时 test-d 零错误——确认红灯无潜伏类型错误、SA3 按 ADR 形状导出即全绿。

证据 5 — 类型面级联说明：TS2349/TS2578 三条为 TS2305 对 error 符号的级联噪音，非独立断言缺陷（证据 4 模拟证明）。

## 14. Runner trigger evidence

- 运行入口：根 `vitest.config.ts` `include: ['packages/*/test/**/*.test.ts', ...]`；`typecheck.include: ['packages/*/test/**/*.test-d.ts']`（tsconfig `./tsconfig.typecheck.json`）。
- 包验证门：`packages/vfsl/tsconfig.json` include `src/**/*.ts` + `test/**/*.ts`（typecheck 覆盖测试文件——故 test-d 缺失导入红灯同时作用于包级与根级 typecheck）。
- 实测命令均以上述入口直接发现四枚新文件（§13 各命令输出）。

## 15. Unknowns and blockers（设计决策请求——不阻塞契约执行）

契约在 ADR 未逐字钉死处选择「断言可执行的最小锚 + 不锁自由度」，下列位建议 SA1 显式裁决：

- **Q1 值树 vs 结构树合法性的游走基准**：YPlainArray 值位 = array<string> 而结构位 = 终态 plain。契约锚定「整位可解析、内部位 NOT_FOUND（镜像写守卫『路径不存在』）」——读投影语义不得与写守卫「只能整体替换」分叉（ADR-0016 ⟺ 命题）。实现路线（值树游走 + 结构终态判定 / 结构游走 + 值投影）为设计自由度。
- **Q2 docs 切片算法精确化**：ADR-0016 §投影体为类别级（脊柱 = 沿 P 的键；终端子树后代 = P 之下；闭包别名内部 = 别名名锚定）。契约锚定叶子/别名/深读/整根四类非空键集 + 键文法子集 + 逐字内容不变量；union `<member N>` 位归属、field/marker 同键合并序、空条目是否保留未锁（夹具在相关位上无注释/无同键双非空，断言稳健）。
- **Q3 aliasDocs 是否含 ROOT 别名级注释**：契约以 ROOT 无注释 + 非空过滤器消歧，不锁在场/缺席。
- **Q4 合成 union 成员顺序**：契约以多集断言锁定内容与数量，不锁顺序（确定性仍由纯函数契约要求，具体序属设计）。
- **Q5 返回子树引用 vs 深拷贝**（SA8 红线 2）：契约全用内容相等断言，两方案均绿；报告建议 SA1 依据「derived 不可变契约 + getCompiled 深冻结条目下引用即安全」钉死并写入 JSDoc。
- **Q6 别名内容是否携带判别式缓存**：契约剥光比较（ADR 0003 §3 透明性），不锁在场。
- **Q7 结构/值两树分歧（手造派生物的另一畸形面）**：本契约只锚 ref 缺失（双表同删）；两树分歧的 InternalError 行为建议 SA1 明确是否纳入（validate-patch 先例为 E100 收编，本函数为 throw 通道——两者边界在 ADR「畸形派生物 InternalError」句内）。

无信息不足、无环境缺失：**无 blocker**。

## 16. Temporary diagnostics cleanup

- /tmp 探针脚本 4 枚（derived/值树/写矩阵探测）已删除；类型面模拟 twin 文件 2 枚（zz-sim-*）已删除（编译后即刻清理）。
- `git status`：src/ 零改动（生产实现未触碰）；仅四枚契约文件 + 简报/冲突报告为 untracked 新增。
- 未启动任何常驻服务；无遗留后台任务。

## Verdict

**approve** —— 能力缺口实证（全仓符号零命中 + 34/34 接缝红灯）；目标行为契约全部可执行且期望值经真实求值器对账（负控 11/11 绿 + 写侧对偶矩阵实证）；测试入口真实（vitest include 实测发现）；既有 560 测试与 13 包 typecheck 零回归；SA8 五条红线全部落入契约断言或报告决策请求。
