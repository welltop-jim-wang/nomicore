# AC 逐条核对表 — Issue #153 round=2（修订轮：无引用完整 orphan BIN 尾帧清除）

门禁时点：SA4 R2 verdict=pass + SA7 R2 verdict=pass（评审双清）之后。round=1 AC 全集（ac_checklist.md 5/5 ✅）继续有效；本轮聚焦反馈涉及的 AC3/AC1 重新实证 + 其余零回退确认。

| AC# | 描述 | 状态 | round=2 证据 | 处理 |
|---|---|---|---|---|
| AC3 | 启动只截断三类可证明尾损，每次修复经健康 observer 上报 | ✅（重证） | **缺陷修复实证**：refs 空 + 完整 orphan 尾帧（含复合 C1+orphan+撕裂尾 / 全完整单帧 / ENOENT+双完整帧三形态）修复后 BIN 实长恒 ===0、truncatedBytes===修复前长度（4129/4122/8244 全 >0）、零字节修复事件绝迹（负向断言 + 真实 W1 SIGKILL 命中 `bin-orphan-frames{truncatedBytes:4194329}` 4MiB 全截）——ADR-0012「截断完整但未被引用的尾部 orphan frames」+ 设计 §5.2/§5.4 T=0 字面落地；SA6 §13.11 R2/§13.11c/窗口1/3/§13.32c 锚 + SA7 R2 §1 24/24 | 缺陷闭合 |
| AC1 | 健康 stream 跨重启续写续接 | ✅（重证） | 修复后同一 stream 续写零 rotate、首条续写 sidecar `frameOffset==="0"`、strict reader 全流 ok、后续 append 序列连续（1..4 / 1..3）；SA6 §13.11b 锚 + SA7 R2 §1 三形态 24/24 | 零回退 + 缺陷关联面闭合 |
| AC2 | 成对滚动/固定编号/显式耗尽 | ✅（零回退） | 双 Node 全仓 140/1786 全绿（§13.4–6/26–28 存量锚全绿）；R2 diff 恰 3 文件不触滚动面 | 零回退 |
| AC4 | 中间损坏等零修复+只读+确定性 rotate | ✅（零回退） | 存量锚 §13.13–20/31–33 全绿；T=0 收敛不改变判腐面（walkBinTail 四态与事件映射零变化，SA4 R2 ①实证） | 零回退 |
| AC5 | 崩溃窗口/重启测试矩阵 | ✅（零回退） | SIGKILL 抽样 68 轮 0 失败（W1×1+W2×14+W4×53）；存量 §13.29 四窗锚全绿 | 零回退 |

结论：AC1–AC5 全 ✅（5/5）；round=2 High 缺陷（无引用完整 orphan 尾帧未清除）经 SA6 锚纠错 → SA3 T=0 收敛 → SA4/SA7 双清 → 本门禁重证闭合。
