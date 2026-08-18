# 0002: nomicore 是全新 yjs-server 重写，authority 完全出范围

设计文档以"改造现有 apps/yjs-server"的口吻写成，但 nomicore 是空仓库起步，必须先定位。决策：nomicore 从零实现新版 yjs-server——`apps/` 下长出完整服务端，旧系统逐步退役；设计文档只作动机与规格背景，其中对旧代码的"现状描述"不构成本仓库的代码事实。同时，旧系统既有的 authority 规则体系（`__authority__` manifest：enum / range / conditional / state-machine）**完全排除在范围外，不保留接口**——统一写入管线收敛为"结构 → 值 → 单事务提交"三步。

## Considered Options

- 作为独立库被现有 yjs-server 引用（贴合文档 Phase 2 字面表述，但放弃重写带来的协议与结构自由度）
- 仅作 POC 实验场，验证后再定归属（推迟决策，但 PRD 无法落）

## Consequences

- 设计文档未覆盖旧服务端的其余职责（同步协议细节、持久化、presence 等），PRD 必须显式划定新服务端的功能边界
- 与旧前端的协议兼容性成为开放问题（见 PRD 开放问题清单）
- `@invariant` 标签原本指向 authority 规则 id，如今失去解析目标——标签集需要相应调整（在 PRD 中定稿）
