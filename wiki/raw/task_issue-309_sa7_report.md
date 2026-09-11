# SA7 动态验证报告 — issue #309（v1-spec §5 与编写指南落地 M4 挂载锚位）

- Dispatch：`sa-68e96cc7-9a90-4531-8599-9744bc26b4eb`（mabf-sa7 / final-verification / iteration 0）
- 被验对象：SA3 实现产出（SA4 verdict = **approve** 之上的活链路复核）——worktree `/home/wangjian/nomicore-fix-issue-309`，分支 `mabf/issue-309`，HEAD `bbb93fbda3100b2da2a007a228af777cdc56d282` 之上的未提交 diff（14 个 tracked 修改 + 1 个新增 `packages/vfsl/test/spec-docs-anchor-m4-contract.test.ts`）。
- 验证口径：只做动态验证——解析/求值/投影数据流、可执行文档契约与检查器的真实运行行为、四锚位文档陈述与运行时逐条对齐、行为回归负控。不做一般静态审查（SA4 已做）、不消费 SA9/SA10、不观察远端 CI。

## Inputs

| 输入 | 状态 | 本轮用途 |
|---|---|---|
| `wiki/raw/task_issue-309.md` | 存在 | AC1-AC4 + What-to-build；Comments 为空（无 owner-comment 约束） |
| `wiki/raw/task_issue-309_design.md`（iteration 2） | 存在 | §7-D1…D10 冻结目标文本、§8 数据流路线（V1-V4）、§12 验收映射、§15 复查清单 |
| `wiki/raw/task_issue-309_sa6_contract.md` | 存在 | §12.1 冻结运行时观察（A1-A4/B1-B4/C1/C3/C5/D1/E1/E2/I1）、§12.2 Suite D 判据、§12.4 检查器同步、§12.5 运行入口 |
| `wiki/raw/task_issue-309_sa3_impl.md` | 存在 | 被验实现报告（红基线 6 failed / 实现后全绿的声明按报告值对待，运行值由本轮独立复测） |
| `wiki/raw/task_issue-309_sa4_review.md`（approve） | 存在 | §11 后续动态验证项（整仓 test / 检查器双入口 / typecheck+generate）→ 本轮全部闭口 |
| `wiki/raw/task_issue-309_implementation_conflict_report.md`（SA8 iteration 3，clear） | 存在 | 不可变协议边界识别（冻结面：金样本常量、E305 面、wiki 零 diff、注释-only、指南 §7 块 1→1） |
| `wiki/raw/task_issue-309_sa2_review.md` / `_conflict_report.md` / `_design_conflict_report.md` / `_relevant_decisions.md` | 存在 | SA2-1 判词与 ADR 0019 决策边界（仅识别协议边界，不重审） |
| 上游实现（#306/#307/#308，HEAD 已含） | 在场 | M4 解析/IR/派生/投影/codegen 运行时本体 |

缺失输入：无。`wiki/raw/task_issue-309_sa7_report.md` 此前不存在（本文件为首版）。

## Runtime environment

| 项 | 值 |
|---|---|
| Node / pnpm / Python | `v24.13.0` / `10.28.2` / `3.12.3` |
| 分支 / HEAD | `mabf/issue-309` / `bbb93fbda3100b2da2a007a228af777cdc56d282`（+#309 未提交 diff） |
| 变更面实测 | `git status --porcelain`：14 个 tracked 修改 + 1 个新增测试文件 + 10 个未跟踪 wiki 产物；`git diff --stat` 107 insertions / 31 deletions，与 SA3/SA4 报告一致 |
| 运行入口 | vitest 经 `NODE_OPTIONS=--conditions=nomicore-source`（src 条件）；检查器 `python3` 纯标准库；全部从仓库根运行 |
| 服务/端口 | 无（纯同步纯函数 + 文档/检查器验证路径，无进程/端口面） |

## Changed Data Flow Verification

设计（§8）声明：**运行时数据流零变化**；新增的是四条**只读验证路线**（V1-V4）与文档契约消费链。逐条活链路验证：

| Route | Design change | Runtime driver | Observed hops | Expected result | Actual result | Verdict |
|---|---|---|---|---|---|---|
| V1 spec 文本 → 检查器 | 判定 21→22（G10 need 13 项 + G17 新增 + G16 期望 ROOT）；两入口 22/22 | `python3 tests/acceptance/vfsl_spec_acceptance.py`（默认） | G10「注释规则」PASS（need 13 项含「联合成员」）；G17 PASS「四类锚位 + M4 子规则 9 项齐备」；G16 PASS（期望 ROOT，消息同步）；共 22/22 GREEN，exit 0 | 22/22，exit 0 | 22/22 GREEN（exit 0） | ✅ |
| V1' exemplar → 检查器 `--spec` | exemplar §4 四类 + M4 bullet + 附录 fixture = §10 副本，保持绿路径 | `python3 … --spec tests/acceptance/exemplar/spec-exemplar-v1.md` | G10/G16/G17 全 PASS；22/22 GREEN，exit 0 | 22/22，exit 0 | 22/22 GREEN（exit 0） | ✅ |
| V2 指南/规范 `vfsl` 块 → vitest（Suite D） | 新增 CI-wired 文档契约（D1-D5） | `NODE_OPTIONS=--conditions=nomicore-source pnpm vitest run packages/vfsl/test/spec-docs-anchor-m4-contract.test.ts` | 7 tests：D1 20 needle 事实链、D2 §5 块执行、D3 指南逐块谓词、D3b 钉句、D4 检查表、D5① 措辞计数 0、D5② diff 卫生——全绿；Type Errors 无 | 7/7 绿 | **7 passed (7)；Type Errors: no errors** | ✅ |
| V2' 新文件 runner 接入 | vitest include + CI 分片磁盘枚举自动发现，无需登记 | `pnpm vitest list`（grep 计数）+ `node scripts/ci-test-shard.mjs 1..6 6` | `vitest list` 含该文件 7 条用例；分片脚本将其装入 shard 1/6；整仓 `pnpm test` 收集 319 files 全绿（含该文件） | 被真实入口收集执行 | 三重证实（include/分片/整仓运行） | ✅ |
| V3 措辞扫描 | tracked − `wiki/**` − `dist/**` 内旧措辞计数 = 0 | 独立扫描（`git ls-files` 逐文件 grep，731 个作用域内 tracked 文件） | 0 命中（与 Suite D D5① 同判） | 0 | **0 命中**（wiki/ 内 1135 个 tracked 文件按 D1 作用域排除，未改写） | ✅ |
| V4 diff 卫生 | `git diff --check` exit 0 且 stdout 空 | `git diff --check` + Suite D D5② spawnSync | exit 0、无输出 | 0 | exit 0 / stdout 空 | ✅ |
| 文档事实源切换 | §5/指南/exemplar/CONTEXT 文本面由「三锚位」切为四锚位，消费方（检查器/Suite D）从新文本读取 | 本轮探针（见 Preserved 表 S5/G7/G8/EX 行）+ 检查器/Suite D 运行 | 全部新文本陈述在现行实现下逐条成立（下表）；旧路径（三锚位机器契约）不再被任何入口消费 | 新事实源生效、旧路径退役 | 检查器双入口 + Suite D + 探针四方一致 | ✅ |

关键中间跳点（非只看最终断言）：检查器逐项输出（G10 need 逐串、G17「9 项齐备」、G16 期望列表含 ROOT）与 Suite D 逐用例红绿均被逐条记录；`vfsl` 块 → wrapper → `parseVfsl` → `evaluate` → `derived.memberDocs` 的中间值逐字核对（见下节）。

## Preserved Data Flow Verification

设计声明不变的全部运行时路线在当前 worktree 活链路复测（探针经公共入口 `parseVfsl`/`evaluate`/`resolveSchemaAtPath`；金样本/指纹由 Suite C 承压）：

| Route | Preserved invariant | Runtime driver | Baseline observation（SA6 §12.1 @ HEAD bbb93fb） | Current observation（本轮实测） | Verdict |
|---|---|---|---|---|---|
| A1 前导 `\|` 锚位（多行） | `memberDocs` 逐字：`[[" 草稿：可继续编辑 "],[" 已提交：只可追加备注 "],[]]`；派生表 `Status.<member 0/1>` | 探针 parse+evaluate | 同左 | `{"Status.<member 0>":[" 草稿：可继续编辑 "],"Status.<member 1>":[" 已提交：只可追加备注 "]}`（派生表；IR 三槽含尾空数组由 Suite C 13 用例断言绿） | ✅ |
| A2 首成员起点锚位 | `type T = /** 甲 */ "a" \| "b";` → member 0 挂 ` 甲 ` | 探针 | `[[" 甲 "],[]]` | `{"T.<member 0>":[" 甲 "]}` | ✅ |
| A3 doc 紧邻 `\|` 之前 | 挂 `\|` 后继成员（member 1）` 乙 ` | 探针 | `[[],[" 乙 "]]` | `{"T.<member 1>":[" 乙 "]}` | ✅ |
| A4 连续 doc 同挂 | 同一成员按出现顺序：`[" 一 "," 二\n * @tag "]`（含内部 `*`/换行逐字） | 探针 | 同左 | `{"T.<member 0>":[" 一 "," 二\n * @tag "]}` | ✅ |
| B1/B2 坍缩维持 E305 | 两形态均 E305 @ (2,10)，恰 1 条，前缀 `VFSL-E305: ` 冻结 | 探针 firstIssue | E305@(2,10) | **E305@(2,10)** ×2，前缀冻结，正文四类枚举在场 | ✅ |
| B3/B4 非标记夹缝 E305 | (2,16) / (4,5) | 探针 | 同左 | E305@(2,16)、@(4,5)，前缀冻结 | ✅ |
| C4 前导 `\|` 夹缝 E305 | (2,12) | 探针 | E305@(2,12) | E305@(2,12) | ✅ |
| C1 M3 优先不双挂（夹缝叠写·标记成员合法） | memberDocs `[[" 成员口径 "],[]]`；members[0].docs `[" 载体口径 "]`；载体 doc 全树恰 1 次 | 探针 | 同左 | memberDocs `[[" 成员口径 "],[]]`；membersDocs `[[" 载体口径 "],[]]`；`载体口径` 在别名 JSON 中恰 1 次 | ✅ |
| C3/C5 M3 优先（成员起点/前导 `\|` 夹缝 marker） | marker docs `[[" d "],[]]`；**无 memberDocs 键** | 探针 | 同左 | membersDocs `[[" d "],[]]`；`hasMemberDocsKey:false`；派生表 null | ✅ |
| D1 无 M4 输入惰性 | 无成员 doc 联合：IR 无 memberDocs 键；派生表无 | 探针 | 键 absent | `hasMemberDocsKey:false`，`derivedMemberDocs:null` | ✅ |
| E1 派生 memberDocs 表 | `{"Status.<member 0>":[" 状态 "],"Mixed.<member 0>":[" 成员甲 "]}`（`<member N>` 键形） | 探针 | 同左 | **逐字相等** | ✅ |
| E2 投影 docs 切片（第三来源 + 合并序 marker 前 member 后） | `["m"]` → `{"Mixed.<member 0>":[" 载体甲 "," 成员甲 "]}`；`["s"]` → `{"Status.<member 0>":[" 状态 "]}` | 探针 `resolveSchemaAtPath` | 同左 | **逐字相等**（合并序维持 marker→member） | ✅ |
| I1 E305 消息四类枚举 | 正文含「类型别名 / 属性 / 标记类型 / 联合成员」；前缀冻结 | 探针 | 同左 | `VFSL-E305: 悬空文档注释：未紧邻可挂载的声明性节点（类型别名 / 属性 / 标记类型 / 联合成员），且不相邻即不再挂载` | ✅ |
| M1 别名锚位（含连续 doc 顺序） | `aliasDocs` `[" A-doc "]`；连续 `[" x "," y "]` 顺序保持 | 探针 | 既有行为 | 实测一致（M1 挂别名、顺序保持） | ✅ |
| M2 字段锚位 | `fieldDocs` `ROOT.f = [" f-doc "]` | 探针 | 既有行为 | 实测一致 | ✅ |
| M3 标记锚位 | marker 节点 `docs = [" m-doc "]`（别名级 docs 为空，不双挂） | 探针 | 既有行为 | 实测一致（`aliasDocs.C = []`） | ✅ |
| IR/指纹金样本 | `SPEC_FIXTURE`/`FIXTURE_B` 的 IR sha256 + semantic 指纹常量逐字节 | Suite C（`parse-vfsl-union-member-docs.test.ts` 13 用例） | 68 tests 绿 | **4 files / 68 tests passed；Type Errors 无**（常量 L33-36 在 diff 中逐字未动，本轮实读在场） | ✅ |
| codegen 四发射位 + 无发射位负控 | 别名联合/枚举/内联 ×多行/行内；YPlainArray/YXmlFragment 零发射 | Suite C（`generate-union-member-docs.test.ts` 33 用例） | 同左 | 33 用例绿（含 `YPlainArray`/`YXmlFragment` 零 doc 字节负控与 `--check` 写盘闭环） | ✅ |
| readData 投影链（#308 面） | docs 切片三来源与合并序 | Suite C（`resolve-schema-at-path-member-docs.test.ts` 16 用例） | 同左 | 16 用例绿 + E2 探针逐字对齐 | ✅ |
| 存量生成物 | `domains/*/generated.ts` 零 diff；`generate --check` exit 0 | `pnpm generate --check` + `git diff --name-only` | exit 0 | exit 0；`domains/*/generated.ts` 0 条 | ✅ |
| wiki 历史证据 | `wiki/**` 零 diff | `git diff --name-only -- wiki/` | 0 条 | **0 条** | ✅ |
| B5 生产代码注释-only | 3 个 src 文件去注释后零 token 差 | TypeScript printer `removeComments` 双版本比对（AST 级） | 语义零变化 | parser.ts / semantic.ts / ir.ts 三文件 comment-stripped 输出**逐字节相等**（`B5.all=true`；初版 token 扫描器的 parser.ts「不等」为扫描器模板串失同步伪象，已用解析级比对排除） | ✅ |

**四锚位文档陈述 ↔ 运行时逐条对齐**（本轮新增活链路证据，全部经公共入口实测）：

| 交付文本陈述（位置） | 运行时实测 | 对齐 |
|---|---|---|
| §5 四类锚位枚举（类型别名/属性/标记类型/联合成员） | M1/M2/M3/M4 四条路线各自挂载正确（上表 M1-M3 + A1-A4）；E305 消息正文四类枚举与之一致 | ✅ |
| §5 子规则 1-3（前导 `\|` 锚 / 首成员起点 / 连续同挂） | A1/A2/A4 逐字复现 | ✅ |
| §5 子规则 4 坍缩两形态维持 E305「与既有行为逐字节一致（不升格挂别名节点）」 | B1/B2 均 E305@(2,10)，未挂别名 | ✅ |
| §5 子规则 5 夹缝：非标记维持 E305、标记成员按 M3 挂标记 | B3/B4 E305；`"a" \| /** d */ YLeaf<"b">` → ok，doc 挂 marker（membersDocs `[null,[" d "]]`），无 memberDocs 键 | ✅ |
| §5 子规则 6 标记优先不双挂 + 夹缝叠写不对称 | C1/C3/C5 不双挂；叠写在标记成员合法（两条 doc 各归各锚）、非标记成员第二条 E305@(2,21) | ✅ |
| §5 单行与混合布局句（`/** 甲 */ "a" \| "b"` / `"a" /** 乙 */ \| "b"`） | 前者 member 0 ` 甲 `；后者 member 1 ` 乙 `（挂 `"b"`） | ✅ |
| §5 联合成员示例块（首个 §5 `vfsl` 块） | 块数 1；wrapper 后 parse+evaluate 双 ok；`Status.<member 0/1/2>` 三条 doc 逐字在场；别名 doc ` 订单生命周期状态 ` 挂 Status | ✅ |
| §5 发射位界线句（`YPlainArray` 纯值子树与 `YXmlFragment` 不透明实参内无发射位，派生表照常收集） | 派生表收集实测：`ROOT.p.<item>.<member 0/1>`、`ROOT.x.u.<member 0>`；零发射由 Suite C 33 用例负控绿承压 | ✅ |
| 指南挂载目标句（含「必须紧邻」段） | 段落本体含全部四类（类型别名/对象字段/标记类型/联合成员）与夹缝/坍缩 E305 表述；「必须紧邻」全指南唯一命中 | ✅ |
| 指南 §7 目标块（替换后唯一块） | §7 恰 1 个 `vfsl` 块；执行双 ok；`Asset.<member 0/1>` = ` 位图资产：… `/` 富文本资产：… ` 逐字 | ✅ |
| 指南 §8 块（自带 ROOT） | §8 恰 1 个 `vfsl` 块；原样执行双 ok；`Status.<member 0/1>` 逐字 | ✅ |
| exemplar 附录 fixture = 现行 §10 fixture | 缓冲区逐字节相等（`true`）；两 fixture 各自 parse+evaluate 双 ok（§10 fixture 无成员 doc，派生表空——与文本一致） | ✅ |
| G15「fixture 块在附录内」不受 §5 新块影响 | 检查器 G15 PASS（附录块在场；`any()` 语义，与设计 X3 推导一致） | ✅ |

## State Machine Verification

doc 挂载的解析状态机（无 pending doc → doc 存积 → 锚位结算 → 悬空 E305）在当前实现下逐触发验证：

| Initial state | Trigger | Expected transitions | Observed transitions | Forbidden transitions absent | Verdict |
|---|---|---|---|---|---|
| 无 pending doc | doc 出现于别名/字段/标记前 | 立即 claimDocs → M1/M2/M3 挂载，顺序保持 | M1/M2/M3 表值实测正确；连续 doc `[" x "," y "]` 顺序保持 | 不双挂：M3 处别名级 docs 为空（`aliasDocs.C=[]`） | ✅ |
| 无 pending doc | doc 出现于 `\|` 前 / 首成员起点前 | 延迟回收（附着点 A/B）→ 结算挂后继成员 | A1/A2/A3/A4 全部挂载正确 | 不误吞：D1 无 doc 联合无 memberDocs 键 | ✅ |
| pending member doc | 成员为标记名 | M3 优先：挂标记节点，联合成员锚位不再回收 | C3/C5 marker docs 在场、memberDocs 键缺席；叠写两 doc 各归各锚（C1） | **同一 doc 双挂未出现**（C1 载体 doc 全树恰 1 次） | ✅ |
| pending doc（坍缩/夹缝非标记） | 模块收尾结算 | E305，锚注释起始，恰 1 条 | B1/B2@(2,10)、B3@(2,16)、B4@(4,5)、C4@(2,12)、叠写非标记第二条@(2,21)——全恰 1 条、前缀冻结 | 伪成功（静默挂别名/静默丢弃）未出现 | ✅ |
| 任意态 | 重复/连续触发 | 同一后续节点按序全收 | A4/M1 连续实测 | 顺序错乱/丢失未出现 | ✅ |
| 终态 | — | 同步纯函数，无重试/restart/迟到回调面 | 探针两次运行（诊断移除前后）结果一致；Suite C 两次运行同数同绿 | close/retry/restart 复活旧路径：N/A（无状态、无 I/O） | ✅ |

## Error and Cleanup Flow

- **E305 错误分类与传播**：全部 6 个触发形态（B1-B4/C4/叠写非标记）实测恰 1 条 issue、`code E305`、`line/column` 与冻结基线逐字节一致、message 前缀 `VFSL-E305: ` 冻结、正文四类枚举在场——错误沿设计路径传播，无误报/漏报/伪成功。
- **检查器失败语义**（入口健壮性）：判定失败时 exit 1 + 具名缺失要素（G17 `缺失要素: …` 机制在场，本轮绿态下未触发；红基线形态由 SA3 实现前 6 failed 与 SA6 X1-X5 控制矩阵双重记录，本轮不重复构造）。
- **Suite D fail-closed**：D2/D3 `execBlock` 对非 ok 走 `expect.fail` 附 issues JSON；D5② 断言 `result.error` undefined + status 0 + stdout 空；D5① 计数必须恰 0；无 skip/only/todo/env override/fallback（本轮运行全绿 + 文件实读复核）。
- **清理时序**：本轮临时诊断（探针测试 + 3 个 .mjs 脚本）全部删除后关键场景复跑结果不变（见 Temporary Diagnostics）；`.scratch/` 恢复仅存既有 `vfsl-v1-parser/`；无服务、无端口、无后台进程残留（本轮唯一后台作业为整仓 `pnpm test`，已自然退出）。

## Temporary Diagnostics

| 项 | 内容 | 处置 |
|---|---|---|
| 添加项 | `packages/vfsl/test/sa7-309-probe.test.ts`（16 用例临时探针，日志前缀 `[SA7-DATAFLOW]`，观测值落 `.scratch/issue-309-sa7/vfsl-probe-observations.json`）；`.scratch/issue-309-sa7/b5-token-check.mjs`、`b5-token-diff.mjs`、`b5-print-check.mjs`（B5 比对脚本，只读 git/fs） | 全部用于观察关键跳点与中间值；未改任何生产代码/交付文件/断言 |
| 删除项 | 上述探针测试与 4 个 .scratch 文件（含观测 JSON）整体删除 | `git status` 恢复 14 tracked + 1 新增测试 + untracked wiki 产物；`.scratch/` 仅余既有 `vfsl-v1-parser/` |
| 移除后验证 | Suite D 复跑 **7/7 绿**；Suite C 复跑 **4 files / 68 tests 绿、Type Errors 无**——与移除前逐值一致 | `git diff` 中 `[SA7-DATAFLOW]` 0 命中；`packages/ tests/ scripts/ docs/` 全域 0 命中 |
| 误象澄清 | 初版 token 扫描器对 parser.ts 报「不等」——系扫描器对模板字符串的线性扫描失同步（diff 落在 FirstTemplateToken 文本内），非语义差；改用解析级 `removeComments` printer 比对后三文件全部逐字节相等 | 伪象已排除，B5 结论以解析级比对为准 |

临时诊断均未进入 artifactPaths。

## Dynamic Evidence Matrix

| Source | Requirement or risk | Driver | Expected | Actual | Evidence | Result | Suggested routing |
|---|---|---|---|---|---|---|---|
| SA6 §12.2 | Suite D（D1-D5）红绿判据 | vitest 单文件 | 7/7 绿 | 7 passed | 本报告 Commands #2 | ✅ | — |
| SA6 §12.4 / Design D9 | 检查器双入口 22/22 | python3 ×2 | 22/22，exit 0 | 22/22 GREEN ×2 | #3/#4 | ✅ | — |
| SA6 §12.1 | 冻结运行时观察逐字节保持 | 临时探针（已删） | 与基线逐字相等 | A1-A4/B1-B4/C4/C1/C3/C5/D1/E1/E2/I1 全部逐字/逐位一致 | 本报告 Preserved 表 | ✅ | — |
| SA4 §11-1 | 整仓 `pnpm test`（SA3 未跑） | `pnpm test` | 全绿 + 新文件被收集 | 319 files / 3383 tests 绿、Type Errors 无、exit 0；新文件在 shard 1/6 | #5-#7 | ✅ | — |
| SA4 §11-3 | typecheck / generate --check 运行值 | 两命令 | exit 0 / exit 0 + 生成物零 diff | 均 exit 0；`domains/*/generated.ts` 0 条 | #8/#9 | ✅ | — |
| SA4 §11-2 | 检查器双入口运行值 | python3 ×2 | 22/22 | 22/22 | #3/#4 | ✅ | — |
| SA4 §12-1 | U+200B 不可见字符（MINOR） | 文件实读 | 无功能影响 | 注释内嵌 `*/` 用途，typecheck/运行/7 用例全绿 | #2 + 文件读 | ✅（维持 SA4 非阻断判级） | 可入未来文档卫生票 |
| Design §12/§15 | 冻结面：金样本/wiki/生成物/注释-only | diff 实读 + B5 脚本 + git | 全部守住 | 常量 L33-36 未动；wiki 0 条；生成物 0 条；3 src 文件 comment-stripped 相等 | #10-#12 | ✅ | — |
| Design §7-D8(b) | §7 块 1→1 不变式 + D3 逐块谓词不弱化 | 探针 + Suite D | 恰 1 块、配对 ≥2 | G7/G8 blockCount=1；D3 绿（`blocks.length===1` 在断言内） | Preserved 表 + #2 | ✅ | — |
| Issue AC1-AC4 | 四 AC 可执行判据 | Suite D + 检查器 + 独立扫描 | 全绿 | D1-D5 绿；22/22×2；旧措辞 0/731 文件；diff --check exit 0 | #1-#4、#13 | ✅ | — |
| Design §13 follow-up | B4（检查器接 CI）与分片权重表 | 现状确认 | 维持 follow-up | package.json/`.github` 无检查器引用变更；`test-durations.json` 未含新文件（分片器按全表平均装箱，`--stats 6` 正常出 6 片） | #7 | ✅（登记项，非缺口） | follow-up |
| Design §13 时序 | #309 须在 PR #305 收官合并前落地 | 分支状态 | commit 进入 Parent 收官 | 当前为未提交 diff，未 commit/未 push | **总控/Owner 裁决**（SA7 不负责 push/PR） | Controller |

## Commands and Evidence

```bash
# 0. 变更面与基线
$ git status --porcelain          # 14 tracked M + 1 新增测试 + 10 untracked wiki 产物
$ git diff --stat                 # 14 files changed, 107 insertions(+), 31 deletions(-)

# 1. 独立残留扫描（tracked − wiki − dist；731 文件）
$ git ls-files -z | (逐文件 grep 三锚位)      # HIT: 0 —— 与 Suite D D5① 同判
$ git diff --name-only -- wiki/ | wc -l       # 0
$ git diff --name-only -- 'domains/*/generated.ts' | wc -l   # 0
$ git diff --check                             # exit 0（无输出）

# 2. Suite D（CI-wired 文档契约；诊断移除前后各一次，结果一致）
$ NODE_OPTIONS=--conditions=nomicore-source pnpm vitest run packages/vfsl/test/spec-docs-anchor-m4-contract.test.ts
  ✓ spec-docs-anchor-m4-contract.test.ts (7 tests) | Tests 7 passed (7) | Type Errors no errors | exit 0

# 3. 规格检查器（默认入口）
$ python3 tests/acceptance/vfsl_spec_acceptance.py
  G1..G17 全 PASS（G10 13 项 / G16 ROOT / G17 9 元组）→ GREEN 22/22（exit 0）

# 4. 规格检查器（exemplar 入口）
$ python3 tests/acceptance/vfsl_spec_acceptance.py --spec tests/acceptance/exemplar/spec-exemplar-v1.md
  GREEN 22/22（exit 0）

# 5. Suite C（M4 回归负控；诊断移除前后各一次，结果一致）
$ NODE_OPTIONS=--conditions=nomicore-source pnpm vitest run packages/vfsl/test/parse-vfsl-union-member-docs.test.ts \
    packages/vfsl/test/evaluate-derived-member-docs.test.ts packages/vfsl/test/resolve-schema-at-path-member-docs.test.ts \
    packages/vfsl-codegen/test/generate-union-member-docs.test.ts
  Test Files 4 passed (4) | Tests 68 passed (68) | Type Errors no errors | exit 0

# 6. 整仓门禁（SA4 §11-1 委托项）
$ NODE_OPTIONS=--conditions=nomicore-source pnpm test
  Test Files 319 passed (319) | Tests 3383 passed (3383) | Type Errors no errors | exit 0（599.6s）

# 7. runner 接入（新文件自动发现）
$ pnpm vitest list | grep -c spec-docs-anchor-m4-contract    # 7（7 用例被收集）
$ node scripts/ci-test-shard.mjs --stats 6                   # 6 片正常装箱
$ node scripts/ci-test-shard.mjs 1 6 | grep spec-docs-anchor # packages/vfsl/test/spec-docs-anchor-m4-contract.test.ts（shard 1/6）

# 8. 类型面
$ pnpm typecheck    # 14 个 tsconfig 全链 → exit 0

# 9. 生成物新鲜度
$ NODE_OPTIONS=--conditions=nomicore-source pnpm generate --check   # exit 0；generated.ts 零 diff

# 10. 金样本常量（SA8 冻结面）
$ sed -n 33,36p packages/vfsl/test/parse-vfsl-union-member-docs.test.ts   # 四常量逐字在场
$ git diff -U0 packages/vfsl/test/parse-vfsl-union-member-docs.test.ts    # 仅文件头注释 3 行（L5-7 区域）

# 11. B5 注释-only（解析级比对；临时脚本已删，方法与输出如下）
$ ts.createPrinter({removeComments:true}) 比对 HEAD:file vs worktree file（parser/semantic/ir）
  B5.comment-stripped-equiv packages/vfsl/src/parser.ts   :: true
  B5.comment-stripped-equiv packages/vfsl/src/semantic.ts  :: true
  B5.comment-stripped-equiv packages/vfsl/src/ir.ts        :: true

# 12. 临时探针（16 用例全绿；观测值已冻结入本报告 Preserved/对齐表后删除）
$ NODE_OPTIONS=--conditions=nomicore-source pnpm vitest run packages/vfsl/test/sa7-309-probe.test.ts
  Tests 16 passed (16) | Type Errors no errors   → 文件与 .scratch/issue-309-sa7/ 已删除
```

## Deviations

- **无实现偏离发现**：交付 diff 与设计冻结目标文本/ALLOW 面完全一致（本轮动态视角：文档陈述全部有运行时证据、无虚构行为；两处测试加强（D2 `pairCount ≥ 1`、D3 `blocks.length === 1`）均为设计已冻结形态的机器化，实测不改变判定口径）。
- **验证方法偏离 1（已澄清的伪象）**：B5 token 等价比对初用线性 scanner 对 parser.ts 报不等——定位为 scanner 模板串失同步伪象（差异落在 FirstTemplateToken 文本内），改用解析级 `removeComments` 比对后三文件全部逐字节相等。结论以解析级为准，不构成 finding。
- **验证范围偏离 2（显式不做）**：未重复构造检查器/Suite D 红态（红基线已有 SA3 实现前 6 failed 实测 + SA6 X1-X5 控制矩阵，本轮验绿态与冻结面即闭环）；未运行远端 CI、未 push、未建 PR（职责在总控）；`test-durations.json` 权重与 B4 CI 接入维持设计 §13 follow-up 登记。
- **SA4 verdict 关系**：SA4 = approve；本轮独立动态验证未发现任何可下调事由，也未发现新增 fail 项。

## Verdict

**approve**

理由（对照 SA7 判据）：

1. **设计声明改变的数据流按设计变化**：四条只读验证路线（V1-V4）全部按设计生效——检查器双入口 22/22（G10 13 项 / G17 9 元组 / G16 ROOT）、Suite D 7/7、措辞计数 0、diff 卫生 exit 0；新契约文件被 vitest include / CI 分片 / 整仓 `pnpm test` 三重真实收集执行。
2. **设计声明保持的数据流保持不变**：SA6 §12.1 全部冻结观察（A1-A4/B1-B4/C4/C1/C3/C5/D1/E1/E2/I1）在交付后 worktree 上逐字/逐位复现；M1/M2/M3 挂载路线、投影切片合并序、codegen 四发射位与无发射位负控、金样本常量与指纹全部保持。
3. **四锚位文档陈述与运行时行为逐条对齐**：v1-spec §5 四类枚举与六条子规则、单行/混合布局句、示例块、发射位界线句，指南挂载目标句/§7/§8/检查表，exemplar fixture（与 §10 逐字节相等）——每条行为性陈述均有本轮公共入口实测证据，无虚构行为。
4. **状态机正确、禁止状态未出现**：挂载状态机全部触发路径（含连续/叠写/坍缩/夹缝/M3 优先）实测正确；不双挂、伪成功、静默丢弃均未出现。
5. **无行为回归**：Suite C 68 绿（两次）、整仓 319 files / 3383 tests 绿、typecheck exit 0、generate --check exit 0 + 生成物零 diff、B5 注释-only 三文件解析级相等、wiki 零 diff、金样本常量未动。
6. **临时诊断已清理**：探针与脚本全删、`[SA7-DATAFLOW]` 零残留、移除后关键场景复跑结果不变。

遗留（非阻断，均已登记）：B4 检查器 CI 接入与分片权重表刷新（设计 §13 follow-up）；#309 收官时序（PR #305 合并前 commit/merge）属总控/Owner 裁决，当前 diff 尚未提交。
