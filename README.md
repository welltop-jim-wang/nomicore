# nomicore

[yjs-server Namespace Schema 自描述体系](https://welltop.feishu.cn/docx/MvtJdEr84ojlRTxbmsWcqHD8npg)的落地仓库。

核心思想：一段 VFSL 文本（受限 TypeScript 子集 + 标记类型 + JSDoc 语义标签）作为 schema 的**单一真相源**，作为数据存进 doc 的 `__schema__`——派生 TS 类型、结构树、路径校验器、整文档校验器与 AI 说明，命名空间随数据走、不依赖代码模块。

## 仓库结构

```
nomicore/
├── packages/
│   └── vfsl/               # VFSL 引擎（骨架）：信封 / parser / 求值器 / 路径索引 / validateSnapshot / JSDoc 抽取
├── apps/                   # 新 yjs-server 服务端（预留，见 apps/README.md）
├── CONTEXT.md              # 领域术语表
└── docs/adr/               # 架构决策记录
```

> 当前仓库只有骨架：包职责、目录与工程配置已定，**不含实现代码**。
> 模块划分与契约以 grill-with-docs 讨论产出的 PRD 与 issues 为准，再逐个落地。

| 包 | 职责 | 对应设计文档 |
|-|-|-|
| `@nomicore/vfsl` | VFSL 解释器与派生产物：结构树 / 值 schema / 路径索引 / `validateSnapshot` | §3–§7、§9、§11、§12 |
| `apps/yjs-server`（预留） | 新 yjs-server：schema 数据面（校验 + 存储 + 同步 + namespace 生命周期） | §7、§10、§11 |

## 实施阶段（设计文档 §15）

1. **Phase 0 · POC**（当前）：parser + 标记类型 + 求值器 + `validateSnapshot` + vfs3.assets 演示测试；
2. **Phase 1 · contract 包**：VFSL 编译器与派生产物（类型 / 结构树 / 子 schema 索引）；
3. **Phase 2 · yjs-server**：schema 数据面服务端（namespace 生命周期、统一写入管线、同步协议）；
4. **Phase 3 · 数据化**：`__schema__` 写入 doc、方言版本、迁移流程；
5. **Phase 4 · AI 友好**：语义标签 + namespace card + 探针测试。

## 开发

```bash
pnpm install     # 安装依赖
pnpm test        # 运行 vitest
pnpm typecheck   # 两个包的 tsc 检查（含投影协议的编译期断言）
```

## 硬性约定

- **方言冻结**：`__schema__.lang/version` 自声明，引擎对历史方言语义只增不改；未知方言 loud-fail 只读。
- **零写入**：所有校验在事务前完成，失败 400 且文档不变。
- **单一真相**：禁止在代码里另立 schema 副本（手写 ValueShape / 平行的 zod 定义）；派生物全部从 VFSL 文本来。
- 领域术语以 `CONTEXT.md` 为准；架构决策见 `docs/adr/`。
