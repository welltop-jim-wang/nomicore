# SA9 Standards Review — CI repair HEAD `7ac6570`：根锁 stale-reclaim 串行化（PR #276 `test (24, 4)`）

> Phase：standards-review（iteration 1）。Dispatch：`sa-eba08365-c8b4-4ae3-9ef3-7eeec9da09fc`（mabf-sa9）。
> 评审对象：committed HEAD `7ac6570ed989aaa49afa7a0767560b98f1d3797e`（"fix(yjs-server): serialize
> root lock reclamation"），parent PR #158 base 已核实 `a1ca2d72303b6868b8bf78ac6bee716cdf89be59`
> （本仓基线 `334494d` 即 CI 失败 head，与 SA6/SA1/SA2/SA8 各轮证据同一性一致——本轮 `git log` 亲证）。
> Issue comments REST = `[]`：无 Owner 追加要求可映射。
> 评审范围（SA9 授权面）：根锁 stale-reclaim 正确性、仓标准（AGENTS/ADR/模块责任/架构惯例/单一事实源/
> 生命周期对称性）、文件范围、测试质量、文档同步、回归风险。**不**评审 Issue 需求完备性（SA10 面）；
> 未修改任何代码/测试/设计，未运行测试/服务（静态评审 + 既有可执行证据复核）。
> **结论：approve（无 BLOCKER/MAJOR；2 条 MINOR 非阻断观察 OBS-1/OBS-2 如实登记）。**

## 1. 评审方法与输入

| 输入 | 结论 |
|---|---|
| `git show 7ac6570`（16 文件 +3136/-69）与 `git diff 334494d..HEAD` 全量亲读 | 变更面 = `apps/yjs-server/src/lifecycle.ts` + 2 新测试文件 + 2 文档行 + wiki 证据 11 件 |
| `wiki/raw/task_ci-pr-276_design.md`（SA1 iteration 5，808 行） | 全文亲读（§7 机制、§8.1 定稿文案、§8.2 状态机、§9 终止性、§11 ALLOW/DENY、§12 E1-E9d、§13 R1-R8、§14 P1-P10、§15 映射、§16 免回炉论证） |
| `wiki/raw/task_ci-pr-276_sa2_review.md`（iteration 4 **pass**） | 亲读；#12 A1-A4 闭环核验与变异红灯性模拟采纳为裁决基础 |
| `wiki/raw/task_ci-pr-276_sa3_impl.md` / `task_ci-pr-276_sa4_review.md`（**clear**） | 亲读；ALLOW/DENY 核证、V1-V14 证据、变异矩阵、OBS-1–OBS-4 登记复核 |
| `task_ci-pr-276_design_conflict_report{,_iter3,_iter4}.md`（SA8 四轮均 clear） | 亲读；关门重触发条款（fsync / packages 与 ADR-0006 / 公共导出与 STABLE_OP_ERROR_CODES / CONTEXT.md 域词 / ALLOW-DENY 扩界 / 5000ms 进配置面）本轮逐项独立复核**均未触** |
| 仓标准基准 | 根 `AGENTS.md`、`apps/AGENTS.md`、`apps/yjs-server/AGENTS.md`（变更后文本）、`docs/AGENTS.md`；`docs/adr/` 根锁词族管辖缺席由 SA8 四轮 grep 零命中复核一致；`CONTEXT.md` 零触碰 |
| 冻结契约/夹具 | canary（143 行全文亲读）、stress、fixture（24 行全文亲读）——`git diff` 对三者 + `main.ts` + `src/index.ts` + `packages/**` + CI 装置（ci.yml / ci-test-shard.mjs / vitest.config.ts）+ `CONTEXT.md` **均为空**（亲证） |

## 2. 根锁 stale-reclaim 正确性（独立代码级复核，非采信上游结论）

对 `lifecycle.ts`（503 行全文亲读）逐路径重放，结论 = 协议内无反例：

1. **I2 成功出口唯一**：`published=true` 仅在 `renameSync(staging→canonical)` 成功后置位（L325-327），
   `break` 仅在 `if (published)` 臂（L347）；镜像发布失败 ⇒ 门内 `rmSync` 自清理（唯一 recursive 例外，
   #10 注释在位 L344）+ rethrow。无第二条成功路径。✓
2. **I1 canonical 首次可观察即完整**：CAS 单元 = 私有 staging 目录（完整 `owner.json`，wx 卫生位），
   rename 单系统调用原子携带——旧代码「mkdir 空目录 → wx 写」的双活窗口（CI 红根因）结构性消除。✓
3. **claim 门（I0 防线一）**：挂名 = `linkSync`（原子、内容随 inode 完整，修复旧 `wx` 空窗）；EEXIST
   ⇒ 读内容判活/判死；死持有者接管 = rename-detach 单胜者 + 墓碑内容复核 + 活则回复位；释放 =
   内容校验 unlink（L211-217，只删自己 nonce 的 claim）。✓
4. **D6 有界等待（I3）**：计账键 = claim 内容（nonce = 占用身份），同内容连续判活 ≥ 5000ms ⇒
   `claimStuckError` loud（`performance.now()` 单调时钟，备选 11 否决 `Date.now()` 的论证成立）；
   更替/缺席/挂名/接管 ⇒ 重置；**绝不夺门**（超时不删不移他人 claim、不触 canonical——备选 9 否决
   理由成立）。✓
5. **证据门控阶梯**：非空死 payload 双读摘除链（复读守卫 → rename 摘除 → 墓碑比对 → 不等回复位/
   loud movedHeld）原样内联；`''` 证据永不触发目录 rename 摘除——absent ⇒ 回环 CAS；L1 空目录 ⇒
   rmdir（空目录语义兜底）；stray-nondir ⇒ rename 摘除 + unlink（SA3 偏差 1：`rmSync(force)` 对
   symlink-to-dir 抛 EISDIR，改 `unlinkSync`——SA4 V14 探针复验成立，语义即「摘除非目录名」，正确）；
   L2/杂散条目 ⇒ 门内逐项清障 + rmdir，子目录单遍 rmSync（无 maxRetries，D4/P8 合规）。errno 契约
   （#11）逐 catch 核对：ENOENT/ENOTEMPTY ⇒ continue 复检；EACCES/EPERM ⇒ 既有 loudUnwritable
   （文案逐字未变）；其余 honest rethrow。✓
6. **终止性**：门内每轮 = 一次确定结果的原子操作或有界预算等待；活 owner ⇒ held loud；活 claim ⇒
   ≤5000ms loud；死/遗留/杂散 ⇒ 清障后 CAS 收敛；无「无出口空转」路径。✓
7. **release() 原样**（L449-484）：rename 摘走 + payload 比对 + 只删自有目录 + 镜像内容校验删除；
   幂等；迟到 release 守护保留（canary「late release cannot remove a successor」钉位不变）。✓
8. **生命周期对称性**：acquire 建 canonical + 镜像 ⇔ release 拆二者；staging/claim-staging 任何出口
   finally 清理（NEW⑤ L434-447，claimStuck 出口亦然）；claim 每轮迭代释放；墓碑同调用内删除；
   SIGKILL 残留 = 有界瞬态名族（R2）+ 文档人工清理口径。对称、有界、可运维。✓
9. **claimStuck 文案**：程序化复核（本轮亲跑 node 串比对）——与设计 §8.1 定稿**逐字符一致**；
   钉位 regex `/reclaim claim .* occupied by a live pid .*\(pid reuse caveat/` 匹配；与两冻结契约
   败者 regex `/held|unsupported/` **不相交**（`holder` 不含子串 `held`）；五要素齐全（claim 名/
   持有者/上限/处置指引/pid-reuse-caveat）；未混入 `STABLE_OP_ERROR_CODES`（L487-503 原样）。✓

## 3. 仓标准符合性

| 维度 | 结论 |
|---|---|
| 根 AGENTS「读最近嵌套 AGENTS 再改动」 | SA3 输入表亲证履行；模块边界句（apps/yjs-server/AGENTS.md Boundaries 末条）与实现**同变更集同步**且措辞准确（原子 rename 发布 / `.reap-claim` 门 / 有界等待 loud） ✓ |
| 模块责任（apps/AGENTS.md） | 根锁属 app 组合根自身生命周期职责；改动不移动任何 package 契约；`packages/**` 零触碰（diff 空） ✓ |
| ADR/CONTEXT.md（docs/AGENTS.md Authority） | 根锁词族在 `docs/adr/` 14 文件与 `CONTEXT.md` 零管辖（SA8 四轮独立 grep 复核一致）；D6 未引入共享域词；无 ADR 被抵触或沉默改写；SA8 N1″ 轻量 ADR advisory 归 owner/总控裁量，非本票义务 ✓ |
| docs/AGENTS.md Editing「代码行为变化 ⇒ 同变更集更新每份规范文档」 | 两份陈述根锁机制的规范文档（deployment §锁文件与共享 root、yjs-server AGENTS.md）均随本变更集更新；旧「`mkdir` 是唯一获取线性化点」句无残留（全仓 grep：仅 wiki 历史证据与冻结契约头注保留，后者锚定 head `334494d` 属 DENY 原样保存） ✓ |
| 单一事实源 | 瞬态名族 = 5 个模块私有常量（L28-33，none exported）全实现一致使用；测试侧 `CLAIM_NAME`/`WAIT_LIMIT_MS` 镜像为文档化 oracle（设计 §11 批准的钉位形态）；磁盘契约稳定面（owner.json/镜像字段路径）零变化 ✓ |
| 架构惯例 | 错误族沿用 plain `Error` + regex 钉位惯例；`loudUnwritable`/`heldError` 三族冻结文案逐字未变；同步签名不变（备选 12 否决异步化）；无生产测试钩子（SA6 §15/SA8 F6/SA2 三方否决维持） ✓ |
| 文件范围 | ALLOW 四行一一对应（lifecycle.ts / 新测试文件 / deployment doc / AGENTS.md）；DENY 零触碰（本轮 `git diff` 亲证：canary、stress 字节、fixture、main.ts、index.ts、packages、CI 装置）；新测试被 shard 磁盘枚举自动收录（SA2/SA4 亲证）；`git diff --check` 干净；committed 文件 mode 全 100644 ✓ |

## 4. 测试质量

- **新契约 `root-lock-atomic-publication.test.ts`（9 用例）**：无 skip/only/todo（grep 亲证）；行为级
  多锚断言（恰 1 acquired + 败者 regex + owner=镜像=winner + 无 reap 族残留）；T7a 七件断言含
  ②′ 墙钟下界（同一 `performance.now` 包夹）与 ⑥ 文案不相交（守卫性质本身钉为被测契约）；T7c 内联
  `node -e` 助手原子换名（禁 unlink+write 空窗，nonce 经 argv + 字节级轮询确认后再进同步 acquire——
  SA2 §15 红线注意三条全落实）；分段 ≈2800ms×2（合计 >5000、单段 <5000，δ 预算 ≈600ms，O-13(b)
  采纳）；超时兜底 30s/120s 在位；afterEach 组杀 + rootDir 清理；T7a→T7b 共享 root 的 park/
  re-register 失败路径安全（T7a 早红时 root 仍在清理注册表）。
- **变异敏感性证据（设计 §12 义务）**：SA3 一次性 M1 自检（不入库）+ SA4 V9 副本矩阵——M1/M1b/M0/
  M2-real/M3 五类不安全变异各有确定性红灯、合规实现全绿；净级保证成立（O-14 边界情形由 T7c 兜底）。
- **冻结契约零弱化**：canary/stress/fixture 字节原样；败者 regex、恰 1 acquired、owner+镜像=winner
  断言全保留；stress 头注「mkdir is the acquisition linearization point」为锚定 `334494d` 的历史
  引文，DENY 原样保存属设计裁定，非失实。
- **负面对照**：stress 含顺序交接与活 owner 排斥两负控；T5 钉位死 claim 自动接管 + 全名族不干扰。

## 5. 文档同步

- deployment §锁文件与共享 root：机制句（原子发布 + claim 门 + 门等待有界 5000ms loud）、stale 回收
  句、Windows/非 POSIX 能力句（诊断准确性是承诺、回收成功率不是——R1 如实矩阵）、claim 卡死
  症状→处置句（引文 `still occupied by a live pid … 5000ms` 与实现文案一致）、L250 pid 复用句
  不覆盖 claim 形态的注记、单调时钟/suspend 墙钟注记（#13 方向正确）全部在位；其余语义句零变化。
- 引用完整性：claimStuck 文案指向 deployment doc，处置段落在位（L254-258）；无死链。

## 6. 回归风险登记（协议外/已披露面）

- R1 Windows 非一等：句柄滞留时 stale 回收 loud 失败——文档能力句同步，非新增暴露。
- R4 pid 复用误判：claim 侧从「无界挂死」改为「≤5000ms loud + 人工恢复」——方向收紧，暴露面缩小。
- R5/O-9：合法持有者被调度饥饿 >5s 的极端形态下两冻结契约真实转红——设计登记的守卫语义
  （可见优于隐匿），CI 实测未出现（SA3/SA4 多轮全绿 + V7 同形分片 453 测试绿）。
- R7 混版本共享 rootDir：维持单 rootDir 单二进制假设，不扩支持面。
- 事件循环同步自旋 ≤5000ms/次连续占用 ≪ 60s watchdog（B12），预算变更须回炉 SA8（R8 登记）。
- 未决 follow-up（均设计明示可选、不阻塞）：R2 机会式清扫、R3 诊断输出/轻量 ADR、Atomics.wait 退避。

## 7. 非阻断观察（MINOR，不阻断 approve，登记供后续顺手项）

- **OBS-1（文档完备性，沿 SA4 OBS-1，本轮亲证在场）**：deployment doc L251-253 的 transient 名族
  括号清单未显式列 `.nomicore-lock.acquire-<uuid>`（设计 §11 ALLOW 第 3 行清单含之；该名已在前句
  机制描述 L235 出现，「其余」上下文可读为涵盖）。建议后续文档顺手项补一词；不影响行为与验收。
- **OBS-2（代码注释精度，本轮新登记）**：`takeReapClaim` 回复位分支注释（L189-195）称「restore it,
  or discard when the pathname was already re-occupied」——POSIX 上 `rename(文件 → 已存在常规文件)`
  为**原子替换成功**而非失败（catch 实际只覆盖 EACCES/EPERM/目录占用等协议外形态）。真实竞态结果 =
  经判活复核的旧 claim 被复位、新 claim 被替换（被替换方成为无门参与者）。安全性由更深防线承载、
  结论不变：无门方全部 destructive 操作均为单胜者 rename / 名称条件 unlink / 空目录条件 rmdir /
  CAS 单胜者（设计 §8.3-6 瞬态双回收者论证同构覆盖），任何交错下不产生双 owner（SA4 12 路接管
  风暴 + 140 轮 burn + 对抗场景 A-H 独立复核一致）。注释对机制的表述失准可能误导后续维护者对门的
  排他性推理；建议后续注释勘误（行为无需变更）。

## 8. 结论

- 正确性：结构性双活消除（I0/I1/I2 落地且经独立代码级重放 + 上游 140 轮 burn / 12 路风暴 / 对抗
  探针交叉验证）；D6 有界 liveness（I3）与恢复语义双向钉位；claimStuck 文案与冻结 regex 不相交
  经程序化复核。**通过。**
- 仓标准：AGENTS/ADR/CONTEXT.md 管辖核对无冲突；模块责任与组合根边界保持；单一事实源与磁盘
  契约稳定面零漂移；文件范围 ALLOW 四行一一对应、DENY 零触碰；文档同变更集同步。**通过。**
- 测试质量：无弱化、无 skip/only、行为级多锚、变异敏感性证据在位、负控在位。**通过。**
- 回归风险：全部为设计已披露且有文档/测试钉位的协议外面；无新增未登记风险。**通过。**

**Verdict: approve。** 2 条 MINOR 观察（OBS-1 文档清单措辞、OBS-2 注释精度）不阻断合入，
登记为后续顺手项。真实 PR #276 CI 远端重跑属总控/CI 裁决面；本地同形证据（SA3/SA4）已满足
设计 §12 实现侧要求。
