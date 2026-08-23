# 冲突门禁报告（修订轮 rev1）

- **被审对象**：`wiki/raw/task_read-logical-value-at-path_rev1.md`（PR #83 owner Review「Request changes」修订简报；P1 正确性缺陷：Phase B union 仲裁遮蔽）
- **冲突基准**：`docs/adr/` 全集（0001–0007，共 7 份，逐份全文读取，无抽样）+ `CONTEXT.md`。基准自首轮门禁（2026-08-22 15:35）后零变更（7 份 ADR + CONTEXT.md 同批 15:28 落盘，git 历史无后续提交）。
- **门禁人**：SA8（Conflict Gatekeeper）
- **日期**：2026-08-22（worktree `/home/wangjian/nomicore-fix-issue-75`，branch `fix/issue-75-on-docs-doc-runtime-validation`，run_id `issue-75-rev-1787397220`）

## Verdict

`clear`

修订简报与 ADR 全集 + CONTEXT.md 无冲突。总控可放行修订轮工作流（SA5 → SA6 → SA1 → SA8 设计复审 → SA2 → SA3 → …）。

## ADR 盘点（7 份逐份对照）

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（2026-08-19 修订节） | 间接 | 无冲突。修订不触 schema 文本、脚手架纪律、SchemaSource 接缝与方言冻结；缺陷域与修域均在 `@nomicore/doc-runtime` 运行时导航。附注：ADR-0001 下 schema 是 doc 数据、`readLogicalValueAtPath` 接受任意合法 `derived`，重叠联合合法（ADR-0003「重叠成员不构成错误」）——这正是 owner 要求仲裁策略在任何合法 schema 上正确的原因，修订方向与该前提同向 |
| ADR-0002 | nomicore 是全新重写，authority 出范围 | accepted | 无关 | 无冲突。纯读取路径内部仲裁修订，不涉 authority、不触「结构 → 值 → 单事务提交」写入管线 |
| ADR-0003 | 求值器与派生 schema | accepted（取代同号草稿，无对外 supersede） | **直接** | 无冲突，且**同向加强**：owner「首个真实 value 胜出；前序仅 missing 继续后续成员」是 §3「路径存在性为**任一成员出现即存在**」在读取维度的逐字兑付——现行「首个 `r.ok` 即胜」策略若在 missing 情形短路，恰是对该条款的潜在违反，修订是收紧而非推翻。「any-of（至少一个成员接受即接受——重叠成员不构成错误）」与 value-first 仲裁相容（value 重叠平局仍按声明序取首者，见注记 2）；「no-match 诊断：报失败距离最小的成员（平局按声明序）」属校验相位移交条款，不约束读取仲裁；「缓存的缺失/存在不得改变任何可观测行为」不触（读取零判别式消费，INV-4 保持）；修订不要求改派生 schema 形状（含 union 节点表示） |
| ADR-0004 | vfsl-protocol 类型协议包 | accepted | 间接 | 无冲突。D3 协议包「零运行时代码」，不构成运行时约束；沿首轮注记 C（编译期字符串下标与运行时 number 下标两层并存）；修订不触类型投影 |
| ADR-0005 | 投影生成管线 | accepted | 无关 | 无冲突。codegen 管线与运行时读取无交集 |
| ADR-0006 | Cordis 持久化插件与 doc 三条目布局 | accepted（含 createDoc/owner 修订节） | 间接 | 无冲突。修订读取面仍止于 ROOT 子树（「校验只作用 ROOT 子树」同款边界）；不触持久层 |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted | **直接** | 无冲突。被修缺陷位于本 ADR 定义的 `readLogicalValueAtPath` 实现内部；owner 五条修订建议逐条对照见下表，全部落在条款自然语义内或其下实现粒度，公共条款零改动 |

无任何 ADR 处于 superseded 状态（ADR-0003 取代的是同号未定稿草稿；ADR-0006 修订节取代的是本 ADR 内部早期条款——均已按现行有效文本对照，同首轮结论）。

## 修订要求逐条对照（ADR-0007 / ADR-0003 为依据）

| # | 被审对象要求（rev1 简报） | ADR 条款（原文） | 裁决 |
|---|---|---|---|
| 1 | AC-R1：Phase B 导航结果区分 value / missing / reject 三态（或等价机制） | 「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型」（0007）——三态为 read.ts **包内**导航内部类型（现 `NavOutcome` 两态已存在，read.ts:261），公共结果联合与签名不变（首轮冻结契约） | no-conflict |
| 2 | AC-R2a：首个真实 value 胜出；前序成员只得到 missing 时继续尝试后续成员 | 「路径存在性为**任一成员出现即存在**」（0003 §3）——任一成员出现即存在 ⟹ 不得因前序成员合法缺席而把实际在场的路径判为缺失；value-first 仲裁是该条款的直接兑付 | no-conflict |
| 3 | AC-R2b：所有可行成员均只能得到 missing → `ok:true, value:undefined` | 「合法 optional/Record/数组缺失返回 `undefined`」（0007 readLogicalValueAtPath 条款）的 union 提升形态；AC3 缺键形态（value 键显式存在）保持 | no-conflict |
| 4 | AC-R2c：全部成员 reject → `PATH_NOT_ALLOWED` | 「Yjs 结构与路径/操作错误 fail-fast」（0007）+ 首轮注记 B（PATH_NOT_ALLOWED 为 doc-runtime 领域化错误码，不并入 issues 体系） | no-conflict |
| 5 | AC-R3：明确 required-missing / 载体错位 / 合法缺席优先级，并与现有 extract/union 声明序规则一致（设计文档成文） | ADR 层无「首个 ok 即胜」读取仲裁条款——INV-7（read 导航「首个可产出者胜」）与 INV-8（extract「首个接受者胜」）均为**任务族设计内规**，非 ADR；两层仲裁各自语义闭合（见注记 2），调和成文属 SA1 设计义务 | no-conflict |
| 6 | AC-R4：五类回归测试 + 交换声明序结果不变 | ADR 无涉（测试义务）；部分场景可构造性待落定（见注记 1） | no-conflict |
| 7 | AC-R5：不回归既有测试（含 SUP-1 XML 情形） | SUP-1 经**路径耗尽处** `walkUnion`（extract 同款「首个接受者胜」仲裁）产出，不经中段 union 导航循环——修订只动中段导航仲裁，该分支不受影响；成员 0 以真实 value（XML 串）胜出的机制在 value-first 仲裁下不变 | no-conflict |
| 8 | 「同时需结合现有 extract/union 声明序规则」（修订建议末段） | 同 #5：extract 规则（extract.ts `walkUnion` / 设计 §4.5.2）为任务族内规，要求一致属任务内部纪律，无 ADR 条款被违反或修订 | no-conflict |

## 冲突点

无。

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | （空表：0 冲突点） |

裁决分布：no-conflict ×8（逐条对照）＋7（ADR 盘点）；override-declared ×0；evolution ×0；hard-violation ×0。

修订不改写任何 ADR 决策条款：ADR-0007 `readLogicalValueAtPath` 公共条款原样保持，仲裁细则属其下实现粒度；「首个可产出者胜」（INV-7）为首轮设计内规，其精确化在设计文档内完成即可（AC-R3 已明确要求成文），**不构成 ADR 演进**，无 Jim 裁决项。

## 非冲突注记（不阻塞；指定验证责任）

- **注记 1（缺陷可达性事实——SA2/SA5 验证域，不影响本裁决）**：owner 原文最小反例经隔离实证**不复现**。实证（tsx 直跑 worktree 源码，脚本置于 /tmp、事后删除、worktree 零改动）：fixture `U = Record<string, YLeaf<string>> | { foo: YLeaf<string> }`、live `x = Y.Map({ foo: "v" })`、读 `['x','foo']` → 现行实现返回 `{ok:true, value:"v"}`（Record 成员 `get('foo')='v'` 非空，下钻 leaf 产出真值，并未「解释为缺失键」）；真缺席（`Y.Map({})`）→ `{ok:true, value:undefined}` 正确。结构性论证：缺席三源（Record `get` undefined / optional 缺席 / 非负整数越界）读取的都是——live 容器链由数据+路径段唯一决定，与成员形状无关；某成员在某段合法缺席 ⟹ 任何存活到该段的成员读到同一 `undefined`，后者至多同样缺席或拒绝，**不可能产出值**。「前序合法缺席遮蔽后序实际在场」在现行结构系统内疑似不可达——owner 自己也仅对数组场景附带保留（「若结构系统允许」）。⇒ 本修订实质是**防御性语义硬化**（在策略层封死「missing 短路」类病态，无论当前可达与否），与 ADR 同向，放行无碍；但 **AC-R4 前两类测试（Record 缺键 vs 后序在场、optional 缺席 vs 后序在场）的可构造性必须由 SA6/SA1 落定**：若不可构造，按 owner 保留措辞降级为论证性覆盖并在设计文档成文，不得虚构 fixture、不得为凑测试放宽结构系统。SA5 缺陷核实时应优先复核该反例。
- **注记 2（两层仲裁并存与 swap 不变式边界）**：extract `walkUnion`「首个接受者胜（声明序）」= 整子树投影**提交层**仲裁（SUP-1 ground truth 锁）；owner「value > missing」= **路径导航层**仲裁——两层各自闭合，AC6-19/SUP-1 交叉实证防漂移，设计文档须按 AC-R3 成文（含 INV-7「首个可产出者胜」精确化为「可产出 = 产出真实 value；missing 不构成胜出」）。另注意：AC-R4「交换声明序结果不变」仅对 **missing-vs-value 竞争类** fixture 成立；value-vs-value 重叠成员（ADR-0003「重叠成员不构成错误」明文合法，如 `YMap<{k: YLeaf}>` vs `Record<string, YLeaf>` 对同一 live 产出不同快照）以声明序为确定性平局裁决，**交换顺序本就可能改变返回值**——SA6 构造 swap 测试时必须限定范围，否则测试本身会与 ADR-0003 的重叠合法性相抵。mixed missing+reject（一成员合法缺席、另一成员拒绝）的优先级是 AC-R3 须显式落定的开放点（owner 规则 3 的「可行成员」语义）。
- **注记 3（公共接缝不动）**：三态化限于包内 `NavOutcome`；公共结果联合保持首轮冻结契约两态形态（`{ ok:true; value: unknown } | { ok:false; code:'PATH_NOT_ALLOWED'; path; message? }`）与同步不抛错签名；missing/reject **不得**并入公共 issues 体系（ADR-0007「不合并成巨型 issue 类型」）。
- **注记 4（memo 健全性再论证）**：D13 memo 现缓存两态结局；三态化后键值域扩展，「继续尝试后续成员」可能增加成员试探次数——SA1 须重述 §4.3 健全性论证与多项式成本上界（SUP-2 护栏锚点），确保仍符合「普通读取成本与目标 path 子树规模相关」（ADR-0007）。
- **注记 5（DENY 保持）**：修订不触 `packages/vfsl` 任何源码与派生 schema 形状（首轮 DENY）；`compilePattern`/`matchPattern` 公共接缝消费方式不变。

## 结论

**Verdict = clear，放行。** owner 修订建议（三态导航 + value-first union 仲裁 + 优先级成文 + 回归测试）与 ADR 全集 + CONTEXT.md 零冲突，且在 union 读取语义上与 ADR-0003「任一成员出现即存在」、ADR-0007「合法缺失返回 undefined」逐条同向——是收紧对齐而非推翻。无需 override，无 Jim 裁决项。注记 1 的可达性事实建议随派发转交 SA5/SA2/SA6 重点核实（AC-R4 测试可构造性 + swap 测试范围限定）。
