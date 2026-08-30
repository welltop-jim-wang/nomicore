# apps/

- **`apps/yjs-server/`** —— Phase 5 切片 9：可部署的 Hub/Peer Cordis 组合根
  （Clock/Timer/Persistence/NamespaceRegistry/WS 复制/认证授权/有序停机），
  部署文档见 `docs/integration/hub-peer-deployment.md`。

后续接入目标（Phase 2 起的统一写入管线、DocScope 方言路由、schema 版本管理等，
见设计文档 §7 / §10 / §11）：在 `packages/vfsl` 完成 Phase 0（parser + 求值器 +
`validateLogicalSnapshot` 的 POC 与测试）之前，保持未接入。
