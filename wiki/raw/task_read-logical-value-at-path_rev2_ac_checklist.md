# AC 门禁清单（rev2）— union 仲裁回归测试变异判别力补缺（issue #75 / PR #83 rev2）

run_id: issue-75-rev-1787397220
AC 来源：`wiki/raw/task_read-logical-value-at-path_rev2.md`「验收标准（本修订轮 rev2）」（owner 第二轮 Review「建议的最小修订」逐条转化）。

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC-R2-1 | 三态仲裁抽为包内纯函数 seam；read.ts union 分支经该 seam 仲裁；INV-14 不破坏；声明序与首 value 短路惰性不变 | ✅ | `read.ts:271` `export type NavOutcome`、`:296` `export function arbitrateUnion(outcomes: Iterable<NavOutcome>): NavOutcome`、`:313` 包内私有 `function* memberOutcomes`、`:408` union 分支 2 行直接实参调用；index.ts 恰冻结五项导出（grep 实测零新增），exports map+private:true 结构性阻断包外 deep import；SA4 §3 逐行比对「与伪代码逐字一致」、§3.2.3 四命令全过（含四组阴性对照） | SA3 实现（commit 0f0b470），SA4 验尸 pass |
| AC-R2-2 | 表驱动包内仲裁测试六行全齐；首行证明前序 missing 后仲裁继续、后序真实 value 胜出 | ✅ | `test/read-logical-value-at-path-rev2-union-arbitration-pure.test.ts`（SA6，commit 7f77384）：六行 owner 表逐行落测；行 1 拉动记录型 Iterable 断言 `pulled=[0,1]` + 结果 value('v')（继续性具象化）；行 2 锚首 value 短路惰性（`pulled=[0]`）；红签名实测（总控亲跑：6/6 failed，`arbitrateUnion is not a function`）→ SA3 后 6/6 绿 | SA6 锚定 + SA3 转绿 |
| AC-R2-3 | R1/R2/R3 说明改写为「行为一致性锁」，删除动态覆盖 missing → later value 宣称；行为断言零改动 | ✅ | commit 7f77384 对 rev1 测试文件 52 行措辞勘误（文件头 rev2 勘误段 + R1/R2/R3 组注释与 describe/it 标题统一为「现行合法 schema/live 模型下不可构造竞争场景的行为一致性锁」）；总控 git diff 抽验：expect/断言/fixture 行零变更 | SA6 执行（其 owned 文件） |
| AC-R2-4 | mutation proof 执行并留证：「首 missing 即返回」变异下新增纯仲裁测试转红、R1/R2/R3 仍绿（对照）；还原后全绿 | ✅ | SA7 报告 §mutation proof：M-A 红集合={1,3,5}（行 1 结果+拉动双红），对照组 R1/R2/R3 18/18 + 全包其余 11 文件全绿（唯一红=rev2 pure）；M-C 红={行 2 拉动}（「物化只毁惰性不毁结果」双断言语义验证）；M-B={3,4,6}/M-D={3,4,5} 与矩阵精确一致；每体还原后 porcelain 复空 + sha256 逐字节等于基线（c0057141…41022），变异零泄漏 | SA7 执行（§3.3.3 双路径协议路径 P） |
| AC-R2-5 | 不回归既有测试；doc-runtime patch bump；DENY 面零改动 | ✅ | 总控亲跑终态 `pnpm typecheck && pnpm test`：61 文件 836 用例全绿 exit 0（基线 59/828 + rev2 pure 6 + H-d 2，`.mabf-bg/final-verify-rev2.log`）；package.json 仅 version 0.1.3→0.1.4（硬门禁 #9）；`git diff 7f77384..0f0b470` 恰 read.ts+package.json，index.ts/extract.ts/carrier.ts/vfsl/Phase A 零改动（SA4 §8.1 比对） | SA3 落地 + SA4 比对 + 总控亲跑 |

**结论：5/5 全部 ✅，无需追加派发。**

附：H-d 公共面负锁 `read-logical-value-at-path-rev2-inv14-negative.test-d.ts`（SA4 按设计 §4.3/§8.1 裁量落地，2 例 typecheck 绿）随收尾 commit 入库。
