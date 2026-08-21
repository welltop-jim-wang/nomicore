# 冲突门禁报告

- 被审对象：`wiki/raw/task_file-persistence-plugin.md`（任务简报，前置门禁 Phase 0）
- 冲突基准：`docs/adr/` 全集（0001–0006，共 6 份，逐个全读）+ `CONTEXT.md`
- 任务类型：功能开发（Issue #58，FilePersistence Cordis 插件）
- 审查日期：SA8 前置门禁

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0006 | Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局 | accepted | **直接相关（核心）** | 任务简报即「实现 ADR 0006 的生产 Adapter」，验收条款逐条映射到 ADR-0006 已接受条款（详见下），无任何违反 |
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted | 间接相关 | SCHEMA 条目以信封随 doc 持久化，持久层透传不解释——与「持久层看 Y.Doc、不了解 VFSL」一致；无冲突 |
| ADR-0002 | nomicore 是全新 yjs-server 重写，authority 完全出范围 | accepted | 间接相关 | 持久层不做 authority/校验，与 ADR-0006「看不见 schema 语义」互证；无冲突 |
| ADR-0003 | 求值器与派生 schema——ROOT 根别名约定 | accepted | 间接相关 | 「SCHEMA/META/ROOT 完整还原」锚定三条目布局与 ROOT 约定；持久层整体还原 Y.Doc，一致；无冲突 |
| ADR-0004 | vfsl-protocol 类型协议包 | accepted | 无关 | 编译期类型投影，持久层不触及；无冲突 |
| ADR-0005 | 投影生成管线——SchemaSource 接缝 | accepted | 无关 | 脚手架/codegen 管线，持久层不触及；无冲突 |

无 superseded ADR（6 份全部 accepted；ADR-0003 文首所述被取代对象是同号未定稿草稿，非任何在库 ADR）。

## 冲突点

无。

逐条对照记录（任务简报验收条款 → ADR-0006 条款，全部吻合）：

| # | 任务简报条款 | ADR-0006 对应原文 | 一致性 |
|---|---|---|---|
| 1 | rootDir 可配置、多插件实例互不影响 | 「插件采用工厂/实例模型而非全局单例，以支持测试隔离、不同 rootDir 与 HMR/reload」 | 一致 |
| 2 | `{rootDir}/users/{userId}/{namespaceId}.snapshot`；`^[a-z][a-z0-9-]{0,62}$`、不可路径穿越 | 布局图 + 「userId 与 namespaceId 共用安全文法 `^[a-z][a-z0-9-]{0,62}$`」 | 一致（任务「不可路径穿越」是安全文法的加强复述） |
| 3 | flush 用 `Y.encodeStateAsUpdate` 编码完整 Y.Doc，写 `.tmp` 后原子 rename | 「以 `Y.encodeStateAsUpdate(doc)` 编码**完整 Y.Doc 状态**，写入 `{namespaceId}.snapshot.tmp` 后以原子 rename 覆盖」 | 一致 |
| 4 | load 只认 `.snapshot`；遗留 `.tmp` 一律忽略并删除 | 「`loadDoc` 只读取 `.snapshot`……启动发现遗留 `.tmp` 时一律忽略并删除」 | 一致（见下方提示 2） |
| 5 | save → 新实例 → load 完整还原 Y.Doc（SCHEMA/META/ROOT） | 三条目布局（SCHEMA/META/ROOT）+ `Y.applyUpdate` 还原 | 一致 |
| 6 | META.docId ≠ namespaceId 视为存储损坏并响亮失败 | 「`META.docId` 必须等于请求的 namespaceId；不一致视为持久化损坏并响亮失败」 | 逐字一致 |
| 7 | 复用 P2 lifecycle core（缓存身份、handle/lease、调度、单飞 flush、generation、degraded/retry），不得复制第二套 | 共享 doc 独立 handle / 引用计数身份校验 / 内部调度 5s+500ms / 单飞 flush + generation 保序 / degraded + retry 各条款；「不为 server 重写第二份持久化逻辑」 | 一致（复用而非复制，正是 ADR 意图） |
| 8 | dispose 取消 timer、等待/处理进行中 flush、释放文件资源与缓存 | 「dispose 时释放文件句柄、后台任务和 Y.Doc 缓存」 | 一致（任务拆解了该条款的实现面） |
| 9 | 通过 P1 shared contract tests + 文件系统专属测试 | 实施顺序「3. FilePersistence 插件（用户分区、缓存身份、显式 save、手动 evict、恢复与崩溃测试）」；两个 Adapter 证明 seam | 一致 |
| 10 | 持久层看 Y.Doc、不了解 VFSL/业务数据 | 「看得见 Y.Doc……看不见 schema 语义（VFSL/校验规则属引擎领地）」 | 逐字同义 |

## 结论

**Verdict: `clear`。无冲突点、无 override 声明、无需 Jim 裁决的演进条目。** 任务简报的每一条要求均可在 ADR-0006（accepted）中找到对应或更强的授权条款；与 ADR-0001/0002/0003 的间接关联均一致；ADR-0004/0005 与本任务无关。前置门禁放行，可进入 SA1 设计。

### 非阻塞提示（供 SA1/SA3 参考，均非冲突）

1. **手动 evict 覆盖面**：ADR-0006 实施顺序第 3 步对 FilePersistence 列有「手动 evict」，任务简报验收清单未显式列出。ADR 条款未被违反（不构成冲突），但 SA1 设计应覆盖驱逐面（「引用归零仅使缓存项成为可驱逐候选，不立即释放」条款下的显式 evict 入口）。
2. **`.tmp` 清理时点措辞**：ADR 表述为「启动发现遗留 `.tmp`」，任务表述为「load 只认 `.snapshot`；遗留 `.tmp` 一律忽略并删除」。语义方向一致且任务的 load 时点不弱于 ADR 要求；实现按两者并集（load 路径遇到即删）即可，无需裁决。
3. **依赖边界为硬性条款**：任务简报未显式重申「插件实现只依赖 Cordis、Yjs 与持久化 contracts，**不得 import DSH 或 NomicoreServer app**」——该条款已收入相关决议文档，SA1 设计与 SA3 实现必须遵守。
4. **v1 边界**：单进程（无文件锁）、load 全量入内存、不引入 WAL/增量/压缩/fsync 承诺——任务未要求任何越界项，实现亦不得自行加入。

## 产出

- 相关决议（全链复用）：`wiki/raw/task_file-persistence-plugin_relevant_decisions.md`
- 本报告：`wiki/raw/task_file-persistence-plugin_conflict_report.md`
