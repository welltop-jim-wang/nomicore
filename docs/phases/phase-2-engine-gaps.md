# Phase 2 前置：引擎缺口层说明

Phase 2（yjs-server 接入）的引擎前置三票。全部依据已有 ADR 与设计文档，无新设计决策。

## 边界

| 票 | 交付 | 依据 |
|---|---|---|
| H1 信封解析与方言路由 | `parseSchemaEnvelope(input)`：信封 `{lang, version, id, text}` 校验 → 方言断言（vfsl@1，未知方言只读 loud-fail）→ parseVfsl 透传 | 设计文档 §6/§9/§10；PRD #3「信封解析与方言路由是后续引擎任务」 |
| H2 validatePatch 路径级写入校验 | `validatePatch(derived, base, path, value)` + 数组三操作：结构守卫（路径存在性任一成员规则、leaf/plain 拒绝下钻）+ 最近结构边界重建整值校验 | 设计文档 §7（统一写入管线）；CONTEXT.md「重建校验」；ADR 0003 §3 |
| H3 DocScope 作用域绑定与编译缓存 | 按文本内容哈希缓存 `{module, derived}`；多命名空间隔离绑定 | 设计文档 §10（作用域隔离）；ADR 0001（性能依赖按内容哈希的编译缓存） |

## 纪律

- H2 复用 `validate.ts` 解释器，不复制第三份（#28/#31 评审留档的 resolve 双份问题随票收敛）；
- 三票均纯引擎、零新运行时依赖、不碰 yjs；
- WS 校验语义（拒绝于应用前 / 错误通道 / 幂等重拒）与「写入强制级别 / API 面拆分」为 Phase 2 PRD 素材，不在本层。
