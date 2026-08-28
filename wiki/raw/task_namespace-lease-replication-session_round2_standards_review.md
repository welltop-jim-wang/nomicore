# Standards 轴终审报告 — issue #134 Round 2 修订轮（PR #146 评审 12 项闭环）

- **Date**: 2026-08-28
- **审查轴**: MABF 双轴终审 · Standards（仓库标准 / 工程实践视角；Spec 符合性由 Spec 轴承担）
- **审查 diff 范围（明示）**: `git diff 4cfaffd..HEAD`（HEAD = `1128ef7`）——5 commits（8a68d82 SA3 实现 / 2a7117a M-1 收口 / 9cfc1b6 SA6 同步 / 1e2c748 设计 R2.2.1 / 1128ef7 F-1 补锚），**21 文件，+3249/−87**
- **必读输入（已全读）**: 任务简报 `_round2.md`、设计定稿 R2.2.1 `_round2_design.md`（726 行全文）、流水线档案（`_round2_sa6_red.md` / `_round2_sa2_review.md` / `_round2_sa4_review.md`（含 F-1 复审追节）/ `_round2_sa7_report.md` / `_round2_ac_checklist.md` / `_round2_conflict_report.md` / `_round2_design_conflict_report.md` / `_round2_sa3_impl.md`）、round-1 基线档案（含 round-1 standards_review 先例）、仓库约定参照（根 AGENTS.md、`packages/namespace-runtime/AGENTS.md`、`docs/AGENTS.md`、CONTEXT.md、docs/adr/0006–0010 相关节、既有测试头注先例）
- **方法**: 全量 diff 逐文件过（21/21）+ 关键声称 grep/read 独立实证（不轻信档案自我声明）+ 全量测试后台独立进程亲跑（`setsid nohup`，日志 `/tmp/mabf-std-review/full-test.log`，仓库零污染）
- **Conclusion**: **pass**（0 hard violation / 2 minor / 6 info，全部不阻断）

---

## 一、验证证据（本人亲跑 / 亲验）

| 验证 | 命令 / 方法 | 结果 |
|---|---|---|
| 全量测试复跑 | `setsid nohup pnpm test`（= vitest run --typecheck，后台独立进程） | **141 文件 / 1735 用例全绿 / Type Errors: no errors / 45.60s**——与 SA4 复审/SA7/总控亲验数字逐字一致 |
| whitespace | `git diff --check 4cfaffd..HEAD` | exit 0 |
| 文件清单 vs 设计 §17 ALLOW/DENY | `git diff --name-only` 逐路径比对 | 21 文件全部在 ALLOW 内 + wiki 白名单 1（设计档案自身）；**DENY 零触碰**（index.ts/internal.ts/write.ts/close.ts/sequencer.ts/errors.ts/status.ts/p0.ts/projection.ts/read.ts、registry 六文件、exports/dependencies、persistence/doc-runtime/vfsl/replication-protocol/apps/domains 均不在清单） |
| BLACKLIST | name-only 清单扫描 package-lock/yarn.lock/.DS_Store/TASK.md/*.bak/.mabf-bg | 零命中 |
| PEER_ALLOWED_META_KEYS 删除 | 全域 grep | 仅余 replication-session.ts:329 删除登记注释，零引用零残留定义 ✓（R2-12 兑现） |
| fenceStale 生产调用点 | grep `packages/*/src/` | 恰一处 = replication-write.ts:423（bump 槽 E5.5'）；**enable 槽零 fence**（显式裁决兑现）✓ |
| 冻结常量 | replication-session.ts:145/151 | `FANOUT_CHANNEL_QUEUE_CAPACITY = 16` / `FANOUT_DELIVERY_DEFERRAL_MICROTASKS = 20`，模块私有 + 双向 load-bearing 注释 ✓ |
| needsResync sticky | grep 写点 | 唯一置位点 :258（溢出），初始化 false，**无任何清除路径**——sticky 成立 ✓ |
| Equal 锁格架 | grep | registry.ts:126/127 跨包双锁 + lease.ts:434 自锁在场；status 第 11 字段 needsResync 经两点同步（runtime core + registry types），typecheck 0 错误实证编译器强制 ✓（R2-12 收敛格架演示成立） |
| 公共面纪律 | diff 结构证明 + 读码 | Runtime 对象十二键（runtime.ts 零键增删——terminateAll 经既有 fanout 局部量调用）；session 能力对象恰十键（replication-session.ts:401 起逐键数过）；index.ts/internal.ts 零改动 ✓ |
| 死导出回流项 | grep runSessionApplySlot | round-1 终审 minor #1 已闭环——:553 现为非导出函数 ✓ |
| round-1 终审 minor #2（CONTEXT「示例→实例」笔误） | 读 CONTEXT.md:133 | 已修正为「实例静态角色」✓；phase-5:78 措辞同源修正 ✓ |
| 测试纪律扫描 | grep .only/.skip/.todo/FIXME/setTimeout/Date.now | 新测试三文件零命中；时序用例全部为有界同步自旋（performance.now 探针，SA6 头注明文允许的例外）或门闩/微任务驱动，零 real sleep 零轮询 ✓ |
| 版本 bump | package.json diff | runtime 0.1.9→0.1.10、registry 0.1.5→0.1.6，恰 version 单字段、exports/dependencies 零改动 ✓（简报 L101 + 设计 §16 兑现） |

## 二、逐维度结论

### 1. 仓库约定（commit 风格 / 文件头注 / 注释纪律 / append-only 演进）— ✅

- **commit 风格**：5 commit 均为 conventional 前缀 + scope + 摘要 + `(#134)`，与 round-1 及近期 Phase 5 惯例一致；变更面划分清晰（实现 / ADR+设计文字收口 / SA6 测试同步 / 设计措辞 / 补锚）。
- **文件头注**：所有触达的 src 文件头注同步演进（replication-session.ts 头注扇出段改写为 R2-3 异步化口径；replication-write.ts 槽序注记 E5.5 追加 R2-1 增补行；runtime.ts V3c''''/V3d'' 构造序注记随 fanout 前移改写；lease.ts doRelease 注释重写为 R2-5 口径；plugin.ts 配置/校验序文档注释更新）。三个新测试文件头注齐备（契约来源、红/绿锁定标注纪律、确定性纪律、注入面声明）——与既有测试头注先例同款。
- **注释纪律**：机制注释与设计 R2.2.1 逐字对应（SA4 六机制逐字对照结论经本审查抽核成立）；演进锚注释随值改写（T-3 `toBe(0)` 注释含 F-3 理由——SA8 R-4' 义务兑现，非孤儿断言）；AC-2 ③ flushMicrotasks 一行演进带完整归因注释。两处纳米级注释-实现一步之差见 info #3/#4。
- **append-only 演进纪律**：ADR 0010 round-2 小节为修订节尾部 append-only 追加（沿 #64/#79/#93/#131/#132/round-1 先例）；其中 L273 括注的 M-1 就地修正属「本轮自产、合并前」文本，SA2 明示授权且设计/ADR/实现三方口径修正后逐字一致——不构成对既有冻结词的篡改。phase-5 C-1 注记为**显式撤销改写**（「issue #134 round 2 改写——撤销 round-1……读法」字样在场），符合 docs/AGENTS.md「Amend or supersede explicitly」。设计文档自身 R2.1→R2.2→R2.2.1 修订记录尾部追加、历史段保留 ✓。types.ts `NAMESPACE_REGISTRY_PLUGIN_CONFIG_MESSAGE` 文案就地更新为诚实文档（键集事实变化），唯一精确文案锚 registry-plugin.test.ts:240 同步一行（设计 §9.1-3/§19 登记）——消息单一真相源纪律保持。

### 2. 文档与测试要求 — ✅

- **ADR 登记义务兑现**：D-1（异步化全文 + L113 字面化 + L241 收窄 + 交付集 at-least-once 冻结句 + 两级副本/深比较性能注记）、D-2a（E5.5 fence + 排队项取消 + enable 不 fence）、D-2b（terminateAll + closedBy→RUNTIME_WRITE_DISABLED 码映射 + 终态确定 throw）、D-3（R2.2 口径白名单全文 + META 值域零收窄注记）、D-4（committed 二分 + under-report 方向 + 成功接纳即置位）——逐段在 ADR 0010 L265 起 round-2 小节实证在场，措辞与设计 §14 一致（SA4 已核，本审查抽读一致）。
- **README/CONTEXT 同步质量**：runtime README 新增「ReplicationSession（内部宿主）」节 8 条 + Lifecycle close 增补；registry README 新增 ReplicationSession 节 5 条 + Plugin configuration 节更新为 `{idleTimeoutMs?, role?}`；CONTEXT.md ReplicationSession 词条追加 needs-resync sticky 句——与 §12 大纲逐条对应，trusted raw 例外/degraded apply/静态 role/peer 权限/生命周期边界全部登记（评审项 11 闭环）。质量抽核：表述与实现行为一致（如「交付集 = 交付时刻 listener 快照（at-least-once）」与泵实现一致）。
- **测试口径与隔离纪律**：红/绿锁定标注纪律（【必红】/【绿锁定】）在标题保留，红灯套件转绿保留 `-red` 文件名 + 头注解释机制（沿 #132 先例）；R2-10 加严（listener 直存 callback 原始参数 + byteOffset/全幅/底 buffer 断言）在 round-1 两文件与 round-2 red #17 一致落位；spin fixture 测试末 close 收尾义务（§4.3(d) 测试隔离契约）在 red #7/#8/#9 兑现（9cfc1b6）；registry 侧敌意替身以**完整类型化字面量**满足 `ReplicationSessionOpenCore`（makeHostileStatus 全形冻结产物含 needsResync——零 `as unknown as` 键面放宽，SA6 §6 声称经读码证实）；AC-2 ③ 一行 fixture 时序演进零断言语义变化（读 diff 证实断言本体未动）。

### 3. 生命周期与防御模式 — ✅

- **幂等/终态机**：finalize 统一入口（`terminal !== 'open'` 守卫——幂等 + conflicted 不降级）被四触发面共用（显式 close / bump E5.5 fenceStale / Runtime close terminateAll / apply 槽 R2 被动 fence），零新增终态语义；close same-promise 缓存 + 恒绿 barrier 不变（INV-S11 延续）。
- **敌意隔离**：listener throw 在泵投递点逐个自捕获计数（observerFailures 语义不变、捕获点移出 transaction 栈）；泵最外层 catch-all 兜底（SA2 #7）+ finally 复位 pumpScheduled（复位与退出判定同同步段，无丢失唤醒）；doRelease 的 session seam 双类敌意（同步 throw / 异步 reject 及病态 thenable）经 try/catch + `Promise.resolve(closing).catch` 原生同化全隔离，onReleased 无条件到达——半释放结构性不可达。
- **unhandled rejection 面**：泵 IIFE 全路径 try/catch/finally 封闭；doRelease 同化兜底；close barrier 槽体结构性无 reject——本审查逐路径走查 + SA7 六型敌意直构 unhandledRejection Δ0 实测互证。
- **槽序/排空**：bump E5.5' fence 落点在 facts 整替后、notifyDirty 前（replication-write.ts:413-423 读码证实）；Runtime close 同步段顺序（lifecycle 翻转 → terminateAll → barrier 入队）冻结兑现（runtime.ts:346-355）；已接纳 apply 排空零新增机制（barrier 队尾既有结构）。

### 4. 可维护性 — ✅

- **seam 类型重复收敛（R2-12 评审项 12）**：「手工三写 → 两点同步 + 转置锁」格架保持——runtime core 与 registry types 两声明点 + registry.ts 跨包 Equal 真锁 + lease.ts 自锁；本轮 needsResync 第 11 字段的加入即格架即时演示（两点同步，编译期强制，typecheck 0 错误）。十键能力面对象零键变化。
- **常量冻结纪律**：16/20 双常量模块私有、不可配置、注释载明双向 load-bearing 与合法区间 [16,24]；RAW_PROTECTED_FIELDS 保留不动。
- **ALLOW/DENY 边界**：21 文件零 creep（§17 全路径比对）；DENY 结构性零触碰；改动半径 = 7 src + 6 test + 5 doc + 2 version + 1 wiki 档案，与「最小扩面」准绳一致；修复全部复用既有结构（终态机/barrier/FIFO/Equal 格架），无为将来抽象层。
- **死代码/占位**：PEER_ALLOWED_META_KEYS 空占位删除（登记注释指明 ADR 文字即真相源）；runSessionApplySlot 死导出已随本轮收口（round-1 minor #1 闭环）。

## 三、Hard violations（违反仓库明文纪律）

**0 项。**

## 四、Minor（非阻断判断）

| # | 位置 | 发现 | 依据与影响 |
|---|---|---|---|
| M-1 | `docs/adr/0010-*.md:265` | round-2 小节头的设计版本指针停滞于「依据 `task_..._round2_design.md` **R2.1**」，而设计定稿已为 **R2.2.1**（ADR 正文内容经 M-1 修正后与 R2.2.1 口径逐字一致——SA4 已核；唯指针未跟进） | docs/AGENTS.md「Link to the authoritative source」的溯源准确性：读者沿指针落到的是被两轮修订 supersede 的版本号（设计文档自身含完整修订史，可恢复）。不阻断——ADR 是规范文本且内容当前；建议下一文档触点顺手改为 R2.2.1 |
| M-2 | `packages/namespace-registry/src/plugin.ts:163,182` | 注释声称「单读捕获……apply 期零再读 config」，但 `config.role` 实际两次读取（resolvePluginIdleTimeoutMs 校验内一次 + 工厂 `config.role ?? 'hub'` 一次）——注释与实现一步之差（SA4 N-a 已录，本审查独立确认） | 敌意 Proxy config 理论上可双读分叉；下游 `createRegistryInternal` 的 assertRoleShape 对域外值 loud 拒 + config 属信任域输入，实际风险≈0。不阻断；建议措辞改为「工厂期捕获」或消除一读 |

## 五、Info（记录在案，无需动作或随既有归属推进）

| # | 位置 | 发现 |
|---|---|---|
| I-1 | `replication-session.ts:345` | `SessionClosedBy = 'explicit-close' \| 'runtime-close'` 的 `'explicit-close'` 成员从不赋值（显式 close 路径 closedBy 保持 undefined，A1 映射只判 `'runtime-close'`）——死联合成员；语义自文档化收益与类型空间纯度之争，纳米级 |
| I-2 | wiki/raw/（git 状态） | round-2 流水线档案（简报/sa6_red/sa2_review/sa3_impl/sa4_review/sa7_report/ac_checklist/两冲突报告/relevant_decisions）当前 **untracked**，`_dispatch.md` round-2 追加段未提交；已入库的仅设计档案（2a7117a）。与 round-1 先例一致（档案随收口 commit 入库——04849fe/4cfaffd），**round-2 收口 commit 须含上述全部 + 本双轴终审两份报告 + REPORT.md round-2 完成事务**（当前 REPORT.md 仍为 round: 1 内容，属流水线时序正常态）。提醒性质，非违规 |
| I-3 | `runtime-replication-session-round2.test.ts:702-706` | 探针卸载锚经 lib0 `_observers` 私有表观测（白盒）——SA4 N-b 已录「包内通道可接受」，本审查认同；yjs 升级若改内部表结构该锚将红（可检测、包内自用） |
| I-4 | 设计 §15.2 vs 实测 | 「22 用例全部落位」为 R2.2 时点计数；F-1 补锚后实际 25 用例（SA4 复审追节已认定时点语义自洽、无需改文）——实测 grep 25 个 it 属实 |
| I-5 | SA7 报告 §十 N-1 | 跨 channel 并发首投递的墙钟交错（慢 channel 先 attach 时快 channel 让过一次自旋）——单线程微任务 FIFO 物理事实；设计承诺面（每 channel 机制独立 + 槽公平性）实测成立，未承诺跨 channel 墙钟隔离——知情接受，切片 6 域 |
| I-6 | commit 8a68d82 | SA6 红灯套件未独立成 commit（与实现同 commit 入库）——红→绿证据链由档案（SA6 报告逐用例失败证据 + SA2 R2.2「28/29 实测」+ SA7 复跑）承载而非 git 历史边界；round-1 正面记录「实现/测试校准分离」在本轮弱化。无文书纪律强制 commit 分离，记录供后续轮次参考 |

## 六、正面记录（本轮达标项，供后续切片参照）

1. **档案声称 vs 仓库事实的一致性**：本审查对流水线档案的关键声称逐条独立实证（grep/read/复跑）——版本 bump、常量值、fense 调用点唯一性、Equal 锁在场、PEER_ALLOWED_META_KEYS 零引用、测试计数（17+12+25=54、全量 141/1735）、DENY 零触碰——**全部属实，无一失实**。四轮 reject→pass 回流（SA2 R2、SA2 M-1、SA4 F-1）均留有如实作废/更正记录（含 SA2 N'-1 失实自认与更正、SA1「逐字对齐」声称如实化）——诚实度样板。
2. **防御模式分层**：泵三层防御（逐 listener catch → 最外层 catch-all → finally 复位）+ doRelease 原生同化兜底，unhandled rejection 面经语言级结构闭合 + SA7 六型敌意实测 Δ0 双证。
3. **测试隔离义务的显性化**：spin fixture 跨测试泵泄漏（异步化的固有测试面）被识别、归因而非掩盖（不改断言不改常数）、并冻结为测试面契约（§4.3(d) 注记 + 收尾 close 落位）——时序型测试的隔离纪律先例。
4. **演进锚治理**：T-3 锚值 1→0 演进带 F-3 理由注释（非孤儿断言）；AC-2 ③ 一行 fixture 演进零断言语义变化 + 归因注释；全部演进面在 §15.2/§15.3 预先登记、执行零越界（SA4 C-2' 核验 + 本审查 diff 抽核一致）。
5. **seam 类型收敛格架的实证演示**：status 第 11 字段经「两点同步 + Equal 锁编译期强制」加入，typecheck 0 错误——R2-12「收敛手工重复」从方案变为已演示事实。

---

**Verdict: pass**——0 hard violation；2 minor（ADR 版本指针、plugin 注释一步之差）+ 6 info 全部不阻断合并；评审 12 项的仓库标准面（提交卫生、文档登记、测试纪律、防御模式、边界纪律）全部兑现，档案声称经独立实证无一失实。
