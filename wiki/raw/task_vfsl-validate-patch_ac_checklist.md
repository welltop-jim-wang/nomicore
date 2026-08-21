# AC 逐条核对清单 — validatePatch：路径级写入校验（H2, issue #53）

核对时点：Phase 3.5（SA4 pass + SA7 pass 双清后）。核对人：总控。
证据基线：commit 0bfdaed + SA7 增量测试；全仓 510/510 绿 + tsc exit=0。

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | 接缝形状如上；同步、纯函数、不抛错 | ✅ | validate-patch.test.ts AC1 组 6 用例（公共面四导出、结果形状、JSON 往返、两次调用全等、derived/base 不被修改、异常输入返回拒绝）；SA4 对抗探针（冻结输入纯函数、NaN/Infinity/负 index）99/99；SA7 Step 1 36/36 绿 | 无需追加 |
| AC2 | 结构守卫：未知键路径 / leaf 下钻 / plain 下钻 / 越界替换 → 拒绝并带精确 path | ✅ | validate-patch.test.ts AC2 组 9 用例（ROOT 层+深层未知键、leaf/plain/xml-fragment 下钻、越界替换、plain 整体替换合法/非法，拒绝恰 1 issue、path=完整尝试路径）；SA2 R1 F1-F3 攻击点经 SA4 探针实证消除 | 无需追加 |
| AC3 | 重建语义：向 union 成员写入他成员字段 → 重建后 any-of 全拒绝（报失败距离最小成员 + 「联合成员 i/N」） | ✅ | validate-patch.test.ts AC3 组 6 用例（FIXTURE 交叉写入报「联合成员 1/3」+精确 path、双向交叉 1/2/2/2、自身字段类型错、判别式缓存透明、与 validateSnapshot 同重建值 issue 全等）；SA7 探针穿透 union 三操作「联合成员 3/3」 | 无需追加 |
| AC4 | 数组合法下标替换通过；insert（含末尾 append 语义）/ delete 的元素类型校验 | ✅ | validate-patch.test.ts AC4 组 11 用例（合法替换通过、替换/append/insert/delete 元素类型错带下标段、insert 末尾 append 位、delete 残留非法元素拒绝、越界拒绝、非数组目标拒绝） | 无需追加 |
| AC5 | 解释器单一来源：validate.ts 的 resolve 循环收敛为一份（validateSnapshot 与 validatePatch 共用） | ✅ | 设计 §4.3 walkRefChain + RefChainLens 一算法三透镜（resolveChain 委托、resolveValues 薄包装）；validate.ts 抽取 interpret() + validateSubtree 共享；SA4 §设计一致性逐条探针复证；validate-patch.test.ts AC5 等价性用例（patch 与 snapshot 同重建值 issue 逐条全等）；65 例绿基座零回归 | 无需追加 |
| AC6 | 全收集 + 上限语义与 validateSnapshot 一致 | ✅ | validate-patch.test.ts AC6 组 2 用例（多错一次报全、150 坏元素 → 100 真实 + 截断标记 = 101 条）；SA7 预算穿透（900k 键 × 120 成员联合 → 恰 1 条预算耗尽 issue，100k 对照 101 条截断不误伤） | 无需追加 |

结论：6/6 ✅，无 ❌，无需追加派发。
