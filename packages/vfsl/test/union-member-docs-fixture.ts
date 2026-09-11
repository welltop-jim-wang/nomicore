/**
 * issue #306 验收契约 fixture（SA6；录制于实现前 HEAD 91c4add）。
 *
 * - SPEC_FIXTURE：docs/vfsl/v1-spec.md §10 参考 fixture 的逐字节副本（E-1 存量稳定
 *   金样本输入，含判别联合 AssetEntity 与六标记）；
 * - FIXTURE_B：联合密集 fixture（判别联合 / 嵌套联合 / Record 值位联合 / 数组 / 标记）。
 *
 * 两 fixture 均不含联合成员 doc——用于断言存量合法文本的 IR JSON、derived JSON 与
 * semantic 指纹逐字节不变（ADR 0019 决策 4/5、C-2；ADR 0007 指纹条款）。
 * 本文件只含数据，不被 vitest 收集为测试（include 仅匹配 *.test.ts）。
 */
export const SPEC_FIXTURE = [
  "/** vfs3.assets — 依据 issue #9 描述还原（原设计文档缺位） */",
  "",
  "/** 资产 ID：键约束由 Pattern 定义，禁 \".\" 与 \"|\" */",
  "type AssetId = string & Pattern<\"^[A-Za-z0-9_\\\\-]{1,64}$\">;",
  "",
  "/** 审计信息：所有写入留痕 */",
  "type Audit = YMap<{",
  "  createdBy: YLeaf<string>;",
  "  createdAt: YLeaf<number>;",
  "}>;",
  "",
  "/** 资产实体：按 kind 判别的封闭联合 */",
  "type AssetEntity =",
  "  | { kind: \"image\"; url: YLeaf<string>; width: YLeaf<number>; height: YLeaf<number>; audit: Audit }",
  "  | { kind: \"text\"; body: YXmlFragment<{ paragraphs: YArray<YLeaf<string>> }>; audit: Audit }",
  "  | { kind: \"file\"; name: YLeaf<string>; size: YLeaf<number>; tags: YArray<YLeaf<string>>; audit: Audit };",
  "",
  "/** 附件：与 Yjs 同步无关的纯值数组 */",
  "type Attachments = YPlainArray<YLeaf<string>>;",
  "",
  "/** ROOT：命名空间根文档，assets 键集受 AssetId 的 Pattern 约束 */",
  "type ROOT = YMap<{",
  "  assets: Record<AssetId, AssetEntity>;",
  "  attachments: Attachments;",
  "  audit: Audit;",
  "  /** @semantic 可选说明字段 */",
  "  notes?: YLeaf<string>;",
  "  keywords: YLeaf<string>[];",
  "}>;",
].join('\n');

/** 联合密集 fixture（无成员 doc；判别联合 U 的两个成员各含一个嵌套标量联合）。 */
export const FIXTURE_B =
  'type ROOT = { u: U; v: V };\n' +
  'type U = { kind: "a"; n: "x" | "y" } | { kind: "b"; m: "z" | "w" };\n' +
  'type V = YMap<{ deep: YArray<Record<string, "p" | "q">> }>;';
