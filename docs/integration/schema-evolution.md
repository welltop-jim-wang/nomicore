# Schema 演进升级 runbook（Hub/Peer 拓扑）

本文是 nomicore 使用方在「1 Hub + N Peer」拓扑下升级 namespace schema 的操作入口，
按 [ADR 0018](../adr/0018-peer-schema-rearm.md) 定稿语义编排：Peer 的复制 apply 槽
在提交 SCHEMA 变化后同步执行 **schema re-arm**（编译新 SCHEMA、原子安装 active
schema tools），schema 升级不再需要逐台 reset/重启编排。

权威依据（本文不复制其规则，只编排流程）：

- 机制与 fatal 语义：[ADR 0018](../adr/0018-peer-schema-rearm.md)；
  被废止条款的显式修订：[ADR 0010](../adr/0010-hub-peer-websocket-ydoc-replication.md)
  「ADR 0018 修订」节；
- `updatedAt` 与指纹语义：[ADR 0017](../adr/0017-schema-lifecycle-metadata-and-vfsl-fingerprint.md)；
- observer 事件字段与 safe-field 清单：[复制协议 §23.1/§23.3](../protocols/instance-replication-v1.md)；
- `replace-schema` 动词契约、`root` 决策与 `onFatalError` 配置：
  [hub-peer-deployment.md](hub-peer-deployment.md)；
- 本地 `.vfsl` 指纹对比与宿主验证流程：
  [external-project-vfsl-codegen.md](external-project-vfsl-codegen.md)。

## 1. 升级主流程

定稿顺序：**先兼容代码 → Hub 替换 → Peer 自动 re-arm → 收敛确认 → 开新写路径**。

1. **先兼容代码**：编辑宿主唯一的 `domains/<domain>/schema.vfsl`，用 `schema:check`
   校验新 schema 与代表性完整 ROOT；重新生成 TypeScript 投影并跑 projection-aware
   typecheck（流程见 external-project-vfsl-codegen.md「宿主项目的验证流程」）；先部署
   能同时容忍新旧形状的读写代码。生成物与运行时 SCHEMA 必须出自同一次编辑。
2. **Hub 替换**：在 Hub 上以 lease 调 `replaceSchema({ schema, root? })`。keep-root
   与 replace-root 的决策（含「新增必填字段必须同时提供合规完整 `root`」）以
   hub-peer-deployment.md 的 `replace-schema` 行为权威。`ok` 仅表示 Hub 本地写槽
   完成——**不承诺**传播已发生或任何 Peer 已激活。
3. **Peer 自动 re-arm**：SCHEMA 增量经复制通道到达后，每台 Peer 的 apply 槽在提交后
   同步编译并原子安装新 tools（槽开始快照直比，`text` 字节不等才编译），随后才
   dirty/ACK。升级期间断连的 Peer 由重连 reconcile 的 SYNC_STEP2 apply 经同一路径
   追回，无需补偿操作。**Peer 滚动 reset/重启不再是必要步骤**，降级为兜底（§5）。
4. **收敛确认**：按 §2 判据逐台确认目标 Peer 已激活新 schema。
5. **开新写路径**：全部目标 Peer 收敛之后，才发布依赖新字段的写能力。

## 2. 收敛判据（规范性）

「该 Peer 可以开始写新字段」的确定性信号只有两个读取点：

- **推送**：observer 事件 `schema-rearm-applied`（peer 专属；字段 =
  `semanticFingerprint` + 复制来的 `updatedAt`，守 §23.3 safe-field 清单）。每次
  re-arm 成功安装**恰一**事件——含纯格式差异（semantic fingerprint 相同）的安装，
  与 ADR 0017「每次提交都推进 `updatedAt`」对齐。它是多 Peer 滚动升级「全部 Peer
  已 applied」收敛判据的读取点。
- **拉取**：`lease.getActiveSchema()` 的 `semanticFingerprint` 与 Hub 侧逐字节
  一致（Peer 投影与 Hub 无分叉）；`updatedAt` 与 Hub 起源的 `META.schema` 值一致
  （Peer 永不读本地时钟生成；legacy 对端缺席时为 `null`，诚实缺席）。

以下都**不是**收敛判据：Hub `replaceSchema()` 的 `ok`（仅本地写槽）；Peer 收到
UPDATE 帧本身（apply 槽结算前 active schema 未切换）；`updatedAt` 单独比对（纯格式
差异也推进它，语义同一性要看 `semanticFingerprint`）。

## 3. 不兼容变更的 expand-contract 纪律（原文保留）

ADR 0018 Consequences 原文：

> schema 升级 runbook 简化：Peer 滚动 reset/重启不再是必要步骤，「先兼容代码
> → Hub 替换 → Peer 自动 re-arm → 开新写路径」；不兼容变更的
> expand-contract 纪律不变（窗口归零不等于窗口语义消失——re-arm 前排队的写
> 仍按旧 tools 校验，属 FIFO 既定语义）；

re-arm 把 Peer 侧激活窗口降为零，但**不**免除不兼容变更的两步走纪律：

- **Expand**：先做兼容方向的演进（新增可选字段 `?:`、放宽约束），新旧写代码共存；
  旧形状写在 re-arm 前排队仍按旧 tools 校验、re-arm 后仍被新 schema 接受。
- **Contract**：确认全部写方已迁移、无旧形状写在飞之后，才做移除/改名/收窄——
  按 `replace-schema` 行的决策同时提供满足新 SCHEMA 的完整 `root`（`root` 不是
  patch/merge/迁移回调）。
- strict FIFO 不变量下，schema 替换与业务写共用同一条定序：「re-arm 前排队的写仍
  按旧 tools 校验」是既定语义，不能当作绕过纪律、提前发布新写路径的窗口。

## 4. re-arm fatal 运维处置手册

触发语义：Hub 已编译通过的 schema 在 Peer 编译失败属确定性异常（同版本假设下只剩
版本偏移、字节损坏或内部异常），不可自愈，结算为 **fatal 类**：该 Runtime 写永久
禁用、读保留、`getStatus()` fatal 摘要诚实透出；Peer 对该 namespace 主动发
CLOSE_NAMESPACE（channel 进 `closed` 终态，重连不自动重开）；恰一
`schema-rearm-failed` 事件。standalone 默认 `onFatalError: 'exit'`——先落 NDJSON
再有序停机、非零退出。

### 4.1 告警路由

- schema 类根因的**唯一**推送判据 = `schema-rearm-failed`。
- `namespace-failed{cause: session-open-failed}` 在 fatal 后的重开路径（显式
  re-add 或新连接的每连接恰一次重试）仍可出现，其语义不含「schema 编译失败」，
  **不要**用它路由 schema 类根因（协议 §23.1 第 24 型条目、ADR 0018
  Consequences）。
- 按稳定双码分流（ADR 0018 §3；不解析摘要自由文本）：
  - `NSRT-FATAL-SCHEMA-REARM-INVALID`：编译结果失败（事件/getStatus 带稳定
    schema issue 摘要）→ 向「版本偏移 / schema 字节损坏」方向排查；
  - `NSRT-FATAL-SCHEMA-REARM-INTERNAL`：result union 之外的内部异常 → 按实现
    bug 升级给库维护者。

### 4.2 排查步骤

1. **版本一致性**：本 phase 假设全集群同 nomicore 版本。同版本下 Hub 编译成功而
   Peer 编译失败不应发生——先核对 Hub 与各 Peer 的部署版本，版本偏移是首嫌。
2. 取事件的稳定码；`INVALID` 时结合该 Peer `getStatus()` fatal 摘要中的 schema
   issue 摘要定位编译失败点。
3. 排除字节损坏：比对 Hub 侧 `getActiveSchema()` 的 `envelopeFingerprint` 与该
   Peer 实际收到的 SCHEMA 信封。

### 4.3 修复与恢复

修复路径 = **修正版本/schema 后 `reset-replica` 或重启**（hub-peer-deployment.md
`replace-schema` 行定稿措辞）：

1. 先在 Hub 侧修正根因（对齐版本，或由 Hub 再发一次经评审的 `replaceSchema()`）；
2. 对 fatal Peer 执行 `reset-replica` 或进程重启（standalone 默认 exit 时由编排层
   按既定策略重启）；
3. 重启后若 schema 仍不可编译，进程停在「P0 结果失败、写禁用、读可用、channel 可
   live、复制照常」的**降级态**——P0 结果失败不升格 fatal（ADR 0018 §5 P0 不对
   称），结构性无退出-重启死循环；Hub 下一次 schema 修正到达后 re-arm 成功即自动
   恢复写能力，无需再次重启；
4. 若版本/schema 已对齐，P0 直接编译成功，Peer 正常回到 `live`。

注意：已 fatal 置位的 Runtime 对同一文本不自动重试；显式 `add-target` re-add 会被
Runtime fatal 门拒绝（`failed` 安静终局）——恢复必须经 reset/重启/idle 逐出后的
新 generation 让 Runtime 重新物化。

### 4.4 `onFatalError` 策略选择

- 默认 `'exit'`：适合单 namespace standalone 部署，编排层（systemd/k8s）按既定
  策略重启并暴露问题；P0 不对称保证重启后不 crashloop。
- `'stay'`：供多 namespace 宿主自行编排——fatal 是 namespace 粒度，不株连同进程
  其他 namespace。
- embedded Cordis host：通知与动作完全归宿主适配器，库代码零 `process.exit`。

## 5. 兜底路径（reset/重启降级后仍有效）

ADR 0010「peer 必须受控 reset/re-bootstrap 或进程重启重新物化 Runtime」条款已
废止，reset 降级为运维兜底：schema 升级不再依赖它，但 epoch 冲突、副本修复、
re-arm fatal 修复等既定用途不变，`reset-replica` 动词契约以
hub-peer-deployment.md 对应行为权威。

## 6. 回滚

回滚 = 另一次经评审的 Hub `replaceSchema()`（按需带完整旧形状 `root`），走本文
同一主流程与收敛判据。禁止快照覆盖、禁止直接编辑 live `Y.Doc`/SCHEMA 映射——保留
上一版 schema/root 证据与显式回滚方案是每次升级的产出物。
