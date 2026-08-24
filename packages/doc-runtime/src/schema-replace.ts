/**
 * @nomicore/doc-runtime — SCHEMA write 组合 seam（issue #91 设计 §4 D6/D7）：
 * `replaceSchemaAndRoot(doc, input)` —— 已编译 proposed envelope（+ 可选完整 logical
 * ROOT）的**单事务原子提交**。
 *
 * 载体（#88 设计 §5/D6 第 3 条预授权）：`replaceRootContent` 的 ⓪ 前置（未闭合外层
 * doc.transact 内调用 → DOCRT-E202）使其无法承担「SCHEMA + ROOT 同事务」需求；本 seam
 * 由包内自开 `doc.transact`，事务体内直接消费 `buildTopEntries` 产物执行「SCHEMA
 * clear+四键重写 + ROOT clear+install」——本任务正是 #88 预授权中的「届时」。
 *
 * 职责二分（沿 namespace-runtime 写槽哲学）：本 seam 拥有一切 Y.Doc 变更机械（事务、
 * clear+install、identity 保持、双探针、写后校验）；namespace-runtime 槽拥有定序、
 * gate、快照、编译路由与 active tools 生命周期。单源复用清单（ADR 演进 3「不复制
 * materialization 逻辑」落点）：`buildTopEntries`（②④⑥ 的构造同一实现）、
 * `probeRoot`、`assertOutermostTransactionContext`、`transactGuarded`、
 * `verifyInstall`、`verifySnapshotIntact`、`extractYjsSnapshot`
 * ——本 seam 不含任何第二份构造/校验规则，新增代码只有编排、SCHEMA 四键写入、⑤-S
 * （verifySchemaFourKeys）与探针（probeSchemaMap）。
 *
 * 六阶段管线（镜像 replaceRootContent 的编排纪律）：
 *   ⓪ assertOutermostTransactionContext（函数体第一句、一切 try/catch 之外）
 *   ① prepare（唯一 try/catch，崩溃边界 DOCRT-E200 模块名制；DerivedInvariantError
 *      → E204 pre-commit-internal committed:false——镜像 replace.ts prepareReplace 分支）：
 *      a. derived.structure.kind !== 'root' → DerivedInvariantError → E204
 *      b. envelope 形状守卫（own 键集恰 {lang,version,id,text} + 四值型）→ 违者
 *         ok:false 单 issue path=[]：【R1.1/A1】纵深防御定位——服务 doc-runtime 直接
 *         调用方；runtime 路径结构性不可达（namespace-runtime 槽内 assertCompiledShape
 *         强化守卫先掷 schema-compile-throw fatal，两级分类的信任边界论证见设计 D5）
 *      c. SCHEMA 载体探针 probeSchemaMap（getMap→getArray→getXmlFragment→getText
 *         四级级联，镜像 probeRoot；只触碰 'SCHEMA' 名字空间）：异型 → ok:false 单
 *         issue path=[]；缺席 → getMap 惰性创建（零 update）
 *      d. 分支 prepare：
 *         - keep-root（未提供 root）：extractYjsSnapshot(derived, doc) →
 *           validateLogicalSnapshot(derived, ex.snapshot)——issues 透传（证明逻辑值
 *           与实际载体均已兼容；ROOT 零修改）
 *         - replace-root（提供完整 logical ROOT）：原样 snapshot →
 *           validateLogicalSnapshot → buildTopEntries（detached 构造）→ probeRoot
 *           （载体判定；rev1：D7 废止，原样封闭校验）
 *   ② 单事务（transactGuarded，物理位于一切 catch 之外；observer 逃逸 → E203
 *      committed:true）：SCHEMA clear + 恰四次 set（lang/version/id/text）
 *      [+ replace-root：ROOT 原实例 clear + entries 安装]
 *   ③ ⑤-S：verifySchemaFourKeys（size===4 + 四键值与 envelope 严格同一——对称补齐
 *      ⑤ 的诚实性：observer 在事务 cleanup 派发窗口破坏 SCHEMA 四键 → E201 fatal）
 *   ④ replace-root：verifyInstall（⑤-R）+ verifySnapshotIntact（⑥，对称重物化；
 *      喂原样 snapshot——与 ①d validate/build 同一 (derived, snapshot) 输入对，
 *      scratch 确定性重放（rev1 单形态；旧论证随投影废止失效））
 *   ⑤ return { ok: true }
 *
 * E202 生产路径结构性不可达：本 seam 只被 sequencer 槽同步调用（槽是普通异步代码，
 * 外层无 doc.transact；notifyDirty 在 seam 返回后才 await）；未来误用嵌套调用 →
 * E202 裸 Error 逃逸 → 槽内按未知异常保守 committed:true fatal（过报方向强制）。
 */
import * as Y from 'yjs';
import type { DerivedSchema, SchemaEnvelope } from '@nomicore/vfsl';
import { validateLogicalSnapshot } from '@nomicore/vfsl';
import { probeRoot } from './carrier.js';
import { buildTopEntries } from './detached-build.js';
import { extractYjsSnapshot } from './extract.js';
import { DerivedInvariantError, DocRuntimeFatalError, transactGuarded } from './fatal.js';
import { verifyInstall, verifySnapshotIntact } from './install-verify.js';
import type { ReplaceIssue, ReplaceResult } from './replace.js';
import { assertOutermostTransactionContext } from './tx-guard.js';

/** SCHEMA 写槽的 ROOT 处置计划（提供性以判别式表达——不用可选字段承载，杜绝 undefined 二义）。 */
export type SchemaRootPlan =
  | { readonly kind: 'keep-root' }                                  // 未提供 root：ROOT 零修改
  | { readonly kind: 'replace-root'; readonly snapshot: unknown };  // 完整最终 logical ROOT

/** 组合 seam 输入（envelope/derived 必须来自同一 compile 产物——五件套深冻结，不可变）。 */
export interface SchemaReplaceInput {
  /** 已编译 envelope（恰四键；本 seam 自带形状守卫兜底——①b 纵深防御）。 */
  readonly envelope: SchemaEnvelope;
  /** proposed derived（提取/验证/构造/⑥ 共用）。 */
  readonly derived: DerivedSchema;
  readonly root: SchemaRootPlan;
}

/** ① 准备结局：ready（单事务所需载荷齐备）/ fail（零写入失败面）。 */
type PreparedSchemaReplace =
  | { kind: 'ready'; branch: 'keep-root'; schemaMap: Y.Map<unknown> }
  | {
      kind: 'ready';
      branch: 'replace-root';
      schemaMap: Y.Map<unknown>;
      rootMap: Y.Map<unknown>;
      entries: Array<[string, unknown]>;
      /** ⑥ 消费的原样 provided-root snapshot（与 validate/build 同一引用——rev1 单形态纪律）。 */
      snapshot: unknown;
    }
  | { kind: 'fail'; issues: ReplaceIssue[] };

/**
 * **SCHEMA write 唯一 Y.Doc 写入口（组合 seam）**：同步完结；可预期失败经返回值传递
 * （⓪/②/③/④ 的异常是唯一例外——与 replaceRootContent 同族契约）。
 *
 * @param doc 目标 Y.Doc（SCHEMA 缺席 → 探针惰性创建空 map；ROOT 按 root 计划处置）
 * @param input 已编译 envelope/derived + ROOT 处置计划
 * @returns `{ok:true}` 或 `{ok:false, issues}`（零写入失败面）
 * @throws `DOCRT-E202`（⓪ 前置语境命中，零写入）/ `DOCRT-E201`（③④ 写后偏离，已提交）/
 *   `DOCRT-E204`（① 写前 internal 不变量破坏——手造派生物，零写入）/
 *   `DOCRT-E203`（② observer 逃逸，已提交）
 */
export function replaceSchemaAndRoot(doc: Y.Doc, input: SchemaReplaceInput): ReplaceResult {
  assertOutermostTransactionContext(doc, 'replaceSchemaAndRoot'); // ⓪ 函数体第一句、一切 try/catch 之外
  const ready = prepareSchemaReplace(input, doc); // ① 唯一 try/catch 崩溃边界所在
  if (ready.kind === 'fail') return { ok: false, issues: ready.issues }; // 零写入失败面

  // ② 单事务原子提交（transactGuarded 物理位于一切 catch 之外——内部 observer/引擎
  //    异常唯一抛源 → 无条件包装 E203 committed:true）。事务体只含对已验证载荷的
  //    clear + set 循环（引擎级操作，不可能使 yjs 抛错）。
  transactGuarded(doc, () => {
    ready.schemaMap.clear(); // 【原实例】clear（SCHEMA map identity 严格保持——Y.Map 同实例）
    ready.schemaMap.set('lang', input.envelope.lang);
    ready.schemaMap.set('version', input.envelope.version);
    ready.schemaMap.set('id', input.envelope.id);
    ready.schemaMap.set('text', input.envelope.text);
    if (ready.branch === 'replace-root') {
      ready.rootMap.clear(); // 【原实例】clear（顶层 ROOT identity 保持的唯一机制性要求，D5）
      for (const [key, value] of ready.entries) ready.rootMap.set(key, value); // 安装全新 detached 实例
    }
  });

  verifySchemaFourKeys(ready.schemaMap, input.envelope); // ③ ⑤-S（SCHEMA 恰四键写后完整性）
  if (ready.branch === 'replace-root') {
    verifyInstall({ rootMap: ready.rootMap, entries: ready.entries }); // ④ ⑤-R（共享逐字）
    verifySnapshotIntact(input.derived, ready.snapshot, doc); // ④ ⑥（对称重物化——原样 snapshot）
  }
  return { ok: true }; // ⑤
}

/** ① prepare（唯一 try/catch 崩溃边界）。E204 分支镜像 replace.ts prepareReplace：
 *  DerivedInvariantError（①a 显式 sentinel / buildTopEntries 内 makeRefResolver 环/缺名
 *  sentinel / buildTopEntries 的「ROOT 结构节点非 map 形」裸 throw 不在此列）
 *  → E204 pre-commit-internal committed:false（手造派生物——合规调用者不可达）；
 *  其余一切意外异常 → E200 ok:false 单 issue（模块名制 message）。 */
function prepareSchemaReplace(input: SchemaReplaceInput, doc: Y.Doc): PreparedSchemaReplace {
  try {
    // ①a ROOT 结构合法性（手造派生物 loud 收编 → E204）
    if (input.derived.structure.kind !== 'root') {
      throw new DerivedInvariantError('derived.structure 非 root（手造派生物）');
    }
    // ①b envelope 形状守卫（纵深防御：服务 doc-runtime 直接调用方——杜绝 set undefined
    //  造成「三键 SCHEMA」走私；runtime 路径结构性不可达：namespace-runtime 槽内
    //   assertCompiledShape 先掷 schema-compile-throw fatal。两级分类的信任边界差异
    //   见设计 D5/D6 ①b）
    const guardIssue = envelopeShapeIssue(input.envelope);
    if (guardIssue !== null) return { kind: 'fail', issues: [guardIssue] };
    // ①c SCHEMA 载体探针（只读触碰 'SCHEMA'；缺席 → getMap 惰性创建空 map，零 update）
    const probe = probeSchemaMap(doc);
    if (probe.carrier !== 'Y.Map') {
      return { kind: 'fail', issues: [{
        message: `SCHEMA 载体不是 Y.Map（期望 Y.Map，实际 ${probe.carrier}）——无法执行原子 SCHEMA 替换`,
        path: [],
      }] };
    }
    const schemaMap = probe.map;
    // ①d 分支 prepare
    if (input.root.kind === 'keep-root') {
      // 严格提取并验证当前 ROOT：证明逻辑值与实际载体均已兼容（AC2）；issues 透传
      const ex = extractYjsSnapshot(input.derived, doc);
      if (!ex.ok) return { kind: 'fail', issues: ex.issues };
      const logical = validateLogicalSnapshot(input.derived, ex.snapshot);
      if (!logical.ok) return { kind: 'fail', issues: logical.issues };
      return { kind: 'ready', branch: 'keep-root', schemaMap };
    }
    // replace-root：完整最终 logical ROOT —— 原样（不投影）逻辑校验 → detached 构造
    // → ROOT 载体判定（rev1：D7 顶层声明域投影废止；validate/build/⑥ 三处同源同形态）
    const snapshot = input.root.snapshot; // 原样——调用方提供的完整 ROOT
    const logical = validateLogicalSnapshot(input.derived, snapshot);
    if (!logical.ok) return { kind: 'fail', issues: logical.issues }; // 顶层未声明键在此响亮失败
    const top = buildTopEntries(input.derived, snapshot);
    if (top.kind === 'issue') return { kind: 'fail', issues: [top.issue] };
    const rootProbe = probeRoot(doc);
    if (rootProbe.carrier !== 'Y.Map') {
      return { kind: 'fail', issues: [{
        message: `ROOT 载体不是 Y.Map（期望 Y.Map，实际 ${rootProbe.carrier}）——无法执行原子内容替换`,
        path: [],
      }] };
    }
    return {
      kind: 'ready',
      branch: 'replace-root',
      schemaMap,
      rootMap: rootProbe.map,
      entries: top.entries,
      snapshot, // 原样携带（⑥ 消费）
    };
  } catch (err) {
    if (err instanceof DerivedInvariantError) {
      // E204（pre-commit-internal, committed:false）——镜像 replace.ts prepareReplace
      // 的 DerivedInvariantError 分支（【R1.1/A4】：漏写本分支即把 internal 缺陷降级
      // 为 E200 ok:false，SA4 红线）
      throw new DocRuntimeFatalError(
        'pre-commit-internal',
        false,
        `DOCRT-E204: 写前 internal 不变量破坏（${err.message}）——合规调用者不可达` +
          `（派生物仅可由 evaluate 产出，此处为 internal 缺陷类）；本调用零写入` +
          `（doc 状态不因本调用改变）；不补偿、不 fallback`,
        { cause: err },
      );
    }
    // 对抗输入与资源极限仍留在领域结果联合（模块名制 message——D8）。
    const detail = err instanceof Error ? err.message : String(err);
    return { kind: 'fail', issues: [{
      message: `DOCRT-E200: replaceSchemaAndRoot 内部错误（意外异常）: ${detail}`, path: [],
    }] };
  }
}

/** ①b envelope 形状守卫：plain object + own 键集恰 {lang,version,id,text} + 四值型
 *  （lang/id/text string、version number）。违者 → 恰 1 issue path=[]。 */
function envelopeShapeIssue(envelope: SchemaEnvelope): ReplaceIssue | null {
  if (typeof envelope !== 'object' || envelope === null) {
    return {
      message: 'SCHEMA 信封形状违规：期望普通对象（own 键集恰 {lang, version, id, text} 且值型正确）——无法执行原子 SCHEMA 替换',
      path: [],
    };
  }
  const e = envelope as unknown as Record<string, unknown>;
  const keys = Object.keys(e);
  const keysOk = keys.length === 4
    && Object.prototype.hasOwnProperty.call(e, 'lang')
    && Object.prototype.hasOwnProperty.call(e, 'version')
    && Object.prototype.hasOwnProperty.call(e, 'id')
    && Object.prototype.hasOwnProperty.call(e, 'text');
  const valuesOk =
    typeof e.lang === 'string' && typeof e.version === 'number'
    && typeof e.id === 'string' && typeof e.text === 'string';
  if (!keysOk || !valuesOk) {
    return {
      message: 'SCHEMA 信封形状违规：own 键集与四值型必须恰为 {lang: string, version: number, id: string, text: string}——无法执行原子 SCHEMA 替换',
      path: [],
    };
  }
  return null;
}

/** ①c SCHEMA 载体探针两结局：仅 Y.Map 可继续（缺席 → 惰性创建）；异型仅报 issue 用；
 *  四级全失败 = 公共 API 造不出的第五种 SCHEMA → 抛错归 ① 崩溃边界 DOCRT-E200。 */
type SchemaMapProbe =
  | { carrier: 'Y.Map'; map: Y.Map<unknown> }
  | { carrier: 'Y.Array' | 'Y.XmlFragment' | 'Y.Text' };

function probeSchemaMap(doc: Y.Doc): SchemaMapProbe {
  try {
    return { carrier: 'Y.Map', map: doc.getMap('SCHEMA') };
  } catch { /* SCHEMA 存在且非 Y.Map */ }
  try {
    doc.getArray('SCHEMA');
    return { carrier: 'Y.Array' };
  } catch { /* 继续 */ }
  try {
    doc.getXmlFragment('SCHEMA');
    return { carrier: 'Y.XmlFragment' };
  } catch { /* 继续 */ }
  try {
    doc.getText('SCHEMA');
    return { carrier: 'Y.Text' };
  } catch { /* 不可达态 */ }
  throw new Error('SCHEMA 载体探针全失败（公共 API 造不出第五种 SCHEMA）'); // → ① 崩溃边界 E200
}

/**
 * ③ ⑤-S：SCHEMA 写后顶层完整性校验（对称补齐 ⑤ 的诚实性——事务 cleanup 派发窗口内
 * 若 observer 破坏 SCHEMA 四键，tx-guard 只守入口，此处把「恰四键」承诺机制化）。
 * 双断言缺一不可（size 相等而同一性破坏的覆盖向量与 verifyInstall 同款）；只读；
 * 任何偏离 → throw DOCRT-E201（写入已提交，不回滚、不补偿——W1 唯一相容形态）。
 */
function verifySchemaFourKeys(schemaMap: Y.Map<unknown>, envelope: SchemaEnvelope): void {
  if (schemaMap.size !== 4) {
    throw new DocRuntimeFatalError(
      'post-commit-verification',
      true,
      `DOCRT-E201: SCHEMA 顶层安装完整性偏离：期望 4 个键，事务提交后实际 ${schemaMap.size} ` +
        `个（实际键集：${JSON.stringify([...schemaMap.keys()])}）——疑似 observer ` +
        `同步重入修改 SCHEMA；写入已提交，不回滚、不补偿，doc 保持 observer 留下的实际状态`,
    );
  }
  const expected: ReadonlyArray<[string, unknown]> = [
    ['lang', envelope.lang],
    ['version', envelope.version],
    ['id', envelope.id],
    ['text', envelope.text],
  ];
  for (const [key, value] of expected) {
    if (schemaMap.get(key) !== value) {
      throw new DocRuntimeFatalError(
        'post-commit-verification',
        true,
        `DOCRT-E201: SCHEMA 顶层安装完整性偏离：键 "${key}" 的值在事务提交后与安装值不同一——` +
          `疑似 observer 覆写或删除后重插异值；写入已提交，不回滚、不补偿，doc 保持 observer 留下的实际状态`,
      );
    }
  }
}
