# SA9 Standards 审查报告 — Issue #272（vfsl 公开 `resolveSchemaAtPath` 读路径语义 schema 解析，ADR 0016 实施票）

> SA9（独立 Standards 审查者）standards-review 轮产物。dispatch
> `sa-0682001e-4c83-4273-a76f-904e4ce447fd`，phase standards-review，iteration 0。
> **Worktree**: `/home/wangjian/nomicore-fix-issue-272`（branch `mabf/issue-272`）。
> **被审对象**: HEAD `de5633c`（实现提交）的完整交付 diff `a6b2a79..de5633c`——16 文件
> +2695/−6（git diff --stat 本轮亲证）；工作树除 SA4 工件（untracked
> `task_issue-272_sa4_review.md`）外干净。
> **母票状态**: PR #271（docs/adr-0016-readdata-schema）head
> `a6b2a792ff91611621afb2981d9919e530ce1ca8` 为本分支基线（git log 亲证 a6b2a79 即
> HEAD 的父提交），ADR-0016 全文 + ADR-0008 修订节 + CONTEXT.md 两词条均已在仓。
> **Issue 评论输入**: dispatch 明示 REST 已读 = 空响应（无 Owner 追加要求）；简报 §Comments、
> SA6 §2、SA8 报告与复审、SA2 §4、SA4 §3 六处一致同载——本轮无一遗漏面。
> **输入产物（全部亲读）**: `task_issue-272.md`（简报）、`task_issue-272_design.md`
> （SA1 迭代 1，SA2-F1 修订版，482 行全文）、`task_issue-272_sa2_review.md`
> （approve）、`task_issue-272_sa3_impl.md`、`task_issue-272_sa4_review.md`
> （approve，0 BLOCKER/MAJOR，O1–O5 MINOR）、`task_issue-272_sa6_contract.md`
> （approve）、`task_issue-272_conflict_report.md`（clear）、
> `task_issue-272_conflict_recheck.md`（clear，`requiresConflictRecheck:false`）、
> ADR-0016 全文（98 行）、`packages/vfsl/AGENTS.md`（含本次新增例外句）、根/docs
> AGENTS.md、新模块 464 行全文、五枚测试文件全文、三枚 src diff 逐 hunk。
> **审查方式**: 独立取证，非结论复用——全部源码锚点亲验（drillStep/valueLens/guardWalk
> 文案、walkDocs 键文法、pattern.ts 四类错误、validate.ts emitPatternError 分支形状、
> index.ts matchPattern no-op charge 先例、tokenizer 标识符字符集）+ 定向 grep
> （discriminator 零读、skip/only/todo 零命中、async 零命中）+ 断言计数清点（34+11+3+4）
> + SA2 行号锚在契约文件逐一对命中。未运行测试、未启动服务（SA9 纪律）；零代码/设计/
> 测试改动；零 commit/push/PR；唯一写入 = 本文件。
> **职责面**: 只判断实现是否符合仓库 AGENTS、ADR、模块责任、既有架构惯例、单一事实源、
> 生命周期对称性、文件范围与测试质量标准；Issue 需求完整实现归属 SA10。

---

## Verdict

**approve**（`requiresConflictRecheck: false`）

- **0 BLOCKER / 0 MAJOR**。当前交付 diff 在包边界与 AGENTS 链、ADR 合规、模块责任、
  架构惯例、单一事实源、生命周期对称性、文件范围、测试质量八个 standards 面全部合规
  （§1–§8）。
- SA4 批准的 5 枚 MINOR（O1–O5）经本轮独立复核均定性准确、无一升级为 standards 阻断项
  （§9 逐条复核）。
- 流程面合规：SA8 前置 clear + 设计后复审 clear、SA2 approve（SA2-F1 修订落实）、SA6
  契约 approve 且四文件零篡改、SA4 approve——审查链完整，无跳级、无未决阻断项。

---

## 1. 包边界与 AGENTS.md 链（根 / docs / packages/vfsl）

| 规约 | 本轮亲证 | 判定 |
|---|---|---|
| 「Add public API only through `src/index.ts`」（包 Boundaries） | 新增公共面 = index.ts 导出块一处（`export { resolveSchemaAtPath }` + `export type { ReadDataSchemaProjection, ResolveSchemaAtPathResult }`，diff 纯追加、既有导出逐字节不变）；`drillStep`/`DrillResult`/`structureLens` 仅模块级导出（validate-patch.ts diff 亲证：三处 `export` 关键字 + 复用注释，未进 index——grep 亲证 index.ts 零命中） | ✅ |
| 「parser/evaluator/validators 同步确定性」 | 新模块 grep 零 `async`/`await`；全部状态调用局部（regexCache/spine/ctx 每次调用新建） | ✅ |
| 「Public malformed-input paths return discriminated results rather than throwing」+ 新增显式例外句 | 敌意通道 path → 判别联合两码（L94–101/L138/L158）；可信域 derived 畸形 → `InternalError` throw——AGENTS.md Boundaries 同变更集补入 ADR-0016 显式例外句（含 keyPattern 引擎四类错误 fail-closed 对偶句），normative 清单补 ADR-0016（含 0008 D8 修订节指引）——SA8 红线 5 逐字落实 | ✅ |
| 「Stable error codes / path reporting 为兼容行为」 | 失败码两枚取自 ADR-0016 签名块；path 回显 `[...path]` 全量新鲜副本（validate-patch 同款先例的加法严格化） | ✅ |
| 根 AGENTS「Before changing files under packages/ read nearest nested AGENTS.md」 | 包 AGENTS.md 被遵守且被随票更新（非绕过） | ✅ |
| docs/AGENTS.md「wiki/raw 工件是证据非规范」「代码行为变更须同步更新规范文档」 | 规范面更新 = 包 AGENTS.md 一处（与行为变更同 diff）；ADR/CONTEXT 属母票 PR #271 已在基线落仓（本票 DENY 正确不触） | ✅ |

## 2. ADR 合规（ADR-0016 为直接母法，逐条亲证）

| ADR-0016 明文 | 实现落点 | 判定 |
|---|---|---|
| 签名块 `(derived, path: readonly (string\|number)[]) → ResolveSchemaAtPathResult`，两码逐字 | 新模块 L89–92 + L61–68；test-d `parameter(1).toEqualTypeOf<readonly (string\|number)[]>` 与签名精确一致 | ✅ |
| union 静态 any-member 扩展、与 drillStep 同构（写合法 ⟺ 读可解析）；合成 union 无判别式缓存、合法 ValueSchema 形状 | 结构侧逐字复用 `drillStep` 本体（L136）；值侧 union 全成员 0 基展开（L279–284）；合成节点恰两键 `{kind,members}`（L170–172）；全模块零 `discriminator` 读（grep 亲证仅注释两命中） | ✅ |
| 解析与实际值无关、不按判别式收窄 | 契约「剥光判别式 5 路径全等」断言在案（test L303–316）；负控 C2 判别式在场确认 | ✅ |
| Record keyPattern 正则实测、不匹配 → NOT_FOUND（fail-closed） | `acceptRecordSlot` L298–335：失配与引擎四类错误同标记内容级拒绝；`['r',7]` INVALID 形状隔离（D8 分类先于且独立于 keyPattern 判定，L359–369） | ✅ |
| optional 游走透明展开、返回子树原样保留 | 规范化解包路径不变（L228–231）；出候选收原始字段值（L258 emitValue 收 `f.value` 原样） | ✅ |
| ref 目标缺失沿 validate-patch 先例抛 InternalError、不进结果联合 | 值游走 L235 + 闭包 L403 两态 throw；全文唯一 try/catch 为 acceptRecordSlot 单层局部（无顶层 catch——红线 1）；文案 `值树未声明别名:`/`值树引用环:` 与 valueLens（validate-patch.ts L80–81）逐字节一致（亲证） | ✅ |
| docs/aliasDocs 键规约与文档三表完全同构（§3 绝对语法路径 + 合成段） | 语法路径生成与 evaluate.ts `walkDocs` L356–401 逐字镜像（本轮逐行比对：字段 `.${name}`、`<member ${i}>` 0 基、`<item>`、`<key>`、ref 终态不穿越 + 锚名切换）；切片键三类别（脊柱/终点子树后代/闭包别名内部）= ADR §投影体原文 | ✅ |
| 纯函数、同步、零 memo、结果联合拒绝 | 零模块状态（grep 亲证）；per-call 局部正则缓存仅成功产物（镜像 compileOrCache 纪律）——不构成跨调用 memo（SA8 复审第 8 项同载） | ✅ |
| 载体结构树不进载荷 | 投影四件套纯 ValueSchema 域；ok 分支恰五键 | ✅ |
| ADR-0003 §3 any-of / §4 ref 按名保留 / 判别式透明 | 见上各条；闭包别名表 = 传递闭包名集去重（递归别名终止、JSON 可序列化，test L487–498 锚定） | ✅ |
| ADR-0008 修订后 D8（derived 只经 readData 投影深拷贝进公共面） | vfsl 层返回引用 + JSDoc 双落点声明共享节点与深拷贝归属（模块头 L27–31 + 函数 L85–87 + index 导出块注释）；本票不抢先承接 runtime 组合——分层纪律合规 | ✅ |

引擎四类错误通道（throw → 内容级 fail-closed NOT_FOUND）为 SA2-F1 修订面：ADR 未规定、
设计 D7 钉死、方向向 ADR-0016「fail-closed」明文与简报 NOT_FOUND 定义收敛——SA2 迭代 1
复核与 SA8 复审预先裁决均认定不新增冲突面，本轮独立核验其事实链（parser §9.1 推迟合法性
/semantic·evaluate 原文透传/validate.ts L256–280 值级先例）属实，合规成立。

## 3. 模块责任

| 行为 | 应有 Owner | 实际落位 | 判定 |
|---|---|---|---|
| 读路径语义解析 | `@nomicore/vfsl`（ADR-0016 明文指派） | 新模块 `src/resolve-schema-at-path.ts` | ✅ |
| 路径合法性判定（⟺ 写侧半张脸） | validate-patch `drillStep`（既有事实 Owner） | 复用本体、零分叉（红线 3） | ✅ |
| keyPattern 判定引擎与错误分类语义 | pattern.ts 引擎 + validate.ts 分类先例 | `compile`/`match` 复用 + `instanceof` 四类镜像 emitPatternError 分支形状（L338–345 对 L256–268，本轮逐一比对） | ✅ |
| 深拷贝边界 | namespace-runtime 组合票 | 显式外移 + follow-up #1 硬约束传承（设计 §13）；本票未裁撤 | ✅ |
| doc-runtime / namespace-runtime / registry | 本票非目标 | 三包零触碰（diff 实证） | ✅ |

## 4. 既有架构惯例

- **包内跨模块消费先例**：`drillStep`/`DrillResult`/`structureLens` 模块级导出不进公共面，
  沿 resolve.ts→validate-patch.ts、validate.ts→validate-patch.ts 同款先例；导出块注释
  明示「包内复用、非公共 API」。✅
- **错误文案先例复用**：root/ROOT 守卫文案与 guardWalk L318 / descendValues L481 逐字一致
  （亲证）；ref 链文案与 valueLens 逐字节一致。✅
- **「while 循环算法恰一份」纪律**：值侧 ref 解析未新造链算法——候选规范化内逐跳 +
  in-flight 名集（drillStep.expand 先例），walkRefChain 仍全仓恰一份。✅
- **no-op charge 先例**：`match(compiled, seg, () => {})` 与 index.ts `matchPattern`
  L93–95 同款（亲证先例在案）。✅
- **引用精确性（红线 4）**：模块头与匹配分支注释带出处限定词（「issue #53 §3.3 规则 1，
  母法 ADR-0003 §3」/「键 Pattern 属值级：validate-patch.ts 注释口径」）。✅
- **wiki/raw 工件随实现提交**：与仓库惯例一致（SA4 引 d7098ed 先例；本目录 task_228_*
  全套同款）。✅

## 5. 单一事实源

| 事实 | 权威源 | 派生方式 | 漂移风险 |
|---|---|---|---|
| 路径合法性 | `drillStep` 单一实现 | 读侧零复制判定（模块级导入调用） | 无 |
| 值语义/别名/文档三表 | derived 冻结形状（未触） | 切片 = 表扫描 + 前缀匹配，键不发明、内容逐字；前缀安全性亲证——tokenizer 标识符 `[A-Za-z][A-Za-z0-9_]*`（tokenizer.ts L53–59）与合成段 `'<key>'/'<item>'/'<member N>'` 均不含 `.`，`p + '.'` 前缀无假阳 | 无 |
| 语法路径文法 | evaluate.ts `walkDocs` | 文本逐字镜像（实现注释明示出处）；契约 ⊆ 不变量 + 键集断言兜底 | 低（设计 R1 自登，本轮逐行比对无漂移） |
| 引擎错误身份/预算 | pattern.ts 四类 + matchBudget | `instanceof` 精确识别，无平行分类语义 | 无 |

无第二事实源、无镜像状态、无 marker 文件、无标签反推。

## 6. 生命周期对称性

纯函数、零资源分配、零订阅、零后台任务——对称性平凡满足；失败即返回判别联合或 throw，
无部分状态逃逸、无需清理面；per-call 正则缓存随调用栈生灭。✅

## 7. 文件范围（ALLOW/DENY 逐条对账，git diff 实证）

| 类别 | 路径 | 对账 |
|---|---|---|
| ALLOW-1 | `packages/vfsl/src/resolve-schema-at-path.ts`（新建 464 行） | §8 全部算法唯一载体 ✅ |
| ALLOW-2 | `packages/vfsl/src/index.ts`（+11） | 导出块 + JSDoc；既有导出逐字节不变 ✅ |
| ALLOW-3 | `packages/vfsl/src/validate-patch.ts`（+16/−6） | 逐 hunk 亲证：仅三处 `export` 关键字 + 复用注释，零行为改动 ✅ |
| ALLOW-4 | `packages/vfsl/AGENTS.md`（+3/−1） | normative 清单 + Boundaries 例外句（红线 5）✅ |
| ALLOW-5 | `packages/vfsl/test/resolve-schema-at-path-pattern-errors.test.ts`（新建 119 行） | SA2-F1 验收锚（三枚确定性夹具 + 红线 1 共存对照）✅ |
| SA6 交付物 | 契约四文件（fixture 181 / 红 499 / 负控 223 / test-d 66） | 全部纯新增（diff −0）；SA2 迭代 1 行号锚（L70–86/L174–177/L303–316/L373–396）本轮逐一亲证精确命中——实现未反改契约 ✅ |
| 流程工件 | `wiki/raw/task_issue-272*.md` ×7 | 仓库惯例 ✅ |
| DENY | derived.ts / resolve.ts / evaluate.ts / validate.ts / pattern.ts / parser.ts / semantic.ts / 其余 packages / docs/adr/** / CONTEXT.md / 根配置 / domains / apps / tests | 零触碰（diff 实证）✅ |

无 ALLOW 外扩张、无 DENY 越界、无 ALLOW 漏项。

## 8. 测试质量标准

| 标准 | 亲证 | 判定 |
|---|---|---|
| 行为锚定（非源码文本/grep 断言） | 全部断言为 toEqual 全等/键集/多集/throw 实例/类型投影；红契约文件头明示「不读源码、不 grep 文本」 | ✅ |
| 无 skip/only/todo | grep 亲证五枚新测试文件零命中 | ✅ |
| 发现入口真实 | 根 vitest include `packages/*/test/**/*.test.ts` + typecheck include `**/*.test-d.ts` + 包 tsconfig `src`+`test` 覆盖 + CI 分片磁盘枚举（SA4 §1 已核，本轮对配置亲证一致） | ✅ |
| 红灯原因真实、翻绿机制诚实 | 动态接缝（L70–86）使红灯 = 接缝缺失运行时实证；SA6 证据 4 同形状模拟模块预先验证翻绿路径 | ✅ |
| 期望值与真实求值器对账 | 负控 C2 逐字对账三表/值树字面量；fixture 注释与字面量单源 | ✅ |
| 负控不 import 目标接缝 | 负控文件仅经 parseVfsl/evaluate/validatePatch 公共接缝 | ✅ |
| 计数一致性 | 本轮清点：红 34（4+9+5+3+5+2+6）+ 负控 11（1+5+5）+ test-d 3 + pattern-errors 4——与 SA6 §12/SA2 §1/SA4 §1 实数全部吻合 | ✅ |
| SA2-F1 新增锚质量 | 三枚夹具各含 parse+evaluate ok 前置 + 值树 keyPattern 携带断言 + NOT_FOUND/INVALID 双断言 + 第 4 测红线 1 共存对照；夹具可达性经源码核验（SA2 §12、SA4 §9 同载，本轮抽验 `Pattern<"[">` 编译失败链属实） | ✅ |

## 9. 上游 MINOR 观察独立复核（O1–O5）

| ID | 本轮复核 | 定性 |
|---|---|---|
| O1 通道纯度声明覆盖面 > 守卫覆盖面（null 值表键可泄漏裸 TypeError） | 属实：L106–117 仅查键在场，`{structure:null,…}` 在 L118 处会裸抛；设计 §8.2 原文同构缝隙（实现不劣于设计）。可信域入参 + 措辞级，AGENTS.md 例外句枚举（missing ref targets/cycles/divergence/missing root-ROOT）未虚张覆盖——无正确性/安全影响 | MINOR，不阻断 |
| O2 aliasDocs 空条目过滤偏离设计字面 | 属实（L461 `arr.length > 0`）；SA6 §12 显式不锁、契约全经 `nonEmpty()` 断言——两取向均绿，方向与 D2 噪声治理一致 | MINOR（显式自由度内钉定），不阻断 |
| O3 SA3 报告计数口径 ±1（600 vs 601） | 属 SA7 活链路复跑核对项（SA4 §11 行 2 已路由）；静态清点两侧计数均自洽 | MINOR，不阻断 |
| O4 AGENTS.md 例外句 ADR-0016 前缀覆盖面 | 现文未把引擎错误通道伪称 ADR 明文（前缀覆盖可信域例外整体）；设计 §7-D7 修订史在案可澄 | MINOR，不阻断 |
| O5 in-flight 作用域 = 单次候选规范化 | 亲证落实（L224 每次调用新建 inFlight；union 成员递归各自作用域） | 正向确认 |

## 10. 结论重述

- **Verdict：approve**。实现与批准设计（SA1 迭代 1）、SA6 契约、SA8 五条红线、SA2-F1
  修订要求在 standards 全部八面逐条对位成立；本轮全部结论独立取证（源码锚点亲验、
  diff 逐 hunk、断言计数清点、定向 grep），非复用 SA4 结论。
- `requiresConflictRecheck`：**false**——实现未引入设计之外的新语义面（守卫完备化为
  更保守加严、aliasDocs 空过滤在显式解锁自由度内），ADR 合规面与 SA8 已复审版本一致。
- MINOR 观察 5 枚均不阻断；动态验证余项（计数口径复跑、D7a 可选探针、BudgetExceeded
  可选探针）归 SA7 活链路终验，不属于本 standards 轮的阻断面。
