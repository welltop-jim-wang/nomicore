/**
 * @nomicore/doc-runtime — replaceRootContent(derived, snapshot, doc)：验证后原子替换
 * logical ROOT 内容（ADR-0008 / issue #88）。materializeRoot 的替换路径孪生（JSON→doc，
 * 写侧；保留顶层 `doc.getMap('ROOT')` identity 的原子内容替换 helper）。
 *
 * 设计：wiki/raw/task_doc-runtime-atomic-root-replace.md（Issue #88 简报）+ 设计
 * wiki/raw/task_doc-runtime-atomic-root-replace_design.md（§2 公共接缝契约 / §4 六阶段编排
 * 规格 / §6 失败面总表）。
 *
 * 职责二分（与 materializeRoot，设计 §1.3）：
 * - materializeRoot（创建路径）：目标 ROOT 必须空置——非空 → fail「不覆盖、不合并、
 *   not fallback」；只装空 ROOT 的创建语境。
 * - replaceRootContent（替换路径）：**非空/空/缺席 ROOT 均可**；单 transaction 内
 *   `clear()` + 安装已 detached 构造的内容——清空并安装任意 ROOT。
 *
 * 六阶段编排镜像（D3）：⓪ 活动 transaction 语境 guard（与 materializeRoot 共享同一实现
 * tx-guard.ts）① validateLogicalSnapshot ② detached 构造（共享 detached-build.ts 的
 * buildTopEntries——AC-1 单源，仓内不存在第二份构造规则）③ ROOT 探针 + 载体判定（唯一
 * 编排差异 = 无「ROOT 空置」判定——非空 ROOT 正是替换路径的目标语境）④ 单 transaction
 * clear + 安装（D4/D5）⑤ verifyInstall ⑥ verifySnapshotIntact（⑤⑥ 与 materializeRoot
 * 共享 install-verify.ts，E201 文案 generic 不点名，D8）。
 *
 * ⚠️ 前置条件（运行时强制，D6 裁决——最外层语境专用）：未闭合外层 `doc.transact` /
 * 事务 cleanup/observer 派发窗口 / 状态不可判定 → throw `DOCRT-E202`、本函数零写入
 * （G7 锚定，与 materializeRoot rev2/RD7-P1 同族 hard contract——两公共写入口同纪律，
 * 无特例）。嵌套调用使「单 transaction 清空并安装」可观测承诺（恰 1 次 update）与 ⑤⑥
 * 检测窗口失效；SCHEMA write 的同事务组合需求由未来包内组合 seam 自开事务满足（消费
 * buildTopEntries 产物），不通过放开嵌套调用解决（设计 §5/D6）。
 *
 * 成功语义（ok:true 的完整承诺——设计 §4.5）：
 * 1. 全部计划变更（旧键清除 + 新内容安装）已在单次 Y.transact 提交（update 计数法则
 *    §4.3：变更集非空 → 恰 1 次 update；空变更集 → 0 update——凡产生实际变更，全部变更
 *    恰好在一个 transaction 内提交）；
 * 2. 本函数返回时，`doc.getMap('ROOT')` 与调用前**严格同一实例**（D5 顶层 identity
 *    保持机制：probeRoot 只读探针 + 原实例 clear + 原实例 set——全程无 delete ROOT-map /
 *    set 异型 / 换名操作）且顶层恰为计划键集、逐键值与安装值严格同一（⑤）；旧 Yjs 子类型
 *    （旧 Y.Map/Y.Array/Y.XmlFragment 实例）随 clear 不可达、可失效（ADR-0007 不做
 *    identity-preserving diff + ADR-0008「旧子类型 identity 可失效」，不补偿不 diff）；
 * 3. extract 读回投影与同一输入经同一管线在一次性 doc 上的未修改安装读回投影语义等价
 *    （⑥ 对称重物化，XML 经 canonical 归一化——不承诺逐字相同）。
 *
 * 失败语义（设计 §4.5/§6 失败面总表）：
 * - ⓪ 前置语境命中 → throw `DOCRT-E202`、零写入（0 update + 字节不变 + 旧内容原封不动）；
 * - ① 逻辑校验失败 / ② detached 构造失败 / ③ ROOT 载体非 Y.Map → `{ok:false, issues}`
 *   + doc 零变化（issues 纪律 D9：逻辑失败 = validateLogicalSnapshot 完整 issues 引用
 *   透传；构造/载体失败 = 恰 1 issue fail-fast（path=[] 即 ROOT 自身））；
 * - ①②③ 意外异常（手造派生物 / 对抗输入 / 深栈溢出）→ `{ok:false, issues}` 单条
 *   `DOCRT-E200`（崩溃边界，D8 模块名制）；
 * - ④ 内 observer 抛错 → 原始错误原样传播（已提交，不虚假回滚，⑤⑥ 不运行——INV-5 镜像）；
 * - ⑤⑥ 偏离 → throw `DOCRT-E201`（写入已提交，不补偿、不声称回滚——committed-aware
 *   no-rollback，W1 唯一相容形态）。
 *
 * 封装（AC-2 / 设计 §3.3）：本函数同步完结，产物 entries 是函数内局部量——调用方拿不到
 * 任何 deferred / prepared mutation 句柄（ADR-0007 TOCTOU 禁令）；同参二次调用重新走完整
 * 管线、无跨调用捕获状态。detached builder / guard / verifier 三个 seam 模块不是业务公共
 * API（不经 index.ts 暴露，G6 锚公共面恰 4 值导出）。
 */
import * as Y from 'yjs';
import type { DerivedSchema } from '@nomicore/vfsl';
import { validateLogicalSnapshot } from '@nomicore/vfsl';
import { probeRoot } from './carrier.js';
import { assertOutermostTransactionContext } from './tx-guard.js';
import { buildTopEntries } from './detached-build.js';
import { verifyInstall, verifySnapshotIntact } from './install-verify.js';
import { DerivedInvariantError, DocRuntimeFatalError, transactGuarded } from './fatal.js';

/** 替换 issue：与 ValidateIssue 同形（message + path 段数组——ADR-0007 禁点号串/JSON
 * Pointer）。logical 失败时数组元素即 validateLogicalSnapshot 原生 issue（引用透传）；
 * materialization 失败恒单条（fail-fast）。 */
export interface ReplaceIssue {
  readonly message: string;
  readonly path: readonly (string | number)[]; // 段数组：map/object/Record 用 string，Y.Array 用 number；[] 即 ROOT 自身
}

export type ReplaceResult =
  | { ok: true } // 成功不携带额外载荷（exactOptionalPropertyTypes：无多余键——G6-2 toEqual 精确形状锚）
  | { ok: false; issues: ReplaceIssue[] };

type PreparedReplace =
  | { kind: 'ready'; rootMap: Y.Map<unknown>; entries: Array<[string, unknown]> }
  | { kind: 'fail'; issues: ReplaceIssue[] };

/**
 * **唯一公共替换入口（ADR-0008）**：同步、可预期失败经返回值传递（⓪/④/⑤/⑥ 的异常是
 * 唯一例外——D1/RINV-8/W1，与 materializeRoot 同族）。
 *
 * @param derived 已评估的结构树（parse+evaluate 产物，手造派生物由 ② 崩溃边界 loud 收编）
 * @param snapshot 完整 logical ROOT snapshot（unknown——由 ① 校验与 ② 构造域双面把关）
 * @param doc 目标 Y.Doc（ROOT 非空/空/缺席均可；顶层 identity 跨调用保持）
 * @returns `{ok:true}` 或 `{ok:false, issues}`（零写入失败面）
 * @throws `DOCRT-E202`（⓪ 前置语境命中，零写入）/ `DOCRT-E201`（⑤⑥ 写后偏离，已提交）/
 *   observer 原始错误（④ 内抛错，已提交）
 */
export function replaceRootContent(derived: DerivedSchema, snapshot: unknown, doc: Y.Doc): ReplaceResult {
  assertOutermostTransactionContext(doc, 'replaceRootContent'); // ⓪ 函数体第一句、prepare 之前、一切 try/catch 之外（D6/RINV-8）
  const ready = prepareReplace(derived, snapshot, doc); // ①②③ + E200 崩溃边界（唯一 try/catch 所在）
  if (ready.kind === 'fail') return { ok: false, issues: ready.issues }; // 零写入失败面（G3 双证）
  // ④ 单事务清空并安装 —— 本函数体内没有任何 try/catch（INV-5 镜像：observer/引擎异常唯一
  // 抛源 → 原样 loud 传播，⑤⑥ 不运行）。事务体只含对已验证载荷的 clear + set 循环
  // （copyJsonDomain 产物 + detached 类型均不可使 yjs 抛错；clear 为引擎级删键操作，同理）。
  transactGuarded(doc, () => {
    ready.rootMap.clear(); // 在【原实例】上删全部键（顶层 identity 保持的唯一机制性要求，D5）
    for (const [key, value] of ready.entries) ready.rootMap.set(key, value); // 安装全新 detached 实例
  });
  verifyInstall(ready); // ⑤（install-verify 共享，逐字——顶层完整性：size + 逐键同一性双断言）
  verifySnapshotIntact(derived, snapshot, doc); // ⑥（install-verify 共享，逐字——对称重物化）
  return { ok: true };
}

/** ①②③ 共享崩溃边界（D1）：任何意外异常 → DOCRT-E200 单 issue（F9 同级）。
 * 与 materializeRoot prepare 的唯一编排差异 = 无「ROOT 空置」判定（设计 §4.2）——
 * 非空 ROOT 正是替换路径的目标语境（ADR-0008 授权的职责二分）；缺席 ROOT 经探针惰性
 * 创建空 map（零 update，RA-4）→ 与空 ROOT 同为 happy path（G2）。 */
function prepareReplace(derived: DerivedSchema, snapshot: unknown, doc: Y.Doc): PreparedReplace {
  try {
    if (derived.structure.kind !== 'root') {
      throw new DerivedInvariantError('derived.structure 非 root（手造派生物）');
    }
    // ① 逻辑校验（值域宽域）：失败 → issues 引用零损透传（D9；validateLogicalSnapshot 自身
    //    不抛错，其 E100/预算截断形态原样返回——G3-1 toEqual 直调结果锚的兑现方式）
    const logical = validateLogicalSnapshot(derived, snapshot);
    if (!logical.ok) return { kind: 'fail', issues: logical.issues };

    // ② detached 构造（结构域窄域）：共享 seam（detached-build.buildTopEntries——与
    //    materializeRoot/⑥ scratch 同一实现，AC-1 单源）；失败 → 单 issue fail-fast（G3-2/G5）
    const top = buildTopEntries(derived, snapshot);
    if (top.kind === 'issue') return { kind: 'fail', issues: [top.issue] };

    // ③ ROOT 探针 + 载体判定（只读触碰 'ROOT'，INV 镜像：SCHEMA/META 零接触）：
    //    非 Y.Map → 恰 1 issue path=[]（G3-3；探针级联零写入——RA-7）
    const probe = probeRoot(doc);
    if (probe.carrier !== 'Y.Map') {
      return { kind: 'fail', issues: [{
        message: `ROOT 载体不是 Y.Map（期望 Y.Map，实际 ${probe.carrier}）——无法执行原子内容替换`,
        path: [],
      }] };
    }
    // ⚠️ 与 materializeRoot prepare 的唯一编排差异：无「ROOT 空置」判定（materialize.ts 的
    //    「目标 ROOT 非空……不覆盖、不合并、不 fallback」在替换路径不适用）——非空 ROOT 正是
    //    本接缝的目标语境（ADR-0008 授权的职责二分，设计 §1.3）。缺席 ROOT 经探针惰性创建
    //    空 map（零 update，RA-4）→ 与空 ROOT 同为 happy path（G2）。
    return { kind: 'ready', rootMap: probe.map, entries: top.entries };
  } catch (err) {
    if (err instanceof DerivedInvariantError) {
      throw new DocRuntimeFatalError(
        'pre-commit-internal',
        false,
        `DOCRT-E204: 写前 internal 不变量破坏（${err.message}）——合规调用者不可达` +
          `（派生物仅可由 evaluate 产出，此处为 internal 缺陷类）；本调用零写入` +
          `（doc 状态不因本调用改变）；不补偿、不 fallback`,
        { cause: err },
      );
    }
    // 对抗输入与资源极限仍留在领域结果联合。
    const detail = err instanceof Error ? err.message : String(err);
    return { kind: 'fail', issues: [{
      message: `DOCRT-E200: replace 内部错误（意外异常）: ${detail}`, path: [],
    }] };
  }
}
