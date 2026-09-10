# ADR 0018：Peer schema 热重装（schema re-arm）与 re-arm fatal 语义

日期：2026-09-10
状态：已接受

## 背景与动机

Hub 替换 SCHEMA 后，更新经复制通道到达 Peer，但 Peer 已物化 Runtime 的 active
schema 不热切换（ADR 0010「SCHEMA 与 META 权限」节的既定条款）：要让 Peer 按新
schema 校验本地写，唯一途径是受控 reset/re-bootstrap 或进程重启——重新物化
Runtime 让 P0 重跑。这把每次 schema 演进都变成一次全 Peer 编排运维，且「何时可以
写新字段」缺乏确定性信号。

关键事实使热切换在现有不变量内可行：**Peer 的复制 apply 本来就占 write
sequencer 的完整槽**（sequenced apply——raw replication 绕过的只是 VFSL 预校验，
不是定序）。SCHEMA 变化随 apply 事务在同一槽内提交，槽边界天然是「无任何其他写
穿插」的安全切换点——与 Hub 的 SCHEMA 写槽「事务后同步安装新 tools」（ADR 0008）
同构。Hub 不需要重启不是因为它有额外能力，而是因为它是唯一 schema 变更经由本地
sequencer 写槽进入的节点；给 Peer 的 apply 槽补上同一个「事务后安装」段，两侧
对称。

## 决策

### 1. apply 槽提交后 schema 同步段（schema re-arm）

Peer 角色的 hub→peer 复制 apply 槽在 live 事务提交之后、`await notifyDirty()`
之前插入 schema 同步段：

1. 比对 SCHEMA 四键投影与槽开始快照（ADR 0008「槽开始快照可变输入」规则的既有
   产物）；`text` 字节不等才继续——不为每次 apply 付编译成本；
2. `compileSchemaEnvelope` 编译新 SCHEMA、构造新 tools；
3. 原子安装新 tools 并切换 active identity（与 Hub 写槽的事务后安装同一段
   逻辑）；
4. 槽继续：dirty notification、UPDATE_ACK / SYNC_APPLIED 照常。

不产生新槽类型、不引入优先级、不插队——strict FIFO 不变量零改动。ACK 语义因
此附带「active schema 已同步切换」：应用方收到 ACK 后读 `getActiveSchema()`
即得确定性确认。

检测与重装的真相来源是**本地 doc 已提交的 SCHEMA**，不依赖任何显式通知帧；断连
期间的 schema 变更由重连 reconcile 的 SYNC_STEP2 sequenced apply 经同一路径
追回，周期 reconciliation timer 兜底。

### 2. 成功语义

- 纯格式/注释差异（semantic fingerprint 相同）也照常安装并投影新 `updatedAt`
  ——与 ADR 0017「每次提交都推进 updatedAt，不据 fingerprint 跳过」对齐，
  Peer 的 ActiveSchemaInfo 与 Hub 逐字节一致；
- `updatedAt` 投影自复制来的 `META.schema`，Peer 永不读本地时钟生成它（ADR
  0010 issue #282 修订第 3 条不变）；缺席/异型 → `null`（诚实缺席）；
- re-arm 同时是 P0 编译结果失败 Runtime 的运行期修复路径：此类 Runtime 写
  不可用但复制照常（session open 无 schemaState gate 是既定有意行为），Hub
  下一次 schema 修正经复制到达后 re-arm 成功即恢复写能力，无需重启/reset。

### 3. 失败语义：re-arm fatal

新 schema 在 Peer 编译失败属确定性异常（Hub 提交前已编译成功——同版本下只剩
版本偏移、字节损坏或内部异常），不可自愈，且旧 tools 继续放行的写会把副本
推向 `replication-unvalidated`。因此失败即 fatal 类，`errors.ts` 注册表
append-only 追加双码：

- `NSRT-FATAL-SCHEMA-REARM-INVALID`：编译结果失败（带稳定 schema issue 摘要）；
- `NSRT-FATAL-SCHEMA-REARM-INTERNAL`：result union 之外的内部异常。

结算沿用 ADR 0008 fatal 语义：**该 Runtime 写永久禁用、读保留**，`getStatus()`
fatal 摘要诚实透出；tools 保持旧的不动；不自动重试（确定性失败重试无意义）。
apply 本身不回滚——失败发生在 live 提交之后，与 raw replication 零回滚不变量
一致。

re-arm fatal 后 Peer 对该 namespace **主动发 CLOSE_NAMESPACE**（诚实快速失败，
双侧资源立即释放），channel 进 `closed` 终态——重连不自动重开（既有条款：
closed/conflicted 等显式 re-add），不产生重试循环。恢复入口保持三个：idle
逐出后新 generation、`reset-replica`、进程重启。

### 4. 宿主通知与默认策略

通知不加新机制，复用两个既有 seam：

- **推送**：observer 注册表（协议 §23.1）append 两型——`schema-rearm-applied`
  与 `schema-rearm-failed`（peer 专属；字段遵守 §23.3 safe-field 清单：
  namespaceId、稳定码、fingerprint，不含 schema 文本/ROOT/堆栈）；成功事件是
  多 Peer 滚动升级「全部 Peer 已 applied」收敛判据的读取点；
- **拉取**：`lease.getStatus()` fatal 摘要与 `getActiveSchema()` fingerprint。

ADR 0008「v1 不提供公共事件订阅」边界不破：不加 lease 级 promise/事件。

standalone `@nomicore/yjs-server` 新增配置 `onFatalError: 'exit' | 'stay'`，
默认 `'exit'`：observer 适配器识别 fatal 类事件（含本 ADR 的
`schema-rearm-failed` 与既有 fatal 类）→ 先落 NDJSON 记录 → 有序停机并非零
退出。`'stay'` 供多 namespace 宿主自行编排（fatal 是 namespace 粒度，不株连
其他 namespace）。embedded Cordis host 的通知与动作完全归宿主适配器，库代码
零 `process.exit`。

### 5. P0 不对称（crashloop 防护）

re-arm fatal 经 exit 重启后，P0 编译同一 SCHEMA 仍是**结果失败而非 fatal**
（ADR 0008 既有条款：P0 结果失败仅使 ROOT write unavailable）——进程停在
「写禁用、读可用、channel 可 live、复制照常」的降级态，不形成退出-重启死循环。
不对称是有意的：Hub 能修正自己的输入（replaceSchema 编译失败是事务前零写入
普通拒绝），Peer 面对已提交的系统事实没有 SCHEMA 写权——运行中被事实抛弃
（re-arm fatal）与启动时就配不上（P0 失败）是两类处境。

### 6. 明确不动的部分

- **wire 协议零变更**：不加帧、不改 OPEN_OK、不做版本协商；
- Hub 行为不变：peer→hub 方向 protected-field 检查拒绝一切 SCHEMA 变化，
  Hub 的 apply 槽结构性不可能观测到 SCHEMA 投影变化——以 conformance 测试
  钉死；
- Peer 无 SCHEMA 写权不变（`REPLICATION_ROLE_PERMISSION` 语义不动）；
- 不留「关闭自动 re-arm、回退 reset 模式」的开关——本 ADR 是缺陷修复性质的
  语义升级，旧行为无正当用途；
- re-arm 不主动校验 ROOT：沿用「open/read 不重新校验、写在槽内校验完整
  proposed ROOT」哲学，ROOT 不合规时第一笔写诚实失败；
- raw replication 绕过 VFSL 预校验不变。

### 7. 对既有条款的取代与修订

- **ADR 0010**「Peer 收到增量 SCHEMA 后……必须通过受控 reset/re-bootstrap 或
  进程重启重新物化 Runtime」条款**废止**，由本 ADR 第 1/3 节取代；reset 降级
  为运维兜底路径（epoch 冲突、副本修复等既定用途不变）；
- **ADR 0008** 定序契约扩展：replication apply 槽增加「提交后 schema 同步
  段」（第 1 节）；fatal 注册表追加双码（第 3 节）；
- **协议 §23.1** observer 注册表 append 两型（第 4 节）；
- `docs/integration/hub-peer-deployment.md` 的 `replace-schema` 行同步修订。

## Considered Options

- **显式通知帧（SCHEMA_CHANGED）+ OPEN_OK 携带 schema 身份**：被否决。带内
  检测对 live UPDATE、reconcile、bootstrap 后补 diff 一切路径生效，显式帧只
  增加 wire 契约面与版本协商负担，不增加完备性。
- **re-arm 插队到 sequencer 队首**：被否决。破坏 strict FIFO 不变量，且插队
  规则对 close barrier/epoch fence/reset-fence 的例外清单无法定义干净；槽内
  同步段达到更强的「零窗口」且不动定序契约。
- **编译失败仅降级（rootWrite unavailable）不 fatal**：被否决。确定性失败不
  自愈，旧 tools 放行的写会污染收敛态；fail-fast + 宿主默认终止让运维信号
  最锋利。
- **re-arm 槽内主动校验完整 ROOT**：被否决。破坏「非写场景不校验 ROOT」的
  引擎哲学一致性；Hub 两个分支都保证收敛态 ROOT 合法，Peer 的瞬时窗口由
  FIFO 定序自然收窄。

## Consequences

- schema 升级 runbook 简化：Peer 滚动 reset/重启不再是必要步骤，「先兼容代码
  → Hub 替换 → Peer 自动 re-arm → 开新写路径」；不兼容变更的
  expand-contract 纪律不变（窗口归零不等于窗口语义消失——re-arm 前排队的写
  仍按旧 tools 校验，属 FIFO 既定语义）；
- 测试矩阵：re-arm 前后写各按新旧 tools 的定序断言、degraded 期 re-arm、
  双码 fatal 结算、CLOSE_NAMESPACE 主动关闭、重复/格式差异触发幂等、
  close/reset 交错、updatedAt 投影、P0 失败 Runtime 自愈、Hub 不触发
  conformance；
- observer 词汇 22 → 24 型；`namespace-failed{cause: session-open-failed}`
  在 fatal 重连路径仍会出现，告警路由应以 `schema-rearm-failed` 为 schema
  类根因判据。
