# 设计后复审冲突报告 — issue #134 Round 2（R2 设计增补 618 行）

- 被审对象：`wiki/raw/task_namespace-lease-replication-session_round2_design.md`（SA1 R2 增补首版，618 行）
- 冲突基准：与 Round 2 前置门禁同一标准——ADR 全集 10 份（重点 0010 含 #134 修订节、0008 含 #93/#132、0009 含 #131/#134）+ `CONTEXT.md`；phase-5 切片文档与 round-2 任务简报为规范依据文本（非自动阻塞基准）
- 复用 round-2 前置门禁结论（verdict clear，#1–#12 + 登记义务 D-1..D-4 + 放行方向），不重复全量盘点
- SA8 设计后复审（Round 2），2026-08-28

## Verdict

`clear`

设计增补对评审 12 项的机制修法、六项待冻结裁决（F-1..F-6）、登记义务落地条目（§14）与公共面纪律**均无 ADR/CONTEXT 级冲突**：无 hard-violation、无 override-declared、无未声明演进。总控指定的六组复审重点逐条核对全部通过（见 §1–§6）；设计声称的关键基线事实经本复审逐项 grep/sed 实证（见 §7，9/9 属实）。放行附带 2 项放行条件（文档同步落盘闭环）与 4 项残留风险（非阻塞，移交 SA2/SA3/SA7）。

---

## 1. 重点 ① — §14 ADR 0010 修订节增补条目 vs 登记义务 D-1/D-2a/D-2b/D-3/D-4（逐字覆盖核对）

| 义务 | 前置门禁要求（round2_conflict_report） | 设计 §14 落地条目 | 覆盖结论 |
|---|---|---|---|
| D-1 | fanout 投递异步化 + 撤销「无队列⇒L113 不可达」读法（design L24/L370）+ L241「熔断/背压属切片 6」收窄为「WS 发送队列/连接级背压（L151 域）」+ observerFailures 语义不变 + phase-5 L81 C-1 注记改写 + needs-resync 标记后行为由 SA1 冻结 | §14 ADR 行 (D-1)：owned bytes 复制（observer 内同步=六步之 4「产出」）+ 每 session 有界队列（容量 16 冻结常量）+ 自延伸微任务泵 + 溢出弃新置 needsResync（sticky、**继续投递**、status 第 11 字段）；撤销 round-1 读法；L241 收窄注记；observerFailures 不变；两级副本性能注记。phase-5 行：C-1 注记改写为「needs-resync 于本切片落地；WS 发送队列仍属切片 6」；CONTEXT.md 行：词条追加 needs-resync 句 | **逐字覆盖**。前置留给 SA1 的「标记后行为」已由 F-1 冻结为「继续投递」且给出 ADR 字面依据（L113「**只**把 channel 标记」——标记是观测信号非行为切换；与 L241「不熔断不自动退订」同构）——读法成立 |
| D-2a | 修订节 L245/L247 增补 bump 槽主动 fence 触发面（conflicted 终态 + fanout.detach 复用，零新增终态语义） | §14 (D-2a)：L245/L247 增补 bump 槽 E5.5 主动 fence（conflicted 终态 + detach + **未投递排队项取消**——F-3 词义）；与 apply 槽 R2 共用 finalize | **覆盖并增补**（排队项取消细节有独立 ADR 依据，见 §2 第 4 行核对） |
| D-2b | 修订节 L246/L247 增补 Runtime close 触发面（同步段终止/detach；已接纳 apply 槽排空——0008 L93/L179 锚）；session 终态词汇由 SA1 冻结 | §14 (D-2b)：L246/L247 增补（lifecycle 翻转后、barrier 前）terminateAll → 终态 `closed` + 排队项取消；已接纳 apply 无条件排空；其后 apply 映射 `RUNTIME_WRITE_DISABLED`（#93 第 (4) 类域）；encodeStateVector/encodeDiff 确定 throw。F-2 已冻结终态词汇 = `closed` | **覆盖**。留给 SA1 的终态词汇已冻结（F-2：closed 家族，conflicted 保留给 epoch fence——与 L245 词义不污染） |
| D-3 | 修订节 L251 增补判据细化（结构值规范化深比较；规范化语义——键序/类型/Yjs 容器投影规则——由 SA1 冻结并锁定测试） | §14 (D-3)：L251 增补判据细化（§5.2 规则表全文——键序无关/数组有序/SameValue/Yjs 容器 toJSON 投影/契约外保守拒）+ META 值域零收窄注记 | **逐字覆盖**。§5.2 规则表正是「规范化语义冻结」；锁定测试锚已列（§5.3/§15.2 规则矩阵） |
| D-4 | 保守过报规范与「成功接纳即置位」明文随文档同步入 ADR 0010 修订节/README | §14 (D-4)：L237 增补 committed **精确二分**（beforeTransaction 探针；精确性条件 = yjs 事务钩子域注入；复合敌意除外注记）；L241 增补「成功接纳即置位」明文（§8 引文）；README §12 第 8 条（二分 + 成功接纳即置位） | **覆盖（升级形式）**。前置门禁 #5 明文授权两条子路径：「(i) 能区分（beforeTransaction 未开始 ⇒ committed:false）则精确；(ii) 不能区分则保守 true + 明文规范」——设计取 (i) 且**保留** (ii) 的保守分支（`txStarted=true ⇒ 保守 true`，ADR 0008 L84 引用）；「例外注记」即「不宣称绝对精确」的诚实边界声明——D-4 的「明文」义务以更强的形式履行 |

**结论 ①：D-1..D-4 全部覆盖，无遗漏、无弱化。**

## 2. 重点 ② — §1 round-1 断言作废清单五处的合法性（append-only 演进 vs 篡改历史裁决）

| # | 作废对象 | 作废依据 | 是否触碰 ADR/CONTEXT 冻结词 | 裁决 |
|---|---|---|---|---|
| 1 | round-1 设计 §0 O-10（L24 实证存在）「同步扇出天然不阻塞 sequencer」 | SA8 D-1 指定（前置报告 #1 明文点名两处断言作废——事实性错误） | 否——「同步扇出」未进 ADR 修订节（修订节仅登记 observerFailures 计数语义与队列属主归属）；phase-5 L81 注记是 C-1 产物（实施合同文档），随 §14 改写 | **合法**（SA8 指定路径执行） |
| 2 | round-1 设计 §4.4 R5（L370 实证存在）「事务内同步扇出 = 六步之 4 结构性满足」 | SA8 D-1 指定（读法不完备：六步之 4 要求「产出」，不要求同步执行 listener） | 否——纯设计层读法 | **合法**（同上） |
| 3 | round-1 设计 §5.5（L522 实证存在）「Registry 不主动终态化 session（保持 open 但写通道死）」 | 评审阻断 2（R2-2 合同）+ 前置 #3 裁决（Runtime close 触发面是 L90 同款生命周期纪律的更强事件） | 否——该断言未进 ADR 修订节/CONTEXT；ADR 侧演进全走 §14 D-2b append-only | **合法**（评审驱动修订，伴登记） |
| 4 | round-1 设计 §9.1 T-3（L642 实证存在）+ runtime 测试 L344 `afterBump===1` → `===0` | F-3：fence 取消未投递排队项 ⇒ bump 写零投递 | **是（有依据）**——ADR 0010 修订节 L262 踩坑注记明文「META 触碰的管理写（enable/bump）字节**不得经 raw 回灌**对端——epoch 传播走控制面」：round-1 的 afterBump===1 行为（bump 字节投给存量 listener ⇒ transport 转发对端）与 L262 相抵触，F-3 修正正是 L262 的机制落实。测试锚值是代码资产非 ADR 冻结词；§15.2 明文登记演进 | **合法且为 ADR 既有注记的正确执行**（round-1 锚锁定的行为本身与 L262 有未察觉张力） |
| 5 | round-1 设计 §5.5（L522 同段）「encodeStateVector best-effort 不承诺」→ 确定 throw | O-9 终态纪律统一的推论性收窄：round-1 冻结词（relevant_decisions 追加节）「SV/diff **终态** throw `ReplicationSessionClosedError`」原本覆盖显式 close/conflicted；R2-2 使 Runtime close 派生终态落入同一纪律（行为从「open 残留下的 best-effort」收窄为「终态 throw」） | 否——收窄方向与 round-1 冻结词**同向**（统一终态行为），非反转；无 ADR 条款要求 Runtime close 后 SV best-effort（L125-129 degraded 域保留 state-vector 交换与 close 域无关） | **合法**（终态纪律一致性收窄，随 D-2b 登记） |

**结论 ②：五处作废全部合法。**两处为 SA8 D-1 指定；三处自主追加均有权威依据（评审阻断 2 / ADR 0010 L262 既有踩坑注记 / O-9 终态纪律统一），且无一篡改 ADR/CONTEXT 已冻结词汇——ADR 侧的全部语义演进（L237/L241/L245/L246/L247/L251 增补 + phase-5 L81 改写）都收敛到 §14 的修订节 append-only 增补，符合「明文修订 + 正式登记」纪律。§1 表头诚实声明「SA8 指定两处 + 充分推演追加三处」。

## 3. 重点 ③ — §4 队列/泵/needs-resync 语义 vs ADR 0010 L113/L151/L241 词义对账

| 对账维度 | ADR 词义 | 设计语义 | 裁决 |
|---|---|---|---|
| 溢出处置 | L113「队列溢出**只**把 channel 标记为 needs-resync，不得阻塞 write sequencer」 | 标记 needsResync + 丢弃新项 + **继续投递**（F-1） | **一致**——「只标记」的字面即「不改变其他行为」（观测信号非行为切换）；「继续投递」与 L241「不熔断不自动退订」同构互证 |
| sequencer 非阻塞 | L113「不得阻塞 write sequencer」 | observer 内只做 O(1) 谓词 + 字节复制 + 入队；listener 调用全部移入泵（微任务）；§4.3(a)(b) 跳数论证（写结算 ~5-8 跳 < 首投递 ≥20 跳；自延伸单续体不霸占微任务队列） | **一致**——慢/重入/不返回 listener 不再进入 transaction 返回路径（阻断 3 病灶消除）；字节复制的 O(bytes) 是事务内必要成本（round-1 同款），非新增阻塞源 |
| 队列属主分界 | L151「Per-namespace 有界队列……网络背压不得进入 Runtime sequencer」（WS 发送队列域） | §4.4 表格明文分界：本队列 = fanout 投递队列（runtime 内 session 域）；WS 发送队列/连接级背压仍属切片 6 | **一致**——两队列域分界清晰；L241 收窄注记按 D-1 落地（「属切片 6」收窄为 L151 域） |
| observerFailures | L241「扇出 listener 自捕获计数；无界纯计数、不熔断不自动退订」 | §4.2 要点 5：语义不变，仅捕获点从 observer（transaction 栈内）移到泵（栈外）；隔离从「异常域」升级「异常域+时序域」 | **一致**——L241 不指定计数发生位置；「不熔断不退订」在异步泵下逐字保持 |
| status 形状 | 修订节 L241 列举 10 字段（state+四域+direction+currentEpoch+rootValidation+durability+observerFailures） | 追加 `needsResync: boolean` 第 11 字段 | **一致（登记内）**——append-only 增补已入 §14 D-1（「status 第 11 字段」）；「session 恰十键 Equal 锁」指 ReplicationSession **能力对象**（§20.5 区分正确），非 status；Equal 格架（§13.2）编译期强制两点同步 |
| 容量 16 冻结常量（不可配置） | ADR 0010 §资源限制 L165「以下上限均为插件配置并提供安全默认值」——列举为 WS 层上限（frame/diff/channel 数/待发送字节/timeout/心跳） | F-1：冻结常量，沿 L121「raw caller 不得逐次自定义」同款纪律类比 | **无冲突**——L165 是 WS 插件配置面的列举（不含 runtime 内 fanout 投递队列）；冻结常量防 raw caller 定制逃逸的类比自洽；该常量作为新冻结词汇已入 §14 D-1 登记 |
| 溢出丢弃策略（弃新保旧） | L113 未规定；L151（WS 域）「丢弃未发送增量」 | 弃新保旧（保序投出最旧），引 L151 为「同向」类比 | **一致**——L113 对丢弃端点无词义约束，设计自由度；类比引用而非越域套用（§4.4 表格明示域分界） |

**结论 ③：§4 与 L113/L151/L241 三处词义对账全部一致。**

## 4. 重点 ④ — §5 规范化深比较 vs ADR 0008 L31 红线

- **红线显式遵守**：§5.2 明文「META 值域零收窄（D-3 红线）：本设计不触碰 ADR 0008 L31『值只允许 JSON-compatible plain value』的整体值域；深比较只在受保护字段投影比对域内执行完整」。✓
- **值域覆盖而非收窄**：`protectedValueEqual` 把 Y.Map/Y.Array（含嵌套，经 Yjs 物化的合法 plain 值形态）经 `toJSON()` 投影纳入深比较——L31 合法值域（plain value 含 object/array）全量可正确判等；契约外形态（undefined/bigint/symbol/function/其它实例）保守判「已改变」——这些**本来就是 L31 值域外**（「只允许 JSON-compatible plain value」），保守拒是 L31 的执行而非收窄。✓
- **保护面零放宽**：受保护字段集合不变（RAW_PROTECTED_FIELDS 冻结常量保留，§13.1）；判据名不变（内容投影相等）；键集先行（red #12 真改仍拒）；同值重写边界（L252）结构值下延续。唯一行为变化 = 「未变化的结构值」从误拒变为正确放行——L105「确认 update 不改变」字面的一致性修正（前置 #4 裁决路径 的定义）。✓
- **规范化语义冻结完备**（D-3 要求项逐一落实）：键序无关（键集 sort 比对）、数组有序、SameValue（NaN=NaN、-0≠0——较 JSON 语义更严，保守方向）、Yjs 容器 toJSON 递归投影、异构容器（Y.Text 等）经投影类型分叉保守拒、嵌套递归。✓
- **Y.Text 分叉细节**：不经特判 → 投影 string vs array/object 分叉 → 拒——与 L31「不允许嵌套 Yjs shared type」一致（Y.Text 出现在受保护字段值 = 契约外）。✓

**结论 ④：未触碰红线，且以显式声明 + 值域覆盖证明双重闭合。**

## 5. 重点 ⑤ — §9 plugin role 贯通 vs O-4 / 切片 9

- **路径合法**：前置 #7 双路放行，设计选贯通路（评审建议方向），收窄声明随之不需要。✓
- **O-4 词汇复用**：role 值域非法 → `NAMESPACE_REGISTRY_ROLE_INVALID` TypeError（types.ts:87 实证存在）——O-4「非法值 → 构造期同步 TypeError」同款（plugin 工厂调用期 = 构造前奏；Registry 直构路径的检查保留不变，两层不冲突）。✓
- **键集/文案 append-only**：`NAMESPACE_REGISTRY_PLUGIN_CONFIG` 为既有码（plugin.ts:149-158 实证：现行序 = 对象形状 → 键集 → resolveIdleTimeoutMs，与 §9.1 描述一致）；仅 message 文案演进（「仅接受 idleTimeoutMs 键」→「与 role 键」）+ 唯一文案锚 registry-plugin.test.ts:240 同步一行（§15.2 登记）。✓
- **根因实证**：registry.ts `createNamespaceRegistry`（L1329-1341 实证）展开确缺 `role` 键——`CreateNamespaceRegistryOptions.role`（types.ts:554 实证已声明）未被透传，「生产 composition 无法构造 peer Registry」根因之二属实。✓
- **切片 9 条款**：贯通 = 显式传 role 通道前置（「生产 composition root 必须显式传」的机制提前），README §12 registry 第 2 条明文「切片 9 义务提前」；缺省 'hub' 零回归（O-4 冻结：不传 ⇒ 基线全权限等价面）。✓
- **公共面**：config `role?` 可选键加法兼容（§19 连锁审计列明 caller 与零回归路径）。✓

**结论 ⑤：一致。**

## 6. 重点 ⑥ — §16 版本 bump 面

- 简报（round-2）L101 要求「改过代码的包必须 bump patch 版本号（namespace-runtime / namespace-registry）」：runtime 0.1.9→**0.1.10**、registry 0.1.5→**0.1.6**（现版本 package.json 实证 0.1.9/0.1.5 属实），均 patch、仅 version 字段、exports/dependencies 零改动（DENY LIST）。✓ 与两包实际改动面（runtime 三文件 / registry 四文件 + status 类型）匹配。**一致。**

## 7. 基线事实抽查（设计声称 → 本复审实证）

| 声称 | 实证 | 结果 |
|---|---|---|
| runtime/registry 版本 0.1.9 / 0.1.5 | package.json:3 两包 | ✓ |
| PEER_ALLOWED_META_KEYS 零外部引用 | grep 全域：仅 replication-session.ts:219 定义 + :218 自注释 | ✓ |
| types.ts:554 `role?: InstanceRole` 已声明而工厂未透传 | types.ts:554 命中；registry.ts 工厂展开无 role 键 | ✓ |
| plugin.ts 校验序（形状→键集→idleTimeoutMs） | plugin.ts:149-158 命中 | ✓ |
| round-1 测试 T-3 锚 L344 `afterBump===1` | runtime-replication-session.test.ts:344 命中 | ✓ |
| registry round-1 L1287-1289 shutdown 后 apply `RUNTIME_WRITE_DISABLED` | registry-phase5-replication-session-red.test.ts:1284-1292 命中 | ✓ |
| runtime round-1 L719-736 close 后 apply 锚（含「close 已停止接纳会话 apply」文案） | runtime-replication-session.test.ts:719-736 命中（A3 用例全文） | ✓ |
| round-2 red #9 needsResync 锚 | runtime-replication-session-round2-red.test.ts:379-380 命中 | ✓ |
| round-1 设计 L522 / L642 作废断言原文 | 两行命中（shutdown 条目 / T-3 行「零新增投递」） | ✓ |

## 冲突点

**无 hard-violation / override-declared / evolution 项。** 前置门禁 #1–#12 的裁决方向在设计中的闭合情况：#1（§4 异步化 + D-1）、#2（§2/§3 fence/close + D-2a/D-2b）、#3（§5 路径 + L31 红线显式遵守 + D-3）、#4（§7 二分 + §8 置位明文 + D-4）、#5（§9 贯通 + 根因修复）、#6（R2-5 §6 顺序重写 + guaranteed cleanup）、#7–#12（§10–§13 收口）——全部机制闭合且与放行方向一致。

## 放行条件（非阻塞，SA3/文档同步必须完成）

- **C-1'（登记落盘闭环）**：§14 全部条目（ADR 0010 修订节 round-2 增补 ~30-40 行、phase-5 L81 C-1 注记改写、CONTEXT.md 词条句、两 README）目前为**待执行**状态——实施时必须实际落盘且与本设计文本一致；尤其 L241 收窄注记与 phase-5 改写缺执行即造成「设计声明 vs 仓库事实」漂移（同 round-1 C-2 性质）。§17 ALLOW LIST 已含全部文档行，SA4 静态验尸按行核对。
- **C-2'（锚演进执行面）**：三处演进面（T-1 形状锁 +needsResync / T-3 锚值 1→0 / plugin 文案）+ SA6 fixture 类型面同步（§15.3-1 `needsResync: false`）——均有登记，SA3/SA6 执行时不得越登记范围改锚（SA6 owned 红文件断言本体仍零改形）。

## 残留风险（非阻塞，移交下游）

- **R-1'（F-4 的 Yjs 次序依赖）**：精确二分依赖「beforeTransaction emit 先于事务函数 + listener 按注册序同步派发」——§18 已诚实登记为协议假设（SA6 实测 Yjs 13.6.32，风险等级低）；Yjs 升级若改变该行为，red #13/#14 锚将红（可检测）。SA7 动态验证时复核。
- **R-2'（§4.3 时序跳数推演）**：微任务公平性论证基于结构性跳数（写链 ~5-8 跳 vs 让步 20），非墙钟——§18 标记中风险，SA7 以 red #7/#8/#9 的墙钟判别裕度（250/250/400ms）动态复核；若实现环境（宿主微任务调度差异）出现裕度不足，调整的是 FANOUT_DELIVERY_DEFERRAL_MICROTASKS 常量而非结构。
- **R-3'（closedBy 码表细化闭环）**：§3.3 使修订节 L237 码表中 `REPLICATION_SESSION_CLOSED` 的「显式 close 终态」词义细化（排除 runtime-close 派生终态，该分支映射 `RUNTIME_WRITE_DISABLED`）——D-2b 登记条目已含该映射说明；SA3 落盘 ADR 增补时须确保该细化随 D-2b 文字入册（勿只写终态触发面漏写码映射），否则 L237 与实现留词义缝隙。
- **R-4'（F-3 锚值演进的注释同步）**：T-3 锚值 `1→0` 的理由注释必须随值改写（§15.2 已列「+ 注释改写」）——SA3 执行时若只改值不改注释，留下与 L262 踩坑注记脱节的孤儿断言。

## 结论

**verdict: clear，放行进入 SA2 攻击评审。**

- 总控指定六组复审重点全部通过：① D-1..D-4 逐字覆盖（D-4 以前置 #5 授权的精确子路径升级履行）；② 五处作废全部合法（两处 SA8 指定、三处有评审/ADR L262/O-9 依据，无一篡改 ADR 冻结词——ADR 侧演进全收敛到 §14 append-only 增补）；③ §4 与 L113/L151/L241 词义对账一致（队列属主分界、只标记语义、observerFailures 语义保持、status 第 11 字段登记内）；④ L31 红线未触碰且显式声明遵守；⑤ plugin role 贯通与 O-4/切片 9 一致（根因实证属实）；⑥ 版本 bump 面与简报一致。
- 设计声称的 9 项基线事实全部实证属实；公共面纪律（十二键/一键/两键/Equal 锁）零突破声明与 §13.2/§17/§19 自洽。
- C-1'/C-2' 放行条件与 R-1'..R-4' 残留风险移交总控分发（C-1' → SA3+文档同步+SA4 核对；C-2'/R-4' → SA3/SA6；R-1'/R-2' → SA7 动态验证；R-3' → ADR 增补落盘时点）。
