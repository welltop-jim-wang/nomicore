# AC 逐条确认清单 — Issue #152 Persist and strictly read VFSL-validated JSONL and sidecars

> Phase 3.5 门禁。证据锚点：测试文件/用例名 + 验证命令（`.mabf-bg/ctl-green2.log` exit 0，18 文件 256 测试全绿，Type Errors 0）+ SA 报告章节。

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | 新 namespace stream 有不可变 manifest（冻结 VFSL 信封 + format policy）+ 原子可替换 current-stream locator | ✅ | `test/file-adapter-layout.test.ts`（17 用例）：manifest 恰 14 键逐项断言（四键信封 `=== RECORD_SCHEMA_ENVELOPE`、schemaFingerprint 钉死 `sha256:v1:dedad2ab…e070`、inline threshold/line 上限等配置冻结值）、emit 前后 manifest 字节恒等、current.json 恰三键 `ndcl-current/1` + temp+rename 无 tmp 残留、6 种敌意 namespaceId → 零文件 + `stream-init-failed` + emit 不抛、.bin 惰性创建。设计 §2.2/§2.3/§3.2（'wx' O_EXCL 创建 + 创建顺序论证） | SA6 锚定 + SA3 实现 + SA4 §一门禁复核 |
| AC2 | ≤阈值 update 存 padded standard Base64 + payloadLength + CRC32C；更大 update 用 NDCL v1 sidecar frame + 关联 JSONL 引用 | ✅ | `test/file-adapter-inline-sidecar.test.ts`（9 用例）：4096B inline 逐字段 + canonical Base64（含 padding 判定）+ CRC32C 重算一致；4097B sidecar 25-byte 帧逐字节（magic/version/type/flags/reserved/sequence BE/payloadLength BE/crc BE + CRC 输入域 header 前21B+payload）+ JSONL 引用相关性（segment/frameOffset/payloadLength/crc32c 与帧一致）；精确边界 4096↔4097 与自定义 7↔8 双向 | 同上 |
| AC3 | 最终物理 record 在 append 前过内建 VFSL schema + storage 校验；sidecar frame 先于其 JSONL 引用 append | ✅ | `test/file-adapter-mismatch-interference.test.ts`（11 用例）：VFSL 门注入 → `vfsl-validation-failed`（只带 issuePaths）+ 零落盘；storage 门四类注入（base64-invalid/base64-length-mismatch/crc-mismatch/stream-mismatch）→ `storage-validation-failed` + 零落盘；BIN-first 实证：.bin 被目录占位（EISDIR）→ emit 不抛 + 零 sidecar 引用落盘 + `storage-write-failed{stage:'bin'}`，恢复后帧/JSONL 交叉一致 reader ok。R 修复轮补 R-2a/R-2b（注入 sequence/frameOffset 前导零 → 拒绝 + 零落盘） | 同上 + SA4 R1→R2 修复闭环 |
| AC4 | strict reader 校验 JSON、VFSL、Base64、长度、CRC32C、frame 元数据、引用、offsets、格式、stream sequence；不近似解释未知版本 | ✅ | `test/file-adapter-strict-reader.test.ts`（27 用例）：incompatible 7 类（dialect/record-version/frame-version/payloadType/flags/reserved/schema 指纹不匹配 → records 置 [] + manifest 仍展示）；corrupt 15 类（坏 JSON、VFSL 败、stream-mismatch、Base64 非规范尾位/内部空白/长度不符/CRC 错、frame 缺失/偏移越界/magic 偏移/边界不连续/sequence·length·CRC 不符、reference 段不存在、sequence 乱序/重复/前导零、manifest 不可解析）；R-1a/R-1b 补 frameOffset 前导零/空串（SA4 PoC 实证修复）。SA7 D4 双版本（node 20/24）PoC 回归 ALL PASS | 同上 + SA7 D3/D4 动态实证 |
| AC5 | 公共 adapter 测试覆盖 inline/sidecar round trip、精确阈值边界、每个 result 分支、malformed 引用与帧、schema-envelope mismatch、producer 结果不受干扰 | ✅ | 6 个 `file-adapter-*.test.ts` + `file-adapter-r2-supplemental.test.ts`（共 92 用例，SA7 逐文件触发核实）：round trip（inline/sidecar 双向读回 CRC 一致）；边界（4096↔4097、7↔8）；8 result 分支逐字段（`file-adapter-genesis-results.test.ts`，rejected/fatal+false 无 update 键 + 三守卫 update-omitted）；malformed（AC4 corrupt 15 类 + R-1 两条）；envelope mismatch（指纹不匹配 → 新 generation、旧 manifest 字节恒等、旧 segments 零写入、旧 stream reader incompatible）；非干扰（合法 emit 不受注入干扰 + observer 必 throw 不外溢 + emit 返回 void 不影响 producer） | 同上 |

## 结论

AC1–AC5 全部 ✅，无 ❌ 条目。验证基线：HEAD（56ed694 + 0ec62e9 + cb44bcd + e311326）；总控亲跑 `.mabf-bg/ctl-green2.log`（exit 0，256/256）；SA7 报告 §Step 1/D3/D4 双版本动态实证；SA4 R2 静态验尸 pass。

非代码面未闭合项（不影响 AC）：CI runner 侧两 job 触发行待发布后补录（SA7 §D2 预留位，属 Host 发布阶段）。
