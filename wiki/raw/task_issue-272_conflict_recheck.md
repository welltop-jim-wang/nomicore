# 冲突门禁报告（设计后复审）— Issue #272 vfsl: resolveSchemaAtPath（ADR 0016）

## 任务标识

- 任务：Issue #272 — `@nomicore/vfsl` 新增公开同步纯函数 `resolveSchemaAtPath(derived, path)`（feature）
- 被审对象：SA1 设计 `wiki/raw/task_issue-272_design.md`（迭代 0，HEAD `a6b2a79`，branch `mabf/issue-272`——已实测核实）
- 阶段：**设计后冲突复审**（SA1 设计 §14 明示 `requiresConflictRecheck: true`，理由三条：公共 API 变更 / 新公共失败语义 / 深拷贝边界归属裁决）
- 对照基准：`docs/adr/` 全集（14 文件：0001–0012、0014、0016；0013/0015 不存在）+ 根 `CONTEXT.md`（173 行）+ 已批准 SA6 契约 `wiki/raw/task_issue-272_sa6_contract.md`（approve）
- 前置门禁：`wiki/raw/task_issue-272_conflict_report.md`（clear，审任务简报；本复审在其上加审设计增量裁决 D1–D9、§8 算法、§11 文件范围）
- Issue comments：REST 读取为空响应（简报/SA6/前置报告三处同载）——无 owner 要求需并入，无 override 声明在案
- 裁决人：SA8 Conflict Gatekeeper（mabf-sa8）

## 复审方法

前置门禁审的是任务简报；本复审聚焦**设计相对简报新增的裁决面**：SA6 §15 显式留给 SA1 的 Q1–Q7、D8 失败分类泛化、D9 模块落位与模块级导出、§11 ALLOW/DENY 文件范围、§8 全部算法规则。每项对照 ADR 原文（非转述）与 CONTEXT.md 词条裁定。被 superseded 的条款（ADR-0007 pre-#237 完整 ROOT 校验、ADR-0008 原 D8 封口句）不计入约束；设计引用的均为修订后现行文本（已核对 ADR-0008 L167–178 修订节在仓）。

## 设计自报复查点逐条裁决

### 复查点 1（设计 §14 理由 1）：公共 API 变更——vfsl 公共面新增 1 值导出 + 2 类型导出 — **no-conflict**

| 项 | 裁决依据 |
|---|---|
| 函数落位引擎包 | ADR-0016 §解析语义明文「`@nomicore/vfsl` 新增公开 API `resolveSchemaAtPath(derived, path)`」；ADR-0004 D3「纯类型零运行时、不进引擎包」约束的是 vfsl-protocol 协议包，反向确认运行时函数归引擎包（新模块 `src/resolve-schema-at-path.ts` 不侵入协议包辖域） |
| 签名逐字 | 设计 §8.1 与 ADR-0016 签名块逐字一致：`(derived: DerivedSchema, path: readonly (string\|number)[]) → ResolveSchemaAtPathResult`；两枚失败码 `SCHEMA_PATH_NOT_FOUND`（无任何候选接纳该段）/ `SCHEMA_PATH_INVALID`（非数组/野段形状守卫）逐字同源；全 ADR 全集 grep 证实该 API 与码域仅 ADR-0016 一处规定，无第二 ADR 另立语义 |
| 类型名目 | `ReadDataSchemaProjection`（ADR-0016 §投影体）四键 `valueSchema/aliases/docs/aliasDocs` 与设计 §8.1 接口逐键一致（含 ref 按名保留、闭包自包含/JSON 可序列化、切片键规约语义）；`ResolveSchemaAtPathResult` 出自签名块 |
| derived 作公共入参 | ADR-0003 §1 `evaluate` 公共导出使 derived 自 #20 起即 vfsl 公共数据形状；derived.ts 冻结形状实测核对（aliases/structure/values/index + 文档三表）与设计 B6 一致 |
| 纯加法 | 既有导出面零变更；全仓（packages/apps/domains/tests）符号零命中实测复核成立（index.ts 零处 resolveSchemaAtPath），无既有调用方可破坏 |
| 仅经 index 导出 | 与包边界纪律一致（非冲突基准，辅助核验通过） |

### 复查点 2（设计 §14 理由 2）：新公共失败语义——畸形可信域入参以 throw `InternalError` 逃逸公共面 — **no-conflict（含裁决边界确认）**

- ADR-0016 §解析语义明文：「`ref` 目标缺失（畸形派生物）沿 validate-patch 先例抛 `InternalError`：可信域契约，不进结果联合」。设计 §8.2 无顶层 catch、throw 直接穿透、不降级失败码——前置门禁红线 1 逐条落实。
- **通道泛化裁决**：设计把 throw 通道扩展至两树分歧（D7）、derived 非对象、structure/values 根守卫、keyPattern 不可编译、值树引用环。ADR-0016 仅点名 ref 缺失一例，但这些均属「畸形派生物（可信域）」同一范畴的合理具体化；**ADR 全集与 CONTEXT.md 无任何条款要求 vfsl 公共函数一律不抛**（已通读核对；「公共畸形输入返回判别结果」惯例位在 `packages/vfsl/AGENTS.md`，非冲突基准，且其针对敌意公共输入——设计 §8.2 以 path 为敌意通道走判别联合、derived 为可信域走 throw 的二分划界正确，并已计划在 AGENTS.md 补显式例外句）。
- 任务简报「同步、不抛错、零 memo」语义域为**预期失败两码**（简报 L29 上下文）——设计两码分支零 throw，与简报一致；畸形派生物 throw 与简报 L28 逐字一致。
- 设计未采纳 ADR-0016 任何被否备选（无 opt-in、无判别式收窄、无 ref 内联展开、无扁平 docs、无注释包装树、无载体结构树载荷、无缺席原因子通道）——§8 全文核读确认。

### 复查点 3（设计 §14 理由 3）：D5 深拷贝边界归属——vfsl 层返回 derived 内部引用，detached 深拷贝归 namespace-runtime 组合票 — **no-conflict（文本锚定充分，非静默 override）**

- ADR-0016 §交付纪律原文：「每次读深拷贝投影：公共面只暴露 detached 投影**（namespace-runtime 边界）**——`activeTools.derived` 的**活引用绝不递出**」——纪律的落位（括号明示）与保护对象（runtime 的活 derived）均在 namespace-runtime 边界；`resolveSchemaAtPath` 的 derived 为**调用方自备**，返回其内部引用不构成活引用逃逸。
- ADR-0016 §分层与兼容面原文：「成功读 = `readLogicalValueAtPath` 的值 + **`resolveSchemaAtPath` 的投影深拷贝**」——组合公式本身预设 runtime 对 `resolveSchemaAtPath` 的产出再深拷贝；D5 的分层解释是该公式的直接读出，非对「每次读深拷贝」的重写。
- ADR-0008 修订节（L169–172）同向：「`derived` 只经 `readData` 语义 schema 投影的受控只读深拷贝进入公共面」——约束面是 readData 公共消费面。
- CONTEXT.md「语义 schema 投影」词条 _Avoid_「把投影当作 live derived schema 的共享引用（每次读都是 detached 深拷贝）」——规约的是 readData 消费面；设计以 §10 R2 行、§13 R4、follow-up #1 把每读深拷贝显式指派给组合票，未削弱该词条。
- **附加条件（非冲突，供总控/组合票承接）**：D5 的安全性以组合票落实深拷贝为前提；设计的 JSDoc 要求 + AGENTS.md 跟进 + follow-up 清单已留痕，后续组合票不得遗漏。

## 其余设计增量裁决全量对照（ADR 全集 + CONTEXT.md）

| # | 设计裁决 | 对照条款 | 裁决 |
|---|---|---|---|
| 1 | D1 双游标（结构树定合法性、逐字复用 `drillStep`；值树产投影）；YPlainArray 值位 array/结构位终态的分歧按结构侧拒下钻（`['attachments',0]`→NOT_FOUND） | ADR-0016 ⟺ 同构命题（「与写侧路径守卫 drillStep 语义同构…写合法 ⟺ 读可解析」）+ union any-member（ADR-0003 §3 any-of「任一成员出现即存在」）；复用本体是最强同构形式；模块级（非 index）导出不改公共面，包内消费有先例；ADR-0007 #237 修订节锚定写侧路径级/边界级家族——设计仅消费不修改 | no-conflict |
| 2 | D2 docs/aliasDocs 切片三类别（脊柱/终点子树后代/闭包别名内部）+ 空条目过滤 + 合并序 field→marker | 三类别逐字出自 ADR-0016 §投影体（「脊柱注释 = 沿 P 的键，终端子项注释 = P 之下的键，别名内部注释 = 别名名锚定的键」）；键规约与文档三表同构为 ADR 明文；空条目过滤/合并序为 SA6 §15-Q2 显式不锁自由度，无 ADR 条款要求保留空键 | no-conflict |
| 3 | D3 ROOT 别名级注释不入切片（除非 ROOT 入闭包） | ADR-0016 三类别均不含「根别名级」行；aliasDocs 切片域 = 闭包别名；ROOT 非被 valueSchema 引用的别名；SA6 §15-Q3 不锁 | no-conflict |
| 4 | D4 合成 union 成员序 = 发现序（确定性 DFS） | 无 ADR 条款约束成员序；纯函数确定性保持；SA6 §15-Q4 不锁（多集断言） | no-conflict |
| 5 | D6 真实节点原样引用（含在场 discriminator）；合成 union 恒两键无判别式；解析全程不读 discriminator | ADR-0003 §3「缓存的缺失/存在不得改变任何可观测行为」；ADR-0016「合成 union 无判别式缓存，仍是合法 ValueSchema 形状」+「不使用判别式缓存按值收窄」逐字落实（前置红线 3） | no-conflict |
| 6 | D8 失败分类：形状级（INVALID）vs 内容级（NOT_FOUND）；混合形态不镜像 KIND_ORDER 字面 | ADR-0016 两码定义为裁决母法；⟺ 命题辖**合法性**（drillStep 复用结构性保证），不辖失败码与写侧文案取序的逐例镜像；SA6 契约锚定例（`[0]`/`['keywords','0']`/`['keywords',-1]`→INVALID；`['attachments',0]`/`['nope']`/keyPattern 失配→NOT_FOUND）全部同结果；偏差仅存于契约未锁的混合形态例，已记 R2 交 SA2 | no-conflict |
| 7 | D7 keyPattern 引擎异常→包装 InternalError；keyPattern 失配→NOT_FOUND（fail-closed） | keyPattern 正则实测 + fail-closed 为 ADR-0016 明文；引擎不可编译属畸形派生物（可信域通道），ADR 未规定、设计钉死于授权通道内 | no-conflict |
| 8 | §9 per-call 局部正则编译缓存（局部 Map，镜像 compileOrCache） | ADR-0016「零 memo」辖跨调用记忆化（其缓存放行语为「将来按 schema generation 缓存是加法演进」）；调用局部变量不构成 memo，纯度/确定性/幂等保持 | no-conflict |
| 9 | §8.4 数组位无越界概念（读侧无 base） | ADR-0016「解析与实际值无关」的直接推论；SA6 负控 C3d 同载（越界 = base 运行时判定） | no-conflict |
| 10 | §1 非目标 + §11 DENY：不触 doc-runtime / namespace-runtime / registry / derived.ts / evaluate / validate-patch 行为 / 决策文档 | ADR-0016 §分层与兼容面（doc-runtime 不变、组合归 runtime 后续票、registry 仅类型别名跟随）；ADR-0003 派生形状冻结；ADR-0008 修订节不被抢先承接 | no-conflict |
| 11 | ADR-0016 Consequences 的 CONTEXT.md 更新义务 | 「Data」词条（L34）与「语义 schema 投影」词条（L37–39）已在仓（commit a6b2a79）；设计 DENY docs/adr/** 与 CONTEXT.md 正确 | no-conflict |
| 12 | ADR-0001/0002/0005/0006/0009/0010/0011/0012/0014 辖域 | 设计零触及（SSOT 文本/authority/投影管线/持久化/复制/诊断/实例身份/日志格式）；readData 语义仅 ADR-0008 修订节与 ADR-0016 两处规定，无第三处可冲突 | no-conflict |

## SA6 契约一致性（dispatch 指定对照面）

- **Q1–Q7 全部在 SA6 §15 显式留白自由度内裁决**，无一条与契约锚定断言冲突；设计 §8.6 逐路径对照表覆盖契约全部锚定例（含 `[]`、`['u','x']` 合成 union、keyPattern fail-closed、optional 保留/展开、双删表 throw 两态、递归别名单名闭包）。
- **契约文件四枚全部入 DENY LIST**（实现不得反改契约自证）——与 SA6 §12 交付物纪律一致；四文件在仓实测（untracked，未改动）。
- 验证映射（§12）与 SA6 §13/§14 证据一致：基线 560 绿、31 文件终态、TS2305 ×3 翻绿路径、负控 11 绿禁改。
- 计数一致：34 红 + 3 类型 + 11 负控。
- 设计引用的源码锚点抽验属实：drillStep validate-patch.ts L114、KIND_ORDER L181、InternalError resolve.ts L26、derived.ts 冻结形状、index.ts 零导出（缺口实证）。

## 非阻塞观察（移交 SA2 / 实现票，不构成冲突）

1. **D5 附加条件**：引用返回的安全性以组合票深拷贝义务为前提（上文复查点 3）——follow-up #1 已留痕，建议 SA2 确认其不可裁撤。
2. **D8 混合形态**偏离 KIND_ORDER 字面镜像（契约未锁）——设计 R2 已自登，改动面局部。
3. **值侧规范化 in-flight 集合作用域**：须按 drillStep.expand 先例以「单次规范化」为界，保证 ADR-0016 自举的合法递归别名（`type Node = { next: YMap<Node> \| null }`）深路径游走不误报引用环——设计文本已声明镜像 expand 逐跳式，实现照做即可。
4. AGENTS.md 文档跟进（normative 清单 + throw 例外句）——非冲突基准，设计 ALLOW LIST 已含。

## 结论

- **Verdict: clear**。hard-violation 0 / override-declared 0 / 需 owner 裁决的演进项 0。
- SA1 设计自报的三条复查理由（公共 API 变更、throw 失败语义、D5 深拷贝边界）全部裁定 no-conflict，均有 ADR-0016/ADR-0003/ADR-0008 修订节原文锚定；Q1–Q7 裁决与 D8 泛化均在 SA6 契约显式留白内；分层纪律（不越界组合层）与文件范围（DENY 决策文档与契约测试）合规。
- `requiresConflictRecheck: false`——设计无需修订，可进 SA2 攻击评审。
- 冲突点数：0（全量对照 12 项 + 3 自报复查点均 no-conflict）。

Verdict: clear
