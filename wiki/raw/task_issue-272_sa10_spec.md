# SA10 规格终审 — Issue #272 vfsl 公开 `resolveSchemaAtPath`（ADR 0016）

- 角色：SA10（mabf-sa10）· 阶段 spec-review · 迭代 0
- 被审对象：HEAD `de5633c`（branch `mabf/issue-272`，实现提交；基线 = 母票 PR #271 head `a6b2a79`，docs/adr-0016-readdata-schema，已确认为当前）——`git status` 实测工作树干净（仅 SA4 审查产物 untracked，不在交付 diff 内）
- 审查产物：`wiki/raw/task_issue-272_sa10_spec.md`（本文件）
- 方法：静态规格符合性审查——Issue 正文 6 条解析语义 + AC1–AC4、ADR-0016 全文、SA6 契约、批准设计（迭代 1）、SA8 红线逐条对照交付 diff（16 文件 +2695/−6）与实现源码；按 SA10 纪律不运行测试、不启动服务、不修改任何代码/设计/测试
- Issue comments：dispatch 确认 REST 读取为空响应——无 owner 要求需要并入（与简报/SA6/SA8/SA1/SA2/SA4 六处记录一致）

---

## 1. Verdict

**approve** —— 交付 diff 忠实满足 Issue 正文（解析语义 6 条 + AC1–AC4）、ADR-0016 明文决策、SA6 已批准契约（34 运行时 + 3 类型 + 11 负控全部有对应实现行为）与批准设计（迭代 1，D1–D9）；SA8 五条红线全部落实；无关键 AC 的 partial/unmet/unachievable；无 scope creep（全部改动落在设计 §11 ALLOW LIST + 流程工件内，DENY 面零触碰——diff name-only 实证）。残余仅 MINOR 级观察（§7），按纪律不阻断 approve，但须在 PR 中披露（§8）。

## 2. Issue 正文解析语义 6 条逐条核验（简报 L25–30）

| # | Issue 要求 | 实现证据 | 判定 |
|---|---|---|---|
| 1 | union 静态 any-member 扩展，与写侧 drillStep 语义同构（写合法 ⟺ 读可解析）；终点多候选合成 union（合法 ValueSchema 形状、无判别式缓存） | 结构侧逐段调用 `drillStep` 本体（resolve-schema-at-path.ts L136；validate-patch.ts diff 仅加 `export` + 注释，零行为改动——3 个 hunk 逐一核读）；值侧 union 全成员展开（L279–284）；终点多候选合成 `{kind:'union', members}`（L170–172）；红契约 `Object.keys(node)===['kind','members']`（test L289）+ 多集断言 + 剥光判别式 5 路径全等（L303–316）锚定 | 满足 |
| 2 | Record 动态键带 keyPattern 时用正则实测该段，不匹配即拒绝（fail-closed） | `acceptRecordSlot`（L298–335）：`compile`+`match` 实测；失配 → `keyPatternRejected` → NOT_FOUND（L156–158）；锚定：`['assets','bad key!']`（test L202–206） | 满足 |
| 3 | optional 游走透明展开、返回子树原样保留 | 规范化循环解包 optional 且语法路径不变（L228–231）；出候选收**原始**字段值节点（emitValue L258/L327 在解包前收集）——`['notes']`/`['config']` 返回 optional 包装原样、`['config','retries']` 穿透（test L341–360 五断言） | 满足 |
| 4 | ref 目标缺失（畸形派生物）抛 InternalError（可信域先例，不进结果联合） | 值游走 own 守卫查表缺失 throw（L235，文案与 valueLens 逐字节一致——SA2 复核）；终点闭包缺失 throw（L403）；**全文无顶层 catch**（唯一 try/catch 为 acceptRecordSlot 单层局部——grep 实证）；两态锚定（test L374–396 `.toThrow(InternalError)`） | 满足 |
| 5 | 预期失败经结果联合结算：SCHEMA_PATH_NOT_FOUND（无任何候选接纳该段）/ SCHEMA_PATH_INVALID（非数组或野段形状守卫），同步、不抛错、零 memo | path 形状守卫先于一切 derived 访问（L94–101）；结构侧拒绝经 `classifyStructureReject` 形状级/内容级分类（L359–369，D8）；同步函数体（无异步）；零跨调用状态（regexCache 为每调用局部 Map，L126——SA8 复审第 8 项裁定调用局部不构成 memo）；失败分支零 throw（本审查逐路径推演 §6 全中） | 满足 |
| 6 | docs/aliasDocs 切片键规约与派生 schema 文档三表完全同构（§3 绝对语法路径 + `'<item>'/'<key>'/'<member N>'` 合成段）；别名表只含传递闭包内被引用的别名 | 脊柱键生成与 evaluate.ts `walkDocs`（L356–401）文法逐字镜像（本审查逐行比对：字段 `+'.'+name`、`<member ${i}>` 0 基、`<item>`、`<key>`、ref 锚名切换、ref 终态不穿越）；切片 = 脊柱 ∪ 终点子树后代 ∪ 闭包别名内部，键不发明（表扫描 + 前缀匹配，L427–463）；闭包 = `collectAliasClosure` DFS + 名集去重（L377–416）；⊆ 不变量 + 逐字内容 + 递归别名单名闭包 JSON 往返锚定（test L449–498） | 满足 |

## 3. AC1–AC4 验收

| AC | 要求 | 证据 | 判定 |
|---|---|---|---|
| AC1 | 经 vfsl 公共入口（包 index）导出；结果联合两枚失败码的 path 回显为调用方数组的新鲜副本 | index.ts 新增导出块（`export { resolveSchemaAtPath }` + 两枚类型导出，带 JSDoc；既有导出逐字节不变——diff 仅追加）；四处失败分支均新建数组（L95 `[]` / L99/L138/L158 `[...path]`）；新鲜副本三重断言（test L253–269：not.toBe 调用方数组、两次调用不共享、原数组突变不穿透）；签名 `(derived, path: readonly (string\|number)[])` 由 test-d `parameter(1).toEqualTypeOf` 锁定 | 满足 |
| AC2 | union any-member 扩展与合成 union 终点、keyPattern fail-closed、optional 透明展开/返回保留、ref 缺失 InternalError 各有测试锚定 | union 组 5 断言（L273–316）；Record 组 3 断言 + 失败码组失配锚（L202–206）+ 新增 pattern-errors 4 断言（引擎四类错误同通道）；optional 组 5 断言（L341–370）；InternalError 组 2 断言（L374–396） | 满足 |
| AC3 | docs/aliasDocs 切片键与三表键规约同构；别名传递闭包有测试锚定（含递归别名不发散） | docs 组 6 断言（L399–498）：叶子/别名终点/别名内深读/整根四类键集逐字 + 跨读集 ⊆ 不变量 + 自引用别名单名闭包、终止、JSON 可序列化 | 满足 |
| AC4 | vfsl 包测试与 typecheck 绿；根仓 `pnpm typecheck`、`pnpm test` 无回归 | SA3 报告：vfsl 32 文件 600 测试绿 + 包 tsc exit 0 + 根 typecheck/test 全绿；SA4 静态一致性核验成立（文件/断言实数清点吻合）；运行入口真实（根 vitest include `packages/*/test/**/*.test.ts` + typecheck include `*.test-d.ts` + 根 package.json 14 包 typecheck 链——本审查亲核）。**动态复跑归 SA7**（本阶段不运行测试）；±1 计数口径差（600 vs 设计预测 601）已在 SA4 §11 挂号，见 §7-O3 | 满足（动态终验待 SA7，属流程分工而非缺口） |

## 4. ADR-0016 逐条对照（权威母法，98 行全文核读）

| ADR 条款 | 实现 | 判定 |
|---|---|---|
| 签名块 `resolveSchemaAtPath(derived, path): ResolveSchemaAtPathResult` + 两码逐字定义 | §8.1 类型与实现逐字一致（L49–68、L89–92）；NOT_FOUND = 无候选接纳 / INVALID = 非数组或野段形状守卫 | 满足 |
| 投影体四件套（valueSchema 值语义子树 ref 按名保留 / aliases 传递闭包自包含递归安全 JSON 可序列化 / docs / aliasDocs） | `ReadDataSchemaProjection` 四键逐键一致；ok 分支恰五键（test L174–177）；ref 按名保留（`['assets','img1']` → `{kind:'ref', name:'AssetEntity'}`，test L293–301） | 满足 |
| union any-member 扩展与 drillStep 同构；合成 union 无判别式缓存仍是合法 ValueSchema 形状 | drillStep 本体复用（单源）；合成节点恰两键恒无判别式（D6）；derived.ts L48 核验 union 形状合法 | 满足 |
| 解析与实际值无关；不使用判别式缓存按值收窄 | 全模块零 `discriminator` 读（grep 实证仅注释提及）；值缺席照常解析（test L279–282）；剥光判别式全等断言 | 满足 |
| Record keyPattern 正则实测、不匹配 → NOT_FOUND（fail-closed） | acceptRecordSlot 失配 → NOT_FOUND；引擎四类错误同通道（D7/SA2-F1 修订——设计级钉死，落在本条款「不匹配即拒绝」与简报 NOT_FOUND 定义的延长线上，SA2/SA4 同载） | 满足 |
| optional 透明展开/返回保留；ref 缺失 InternalError 不进联合；同步纯函数零 memo、结果联合拒绝 | 见 §2 第 3/4/5 条 | 满足 |
| docs/aliasDocs 键规约与三表完全同构；脊柱/终端子项/别名内部三类别 | `sliceDocs` 三类别选键 + field→marker 合并序 + 空条目过滤（D2）；ROOT 别名级不入切片（D3——fixture ROOT 别名级无注释消歧） | 满足 |
| 载体结构树（StructureNode）不进载荷 | 投影四件套纯值域；无 StructureNode 泄漏（类型面 test-d 锁定） | 满足 |
| §分层与兼容面：doc-runtime 不动 / namespace-runtime 组合属后续票 / registry 仅类型别名跟随 | diff 零触 doc-runtime/namespace-runtime/namespace-registry（name-only 实证）；深拷贝边界正确外移（D5 + JSDoc 双落点 + follow-up #1 硬约束传承「活引用不逃逸 readData 公共面」——SA8 复查点 3 附加条件保持） | 满足 |
| §交付纪律「每读深拷贝投影（namespace-runtime 边界）」 | vfsl 层返回 derived 内部引用 + JSDoc 明示消费者不得变异、深拷贝归组合票——SA8 复查点 3 裁定 no-conflict（文本锚定充分）；derived 不可变契约（derived.ts L9–13）+ getCompiled 深冻结条目使引用安全 | 满足 |
| 被否备选零采纳（opt-in / 判别式收窄 / ref 内联展开 / 扁平 docs / 注释包装树 / 载体结构树载荷 / 缺席原因子通道） | 实现全文核读确认均未引入 | 满足 |

## 5. SA6 契约与 SA8 红线落实

- **契约覆盖**：红 34 断言（实数清点 4+9+5+3+5+2+6 = 34 `it` 块）+ test-d 3 + 负控 11（1+5+5）——逐组与实现行为对位（§2/§3 已列锚点）；契约四文件零改动（SA4 以 SA2 行号锚 L70–86/L174–177/L303–316/L373–396 + 计数双重核对，本审查抽核四处行号锚全部精确命中现文件）。
- **关键断言纪律**：全部锚定运行时可观测行为（toEqual/键集/多集/throw 实例）；动态接缝（test L70–86）使红→绿翻转由真实公共导出驱动；无 skip/only/todo（grep 实证）；期望字面量经负控 C2 与真实求值器逐字对账。
- **红线 1（InternalError 逃逸公共面）**：无顶层 catch；throw 清单 = ref 缺失（游走/闭包两态）+ 值树引用环 + 两树分歧 + derived 非对象/根缺失 + 引擎意外异常——JSDoc 双落点（模块头 L14–31 + 函数 L70–88 + index 导出块）与实现一致。
- **红线 2（深拷贝边界归属）**：D5 裁决落实（vfsl 返回引用、组合票深拷贝）；JSDoc 写明共享节点与变异禁令；follow-up #1 义务未承接亦未裁撤。
- **红线 3（同构不分叉）**：drillStep 逐字复用 + 零判别式读；未引入值键控收窄。
- **红线 4（引用精确性）**：实现注释带出处限定词（「issue #53 §3.3 规则 1，母法 ADR-0003 §3」，L10–12、L262–263）。
- **红线 5（AGENTS.md 跟进）**：normative 清单补 ADR 0016（含 0008 D8 修订指引）+ Boundaries 可信域 throw 显式例外句（含引擎四类错误 fail-closed 对偶句）——diff 实证在仓。

## 6. 独立推演抽核（不依赖上游结论的手工走查）

本审查对实现独立手工推演全部契约锚定路径，与期望逐条命中：`[]`（VALUE_ROOT 整树 + 闭包 {Audit,AssetEntity,U} 发现序 + docs 五键）；`['notes']`/`['config']`（optional 原样）与 `['config','retries']`（穿透）；`['u','x']`（合成 union 两键、发现序 [string, array]）；`['assets']`（Record 原样 + 规则推出 docs={Audit.createdBy}）；`['assets','img1']`（ref 保留 + 闭包 {AssetEntity,Audit}）；`['assets','img1','url']`（scalar + 空闭包 + 锚名切换后脊柱键 `AssetEntity.<member 0>.url` 与 walkDocs「ref 终态不穿越」一致）；失败九例（`[0]`/`['keywords','0']`/`['keywords',-1]`/`['assets',7]`→INVALID；`['nope']`/`['u','z']`/`['notes','x']`/`['attachments',0]`/`['assets','bad key!']`→NOT_FOUND——`classifyStructureReject` 形态集逐例核算）；双删表两态 throw；pattern-errors 三夹具 `['r','k']`→NOT_FOUND（不 throw）/`['r',7]`→INVALID（形状先行不被引擎错误污染）；合法递归别名深路径不误报环（in-flight 单次规范化作用域 + 每段 visited 身份守卫双机制核验）；剥光判别式 5 路径所选终点/闭包均不携带 discriminator 键（断言自洽）。未发现与上游产物矛盾的实现行为。

## 7. MINOR 观察（不阻断 approve；PR 须披露）

| ID | 观察 | 处置建议 |
|---|---|---|
| M1（承 SA4-O1） | 通道纯度声明覆盖面 > 守卫覆盖面：模块注释 L104–105 与 SA3 报告宣称「不泄漏裸 TypeError」，但七项在场守卫只查键在场——`{structure:null,…}`/`{values:null,…}`/fieldDocs 值非数组等手造垃圾仍可泄漏裸 TypeError。设计 §8.2 原文同构缝隙（实现不劣于设计）；可信域入参、无正确性/安全影响、红线 1 不受影响 | 后续措辞收敛（「键缺席守卫」）或守卫补值非 null 检查——纯加法，非本票验收面 |
| M2（承 SA4-O2） | aliasDocs 空条目过滤（L461 `arr.length > 0`）超出设计字面（§8.6 仅写「存在则浅拷贝」）——属 SA6 §12 显式解锁自由度（契约全部经 `nonEmpty()` 断言，两取向均绿），方向与 D2 噪声治理一致 | 记录为实现钉定，无需改动 |
| M3（承 SA4-O3） | SA3 报告「600 tests」与设计 §12 预测「594+4+类型面 3 = 601」存在 ±1 计数口径差（vitest 对 test-d 计数方式）；SA3 未说明口径 | SA7 复跑时核对（期望 600 或 601；< 598 或存在 skip 即为失败条件）——已挂 SA4 §11 |
| M4（承 SA4-O4/SA2-N8） | AGENTS.md 例外句以「(ADR 0016)」前缀统辖整句，引擎四类错误 fail-closed 实属「ADR 未规定、设计 D7 钉死」；现文未直接声称 ADR 明文规定引擎错误通道，可接受 | 若后来者误读，按设计 §7-D7 修订史澄清 |
| M5（本阶段补充） | 两树分歧 InternalError 分支（D7a）与 `PatternBudgetExceeded` 运行期通道无确定性测试锚——契约/设计均显式未要求（SA6 §15-Q7 留白、设计 §12 标「可选」），合法派生物上分歧分支不可达（双游标吸收） | SA7 可选探针项（已挂 SA4 §11 行 3/4）；不属缺口 |

## 8. PR 必须披露的未达成项与边界声明

- **未达成项：无。** AC1–AC4 全部实现并有测试锚定；无 partial/unmet/unachievable 的关键 AC。
- **显式非目标（设计 §1，须在 PR 中声明属后续票，非本票缺欠）**：①namespace-runtime readData 组合（成功读 = 值 + 投影**每次读深拷贝**、`schema: null` 三情形、`NamespaceRuntimeReadDataResult` 重定型）——**深拷贝义务为硬约束传承（follow-up #1，不得裁撤）**；②namespace-registry 类型别名跟随；③按 schema generation 的缓存（profiling 驱动加法演进）；④keyPattern 拒绝原因细分（失配 vs 引擎不可判定——需新失败码/detail 字段，属破坏性加法，须 ADR）。
- **实现申报偏差（SA3 §偏差说明 + SA4 复核成立）**：入口 derived 守卫从设计 §8.2 的 4 项完备化为 7 项在场检查（更保守加严，对全部契约/设计锚定输入零行为差异）；aliasDocs 空条目过滤（M2）。
- **动态验证状态**：AC4 全绿为 SA3 报告值，SA4 静态一致性核验成立；本阶段按纪律未复跑——活链路终验（含 M3 计数口径核对）归 SA7。
- **SA8 复审第 7 项存档表述**：其「引擎不可编译属畸形派生物」定性已被设计迭代 1（§6/§7-D7）按 B15 源码事实链显式更正为 fail-closed NOT_FOUND；以设计 §7-D7 为准（SA2/SA4/本审查三段一致确认更正合法、方向向 ADR-0016 明文收敛、无需新冲突复查）。

## 9. 范围与 conformance 总结

- **Scope creep：无。** 交付 diff 16 文件 = ALLOW LIST 五项（新模块 / index 导出块 / validate-patch 三处 export / AGENTS.md / pattern-errors 测试）+ SA6 契约四文件（流程归档，DENY 零改动）+ wiki 任务档案七枚（仓库惯例，SA4 以 d7098ed 先例核验）。DENY 面（derived/resolve/evaluate/validate/pattern/parser/semantic、其余 packages、docs/adr、根配置）零触碰——diff name-only 实证。
- **上游链完整**：简报 → SA8 clear（前置）→ SA6 approve → SA1 设计迭代 1（SA2-F1 修订）→ SA8 复审 clear → SA2 approve → SA3 实现 → SA4 approve；无缺口环节；`relevant_decisions` 不存在但各阶段一致声明以 SA8 冲突报告（含 ADR 全集 14 文件盘点）替代，可接受。
- **结论**：实现 = Issue 正文 × ADR-0016 × SA6 契约 × 批准设计的忠实交付；**approve**。`requiresConflictRecheck: false`（实现未引入设计之外的语义面）。
