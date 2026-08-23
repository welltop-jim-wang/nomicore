# AC 逐条确认清单（修订轮 rev1）— readLogicalValueAtPath union 仲裁遮蔽硬化

- **run_id**: issue-75-rev-1787397220
- **任务简报**: `task_read-logical-value-at-path_rev1.md`（PR #83 owner Review Request changes）
- **门禁人**: 总控（Phase 3.5）；日期 2026-08-22
- **终态验证基线**: `pnpm test` 59 文件 828 用例全绿 exit 0（SA7 动态终态口径）+ `pnpm typecheck` 六工程 exit 0

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC-R1 | Phase B 导航结果区分 value / missing / reject 三态（或等价机制） | ✅ | 设计 D16（`task_read-logical-value-at-path_rev1_design.md` §3.1）；实现 read.ts L78-82 三态 `NavOutcome`（SA3 commit c4c2c73）；SA4 逐行核验零偏离 + INV-14（三态不泄漏公共联合）核实（`task_read-logical-value-at-path_rev1_sa4_review.md`） | SA1 设计 → SA3 实现 → SA4 验尸，闭环 |
| AC-R2 | union 仲裁：首个真实 value 胜；前序仅 missing 继续；全部可行成员 missing → `ok:true, value:undefined`；全部 reject → `PATH_NOT_ALLOWED` | ✅ | 设计 D17 §3.2 四规则伪代码；实现 read.ts union 分支（sawMissing 记账）；行为锚：rev1 契约测试 R1-R4 组 14 例（`read-logical-value-at-path-rev1-union-arbitration.test.ts`）+ H-b mixed 反序锚（`read-logical-value-at-path-rev1-hardening.test.ts`）；SA7 动态 `-t mixed` 对偶复跑 2 passed（`task_read-logical-value-at-path_rev1_sa7_report.md` 动态重点 #3） | 同上闭环 |
| AC-R3 | 明确 required-missing / 载体错位 / 合法缺席优先级，与 extract/union 声明序规则一致（设计文档成文） | ✅ | 设计 D18 §3.3：M1-M10 成员内结局三分法（合法缺席三源→missing；required 缺席/载体错位/段型不符等→reject）+ 组合优先级 value > missing > reject + 「可行成员」形式化 + 与 extract `walkUnion` 六维调和表 + INV-7 精确化 + swap 不变式限域；SA8 设计复审确认 AC-R3 七成分 7/7 履行（`task_read-logical-value-at-path_rev1_design_conflict_report.md`） | SA1 成文 → SA8 复审 clear，闭环 |
| AC-R4 | owner 要求的全部回归测试补齐（Record 缺键 vs 后序在场、optional 缺席 vs 后序在场、数组越界 vs 后序可解析（如结构允许）、全部合法缺席仍 undefined、交换声明序结果不变） | ✅ | 五类全覆盖：`read-logical-value-at-path-rev1-union-arbitration.test.ts` 18 例（R1=Record 缺键组 4 例 / R2=optional 组 3 例 / R3=数组越界组 3 例 / R4=全合法缺席组 4 例 / R5=swap 限域组 4 例），全绿。三类竞争场景按 SA5 结论 (c) 可构造性表 + SA8 注记 1 授权降级为绿灯行为锁 + 设计论证覆盖（结构性不可达四步归谬在案，`20260822-bug-read-logical-value-union-arbitration.md`）；owner 数组场景自带保留措辞「若结构系统允许」。补锚：SA4 H-a（26 层链 × 中段 optional 缺席 <2s 成本护栏）+ H-b（mixed 反序）+ SA7 H-c（嵌套 union 4 例） | SA6 锚定（含 R2 fixture 修复轮）→ SA4/SA7 补锚，闭环 |
| AC-R5 | 不回归既有测试（含 SUP-1 XML 情形） | ✅ | 总控亲跑全量 `pnpm test` 58 文件 821 例全绿 exit 0（SA3 后，`.mabf-bg/verify-after-sa3-rev1.log`）；SA7 终态 59 文件 828 例全绿 exit 0；SUP-1 XML 情形在 `read-logical-value-at-path-supplementary.test.ts` 28 例中保持绿（路径耗尽处 walkUnion 不经中段仲裁，设计 §3.3.3 调和表论证 + SA8 对照 #7 裁决） | 总控亲跑 + SA7 复跑，闭环 |

**结论**: 5/5 AC 全部 ✅，无 ❌ 条目，无需追加派发。评审双清（SA4 pass + SA7 pass）已确认，进入 Phase 4 收尾。
