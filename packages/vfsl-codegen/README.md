# @nomicore/vfsl-codegen

投影生成器（ADR 0005 §3/§4）：吃 `evaluate` 的派生 schema，发射 `VfslPathMap` 增广类型文件。纯发射器——物化折叠/联合分类/判别式检测由求值器完成，本包不做语义再推导。生成物恒以 `import type { PathSchema } from '@nomicore/vfsl-protocol';` 接线协议（任意域，含零别名域——模块性 + 增广目标的恒定保障）。

## 用法

```bash
pnpm generate          # 全量生成（domains/*）
pnpm generate --check  # CI 新鲜度校验：重新生成 → 逐字节 diff，漂移即非零退出
```

## 工具层限制（非方言约束）

以下是**本生成器 v1 的实现边界**，不改变方言合法性（v1-spec / ADR 0003 对这些构造依然合法）：

- **ROOT 不可被其他别名引用**：方言层合法（ADR 0003 §2「既当根又当积木」），但类型投影中 ROOT 的递归引用形态未支持——命中即响亮拒绝（`UnsupportedRootShapeError`），不静默生成错误类型；
- **异形联合**（发射期无法同形归类的联合）：响亮拒绝，无静默回退；
- **别名 × 协议导出名碰撞**：领域别名不得与 `@nomicore/vfsl-protocol` 的导出名同名——命中即响亮拒绝（错误码 `alias-protocol-export-collision`），请重命名领域别名；
- **idBase 不变式**：领域 id 须满足 `<name>@<digits>` 形态。

方言若需支持上述构造的类型投影，请回 ADR 0005 走设计修订，不要在本包内打补丁。
