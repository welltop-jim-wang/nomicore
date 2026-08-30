# SA2 攻击评审报告

**Date**: 2026-08-30（R1）／ 2026-08-30（R2 复审追加，见 §R2）／ 2026-08-30（R3 窄域复审追加，见 §R3）
**Reviewer**: SA2（Wallfacer，全新视角独立攻击）
**被审对象**: `wiki/raw/task_phase-5-websocket-replication-contracts_design.md`（R1：509 行；R2：591 行；R3：594 行）
**ADR 约束基准**: `task_phase-5-websocket-replication-contracts_relevant_decisions.md`（含 SA8 设计后复审摘录 D1–D7/C2）；SA8 冲突门禁 verdict = clear（0 冲突）
**Verdict 历史**: R1 = **reject**（1 CRITICAL + 3 MEDIUM，见下）→ R2 = **reject（窄域：单点阻断 #8 + 2 项非阻塞，见 §R2-4）**→ **R3 = pass（见 §R3-3）**——#8 断言③剔除收口 ERROR 帧、oracle 口径构造性成立（§R3-1），#9/#10 抽查闭合；设计放行进入 SA3 实现，SA4/SA7 验证不因此豁免

---

## 0. 审查方法与事实核验范围（先立信，后攻击）

以下事实我逐条到源码/文档现场核验过，**全部与设计自陈一致**（这些不是攻击点，是攻击的地基）：

| 核验项 | 方法 | 结果 |
|---|---|---|
| `controlReserveBytes` 全仓命中 = 12 文件 | `grep -rn` 全仓 | 与设计 ALLOW 清单一一对应（src 4 + test 8），`docs/` 零命中 |
| 8 条延后锚行号 | anchors 文件逐行 | A2-1:173 / A2-2:182 / A3-1:300 / A4-1:367 / A4-2:399 / A5-1:427 / A5-2:441 / A5-5:511 全对 |
| 锚文件当前红态 | `pnpm exec vitest run …issue172-contract-anchors.test.ts`（本机实测） | `11 failed \| 5 passed (16)`，`Type Errors: no errors`——与 SA6 运行证据一致 |
| `it.fails` 可用性 | `node_modules/.pnpm/@vitest+runner@3.2.7/.../tasks.d-CkscK4of.d.ts` | `fails?: boolean`「If the task fails, it will be marked as passed.」在场；仓内 `^3.2.4`/实装 3.2.7；全仓零 `.fails` 先例（设计自陈属实） |
| G1–G5 代码根因 | `types.ts:29` / `defaults.ts:27,52-54` / `validate.ts:118` / `backpressure.ts:55,81,117-121,186,193` / `hub-connection.ts:96-106（close 零 GOAWAY）,:261（PONG_TIMEOUT 1002）` / `peer-connection.ts:160-161（addTarget ready 直通）,:308-311（peer 1001）,:94（isGoawayDraining 声明）` / `peer-namespace.ts:512-520（onCloseOk 静默）,:711-718（maybeStartRecovery 无 drain 检查）` | 逐行属实 |
| 协议冻结值 | protocol L492/L504（§17）、L524（§18）、L283+L351（§10.2/§13.1）、L149（§6.3）、L567（§21） | 8 MiB/下界/checkpoint 公式/pong 1001/ACK_STATE_VIOLATION 1002/GOAWAY 静默窗口/停机第 1 步——逐字对上 |
| 4 组恒真断言 | 逐处读源 | ac4:71、r1-r7:428/442、sa7-round2:393/401/404 全部 `>=0` 恒真且断言消息与谓词不符（如「必须已发出」配 `>=0`） |
| D4 校准算术 | 复算 | 1_500 ≥ 1_024+128 ✓；5_000_000 ≥ 4MiB+128 ✓；T12 两侧 7.3KiB < 64_000 < 73KiB ✓；ac3-bootstrap 的 `maxBootstrapBytes: 64` 与新链式下界兼容（quota 缺省 8MiB ≥ 192）✓ |
| 类级直构自守卫 | `backpressure.ts:60-70`（构造零校验）+ QUEUE_LIMITS/D4_LIMITS `as ResolvedLimits` | 属实；且改名后 TS2352 会在 typecheck 期先拦（比设计声称的运行时 NaN 自守卫更早） |
| CONTRACT_LIMITS 零消费 | grep | harness 外零命中——8MiB 镜像迁移零破坏 |
| ADR 约束合规 | 对照 relevant_decisions 摘录 | D1/D3/D7 执行 #161 冻结值与 #133 round-2 现行文本，未改写任何冻结值；C2 走 append-only；与 SA8 裁决一致 |

**结论：设计的取证质量高于本仓历史均值。正因如此，下面第 1 号攻击点才更致命——它恰好落在设计声称「核对过」的完备性断言上。**

---

## 1. 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议修订 |
|---|--------|--------|---------|---------|
| 1 | **CRITICAL** | D4 波及面完备性 / §5 预期矩阵 / §9 caller 审计 | **D3b 用例依赖缺省额度耗尽，被整票漏判。** `ws-replication-sa7-issue137-dynamic.test.ts:318`（D3b「缺省 64KiB 大控制帧路径」）经 `bootLocal` **零 limits 覆写**（bootLocal 的 limits 为可选参数，D3b 未传——:660 附近实测），全前提 = 「~90KB BOOTSTRAP_SNAPSHOT > 缺省额度 64KiB → 首帧即耗尽」。W-A 落地（缺省 64KiB→8MiB）后 90KB ≪ 8MiB → 永不耗尽 → `settleUntil(…, '首连耗尽收口', budget=3_000)`（harness.ts:254-265）预算耗尽 **throw → 测试红**。三重后果：(a) §5 矩阵「sa7-issue137-dynamic 全绿」错误，SA3 按设计落地即红 CI；(b) D3b 不在设计任何回退规则覆盖内（D4 回退只覆盖 A1-3/R2-4/D3a/D3c）→ SA3 被迫现场裁量，最坏路径是弱化断言保绿——恰好踩本票「不得顺手改断言」红线；(c) 更深一层：D3b 的被测行为（首个 BOOTSTRAP 帧耗尽额度）在冻结链式下界 `maxQueuedControlBytes ≥ maxBootstrapBytes + 128` 下**结构性不可达**——bootstrap 必须过 `snapshot ≤ maxBootstrapBytes` 检查（frame-io.ts:79 / hub-namespace.ts:403）⇒ 合法配置中 quota ≥ snapshot+128 > snapshot 恒成立。设计对 D3a 的 `controlReserveBytes: 1` 裁决了同类非法性（「任何 maxBootstrapBytes ≥ 1 ⇒ 最小合法额度 ≥ 129」），却没有把同一推理应用到 D3b 的缺省配方——这是同一把刀只砍了一半。D3b 之所以漏网，正因为它**不含 `controlReserveBytes` 字面**（纯缺省），对设计的 grep 型波及排查不可见。 | (1) D4 波及表、§3.2-T6、§9 caller 清单、§5 矩阵全部补入 D3b；(2) 给出合法配置下的场景重设：推荐显式额度采样 `{maxBootstrapBytes: ≥快照+裕量, maxQueuedControlBytes: maxBootstrapBytes+128+小余量}`——bootstrap 消耗绝大部分额度、暂停段后续 control 帧（peer 写驱动的 hub UPDATE_ACK）触发耗尽，保留「触发帧不上 wire + 恰 1 ERROR(CONNECTION_BACKPRESSURE, 无 namespaceId) + close(1011) + backoff + 撤压重连后 BOOTSTRAP_SNAPSHOT 恰 1 帧 + 大 blurb 收敛」全部原有谓词（算术按 D4 同款具名常量派生）；或按 D3a 同款「结构性非法」论证走重设/合并并登记覆盖归宿（不许静默删除）；(3) 文件头 L25 的「b 缺省 64KiB 配方」叙事同步改述（T6 现有措辞「controlReserveBytes=1 极端 等表述」不足以覆盖该行）。 |
| 2 | **MEDIUM** | D5 / C2 第 1 条 / C1 末段（记账口径声明） | **「保守上界 ⇒ 偏向提前 1011 = fail-safe」的论证不严格成立——存在欠计项。** 实现口径 = 暂停段出站 control 实编码字节累计，且 `enterPause` 复位 `controlReserveUsed = 0`（backpressure.ts:186）。协议口径 =「socket 缓冲内**未冲刷**控制字节」。暂停开始时刻之前已发出、仍滞留缓冲的 control 字节（C_pre）被复位丢弃；暂停段内 FIFO 冲刷先排空队头（多为 data），C_pre 可长期未冲刷。真实量 = C_pre + C_pause − F，代理量 = C_pause，差 = F − C_pre——当 C_pre > F（深拥塞下典型）时代理**欠计** → 1011 可**晚于**契约口径触发。「偏高估计、永不欠触发」两处表述（设计 §1-D5、C2 第 1 条「保守上界偏向提前 1011」、C1 末段同款）均过强。本票核心产出就是文档准确性，把一个不成立的 direction claim 烧进 ADR-0010 修订节，是自伤。 | C2 第 1 条与 C1 末段措辞改述为「近似口径：暂停段内偏高（不扣减已冲刷字节）＋段边界复位丢弃暂停前未冲刷残留（偏低）——净方向取决于冲刷进度，不声称恒保守上界」；或先给出 C_pre 的显式界（如 ≤ 暂停触发观察点前的 bufferedAmount 上界）再收敛措辞。注意 SA8 门禁注 1 的条件是「口径句不得**裁剪**」——改述为更准确的登记仍满足「登记」前提；若 SA8 认为构成 C2 变更，按其流程回 SA8 复审一次即可。 |
| 3 | **MEDIUM** | D2 / W-D（it.fails 延后锚机制） | **锚集完整性无常驻守卫：`it.fails` 使「锚被删除/腐烂」与「锚在期望红」在 CI 上不可区分。** 设计自己登记了「不区分因正确原因红与因错误原因红」，但只分析了「错误地红→假绿」方向；没有分析「锚消失」方向：任何未来 PR 删掉一个 it.fails 用例、或重构中改坏断言体，CI 恒绿、无任何信号。「绿→记红」自执行交接只保护 #169/#170/#171 **修复落地**方向，不保护**锚本身的存在性**。本票向 issue 承诺的正是「8 条锚保持可执行红灯」——按当前设计，这个承诺没有机 制保证，只靠注释自觉。 | 二选一（不许空缺）：(a) 常驻 meta 守卫——新增一个普通 `it`，`readFileSync` anchors 文件自身，断言 `it.fails(` 恰 8 处且标题包含冻结清单（A2-1/A2-2/A3-1/A4-1/A4-2/A5-1/A5-2/A5-5）；这是对测试文件自检，不落入 SA6「零源码 grep 断言」纪律的管辖对象（该纪律禁的是对**实现源码**的文本断言）；修复票摘标时同步改 8→7→…→0，天然随票演进；(b) 在设计 §3.3 C1 验收锚段落显式登记 SA7 轮次清点协议（每轮人工核对 8 锚在场并记录于报告），并说明为何不接受 (a)。 |
| 4 | **MEDIUM** | D6 判定标准完备性（去权威化范围） | **两类边界措辞未被 D6 三关键词（「冻结契约/权威设计/契约来源」）判定规则覆盖，实测存在 3 处：** ① `packages/namespace-registry/test/helpers/registry-seam-audit.ts:15` 与 `packages/namespace-runtime/test/helpers/registry-seam-audit.ts:7`：「**设计基准**：wiki/raw/task_namespace-runtime-registry-seam-rev1_design.md（R1）§D-A–§D-D」——把 wiki 设计文档当作全仓门禁实现的**基准**（权威设计的实际效果，且这两个 helper 就是生产白名单收窄门禁的规则来源）；② `packages/vfsl-protocol/test/vfsl-protocol-projection.test-d.ts:281`：「未尽事项**以** wiki/raw/task_vfsl-protocol.md 的 SA6 红灯测试记录**为准**」——「以…为准」= 权威指向。AC 措辞是「not an authoritative contract in source/**specification**」——测试 helper 的规则基准属于 specification 灰区，设计未裁决即放行，SA3/SA4 无所依从。 | D6 增加一行判定规则显式覆盖「设计基准 / 以…为准 / 定稿」类措辞；将上述 3 处纳入必改（改写模式同 §3.4：规范权威 → ADR-0009/ADR-0004，wiki 降为历史设计记录）或逐处明示豁免理由；§5 门禁补 `git grep -n "设计基准：wiki\|以 wiki/raw.*为准" -- 'packages/**'` 预期零命中。 |
| 5 | **MEDIUM-LOW** | W-C C1（phase 文档收敛） | **phase-5 文档既有正文 L123 保留被 #133 round-2 取代的 resetReplica 旧次序叙事**：「Peer `resetReplica(owner, namespaceId, expectedLocalIdentity)` 编排 close→archive→允许 bootstrap」——该次序描述已被 ADR-0010 issue #133 round-2 修订节显式替换（双源核对须在任何 lease 释放/close/归档/bootstrap 资格变更**之前**）。设计只在新插节里用新口径（切片 8 行，正确），旧句子原地保留 → 同一文档内新旧两种次序指引并存。虽不在本票五项收敛主题之列，但与 AC「No contradictory repository guidance」精神冲突，且修正成本一行。 | 在 L23 附近（切片 8 行）加一行 supersede 注记：「执行次序以 ADR-0010 issue #133 round-2 修订节为准（先 reset-fence 双源核对，后任何 close/archive）」；或在设计 D7/C1 中明示豁免与理由（引用 scope 边界），不许沉默。 |
| 6 | LOW | §5 grep 门禁范围 | `git grep -n "controlReserveBytes" -- 'packages/**' 'apps/**' 'docs/**'` 不含仓根与 `tests/**`（实测当前零命中，纯防御性缺口）。 | 改为全仓 grep 后排除 `wiki/**`（历史证据合法保留旧名）。 |
| 7 | LOW | §8-P2 依据强度 | `it.fails` 依据=类型声明+官方文档（无 URL）；运行时语义细节（timeout 计入 fails、unhandled rejection 不被 fails 吸收、报告面）未实测。设计已承诺 SA3 复核，属可接受，但建议补一条最小实测记录。 | SA3 落地时在 PR 描述或 §5 矩阵旁附一次性双向翻转实测（临时把任一绿锁标 `it.fails` → 应红，还原）＋确认 8 锚转绿时套件输出无 unhandled errors；§8-P2 补官方文档 URL。 |

**不成立/不采纳的攻击方向（记录以免复审重复劳动）**：
- 「`it.fails` 会让 boot 期意外 throw 记绿」——设计已自登记该弱点且失败模式被 SA6 运行证据钉死，我复核当前 11 红全部为断言级失败（非 boot 崩溃），接受其风险权衡；
- 「改名后 QUEUE_LIMITS/D4_LIMITS 类级直构会 NaN 静默」——typecheck TS2352 会先拦（双向不可赋值），自守卫比设计声称的更强；
- 「缺省 8MiB 会波及其它缺省额度测试」——全仓排查：依赖**缺省额度耗尽**的仅 D3b（#1）与 r2-transport B 侧（T12 已处理）；g3-g4 A2 锚依赖的是**不耗尽**（1,200B ≪ 64KiB ≪ 8MiB 双向成立）；ac3-bootstrap 的 `maxBootstrapBytes: 64` 与新下界兼容；其余全为显式小额度（D4 表覆盖）；
- 「D5 属伪降级」——WS API 无逐帧冲刷可观察面为真属性（bufferedAmount 仅聚合值），非掩盖 bug；攻击的是其方向性声明（#2），非机制本身；
- 「A5-5 归属 #171 裁决错误」——protocol §21 L567 主语为「replication」、ADR-0010 L179 同款，设计的读法与文本一致且按简报要求显式标注，维持。

---

## 2. 协议假设依据审查（2026-06-13 立法）

- **章节存在**：§8「协议假设依据 (Protocol Assumption Evidence)」在场，9 条（P1–P9），含依据类型栏与风险栏。✅
- **依据可验证性**：P1/P6/P7/P8/P9 为源码引用（我逐条到场复核，行号全部命中）；P3 声称实测并贴了命令骨架+输出（345 bytes）；P4/P5 为源码+现有绿锚联合论证；P2 为类型声明+官方文档（无 URL，见攻击点 #7）。**无「应该/通常/预计」类无据推断**。✅（P2 补强后满分）
- **可被 SA4 重跑**：P1 的 spread 行号、P6 的校验时序、P7 的直构豁免、P8 的注册表行号、P9 的文件头自述算术均可重跑；P3 需 SA3 以真实 fixture 复核（设计已置 BOOTSTRAP_TOO_LARGE 显影兜底）。✅
- **本审查新增的假设缺口**：设计**缺少**一条关于「缺省额度变更对零覆写测试的波及假设」的 P 条目——P9 只覆盖 r2-transport 一个文件，D3b 正是从这个缺口漏掉的（攻击点 #1）。修订时应在 §8 补 P10：「除 r2-transport 外无其它零覆写依赖缺省额度耗尽的用例——依据：全仓 grep CONNECTION_BACKPRESSURE 期望 + 逐文件 limits 覆写审计（列出文件清单）」。

## 3. 错误处理链路审查（2026-05-07 立法，映射到本票的 CI/开发者可感知面）

- **静默失败**：一处——`it.fails` 吸收一切失败使锚腐烂不可见（攻击点 #3，要求常驻守卫）；D3b 前提失效会以 settleUntil throw 显影（不静默），但设计矩阵误报全绿（攻击点 #1）。此外 4 组恒真断言本身就是「断言存在但永不失败」的历史静默失败残留——T7/T8/T11 加固方向正确且我逐处复核了可失败性论证（`toBe(i)` 可因中途派发偏离开红、`toBe(0)` 可因负记账/残留开红、`>=1` 可因零声明开红、Step1 帧数可因零帧开红——均非真空）。✅（修订后）
- **状态闭环**：本票无运行时错误状态面；构造期新 throw 路径（A1-2 TypeError）与既有 pongTimeout 校验同相位、同步抛出，闭环完整。✅
- **降级路径**：不适用（无外部依赖服务面）。
- **虚假降级识别**：D5 不是伪降级（「无逐帧冲刷可观察面」为 WS API 真属性，非正常路径前提缺失）；但其「fail-safe 方向」声明不实，按攻击点 #2 修订措辞。⚠️

## 4. 红线测试思路（供 SA3/SA7 编写，无需 SA2 代写）

1. **（对应 #1，必做）D3b 合法化重设后的红灯→绿灯路径**：显式额度 `{maxBootstrapBytes: 92_000(≥实测快照), maxQueuedControlBytes: 92_128+余量}` + `initialHubPressure` 置暂停 → 首连 bootstrap 上 wire（快照 ≤ 额度，放行）→ K 笔 peer 写驱动 hub UPDATE_ACK 在暂停段累计 → 断言：触发帧（最后一个越界 ACK）不上 wire、恰 1 个 connection ERROR（`CONNECTION_BACKPRESSURE`、无 namespaceId）、`close(1011)`、peer `backoff`（非 blocked）、撤压重连后 wire1 上 BOOTSTRAP_SNAPSHOT 恰 1 帧、大 blurb 收敛、`probe.events` 空（零 unhandled）。边界反向红灯：`maxQueuedControlBytes = maxBootstrapBytes + 128` 等值构造**不得**抛（下界镜像，与 D3a 重设互证）。
2. **（对应 #3，必做）锚集完整性 meta 红灯**：临时删除任一 `it.fails` 用例或把标记改回 `it(` → meta 守卫必须红；恢复后绿。#169 摘 A2-1/A2-2 标记时同步把清单 8→6，meta 守卫随票演进。
3. **（对应 #2）D5 措辞一致性检查（SA7 轮次人工面）**：以「暂停段中途撤压→再置压」双段序列观察 `controlReserveUsed` 复位（enterPause/resume 双复位点）与 ADR 登记措辞一致；不接受任何声称「恒保守上界」的残留文本（grep `保守上界` 于 docs/ 应只剩改述后措辞）。
4. **（对应 #4）去权威化边界 grep 门禁**：`git grep -n "设计基准：wiki\|以 wiki/raw.*为准" -- 'packages/**'` → 预期零命中（改写后）。
5. **（对应 #7）it.fails 双向翻转一次性实测**：本地分支临时将 A3-2（绿锁）标 `it.fails` → 套件应红（绿→记红方向验证）；还原后 8 锚期望红全记绿（红→记绿方向验证）；全程零 unhandled rejection。验证记录附 PR。
6. **（既有设计已含，确认保留）§5 加固反证门**：T7/T8 任一加固断言红时不得回退恒真——与我第 1 节「不成立攻击」中复核的可失败性论证互为表里。

---

## 5. 结论与裁决

**Verdict: reject。**

- 拒绝理由集中在四点，全部可修且修法明确：**#1 D3b 漏判（CRITICAL，预期矩阵错误 + 结构性非法场景未裁决 + 回退规则盲区）**、#2 D5/C2 方向性声明失实（MEDIUM，防不准确论证进 ADR）、#3 锚集完整性守卫缺失（MEDIUM，it.fails 策略的必要补丁）、#4 D6 判定规则缺口（MEDIUM，3 处边界措辞未裁决）。
- 设计的其余部分——范围总裁决（契约收敛票非行为修复票）、五组偏差的行级根因、D3 归属裁决、D4 校准算术、D7 不动面、§8/§9 取证、ALLOW/DENY 边界——经我独立核验**大面积成立**，修订不需要推翻架构，只需要补洞。
- 复审焦点（下一轮 SA2 只查这四点 + 修订未引入新偏差）：D4/§3.2-T6/§5/§9 是否补齐 D3b 且场景重设算术自洽；C2/C1 措辞是否去除「保守上界/fail-safe」过强声明；W-D 是否落锚集守卫或登记等效协议；D6 是否覆盖「设计基准/以…为准」并裁决 3 处实例。

**验证证据（本评审全部结论的可重跑命令）**：

```bash
# 锚文件当前红态（11红5绿复现）
pnpm exec vitest run packages/ws-replication/test/ws-replication-issue172-contract-anchors.test.ts
# D3b 零覆写证据（bootLocal limits 可选、D3b 未传）
sed -n '318,352p;657,663p' packages/ws-replication/test/ws-replication-sa7-issue137-dynamic.test.ts
# settleUntil 有界预算（红而非挂死）
sed -n '254,265p' packages/ws-replication/test/harness.ts
# enterPause 复位（欠计项根源）
sed -n '183,196p' packages/ws-replication/src/backpressure.ts
# it.fails 类型声明在场
sed -n '100,112p' node_modules/.pnpm/@vitest+runner@3.2.7/node_modules/@vitest/runner/dist/tasks.d-CkscK4of.d.ts
# controlReserveBytes 波及面（12 文件，与 ALLOW 对应；D3b 因零字面而漏网）
git grep -n "controlReserveBytes" -- 'packages/**' 'docs/**'
# D6 边界措辞 3 处
git grep -n "设计基准：wiki\|以 wiki/raw.*为准" -- 'packages/**'
# phase 文档旧次序残留
sed -n '121,126p' docs/phases/phase-5-websocket-replication.md
```

---

# SA2 R2 复审（2026-08-30）

**被审对象**：design R2（591 行，文首修订记录自陈闭合 R1 全部 7 项）
**复审范围**：R1 四焦点 + 三个次级项的闭合独立核验 + 修订引入新偏差扫描。R1 已通过的取证（§0 表格、G1–G5 根因、D4 算术、D3/D7 裁决、协议冻结值）不重做——R2 未改动这些面（逐节比对确认）。
**前置完整性检查**：`git status --porcelain packages/ apps/ docs/` 仅锚测试文件为未跟踪新增，src/docs 零改动——R2 仍是纯设计态（hub-connection.ts 中「§4.3 豁免（R2，SA2 #2）」注释经 `git show HEAD:` 核验为 PR #165 既有提交内容，指 backpressure-r2 票的 SA2 发现，非本票越权改动）。

## R2-1. 四焦点闭合核验（独立验证，非采信自陈）

| R1 焦点 | 设计 R2 声称 | 我的独立验证 | 结论 |
|---|---|---|---|
| #1 D3b 漏判（CRITICAL） | §0/§1-D4 波及表第 5 行 + 结构性不可达推理 + 回退规则 D3b 单列 + T6-D3b 重设 + §8-P10 + §9 caller 表 | ① 波及表/P10/§9 均已补入 ✓；② 结构性不可达推理核验成立：`frame-io.ts:75-85`/`hub-namespace.ts:403` 快照门 + 下界 ⇒ `quota ≥ mBB+128 > snapshot+envelope`，单个 BOOTSTRAP 帧不可能越限——与 R1 推理一致且补全了帧字节论证 ✓；③ `bootLocal` 确有可选 `limits` 参数（:658）且双构造器同传（走新校验）✓；④ 92_128 = 92_000+128 等值通过下界、压力 1MiB > 缺省 highWater 512KiB 使暂停段自 HELLO_ACK 起全程计数 ✓；⑤ 断言①②④⑤⑥逐条按代码路径核验成立（UPDATE_ACK 每笔一发为 R2-4 同构机制；触发帧谓词 = backpressure.ts:81-85；ERROR 恰 1 由 closedFlag 防递归；`wire.hubToPeer` 存原始 bytes ⇒ C_live 自校准可实现）；⑥ P10 的 7 文件清单与我 R1 独立审计一致 ✓ | **闭合 5/6——断言③存在新 oracle 缺陷**（§R2-2 #8，阻断） |
| #2 D5/C2 方向性声明失实 | §1-D5 整节改述 + §3.1 注释草案 + C1 末段 + C2 第 1 条 + §5 门禁③ | 四处措辞全部改为「近似口径：段内偏高 + 段边界丢弃 C_pre（偏低）——净方向取决于冲刷进度」，与我 R1 给出的 `F − C_pre` 分解逐字同构 ✓；门禁③基线实测：`git grep "保守上界\|fail-safe" -- docs/ src` 当前零命中（改后门禁可干净通过，无假阳性地雷）✓ | **闭合** |
| #3 it.fails 锚集无常驻守卫 | §1-D2-bis meta 守卫（选方案 (a)）+ T3 规格 + §5 矩阵 17 用例 + 双向翻转实测 | 守卫代码草案逐点核验：计数正则 `/it\.fails\(/g` 不自匹配（守卫源码中是 `it\.fails\(` 带反斜杠字面）✓；标题锚定正则 `it\.fails\('A2-1 ` 与「A2-1 RED：…」标题形态匹配（锚号后有空格）✓；`import.meta.url` 指向 .ts 源文件（vitest 变换不落盘原路径）✓；归口注释「以 it.fails 注册」无括号不被计数 ✓；随票演进 8→6→…→0 与摘标流程闭环 ✓；纪律合规论证成立（守卫对象是测试文件自检，非实现源码文本断言）✓；§5 双向翻转实测三步覆盖 R1 #7 的运行时语义存疑 ✓ | **闭合** |
| #4 D6 判定缺口（3 处） | 五类关键词 + helper/test-d「specification 灰区从严」+ §3.4 #21-#23 + §5 门禁② | 门禁②模式实测当前命中**恰 14 处**（11「契约来源」+ 2「设计基准」+ 1「以…为准」），与 §3.4 #10-#23 一一对应、零漏网零误伤 ✓；#21/#22 权威改挂 ADR-0009 与 helper 头部既有两处 ADR-0009 引用同源 ✓；#23 改挂 ADR-0004 + 本文件断言即规范载体 ✓ | **基本闭合**——残留 class-⑤「定稿」规则文本与清单/门禁周界不一致（§R2-3 #9，非阻塞） |
| #5–#7 次级项 | C1-a L123 supersede 注记 / 门禁①改全仓-exclude wiki / P2 补 URL+实测 | C1-a 替换文本以 #133 round-2 为准且保留编排职责描述（非静默删除）✓；`:(exclude)wiki` pathspec 语法正确且覆盖 R1 #6 诉求 ✓；P2 实测承诺落 §5 ✓（URL 本身未独立验证，见 #10） | **闭合**（#10 除外） |

## R2-2. 攻击点清单（R2 增量）

| # | 严重度 | 攻击面 | 具体漏洞 | 建议修订 |
|---|--------|--------|---------|---------|
| 8 | **HIGH（阻断）** | §3.2-T6 D3b 断言③（R2 新引入） | **断言③「wire0 hub→peer 累计字节 ≤ 92_128」与既有 §4.3 豁免路径矛盾——oracle 把「wire 字节」当「记账字节」。** 触发耗尽时收口路径 `connectionFatal`（hub-connection.ts，PR #165 既有）**先 `sender.teardown()` 再把 ERROR 帧直发 `outbound.sendControl`——绕过 sender 额度判据与记账**（代码注释原句：「§4.3 豁免（R2，SA2 #2）：收口 ERROR 直发 outbound——绕过 sender 额度判据」；teardown 后 `onEmitted` 因 `paused=false` 也不再计入）。因此触发时刻 wire 总字节 = 已记账字节（= C_live + allowed×ack ≤ 92_128）**+ 1 个不记账的收口 ERROR 帧（≈50–60B）**。按设计自己的估算数：slack = 92_128 − 91_000 − 19×57 = 45B < ERROR 帧字节 → wire 总字节确定性 > 92_128 → **断言③红**。一般化：slack = (92_128 − C_live) mod ackBytes ∈ [0,56)，断言③在 slack < ERROR 帧字节的全部 C_live 取值下红——设计期不可控的掷骰。影响链与 R1 #1 同型但窄得多：§5 矩阵「sa7-issue137-dynamic 全绿」再次错误；D4 校准门的三个 D3b 回退分支（BOOTSTRAP_TOO_LARGE / C_live 不足一笔 ACK / reconcile 自身越限）**均不覆盖此红**——SA3 再度面对无回退的意外红，最坏路径是魔法数放宽（`≤ Q + 200` 式）——恰是本票要消灭的断言退化形态。 | 断言③一句话改述：「**除收口 ERROR 外**的 wire0 hub→peer 累计字节 ≤ 92_128（收口 ERROR 直发 outbound、§4.3 豁免不记账——hub-connection.ts `connectionFatal`；断言④的单 ERROR 帧单列）」或等价形（ERROR 帧字节从总和中显式剔除）。T6-D3b 注明该豁免的代码引用，使断言口径与记账口径显式解耦。其余五条断言不动。 |
| 9 | LOW（非阻塞） | §1-D6 class-⑤ 关键词周界 | 规则文本把「定稿」列为权威性关键词，但 23 项改写清单与门禁②均不含它——而 src 中实有 9 个文件含「定稿」措辞（tx-guard/install-verify/detached-build/create-initial-document/registry/pattern/validate/materialize/replication-session；后两者已在改写清单）。这些多为「消息措辞定稿（revN 设计 §Y）」式**出处叙述**（记录措辞在哪轮定稿，无 wiki/raw 路径、无 defer 语义），按 AC 精神可归叙事身份；但规则文本与清单/门禁三者周界不一致会让 SA3/SA4 各自裁量。 | D6 补一句裁定：「class-⑤ 的『定稿』限定为『以…为准』式权威指向；『X 定稿（revN 设计 §Y）』出处叙述归叙事身份不动（9 文件已逐类核验）」。或把「定稿」从关键词表中移除。不要求扩大改写清单。 |
| 10 | LOW（非阻塞） | §8-P2 官方文档 URL | `https://vitest.dev/api/test.html` 未能独立验证（vitest 3.x 文档结构疑为 `/api/test` 无 .html 后缀）；承重证据是类型声明（已核验），URL 仅辅助。 | SA3 落地时顺手核准 URL 或删除该引用，不作为门禁条件。 |

**R2 新增不成立/不采纳方向（记录）**：
- 「D2-bis 守卫会被 vitest 变换欺骗」——不成立：`import.meta.url` 在 vitest ESM 下指向磁盘上未变换的 .ts 源文件，`it.fails(` 字面可读；
- 「守卫正则自匹配」——不成立：反斜杠字面不匹配（设计 T3 注意事项已自我显影该点，核验属实）；
- 「D3b 的 `allowed` 依赖运行时实测 C_live 属恒真风险」——不成立：`allowed` 由 quota−C_live 派生且断言②以实际写次数 allowed+1 对照 wire ACK 计数，可失败性完备；
- 「D3b 重连后 wire1 再度耗尽」——不成立：撤压后无暂停段，记账不启用；
- 「C1-a 修改既有正文违反 append-only 惯例」——不成立：append-only 惯例约束 ADR，phase 文档的交付现状修正是本票 scope 2 的对象。

## R2-3. 红线测试思路（R2 增量）

7. **（对应 #8，必做）断言③修正形的反向验证**：在修正后的 D3b 上临时把收口 ERROR 帧计入字节总和（即故意实现错误 oracle）→ 断言③必须红（证明修正形确实捕捉记账/wire 口径差）；还原后绿。同族：断言④「恰 1 ERROR」与断言②「UPDATE_ACK = allowed」联合锁定「触发帧缺席 + 豁免帧在场」两个方向。
8. **（对应 #9，可选）D6 周界自检**：SA4 静态门禁复跑门禁②并抽查 2 处「定稿」出处叙述未被误改（防过度清扫 scope creep）。

## R2-4. R2 裁决

**Verdict: reject（窄域）。**

- 四焦点闭合质量高：#2/#3/#4/#5 经独立核验**完全闭合**（D5 措辞与我的分解逐字同构、meta 守卫五个技术点全部成立、门禁②命中集与清单一一对应、C1-a supersede 注记得当）；#1（D3b）的波及登记/结构性推理/回退规则/P10 审计全部到位。
- 唯一阻断项 = **攻击点 #8**：R2 重写的 D3b 断言③把「wire 总字节」当「额度记账字节」，与代码既有且自带注释的 §4.3 收口豁免（ERROR 直发不记账）直接矛盾——按设计自身估算数确定性红，且不在任何回退分支覆盖内。这是一句话级修订（断言③剔除收口 ERROR 帧字节 + 注明豁免引用），但按 R1 同一标准——**设计按字面执行不能兑现其 §5 矩阵承诺即 reject**——维持拒绝。SA1 不需要再动其他任何面。
- #9/#10 为非阻塞备注：SA1 可顺手一并处理（两句文字），R3 复审只验 #8（+#9/#10 若处理则抽查）。

**R2 验证证据（可重跑）**：

```bash
# §4.3 豁免存在性与方向（既有行为，非本票改动）
git show HEAD:packages/ws-replication/src/hub-connection.ts | sed -n '/private connectionFatal/,/cleanupAll/p'
# 纯设计态前置检查（src/docs 零改动）
git status --porcelain packages/ apps/ docs/
# 门禁② 基线：当前命中恰 14 处 = §3.4 #10-#23，零漏网
git grep -nE "契约来源：wiki|设计基准：wiki|以 wiki/raw.*为准" -- 'packages/**' 'apps/**' 'docs/**'
# 门禁③ 基线：零预存命中（改后可干净通过）
git grep -rn "保守上界\|fail-safe" -- 'docs/**' 'packages/ws-replication/src/**' ; echo "exit=$?"
# D3b 可行性事实：bootLocal limits 可选参数 + Wire 存原始 bytes
sed -n '655,662p' packages/ws-replication/test/ws-replication-sa7-issue137-dynamic.test.ts
grep -n "return (dir === 'peerToHub'" packages/ws-replication/test/ws-replication-sa7-issue137-dynamic.test.ts
# class-⑤ 周界：9 个含「定稿」的 src 文件（仅 2 个在改写清单）
grep -rln "定稿" packages/*/src/*.ts
```

---

# SA2 R3 窄域复审（2026-08-30）

**被审对象**：design R3（594 行；R2→R3 = +3 行，改动自陈仅 #8 修正 + #9/#10 两句）
**复审范围**：R2 唯一阻断 #8 的闭合核验 + #9/#10 抽查 + 修订越界扫描（不改 R1/R2 已裁定面）。

## R3-1. #8 闭合核验（阻断项）

**设计侧改动**（§3.2-T6 D3b 断言③，唯一实质改动点）：

1. **oracle 修正**：断言③ → 「**除收口 ERROR 帧外**的 wire0 hub→peer 累计字节 ≤ 92_128」，收口 ERROR 单列于断言④——与我 R2 给出的修订要求逐字对应。✅
2. **豁免引用落文**：引 §4.3 豁免 + `hub-connection.ts:397-415` + PR #165 既有注释原文。**行号实测核验**：`connectionFatal` 在工作区文件中恰起于 :397、止于 :415——引用行级精确。✅
3. **oracle 完备性（本轮新增核验，防「剔除 ERROR 后仍有第三类不记账帧」）**：`sendControlChecked` → `this.sender.sendControl(message)` 单点（代码注释原句「§4.3：保留额度判据在 sender.sendControl 单点（收口路径直发 outbound 豁免）」）——**全部非收口控制帧必经记账路径**；D3b 场景下 wire0 hub→peer 无 data 帧（hub 自 HELLO_ACK 起暂停、无本地写）。故 wire0 帧划分 = {已记账控制帧} ⊎ {恰 1 个豁免收口 ERROR（由④钉死）}，断言③的新口径「除收口 ERROR 外 = 记账字节 ≤ 额度」**构造性成立**，不再依赖 slack 掷骰。✅
4. **反向验证嵌入**：错误 oracle（把收口 ERROR 计入总和）→ ③ 必红、还原后绿——即 R2 红线 7 原样落文。✅
5. **其余五条断言零改动**：①BOOTSTRAP 恰 1 帧 / ②UPDATE_ACK = allowed 且写 allowed+1 / ④恰 1 ERROR / ⑤1011+backoff / ⑥wire1 bootstrap+收敛+probe 空——与 R2 逐字一致（R2 已核验成立的五条不被顺手改动）。✅

**结论：#8 闭合。** 断言口径（wire 观测）与记账口径（额度判据）显式解耦，§5 矩阵「sa7-issue137-dynamic 全绿」在本断言上不再有已知反例。

## R3-2. #9/#10 抽查（非阻塞项）

- **#9（D6 class-⑤「定稿」周界）**：裁定句按 R2 建议落文——「定稿」仅当构成「以…为准」式权威指向时必改；「X 定稿（revN 设计 §Y）」出处叙述归叙事身份；9 个含「定稿」src 文件逐类核验清单与我的 R2 审计**完全同集**（tx-guard/install-verify/detached-build/create-initial-document/registry/pattern/validate/materialize/replication-session），明示不扩清单、不加门禁。✅ 闭合。
- **#10（P2 URL）**：URL 降级为辅助引用并标注「未能独立验证、SA3 核准或删除、不作门禁条件」，承重证据维持类型声明（R1 已核验在场）。✅ 闭合。
- §6 回应表 #8/#9/#10 三行齐全；修订记录如实标注「极窄修订、其余设计面零改动」——591→594 行差与五处改动（修订记录/D6/断言③/§6 行/P2）相称，无越界改动迹象。✅

## R3-3. R3 裁决

**Verdict: pass。**

- R1 四焦点 + R2 唯一阻断 #8 + 两条非阻塞备注，经三轮独立核验全部闭合；R3 修订严格限定在指定位点且方向正确。
- 残余风险登记（非阻塞，移交 SA3/SA4/SA7，设计已自带兜底）：D3b `C_live ≈ 91_000` 为估算值，实测漂移由 §5 D4 校准门三分支回退覆盖；P2 URL 由 SA3 核准；门禁①②③ 由 SA4 静态复跑。
- **限定语（依 SA2 章程）**：`pass` 仅表示**设计**通过攻击评审、同意放行进入 SA3 实现；不替代 SA4 静态门禁与 SA7 活链路动态验证对实现质量的裁决。

**R3 验证证据（可重跑）**：

```bash
# #8-2 行号精确性：connectionFatal 恰为 :397-415
grep -n "private connectionFatal" packages/ws-replication/src/hub-connection.ts   # → 397
sed -n '395,416p' packages/ws-replication/src/hub-connection.ts                    # 函数体含 §4.3 豁免注释
# #8-3 oracle 完备性：非收口控制帧单点走 sender（记账）
sed -n '/private sendControlChecked/,/^  }/p' packages/ws-replication/src/hub-connection.ts
# R3 修订位点定位（五处）
grep -n "R3" wiki/raw/task_phase-5-websocket-replication-contracts_design.md | head
# 纯设计态（src/docs 仍零改动）
git status --porcelain packages/ apps/ docs/
```
