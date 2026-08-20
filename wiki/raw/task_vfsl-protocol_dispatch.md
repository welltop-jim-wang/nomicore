# Dispatch Log — vfsl-protocol 类型协议包：编译期路径投影机制（issue #24）

> 派遣机制说明（2026-08-24 立案）：本主机命令执行能力不可用（沙箱后端缺失，bash 全拒且无审批通道），
> `acpx <alias> exec` 无法发起。总控改用 harness 子代理工具派发 SA（SA3/SA6 用 deepseek 路由，其余默认路由），
> 每个 SA 的提示词包含：其 SKILL.md 绝对路径（先读）、worktree、任务简报、任务类型与环境约束（禁跑命令、
> 测试验证延期、如实标注）。此偏离已记录于本日志，供审计。

| # | 派发时间 | SA | 阶段 | 完成时间 | 决策逻辑 |
|---|---------|-----|------|---------|---------|
| 1 | 2026-08-24 R1 | SA6 | Phase 1 验收锚定 | (agent 停滞) | 功能开发路由：先写验收测试锚定契约（§8.4 矩阵），包不存在即天然红灯；deepseek 路由子代理代行 acpx |
| 1b | 2026-08-25 R2 | SA6(重派) | Phase 1 验收锚定 | R2 完成 | R1 派发未产出任何文件（agent 静默停滞，已 interrupt）；重派后完成 3 个测试文件（projection.test-d / empty-fail-closed.test-d / empty-module.test）+ 简报「SA6 红灯测试记录」；运行验证因环境无命令执行如实标注延期 |
| 2 | R3 | SA1 | Phase 2 设计 | R3 完成 | 默认路由子代理 3 次触顶（token limit 无产出），改 deepseek 路由分三轮接力完成（§A 机制 / §A.7+§B 张力裁决 / §C 文件蓝图+§D 必填章节），设计文档 707 行齐备 |
| 3 | R3 | SA2 | Phase 2 设计评审 | reject（R1） | 1 CRITICAL + 4 HIGH + 2 MEDIUM + 2 LOW：Step 分发式键访问产不出 T\|undefined（D2 崩塌）、never 交叉推断时序、lockfile 缩进错位、append/insert value 类型错、B.1 执行者悬空；报告 task_vfsl-protocol_sa2_review.md |
| 4 | R4 | SA1-R2 | Phase 2 设计修订 | R4 完成 | 8 项逐条落实：Step 重写为 MemberKeys（键空间并集门禁）+ MemberLookup（逐成员取键缺键补 undefined）、双重 fail-closed（value 参 never）、lockfile 2 空格、PathElementValue 元素类型、B.1 执行者钉死（SA2 复审后总控派 SA6 修订轮）、PathValue/PathPatchValue<UnknownPath> 显式 never、自名引用依据+兜底、Path 收敛 readonly string[]；文档 707→850 行 + §E 逐条回应表 |
| 5 | R4 | SA2-R2 | Phase 2 复审 | reject（R2） | 6 项实质落实；新 CRITICAL：正例 5 窄化锚（具体联合别名上的条件类型不分发→恒 never→断言必红）；MEDIUM：read/kindOf 单点 fail-closed 无实测证据 |
| 6 | R5 | SA1-R3 | Phase 2 设计修订 | R5 完成 | A.6 推演修正（分发 helper）+ C.7-5 精确替换写法；A.7.1 理论补强（裸类型变量位推断/deferred resolution）+ §F 延期验证清单（2 命令 + 8 预期形状 + 结论闸门）；文档 936 行 |
| 7 | R5 | SA2-R3 | Phase 2 终审 | **pass** | R2 两存活点全部实质落实；无新 CRITICAL/HIGH；放行：SA6 修订轮 → SA3 落地；实测证据依 §F 延期（不构成设计缺陷） |
| 8 | R6 | SA6(修订轮) | 测试修订（C.7 六条） | R6 完成 | empty 文件改 LocalEmptyMap（含头注释重写、import 清理、四断言保留）；projection 增三件套正/负例 + PathElementValue 断言 + 正例 5 改分发 helper；回读门禁通过（LocalEmptyMap 在场、@ts-expect-error 保留） |
| 9 | R6 | SA3 | Phase 3 落地实现 | R6 完成 | 六文件落地（index.ts 140 行 / 包 package.json / tsconfig / vitest.config typecheck 接线 / 根 scripts 两行 / lockfile importer 2 空格缩进）；静态自检五条通过；SA6 owned 与 DENY 未触碰；测试运行与 commit 延期（无命令执行） |
| 10 | R7 | SA4 | Phase 4 静态验尸 | **pass** | 8/8 项通过；无 scope creep（vfsl 0.1.7 未动/docs/ci 未动）；lockfile 缩进 2/4/6/8 逐位对齐；类型机制边界攻击全存活；1 LOW（D1 负例可加强，非阻塞）+ 1 MEDIUM 预登记延期项；动态审核重点 9 条（A–I）交 SA7 |
| 11 | R7 | SA7 | Phase 5 动态验证 | deferred-execution | 环境无命令执行，测试不可运行（如实记录，未伪造输出）；A–I 全部静态独立复核通过 + 全部列延期补跑（§F 三命令 + 八预期形状）；执行 SA4 LOW 建议：D1 负例加强为 `UnknownPath<['0']>` 精确断言（仅一处）；放行条件：可执行会话补跑 §F 全绿 |
| 12 | 2026-08-20 R8 | 总控 | 环境恢复+实测验证 | R8 完成 | DSH 沙箱后端恢复；`pnpm install --frozen-lockfile` **通过**（lockfile 手工条目实测有效）；首轮 `pnpm typecheck` 失败：SA6 两测试文件头注释含 glob `packages/*/test/**` 的 `*/` 序列提前终止块注释（语法错误）；修复后二轮 typecheck 暴露真类型失败：14 处合法路径调用 TS2345（never 交叉参数机制整体证伪） |
| 13 | R8 | SA6(语法修复轮) | 测试注释修复 | R8 完成 | 两行注释改写消除 `*/` 序列；断言/类型/import 未动 |
| 14 | R8 | 总控 | 隔离实验定位根因 | R8 完成 | 探针矩阵（.mabf-bg/probe/）证实：never 交叉参数机制证伪（推断回落约束型 + 字面量拓宽为 [string] → 合法路径全死）；验证替代机制 `const P` + `NoInfer<P>` + rest 标记（.mabf-bg/access-probe3.ts EXIT=0：18 正例 + 10 负例全绿） |
| 15 | R9 | SA1-R4 | Phase 2 设计修订（实测驱动） | R9 完成 | A.7 废弃 never 交叉参数、采纳实测签名（const P/NoInfer/rest 标记）；C.1 同步（含 FailClosedRest/ArrayEditRest 内部助手）；§E R4 行 + §F 探针级实测标注；文档 992 行；SA1 另以 c1_e2e.ts 探针独立复测 C.1 代码块 EXIT=0 |
| 16 | R9 | SA3-R2 | Phase 3 修订落地 | R9 完成 | index.ts VfslTypedAccess 六方法换新签名 + 两内部助手（140→155 行）；其余类型逐字未动；静态自检五条过（零旧机制残留/export 集不变） |
| 17 | R9 | SA6(微量修复2) | 正例 5 helper 修复 | R9 完成 | TS2536（无约束 E 索引）→ 改 infer 形态（`{kind:'image'; url: infer U}`），断言语义不变 |
| 18 | R9 | 总控 | 终轮验证 | **全绿** | `pnpm typecheck` EXIT=0；`pnpm test`（vitest run --typecheck）**18 文件 361 测试全过、Type Errors: 0**（projection 16 + empty-fail-closed 3 + empty-module 1 + vfsl 既有 324 无回归）；日志 .mabf-bg/verify4.log |
| 19 | R9 | SA4-R2 | Phase 4 增量复审 | **pass** | R4 机制一致性（index.ts 与 C.1 逐字一致、两向安全推演）、SA6 三处修复正当性（D1 精确断言兑现 R1 LOW）、全绿真实性（日志形状核对 + 8 条 AC 覆盖矩阵闭合 + CI 触发链指认）、scope 终检（DENY 零触碰、vfsl 0.1.7 原样）；**放行 commit** |
| 20 | R9 | SA7-R2 | Phase 5 收尾 | **pass（实测闭环）** | R1 deferred-execution → R2 pass：A–I 九条延期项全部由实测闭环（install/typecheck/test/探针）；修复闭环因果链记录；本地完成事务放行 |
