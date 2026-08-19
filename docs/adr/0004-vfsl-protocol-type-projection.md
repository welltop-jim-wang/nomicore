# ADR 0004：vfsl-protocol 类型协议包——编译期路径投影的五个设计决策

日期：2026-08-19
状态：已接受（grill 定稿，Phase 1 前置；设计文档 §8 + §15 Phase 1）

## 背景

运行时校验管「进来的数据」（Phase 0b 轨道），编译期投影管「自己写的代码」。本 ADR 冻结 vfsl-protocol 包的五个相互锁定的设计决策（D1–D5）。ADR 0001 修订节使 §8 投影回到范围内（阶段态脚手架 + SchemaSource 纪律）；本包是「已知 schema 的编译期镜像」，与引擎包「运行时任意方言」生命周期分离。

## 决策

### D1. 数组语义：patch 支持下标段，序列编辑走专用 API

- `patch` 路径支持下标（`patch(['items','3','A','B','C'], v)`）：值类型经 `Record<\`${number}\`, 元素子树>` 精确投影；执行映射为 Yjs 粒度 set（保元素身份与协作光标）；越界归运行时校验；
- 序列编辑（insert / append / delete）不是「按址赋值」，patch 路径表达不了，由专用 API 承载：`appendToArray` / `insertIntoArray` / `deleteFromArray`（下标为显式参数）；
- `YPlainArray` 只能整体替换（普通 JSON 值，非 Y.Array——标记语义边界）。

### D2. 联合投影宽度

- 键空间 = 各成员字段键集之并集（封闭，v1 规格已冻结），投影照此；
- 成员独有字段：read → `T | undefined`（诚实反映「当前成员可能没带这个键」）；patch 值 → `T`（声明处类型）；当前成员是否允许该写入归运行时重建校验——类型层查键空间与值类型，运行时查成员适配；
- 路径级窄化不做（元组路径是静态的，无法携带判别值的运行时事实）；整值读取发射判别联合（有判别式时），消费方在 JS 里吃 tsc 原生窄化。

### D3. 包形态：纯类型 + 接口，零运行时

- 全部内容为类型空间产物（幻影 `unique symbol` 口袋、`PathSchema`/`PathAt`/`PathValue`/`PathKind`/`UnknownPath`、`VfslPathMap` 空表、`VfslTypedAccess` 接口签名）——编译后为空模块，零依赖、零运行时代码；
- 空 `VfslPathMap` 默认 **fail-closed**：未引入领域包增广时一切路径解析为 `UnknownPath`，任何 patch 即编译错误；
- 不含生成器（票 F 职责）、不含工厂/默认值、不进引擎包。

### D4. 类型测试装置

vitest typecheck 模式；正例用 `expectTypeOf`（类型相等断言），负例用 `@ts-expect-error`（自我反转断言：该行被错误放行时测试反而失败）；设计文档 §8.4 的正负例矩阵原样复刻为编译断言。

### D5. 路径不含 ROOT 前缀

`VfslPathMap` 顶层键 = ROOT 的字段（`['assets', id, 'name']`，不是 `['ROOT', 'assets', …]`）；ROOT 是 doc 级固定挂载点，挂载知识只出现在绑定实现的 `doc.getMap('ROOT')` 一处。`PathAt` 需含 `[]` 分支（空路径解析为根节点自身，`kindOf([])` → `'map'`）。

## 被否方案

- **D1 原案**（数组路径终态 + `updateArrayElement` 平行 API）：带下标的 patch 与专用元素更新 API 只有写法差异、无语义差异；且整元素替换（delete+insert）销毁 Yjs 元素身份，patch 下标粒度 set 反而保身份；
- **D2 路径级窄化**：类型系统硬边界（静态元组无法携带运行时判别值），不做伪窄化；
- **D3 含工厂函数/默认实现**：防止协议包长出实现野心——实现归 Phase 2 的 server 与编辑器各自完成。

## 后果

- 类型树形状 = 生成契约：票 F 生成器的输出规格即本 ADR + 设计文档 §8.3 映射表（Record 通配层 / 标记→kind / Pattern→string / YXmlFragment→string / ref→别名引用 / docs→TSDoc 注释）；
- 协议包独立演进节奏：类型规则变更 → 消费方重编译即见，无运行时兼容负担；
- 领域包增广文件受 CI 新鲜度校验（生成物与 SchemaSource 源漂移即失败）。

## 关联

- ADR 0001 修订节（目标态/阶段态二分、SchemaSource 纪律）、ADR 0003（联合表示 / ROOT 约定 / 按名引用——投影映射的依据）
- 设计文档 §8（机制原型，含 tsc 实测矩阵）、§15 Phase 1
