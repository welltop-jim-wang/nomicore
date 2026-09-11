/**
 * issue #308 验收契约 fixture（SA6 §12.1/§12.3/§12.4 逐字节转写）。
 *
 * 供两个新增测试文件共用（红契约 `resolve-schema-at-path-member-docs.test.ts` 与
 * 负控 `resolve-schema-at-path-member-docs-control.test.ts`）：
 *
 * - `M4_TEXT`：M4（联合成员 doc）夹具文本，逐字节 = SA6 §12.1（不得改动）；
 * - `EXPECTED_DOCS`：读 `[]` 时的目标 docs 切片 23 键（SA6 §12.3 逐字快照）；
 * - `M4_CONTRACT_PATHS`：16 条契约读路径全集（SA6 §12.2/§12.4 全集）；
 * - `*_DIGESTS`：实现前 HEAD `4d4208b` 录制的 `sha256(JSON.stringify(...))` 冻结摘要
 *   （SA6 §12.4 表 1/表 2/表 3 的逐路径转写）——负控逐字节对账，红契约不依赖。
 *
 * 本文件只含数据（非 `.test.ts`，不被 vitest 收集；由包 tsconfig 的 test glob 覆盖
 * 类型检查）。期望值全部是运行时求值输出的字面量快照，测试不读生产实现源码。
 */

/**
 * M4 夹具文本（SA6 §12.1 逐字节；`join('\n')` 后即探针使用的文本）。
 *
 * 覆盖位：别名枚举（Status）/ 别名联合（U）/ 标记成员联合（Mixed，marker 与 member
 * 同键双非空）/ 数组元素别名枚举（Choice）/ 内联联合（ROOT.pair）/ 内联枚举
 * （ROOT.mode）/ 数组内联枚举（ROOT.inlineItems）/ Record 值位内联枚举
 * （ROOT.recInline）/ 别名内联联合（Inl）/ 别名内联枚举（InlEnum）/ 别名数组内联枚举
 * （InlItem）/ 别名 Record 内联枚举（InlRec）。
 */
export const M4_TEXT = [
  'type ROOT = YMap<{',
  '  s: Status;',
  '  u: U;',
  '  m: Mixed;',
  '  items: YArray<Choice>;',
  '  pair: /** 内联甲 */ { kind: "a"; n: YLeaf<string> } /** 内联乙 */ | { kind: "b"; m: YLeaf<number> };',
  '  mode: /** 开 */ "on" /** 关 */ | "off";',
  '  inlineItems: YArray</** 元素甲 */ "p" /** 元素乙 */ | "q">;',
  '  recInline: Record<string, /** 记录甲 */ "x" /** 记录乙 */ | "y">;',
  '  inl: Inl;',
  '  inlEnum: InlEnum;',
  '  inlItems: InlItem;',
  '  inlRec: InlRec;',
  '}>;',
  '/** 订单生命周期状态 */',
  'type Status =',
  '  /** 草稿：可继续编辑 */',
  '  | "draft"',
  '  /** 已提交：只可追加备注 */',
  '  | "submitted"',
  '  | "archived";',
  'type U =',
  '  /** 变体甲 */',
  '  | { kind: "a"; x: YLeaf<string> }',
  '  /** 变体乙 */',
  '  | { kind: "b"; y: YLeaf<number> };',
  'type Mixed = /** 成员甲 */ | /** 载体甲 */ YLeaf<string> | YLeaf<number>;',
  'type Choice =',
  '  /** 选项甲 */',
  '  | "p"',
  '  /** 选项乙 */',
  '  | "q";',
  'type Inl = /** 别名内联甲 */ { kind: "a"; n: YLeaf<string> } /** 别名内联乙 */ | { kind: "b"; m: YLeaf<number> };',
  'type InlEnum = /** 别名开 */ "on" /** 别名关 */ | "off";',
  'type InlItem = YArray</** 别名元素甲 */ "p" /** 别名元素乙 */ | "q">;',
  'type InlRec = Record<string, /** 别名记录甲 */ "x" /** 别名记录乙 */ | "y">;',
].join('\n');

/** M4 夹具目标 memberDocs 键数（SA6 §5/§12.2 前提：23 键）。 */
export const M4_MEMBER_DOCS_KEY_COUNT = 23;

/** 读 `[]` 的目标 `docs` 切片（SA6 §12.3 逐字；键序不锁，`toEqual` 键序不敏感）。 */
export const EXPECTED_DOCS: Record<string, readonly string[]> = {
  'ROOT.pair.<member 0>': [' 内联甲 '],
  'ROOT.pair.<member 1>': [' 内联乙 '],
  'ROOT.mode.<member 0>': [' 开 '],
  'ROOT.mode.<member 1>': [' 关 '],
  'ROOT.inlineItems.<item>.<member 0>': [' 元素甲 '],
  'ROOT.inlineItems.<item>.<member 1>': [' 元素乙 '],
  'ROOT.recInline.<key>.<member 0>': [' 记录甲 '],
  'ROOT.recInline.<key>.<member 1>': [' 记录乙 '],
  'Status.<member 0>': [' 草稿：可继续编辑 '],
  'Status.<member 1>': [' 已提交：只可追加备注 '],
  'U.<member 0>': [' 变体甲 '],
  'U.<member 1>': [' 变体乙 '],
  'Mixed.<member 0>': [' 载体甲 ', ' 成员甲 '],
  'Choice.<member 0>': [' 选项甲 '],
  'Choice.<member 1>': [' 选项乙 '],
  'Inl.<member 0>': [' 别名内联甲 '],
  'Inl.<member 1>': [' 别名内联乙 '],
  'InlEnum.<member 0>': [' 别名开 '],
  'InlEnum.<member 1>': [' 别名关 '],
  'InlItem.<item>.<member 0>': [' 别名元素甲 '],
  'InlItem.<item>.<member 1>': [' 别名元素乙 '],
  'InlRec.<key>.<member 0>': [' 别名记录甲 '],
  'InlRec.<key>.<member 1>': [' 别名记录乙 '],
};

/** `[]` 读的别名闭包名（SA6 §12.2 M8b：顺序与旧实现一致）。 */
export const M4_ROOT_ALIAS_ORDER = ['Status', 'U', 'Mixed', 'Choice', 'Inl', 'InlEnum', 'InlItem', 'InlRec'];

/** `[]` 读的 aliasDocs（SA6 §12.2 M8b）。 */
export const M4_ROOT_ALIAS_DOCS: Record<string, readonly string[]> = {
  Status: [' 订单生命周期状态 '],
};

/** 契约读路径全集（SA6 §12.2 16 条；`['u','x']` 为不冻结观察路径，不在本集）。 */
export const M4_CONTRACT_PATHS: ReadonlyArray<readonly (string | number)[]> = [
  [],
  ['s'],
  ['u'],
  ['m'],
  ['items'],
  ['items', 0],
  ['pair'],
  ['mode'],
  ['inlineItems'],
  ['inlineItems', 0],
  ['recInline', 'k1'],
  ['inl'],
  ['inlEnum'],
  ['inlItems'],
  ['inlItems', 0],
  ['inlRec', 'k1'],
];

/** 冻结摘要用例（`sha256(JSON.stringify(resolveSchemaAtPath(derived, path)))`）。 */
export interface ProjectionDigestCase {
  readonly path: readonly (string | number)[];
  readonly sha256: string;
}

/** C1 — `FIXTURE_TEXT` 6 条读路径整投影逐字节摘要（SA6 §12.4 表 1 上半）。 */
export const FIXTURE_TEXT_PROJECTION_DIGESTS: readonly ProjectionDigestCase[] = [
  { path: [], sha256: '5c2eb58e98e87b3f1ce1624ee8a8d5c13830299d4d3684b9d07f32c8f0d234ce' },
  { path: ['notes'], sha256: 'fd64ebfcd5191e1238a0ad1cf8cdfc0da8cfb9ffd220c541cca75515f38f0330' },
  { path: ['audit'], sha256: '0522bec4126c4361a2f6058d0b175b81d3e7855f6958e79114fdcf1915c630dd' },
  { path: ['assets', 'img1'], sha256: '1fdd6ec9abc63cf7887aca8cc53269f35834eed92bad1149ab97a3afd5670c4d' },
  { path: ['u', 'x'], sha256: '2b26ffb93924762a88a2a015c27c38f299f50f2bc3e4739efa7e7f94d2886af3' },
  { path: ['attachments'], sha256: '88b6c9c4604c6de95db49906ac45c11e9830a7376895d7400a0b67dc5df9cf8f' },
];

/** C2 — `SPEC_FIXTURE` 4 条读路径整投影逐字节摘要（SA6 §12.4 表 1 中段）。 */
export const SPEC_FIXTURE_PROJECTION_DIGESTS: readonly ProjectionDigestCase[] = [
  { path: [], sha256: 'e5108899fa5446198e797c2208297622630accdb7754cc15c056375cce0ef7c1' },
  { path: ['assets', 'a1'], sha256: 'ac094f7dc346b584dbfebf5e016ab6e26b1067a2e5cf0cb44c4c4105388e140e' },
  { path: ['attachments'], sha256: '07874c397c0a2f99b66cd09ce3306efd4f195e5f6d85fd9a8f49062852ffcc71' },
  { path: ['notes'], sha256: '22146f45aaf66c5b663987720b9066f2b522dff974be3b6b2269a3541c2636df' },
];

/** C2 — `FIXTURE_B` 3 条读路径整投影逐字节摘要（SA6 §12.4 表 1 下半）。 */
export const FIXTURE_B_PROJECTION_DIGESTS: readonly ProjectionDigestCase[] = [
  { path: [], sha256: '2b8405a618f1f340e9ea35252018f9aba3530cf24796892338a4fbe406f9823f' },
  { path: ['u'], sha256: '286a8e77aec177e798df972c748a63dd53d7599c54f66c011dfc7c2274a1e8b7' },
  { path: ['v', 'deep', 0, 'k'], sha256: 'f2f7325afdcc2d5c7156e5db5142dd382a2d558f30c8639dbf1b75a638f1862f' },
];

/** C3 — `M4_TEXT` 派生物剥离 `memberDocs` 键后的 17 条读路径整投影摘要（SA6 §12.4 表 2）。 */
export const M4_STRIPPED_PROJECTION_DIGESTS: readonly ProjectionDigestCase[] = [
  { path: [], sha256: 'e420517ef5ae0b9af486042c35a71f3d4b894d280613eaf08633084e3484f1f4' },
  { path: ['s'], sha256: '1a9a6ca740ed6e1a8a645a79b00bdb51fb6c7bbfa2bf7350d20a8c6d50ab17e5' },
  { path: ['u'], sha256: 'aa281a1148a71a5838318e3ebeb5d229facd1612f51bc1dfa05610c11de6d216' },
  { path: ['m'], sha256: 'd171a634ca297d854aaf752a6caee4bb891e8965c6b568912434cd6dc5a2ed89' },
  { path: ['items'], sha256: 'dd0bcb0b8b6ae0f9bdc9d28daae855a27bd1b0cc430e7b6df3d3eb57e038f854' },
  { path: ['items', 0], sha256: '767f4b5a201004bd8196b64dcbaca2af45b459a8cbaeb857d08e71006feff628' },
  { path: ['pair'], sha256: '6189ad7dba5deb39848374bfbcfee39c9bebe4c214fc0e3a96b02f3e5d0fe32f' },
  { path: ['mode'], sha256: 'a7ceb3f785274e34e1844485fd4686963066070caa2b057c00bb1d7358c461d5' },
  { path: ['inlineItems'], sha256: 'f74887240cbffa3cd51b2747469a996c484772ce804cfa87b283b992b1823650' },
  { path: ['inlineItems', 0], sha256: 'f2f7325afdcc2d5c7156e5db5142dd382a2d558f30c8639dbf1b75a638f1862f' },
  { path: ['recInline', 'k1'], sha256: '979d2201ed0a05d62d5a17c6fb17d2b168f4abb52061a956fc0ae947f948322c' },
  { path: ['inl'], sha256: 'f8b1d570eeaf25754b050c8de71441d186c6651081487b37c8b9c9b23377c467' },
  { path: ['inlEnum'], sha256: '971d4745b481ad80a3212c55cef6303c42aa3ec76f2365a22c41ed0da645660e' },
  { path: ['inlItems'], sha256: '7254649d1004a44ccf7c8432b1dbe45e1341509208973ebcf83f4656050b88f4' },
  { path: ['inlItems', 0], sha256: 'f2f7325afdcc2d5c7156e5db5142dd382a2d558f30c8639dbf1b75a638f1862f' },
  { path: ['inlRec', 'k1'], sha256: '979d2201ed0a05d62d5a17c6fb17d2b168f4abb52061a956fc0ae947f948322c' },
  { path: ['u', 'x'], sha256: '2417f648bb65657d8840508d9db806185ffdde7357756a1919b55a618e5ece37' },
];

/**
 * C8 — `M4_TEXT` 非 docs 部分摘要：`sha256(JSON.stringify({valueSchema, aliases, aliasDocs}))`
 * 的 16 条契约路径（SA6 §12.4 表 3）。
 */
export const M4_NONDOCS_DIGESTS: readonly ProjectionDigestCase[] = [
  { path: [], sha256: '99e628e255972871d56a122a53f10466f1c8d9fcda008bd3793099649f2d80e9' },
  { path: ['s'], sha256: 'c4bc5d4011e9a0bf1ff7f6d3ca0d820800fb7ba3fc1970d45e88b2543289eacf' },
  { path: ['u'], sha256: '3f7ad22db59f4a1972552ca242d4df511261f0ab27435628ac48df25766db080' },
  { path: ['m'], sha256: '9438f9a2693accb75bd494677d199fdab55037b0762d1889bb82806b70157f68' },
  { path: ['items'], sha256: 'ebae36038e80e96f0e0695bb813e3e32717f658061a28211114965300d411519' },
  { path: ['items', 0], sha256: 'df8347bb75a19700ea793d2f043de3ccf01093cf15a913046d083a76e6ccaeb4' },
  { path: ['pair'], sha256: 'c0acd96799a91f75f4f14e4ca9b0d01a876875c21e8cb008e34c3f3426db4dc9' },
  { path: ['mode'], sha256: '169dad66cccbcd8338a23ad7ba25433430e350e28a8d665d18de01fcf36f083f' },
  { path: ['inlineItems'], sha256: '452695fab6a275c92c3739c8eff9f39cd6420e9c467d031a64b1a1f2ca36f1b8' },
  { path: ['inlineItems', 0], sha256: 'e0b219dfad8d943176866e653b01604a789d5be8b2b4a416be05161bd2ed7160' },
  { path: ['recInline', 'k1'], sha256: 'beede5499397c854e680e37087e32c3315660dd2b442aad22d02f534ce2a3a5e' },
  { path: ['inl'], sha256: '9bad89f317327d6d5bbede1c4020ea2af55146d9c5b457ba846314b43d1c09de' },
  { path: ['inlEnum'], sha256: 'cff9579ee2732c39c3eb4d368059957ad1aee1e4aaf4a3947a445e97cd402a8f' },
  { path: ['inlItems'], sha256: 'cbef1b06a4fe23ef2561971a00eea0515968aa246f53123bbe3f6fc435c80f60' },
  { path: ['inlItems', 0], sha256: 'e0b219dfad8d943176866e653b01604a789d5be8b2b4a416be05161bd2ed7160' },
  { path: ['inlRec', 'k1'], sha256: 'beede5499397c854e680e37087e32c3315660dd2b442aad22d02f534ce2a3a5e' },
];

/** C5 手造未选中成员 doc（不得泄漏进任何契约路径的切片）。 */
export const UNRELATED_MEMBER_DOC_KEY = 'Unrelated.<member 0>';
/** C5 手造未选中成员 doc 内容（契约路径集内不得出现）。 */
export const UNRELATED_MEMBER_DOC_TEXT = ' 不应出现 ';
