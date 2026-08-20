# MABF Task: 投影生成器 @nomicore/vfsl-codegen（F2）

## Issue #26

## Parent

PR #23

## What to build

实现 ADR 0005 §3/§4：生成器吃 `evaluate` 的派生 schema，发射类型别名 + `declare module` 增广文件（映射表按 ADR 0004：Record→`Record<string,…>`、标记→kind、`Pattern`→string、`YXmlFragment`→string、ref→别名引用、数组→`Record<\`${number}\`,…>` 子树、docs→TSDoc、判别式→判别联合）。生成文件头注 `GENERATED … DO NOT EDIT` + 源哈希；`pnpm generate` / `pnpm generate --check`；CI regen-diff（源漂移与生成器漂移双抓）。

## Acceptance criteria

- [ ] 映射表逐行有发射断言（含 `YPlainArray` 终态、联合 `T|undefined` 宽度）
- [ ] docs 出现在生成的 TSDoc 上（依赖 #20 派生 schema 携带 docs）
- [ ] 判别式联合发射为可窄化的 TS 判别联合
- [ ] `generate --check` 对过期生成物退出非零；CI 接入
- [ ] 零运行时依赖纪律不适用于本包但依赖最小化

## Blocked by

#20（派生 schema 形状 + docs 携带）、#25（F1 接缝）

## Referenced Documents



## Working Directory

/home/wangjian/nomicore-fix-issue-26

## Review Feedback (from closed PRs)



## Issue Comments (decisions & context)



## Branch

fix/issue-26-on-adr-vfsl-protocol
