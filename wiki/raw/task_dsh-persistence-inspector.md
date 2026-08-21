# MABF Task: DSH 持久化开发 profile 与 inspector 探针（P4）

## Issue #59

## Parent

PR #55

## Task Type

功能开发（总控自判：issue body 无 Task Type 标记；诉求为新增能力 —— DSH 开发宿主 profile + inspector 探针，非缺陷复现）

## What to build

在 DSH 作为 Cordis 开发宿主加载 P1–P3 的同一持久化插件实现，提供仅开发环境使用的 inspector 探针，验证插件不依赖 NomicoreServer 且可在真实 DSH 生命周期中 start/stop/reload。inspector 只消费 DocPersistence service，不得成为核心插件依赖。

## Acceptance criteria

- [ ] DSH profile 可选择 MemoryPersistence 或 FilePersistence Adapter（同一 contracts、零条件分支）
- [ ] inspector 使用 handle：load → saveDoc 标脏 → 受控时钟/可观察调度触发 flush → release；重复 load 同 doc、不同 handle
- [ ] userA/doc1 与 userB/doc1 隔离、META.docId 校验、SCHEMA/META/ROOT 三条目可观察
- [ ] save 失败后 `persistence-degraded`、后续写拒绝、retry 成功恢复的探针记录完整
- [ ] release 后由持久层内部决定真实 evict，probe 可观察引用归零与最终释放
- [ ] 插件 reload/dispose 后无文件句柄、timer、监听器、Y.Doc cache 残留
- [ ] 持久化核心插件源码不 import DSH；DSH wrapper/profile 保持薄 Adapter
- [ ] DSH 中的探针结果形成可复制的命令 + 输出记录（供后续 NomicoreServer Host 复用验收）

## Blocked by

#58（FilePersistence Cordis 插件）— 已合入（HEAD: 2aa22f4 PR #66）

## Working Directory

/home/wangjian/nomicore-fix-issue-59

## Branch

fix/issue-59-on-adr-server-design（base: adr/server-design）
