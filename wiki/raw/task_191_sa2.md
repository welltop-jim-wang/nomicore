# SA2 攻击评审报告 — yjs-server 根锁 stale 回收原子化（Issue #191）

- **Date**: 2026-08-30
- **Reviewer**: SA2（Wallfacer，全新视角独立攻击，未参与 SA1 设计）
- **评审对象**: `wiki/raw/task_191_sa1.md`（R1，2026-08-30）
- **任务简报**: `TASK.md` + GitHub issue #191（已用 `gh issue view 191 --json title,body` 逐字核对，两者一致；无「相关决议」/ADR 锁立法基准传入，`docs/adr/` grep 无锁条款）
- **Verdict (R1, 已被 R2 复审取代)**: **reject**（R1 退回修订；核心架构成立，但有 1 个 MAJOR 必改 + 2 个披露性必改——见下文「必需修订清单」）
- **Verdict (R2, 最终)**: **pass / APPROVE**（RC1-RC3 全部关闭且经逐条推演验证；seam② 与守卫未引入新阻断性风险；六项冻结面完好。全文见文末「R2 复审（2026-08-30）」节，含 1 条非阻断勘误 N1）

---

## 0. 攻击方法与证据基线

本评审不是背书式复核：对 SA1 的每一条关键主张都做了独立取证，取证命令与结果如下（SA4/SA7 可重跑）：

| # | 主张 | 取证 | 结果 |
|---|---|---|---|
| E1 | D1 缺陷行 `lifecycle.ts:81` `flag:'w'` 非独占覆写 | `read apps/yjs-server/src/lifecycle.ts` | ✅ 属实（:66 `wx` 首取、:81 `flag:'w'` 回收、:93 release 无条件 `unlinkSync`） |
| E2 | D2 生产路径 1（reload→memory 残留 handle 再释放误删） | `read apps/yjs-server/src/main.ts` | ✅ 属实（:118 `state.lock?.release()` 后仅当 `persistence.kind==='file'` 才重赋值 :120-126，`state.lock` 残留旧 handle；二次 SIGTERM → :71 无条件删） |
| E3 | caller 审计完整（无遗漏调用方） | `grep -rn "acquireRootLock" --include=*.ts` 全仓 | ✅ 仅 `main.ts:122/:183` 两处调用；release 面 `main.ts:71/:118/:206`，与 SA1 §9 表一致 |
| E4 | §6.3「锁消费方全部字段挑选式解析」 | `grep -rn "nomicore-lock"` 全仓 | ✅ `phase5-three-instance-acceptance-red.test.ts:196`、`phase5-mgmt-verbs-sa7.test.ts:206` 均 `JSON.parse(...).pid` 挑字段；`smoke-skeleton-red.test.ts:334` 正则匹配文件名；无全量字节比对/schema 白名单消费方 → nonce 加键纯加法成立 |
| E5 | T4 现状红（第 3 参被忽略 → 无 throw + 覆写成功） | 逐行推演现函数（两参签名，JS 忽略第 3 参；`flag:'w'` 无条件成功） | ✅ 确定性红成立：`toThrow` 失败 + `hookFired===0` + survivor 变 `instance-A` 三重红锚 |
| E6 | T4 修复后绿（seam 内 B 完整持锁 → A 读见活 pid loud throw） | 推演 §4.2 伪码 + 同进程 `process.kill(process.pid,0)` 恒活 | ✅ 确定性绿；A 在 ③ 即抛，绝不触 unlink |
| E7 | 存量测试修复后仍绿 | 通读 `smoke-skeleton-red.test.ts`(:272/:319/:334)、`phase5-three-instance-acceptance-red.test.ts`(:196/:361 AC6)、`phase5-mgmt-verbs-sa7.test.ts`、`lifecycle-watchdog-red.test.ts` | ✅ 单回收者走 unlink+wx；干净停机 release 内容相等即删；SIGKILL 重启 stale 重取——全部与 §4 行为等价 |
| E8 | 测试落盘/类型面 | `vitest.config.ts` include `apps/*/test/**/*.test.ts`；`apps/yjs-server/tsconfig.json` include `test/**/*.ts` 且在 root `pnpm typecheck` 脚本内；import 惯例 `../src/index.js` 有先例（`issue164-slice9-red.test.ts:18`） | ✅ §6.4 成立（注意 `verbatimModuleSyntax`：SA6 需 `import type` 形式引 `RootLockAcquireHooks`） |
| E9 | CI 平台 | `.github/workflows/ci.yml`：ubuntu-latest × Node {20,24} | ✅ Linux-only → `DEAD_PID=2**31-1 > pid_max(2^22)` 恒 ESRCH；P4 的用例内前置断言可兜其他环境 |
| E10 | seam 先例 | `apps/yjs-server/test/harness.ts:209`（`createNamespaceRegistryForTesting` testing seam）；`ws-server-upgrade-admission.test.ts:3` 直引内部先例 | ✅ §4.4/§7.4 引用真实存在 |

**结论**：SA1 的根因分析（D1/D2）、现状行为矩阵、caller 审计、兼容性论证、红灯确定性论证，在独立取证下全部成立。以下攻击点是在这个扎实底盘上找到的真实缺口。

---

## 1. 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | **CRITICAL→MAJOR（必改，RC1）** | acquire 竞态：stale 判定 → unlink 残余窗 | §7.1.3「窗口已压到该协议形态的最小值」是**错误论断**：伪码 ③`readLockInfo` → `isPidAlive`（一次 `kill(2)` 系统调用）→ 回环簿记 → ⑤a `unlinkSync`，判死结论与 unlink 之间插着存活性探测与整段簿记。竞争者 B 在此窗内完成「unlink stale + wx 建新锁」，A 的 unlink 删掉的是 **B 的活锁**，A 随后 wx 成功 → 双持——恰是 issue #191 要消灭的 bug 类。经典 stale-回收环（dotlockfile/lockfile 族）在 unlink 前**重读并逐字节比对**（只删除「 grounding 判死结论的那份内容」），SA1 缺了这一步；窗口可从 [读→探测→unlink] 收窄到 [相邻重读→unlink]，且关闭了最可几变体（B 在 A 的 kill-探测期间完成回收）。改法 ~5 行、无签名变化、对 T1-T7 全部绿路径零影响（逐用例推演见 §3 红线测试思路） | 必改：unlink 前加内容再验证——保存 ③ 读到的原始字节，紧贴 unlink 重读；不等（或读失败）→ `continue` 回环重判；相等才 unlink。同步把 §7.1.3 的「最小值」论断改为如实描述收窄后的剩余窗 |
| 2 | MINOR（必改披露，RC2） | acquire 竞态：部分写入可见窗（现状既有、§7 未披露） | `writeFileSync(...,{flag:'wx'})` 是 open→write→close 三段；并发回收者的 `readLockInfo` 可在 open 与 write 之间读到**空/半截文件** → `JSON.parse('')` 抛 → `{}` → pid undefined → 判 stale → unlink 一个**活进程刚创建**的锁。此窗在 main 现状（:66）即存在，本设计不使其变坏，但 §7.1 自称完整枚举残余风险却漏了它，且 T6 恰好把「非法 JSON=可回收」钉成契约——两者组合成的这条链必须显式亮牌，否则 SA4/SA7 会把风险面当成已完备 | 必改（纯文档）：§7 增补该窗的披露（现状既有、窗口=单次 write 系统调用、payload <200B 单 write、可未来用 temp+`link(2)` 原子建键硬化、本 issue 半径外）。不改代码、不改 T6 |
| 3 | MINOR（必改披露，RC3） | 兼容性：release 语义收窄的未声明角落 | 行为矩阵（§2）漏一行：「锁文件存在但**不可读**（如被 chmod 000）」。现状 release 不读文件、直接 unlink（unlink 只需父目录写权限）→ 删成功；修复后 `readFileSync` EACCES → 吞错 no-op → **锁残留**。可达性极低（非支持流程），但这是 release 磁盘副作用的真实收窄，矩阵自称完整枚举却缺席 | 必改（纯文档）：§2 矩阵补该行并声明接受该 delta（理由：部署不变量=锁文件由本进程以默认权限创建）。可顺带给 SA6 一条可选行为 pin 测试（见 §3） |
| 4 | MINOR | 测试 seam：churn 护栏不可被确定性测试触达 | seam 只在 ③（判定读前）触发，而多轮回环要求「5b wx 撞 EEXIST」或「unlink 后文件又变」——hook 无法在 unlink 与 wx 之间插层，故 `MAX_RECLAIM_ATTEMPTS` 分支无法用现有 seam 确定性编排，成为无直接测试的防御性护栏。可接受（它只是有界回环的 loud 收口），但设计应如实声明「护栏不可确定性测试，以有界回环不变量+code review 保障」，而不是留给读者误以为 §5 覆盖了它 | 建议：§7.3 补一句声明。**不建议**为它增设第二个 seam 位置（公共面膨胀不值） |
| 5 | MINOR | 测试卫生（SA6 落盘指引） | T3.3 `chmodSync(root,0o500)` 后若断言在还原 `0o700` 前抛出，afterEach 清理路径依赖「目录内无锁文件」这一隐含前提（T3.3 在创建锁前即抛，当前推演安全，但脆弱）。另 `verbatimModuleSyntax` 下类型导入必须 `import type`，否则 `pnpm typecheck` 红 | 建议：SA6 将 chmod 还原放 `try/finally`；类型导入用 `import { ..., type RootLockAcquireHooks }` |
| 6 | OBSERVATION | 公共 API 面 | `RootLockAcquireHooks` 进入冻结公共入口 `index.ts`，是 app 组合根首个生产源码内 seam。AGENTS.md「no testing seams」条款限定的是**消费 packages** 的面，不构成违反；§7.4 已预置回退（撤回 re-export、测试直引 `../src/lifecycle.ts`，先例真实存在）。JSDoc「测试编排用、生产调用方不得传」注释必须随实现落地 | 保留观察；若 SA4 终审对公共面有异议，按 §7.4 回退即可，协议本体不动 |
| 7 | OBSERVATION | 错误处理链路 | release 内容不等时**静默 no-op、零诊断痕迹**（lifecycle.ts 无事件通道，main.ts 在 DENY LIST）。良性场景（他人持锁）占绝对主流，静默是正确的保守行为；但若 #1 的残余窗真的发生，运维将无从溯源。设计层面可接受 | 保留观察：在 §4.3 文档里明示「静默是刻意选择」即可，不加通道 |
| 8 | OBSERVATION（对 SA1 有利） | seam 备选表 | 对「真进程并发对撞」的否决论证我独立复核成立：tsx 子进程 spawn 迟延（数百 ms）使「双 reclaimers 都看到 stale」在真进程下不可稳定编排，对**现状坏代码**该测试也大概率绿——不满足 AC 的 deterministic 要求。hooks 方案是四个备选中唯一同时满足确定性与最小侵入的 | 维持 |

**虚假降级扫描**（2026-05-07 三度立法）：逐条检查设计中所有「静默吞掉」路径——release 吞读失败/吞 unlink 失败=幂等语义保留（现状同）；unlink ENOENT→continue=重试语义而非降级；release 内容不等→no-op=所有权保护而非掩盖前置 bug（正常流程中 release 时文件必然是自己写的，不等只可能来自真实竞争/接管，此时不动磁盘恰是正确行为）。**未发现虚假降级**。

---

## 2. 协议假设依据审查（2026-06-13 立法）

- **章节存在性**：✅ §8 存在，6 条假设（P1-P6），每条含依据类型+具体引用。本设计无 HTTP/WS/端口假设（声明属实——纯本地 fs+信号原语），按立法属「无网络面假设」情形，但仍主动给了文件系统/信号原语依据，超出最低要求。
- **依据可验证性**：P1（`wx`=O_EXCL→EEXIST）有 Node 官方文档+现网依赖证据（`lifecycle.ts:66` + smoke:319 在 main 绿）；P2（unlink ENOENT）有 POSIX+现网依赖（release 幂等即建立在吞 ENOENT 上）；P3 零改动；P5（randomUUID）官方文档。均可用 `read`/文档链接/测试重跑复核 → SA4 可验证。
- **无据推断扫描**：P4（DEAD_PID）「设计期验证」标注为 SA6 落盘时执行，但配了用例内前置断言 `expect(() => process.kill(DEAD_PID, 0)).toThrow()` 作硬兜底——不是裸「应该」；E9 已独立核实 Linux pid_max=2^22 < 2^31-1，CI ubuntu-only 成立。P6（chmod 0o500→EACCES）带 root skip 守卫。**无必须 reject 的无据推断**。
- 唯一保留：P4/P6 的实测承诺依赖 SA6 兑现，SA4 静态门禁应核对新测试文件里前置断言确实存在。

## 3. 红线测试思路（逐漏洞的 IT 编写方向）

> 全部沿用 §5 通用约定（`mkdtempSync` 独立 root、`../src/index.js` 公共入口、零 sleep 零真并发）。以下是对 SA1 T1-T7 的**增补**构想，SA6 落盘时并入 `root-lock-atomic-reclaim-red.test.ts`。

- **RC1（攻击点 1）— 回环内容守卫的直接红灯（推荐新增 T8）**：
  若 SA1 采纳「unlink 前重读比对」并愿意扩一个可选 hook 位（`beforeStaleUnlink`，签名建议 `(rawStaleContent: string) => void`，生产不传零差异，§7.4 回退同覆盖）：
  1. 种子死 pid 锁 F1；A 以 hook 启动，hook 在触发时用 `{flag:'w'}` 把锁文件**整体替换为胜者活 payload**（`{instanceId:'instance-B', pid: process.pid, nonce:'winner'}`）——模拟「竞争者在 A 判定读与 unlink 之间完成回收」；
  2. 断言 A `toThrow(/another instance holds/)`（回环重判读到活 pid）且**胜者锁文件逐字节存活**；
  3. 红（RC1 修订前的 R1 代码）：hook 位不存在/无守卫 → A 删掉胜者锁 → A 自持返回 handle → 不 throw + 文件内容变 A → 双重红锚。
  若 SA1 选择不加第二 hook（可接受）：守卫以「全部既有绿契约在守卫加入后仍绿」回归锚定 + §7 披露收窄后的剩余窗，并把上表场景写进 §7 作为推演记录。**二选一，设计文档必须显式选定并说明**。
- **RC2（攻击点 2）— 部分写入窗的行为 pin（低成本变体）**：种子**空文件**（`writeFileSync(lockFile, '')`）→ `acquire` 应视作 stale 正常回收（`JSON.parse('')` 抛 → `{}` → 判死 → 回收成功）。这是 T6 的空串变体，pin 住「半截/空内容=可回收」这一语义本身，使披露的风险面有可观测锚点。（真正的并发部分写窗不可确定性测试——如实标注为 SA7 动态/推演域。）
- **RC3（攻击点 3）— release 遇不可读文件的行为 pin（可选，root 环境跳过）**：自己 acquire → `chmodSync(lockFile, 0o000)` → `release()` → 断言**不再抛**且文件仍在（修复后语义）；现状代码此场景会删文件——若 SA6 想要红锚，可先在现状跑一次记录差异再翻绿。仅当矩阵该行被采纳为「接受 delta」时才写，防回归漂移。
- **攻击点 4 — 护栏声明性验证**：不写确定性测试（不可编排）；SA4 静态审查核对回环所有 `continue` 路径必经 attempt 计数、`throw` 文案含 `did not converge` 即可。
- **攻击点 5 — T3 hygiene**：chmod 0o700 还原移入 `finally`；补一条「断言失败也必须能清理」的注释。
- **对 T4/T5 本身的加固建议（非必改）**：T4 已有三重红锚（nothrow/hookFired/survivor），建议 SA6 保持三重齐全（任一单锚在实现走样时都可能假绿）；T5 建议补第二步「`stale.release()` 后再 `successorHandle-equivalent` 场景下文件内容逐字节不变」（当前只查 instanceId）。

## 4. 错误处理链路审查

- **静默失败**：唯一静默面 = release 吞一切错（现状语义，幂等保留）+ 内容不等 no-op（修复目标本身）。acquire 侧所有失败均 loud（三族文案+护栏文案），无「无请求发出+无反馈」类路径。✅
- **状态闭环**：本任务是纯后端锁原语，无 `exStatus`/UI 面；可观测闭环=进程 exit code + stderr 文案，三族 loud 文案逐字保留（§4.5 与 lifecycle.ts:76/:77/:84 比对一致）。✅
- **降级路径**：无外部服务依赖（纯本地 fs）；ENOENT→continue 是重试不是降级。✅
- **虚假降级**：未发现（见 §1 扫描段）。✅

## 5. 必需修订清单（RC — RC1/RC3 满足后可 pass）

| RC | 严重度 | 内容 | 验收方式 |
|----|--------|------|---------|
| RC1 | MAJOR | §4.2 回环在 stale-unlink 前增加**内容再验证**（保存判定读的原始字节，紧贴 unlink 重读比对；不等/读失败 → `continue`）；§7.1.3 撤回「最小值」错误论断，如实重述剩余窗=[相邻重读→unlink]；同步决定是否以 `beforeStaleUnlink` hook + T8 提供直接红锚（二选一，文档显式选定） | 设计文档修订；若加 hook+T8 → SA6 落盘新红契约；SA4 复核守卫在所有绿路径无假阳性 |
| RC2 | MINOR | §7 增补「部分写入可见窗」披露（现状既有、非本设计引入、硬化路径=temp+link(2)、半径外）；§5 可选补空文件 pin | 设计文档修订 |
| RC3 | MINOR | §2 行为矩阵补「release：文件存在但不可读」行（现状 unlink 成功 → 修复后 no-op 残留），声明接受 delta 及理由 | 设计文档修订 |

**明确不要求**（攻击后维持 SA1 判断）：rename-quarantine 完全无窗方案（代价=新保留名+崩溃窗分析+误删恢复复杂度，超出 issue 处方半径，同意不做）；main.ts 残留 handle 置空（DENY LIST 维持——release 所有权校验已在不动 main.ts 的前提下闭合该路径）；seam 换 fs-adapter 注入（侵入面大，否决正确）。

## 6. 对 SA1 既定设计的攻击存活确认（不许 SA3/SA6 削弱）

以下各项在本次攻击下**站住了**，后续阶段不得以「SA2 意见」为名改掉：

1. 持锁唯一出口 = `wx` 成功；`flag:'w'` 必须从函数中彻底消失。
2. nonce 字节级所有权校验的 release（全等比较，非字段比较）。
3. seam 位置（EEXIST 后、判定读前）与 T4/T5 的确定性红机制。
4. 三族诊断文案逐字保留（§4.5 清单）。
5. 存量真进程测试零改动全绿（§6.2 清单）。
6. ALLOW/DENY LIST 边界（main.ts 及四测试文件不许动）。

---
---

# R2 复审（2026-08-30）— SA1 R2 修订版裁决

- **Date**: 2026-08-30
- **评审对象**: `wiki/raw/task_191_sa1.md` **R2 修订版**（同文件就地修订，header 版本=R2；R1→R2 差异 = §2 两行矩阵、§4.2 ③/⑤a-⑤d 守卫+seam②、§4.4 增补决策、§5 T6-B/T8/T9 与通用约定、§7.1 重写、§7.5/§7.6 新增、§8 P7、§10 估行、§11 回应表）
- **复审范围**: R1 必需修订 RC1/RC2/RC3 的关闭验证 + **seam②（`beforeStaleUnlink`）与 RC1 守卫引入的新设计风险专项攻击** + 六项冻结面完整性
- **Verdict**: **pass / APPROVE**（全部阻断项关闭；新增面无阻断风险；1 条非阻断勘误 N1 记录在案）

## R2.1 RC 关闭验证（逐条推演，非对照声明）

| RC | 关闭判定 | 验证证据（逐条推演/取证） |
|----|---------|--------------------------|
| RC1-a unlink 前原始字节守卫 | ✅ **关闭** | §4.2 ③ 判定读保存 grounding 字节（读失败→`''`，与现状 `readLockInfo` 吞错→`{}` 语义等价——`parseLockInfo('')` 同样 parse 失败→`{}`）；⑤b 紧贴 unlink 重读逐字节比对，不等/读失败→`continue`。逐契约推演守卫无假阳性：T1/T2/T3（不达守卫或字节恒等）、T4（A 在 ③ 活 pid 即抛，不可达守卫）、T6（`'not-json'==='not-json'`、`''===''` 恒等→正常回收）、T7（守卫读 ENOENT→continue→② wx 直取）、smoke:272/:319、phase5 AC6、reload 重取（单回收者无交错，字节恒等）。守卫只在「判定读与重读之间文件被换」这一目标交错上改变行为——恰是修复本体。`readLockInfo`→`parseLockInfo(raw)` 为私有等价重构，非导出面变化 |
| RC1-b 撤回「最小值」错误论断 | ✅ **关闭** | §7.1 整节重写：显式撤回 R1 论断；三变体对照表准确——变体 2（kill 探测/簿记宽窗，最可几）由守卫关闭（推演：B 在窗内完成回收→守卫重读≠grounding→回环→判定读见 B 活 pid→loud held）；变体 3 剩余窗如实定为相邻「守卫重读→unlink」（B 须在其中完成自身 unlink+wx，四条系统调用精确对撞，亚微秒级）。该窗口描述经我独立推演确认属实，且确为该协议形态（O_EXCL dotfile 锁 + 内容守卫）的可达成最小窗 |
| RC1-c seam②+T8 二选一显式选定 | ✅ **关闭** | §4.4「R2 增补决策」显式选定增设 seam②（签名 `(rawStaleContent: string) => void`，位置=判定读后/守卫重读前），理由充分（守卫为修复本体需直接红锚，否则 SA3 漏写/写错守卫时 T1-T7 仍全绿——我推演确认：无守卫的实现 T1-T7/T9 全绿，仅 T8 红）。护栏不设第三 seam 与 R1 攻击点 4 同判 ✓ |
| RC2 部分写入可见窗披露 | ✅ **关闭** | §7.5 新增：现状既有（`lifecycle.ts:66` 同窗）、本设计写入形态相同不放大、**守卫反收窄**（触发需 A 的判定读与守卫重读两次都落在竞争者单次 write 窗内——推演确认：write 在两读之间完成则守卫不等→回环→活 pid→loud）、temp+`link(2)` 硬化路径记录为半径外；T6 种子 B（空文件）pin「空内容=可回收」语义；并发变体如实归 SA7/推演域。§2 矩阵行同步 |
| RC3 release 不可读 delta 披露 | ✅ **关闭** | §2 矩阵行 + §7.6：现状「不读内容直接 unlink（POSIX：unlink 只需父目录写权限）」→ 修复后「读失败吞错 no-op→锁残留」，接受理由（部署不变量 + fail-safe 方向：读不到就当作不是自己的）成立；T9（root skip）在现状即确定性红（无条件删→`toBe(true)` 失败），兼作防回归锚；P7 给出 POSIX 依据且准确。附带披露的 acquire 侧不可读 delta 见勘误 N1 |
| 攻击点 4/5/7 与 §3 加固建议 | ✅ 全部采纳 | §7.3 护栏不可测声明（有界回环不变量 + `did not converge` 可 grep 锚）；§5 通用约定 `import { ..., type RootLockAcquireHooks }`（verbatimModuleSyntax）+ T3.3 chmod 还原 try/finally；§4.3「静默是刻意选择」入设计并要求落 release JSDoc；T5 增逐字节断言、T4 三重锚「SA6 不得削减」明示 |

## R2.2 seam② 与守卫的专项新风险攻击（按总控要求）

| # | 攻击 | 推演/取证 | 结论 |
|---|---|---|---|
| N-A | seam② 触发面扩大（生产可达性） | seam② 仅在「EEXIST→判定读→判死→护栏未触发」的 stale 路径 ⑤a 触发；活 owner 在 ③ 即抛、不可达；生产调用方（main.ts:122/:183）两参调用不传 hooks，零行为差异；JSDoc 声明测试专用；§7.4 回退对 seam①/seam② 一并覆盖 | 无新增生产风险面（与 R1 已接受的 seam① 同类） |
| N-B | T8 确定性与红锚强度 | 绿路推演：attempt0 ②wx EEXIST(种子)→③判定读 raw=seedPayload→判死→⑤a seam② 注入 winnerPayload→⑤b 守卫重读≠→continue→attempt1 ②wx EEXIST(winner)→③判定读见 `process.pid` 活→**抛**（instance-B≠instance-A→shared-root 文案）——A 不会再次到达 ⑤a，`unlinkHookFired===1` 成立；A 从未执行 ⑤c unlink，survivor 逐字节=winnerPayload。红路（现状）：第 3 参被忽略→四重红锚（nothrow/`unlinkHookFired===0`/`rawSeen===undefined`/文件=A payload）全部确定性。**锚对实现漂变的鲁棒性**：seam② 若被错置到判定读之前，`rawSeen===seedPayload` 必假（拿不到 grounding 字节）→红；守卫若只重读不比对→unlink 删 winner→A 持锁返回→nothrow 锚红。T8 能抓住「漏写守卫」「错置 seam」「空守卫」三类实现走样 | T8 契约稳健，采纳 |
| N-C | 守卫 `catch → continue` 不分 errno（吞掉 EACCES？） | 三种失败分别推演：读 ENOENT（文件消失）→continue→② wx 直取成功（T7 锚）；读 EACCES（文件不可读，病态）→continue→回环至护栏 loud `did not converge`（§7.6，**收口是 loud 非静默**，不构成虚假降级）；**目录**不可写场景在别处正确映射——② wx 撞 EACCES→loudUnwitable、⑤c unlink 撞 EACCES→loudUnwitable，不会被守卫的 catch 掩盖（守卫只包 ⑤b 读）。每次 `continue` 必经 `attempt+=1`，④ 检查先于 ⑤a/unlink——无活锁、无无界回环、无静默路径 | 语义正确 |
| N-D | 字节比对 vs 解析后字段比对的等价性 | T8 无法区分两种比对实现（winnerPayload 的 pid/instanceId 均异于种子，两者都判不等）。但推演证明二者**安全等价**：字节异而 `{instanceId,pid}` 同 ⇒ 同一 pid ⇒ 判死结论仍有效 ⇒ unlink 安全；分歧仅在回环次数，不在安全性。故无需为此增锚（记录供 SA4 知悉） | 无需动作 |
| N-E | 锁路径是目录（EISDIR）等奇异态 | 现状：:81 `flag:'w'` 写目录→原样抛 EISDIR；修复后：③/⑤b 读目录→EISDIR→`''`/continue→护栏 loud `did not converge`。均 loud、仅文案不同，属 §7.6「不可读（病态）」同类，外部干涉才可达 | 接受（并入 §7.6 框架） |
| N-F | 守卫对存量真进程/reload 路径的行为扰动 | 守卫仅增一次读系统调用；无交错时字节恒等→行为与 R1 设计完全一致（smoke/phase5/watchdog 逐条复推均绿）；main.ts 零改动维持 | 零扰动 |
| N-G | 六项冻结面完整性（R1 §6） | 逐项复读 R2 版：wx 唯一出口（⑤d/② break 不变）、nonce 字节级 release（§4.3 未动）、seam① 位置与 T4/T5 机制（§4.2 ③ 未动）、三族文案逐字（§4.5 未动）、存量测试零改动（§6.2 未动）、ALLOW/DENY 边界（§10 仅估行变化）。R2 全部改动为**加法**（守卫、seam②、T8/T9、披露），无任何冻结项削弱 | 完好 |

## R2.3 非阻断发现（记录在案，不 gating）

- **N1（勘误，文档精度）**: §2 矩阵「acquire：锁文件不可读」行与 §7.6 第二行称现状行为为「loud `cannot write`（'w' 覆写撞 EACCES）」——**与源码不符**：`lifecycle.ts:81` 的 `flag:'w'` 写在 `if (errno === 'EEXIST')` 分支**内部**，其抛出的 EACCES 直接向外传播为**原始错误**（`EACCES: permission denied, open '<rootDir>/.nomicore-lock.json'`），不会再走 :82-85 的文案映射（else-if 链已被 EEXIST 分支消费）。定性结论不受影响（现状=原始 EACCES loud throw，修复后=`did not converge` loud throw，两者均 loud、仅文案不同；无任何测试 pin 该路径的现状文案——T9 只测 release 侧）。处置：SA4/SA7 以本勘误为准；SA1 可在后续文档整合时顺手修正该两格，**不要求本轮返工**。
- **N2（观察）**: T8 之 `rawSeen` 锚已把「grounding 字节传给 seam②」钉死，结合 N-D 的安全等价结论，守卫实现选字节比对（设计原文）或字段比对均安全；SA4 静态审查建议核对实现与 §4.2 ⑤b 文字一致（字节比对）以防无谓分歧。
- **N3（观察）**: T9 root-skip 沿用 T3 的 `process.getuid?.() === 0` 守卫——CI 为 ubuntu-only（R1 E9 已核），Windows 本地开发不在此列，与存量 T3 同风险水平，无需额外处理。

## R2.4 裁决与移交

**verdict: pass（APPROVE）**——RC1（a/b/c）、RC2、RC3 全部关闭且经逐条推演验证而非对照声明；seam② 与 RC1 守卫经专项攻击未发现阻断性新风险；六项冻结面完好。SA1 R2 设计可进入 SA3 实现。

对后续阶段的移交要点（以本报告 + R1 §6 冻结清单为准）：

1. **SA4 静态审查**应专项核对：⑤b 守卫确为**原始字节比对**（非仅重读）；所有 `continue` 路径必经 attempt 计数且 ④ 检查先于 ⑤a seam② 与 ⑤c unlink；`flag:'w'` 在 `lifecycle.ts` 中零残留（生产代码）；seam①/seam② JSDoc「测试编排用、生产调用方不得传」随实现落地；release「静默是刻意选择」注释落地；勘误 N1（§7.6 现状行为描述）以上文为准。
2. **SA6 落盘** `root-lock-atomic-reclaim-red.test.ts` 必须齐备 T1-T9 全部锚点：T4 三重红锚、T5 逐字节断言、T8 四重红锚（含 `rawSeen===seedPayload`）、T9 root-skip + try/finally 清理、T6 双种子（not-json + 空文件）、T3.3 try/finally 还原、`import type` 导入形式；护栏分支无确定性用例（§7.3 声明），不得虚构。
3. **SA7 动态域**承接两处不可确定性测试项：并发部分写窗（§7.5）、guard-re-read→unlink 残余窗（§7.1 变体 3）——均为推演+披露域，不要求构造真对撞。

本 pass 仅覆盖设计层；实现与活链路验证仍由 SA4/SA7 把关（SA2 职责边界不变）。
