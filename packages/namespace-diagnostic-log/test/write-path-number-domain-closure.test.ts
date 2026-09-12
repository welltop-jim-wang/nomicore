/**
 * Issue #319 观测闭合锁定 — 合法写路径产出的快照不再触发 changelog 数值分支降级（Issue AC3）。
 *
 * 契约来源：
 * - 任务简报 wiki/raw/task_issue-319.md（AC3）：changelog 结构性闭合锁定测试——合法写入的
 *   doc 不再触发数值分支 `capture:'unavailable'`。
 * - docs/adr/0021-vfsl-number-domain-narrowing.md 决策 7：合法写路径产出的 doc 不再可能含
 *   NaN / +Infinity / -Infinity / -0 → JCS 数值分支（`SnapshotContractViolation`）与 JSON 出口
 *   变形对合法写入**结构性不可达**（观测降级闭合）。
 * - wiki/raw/task_issue-319_sa6_contract.md §12 T2：AC3-1~AC3-5 断言规格（接缝 =
 *   `applyMutationAtBoundary.proposedBoundary`，doc-runtime 普通写实际消费的逻辑快照）。
 *
 * 断言纪律：全部经公共接缝运行时可观察输出（ValidateResult 联合 / emitter record 的
 * `input.capture` 与 digest / 健康事件），无源码 grep、无 mock、无 skip/only/todo。旧实现
 * （放行四值）在 AC3-1/AC3-3 上必红：四值写被接受 → `ok:true`，其快照送进 full 投影即
 * `capture:'unavailable'` + `input-projection-failed`。
 */
import { describe, expect, it } from 'vitest';
import {
  applyMutationAtBoundary,
  evaluate,
  parseVfsl,
  planMutationBoundary,
} from '@nomicore/vfsl';
import type { BoundaryMutationPayload, DerivedSchema, MutationBoundaryPlan, ValidateIssue } from '@nomicore/vfsl';
import { jcs, sha256Hex } from '../src/testing.js';
import { assertAttempt, baseEmission, eventsOfType, makeLog } from './helpers/base.js';

function derivedOf(text: string): DerivedSchema {
  const parsed = parseVfsl(text);
  if (!parsed.ok) throw new Error(`前置 parseVfsl 失败: ${JSON.stringify(parsed.issues)}`);
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) throw new Error(`前置 evaluate 失败: ${JSON.stringify(evaluated.issues)}`);
  return evaluated.derived;
}

/** T2 接缝：`type ROOT = { inner: { n: number } };`——写路径边界 = ['inner']。 */
const DERIVED = derivedOf('type ROOT = { inner: { n: number } };');
const BASE = { inner: { n: 0 } };

type PlanOk = { ok: true; plan: MutationBoundaryPlan };
type PlanFail = { ok: false; result: { ok: false; issues: ValidateIssue[] } };
type ApplyOk = { ok: true; proposedBoundary: unknown };
type ApplyFail = { ok: false; result: { ok: false; issues: ValidateIssue[] } };

function innerSetPlan(): MutationBoundaryPlan {
  const planned = planMutationBoundary(DERIVED, ['inner'], 'set') as PlanOk | PlanFail;
  if (!planned.ok) throw new Error(`前置 planMutationBoundary 失败：${JSON.stringify(planned.result.issues)}`);
  return planned.plan;
}

/** 经 doc-runtime 写热路径同款接缝提交整值替换 { inner: { n: <value> } }。 */
function writeInner(value: number): ApplyOk | ApplyFail {
  const payload: BoundaryMutationPayload = { op: 'set', value: { n: value } };
  return applyMutationAtBoundary(DERIVED, innerSetPlan(), BASE, payload) as never;
}

/** 收窄四值（ADR 0021 决策 1 补集）——旧实现全部 ok:true（红）。 */
const FOUR: Array<{ label: string; value: number; tail: RegExp }> = [
  { label: 'NaN', value: Number.NaN, tail: /NaN\s*[。.]?$/ },
  { label: '+Infinity', value: Number.POSITIVE_INFINITY, tail: /Infinity\s*[。.]?$/ },
  { label: '-Infinity', value: Number.NEGATIVE_INFINITY, tail: /-\s*Infinity\s*[。.]?$/ },
  { label: '-0', value: -0, tail: /-\s*0\s*[。.]?$/ },
];

/** 有限数正控（合法写入面）：全部应被写路径接受。 */
const FINITE: number[] = [0, 0.5, -1, 1e308];

/** 单次 emission → 输入投影（capture + digest + 健康事件），供闭合断言消费。 */
function project(snapshot: unknown): {
  capture: string;
  digest: string | undefined;
  value: unknown;
  projectionFailed: number;
} {
  const { log, events } = makeLog({ inputPolicy: 'full' });
  log.emitter.emit(baseEmission({ input: { snapshot } }));
  const input = assertAttempt(log.records()[0]!).input;
  const capture: string = input.capture;
  const digest = 'digest' in input ? input.digest : undefined;
  const value = 'value' in input ? input.value : undefined;
  return { capture, digest, value, projectionFailed: eventsOfType(events, 'input-projection-failed').length };
}

describe('AC3-1 写路径四值全拒（无 proposed boundary 可入观测；旧实现 ok:true，必红）', () => {
  it.each(FOUR)('$label：ok:false 恰 1 条 + path [inner,n] + 收窄消息', (spec) => {
    const applied = writeInner(spec.value);
    expect(applied.ok).toBe(false);
    if (applied.ok) throw new Error(`期望写路径拒绝 ${spec.label}，实际 ok:true`);
    expect(applied.result.issues).toHaveLength(1);
    const issue = applied.result.issues[0]!;
    expect(issue.path).toEqual(['inner', 'n']);
    expect(issue.message).toContain('期望 number（有限数且非 -0）');
    expect(issue.message.startsWith('类型不匹配：')).toBe(false);
    expect(spec.tail.test(issue.message)).toBe(true);
  });
});

describe('AC3-2 有限正控：写接受 → full 捕获 + digest = sha256(JCS(proposedBoundary)) + 零降级事件', () => {
  it.each(FINITE)('%s：capture:full 且 digest 与 JCS 一致', (value) => {
    const applied = writeInner(value);
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error(`期望写路径接受 ${value}，实际拒绝`);
    expect(applied.proposedBoundary).toEqual({ n: value });

    const projected = project(applied.proposedBoundary);
    expect(projected.capture).toBe('full');
    expect(projected.digest).toBe(sha256Hex(jcs(applied.proposedBoundary)));
    expect(projected.value).toEqual(applied.proposedBoundary);
    expect(projected.projectionFailed).toBe(0);
  });
});

describe('AC3-3 闭合不变量：写路径接受的快照 ⇒ capture !== "unavailable"（四值必须先被拒，不变量非空转）', () => {
  it('四值全拒 + 有限数全接受且 full 捕获；不存在「合法写入 ⋀ 数值分支降级」的组合', () => {
    const accepted: number[] = [];
    const rejected: number[] = [];
    for (const spec of FOUR) {
      const applied = writeInner(spec.value);
      expect(applied.ok, `${spec.label} 必须被写路径拒绝（否则闭合不变量空转）`).toBe(false);
      if (!applied.ok) rejected.push(spec.value);
    }
    expect(rejected).toHaveLength(4);
    for (const value of FINITE) {
      const applied = writeInner(value);
      expect(applied.ok, `${value} 应被写路径接受`).toBe(true);
      if (!applied.ok) continue;
      accepted.push(value);
      const projected = project(applied.proposedBoundary);
      // 闭合不变量：经写路径接受的快照绝不触发数值分支降级
      expect(projected.capture).not.toBe('unavailable');
      expect(projected.capture).toBe('full');
      expect(projected.projectionFailed).toBe(0);
    }
    expect(accepted).toHaveLength(FINITE.length);
  });
});

describe('AC3-4 机制锚（新旧同绿，解释闭合机制而非红灯）：直投 NaN 降级；-0 与 0 digest 碰撞', () => {
  it('直投 {n:NaN} → capture:unavailable + input-projection-failed（机制仍可达）', () => {
    const projected = project({ n: Number.NaN });
    expect(projected.capture).toBe('unavailable');
    expect(projected.projectionFailed).toBeGreaterThanOrEqual(1);
  });

  it('直投 {n:Infinity}/{n:-Infinity} → capture:unavailable + input-projection-failed', () => {
    for (const value of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const projected = project({ n: value });
      expect(projected.capture).toBe('unavailable');
      expect(projected.projectionFailed).toBeGreaterThanOrEqual(1);
    }
  });

  it('直投 {n:-0} 与 {n:0}：内存视图保留 -0、digest 同为 JCS "0"（RFC 8785 §3.2.2.3）', () => {
    const negative = project({ n: -0 });
    const positive = project({ n: 0 });
    expect(negative.capture).toBe('full');
    expect(positive.capture).toBe('full');
    expect(Object.is((negative.value as { n: number }).n, -0)).toBe(true); // 内存保留 -0
    expect(negative.digest).toBe(sha256Hex(jcs({ n: 0 }))); // 序列化归一
    expect(negative.digest).toBe(positive.digest); // 碰撞：SameValue 下不可区分
    expect(negative.projectionFailed).toBe(0);
  });
});
