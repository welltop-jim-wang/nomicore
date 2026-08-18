# apps/

Phase 2 起的接入目标（设计文档 §7 / §10 / §11）：

- **`apps/yjs-server/`** —— 统一写入管线（REST patch / WS patch frame / 内部 API 走同一条"结构 → 值 → authority → 单事务"管线）、DocScope 方言路由（每个 namespace 绑定自己的解释器、规则集与编译缓存，未知方言只读）、schema 版本管理与数据化迁移流程。

在 `packages/vfsl` 完成 Phase 0（parser + 求值器 + `validateSnapshot` 的 POC 与测试）之前，这里保持空置。
