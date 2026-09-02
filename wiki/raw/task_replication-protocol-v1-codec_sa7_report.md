# SA7 动态验证报告 — Phase 5: implement instance replication protocol v1 codec (issue #135)

- **验证对象**：`@nomicore/replication-protocol` v1 codec（commit 4feb737 + SA4 R0 回流修复 7489ca1 + SA6 A/B fixture 修复 fa53d86）
- **验证基线**：SA4 R1 pass（wiki/raw/task_replication-protocol-v1-codec_sa4_review.md，「Verdict: pass —— 同意放行，SA7 可进入动态验证」）
- **执行环境**：worktree `/home/wangjian/nomicore-fix-issue-135`，vitest v3.2.7，node v24.13.0，全部证据落盘 `.mabf-bg/sa7-*.log`（gitignored）
- **交付说明**：本报告由第四任总控在受控恢复轮补交付。前任 SA7（dispatch #20/#22）两次因宿主重启/TERM 中断，中断前证据（7489ca1 之后、工作树未变，仍有效）已全部核验保留；缺口项「Buffer 遮蔽整套件」由本总控在中心资源约束下补跑交付（见 §4）。

## 结论：**PASS（放行 AC 门禁与终审）**

全部动态验证项 EXIT=0；SA4 R1 登记的 INFO-1 行为已实测记录（非阻塞，处置建议见 §5）；D-5（Buffer 原型语义）运行时确认与设计承诺逐字一致；Buffer 遮蔽整套件 127/127 绿；codec 在 Buffer 缺席下内存有界性经独立探针裁决干净。

---

## §1 全量套件复跑（R0 §4 剩余项 a）

| 项 | 命令 | 结果 | 证据 |
|---|---|---|---|
| 包级套件 | `pnpm exec vitest run packages/replication-protocol`（含 --typecheck） | **9/9 文件 · 139/139 测试 · Type Errors 0 · EXIT=0**（5.63s） | sa7-vitest-pkg.log / .exit |
| 根 typecheck | `pnpm typecheck`（10 包 tsc 链，含新包） | **EXIT=0** | sa7-typecheck.log / .exit |
| 根全量测试 | `pnpm test`（vitest run --typecheck） | **127/127 文件 · 1544/1544 测试 · Type Errors 0 · EXIT=0**（63.43s） | sa7-root-test.log / .exit |

新包接入 CI 触发性已由 SA4 §1.4 核实（根 vitest.config.ts include 自动覆盖 + ci.yml typecheck/test 双触达）。

## §2 fuzz 确定性 ×3 + yjs 锁定组合互通

| 项 | 结果 | 证据 |
|---|---|---|
| fuzz/property 单文件 ×3 次连跑（固定种子可复现性） | 3× **5/5 EXIT=0**（168ms/次级，三次结果逐字一致） | sa7-fuzz-{1,2,3}.log / .exit |
| yjs/y-protocols/lib0 锁定组合互通（真实 yjs update/state vector/snapshot 经 codec 往返收敛） | **25/25 EXIT=0** | sa7-interop.log / .exit |

## §3 探针：D-5 Buffer 原型语义 + alloc-bound + INFO-1

### §3.1 D-5（Buffer 原型跟随/承诺边界）运行时确认 — 11 pass / 0 fail（sa7-probe-d5.log）

- **A 面（文档化行为）**：decodeFrame 的 payload 视图原型**跟随输入**——Buffer 输入 → Buffer.prototype（零拷贝 subarray，共享底层 ArrayBuffer）；plain Uint8Array 输入 → Uint8Array.prototype；Buffer subarray 视图输入 → 原型/共享语义保持。
- **B 面（§11.2 承诺边界）**：本包自产输出**恒 Uint8Array.prototype**——encodeFrame/encodeMessage 输出、decodeMessage(...).update（readVarUint8ArrayCopy 精确拷贝）、HELLO connectionNonce，即使输入是 Buffer 也不产出 Buffer。

### §3.2 alloc-bound（巨大声明短 body 不越界分配）— PASS（sa7-probe-allocbound.log）

- 帧级 200,000 次 `decodeFrame`（声明 4,294,967,280B / 实际 23B）：966.6ms，全部抛 `FRAME_LENGTH_MISMATCH`，**heapUsed Δ=+1.2MB**（有界）；
- payload 级 200,000 次 `decodeMessage`（update 声明 0xffffffffB / 无实体）：1293.3ms，全部抛 `MALFORMED_FRAME`，**heapUsed Δ=−1.0MB**（有界）。

### §3.3 INFO-1 行为实测记录（SA4 R1 顺带覆盖委托）— 按分析成立（sa7-probe-info1.log）

- JS caller 传**非数值继承键** messageType（`'toString'`/`'constructor'`）：encodeFrame **未抛**，落字节 type=0x00（NaN→0），产出帧在 decode 边界**仍必拒**（`UNSUPPORTED_MESSAGE_TYPE`）——失败 loud，无静默接受；
- 对照组：非继承键字符串 `'bogus'` 与未注册数值 `0` 在 encode 侧即抛 `UNSUPPORTED_MESSAGE_TYPE`；
- 结论与 SA4 R1 登记一致：TS 类型面不可达、非 wire 攻击面、decode 边界必拒，**非阻塞纵深项**。

## §4 任务4：Buffer 遮蔽整套件（本恢复轮补交付）— **PASS**

**目的**（AC5）：`globalThis.Buffer` 置 undefined 下跑整套件，验证 codec 无 Buffer 依赖。

### §4.1 最终结果

```
config:  .mabf-bg/sa7-shadow.config.ts（include 包级 *.test.ts，排除 codec-package-contract.test.ts
         —— 其 :77「环境恢复」断言与预置遮蔽基线冲突；该文件 :52-78 自带就地遮蔽用例，
         常态运行 5/5 绿，遮蔽语义已由 §4.3 探针补强）
pool:    --pool=threads --poolOptions.threads.singleThread（单 worker 顺序执行）
资源:    NODE_OPTIONS=--max-old-space-size=2048，--testTimeout=60000 --hookTimeout=60000
```

**7/7 文件 · 127/127 测试 · 451ms · EXIT=0**（sa7-shadow-suite6.log / .exit）：
codec-fuzz-property 5、codec-roundtrip-truncation 8、codec-messages-golden 26、codec-version-interop 25、
codec-registries 13、codec-malformed 37、codec-envelope 13——含 fuzz 全循环、每 offset 截断、golden 变异等
全部高频掷错路径，遮蔽下逐一通过。

### §4.2 过程排障与裁决（ forks pool OOM 归属）

- 前任 4 次 forks pool 尝试（sa7-shadow-suite{,2,3,4}.log）均中断；本轮复现：Buffer 遮蔽下 vitest **forks** worker
  对任意测试文件呈堆线性增长（~17MB/s），117s 触 2GiB 顶 OOM（fuzz/截断/golden 三文件同现，sa7-shadow-suite5、
  sa7-shadow-nofuzz、sa7-shadow-light.log）。
- **归属裁决探针**（sa7-shadow-node-probe.ts，plain node+tsx、无 vitest；先加载后遮蔽，逐字复刻 fuzz 三组循环
  同种子同迭代 + golden 单字节变异）：**800+800 轮 decode Δ=0.0MB、300 轮 roundtrip Δ=0.2MB、1220 变异 Δ=0.0MB，
  全部分类/canonical 断言通过，verdict PASS，EXIT=0**（sa7-shadow-node-probe.log）。
  → codec 运行时在 Buffer 缺席下**无泄漏、无 Buffer 依赖**；forks 池 OOM 属 vitest/tinypool forks IPC 管线对
  Buffer 缺席的病态反应（基础设施假象），**非产品缺陷**。threads 池无此病态（§4.1 实证）。
- 单 worker/顺序语义保持：threads singleThread 全程单线程顺序执行；heap≤2GiB 与显式 timeout 约束全程满足。

### §4.3 tsx 直跑探针的教训记录

sa7-probe-shadow.log：tsx loader 自身在 source-map 内联中使用 `Buffer.from`，遮蔽**先于加载**会崩 loader
（`TypeError: Cannot read properties of undefined (reading 'from')`）——工具链限制，非 codec 行为；
probe1 采用「先加载后遮蔽」规避，与 codec-package-contract.test.ts 就地遮蔽语义一致。

## §5 登记事项汇总

| 编号 | 级别 | 状态 | 处置 |
|---|---|---|---|
| INFO-1（encodeFrame 非数值 messageType 继承键 → type=0x00 帧） | INFO（SA4 R1 登记） | 行为实测与登记分析一致（§3.3） | **不阻塞**；建议后续切片顺手加 `typeof messageType === 'number'` 守卫或 hasOwn 对称化（纯纵深，decode 边界已必拒） |
| D-5（payload 原型跟随输入） | 设计文档化行为 | 运行时 11/11 确认（§3.1） | 无需处置，文档与实现一致 |
| forks pool + Buffer 遮蔽 OOM | 基础设施假象 | 已裁决非产品缺陷（§4.2） | 后续遮蔽类验证统一用 `--pool=threads --poolOptions.threads.singleThread` |

## §6 验收条件映射（issue AC → 动态证据）

| AC | 动态验证证据 |
|---|---|
| AC1（20-byte BE NMCR envelope，一 message 一 frame） | 包级 139/139（envelope 13 项逐 offset + trailing）· 遮蔽套件 127/127 |
| AC2（严格检查顺序/完全消费/限额） | malformed 37、truncation 8（每 offset）、alloc-bound 200k×2 有界 |
| AC3（17 种 payload golden/字段顺序/消息码） | messages-golden 26（18 golden 逐字节）+ roundtrip canonical |
| AC4（错误注册表 scope/fatal/retryable/terminal 推导） | registries 13 + malformed 注册表 bits 一致性用例 |
| AC5（依赖锁定、无 Buffer/server 依赖） | package-contract 5/5（常态）+ **遮蔽整套件 127/127** + 探针内存有界裁决 |
| AC6（golden/roundtrip/截断/版本矩阵/fuzz） | 全部上述 + fuzz×3 确定性 + 版本协商全矩阵 + yjs 互通 25/25 |

**SA7 verdict：PASS —— 可进入 AC 门禁与双轴终审。**
