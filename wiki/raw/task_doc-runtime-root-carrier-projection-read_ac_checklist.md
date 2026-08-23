# AC 逐条确认 — doc-runtime：schema-independent ROOT 载体投影读取 (issue #86)

- **核对时间**: 2026-08-23 21:00
- **核对基准**: HEAD commit 4014a8d；SA6 冻结契约 37 例（read-logical-value-at-path-schema-independent.test.ts 33 行为例 + .test-d.ts 4 类型例）；guards 39 例；SA4 R3 verdict=pass；SA7 verdict=pass；总控亲验全量 typecheck+test 三轮全绿（914/917/919）。

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | `readLogicalValueAtPath` 不再接收 derived schema，空 path 深拷贝完整 ROOT，非空 path 只转换目标子树 | ✅ | 实现 read.ts 双参签名 `readLogicalValueAtPath(doc, path)`（vfsl import 清零，SA4 R1 §1.6 契约连锁核验：生产 caller 实测为零，残留三参即 TS2554 硬红）；冻结行为例 AC1 组 5 例（空 path 全量深拷贝/非空 path 定点转换）+ 类型例 4 例（双参签名/三参 @ts-expect-error）全绿；SA7 §2 三件套 76 例 exit 0 | 无需追加 |
| AC2 | Y.Map/plain object 用 string segment，Y.Array/plain array 用严格非负整数 segment；任一合法容器缺失均成功返回 `undefined` | ✅ | 冻结 AC2 组 7 例（段型纪律/缺键吸收/数组越界吸收）；guards 移植锚：-0 归一、2^53 越界吸收、NaN/±∞ 段 it.each、野段族；设计 D3/D4（缺席非对称：map/object 键位 undefined 吸收、数组在界 undefined 响亮）经 SA2 R1-R3 + SA4 R1 逐行核验 | 无需追加 |
| AC3 | plain object 仅读 own enumerable data property，不走原型链、不执行 accessor | ✅ | 冻结 AC3 组 5 例（accessor 零执行副作用计数器实证、原型链不参与、non-enumerable 不参与）；实现 D5 descriptor 键空间助手（导航≡投影同键空间，SA4 R3 核销）；isPlainRecord 偏离经 SA4 R1 验证「必要且安全」、SA1 R5 正式回收为设计判据 | 无需追加 |
| AC4 | plain subtree 只接受 JSON-compatible plain value，嵌套 Yjs shared type 响亮失败 | ✅ | 冻结 AC4 组 6 例（嵌套 Yjs/bigint/non-finite/数组内 undefined → ok:false 响亮）；实现 copyPlainStrict 逐字执行 + detached 前置守卫（`v.doc===null`，SA2 R1 实测证伪 A2 后立法 INV-R13）；guards detached 三形态锚 + 循环引用 E100 锚全绿 | 无需追加 |
| AC5 | Y.XmlFragment 是返回语义字符串的不可下钻终态；未知 Yjs shared type 不使用通用 fallback | ✅ | 冻结 AC5 组 6 例（XmlFragment/XmlElement → 语义字符串、不可下钻；Y.Text/Y.XmlText → ok:false 无 toJSON fallback）；实现 D2 分类器词汇表外类型一律响亮（SA2/SA4 探针复核 `toString()` 语义串 `<p>Hello <b>world</b></p>`） | 无需追加 |
| AC6 | 所有预期 path/载体失败返回同步结果联合，返回值不含 live 引用且不做运行时 freeze | ✅ | 冻结 AC6 组 4 例 + 类型例结果联合判别；实现结果联合 `{ok:true;value}|{ok:false;code:'PATH_NOT_ALLOWED';path;message?}` 逐字保留，defineProperty 四真写入深拷贝（SA2 R3 交接四机制 SA4 R3 全部核销）；SA7 INFO 探针实证返回值递归 instanceof 扫描 liveRef=false、可变不冻结；F1/R2-F1a 三轮加固后错误通道全链异常安全（五向量探针零外抛） | 无需追加 |
| AC7 | 调整调用面与行为测试，并通过全量 typecheck/test 和 Node 20/24 CI | ✅（本地部分全绿；CI 段属 runner 职责） | 调用面：生产 caller 零（SA1 caller 审计 + SA4 §1.6 复核）；行为测试：7 个旧三参测试删除 + guards 39 例移植 + 冻结 37 例新增；全量 typecheck/test：总控亲验三轮（914/917/919 例，exit 0）+ SA4/SA7 独立复跑一致；ci.yml node 20/24 矩阵静态核验在位（SA4 §1.4 all-vitest-packages-triggered / SA7 §2.5）。**Node 20/24 CI 动态 run 证据 = environment-blocked**：push/PR/CI 跟踪依硬门禁 #16 与职责边界归 issue-runner check.sh/ciwatch，不属于本地 MABF 完成门槛；SA7 §2.5 已留补录命令 | CI 段移交 issue-runner（check.sh 推送建 PR 后 ciwatch 跟踪；失败走 CI 修复轮） |

## 结论

7 条 AC 全部 ✅（AC7 的 CI 动态证据段按流水线职责边界移交 issue-runner，本地可闭合部分全部全绿）。无 ❌ 条目，无需追加 SA 派发。进入 Phase 4 收尾固化。
