# SA7 动态验证报告 — issue #134 Round 2（Phase 5）

**Date**: 2026-08-28
**Verdict**: **PASS**
**验证基线**: HEAD `1128ef7`（worktree `/home/wangjian/nomicore-fix-issue-134`）
**输入**: 任务简报 `_round2.md`、设计 R2.2.1 `_round2_design.md`、SA4 验尸 `_round2_sa4_review.md`（终态 pass，§四 5 项移交）
**FAIL 条件核对**: 契约级行为与设计 R2.2.1 不符 → **零命中**；测试红灯 → **零命中**（全量/满载/稳定性/五组直构探针全绿）。

---

## Step 0：SA4 verdict 校对

`_round2_sa4_review.md` L4：**pass**（F-1 复审追节闭合，增量 1e2c748 + 1128ef7 核验通过）→ 进入动态验证。SA7 仅在 SA4 pass 基础上独立验证，未下调、未上调 SA4 verdict。

**执行环境**: yjs **13.6.32**（`packages/namespace-runtime/node_modules/yjs` 符号链接实证）；全部测试命令经独立后台进程（`setsid nohup`）；探针脚本置于 `.mabf-bg/`（gitignore 域，**不入仓**——`git status` 零污染）；零生产代码触碰。

---

## 一、稳定性与全量复跑（简报 item 6）

| 项 | 命令（独立后台进程） | 结果 | 日志 |
|---|---|---|---|
| 全量复跑 | `pnpm test`（= vitest run --typecheck，forks 单 fork/timeout 60s） | **141 文件 / 1735 用例全绿 / Type Errors: no errors / exit 0 / 46.01s** | `.mabf-bg/r2sa7-full.log` |
| round-2 三文件 ×3 连跑 | `vitest run <runtime-round2 + runtime-round2-red + registry-round2-red>`（forks 单 fork）×3 | **3×54/54 全绿、exit 0、零 flaky**（25+17+12=54 恰与 SA4 冻结计数一致） | `.mabf-bg/r2sa7-stab-{1,2,3}.log` |

全量数字与总控亲验（`.mabf-bg/r2b-test.log`）及 SA4 F-1 复审记录逐字一致。

## 二、R-2'：red #9 墙钟 forks 池满载复跑 ≥3 次（SA4 移交 #1 / SA8 R-2'）

**协议**（SA2 #3 原文）："red #9 在 vitest forks 池 + 并行满载下复跑 ≥3 次记录 elapsed 分布，断言最坏值 < 400ms 且与 §4.3(d) 修正后区间一致"。

**执行**：全量 141 文件、`--pool=forks --poolOptions.forks.maxForks=4 --poolOptions.forks.minForks=2`（4 核机——池满载：4 fork worker 并行竞争 CPU）+ `--reporter=verbose` 提取单测耗时，串行 ×3，与其他 CPU 任务零重叠。

| 轮 | 全量结果 | red #9 单测耗时 | red #7 | red #8 |
|---|---|---|---|---|
| 1 | 141/141 绿 | **194ms** | 2ms | 5ms |
| 2 | 141/141 绿 | **193ms** | 2ms | 4ms |
| 3 | 141/141 绿 | **202ms** | 2ms | 4ms |

**结论**：
- **最坏值 202ms < 400ms**（断言阈），**裕度 198ms**——满载下 3/3 稳定绿（`.mabf-bg/r2sa7-load-{1,2,3}.log`）。
- **如实对照 §4.3(d) 修订区间 240–390ms**：实测 193–202ms **低于区间下界 240ms**——与设计 R2.2 N'-3 修订措辞逐字吻合（「低于区间下界 240ms（方向更优：实际交错交付与写开销低于区间估算的保守端；区间为上界包络而非点估计）」）。本机满载数字与 SA3 隔离单跑（187–227ms，3/3）同域；区间上界包络在更慢 CI 环境仍成立（202ms 对 400ms 阈值裕度充足）。
- `needsResync === true` 确定性部分与墙钟解耦（涨满单向），3/3 恒绿。
- 附带：red #13（beforeTransaction → committed:false）2ms、red #14（afterTransaction → committed:true）1ms 亦满载绿——§7 行为锚在满载下无漂移。

## 三、R-1'：F-4 beforeTransaction 次序假设敌意实测（SA4 移交 #3 / SA8 R-1'）

**源码依据先行**（yjs 13.6.32 `src/utils/Transaction.js` L412-448 实读）：`doc._transaction` 置位（L421）→ `doc.emit('beforeTransaction')`（L426）→ 事务函数 `f(doc._transaction)`（L429）；emit 位于 try 块之外——emit throw 时 f 零执行。

直构探针 `.mabf-bg/r2sa7-probe-r1.ts`（11/11 PASS，日志 `r2sa7-probe-r1.log`）：

| # | 敌意面 | 实测 | 对照设计 |
|---|---|---|---|
| A1 | emit 先于事务函数 | 事务函数内见 flag=true | §7.1 判据健全性前提 ✓ |
| A2 | 注册序同步派发 | 两轮事务均 `[L1,L2]` | §7.1「listener 次序依据」✓ |
| A3 | 先注册敌意 throw | 后注册探针**不运行**、事务函数**零执行**（k1=undefined）、throw 逃逸给槽 catch | 探针注册于槽内=最后注册者 ⇒ txStarted=false ⟹ committed:false 精确 ✓ |
| A4 | afterTransaction throw | mutation 已保留（k1=1） | committed:true 方向 ✓（red #14 同构） |
| A5 | 复合敌意（先变异后抛） | 探针不运行 + poison 变异已滞留（yjs 无 rollback；变异并入 emit 前已开启的事务） | **under-report 方向（committed:false 而可能已变异）——与 D-4 例外注记登记方向逐字一致**（本域不承诺精确，仅登记方向）✓ |
| B1 | 真实 runtime 敌意 beforeTransaction | RuntimeWriteFatalError **committed:false** + ROOT 零变更 + fatal 置位 + notifyDirty 0 次；fatal 后续 apply 被门拒 | §7.1 机制 ✓（red #13 之外独立复证） |
| B2 | 双敌意 thrower | 首个 thrower 截断 emit ⇒ committed:false | 注册序派发 ✓ |
| B3 | 真实 runtime 敌意 afterTransaction | **committed:true** + mutation 保留 | §7.1 保守分支 ✓（red #14 同构） |
| B4 | 正常 apply 前置 | ok:true | 探针零副作用 ✓ |

**R-1' 结论**：Yjs 13.6.32 次序假设（emit 先于事务函数 + 注册序派发）经敌意实测成立，committed 二分行为与设计 §7 逐项一致；复合敌意 under-report 残余风险方向与 D-4 登记一致（不构成违约）。

## 四、敌意 core 直构 → unhandledRejection 0（简报 item 5 / SA4 移交 #4 可选——R2.2 偏离 3 承接）

真实 `createLeaseController` + 敌意 `openReplicationSessionCore` seam 直构 hostile core（探针 `.mabf-bg/r2sa7-probe-hostile.ts`，7/7 PASS，`r2sa7-probe-hostile.log`）：

| # | 敌意 close 返回 | release 结果 | unhandledRejection |
|---|---|---|---|
| H1 | `{ catch: () => Promise.reject(...) }`（SA4 §四-4 原型——假 catch 返回 rejecting） | 恒绿 + released + onReleased 恰一次 | **Δ0** |
| H2 | 敌意 thenable（异步 reject） | 同上 | **Δ0** |
| H3 | 同步 throw | 同上 | **Δ0** |
| H4 | then getter 同步 throw（同化期） | 同上 | **Δ0** |
| H5 | undefined（非 thenable 原始值） | 同上 | **Δ0** |
| H6 | thenable 同步 reject（adopted rejection） | 同上 | **Δ0** |

**全程进程级 unhandledRejection 总计数 0**——`Promise.resolve(closing).catch(()=>{})` 同化加固（R2.1 / SA2 #5）经六型敌意活链路闭合；二次 release 幂等（close 不再被调）。

## 五、比较层敌意直构（SA4 移交 #5 可选 / SA2 N'-2 表征）

探针 `.mabf-bg/r2sa7-probe-cmp.ts`（5/5 PASS + 4 条表征，`r2sa7-probe-cmp.log`）：

| # | 敌意面 | 实测定性 | 对照登记 |
|---|---|---|---|
| C1 | live META 种子 Y.Map own `toJSON` 覆写（白名单容器、比较层可达面） | apply 以**裸 Error reject**（非 RuntimeWriteFatalError）、**无 markWriteFatal**、ROOT 零写入、runtime 存活、零 unhandledRejection | **与 SA4 §6 残余确认/SA2 N'-2 定性逐字一致**（种子信任域，合法 raw 路径不可达——本轮不要求修复）✓ |
| C2/C3 | plain 值 getter-throw / Proxy ownKeys-throw 种子面 | `meta.set` **不即抛**——毒延迟至 encode 期（`Y.encodeStateAsUpdate(live)` throw `hostile-ownKeys-C3`） | 种子面表征修正（非即抛域）：yjs writeAny 延迟读取 ⇒ set 成功、encode 暴露 |
| C3c | live 投毒后 apply 槽落点 | R4 scratch 预演第一步 encode live 即抛 → 预演 try/catch 收编 → **拒 `REPLICATION_RAW_UPDATE_INVALID` + 零写入** | 保守方向闭合（拒 + 零写入；码语义面向「字节」但方向安全——种子信任域表征） |
| C4 | 对照：普通 Y.Map 容器 + ROOT-only | 放行 ok:true | 白名单容器正常路径活链路 ✓ |

## 六、泵活链路（简报 item 3）

探针 `.mabf-bg/r2sa7-probe-pump.ts`（13/13 PASS + 1 条表征，`r2sa7-probe-pump.log`）：

| # | 面 | 实测 |
|---|---|---|
| P1 | 400ms 同步自旋 listener 下 mutateRoot/apply 槽 | 写槽 2ms / apply 槽 1ms（<250ms，槽恒先于 listener 调用——§4.3(a) 活证据） |
| P2a/b | 重入 listener（投递点内同步再写 doc） | 首写槽不阻塞；链条收敛：deliveries=4 = 首写 + 3 重入项（at-least-once 全投、无死锁） |
| P2c | listener 内 close 自身 | 投递恰 1 项、后续写零投递、终态 closed、进程存活（快照迭代 + 终态双闸） |
| P3a | 跨 channel：B（快）先 attach、A（慢 400ms）后 attach | **B 首投递延迟 0ms——不被 A 拖累**（B 泵调度序在前） |
| P3b | 表征：A（慢）先 attach、同写并发 | B 首投递延迟 400ms（让过 A 的一次自旋）——单线程微任务 FIFO 物理事实；**设计承诺面 = 每 channel 机制独立（队列/泵分离）+ 槽公平性（§4.3(a)/(b)，均实测成立），未承诺跨 channel listener 投递墙钟隔离**——非契约违约，登记 N 级表征（见 §十一） |
| P4 | 溢出 → sticky + 继续投递 + 槽零阻塞 | 64 突发 229-231ms（<400ms）；needsResync=true；排空后投递 31 项（弃新保旧活证据：64 - 弃 33 ≈ 31 投递）；排空 + 后续写正常投递后 **needsResync 恒 true（sticky 不回落）** |
| P5 | 泵 finally 复位无泄漏（长跑） | 500 轮节奏写 **deliveries=500/500 精确 + needsResync 恒 false**（泵全程跟上、无丢失/重复/停摆）；close 后 idle 300ms **零幽灵投递**；close 后新 session 照常投递（泵机制无残留卡死）。附带表征：500 轮无节流快速突发 → 140/500 投递 + 溢出弃新（容量 16 契约行为，非泄漏） |

## 七、fence/terminate 活链路（简报 item 4）

探针 `.mabf-bg/r2sa7-probe-fence.ts`（18/18 PASS，`r2sa7-probe-fence.log`）：

| # | 面 | 实测 |
|---|---|---|
| F1 | bump 活链路 | 基线投递 1 → bump ok → 旧 session **conflicted**（frozen epoch=1 不漂移 / current=2）→ bump 后新写**零投递** → 旧 session apply 拒 `REPLICATION_EPOCH_CONFLICTED` 零写入 → **同 remote 新 session 重建：apply 正常接纳（k2=2 落盘）+ 本地写照常收投（events=1，apply 回声抑制正确）** |
| F2 | bump 打断进行中泵 | 慢消费者（20ms/项）+ 8 快速写 → 未排空即 bump → 充分排干后**零新增投递**（未投递排队项取消）+ conflicted 终态 |
| F3 | runtime close 活链路 | notify 门未放行前 apply 与 close 均未 settle → 放行后 **order=[apply, close]**（在途 apply 先于 barrier 排空）→ 双 session 均 **closed** 终态 → close 后 apply 拒 `RUNTIME_WRITE_DISABLED` + 写拒 + 存量 listener 零投递 |
| F4 | lease release × in-flight apply | 真实 `createLeaseController` + 真实 runtime core seam：release **0ms 同步完成**（不等 notify 门仍闭的在途 apply）+ released 可观测 + onReleased 恰一次 → 放行后**在途 apply 照常完成**（k1=1 落盘，不被取消——ADR 0009 L42）→ release 后 apply 拒 `NAMESPACE_LEASE_RELEASED` → 结算序 **[release, apply]** |

## 八、版本号与文档存在性冒烟（简报 item 7）

| 项 | 结果 |
|---|---|
| `packages/namespace-runtime/package.json` | **0.1.10** ✓ |
| `packages/namespace-registry/package.json` | **0.1.6** ✓ |
| ADR 0010 round-2 小节 | L265 起在场；D-1（异步化全文：容量 16/让步 20 双向 load-bearing/弃新置 sticky/at-least-once 冻结句/L113 字面实现/L241 收窄）、D-2a（E5.5 fence + 排队项取消 + enable 不 fence）、D-2b（terminateAll + closedBy→RUNTIME_WRITE_DISABLED 映射 + 显式 close 保持 REPLICATION_SESSION_CLOSED + encodeStateVector/encodeDiff 确定 throw）、D-3（R2.2 口径白名单全文）、D-4（二分 + under-report 方向）逐段在场 ✓ |
| runtime README | Lifecycle close 增补（close 同步终止 sessions/RUNTIME_WRITE_DISABLED/FIFO 排空）+ Contract sources fanout 投递模型（needsResync sticky/at-least-once/零阻塞）+ 生命周期边界 ✓ |
| registry README | Plugin configuration（role 'hub'\|'peer' 缺省 hub/非法 loud 拒）+ 生命周期边界（release 同步 close/hostile seam 隔离）+ status 词汇含 needsResync ✓ |

## 九、Spec / vitest 触发证据（Step 3 / Step 4）

- **E2E spec（Step 3）**：本任务设计 ALLOW LIST 零 `*.spec.ts`——不触发。
- **vitest（Step 4）**：设计含 3 个新增 `*.test.ts`（runtime round2 / runtime round2-red / registry round2-red），均在本轮全量与满载 run 中**真实执行且全绿**（verbose log 逐条 `✓` 可查，`.mabf-bg/r2sa7-load-{1,2,3}.log`）。CI 动态 run 摘录待 push 后产生（SA7 不负责 push）；静态面 `.github/workflows/ci.yml` 含 vitest 触发，无 `vitest-package-not-triggered` 迹象。
- **分类**：3 文件 = ✓ 触发且通过（本地独立进程 ×（1 全量 + 3 稳定 + 3 满载）= 7 轮真实执行记录）。

## 十、缺陷登记

**契约级缺陷：0**（无任何行为与设计 R2.2.1 不符；无测试红灯）。

**N 级观察（不阻断，供后续参考）**：

| # | 观察 | 定性 |
|---|---|---|
| N-1 | 跨 channel 并发首投递的墙钟交错（P3b）：慢 channel 先 attach 时，同写并发的快 channel 首投递让过慢 channel 的一次自旋（实测 400ms）；快 channel 先 attach 时零拖累（P3a，0ms） | 单线程微任务 FIFO 物理事实；设计承诺面（每 channel 机制独立 + 槽公平性）均实测成立；设计未承诺跨 channel listener 投递墙钟隔离——非违约。若未来需要严格隔离属切片 6（transport/背压）域 |
| N-2 | Proxy/getter 毒物种子面非「即抛」：`meta.set` 成功、毒延迟至 encode 期暴露（C2/C3）——比 SA4 首轮探针的「Map/Set 即抛」描述多一类延迟域 | 种子信任域表征；终态落点保守（拒 + 零写入，C3c 经 R4 预演收编） |
| N-3 | live 投毒 encode 抛被 R4 收编为 `REPLICATION_RAW_UPDATE_INVALID`（码语义面向字节、实因 live 毒） | 种子信任域不可达面；方向安全（保守拒零写入）；与 N'-2「本轮不要求」定性一致 |
| N-4 | 500 轮无节流快速突发下投递 140/500（容量 16 溢出弃新 + needsResync 置位） | 契约行为（§4.4 弃新保旧/sticky）非泄漏；节奏域 500/500 精确（P5a） |

## 十一、结论

**Verdict: PASS**。

- SA4 移交 5 项全部闭合：#1 red #9 满载 ≥3 次最坏 **202ms < 400ms**（低于 240ms 区间下界与 R2.2 N'-3 措辞一致）；#2 red #7/#8 满载最坏 **2/5ms**（250ms 阈裕度 ≥245ms）；#3 R-1' 次序假设敌意实测成立（库级 5 面 + runtime 级 4 面）；#4 敌意 core 六型直构 **unhandledRejection 总计 0**；#5 比较层敌意表征与 SA2 N'-2/SA4 §6 登记逐字一致。
- SA8 残留 R-1'/R-2' 复核闭合（§三/§二）。
- 泵/fence/terminate/lease 活链路 48 项断言全绿（13+18+7+5+探针内附带）；溢出 sticky、排队项取消、FIFO 排空序、release 同步失效 + 在途 apply 不取消均实测兑现。
- 稳定性：三 round-2 文件 ×3 连跑零 flaky；全量 141/1735 复跑绿；满载 ×3 全绿。
- 版本 bump 与 C-1' 文档五面冒烟在场。

**产物**：
- 本报告：`wiki/raw/task_namespace-lease-replication-session_round2_sa7_report.md`
- 探针（不入仓，gitignore 域）：`.mabf-bg/r2sa7-probe-{r1,pump,fence,hostile,cmp}.ts` + 对应 `.log`
- 测试日志：`.mabf-bg/r2sa7-full.log`、`r2sa7-stab-{1,2,3}.log`、`r2sa7-load-{1,2,3}.log`
- 零生产代码触碰、零仓库测试文件改动（本任务无新增破坏性测试必要——SA6/SA3 锚已覆盖全部契约面，SA7 直构探针以不入仓脚本完成敌意/活链路补充）。
