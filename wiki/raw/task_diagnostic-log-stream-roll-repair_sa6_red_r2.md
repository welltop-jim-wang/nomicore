# （已取代）SA6 红灯重锚报告 — Issue #153 Round 2（早期草稿）

> **本文件为早期草稿，已被最终报告取代：`wiki/raw/task_diagnostic-log-stream-roll-repair-r2_sa6_red.md`**。
>
> 早期草稿对应「§13.11 重写 + §13.11b + 窗口1/3 补 truncatedBytes」的 4 红锚状态；最终态在其上追加
> §13.11c（refs 空 + 完整 orphan 尾帧纯 C3 场景 + 续写 sidecar frameOffset="0" 锚）与 §13.32c
> 强化断言，并把 O1 勘误口径写入 §13.11b 注释（删除「frame-boundary-invalid 自伤」表述），
> 最终红灯统计：**6 failed | 375 passed (381) / Type Errors: no errors / exit=1**
> （复跑一致，`.mabf-bg/sa6-r2-red-run.log`、`.mabf-bg/sa6-r2-reopen-file-run.log`）。
