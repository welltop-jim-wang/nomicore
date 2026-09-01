---
status: complete
run_id: issue-154-1788105229-447205
branch: fix/issue-154-on-docs-namespace-diagnostic-change-log
round: 1
---

# Issue #154 — Retain, lease, and delete namespace diagnostic logs

## 改动摘要

完成 namespace diagnostic File adapter 的有界存储、读会话租约与 namespace 级逻辑删除能力。

- `c0f6cbc` — 实现 age/byte retention、JSONL-as-commit-marker 可恢复删除、orphan hygiene、可续租 read-session、trim-aware strict reader/resume、namespace logical deletion、公共导出、健康事件与文档。
- `385a376` — 修复 SA4 发现的 P2 byte sweep 被 age freshness 错误门控的问题；age 与 byte 两个限制独立生效。
- `739a24b` — 加入 T-A9 回归钉，确保新鲜数据在非空 age limit 下仍会被 byte budget 裁剪。

实现遵守 File adapter 边界：只删除 closed 且未被有效 reader lease 持有的 segment groups；`.jsonl → .deleting → 删除 .bin → 删除 .deleting` 作为可跨重启续跑的提交标记协议。strict reader/resume 能报告已裁剪历史而不掩盖中间缺口；namespace 删除只承诺活跃存储的逻辑删除，不承诺 SSD、备份或对象存储版本的 secure erase。

依赖 #153 已确认可用：`eaf0484` 是任务基线的祖先，rolling、reopen/repair 与 segment path 接口均已在位。

## 验证

- SA6 测试先行：新增 46 个 retention/lease/deletion/history 契约测试；初始 41 个有效红灯，后续全部转绿。T-A9 经反事实验证：在缺陷提交 `c0f6cbc` 红、修复后 `385a376` 绿。
- SA4 静态审查：R1 发现 P1 byte-budget defect；SA3/SA6 回流后，SA4 R2 **PASS**。
- SA7 独立动态验证：**PASS**。真实默认 `30d/1GiB` 情形下对 1.113 GiB 新鲜数据裁剪至 0.996 GiB；真实 SIGKILL 捕获 W1/W2 删除窗口并验证恢复、无 rotate 与幂等重扫；租约/过期/续租、trim reader/resume、namespace 删除、残余风险探针均通过。
- 最终 engineering/code-review 双轴：standards **PASS**（无标准违规）；spec **PASS**（全部 issue #154 与 ADR-0012:280-299 要求可追溯满足）。
- 最终独立后台验收（未被 SA4/SA7/双轴覆盖的 repository integration gate）：
  - `pnpm typecheck` → exit 0。
  - `pnpm test` → **147 files / 1862 tests passed / Type Errors no errors**，exit 0。
- package 级复验：`npx vitest run packages/namespace-diagnostic-log/` → **27 files / 427 tests passed / Type Errors no errors**。

最终 HEAD：`739a24b test(namespace-diagnostic-log): pin byte-budget independence from age (T-A9, SA4 R1 #154)`。

## 遗留风险

1. 发布后 GitHub CI 结果仅能由 Host push/PR 后观察；本报告表示本地 MABF 完成，不宣称 CI 已绿。
2. byte budget/report 口径为 JSONL+BIN segment bytes，不含约 KB 级的 manifest/current locator 元数据；两侧口径一致，建议在后续 Host 文档中澄清。
3. reader lease registry 以原始 `rootDir` 字符串分区；Host 接线应对同一根目录使用规范化一致的路径（后续 #155 文档项）。
4. `sweepOnOpen: false` 会将遗留 `.deleting` 的卫生完成延后到显式 sweep；默认 `true` 符合启动恢复路径。

本 REPORT.md 仅表示本地 MABF 验收已完成；未执行 push、PR、标签、`.mabf-done` 或其他 Host 生命周期操作。
