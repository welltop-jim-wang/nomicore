# AC 逐条确认门禁 — doc-runtime materializeRoot 修订轮 rev2（issue #74 / PR #84）

核对基准：owner 反馈 issuecomment-5383810572 + 任务简报 task_doc-runtime-materialize-root-rev2.md。
核对时间：2026-08-23（rev2）。总控亲验：typecheck exit 0 + vitest 65 files / 927 tests 全绿（.mabf-bg/rev2-verify.log）；SA7 动态验证 47/47 活链路攻击全过（sa7_report.md）。

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC-1 | rebase 到最新 origin/docs/doc-runtime-validation（8a42501） | ✅ | 新 head 0c3242b（rebase 后）；git log 确认 6 commit 重放；wiki/raw/task_doc-runtime-materialize-root-rev2_rebase_resolution.md | SA3 冲突解决（4 文件次 union-merge），总控核验 |
| AC-2 | 逐个解决冲突，不整文件 ours/theirs；策略逐冲突记录 | ✅ | rebase_resolution.md：package.json×2（取 0.1.4 高版本）、extract.ts（保留 makeRefResolver + JSDoc 衔接 + §2.1.2 import 去重，SA4 复核 ✓）、index.ts（双侧保留+去重）、ci.yml（自动三向合并） | SA3 + SA4 §2 复核 |
| AC-3 | rebase 后重跑 typecheck / test / materialize 专项门禁 | ✅ | 基线后台跑：typecheck=0 test=0（64 files/904 tests，.mabf-bg/rev2-baseline.log）；实现后 65 files/927 tests；CI「Materialize root tests」门禁命令本地 60/60 exit 0（SA7 §2）；Node 20/24 矩阵待 push 后 CI 执行 | 总控亲验 + SA7 |
| AC-4 | P1：写入前检测活动外层 transaction；内层调用 loud fail + doc 零写入 + 绝不 {ok:true} | ✅ | RD7/⓪ guard：materialize.ts 函数体第一句三窗口谓词（A/B/C），throw DOCRT-E202 三变体；SA7 活链路：外层 transact → E202-A + 0 update + state 逐字节不变 + ROOT 空置；observer 回调 → E202-B | SA1 设计 + SA3 实现 fdcf757 |
| AC-5 | P1：characterization 测试改为拒绝测试，断言错误身份/消息、update===0、state bytes 不变 | ✅ | materialize-root.test.ts T-1 改造（708-780 整块替换，RT-6 收紧 /DOCRT-E202/）+ materialize-root-rev2.test.ts RT-2（stateBytes 逐字节不变 + update 计数）+ RT-3（三形态）+ RT-4（wedge 诊断） | SA6 + SA3 转绿 |
| AC-6 | Medium：成功语义二选一并落实 | ✅ | 定稿出口 1（RD8）：⑥ verifySnapshotIntact 对称重物化 extract(real)≡extract(scratch)，INV-11 投影等价；偏离 → throw E201-C；校验无法完成 → E201-D；公共 API JSDoc/入口注释同步明确成功语义 | SA1（四轮判据演进 R1→R4）+ SA2 R4 pass + SA3 |
| AC-7 | Medium：嵌套 Y.Map/Y.Array/Y.XmlFragment 就地修改测试 | ✅ | materialize-root-rev2.test.ts Medium ×3 + RT-1.5 三掩盖形态 + RT-1.6 删除向量（D1/D2）+ 诚实对照 ×5；SA7 活链路三载体 + 删除复跑全过 | SA6 + SA7 |
| AC-8 | Minor：CDATA/PI/comment 明确为 lexical-token round-trip（非结构化节点语义） | ✅ | RD9：JSDoc 载体特征措辞（W2 合规不升格逐字承诺，materialize.ts/index.ts）；SA8 双门禁 W2 复核 ✓ | SA1 + SA3 |
| AC-9 | Minor：元素内部混合内容测试 | ✅ | materialize-root-rev2.test.ts Minor-1（文本/元素/注释/CDATA/PI 交错 round-trip，语义比较器）绿 | SA6 |
| AC-10 | Minor：DOCRT-E200 零写入确定性覆盖 | ✅ | RD10 极深树方案（20_000 层，实证溢出点落 ② detached 装配）：Minor-2 用例断言 ok:false + 恰 1 issue E200 + 0 update + state 不变；SA7 复跑确认 | SA6 + SA7 |
| AC-11 | 不依赖 JSDoc 单轨（运行时强制） | ✅ | ⓪ guard 为运行时 throw；JSDoc 仅文档 | SA3 fdcf757 |
| AC-12 | 回报新 base SHA、冲突清单与策略、最新 head SHA、验证结果 | ✅ | REPORT.md「验证」节 + rebase_resolution.md | 总控收口 |

全部 ✅ → 进入第四阶段收尾。观察项（非阻塞，已登记档案）：O-S4-1（专项存在性门禁未扩展 rev2 文件）、O-S7-2（CI 动态触发证据待 push 后 runner 核验）、O1/O4（未来 create 流程 / wedge × persistence 监听者前瞻，相关决议文档已登记）。
