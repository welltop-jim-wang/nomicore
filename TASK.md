# MABF Task: vfsl-protocol 类型协议包：编译期路径投影机制

## Issue #24

## Parent

PR #23

## What to build

实现 ADR 0004 冻结的 `@nomicore/vfsl-protocol` 包（设计文档 §8.3 机制的落地）：纯类型、零运行时、零依赖的编译期路径投影协议。导出幻影 `unique symbol` 口袋、`PathSchema<Value, Kind>` 载体、`PathAt<Map, Path>` 类型级路径解析（含空路径 `[]` → 根节点分支）、`PathValue`/`PathKind` 取值、`UnknownPath<Path>` fail-closed 标记、`VfslPathMap` 空表（未增广时一切路径编译错误）、`VfslTypedAccess` 接口（`patch`/`read`/`kindOf` + D1 序列编辑三件套 `appendToArray`/`insertIntoArray`/`deleteFromArray`）。kind 词汇表 `'map' | 'array' | 'xml-fragment' | 'leaf' | 'plain'`。数组节点带 `Record<`${number}`, 元素子树>` 子树（D1：patch 下标段可解析），`YPlainArray` 终态。

测试装置（D4）：vitest typecheck 模式；正例 `expectTypeOf`、负例 `@ts-expect-error`（自我反转断言）。**手写**迷你 `VfslPathMap` 增广（生成器是票 F 的职责，本票用精简手写表复刻设计文档 §8.4 实测矩阵）。

## Acceptance criteria

- [ ] 包导出齐备且编译产物为空模块（零运行时）、devDependencies 仅 tsc/vitest
- [ ] 空 `VfslPathMap` fail-closed：未增广时任何 `patch`/`read` 调用编译错误
- [ ] §8.4 正例矩阵复刻：写 `name` 接受 string、`portraitResourceId` 接受 `string | null`、整实体写入接受实体类型、`read` 返回精确类型、`kindOf` 投影出 kind
- [ ] §8.4 负例矩阵复刻（`@ts-expect-error`）：`patch(name, 42)`、未知路径、整实体缺必填字段、数组下标值类型错误
- [ ] D1 行为：数组下标段可解析且值类型精确；`YPlainArray` 节点终态（下钻 → UnknownPath）
- [ ] D2 行为：联合成员独有字段 read 类型为 `T | undefined`；判别字段为精确字面量联合；整值读出发射判别联合（可 tsc 窄化）
- [ ] D5 行为：路径无 ROOT 前缀；`kindOf([])` → `'map'`
- [ ] 增广经 `declare module` 生效；CI 纳入 `vitest --typecheck`（Node 20/24 均过）

## Blocked by

None - can start immediately

## Referenced Documents



## Working Directory

/home/wangjian/nomicore-fix-issue-24

## Review Feedback (from closed PRs)



## Issue Comments (decisions & context)



## Branch

fix/issue-24-on-adr-vfsl-protocol
