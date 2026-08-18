#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
VFSL v1 方言规格文档 — issue #4 验收机制（SA6 红灯锚点）
========================================================
交付物契约: docs/vfsl/v1-spec.md（本检查的可执行锚点）
运行命令:  python3 tests/acceptance/vfsl_spec_acceptance.py
           （对契约示例做绿路径验证: --spec tests/acceptance/exemplar/spec-exemplar-v1.md）
退出码:    0 = 全部通过（绿）; 1 = 任一失败（红）
依赖:      纯 Python 标准库，零第三方依赖，无端口、无测试包。

设计说明（为什么这是"行为验证"而非源码 grep 伪测试）:
  issue #4 的交付物是文档，文档没有运行时——文档内容即产品本身。
  本检查对交付物做结构性解析，而非对"被测源码"做字符串形状断言:
    - EBNF 文法块: 真实 tokenize + 递归下降语法校验（括号平衡、终止符、
      符号次序），并核对生产式 LHS 与终元覆盖（AC #1 的机械化形态，
      完整推导是 issue #5 parser 的职责，不在本任务范围）；
    - fixture 文本: 词法级扫描（注释剥离、JSDoc 原文捕获、记号提取、
      相邻符号配对），核对六个标记类型、大小写契约、构造覆盖；
    - 章节/表格: 按本文件声明的机器契约（标题、列序、枚举值）校验。
  SA4 静态验尸可据此复核：本检查没有任何一处读取"被测代码"做 grep。

机器契约（SA3 撰写 docs/vfsl/v1-spec.md 时须逐条满足，SA6 已同步到简报）:
  章节（标题包含关键字）: EBNF / 禁止 / 注释 / 大小写 / 信封 / 附录
  标记章节: 标题与标记名完全相等（YMap / YArray / YPlainArray / YLeaf /
            YXmlFragment / Pattern），各含三列语义表:
            | Yjs 物化含义 | 写入粒度 | PATCH 可否下钻 |
            PATCH 列取值 ∈ {可下钻, 部分下钻, 不可下钻}
  禁止清单表: | 禁止构造 | 违反示例 | 错误类型 | 行列信息 |
            六项逐行: any / 自定义泛型 / 条件类型 / mapped type /
                      interface 继承 / 递归·循环引用；
            错误类型须为结构化错误码（VFSL- 前缀），行列信息非空
  注释规则: 含 `//`、`/* */`、`/** */` 三态，忽略 / 原文 / 捕获 / 挂载，
            挂载目标: 类型别名 / 属性 / 标记类型；@tag 不机器解析（原文保留）
  大小写契约: 六个标记的标准拼写 + 变体按未知名报错（含"未知名"字样）
  信封形状: `{ "lang": "vfsl", "version": 1, "id", "text" }`，
            只消费 text；信封解析与方言路由出范围（含"出范围"/out of scope
            与"方言路由"字样）
  方言演进: 成文"只增不改"；历史文本以自述版本为准（含"自述"字样）
  附录: 含 fixture（```vfsl 围栏块），标注"issue #9 / 还原 / 缺位"
  EBNF 生产式 LHS 必须包含: TypeAlias, ObjectType, Field, UnionType,
            ArrayType, RecordType, PatternType, Comment, Marker；
  终元: string number boolean null unknown Record Pattern；六标记标准拼写；
        "?"（可选属性）
  表格单元格内避免未转义 "|"（会被当作列分隔符）
"""

import os
import re
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DEFAULT_SPEC = os.path.join(REPO_ROOT, "docs", "vfsl", "v1-spec.md")

CANONICAL_MARKERS = ["YMap", "YArray", "YPlainArray", "YLeaf", "YXmlFragment", "Pattern"]
REQUIRED_LHS = [
    "TypeAlias", "ObjectType", "Field", "UnionType",
    "ArrayType", "RecordType", "PatternType", "LiteralType", "Comment", "Marker",
]
REQUIRED_TERMINALS = ["string", "number", "boolean", "null", "unknown", "Record", "Pattern"]

# 禁止清单六项：关键字 → 首列匹配正则
FORBIDDEN_KEYS = [
    ("any", re.compile(r"\bany\b")),
    ("自定义泛型", re.compile(r"泛型")),
    ("条件类型", re.compile(r"条件类型")),
    ("mapped type", re.compile(r"mapped|映射", re.I)),
    ("interface 继承", re.compile(r"interface|继承", re.I)),
    ("递归/循环引用", re.compile(r"递归|循环")),
]

PATCH_VALUES = re.compile(r"^(可下钻|部分下钻|不可下钻)")
LINE_COL = re.compile(r"行|列|line|column", re.I)


# ---------------------------------------------------------------- markdown 工具

def fenced_blocks(text, wanted_tag=None):
    """提取 ``` 围栏块。tag 小写化匹配。"""
    blocks = []
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        m = re.match(r"^\s*```(\S*)\s*$", lines[i])
        if m:
            tag = m.group(1).strip().lower()
            start = i
            j = i + 1
            content = []
            while j < len(lines) and not re.match(r"^\s*```\s*$", lines[j]):
                content.append(lines[j])
                j += 1
            blocks.append({"tag": tag, "content": "\n".join(content), "start": start, "end": j})
            i = j + 1
        else:
            i += 1
    if wanted_tag is not None:
        return [b for b in blocks if b["tag"] == wanted_tag]
    return blocks


def headings(text):
    out = []
    for idx, line in enumerate(text.splitlines()):
        m = re.match(r"^(#{1,6})\s+(.*?)\s*$", line)
        if m:
            t = re.sub(r"\s*\{#.*\}$", "", m.group(2)).strip()
            out.append({"level": len(m.group(1)), "text": t, "line": idx})
    return out


def sections(text, hd):
    """按标题层级切分章节：章节内容 = 标题行之后，到下一个同级或更高级标题之前。"""
    lines = text.splitlines()
    out = []
    for i, h in enumerate(hd):
        start = h["line"] + 1
        end = len(lines)
        for h2 in hd[i + 1:]:
            if h2["level"] <= h["level"]:
                end = h2["line"]
                break
        out.append({"heading": h, "lines": lines[start:end]})
    return out


def parse_table(sec_lines):
    """解析 markdown 表格为行（cells 列表），跳过 --- 分隔行。"""
    rows = []
    for ln in sec_lines:
        if ln.strip().startswith("|"):
            cells = [c.strip() for c in ln.strip().strip("|").split("|")]
            if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
                continue
            rows.append(cells)
    return rows


# ---------------------------------------------------------------- EBNF 校验

class EbnfValidator:
    """真实语法校验：tokenize + 递归下降。返回错误列表 [(行号, 消息)]。"""

    TOKEN_RE = re.compile(
        r'\s+'
        r'|\(\*.*?\*\)|/\*.*?\*/'          # 注释（先于引号尝试，但引号处的左匹配优先于内部 /）
        r'|"[^"\n]*"|\'[^\'\n]*\''          # 引号字面量
        r'|[A-Za-z_][A-Za-z0-9_]*'          # 名称
        r'|::='
        r'|[-*+?=.,;|()\[\]{}]'             # 符号
        r'|.'                               # 其余一律视为坏字符
    )

    def __init__(self, src):
        self.src = src

    def tokenize(self):
        toks = []
        for m in self.TOKEN_RE.finditer(self.src):
            s = m.group(0)
            if not s:
                continue
            if s.isspace() or s.startswith("(*") or s.startswith("/*"):
                continue
            line = self.src.count("\n", 0, m.start()) + 1
            if s.startswith('"') or s.startswith("'"):
                toks.append(("quoted", s, line))
            elif re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", s):
                toks.append(("ident", s, line))
            elif s == "::=" or (len(s) == 1 and s in "-*+?=.,;|()[]{}"):
                toks.append(("sym", s, line))
            else:
                toks.append(("bad", s, line))
        return toks

    def validate(self):
        toks = self.tokenize()
        errs = []
        i = 0
        n = len(toks)

        def peek(k=0):
            return toks[i + k] if i + k < n else None

        def advance():
            nonlocal i
            i += 1

        def err(msg, tok):
            errs.append((tok[2] if tok else (toks[-1][2] if toks else 1), msg))

        def parse_expr():
            parse_alternative()
            while True:
                t = peek()
                if t is not None and t[0] == "sym" and t[1] == "|":
                    advance()
                    parse_alternative()
                else:
                    break

        def parse_alternative():
            while True:
                t = peek()
                if t is None or (t[0] == "sym" and t[1] in ("|", ";", ".", ")", "]", "}")):
                    break
                if t[0] == "sym" and t[1] == ",":  # 连接符，跳过
                    advance()
                    continue
                parse_term()

        def parse_term():
            t = peek()
            if t is None:
                return
            if t[0] in ("ident", "quoted"):
                advance()
            elif t[0] == "sym" and t[1] in ("(", "[", "{"):
                opener = t[1]
                closer = {"(": ")", "[": "]", "{": "}"}[opener]
                advance()
                parse_expr()
                t2 = peek()
                if t2 is not None and t2[0] == "sym" and t2[1] == closer:
                    advance()
                else:
                    err(f'缺少 "{closer}"（{opener} 组不闭合）', t2 or t)
            else:
                err(f'意外的符号 "{t[1]}"', t)
                advance()
                return
            t3 = peek()
            if t3 is not None and t3[0] == "sym" and t3[1] in ("*", "+", "?"):
                advance()

        def parse_production():
            nonlocal i
            t = peek()
            if t is None:
                return False
            if t[0] != "ident":
                err(f'生产式必须以名称开头，遇到 "{t[1]}"', t)
                while True:  # 重新同步到下一个 "名称 ="
                    advance()
                    if peek() is None:
                        return False
                    t = peek()
                    if t[0] == "sym" and t[1] in (";", "."):
                        continue
                    if t[0] == "ident":
                        t2 = peek(1)
                        if t2 is not None and t2[0] == "sym" and t2[1] in ("=", "::="):
                            return True
            advance()  # 名称
            t = peek()
            if t is None:
                err("生产式缺少 \"=\" 与表达式", None)
                return False
            if not (t[0] == "sym" and t[1] in ("=", "::=")):
                err(f'缺少 "="（生产式分隔符），遇到 "{t[1]}"', t)
            else:
                advance()
            parse_expr()
            t = peek()
            if t is None:
                err("生产式缺少终止符 \";\" 或 \".\"", None)
            elif t[0] == "sym" and t[1] in (";", "."):
                advance()
            else:
                err(f'生产式缺少终止符 ";" 或 "."，遇到 "{t[1]}"', t)
            return True

        while i < n:
            if not parse_production():
                break
        return errs[:20]


def lhs_names(grammar):
    return set(
        m.group(1)
        for m in re.finditer(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:::=|=)\s*", grammar, re.M)
    )


# ---------------------------------------------------------------- fixture 词法扫描

def vfsl_tokens(text):
    """VFSL fixture 词法扫描：捕获 /** */ 原文，剥离 // 与 /* */，提取记号（含位置）。"""
    jsdocs = re.findall(r"/\*\*.*?\*/", text, re.DOTALL)
    t = re.sub(r"/\*\*.*?\*/", " ", text, flags=re.DOTALL)
    t = re.sub(r"/\*.*?\*/", " ", t, flags=re.DOTALL)
    t = re.sub(r"//[^\n]*", " ", t)
    tok_re = re.compile(
        r'[A-Za-z_$][A-Za-z0-9_$]*|"[^"\n]*"|\'[^\']*\''
        r'|::=|&&|\|\||=>|\.\.\.|[{}()\[\]<>,:;|&?=!*+\-./]'
    )
    toks = [(m.group(0), m.start(), m.end()) for m in tok_re.finditer(t)]
    return toks, jsdocs


def adjacent_pair(toks, a, b):
    for k in range(len(toks) - 1):
        if toks[k][0] == a and toks[k + 1][0] == b and toks[k][2] == toks[k + 1][1]:
            return True
    return False


def fixture_problems(content):
    toks, jsdocs = vfsl_tokens(content)
    idents = [t for t, _, _ in toks if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", t)]
    iset = set(idents)
    jsdoc_text = "\n".join(jsdocs)
    problems = []
    for m in CANONICAL_MARKERS:
        if m not in iset:
            problems.append(f"缺少标记类型 {m}（fixture 必须用到全部六种）")
    bad = sorted(t for t in iset if re.match(r"Y[A-Z]", t) and t not in set(CANONICAL_MARKERS))
    if bad:
        problems.append(f"标记大小写变体（契约: 按未知名报错）: {bad}")
    for ident in ["AssetId", "Audit", "AssetEntity", "AssetsDoc"]:
        if ident not in iset:
            problems.append(f"缺少 {ident}")
    if "vfs3" not in iset and "vfs3" not in jsdoc_text:
        problems.append("缺少 vfs3 标识（vfs3.assets 命名空间）")
    if "assets" not in iset and "assets" not in jsdoc_text:
        problems.append("缺少 assets 标识（vfs3.assets 命名空间）")
    if not adjacent_pair(toks, "?", ":"):
        problems.append("缺少 ?: 可选属性")
    if not any(t[0] == "|" for t in toks):
        problems.append("缺少 | 字面量联合")
    if not adjacent_pair(toks, "[", "]"):
        problems.append("缺少 T[] 数组后缀")
    if not any(t[0] == "&" for t in toks):
        problems.append("缺少 & 交叉类型（string & Pattern<...>）")
    if not adjacent_pair(toks, "Pattern", "<"):
        problems.append('缺少 Pattern<"正则"> 键约束')
    if not adjacent_pair(toks, "Record", "<"):
        problems.append("缺少 Record<K, V>")
    if not jsdocs:
        problems.append("缺少 /** */ JSDoc 原文")
    return problems


# ---------------------------------------------------------------- 主检查

def run_checks(spec):
    results = []
    rel = os.path.relpath(spec, REPO_ROOT)

    if not os.path.exists(spec):
        results.append(("G1", "交付物存在", False, f"规格文档缺失: {rel}"))
        for grp, name in [
            ("G2", "章节齐全"), ("G3", "EBNF 块存在"), ("G4", "EBNF 结构合法"),
            ("G5", "EBNF 生产式覆盖"), ("G6", "EBNF 语法要素覆盖"),
            ("G7", "六标记语义定义"), ("G8", "禁止清单六项"), ("G9", "禁止清单错误语义"),
            ("G10", "注释规则"), ("G11", "大小写契约"), ("G12", "信封形状"),
            ("G13", "方言演进规则"), ("G14", "附录溯源"), ("G15", "fixture 块"),
            ("G16", "fixture 构造覆盖"),
        ]:
            results.append((grp, name, False, "规格文档缺失，无法检查"))
        return results

    text = open(spec, encoding="utf-8-sig").read()
    doc_lines = text.splitlines()
    hd = headings(text)
    secs = sections(text, hd)
    join_sec = lambda s: "\n".join(s["lines"])
    find_sec = lambda pred: next((s for s in secs if pred(s["heading"]["text"])), None)

    # G1 交付物存在
    results.append(("G1", "交付物存在", len(text.strip()) > 0, f"{rel} 存在（{len(text)} 字符）"))

    # G2 章节齐全
    missing = []
    for kw in ["EBNF", "禁止", "注释", "大小写", "信封", "附录"]:
        if not any(kw in h["text"] for h in hd):
            missing.append(f"缺少含「{kw}」的章节")
    for m in CANONICAL_MARKERS:
        if not any(h["text"] == m for h in hd):
            missing.append(f"缺少标记类型章节（标题须与 {m} 完全相等）")
    results.append(("G2", "章节齐全", not missing, "；".join(missing) if missing else "必需章节齐备"))

    # G3-G6 EBNF
    ebnf_blocks = fenced_blocks(text, "ebnf")
    results.append(("G3", "EBNF 块存在", bool(ebnf_blocks),
                    "```ebnf 围栏块缺失" if not ebnf_blocks else f"{len(ebnf_blocks)} 个 ```ebnf 围栏块"))
    if ebnf_blocks:
        grammar = ebnf_blocks[0]["content"]
        g_start = ebnf_blocks[0]["start"] + 1
        errs = EbnfValidator(grammar).validate()
        if errs:
            msgs = "；".join(f"第{g_start + ln}行: {msg}" for ln, msg in errs[:5])
            results.append(("G4", "EBNF 结构合法", False, f"{len(errs)} 处语法错误: {msgs}"))
        else:
            results.append(("G4", "EBNF 结构合法", True, "文法块通过 tokenize + 递归下降校验"))
        lhs = lhs_names(grammar)
        missing_lhs = [p for p in REQUIRED_LHS if p not in lhs]
        results.append(("G5", "EBNF 生产式覆盖", not missing_lhs,
                        "缺少生产式: " + ", ".join(missing_lhs) if missing_lhs else "必需生产式齐备"))
        miss_term = []
        for t in REQUIRED_TERMINALS + CANONICAL_MARKERS:
            if not re.search(r"\b" + re.escape(t) + r"\b", grammar):
                miss_term.append(t)
        if "?" not in grammar:
            miss_term.append("?（可选属性）")
        results.append(("G6", "EBNF 语法要素覆盖", not miss_term,
                        "缺少要素: " + ", ".join(miss_term) if miss_term else "PRD 语法子集要素齐备"))
    else:
        for grp, name, detail in [
            ("G4", "EBNF 结构合法", "无 EBNF 块"), ("G5", "EBNF 生产式覆盖", "无 EBNF 块"),
            ("G6", "EBNF 语法要素覆盖", "无 EBNF 块"),
        ]:
            results.append((grp, name, False, detail))

    # G7 六标记语义定义
    for m in CANONICAL_MARKERS:
        s = find_sec(lambda t: t == m)
        if s is None:
            results.append(("G7", f"标记语义定义·{m}", False, f"缺少标题与 {m} 完全相等的章节"))
            continue
        rows = parse_table(s["lines"])
        hdr_idx = None
        for k, row in enumerate(rows):
            joined = " ".join(row)
            if "Yjs" in joined and "粒度" in joined and "PATCH" in joined:
                hdr_idx = k
                break
        if hdr_idx is None:
            results.append(("G7", f"标记语义定义·{m}", False,
                            "缺少三列语义表（| Yjs 物化含义 | 写入粒度 | PATCH 可否下钻 |）"))
            continue
        ok_rows = 0
        for row in rows[hdr_idx + 1:]:
            cells = [c for c in row if c]
            if len(cells) >= 3 and all(cells[:3]) and PATCH_VALUES.search(cells[2]):
                ok_rows += 1
        results.append(("G7", f"标记语义定义·{m}", ok_rows > 0,
                        f"{ok_rows} 行符合契约" if ok_rows else
                        "数据行未满足: 3 列非空且 PATCH 列 ∈ {可下钻, 部分下钻, 不可下钻}"))

    # G8-G9 禁止清单
    s = find_sec(lambda t: "禁止" in t)
    if s is None:
        results.append(("G8", "禁止清单六项", False, "缺少含「禁止」的章节"))
        results.append(("G9", "禁止清单错误语义", False, "缺少含「禁止」的章节"))
    else:
        rows = parse_table(s["lines"])
        matched = {}
        for row in rows:
            if not row:
                continue
            first = row[0]
            for key, pat in FORBIDDEN_KEYS:
                if key not in matched and pat.search(first):
                    matched[key] = row
        missing_keys = [k for k, _ in FORBIDDEN_KEYS if k not in matched]
        results.append(("G8", "禁止清单六项", not missing_keys,
                        "缺少条目: " + ", ".join(missing_keys) if missing_keys else "六项禁止构造逐行列出"))
        bad_rows = []
        for key, row in matched.items():
            code = row[2] if len(row) > 2 else ""
            lc = row[3] if len(row) > 3 else ""
            if not (code and code.startswith("VFSL-")):
                bad_rows.append(f"{key}: 错误类型须为结构化错误码（VFSL- 前缀），实际「{code or '空'}」")
            if not LINE_COL.search(lc):
                bad_rows.append(f"{key}: 行列信息缺失或不符合（行/列/line/column）")
        results.append(("G9", "禁止清单错误语义", not bad_rows,
                        "；".join(bad_rows) if bad_rows else "六项均含结构化错误码与行列信息"))

    # G10 注释规则
    s = find_sec(lambda t: "注释" in t)
    if s is None:
        results.append(("G10", "注释规则", False, "缺少含「注释」的章节"))
    else:
        txt = join_sec(s)
        need = ["//", "/* */", "/** */", "忽略", "原文", "捕获", "挂载",
                "类型别名", "属性", "标记", "@tag", "机器"]
        miss = [k for k in need if k not in txt]
        results.append(("G10", "注释规则", not miss,
                        "缺失要素: " + ", ".join(miss) if miss else "注释三态/捕获挂载/@tag 规则齐备"))

    # G11 大小写契约
    s = find_sec(lambda t: "大小写" in t)
    if s is None:
        results.append(("G11", "大小写契约", False, "缺少含「大小写」的章节"))
    else:
        txt = join_sec(s)
        miss = [m for m in CANONICAL_MARKERS if not re.search(r"\b" + re.escape(m) + r"\b", txt)]
        if "未知名" not in txt:
            miss.append("未知名（变体报错语义）")
        results.append(("G11", "大小写契约", not miss,
                        "缺失要素: " + ", ".join(miss) if miss else "六标记标准拼写 + 变体未知名报错"))

    # G12 信封形状
    s = find_sec(lambda t: "信封" in t)
    if s is None:
        results.append(("G12", "信封形状", False, "缺少含「信封」的章节"))
    else:
        txt = join_sec(s)
        blocks = fenced_blocks(txt)
        shape_ok = any(
            re.search(r'"lang"\s*:\s*"vfsl"', b["content"])
            and re.search(r'"version"\s*:\s*1\b', b["content"])
            and '"id"' in b["content"] and '"text"' in b["content"]
            for b in blocks
        )
        miss = []
        if not shape_ok:
            miss.append('代码块中缺 { "lang": "vfsl", "version": 1, "id", "text" } 形状')
        if "只消费" not in txt:
            miss.append("只消费")
        if "方言路由" not in txt:
            miss.append("方言路由")
        if "出范围" not in txt and not re.search(r"out\s*of\s*scope", txt, re.I):
            miss.append("出范围 / out of scope（出范围声明）")
        results.append(("G12", "信封形状", not miss,
                        "缺失要素: " + ", ".join(miss) if miss else "信封形状 + 只消费 text + 出范围声明"))

    # G13 方言演进
    miss = []
    if "只增不改" not in text:
        miss.append("只增不改")
    if "自述" not in text:
        miss.append("自述（历史文本以自述版本为准）")
    results.append(("G13", "方言演进规则", not miss,
                    "缺失要素: " + ", ".join(miss) if miss else "只增不改 + 文本自述版本"))

    # G14 附录溯源
    s = find_sec(lambda t: "附录" in t)
    if s is None:
        results.append(("G14", "附录溯源", False, "缺少含「附录」的章节"))
    else:
        txt = join_sec(s)
        miss = [k for k in ["issue #9", "还原", "缺位"] if k not in txt]
        results.append(("G14", "附录溯源", not miss,
                        "缺失要素: " + ", ".join(miss) if miss else "fixture 溯源标注（issue #9 / 还原 / 缺位）"))

    # G15-G16 fixture
    vfsl_blocks = fenced_blocks(text, "vfsl")
    if not vfsl_blocks:
        results.append(("G15", "fixture 块", False, "```vfsl 围栏块缺失"))
        results.append(("G16", "fixture 构造覆盖", False, "无 fixture"))
    else:
        in_appendix = False
        s = find_sec(lambda t: "附录" in t)
        if s is not None:
            in_appendix = any(s["heading"]["line"] <= b["start"] <= s["heading"]["line"] + len(s["lines"])
                              for b in vfsl_blocks)
        results.append(("G15", "fixture 块", in_appendix,
                        f"{len(vfsl_blocks)} 个 ```vfsl 围栏块" + ("，位于附录内" if in_appendix else "，但不在附录章节内")))
        content = "\n".join(b["content"] for b in vfsl_blocks)
        problems = fixture_problems(content)
        results.append(("G16", "fixture 构造覆盖", not problems,
                        "；".join(problems) if problems else "六标记/AssetId/Audit/AssetEntity/AssetsDoc/联合/可选/数组/Pattern/Record/JSDoc 构造齐备"))

    return results


def main():
    args = sys.argv[1:]
    spec = DEFAULT_SPEC
    if "--spec" in args:
        i = args.index("--spec")
        if i + 1 < len(args):
            spec = os.path.abspath(args[i + 1])
    results = run_checks(spec)
    for grp, name, ok, detail in results:
        print(f"[{'PASS' if ok else 'FAIL'}] {grp} {name} — {detail}")
    passed = sum(1 for _, _, ok, _ in results if ok)
    print("=" * 72)
    if passed == len(results):
        print(f"GREEN（验收通过）: {passed}/{len(results)} 项全部通过")
        return 0
    print(f"RED（验收未通过）: {passed}/{len(results)} 项通过，{len(results) - passed} 项失败")
    return 1


if __name__ == "__main__":
    sys.exit(main())
