# 冲突门禁报告 — Issue #272 vfsl: resolveSchemaAtPath 路径解析器（ADR 0016）

## 任务标识

- 任务：Issue #272 — `@nomicore/vfsl` 新增公开同步纯函数 `resolveSchemaAtPath(derived, path)`（feature）
- 简报：`wiki/raw/task_issue-272.md`（Issue 正文快照，AC1–AC4 同源；Issue comments 经 REST 读取为空——无 owner 要求需要并入）
- Worktree：`/home/wangjian/nomicore-fix-issue-272`（branch `mabf/issue-272`，HEAD `a6b2a79`）
- 阶段：前置冲突门禁（SA1 派发前）
- 裁决人：SA8 Conflict Gatekeeper
- 权威母法：ADR-0016《readData 语义 schema 投影》（2026-09-09，已接受；本任务的直接授权决策）

## 检查范围

- 冲突基准：`docs/adr/` 全集 **14 个文件（编号 0001–0012、0014、0016；0013/0015 不存在——仅 `wiki/raw/` 历史工件出现过编号引用，按 docs/AGENTS.md 属证据非规范）** 逐个核读 + 根目录 `CONTEXT.md` 全读（173 行，含 ADR-0016 Consequences 要求的「Data」词条修订与「语义 schema 投影」新增词条——均已落地）。
- 被审对象：任务简报「What to build」解析语义 6 条 + Acceptance Criteria 1–4 全文。
- 辅助核验（不构成独立冲突基准，按 ADR 收录关系核验落地载体）：`packages/vfsl/AGENTS.md`（包边界与验证门）、`packages/vfsl/src/derived.ts`（DerivedSchema/ValueSchema 冻结形状 + 文档三表 + §3 路径文法）、`packages/vfsl/src/validate-patch.ts`（drillStep 写侧路径守卫先例 + InternalError→E100 崩溃边界先例）、`packages/vfsl/src/resolve.ts`（InternalError 类）、`packages/vfsl/src/index.ts`（公共入口纪律）、根 `package.json`（typecheck/test 门）。
- 被 superseded 的条款不计入约束：ADR-0007 的 open/read 编排与 schema-aware read（被 ADR-0008 取代）；ADR-0008 的 D8 封口原句（被 ADR-0016 修订节改写——修订节已在仓，commit `a6b2a79`）；ADR-0009 的 `(owner.userId, namespaceId)` Registry key 旧条款（被 ADR-0010 取代）。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19/08-21 修订） | 否 | 任务不触及 schema 文本/信封/方言冻结；resolver 消费求值器产出的派生物，SSOT 链路不变；无冲突 |
| ADR-0002 | 全新重写，authority 出范围 | accepted | 否 | 不涉及旧 authority 规则；无冲突 |
| ADR-0003 | 求值器与派生 schema | accepted | 是（同构伙伴） | §3 联合 any-of「任一成员出现即存在」+ §4 ref 按名引用不内联展开——简报 union any-member 扩展与 ref 按名保留的母法；§1 evaluate 公共导出使 derived 本已是 vfsl 包公共数据形状；无冲突 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否（反向确认） | D3「纯类型零运行时、不进引擎包」——本 API 是引擎包运行时纯函数，归属与 ADR-0016 一致，不侵入协议包辖域；无冲突 |
| ADR-0005 | 投影生成管线 | accepted | 否 | 不触及 SchemaSource/生成器/codegen；无冲突 |
| ADR-0006 | 持久化 DocPersistence | accepted（含修订节） | 否 | 不触及持久层；无冲突 |
| ADR-0007 | 逻辑校验与 Yjs Runtime Bridge | accepted（open/read 条款被 ADR-0008 取代；含 #237 修订节） | 是（写侧对偶） | #237 修订的路径级/边界级写校验是读投影「同构」命题的写侧另一半——读侧 keyPattern 正则 fail-closed 与写侧值级键校验端到端互补（见冲突点说明 5）；残余零写入/observer 条款无交集；无冲突 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93/#132/#237 镜像 + **ADR-0016 修订节**） | 是（D8 封口） | D8 已由修订节改写为「derived 只经 readData 语义 schema 投影的受控只读深拷贝进入公共面」——本任务在 vfsl 层提供纯解析器、不递出 runtime 活引用，正是该修订的实施前提；读取 schema 无关、不进 sequencer、失败通道三不变均不被触碰；无冲突 |
| ADR-0009 | Registry、租约与 Host 生命周期 | accepted（含 #131/#134/#161 修订） | 否 | ADR-0016 将 lease 侧定为「仅类型别名跟随」且属后续组合票；本任务不触 registry；无冲突 |
| ADR-0010 | Hub/Peer 复制 | accepted（含修订节） | 否 | raw 复制例外对应 runtime 组合层的 `schema: null` 情形，不在本票辖域；无冲突 |
| ADR-0011 | 诊断变更日志 | accepted | 否 | 「诊断日志不涉及读面」（ADR-0016 明示）；无冲突 |
| ADR-0012 | 实例身份与 WS plugin 所有权 | accepted | 否 | 无交集；无冲突 |
| ADR-0014 | VFSL 校验 JSONL 与 framed sidecar 日志格式 | accepted（含首切片 amendment） | 否 | 无交集；无冲突 |
| ADR-0016 | readData 语义 schema 投影 | accepted | **是（直接母法）** | 简报为其「解析语义」节的逐条实施票：公开 API 签名、两枚失败码、union any-member 扩展与合成 union 终点、keyPattern fail-closed、optional 透明展开/返回保留、ref 缺失 InternalError、docs/aliasDocs 三表同构、同步纯函数零 memo——全部为该 ADR 明文决策；无冲突 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 无冲突项（hard-violation 0 / override-declared 0 / 需 owner 裁决的演进项 0） |

无冲突项。逐条对照说明（非冲突，供 SA1/SA2 参考）：

1. **公开 API 落位 `@nomicore/vfsl` 引擎包 vs ADR-0016 §解析语义 + ADR-0004 D3 + ADR-0003 §1**：ADR-0016 明文「`@nomicore/vfsl` 新增公开 API `resolveSchemaAtPath(derived, path)`」；ADR-0004 D3 的「不进引擎包」约束的是 vfsl-protocol 纯类型包，反向确认运行时函数归引擎包；ADR-0003 §1 使 `evaluate` 公共导出 derived——derived 作为 vfsl 公共数据形状自 #20 起既定。裁决 no-conflict。
2. **签名 `resolveSchemaAtPath(derived, path)` 以 DerivedSchema 为公共入参 vs ADR-0008 D8 封口（经 ADR-0016 修订）**：修订后 D8 约束的是 **NamespaceRuntime 的活 activeTools.derived**「只经 readData 投影深拷贝进入公共面」——本函数是 vfsl 层对调用方自备 derived 的纯解析工具，ADR-0016 自身即如此规定；runtime 侧「活引用绝不递出」的深拷贝纪律属 namespace-runtime 组合票（ADR-0016 §分层与兼容面），本简报正确地未越界承接。裁决 no-conflict（表面张力已由 ADR-0016 修订节消解）。
3. **结果联合两枚失败码 + path 回显新鲜副本 vs ADR-0016 签名块**：`SCHEMA_PATH_NOT_FOUND`（无候选接纳）/`SCHEMA_PATH_INVALID`（非数组/野段形状守卫）逐字同源；码域与 runtime 读失败通道（`PATH_NOT_ALLOWED`/`RUNTIME_READ_DISABLED`）分离，与 CONTEXT「语义 schema 投影」「null 不是读的失败」一致；path 回显新鲜副本是包内 path-reporting 兼容行为（validate-patch `[...path]` 先例）的加法严格化，无 ADR 条款禁止。裁决 no-conflict。
4. **union 静态 any-member 扩展 + 终点多候选合成 union 节点 vs ADR-0016 + ADR-0003 §3**：any-of 语义（「任一成员出现即存在」）为 ADR-0003 §3 原文；合成 `{kind:'union', members}` 无判别式缓存仍是合法 ValueSchema 形状（derived.ts L48；判别式缓存「缺失/存在不改变可观测行为」纪律由此保持）；「与写侧 drillStep 同构、同一路径写合法 ⟺ 读可解析」为 ADR-0016 明文命题，写侧锚点在 `validate-patch.ts` drillStep（L154–157，注释引 ADR 0003 §3）。裁决 no-conflict。
5. **Record keyPattern 读侧正则实测 fail-closed vs ADR-0016 + ADR-0007 #237 修订**：ADR-0016 逐字决策；写侧 drill 对 Record 键段不验 Pattern（「键 Pattern 属值级」，validate-patch L137 注释）但写入值在最近必要语义边界按值域校验键——读侧 fail-closed 与写侧值级校验端到端互补，⟺ 同构在完整写校验层面成立（raw 复制越界数据归 `schema: null` 三情形之一，ADR-0010 例外由组合层吸收）。ADR 内部自洽。裁决 no-conflict。
6. **optional 游走透明展开、返回子树原样保留 vs ADR-0016**：逐字同源；ValueSchema 有 `optional` 包装种类（derived.ts L52）。裁决 no-conflict。
7. **ref 目标缺失抛 InternalError、不进结果联合 vs ADR-0016 §解析语义**：逐字同源（「可信域契约，不进结果联合」）；`InternalError` 类已存在（resolve.ts L26）。⚠ 设计注记（非冲突）：既有公共面（validateLogicalSnapshot/validatePatch/getCompiled 等）均为「顶层崩溃边界收编 E100、公共面不抛错」形态——validate-patch 的 InternalError 实际经 `run()` 收编为联合内 E100 issue（validate-patch L567–573）；ADR-0016 对本函数显式选择「抛出、不进联合」，属 ADR 对包级惯例的有意偏离（ADR 优先于 issue 级设计惯例；无任何 ADR/CONTEXT 条款要求 vfsl 公共函数一律不抛——「公共畸形输入路径返回判别联合」的 AGENTS.md 边界针对敌意公共输入，`derived` 属可信域）。实现不得为贴合惯例给本函数加吞掉 InternalError 的顶层 catch（那将违反「不进结果联合」）。裁决 no-conflict（含下游红线）。
8. **docs/aliasDocs 切片键与文档三表同构 + 别名传递闭包（含递归别名不发散）vs ADR-0016 §投影体 + ADR-0003 §4**：三表 `aliasDocs/fieldDocs/markerDocs` 与「§3 绝对语法路径 + `'<item>'/'<key>'/'<member N>'` 合成段」文法均为 DerivedSchema 既有冻结形状（derived.ts L79–83）；传递闭包别名表递归安全是 ADR-0016 对「内联展开所有 ref」被否方案的直接推论，ref 按名保留 + E106 无环保证终止性（ADR-0003 §4）。裁决 no-conflict。
9. **同步、纯函数、零 memo、结果联合拒绝 vs ADR-0016 + 包 AGENTS.md**：ADR-0016 明文「符合 vfsl 包边界」；AGENTS.md「parser/evaluator/validators 同步确定性」纪律同向。裁决 no-conflict。
10. **AC1 经包 index 导出 / AC4 包测试与 typecheck 绿 + 根仓无回归 vs 包 AGENTS.md**：「公共 API 仅经 `src/index.ts`」（AGENTS.md Boundaries）与「公共类型变更跑根 `pnpm typecheck` + `pnpm test`」（AGENTS.md Verification）逐条对应；根脚本已核在（package.json L11–13）。裁决 no-conflict。
11. **本票不触 doc-runtime/namespace-runtime/registry vs ADR-0016 §分层与兼容面**：`readLogicalValueAtPath(doc, path)` 不变、组合属 namespace-runtime 后续票、registry 仅类型别名跟随——简报范围（vfsl only）与分层决策一致，未抢先实现组合层。裁决 no-conflict。
12. **载荷不含载体结构树 vs CONTEXT「ROOT」/「结构树」+ ADR-0016「载体结构树不进入载荷」**：简报投影体=值语义子树+别名表+文档切片，无 StructureNode——与「实现词汇不进普通 namespace 消费接口」一致。裁决 no-conflict。

## 就绪度评估

- **文档前置已全部落地**（commit `a6b2a79`，即本分支 HEAD）：ADR-0016 全文、ADR-0008「ADR 0016 修订节」（D8 封口改写 + readData 成功分支形状 + 三不变声明）、CONTEXT.md「Data」词条修订与「语义 schema 投影」新增词条均在仓。母票 PR #271（docs/adr-0016-readdata-schema）的产物齐备。
- **实现锚点齐备**：写侧同构伙伴 `drillStep`（union 展开/Record `'<key>'` 槽/数组元素位）、`InternalError` 类、文档三表与合成段文法、ValueSchema 全部相关种类（object+keyPattern/union/optional/ref）均已在 `packages/vfsl/src/` 在案，可直接对齐测试。
- **无碰撞**：`resolveSchemaAtPath`/`ReadDataSchemaProjection` 在 packages/apps/tests 全仓无任何既有实现或半成品；分支干净（无未提交变更）。
- **验证门可用**：`packages/vfsl` typecheck 脚本、根 `pnpm typecheck`（覆盖 vfsl）、根 `pnpm test`（vitest --typecheck）均可执行；包内现有 28 个测试文件提供回归基线。
- **Issue comments 为空**（REST 读取确认）：无 owner 附加要求、无 override 声明、无范围收敛指令需要并入。
- 结论：**就绪，可立即派发 SA1**（简报自评「Blocked by: None」成立）。

## 结论

- Verdict 为 **clear**：任务简报解析语义 6 条与 AC1–AC4 对 `docs/adr/` 全集（14 文件）及 `CONTEXT.md` 无任何直接违反；无 override 声明需求、无需 owner 裁决的演进项。任务性质是 ADR-0016（已接受）「解析语义」节的忠实实施票——每条要求均有 ADR-0016 明文条款一一对应。
- 给下游 SA 的红线提醒（非冲突）：
  1. **InternalError 通道**：ref 目标缺失必须以 throw 逃逸公共面（ADR-0016「不进结果联合」），不得加 E100 式顶层 catch 把它收编进结果联合，也不得降级为 `SCHEMA_PATH_NOT_FOUND`；JSDoc 应明示「derived 属可信域入参」以划清与「敌意公共输入走判别联合」边界的界限。测试按 AC2 锚定 throw 行为。
  2. **深拷贝边界归属**：ADR-0016 把 detached 深拷贝指派给 namespace-runtime 边界（组合票）；vfsl 层返回子树引用 derived 节点是否可接受（derived 不可变契约 + getCompiled 深冻结条目下引用即安全）应由 SA1 设计显式钉死——AC1 的新鲜副本要求目前仅明文覆盖失败分支 path 回显。
  3. **同构不许分叉**：读投影语义必须继续镜像 drillStep 的 any-member/Record 槽/数组位判定（ADR-0016「解析与实际值无关、不使用判别式缓存按值收窄」）；实现若为精确性引入值键控收窄即构成对 ADR-0016 被否方案的违反。
  4. **引用精确性**：简报与 ADR-0016 共用的「ADR 0003 §3.3 规则 1」编号实际源出 issue #53 设计的 §3.3 五规则（见 validate-patch.ts 注释），ADR-0003 §3 为其上层 any-of 母法——二者不矛盾，但实现文档引用时建议带出处限定词。
  5. **文档跟进（非阻塞）**：`packages/vfsl/AGENTS.md` 的 normative 清单（CONTEXT + v1-spec + ADR 0001/0003/0007）尚未列入 ADR-0016/0016 所修订的 0008——建议随实现一并补一行，避免后来者按旧 D8 封口字面理解。
- 信息充分性：ADR 全集 14 文件与 `CONTEXT.md` 已全读；任务简报完整；关键落地载体（derived.ts/validate-patch.ts/resolve.ts/index.ts/AGENTS.md/package.json）已按收录关系核验。无信息不足。

Verdict: clear
