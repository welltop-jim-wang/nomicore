/**
 * 引用 / 语义层（设计 §6）：仅当模块全量解析成功才进入。
 *
 * 五项检查全量收集、不做短路（§6.1）：
 * - E305 悬空文档注释：doc 挂靠的记号非声明性起点（M1/M2/M3 三锚位之外）→ 候选，
 *   锚注释起始（由 tokenizer 的 DocLead 自带）；严格相邻语义——不相邻即不再挂载；
 * - E302 重复声明：按名分组，每个第二次及以后的出现产出 issue（锚声明名记号）；
 * - E301 未知名引用：声明集合 = 全模块全部声明名的并集（前向引用天然合法）；
 * - E106 引用图成环：迭代三色 DFS（显式栈，别名链深度对调用栈免疫，§15.3）；
 *   遇灰点回边 → 记录候选后继续遍历（不短路），全部回边进入候选池（§6.1 /
 *   SA2 #5）；消息携带环路径（A → B → A）；
 * - E308 对象字段重名：逐 ObjectType（含嵌套、联合成员内的对象）。
 *
 * 聚合（§6.2）：candidates 按 (line, column, 错误码数值) 取最小 → 恰 1 条。
 * 位置并列在实际文法中不可构造，码号序仅为确定性兜底。candidates 为空 →
 * AST → IR（剥离 pos、坍缩单成员联合；generic-diag 不可能出现——必产 issue）。
 */
import { ErrCode, makeIssue } from './errors.js';
import type { AstAlias, AstType, Pos } from './parser.js';
import type { ParseVfslResult, VfslIssue, VfslModule, VfslType } from './ir.js';

interface Candidate {
  issue: VfslIssue;
  code: number;
}

interface RefOccurrence {
  name: string;
  pos: Pos;
}

/** 深度优先遍历 AST（E301 / E106 边收集 / generic-diag 终判 / E308 共用；
 * marker 实参穿透——其内 ref 进 E301/E106、对象进 E308，§6.1.2）。 */
function walk(t: AstType, visit: (t: AstType) => void): void {
  visit(t);
  if (t.kind === 'object') {
    for (const f of t.fields) walk(f.type, visit);
  } else if (t.kind === 'union') {
    for (const m of t.members) walk(m, visit);
  } else if (t.kind === 'marker') {
    walk(t.type, visit);
  }
}

export function analyze(aliases: AstAlias[], dangling: Array<{ line: number; column: number }>): ParseVfslResult {
  const candidates: Candidate[] = [];

  // E305：悬空文档注释（§6.1）——每条 dangling 一个候选，锚注释起始（DocLead 自带）
  for (const d of dangling) {
    candidates.push(
      candidate(
        makeIssue(
          ErrCode.E305,
          '悬空文档注释：未紧邻可挂载的声明性节点（类型别名 / 属性 / 标记类型），且不相邻即不再挂载',
          d.line,
          d.column,
        ),
        ErrCode.E305,
      ),
    );
  }

  // 声明名集合（并集；前向引用合法，规格 §4「别名解析与声明顺序无关」）
  const declared = new Set(aliases.map((a) => a.name));

  // E302：重复声明（第二次及以后的出现 → issue，锚该声明名记号）
  const seenNames = new Set<string>();
  for (const a of aliases) {
    if (seenNames.has(a.name)) {
      candidates.push(candidate(makeIssue(ErrCode.E302, `类型别名重复声明: ${a.name}`, a.namePos.line, a.namePos.column), ErrCode.E302));
    }
    seenNames.add(a.name);
  }

  // E301 / E308 / generic-diag 终判
  for (const a of aliases) {
    walk(a.type, (t) => {
      if (t.kind === 'ref') {
        if (!declared.has(t.name)) {
          candidates.push(candidate(makeIssue(ErrCode.E301, `未知名引用: ${t.name}`, t.pos.line, t.pos.column), ErrCode.E301));
        }
        return;
      }
      if (t.kind === 'generic-diag') {
        // 判定顺序第 6 条终判：未声明 → E301 锚引用记号；已声明 → E100 锚 '<'
        if (declared.has(t.name)) {
          candidates.push(candidate(makeIssue(ErrCode.E100, `已声明别名带实参使用（v1 无自定义泛型）: ${t.name}`, t.ltPos.line, t.ltPos.column), ErrCode.E100));
        } else {
          candidates.push(candidate(makeIssue(ErrCode.E301, `未知名引用: ${t.name}`, t.namePos.line, t.namePos.column), ErrCode.E301));
        }
        return;
      }
      if (t.kind === 'object') {
        // E308：逐 ObjectType 首见集合；重复字段名 → issue（锚第二个名字记号）
        const fieldSeen = new Set<string>();
        for (const f of t.fields) {
          if (fieldSeen.has(f.name)) {
            candidates.push(candidate(makeIssue(ErrCode.E308, `对象字段重名: ${f.name}`, f.namePos.line, f.namePos.column), ErrCode.E308));
          }
          fieldSeen.add(f.name);
        }
      }
    });
  }

  // E106：别名引用图成环（迭代 DFS，显式栈；回边全量收集，不短路）
  const graph = new Map<string, RefOccurrence[]>();
  for (const a of aliases) {
    const edges: RefOccurrence[] = [];
    walk(a.type, (t) => {
      // 只收集指向已声明名的引用边（未知名是 E301，无图节点）
      if (t.kind === 'ref' && declared.has(t.name)) edges.push({ name: t.name, pos: t.pos });
    });
    // §6.1：同名多声明（E302 场景）的引用边取全部声明体并集——按名累积而非
    // 后声明覆盖先声明；先声明的体在前（源序），回边全量进候选池由 min-position 裁定。
    graph.set(a.name, [...(graph.get(a.name) ?? []), ...edges]);
  }

  interface Frame {
    name: string;
    edges: RefOccurrence[];
    edgeIndex: number;
  }
  const gray = new Set<string>(); // 在显式栈上的节点（灰）
  const black = new Set<string>(); // 遍历完成（黑）
  for (const root of aliases) {
    if (black.has(root.name)) continue;
    const stack: Frame[] = [{ name: root.name, edges: graph.get(root.name) ?? [], edgeIndex: 0 }];
    gray.add(root.name);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      if (frame.edgeIndex >= frame.edges.length) {
        gray.delete(frame.name);
        black.add(frame.name);
        stack.pop();
        continue;
      }
      const ref = frame.edges[frame.edgeIndex]!;
      frame.edgeIndex += 1;
      if (gray.has(ref.name)) {
        // 回边 → 环路径（灰节点位置起经栈内链到当前节点，再经回边闭合）
        const startIdx = stack.findIndex((f) => f.name === ref.name);
        const path = [...stack.slice(startIdx).map((f) => f.name), ref.name].join(' → ');
        candidates.push(candidate(makeIssue(ErrCode.E106, `循环引用: ${path}`, ref.pos.line, ref.pos.column), ErrCode.E106));
        // 记录候选后继续遍历——全部回边进候选池参与 min-position 聚合（§6.1）
      } else if (!black.has(ref.name)) {
        gray.add(ref.name);
        stack.push({ name: ref.name, edges: graph.get(ref.name) ?? [], edgeIndex: 0 });
      }
    }
  }

  if (candidates.length === 0) {
    return { ok: true, module: toIR(aliases) };
  }
  // 聚合（§6.2）：(line, column, 错误码数值) 最小者胜出；issues 恰含 1 条
  candidates.sort(
    (x, y) => x.issue.line - y.issue.line || x.issue.column - y.issue.column || x.code - y.code,
  );
  return { ok: false, issues: [candidates[0]!.issue] };
}

function candidate(issue: VfslIssue, code: string): Candidate {
  return { issue, code: Number(code) };
}

// —— AST → IR（仅当 candidates 为空；剥离全部 pos，generic-diag 不可能出现）——

function toIR(aliases: AstAlias[]): VfslModule {
  return {
    kind: 'vfsl-module',
    aliases: aliases.map((a) => ({ kind: 'alias', name: a.name, docs: a.docs, type: toIRType(a.type) })),
  };
}

function toIRType(t: AstType): VfslType {
  switch (t.kind) {
    case 'primitive':
      return { kind: 'primitive', name: t.name };
    case 'literal':
      return { kind: 'literal', value: t.value };
    case 'ref':
      return { kind: 'ref', name: t.name };
    case 'object':
      return {
        kind: 'object',
        fields: t.fields.map((f) => ({
          kind: 'field',
          name: f.name,
          optional: f.optional,
          docs: f.docs,
          type: toIRType(f.type),
        })),
      };
    case 'union':
      return { kind: 'union', members: t.members.map(toIRType) };
    case 'marker':
      return { kind: 'marker', name: t.name, docs: t.docs, type: toIRType(t.type) };
    case 'generic-diag':
      // 不变量（§5.4）：generic-diag 必产语义相位 issue，不可能到达此处；命中即实现缺陷
      throw new Error('internal: generic-diag 必产语义相位 issue，不应到达 IR 转换');
  }
}

