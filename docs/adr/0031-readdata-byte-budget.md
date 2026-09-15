# ADR 0031：readData 字节预算——交付总量收/拒闸

日期：2026-09-15（设计敲定：DSH grill 会话；追踪 issue 见本文末「验收」节所挂）
状态：已接受（影响包 `@nomicore/namespace-runtime`、`@nomicore/namespace-registry`；`@nomicore/doc-runtime` 与 `@nomicore/vfsl` 零改动）

## 背景

ADR 0024 把字节级预算登记为开放问题并委托给调用方（「序列化期才精确可知，运行时递归中只能估算——当前归调用方字节闸（L2 工具层）」）；ADR 0027 随后让投影文本的 ✂ 段成为截断事实的**唯一载体**。委托在先、唯一载体在后，被委托出去的字节截断便滞留在权威契约外：L2 会话级读工具自创了 `capJson`/`preview`/`valueBytes` 词汇，其 schema 侧封顶还会把投影文本砍成前缀——文末的 ✂ 段连同值通道截断事实一起灭失。需求源头是 agent 消费方必须控制读返回占用的模型上下文：两套截断词汇并存，且一套会在尾部场景摧毁另一套。

本 ADR 把字节预算收进引擎，但**不裁剪**：`maxBytes` 是交付总量的收/拒闸——超限零交付响亮拒绝。设计经 grill 会话逐点收敛（裁剪方案及其全部裁剪语义——frontier 形状、剪裁序稳定性、where 对撞——均被评估后否决，见「备选」）。

## 决策

### 1. 三读面 options 增加 `maxBytes`

- `readData` / `readArray` / `readMap` 的 options 闭合形状追加 `maxBytes?: number`：≥1 的有限整数（≤ 2^53−1）；`0`、负数、非整数、非有限数、未知键 → 各面**既有** options 校验码响亮拒绝（readData 面 `READ_OPTIONS_INVALID`，窗口面 `WINDOW_OPTIONS_INVALID`），不新增校验码。
- 缺席 ≡ 不设预算（现行为逐字节不变）；不内建任何魔法默认（无「自动保守 depth」类暗行为）。

### 2. 总量语义与规范度量（钉死）

- 预算治理**交付总量** = 值通道 + schema 通道之和：
  - 值通道 = `utf8(JSON.stringify(value))`（紧凑 JSON、键序 = 交付序；`value === undefined` 计 0）；
  - schema 通道 = 投影文本的 UTF-8 字节——**头行与 ✂ 段在文本内，自然计入、不豁免**；`schema: null` 计 0。
- 窗口面同构：总量 = 条目列表（含 key/index 包装）的紧凑 JSON + 元素口径投影文本。
- 度量精确性：**整体序列化即度量**——`measuredBytes` 与两个通道的字节数由构造一致（组合式记账零镜像代码），等式可 property test；账本不进公共面（成功面恒四键不变，不新增 bytes 键）。

### 3. 超限零交付响亮拒绝

- 总量 > `maxBytes` → 同步结果联合新失败分支：

```ts
{ ok: false; code: 'READ_BUDGET_EXCEEDED'; path: …; measuredBytes: number; message: string }
```

- `measuredBytes` 只报合计，不拆分值/口径两分项（消费方下一步旋钮自选，拆分登记为可加法演进）。
- **三面同码同文同载荷形**（readData / readArray / readMap）；面区分靠调用现场，不靠 message。
- 不裁剪、不降深度、不拟合：预算是**收/拒判定**，不塑形交付——成功交付物与无预算读逐字节相同。
- 恰好等于 `maxBytes` → 成功（≤ 判定）。

### 4. 分层落点

- 校验与度量住 `@nomicore/namespace-runtime` 组合层——唯一同时见到两通道的层；`@nomicore/doc-runtime` **零改动**（下传 options 仍为 `depth`/`maxChildrenPerNode` 两键）；registry lease 结果类型与 options 类型别名跟随透传（既有别名锁断言延伸）。
- 恒四键成功面、✂ 文法、投影文本渲染器、头行文法（**不记 maxBytes**——头行是塑形实参锚，收/拒参数不塑形成功交付）、`DeepOptional` 类型面、无 options 逐字节行为：全部零变化。

### 5. 边界

- **缺席目标的读同样可能超限报错**：`value === undefined` 时投影文本照常在场（语义 schema 投影是路径键控、与值无关），照常计量。
- **终态目标不是预算 no-op**（对 ADR 0024 决策 1 的例外注记）：巨型标量 / 语义字符串可致超限报错——depth/width 对终态 no-op 的条款不随本轴延伸。
- **where 过滤窗口无语义对撞**：没有静默丢弃，装满判定（`kept === n` → 可能还有）永不说谎；超限走同一报错分支，与 ADR 0029 的「✂ 永不装配」不冲突（本 ADR 不装配任何 ✂ 条目）。

### 6. 使用指引（主力是结构预算）

- 控制交付**形状与物化工作量**用 `depth` / `maxChildrenPerNode` / 窗口读；`maxBytes` 只治理**交付总量**，不治理物化工作量——无结构预算的宽路径读可能全量物化后被拒（成本与消费侧事后封顶的现行为同阶，不劣化）。指引进 typed-access 纪律与作用域文档。

## 对既有 ADR 的修订

- **ADR 0024**：决策 1 的 options 形状修订（+`maxBytes`，闭合形状三键）；决策 1「终态目标的预算是 no-op」增补例外注记（maxBytes 对终态目标可拒）；开放问题「字节级预算」收口——本 ADR 兑现，且语义从「递归中只能估算」演进为「整体序列化即度量、收/拒不裁剪」。
- **ADR 0027**：决策 1「`options` 闭合形状零变化」句修订为三键（`depth` / `maxChildrenPerNode` / `maxBytes`——预算轴不是呈现轴，「预算单一权威与三层透传」强化为三轴）；头行、✂ 段、渲染器零选项纯函数条款**不动**。
- **CONTEXT.md**：新增「字节预算（byte budget）」词条；「形状预算」词条 `_Avoid_` 改写（撤「字节预算……归调用方」句）。

## 备选（已否决）

- **递归内折叠裁剪**（试装跳过 / 前缀截停 / 子树原子）：省物化，但交付残缺值、裁剪语义全套新账（frontier 形状、剪裁序稳定性、where × 裁剪对撞、✂ bytes 条目文法）——且裁剪交付仍吃满预算量 context。登记为演进位而非 v1 形态。
- **值通道 only**：schema 通道无人治理，消费侧闸被迫存活，其砍前缀动作灭失 ✂ 段。
- **组合层深度拟合**（超限自动降口径深度直到装下）：复杂度复装；调用方本就握有 depth 旋钮。
- **消费侧过渡手术**（裁头保 ✂ 拼接）：再造一层自创词汇，与归一初衷相悖。
- **UTF-16 code unit 计量 / 裸内容字节（不含 JSON 转义）**：前者与下游闸门的字节语义不对齐（CJK 差 1.5–3 倍）；后者对含引号/控制字符/lone surrogate 的字符串方向性低估，破坏 ≤ 保证。
- **事后字节切前缀**（plugin 现状）：切点破坏 JSON 结构；省 token 不省物化（ADR 0024 已否决的同款）。
- **错误载荷拆分值/口径两分项**：现留合计；拆分是纯加法演进，待实测诉求。

## 验收

- **主接缝（runtime 三读面）**：超限失败分支形状与三面同码同文；`≤` 边界成功；options 校验负控（`0`/负/非整数/非有限/未知键——readData 面与窗口面各走其码）；缺席目标 × 超限报错边缘；`schema: null` × `maxBytes`（仅值侧计量）；无 options 逐字节回归锚。
- **度量等式 property**：`measuredBytes === utf8(JSON.stringify(value)) + utf8(schema)`（含 ✂/头行自然计入的构造性断言；`schema: null` 计 0 分支）。
- **lease 透传断言**：registry 既有别名锁测试延伸（options 形状 + 新失败分支）。
- **文档负控**：作用域文档词汇重录——`maxBytes` 语义在场、「归调用方字节闸」措辞清退（readdata-docs 契约夹具族锚定）。
- 全套门禁 + root `pnpm typecheck` / `pnpm test`；发布随 minor bump（0.x 破坏性 minor，消费方可枚举）。

## 开放问题

- **可选裁剪模式**（`over: 'trim'` 类选项或独立面）：触发条件 = 出现真实的「部分视图」消费者（一次性拿到能装下的前缀而非报错重试）；届时须过设计评审——裁剪规则（frontier 形状、剪裁序、where 对撞、✂ bytes 条目文法）全套语义届时再定，不因本 ADR 预先承诺。
