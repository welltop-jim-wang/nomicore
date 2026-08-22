# 冲突门禁报告（设计后复审）

- 被审对象：`wiki/raw/task_file-persistence-plugin_design.md`（SA1 架构设计 R0 首版，637 行）
- 冲突基准：`wiki/raw/task_file-persistence-plugin_relevant_decisions.md` + `docs/adr/` 全集（6 份）+ `CONTEXT.md`
- 复审性质：设计与 ADR 决策一致性（轻量复审；ADR 全量盘点已在前置门禁完成，本报告不重复，仅引用其结论）。设计优劣与全维度攻击属 SA2，实现质量属 SA4/SA7，不在本报告范围。
- 审查方：SA8 设计后复审

## Verdict

`clear`

## ADR 盘点（设计复审视角；全量盘点见前置门禁报告）

| 编号 | 标题 | 状态 | 相关 | 设计对照结论 |
|---|---|---|---|---|
| ADR-0006 | Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局 | accepted | **核心** | 设计 6 项架构决策（A–F）与 §4 全部机制逐条映射到已接受条款，无一违反（见下表 12 项映射）；两处解释点记录为 no-conflict（见「解释点记录」1、2） |
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted | 间接 | SCHEMA 信封作为 Y.Doc 内容透传持久化、不解释；测试 fixture 数据不违反「纯引擎仓库」条款；无冲突 |
| ADR-0002 | nomicore 是全新重写，authority 完全出范围 | accepted | 间接 | 无 authority/校验逻辑进入持久层（META 仅校验 docId 一项，ADR-0006 明文）；无冲突 |
| ADR-0003 | 求值器与派生 schema——ROOT 根别名约定 | accepted | 间接 | ROOT 随整 doc 经 encodeStateAsUpdate/applyUpdate 还原（保类型，§5 用例 2）；持久层不解 ROOT 语义；无冲突 |
| ADR-0004 | vfsl-protocol 类型协议包 | accepted | 无关 | 设计不触及类型投影；DENY LIST 明确排除 `packages/vfsl-protocol/**`；无冲突 |
| ADR-0005 | 投影生成管线——SchemaSource 接缝 | accepted | 无关 | 设计不触及 SchemaSource/codegen；DENY LIST 排除 `packages/vfsl-codegen/**`、`domains/**`；无冲突 |

无 superseded ADR（与前置门禁盘点一致）。

## 设计 ↔ ADR-0006 条款对照（一致性映射，核心价值所在）

| # | 设计决策/机制（出处） | ADR-0006 条款（原文摘录） | 结论 |
|---|---|---|---|
| 1 | 决策 A：抽取 `lifecycle.ts` 共享内核，Memory/File 双 Adapter 继承、两个公共 Adapter 类保持独立（§3 决策 A；设计明文引用并拒绝合并） | 「`MemoryPersistence` 与 `FilePersistence` 是两个真实 Adapter（两个 Adapter 证明 seam 不是假想抽象）」 | 一致——保留两个真实 Adapter，内核为包内私有实现细节；「不得复制第二套」以可 grep 判据兑现 |
| 2 | 决策 B：内核 I/O 缝 `(user, docId, signal)` 三参；公共 `DocPersistence` 接口零改动（§4.1–4.2） | 接口签名 `loadDoc/saveDoc`；「规模优化……以不改变 `DocPersistence` Interface 的 Adapter 内部替换实现」 | 一致——公共接口不动，缝为内部实现自由度 |
| 3 | 决策 C：`SAFE_PATH_SEGMENT` 同一正则、入口 loud throw、`resolveSnapshotPaths` 双重校验（§4.3.1–4.3.2） | 「userId 与 namespaceId 共用安全文法 `^[a-z][a-z0-9-]{0,62}$`」「作为受控安全路径段使用（不允许特殊字符/路径分隔符）」 | 逐字一致（同一文法）；「本层不鉴权」不受影响（文法是路径安全门，非授权检查） |
| 4 | `resolveSnapshotPaths`：`{rootDir}/users/{userId}/{namespaceId}.snapshot`，tmp = `${snapshotPath}.tmp`（§4.3.2） | v1 磁盘布局图 + 「写入 `{namespaceId}.snapshot.tmp` 后以原子 rename 覆盖 `{namespaceId}.snapshot`」 | 逐字一致 |
| 5 | flush：启动时一次性 `Y.encodeStateAsUpdate(entry.doc)` 全量捕获 → writeFile(tmp) → rename（§4.1 flush） | 「flush 在触发时以 `Y.encodeStateAsUpdate(doc)` 编码**完整 Y.Doc 状态**，写入 `{namespaceId}.snapshot.tmp` 后以原子 rename 覆盖」 | 一致（含「flush 启动时捕获」语义） |
| 6 | `restoreEntry`：只读 `.snapshot`、`Y.applyUpdate`、META.docId 校验 loud throw、不触 createdAt（§4.1） | 「`loadDoc` 只读取 `.snapshot` 并 `Y.applyUpdate` 还原」「`META.docId` 必须等于请求的 namespaceId；不一致视为持久化损坏并响亮失败」「持久层只校验 META.docId」 | 逐字一致 |
| 7 | 决策 F：无 fsync、无文件锁（多实例同 rootDir 属调用方错误）、首刷惰性 `mkdir recursive`、load 只读不留痕迹（§3 决策 F） | 「rename 成功即完成一次 flush：v1 不对每次 flush 做 file/directory fsync」「v1 限制：单进程（无文件锁）」「不引入 WAL、增量水位、帧格式、压缩调度或坏帧截断」 | 一致——v1 边界逐条遵守、零越界 |
| 8 | 调度/单飞/generation/degraded-retry/release/evict 全部由内核继承（§4.1、§4.6、§4.7） | 「第一次 dirty 启动 max-dirty 计时器……每次 saveDoc 重置 debounce 计时器……」「单飞 flush + generation 保序……旧 snapshot 不得将新状态误标为已保存」「save 失败按 doc 只读降级，保留内存事务……retry……」「release = 不再使用通知……」「引用归零仅使缓存项成为可驱逐候选」 | 一致——内核逐字搬迁即条款延续；epoch 防护兑现 generation 保序 |
| 9 | 决策 D：公共面 = FilePersistence/createFilePersistencePlugin/Options/Status；工厂/实例模型（§3 决策 D、§4.3.3） | 「插件采用工厂/实例模型而非全局单例，以支持测试隔离、不同 rootDir 与 HMR/reload」「v1 不提供 list」 | 一致——无 list、无越界 API；每工厂调用独立实例 |
| 10 | dispose：清 timer、abort I/O、销毁缓存 doc、`disposeAdapterState`、await 在途、幂等；Cordis effect 清理注销服务（§4.7） | 「dispose 时释放文件句柄、后台任务和 Y.Doc 缓存；宿主负责按依赖逆序停止插件」 | 一致（file 侧无持久句柄，fsPromises 无状态调用） |
| 11 | 依赖面：cordis/yjs/persistence contracts/node 内建；DENY LIST 排除 `apps/**`（§3、§9） | 「插件实现只依赖 Cordis、Yjs 与持久化 contracts，**不得 import DSH 或 NomicoreServer app**」 | 一致（node 内建不在禁止面） |
| 12 | 创建 = 首个 saveDoc：ENOENT → undefined → null；不写 owner、不生成/校验 createdAt（§4.3.2、§4.5） | 「loadDoc 不存在返回 null……首次 saveDoc 即完成创建（无独立 createDoc）」「`owner` 仍不写入 META」「`META.createdAt`……持久层不生成、不修改、不校验」 | 一致 |

## 冲突点

无 hard-violation / override-declared / evolution 条目。

裁决分布：**no-conflict × 12**（见上表），override-declared × 0，evolution × 0，hard-violation × 0。

### 解释点记录（均裁决 no-conflict，供 SA2 评审与 Jim 复核）

1. **决策 E——`.tmp` 清扫时机（load 路径惰性清扫，不做启动全树扫描）**
   - ADR 原文：「`loadDoc` 只读取 `.snapshot` 并 `Y.applyUpdate` 还原 Y.Doc；启动发现遗留 `.tmp` 时一律忽略并删除——`.tmp` 可能半写入，只有 `.snapshot` 是提交态。」
   - 设计落地：忽略无条件满足（`.tmp` 在任何路径永不被读）；删除改为 load 路径惰性清扫 + 每次 flush 的 `writeFile(flag:'w')` 截断同名遗留 tmp。
   - 裁决 no-conflict 依据：(a) 条款的规范内核是「`.tmp` 永不被读、`.snapshot` 是唯一提交态」的崩溃恢复政策，设计完整保留；(b)「启动发现……时」是条件句（发现 → 忽略+删除），未强制规定发现机制；启动全树扫描需枚举 `users/**`，与「v1 不提供 list」的极简接口边界相抵；(c) 任务简报验收条款（前置门禁已裁决 clear）即为 load 时点表述「load 只认 `.snapshot`；遗留 `.tmp` 一律忽略并删除」，设计与之逐字吻合；(d) 残余差异仅为「永不再被加载的 namespace 的孤儿 `.tmp` 滞留磁盘」，属磁盘卫生而非行为正确性。
   - 该决策点已追加进相关决议文档。若 owner 期望启动期全量卫生清扫，属设计偏好增量，不构成 ADR 违反；建议 SA2 评审就此质询一次。
2. **「手动 evict」的覆盖面**（前置门禁提示 ① 的回收）
   - ADR 实施顺序第 3 步描述项含「手动 evict」；设计的公共面未新增显式 evict API，驱逐由继承内核的 `maybeEvict`（引用归零 → 可驱逐候选 → clean 后驱逐）承担。
   - 裁决 no-conflict 依据：ADR 冻结的 `DocPersistence` 接口仅 loadDoc/saveDoc，「v1 不提供 list」表明接口极简是刻意决策；eviction 的规范条款（「引用归零仅使缓存项成为可驱逐候选，不立即释放」「release……仅在保存成功、缓存/空闲策略满足后才真正释放」）由内核逐字延续；「手动 evict」出现于实施顺序的能力枚举，非接口条款。若需显式 evict 入口，属纯增量导出，与设计决策 D 的 YAGNI 原则一致。
3. **tmp 清扫失败 best-effort 吞掉（§4.3.2 `sweepLeftoverTmp`）**：ADR 未规定删除失败处理；设计「同一磁盘状况在下次 flush 的 writeFile 响亮浮出 → degraded」的信号不丢失论证成立，且「`.tmp` 永不被读」不受影响。no-conflict。
4. **dispose 竞态窄窗（`throwIfAborted` 与 rename 之间，§4.3.2 注记）**：ADR 要求「旧 snapshot 不得将新状态误标为已保存」。设计 epoch 防护保证迟到结果不推进 savedGeneration/status；tmp+rename 至多安装一个一致的有效旧状态，不产生损坏。no-conflict。
5. **`createFileHandleForTest` 为 async（与 memory 的同步 `createMemoryHandleForTest` 不对称，§4.3.4）**：test-only、模块路径导出、不入包公共面；无任何 ADR 条款触及。记录备查。

## 结论

**Verdict: `clear`。** 设计的 6 项架构决策（A–F）与 §4 全部机制均落在 ADR-0006 已接受条款的授权范围内，其中磁盘布局、安全文法、META.docId 响亮失败、tmp 路径名、只读 `.snapshot` 等为逐字吻合；未推翻（override × 0）、未演进（evolution × 0）、未违反（hard-violation × 0）任何 ADR 决策。与 ADR-0001/0002/0003 的间接关联一致；ADR-0004/0005 无关且被 DENY LIST 排除。设计后复审放行，进入 SA2 全维度攻击评审。

前置门禁 4 条非阻塞提示的回收情况：① 手动 evict → 解释点 2；② `.tmp` 清理时点 → 解释点 1（设计已给出明确落地）；③ 依赖边界硬性条款 → 映射表 #11 遵守；④ v1 边界 → 映射表 #7 遵守。

## 产出

- 本报告：`wiki/raw/task_file-persistence-plugin_design_conflict_report.md`
- 相关决议文档已追加「设计引入的新决策点（设计后复审追加）」节：`wiki/raw/task_file-persistence-plugin_relevant_decisions.md`
