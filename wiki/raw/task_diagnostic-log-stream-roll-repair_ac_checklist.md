# AC 逐条核对表 — Issue #153 Reopen streams, roll segments, and repair provable tails（round=1）

门禁时点：SA4 verdict=pass + SA7 verdict=pass（评审双清）之后。证据三源：SA6 红灯锚（§13.1–33，119 红全转绿）、SA4 静态验尸（sa4_review.md）、SA7 动态实证（sa7_report.md：多进程 E2E 74/74 + 322 轮 SIGKILL 崩溃矩阵 + 双 Node 140/1784）。

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | 健康 stream 跨 Runtime generation 与正常重启 reopen，续接 sequence 分配与 append 顺序，单逻辑 writer | ✅ | SA6 §13.1–3（reopen 续写/streamId 稳定/sequence 续接锚）；SA7 §2-S1：真进程退出重启链 A→B→C，streamId 恒等、B 首条 seq=4/C 首条 seq=6、全序 [1..7]、current.json 指向同流、零修复零 rotate、reader ok；设计 §8 单 writer（构造期唯一写者，write-slot 外接线纪律 §12） | 已闭合 |
| AC2 | JSONL/BIN 作为一组在任一配置 target 达到时于写下一条 record 前滚动；固定段编号；显式耗尽行为 | ✅ | SA6 §13.4–6（恰达边界/跨段续写/组不拆对）+ §13.26–28（exhaustedAtOpen 双路径/99999999 不回绕/invalid-roll-targets 门）；SA7 §2-S2/S3/S3b：records target=2 跨重启三段固定编号 1..3、闭段恰 2 条、组不拆对（bin ⊆ jsonl 段集、惰性创建）、超大单条独占新组、reader ok；耗尽=恰一次 stream-exhausted + disabled 不新建 generation（冲突点 #2 钉死） | 已闭合 |
| AC3 | 启动只截断三类可证明尾损（不完整尾 JSONL 行/不完整尾 frame/完整未引用尾 orphan frames），每次修复经健康 observer 上报 | ✅ | SA6 §13.7–12（C1/C2/C3 判定式 + R1 全截断退化变体 + §13.11 契约面）；SA7 §2-S4a/S4b/S4c：真实字节截断 → C1+C3 级联/bin-incomplete-frame/bin-orphan-frames 修复事件逐次上报 + 同流续写 + reader ok；§1.1 repair-io-failure chmod 0444 注入 4/4（含前序修复保留复合）；后缀性质=全有或全无（判腐即零修复） | 已闭合 |
| AC4 | 中间损坏/缺失被引用帧/校验或 CRC 不符/未知格式/schema 不兼容/locator 歧义永不改写历史；旧 stream 只读；允许处确定性新建 generation | ✅ | SA6 §13.13–20（零修复矩阵/cause 唯一性/14+17 双形状/冻结配置 5 case）；SA7 §2-S5 物理篡改矩阵（CRC 翻位/删中间行/未知 frameVersion/17 键指纹篡改/14 键 legacy/冻结配置变更）每场景恰一次 rotated{六 cause}+零修复+旧流字节恒等+新 generation 承接；S4b0 撕裂被引用帧=corrupt rotate 零修复；§2-S6b locator 歧义 → disabled+locator-ambiguous+零写入；G1 闭段惰性残渣不判腐 | 已闭合 |
| AC5 | 崩溃窗口与重启测试覆盖 BIN-before-JSONL、partial writes、orphan 尾帧、中间损坏、sequence/segment 耗尽、manifest/config 变更 | ✅ | SA6 §13.29 四窗矩阵（BIN 成功/JSONL 前后各窗）+ §13.21–28（locator/歧义/双耗尽/配置门）+ §13.31–33（链中 orphan 全生命周期/不可读≠缺失/愈合失败）；SA7 §1.3：322 轮 SIGKILL 真实崩溃矩阵（W1×3/W2×22 任意页倍撕裂全修复/orphan-mid×1/bin-torn-mid×2/W4）零不变量失败；§2-S6a 坏 locator 重扫恢复；W3 物理窗口 µs 级不可竞速命中的等价性三面论证（§1.3 记档） | 已闭合 |

结论：AC1–AC5 全 ✅（5/5），证据逐条锚定 SA6/SA4/SA7 报告与活链路用例。进入 Phase 4 双轴终审。
