# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #272
Title: vfsl: resolveSchemaAtPath 路径解析器（ADR 0016）
State: open
Issue updated at: 2026-09-08T17:35:37Z

## Issue body

## Parent

PR #271（docs/adr-0016-readdata-schema）

## Task Type

feature

## What to build

`@nomicore/vfsl` 新增公开同步纯函数 `resolveSchemaAtPath(derived, path)`：给定派生 schema 与具体读路径，返回路径终点的语义 schema 投影——值语义子树（ref 按名保留）+ 传递闭包别名表 + 文档注释路径寻址切片，供 namespace-runtime 的 readData 语义 schema 投影（ADR 0016）组合使用。读取侧消费者因此能凭"路径 → 带语义 schema"的纯解析能力理解任意合法路径上的数据形态。

解析语义（ADR 0016 为权威）：

- union 静态 any-member 扩展，与写侧路径守卫（validate-patch drillStep）语义同构——同一路径在写守卫合法 ⟺ 在读投影可解析；终点命中多个候选时合成 union 节点（合法 ValueSchema 形状，无判别式缓存）；
- Record 动态键带 keyPattern 时用正则实测该段，不匹配即拒绝（fail-closed）；
- optional 包装在游走中透明展开、在返回子树中原样保留；
- ref 目标缺失（畸形派生物）抛 InternalError（可信域先例，不进结果联合）；
- 预期失败经结果联合结算：`SCHEMA_PATH_NOT_FOUND`（无任何候选接纳该段）/ `SCHEMA_PATH_INVALID`（非数组或野段形状守卫），同步、不抛错、零 memo；
- docs/aliasDocs 切片的键规约与派生 schema 文档三表完全同构（§3 绝对语法路径 + `'<item>'/'<key>'/'<member N>'` 合成段）；别名表只含传递闭包内被引用的别名。

## Acceptance criteria

- [ ] `resolveSchemaAtPath` 经 vfsl 公共入口（包 index）导出，结果联合两枚失败码的 path 回显为调用方数组的新鲜副本
- [ ] union any-member 扩展与合成 union 终点、keyPattern fail-closed、optional 透明展开/返回保留、ref 缺失 InternalError 各有测试锚定
- [ ] docs/aliasDocs 切片键与派生 schema 文档三表键规约同构；别名传递闭包有测试锚定（含递归别名不发散）
- [ ] vfsl 包测试与 typecheck 绿；根仓 `pnpm typecheck`、`pnpm test` 无回归

## Blocked by

None (can start immediately).

## Comments

