# AC 逐条核对表 — task_xml-attr-quote-domain（Issue #94，Bug 修复）

核对基准：TASK.md / Issue #94 Acceptance criteria（8 条）。核对时间：2026-08-23 19:25。
流水线证据链：SA5 根因（20260823-bug-xml-attr-quote-domain.md）→ SA6 红灯契约（xml-attr-quote-domain.test.ts，26 用例）→ SA1 设计 R2 → SA2 pass → SA3 实现（commit a2e6c52）→ SA4 R2 pass（952/952+tsc 0）→ SA7 pass（963/963+tsc 0）。

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC-① | `<p title='a"b'>x</p>` 通过 logical validation 后，可由 `materializeRoot` 成功物化 | ✅ | SA6 RT-A 用例（xml-attr-quote-domain.test.ts）：前置 `validateLogicalSnapshot` ok:true → `materializeRoot` 断言 `{ok:true}` + 单事务；修复前 12 红全部命中「属性 title 值含双引号」拒绝路径（与 SA5 症状逐字一致），修复后全绿（总控亲跑 235/235 exit 0；SA4 独立复跑 952/952；SA7 Step 1 复跑 235/235） | SA3 D1 删除 xml-parse.ts:209-212 构造期拒绝块，恢复与 wellFormedXml 同域 |
| AC-② | `extractYjsSnapshot` 提取结果再次通过 `validateLogicalSnapshot` | ✅ | SA6 RT-A：materialize → `extractYjsSnapshot` → 提取结果再过 `validateLogicalSnapshot` 断言 ok:true；SA7 Step 1 全链路复跑绿；SA5 复现的对偶风险（yjs 裸 toString 产出 `<p title="a"b">` 非良构）由 D2/D3 自建序列化器消除（输出 `a&quot;b` 良构，SA1 §8 实测 #2 + SA2 独立复算 + SA4 §1.5 复验） | SA3 D2 新建 xml-serialize.ts（仅 `"`→`&quot;`）+ D3 extract.ts:138 接线 |
| AC-③ | round-trip 只要求 XML 语义等价，不要求引号风格或字符串逐字相同 | ✅ | SA6 RT-A 比较器：mini 扫描器 + canonical 归一化 + 属性值单遍实体解码（quot/apos/amp/lt/gt + 数字引用），明文禁逐字比较；设计 §5.5 表示漂移（`a"b`→`a&quot;b`）显式援引 ADR-0007「只承诺语义等价」条款，SA8 设计复审确认合规 | 测试契约即按语义等价书写；ADR-0007 同向兑付 |
| AC-④ | 单引号、双引号、空属性、两种引号交错及需要转义的属性值有表驱动覆盖 | ✅ | SA6 RT-C `it.each` 14 行表驱动：T-1~T-9（单引号外壳内 `"` 于值中段/起首/末尾/相邻/多段/含 `<>&`/双属性交错/自闭合/嵌套）+ T-10~T-14 回归锁（双引号外壳内 `'`、空属性、`&quot;` 字面量、双引号外壳内 `<>&`）；设计 §5.1 逐行过矩阵论证；SA7 补充测试 S-1~S-10b 再加 11 用例固化攻击角 | 表驱动契约已入库并全绿 |
| AC-⑤ | malformed XML 继续响亮失败，validation/construction 失败继续保持目标 doc 零写入 | ✅ | SA6 RT-D 8 行（外壳内裸同引号、未闭合值/标签、不匹配、无引号、裸 `<`、非法属性名）：validate ok:false 恰 1 issue → materializeRoot ok:false（issues 引用零损透传）+ 0 update + `encodeStateAsUpdate` 逐字节不变；设计 §5.6/§5.7 论证删除的检查位于配对引号解析成功之后、不影响任何 malformed 判定路径；SA4 §1.6 caller 三层防御 4/4 | 零写入/单事务不变式保持（ADR-0007），materialize.ts 零改动 |
| AC-⑥ | 删除或改写现有「逻辑校验成功但属性双引号构造期拒绝」的错误契约测试 | ✅ | SA6 改写 materialize-root.test.ts：C-8/X-F9 行删除（原 :839），R2 表内注释、文件头 RAC-2/RAC-3 注释、R3 组 X-F9 同锚注释同步改写为「issue #94 AC-⑥ 删除，新契约见 xml-attr-quote-domain.test.ts」；新契约由 RT-A/RT-C 承担 | 错误契约已删除并登记，无残留 |
| AC-⑦ | VFSL validator、materializer、canonical/extract 比较器对同一 XML 子集使用一致规则 | ✅ | SA6 RT-E：含 `"` 值输入 + observer 注入另一含双引号属性 → 修复后 canonical/extract 双侧可扫描且真实偏离仍被 ⑥ 检测 → throw /DOCRT-E201/（变体 C，SA7 Step 2② 逐字消息实证 + S-10a/b 断言级锁定）；D4 canonicalXmlOf 渲染加固（行为中性）；② 扫描器与 ① wellFormedXml 骨架镜像关系恢复完整（SA2 逐行比对确认） | 四规则方（①②③④）同域一致，vfsl 零改动 |
| AC-⑧ | 全量 typecheck/test 与 Node 20/24 CI 通过 | ✅（本地部分） | 本地全量（CI 同款命令）：SA4 独立复跑 `pnpm test` 66 文件/952 用例 exit 0 + `pnpm typecheck` 6 包 exit 0；SA7 复跑 67 文件/963 用例 exit 0 + typecheck exit 0；总控亲跑 doc-runtime 235/235 exit 0（.mabf-bg/sa3-verify.log）+ Phase 4 终验（见 REPORT.md）。Node 20/24 CI 属发布后阶段：分支未 push/无 PR（HG16 已核），由 issue-runner push 后执行；SA7 报告已附补采命令 | 本地完成事务不含 CI 等待；CI 到绿由 runner 接管（流水线职责边界） |

## 结论

8/8 全部 ✅（AC-⑧ 本地部分全绿，CI 部分按职责边界移交 runner，非 ❌）。无 ❌ 条目，无需追加派发。进入 Phase 4 收尾固化。
