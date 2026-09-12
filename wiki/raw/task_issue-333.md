# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #333
Title: [shape-budget] T0: readData 成功分支形状断言 helper 化(prefactor,零行为变化)
State: open
Issue updated at: 2026-09-12T06:41:35Z

## Issue body

## Parent

PR #332（adr-0024-readdata-shape-budget）

## What to build

readData 成功分支的「恰三键」深等断言散布在 runtime 与 registry 的既有测试中(数十处)。本票把它们收敛为**统一形状断言 helper**(断言语义与行为**零变化**,全套保持绿),使后续 T3 的五键破坏性修订集中在一处完成,而不是百处散改。纯测试重构,无任何产品代码变化。

## Acceptance criteria

- [ ] runtime 与 registry 测试中 readData 成功分支深等断言全部经统一 helper 表达(或等价的集中化形状构造)
- [ ] 断言语义零变化:改写前后测试对同一实现的判定一致,全套包门禁绿
- [ ] 无产品代码 / 公共类型变化;root typecheck 与 test 通过

## Blocked by

None (can start immediately).

## Comments
