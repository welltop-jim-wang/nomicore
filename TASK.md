# MABF Task: Parser 禁止语法负例矩阵

## Issue #8

## Parent

PR [#2](https://github.com/welltop-jim-wang/nomicore/pull/2)

## What to build

v1 方言子集的越界语法逐项拒绝并给出结构化错误：`any`、自定义泛型、条件类型、mapped type、interface 继承。每项配一对用例——负例（越界写法，断言拒绝）与正例（最接近的合法写法，断言接受），证明拒绝是精确的而非一刀切。覆盖矩阵以测试体呈现。

## Acceptance criteria

- [ ] 五类禁止语法各有负例测试：`ok: false` 且错误含行列与可定位信息
- [ ] 每个负例配套一个"最接近的合法写法"正例通过
- [ ] 矩阵覆盖情况可在测试报告中逐项指认

## Blocked by

Blocked by: #6

## Referenced Documents



## Working Directory

/home/wangjian/nomicore-fix-issue-8

## Review Feedback (from closed PRs)



## Issue Comments (decisions & context)



## Branch

fix/issue-8-on-refactor-docs-add-mabf-multi-repo-monito
