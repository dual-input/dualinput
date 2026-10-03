/*
 * The part of the sim's reverse Polish notation that a model's animation and
 * visibility code uses, run against variable values we read, so a probe can
 * pose a model the way the aircraft's behavior XML would.
 *
 *   const code = compile("(A:YOKE Y POSITION WITH AP, Percent) (L:bksq_controlLocks, bool) if{ -1 max 1 min } 2 / 50 +")
 *   code.vars    [{ kind: "A", name: "YOKE Y POSITION WITH AP", unit: "percent" }, ...]
 *   code.run((v) => value of v)    the number left on the stack
 *
 * It covers numbers, (A:...) and (L:...) reads, arithmetic, comparisons, the
 * logic and stack words below, and if{ } els{ }. Anything else throws when the
 * code is compiled, so a probe reports code it can't run instead of posing a
 * model wrongly. Writes, (>L:...), throw too: animation code shouldn't have them.
 */

const BINARY = {
  "+": (a, b) => a + b, "-": (a, b) => a - b, "*": (a, b) => a * b, "/": (a, b) => a / b, "%": (a, b) => a % b,
  max: Math.max, min: Math.min, pow: (a, b) => a ** b, atg2: Math.atan2,
  "==": (a, b) => +(a === b), "!=": (a, b) => +(a !== b), "<": (a, b) => +(a < b), ">": (a, b) => +(a > b), "<=": (a, b) => +(a <= b), ">=": (a, b) => +(a >= b),
  eq: (a, b) => +(a === b), ne: (a, b) => +(a !== b), lt: (a, b) => +(a < b), gt: (a, b) => +(a > b), le: (a, b) => +(a <= b), ge: (a, b) => +(a >= b),
  "&&": (a, b) => +(!!a && !!b), "||": (a, b) => +(!!a || !!b), and: (a, b) => +(!!a && !!b), or: (a, b) => +(!!a || !!b),
}
const UNARY = {
  "/-/": (a) => -a, neg: (a) => -a, abs: Math.abs, "!": (a) => +!a, not: (a) => +!a,
  sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, flr: Math.floor, ceil: Math.ceil, near: Math.round,
}

function tokenize(code) {
  return code.match(/\([^)]*\)|if\{|els\{|\}|\S+/g) ?? []
}

// "(A:YOKE Y POSITION WITH AP, Percent)" or "(L:YokePitch_Anim,number)".
function variable(token) {
  const m = token.match(/^\(\s*([A-Z]):([^,)]+?)\s*(?:,\s*([^)]+?))?\s*\)$/i)
  if (!m) return null
  return { kind: m[1].toUpperCase(), name: m[2].trim(), unit: (m[3] ?? "number").trim().toLowerCase() }
}

export function compile(code) {
  const tokens = tokenize(code)
  const vars = []
  const seen = new Set()
  const ops = tokens.map((t) => {
    if (t.startsWith("(>")) throw new Error(`a write in animation code: ${t}`)
    if (t.startsWith("(")) {
      const v = variable(t)
      if (!v) throw new Error(`can't read ${t}`)
      const key = `${v.kind}:${v.name}`
      if (!seen.has(key)) { seen.add(key); vars.push(v) }
      return { var: v }
    }
    if (t === "if{" || t === "els{" || t === "}") return { block: t }
    if (/^-?\d*\.?\d+(e-?\d+)?$/i.test(t)) return { num: Number(t) }
    const word = t.toLowerCase()
    if (BINARY[t] ?? BINARY[word]) return { binary: BINARY[t] ?? BINARY[word] }
    if (UNARY[t] ?? UNARY[word]) return { unary: UNARY[t] ?? UNARY[word] }
    if (["d", "r", "p"].includes(word)) return { stack: word }
    throw new Error(`can't run "${t}" in: ${code.trim()}`)
  })

  // The token after the block that starts at i: its closing brace.
  const close = (i) => {
    for (let depth = 0, j = i; j < ops.length; j++) {
      if (ops[j].block === "if{" || ops[j].block === "els{") depth++
      else if (ops[j].block === "}" && --depth === 0) return j
    }
    throw new Error(`an unclosed block in: ${code.trim()}`)
  }

  function run(get) {
    const st = []
    const exec = (from, to) => {
      for (let i = from; i < to; i++) {
        const o = ops[i]
        if ("num" in o) st.push(o.num)
        else if (o.var) st.push(Number(get(o.var)) || 0)
        else if (o.binary) { const b = st.pop() ?? 0, a = st.pop() ?? 0; st.push(o.binary(a, b)) }
        else if (o.unary) st.push(o.unary(st.pop() ?? 0))
        else if (o.stack === "d") st.push(st[st.length - 1] ?? 0)
        else if (o.stack === "r") { const b = st.pop() ?? 0, a = st.pop() ?? 0; st.push(b, a) }
        else if (o.stack === "p") st.pop()
        else if (o.block === "if{") {
          const end = close(i)
          const hasElse = ops[end + 1]?.block === "els{"
          const elseEnd = hasElse ? close(end + 1) : end
          if (st.pop()) exec(i + 1, end)
          else if (hasElse) exec(end + 2, elseEnd)
          i = elseEnd
        }
      }
    }
    exec(0, ops.length)
    return st.length ? st[st.length - 1] : 0
  }

  return { vars, run, code: code.trim() }
}
