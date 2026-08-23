# Dispatch Log — doc-runtime：schema-independent ROOT 载体投影读取 (issue #86)

类型自判：功能开发（新增 schema-independent 同步载体投影读取能力，重定义 readLogicalValueAtPath 行为语义）。工作流：SA8 前置门禁 → SA6 验收锚定 → SA1 设计 → SA8 设计复审 → SA2 攻击评审 → SA3 实现 → SA4 静态验尸 → SA7 动态验证 → AC 门禁 → 收尾。

| # | 派发时间 | SA | 阶段 | 完成时间 | 决策逻辑 |
|---|---------|-----|------|---------|---------|
| 1 | 18:17 | SA8 | Phase 0 前置冲突门禁 | 18:21 | clear —— 任务 7 条 AC 为 ADR-0008 直接实施项，冲突点 0，放行 |
| 2 | 18:21 | SA6 | Phase 1 验收锚定 | 18:35 | SA8 verdict=clear；功能开发路由先锚定 AC 验收红灯：37 例真实失败（TS2554/断言红），既有 65 文件基线全绿 |
| 3 | 18:35 | SA1 | Phase 2 架构设计 | 18:57 | SA6 红灯真实且基线绿，进入设计：载体驱动两阶段模型，553 行 |
| 4 | 18:57 | SA8 | Phase 2 设计复审 | 19:04 | clear —— 设计与 ADR 决策一致性复审，冲突点 0，三处表面张力消解 |
| 5 | 19:04 | SA2 | Phase 2 设计攻击评审 R1 | 19:22 | reject —— 2 HIGH（null 哨兵碰撞、detached Yjs 静默空投影）+ 2 MEDIUM（SUP-5 覆盖倒退、移植清单三缺陷）must-fix |
| 6 | 19:22 | SA1 | Phase 2 设计修订 R2 | 19:33 | SA2 R1 reject 8 攻击点全量落实（ProjectOutcome 判别联合、detached 双入口守卫、SUP-5 移植等），611 行 |
| 7 | 19:33 | SA2 | Phase 2 设计复审 R2 | 19:41 | reject —— R1 八点全核销；新发现 R2-1 移植锚三重自相矛盾（must-fix）+ R2-2 计数口径（LOW） |
| 8 | 19:41 | SA1 | Phase 2 设计修订 R3 | 19:45 | R2-1 拆双自洽锚 + guards fixture 规格显式化 + 27→26 口径更正，636 行 |
| 9 | 19:45 | SA2 | Phase 2 设计复审 R3 | 19:48 | pass —— R2-1/R2-2 全部核销，三轮攻击无新缺陷无回退，设计定稿 |
| 10 | 19:48 | SA3 | Phase 3 TDD 实现 | 20:06 | SA2 R3 pass 设计定稿；SA3 commit 51621ca（read.ts 重写 + guards 新建 + 7 遗留测试删除 + bump 0.1.6），总控亲验全量 typecheck+test 全绿（61 文件 914 例，exit 0） |
| 11 | 20:06 | SA4 | Phase 3 静态验尸 R1 | 20:18 | reject —— F1 错误通道二次异常三向量（敌意 toString/message getter/Proxy path）+ F2 版本 bump 撞设计 DENY LIST |
| 12 | 20:18 | SA1 | Phase 3 设计修订 R4 | 20:22 | SA4 F2 处置：§7 package.json 移入 ALLOW「仅限 patch bump（硬门禁 #9）」，642 行 |
| 13 | 20:18 | SA3 | Phase 3 修复 R2 | 20:25 | SA4 F1 修复 commit 5c5668f（safeDetail/safeSpreadPath 内层 try + guards 3 敌意锚），总控亲验 917 例全绿 |
| 14 | 20:23 | SA4 | Phase 3 静态复审 R2 | 20:30 | reject —— F1+F2 已核销；新代码续攻发现 R2-F1a：safeDetail 缺 typeof string 收窄（一行修复+一锚） |
| 15 | 20:30 | SA3 | Phase 3 修复 R3 | 20:37 | R2-F1a 修复 commit 4014a8d（typeof raw==='string' 收窄 + guards NEW1/NEW2 双锚），总控亲验 919 例全绿 |
| 16 | 20:30 | SA1 | Phase 3 设计勘误 R5 | 20:38 | SA4 处置指令：蓝本 safeDetail/safeSpreadPath 伪代码同步 + isPlainRecord 偏离正式回收为设计判据，668 行 |
| 17 | 20:39 | SA4 | Phase 3 静态复审 R3 | 20:41 | pass —— R2-F1a 核销（NEW1/NEW2 探针收编、回归面零）、设计 R5 勘误落地；三轮收敛静态验尸通过 |
| 18 | 20:41 | SA7 | Phase 3 动态验证 | 20:49 | pass —— 本地动态全绿：冻结 37 例未收窄 git 实证、五向量探针全结构化收编、全量 919 例三方一致；CI 触发证据 environment-blocked（push/PR 归 runner，非门禁失败） |
| 19 | 20:52 | SA4 | Phase 3 合规修订 | 20:56 | HG14 token 补齐：R3 节追加「§1.4 vitest 触发性自检：all-vitest-packages-triggered」结论行（verdict=pass 不变） |
| 20 | 20:52 | SA7 | Phase 3 合规修订 | 20:56 | HG12 verdict 行格式化：报告末节改独立行首「verdict: pass」行（内容如实不变） |
| 21 | 20:59 | 总控 | Phase 3.5 AC 门禁 | 20:59 | AC 7 条逐条核对全 ✅（ac_checklist.md）；AC7 CI 动态段按职责边界移交 issue-runner；无 ❌ 无追加派发 |
