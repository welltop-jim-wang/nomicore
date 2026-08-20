# nomicore

[![CI](https://github.com/welltop-jim-wang/nomicore/actions/workflows/ci.yml/badge.svg)](https://github.com/welltop-jim-wang/nomicore/actions/workflows/ci.yml)

[yjs-server Namespace Schema 自描述体系](https://welltop.feishu.cn/docx/MvtJdEr84ojlRTxbmsWcqHD8npg)的落地仓库：一次完整重写，而非对现有 yjs-server 的修补。

核心思想：一段 **VFSL 文本**（受限 TypeScript 子集 + 标记类型 + JSDoc）作为 schema 的**单一真相源**，作为数据存进 doc 的 `__schema__` 信封——派生 TS 类型、结构树、路径校验器、整文档校验器与 AI 说明，命名空间随数据走、不依赖代码模块。

## 这个版本能做什么（v0.1.3）

**VFSL v1 方言的完整解析器**。输入一段 schema 文本，输出可 JSON 序列化的 IR，或精确到行列的错误——同步、纯函数、对任意输入（含对抗性深嵌套、超长模块）**不抛错**。

```ts
import { parseVfsl } from '@nomicore/vfsl';

const result = parseVfsl(`
/** 名字约束 */
type Name = string & Pattern<"^[a-z][a-z0-9_]*$">;
type Port = 80 | 443;
type Pair = { first: string; second?: number };
type Synced = YMap<{ items: YArray<Name>; plain: YPlainArray<Pair>; leaf: YLeaf<number> }>;
`);
```

成功时得到 IR（kind 判别联合；不带行列——内容哈希对排版不敏感）：

```jsonc
// result.module.aliases[0]
{
  "kind": "alias",
  "name": "Name",
  "docs": [" 名字约束 "],          // JSDoc 原文，按出现序
  "type": { "kind": "pattern", "regex": "^[a-z][a-z0-9_]*$" }
}
```

失败时得到精确锚定的单条诊断（`message` 携带冻结前缀 `VFSL-E<编号>`）：

```ts
parseVfsl('type A = any;');
// { ok: false, issues: [{ message: 'VFSL-E101: any 类型被禁止（判定顺序第 5 条）', line: 1, column: 10 }] }
```

### 支持的方言子集（v1 冻结，只增不改）

| 构造 | 形式 | IR 节点 |
| --- | --- | --- |
| 类型别名 | `type A = …;` | `alias` |
| 原始类型 | `string` `number` `boolean` `null` `unknown` | `primitive` |
| 字面量联合 | `80 \| 443`、`"admin" \| "user"` | `literal` |
| 封闭对象 | `{ first: string; second?: number }` | `object` + `field`（`optional`） |
| 数组后缀 | `T[]` | `array` |
| 记录 | `Record<K, V>` | `record` |
| 六标记 | `YMap` `YArray` `YPlainArray` `YLeaf` `YXmlFragment`（**大小写是契约**） | `marker` |
| 值约束 | `string & Pattern<"正则">` | `pattern` |
| 别名引用 | 前向引用合法；声明顺序无关 | `ref` |
| JSDoc 原文 | `/** … */` 挂别名 / 属性 / 标记三锚位；不相邻即悬空（E305） | `docs: string[]` |

**诊断覆盖**：19 个错误码全量落地——词法（E201–E203）、语法（E100–E106）、语义（E301–E309，含环检测 E106、字段重名 E308、形状分类 E304/E306/E307/E309）。单错误模型：全部候选按 `(line, column, code)` 取最小，恰返回 1 条。

**尚未包含**（见路线图）：求值器、`validateSnapshot`、`__schema__` 信封、路径索引、yjs 服务端。本版本是纯解析层——文本进，IR 或诊断出，不触碰 yjs。

## 设计不变量

- **单一公共接缝**：`parseVfsl(text)` 是唯一导出函数；tokenizer / parser / semantic / shapes 均为内部件，结构不构成契约。
- **不抛错承诺**：任何输入的错误只经返回值传递；顶层兜底把意外异常转化为结构化 E100（命中即实现缺陷，不得视为通过）。
- **IR 可序列化**：纯数据、无环（环被 E106 显式拒绝）、值域在 JSON 表达力内——编译缓存与跨版本消费的前提。
- **方言冻结**：v1 按[规格](docs/vfsl/v1-spec.md)冻结，后续只做加法；未知方言在读取侧响亮失败，不静默降级。
- **仓库不含 schema 文本**（测试除外）：运行时真相是 doc 里 `__schema__` 的数据，不是代码库里的 `.vfsl` 文件。
- **零写入**：所有校验在事务前完成，失败 400 且文档不变（服务端落地时的承诺，解析层先行兑现其判定部分）。
- **单一真相**：禁止在代码里另立 schema 副本（手写 ValueShape / 平行的 zod 定义）；派生物全部从 VFSL 文本来。
- **零运行时依赖**：`@nomicore/vfsl` 只依赖 Node 标准库。

## 仓库结构

```
nomicore/
├── packages/vfsl/          # VFSL 引擎：本版本的解析器（tokenizer / parser / semantic / shapes / ir）
├── apps/                   # 新 yjs-server 服务端（预留）
├── docs/
│   ├── vfsl/v1-spec.md     # v1 方言规格（错误码表、EBNF、物化规则）
│   └── adr/                # 架构决策记录（单一真相源 / 全重写边界）
├── wiki/raw/               # 各 ticket 的任务简报与 SA 评审产物（流水线审计轨迹）
└── CONTEXT.md              # 领域术语表
```

## 路线图

1. ~~Phase 0a · parser 切片~~ ✅ v0.1.3：v1 方言全量解析（issues #5–#9，180 个测试）
2. **Phase 0b · 引擎补全**：求值器 / 路径索引 / `validateSnapshot` / `__schema__` 信封
3. **Phase 2 · yjs-server**：schema 数据面服务端（namespace 生命周期、统一写入管线、同步协议）——两个开放问题见 PRD #3（写入强制级别、API 面拆分）

## 开发

```bash
pnpm install --frozen-lockfile
pnpm -r typecheck     # tsc --noEmit（严格模式）
pnpm exec vitest run  # 180 个测试
```

CI：Node 20 / 24 矩阵（`.github/workflows/ci.yml`）。

Ticket 经 [MABF 流水线](docs/agents/issue-tracker.md)自动执行：SA6 红灯测试 → SA1 设计 → SA2 攻击评审 → SA3 实现 → SA4 静态 / SA7 动态双清 → PR → 绿 CI 合入集成分支。各阶段产物存于 `wiki/raw/`。
MABF dispatch channel verified: 2026-08-21
