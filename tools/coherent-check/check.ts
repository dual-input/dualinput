// The Coherent GT check. MSFS 2024 runs our code in the sim in Coherent GT, an engine whose
// features match no browser, and a file with syntax it rejects runs none of its code, while
// a built-in it lacks throws only where it's called. So this checks each file we ship into
// the sim against the engine's measured limits before the sim sees it, and names each
// failure's line in the bundle and, through esbuild's map, in our TypeScript
// (record/areas/build/01-the-build.md, "The Coherent GT check"; decision 031).
//
// data.json holds the lists record/areas/architecture/coherent-gt.md gives, so change both
// together, and re-measure with p09 after a sim update.

import fs from "node:fs"
import path from "node:path"

import { RegExpValidator } from "@eslint-community/regexpp"
import * as acorn from "acorn"
import * as walk from "acorn-walk"
import * as eslintScope from "eslint-scope"
import { SourceMapConsumer } from "source-map-js"

type Data = {
  globals: Record<string, string>
  statics: Record<string, string>
  methods: Record<string, string>
  allowed: { receivers: { name: string; reason: string }[]; sources: { path: string; reason: string }[] }
}

const DATA: Data = JSON.parse(fs.readFileSync(new URL("./data.json", import.meta.url), "utf8"))

// Each method's property name, such as `at`, with every built-in that has it.
const METHODS = new Map<string, string[]>()
for (const name of Object.keys(DATA.methods)) {
  const property = name.slice(name.lastIndexOf(".") + 1)
  METHODS.set(property, [...(METHODS.get(property) ?? []), name])
}

// A page's global object goes by these names, so `window.Intl` is the global `Intl`.
const GLOBAL_OBJECTS = new Set(["window", "self", "globalThis"])

export type Finding = {
  /** From 1, in the file checked. */
  line: number
  /** From 1. */
  column: number
  message: string
  /** Where esbuild's map says the failure came from, with that line's text. */
  source?: { file: string; line: number; column: number; text?: string }
}

// acorn's nodes, read loosely, since the walk visits every kind.
type Node = acorn.Node & { [key: string]: any }

/**
 * Checks one file's code. `map` is esbuild's source map for it, and `mapDir` the folder its
 * sources' paths start from.
 */
export function checkCode(code: string, map?: string, mapDir = "."): Finding[] {
  let ast: Node
  try {
    ast = acorn.parse(code, { ecmaVersion: 2017, sourceType: "script", ranges: true, locations: true }) as Node
  } catch (error) {
    if (!(error instanceof SyntaxError) || !("loc" in error)) throw error
    const loc = error.loc as { line: number; column: number }
    const message = `doesn't parse as ES2017, so none of the file runs: ${error.message.replace(/ \(\d+:\d+\)$/, "")}`
    return withSources([{ line: loc.line, column: loc.column + 1, message }], map, mapDir)
  }
  return withSources(new Walk(ast, code).findings(), map, mapDir)
}

/** Checks a file, with the source map esbuild wrote beside it, if any. */
export function checkFile(file: string): Finding[] {
  const map = `${file}.map`
  return checkCode(fs.readFileSync(file, "utf8"), fs.existsSync(map) ? fs.readFileSync(map, "utf8") : undefined, path.dirname(map))
}

/** A finding as the check prints it: the file's line, then the source's, then its text. */
export function format(file: string, f: Finding): string {
  const lines = [`${file}:${f.line}:${f.column}: ${f.message}`]
  if (f.source) {
    lines.push(`  from ${f.source.file}:${f.source.line}:${f.source.column}`)
    if (f.source.text !== undefined) lines.push(`    ${f.source.text.trim()}`)
  }
  return lines.join("\n")
}

class Walk {
  private readonly parents = new Map<Node, Node>()
  private readonly refs = new Map<Node, eslintScope.Reference>()
  private readonly global: eslintScope.Scope
  // Names the file defines, by assigning a member, through Object.defineProperty, or by
  // assigning a global, whose every use in the file passes as the file's own fill-in.
  private readonly defined = new Set<string>()
  private readonly found: Finding[] = []
  private readonly ast: Node
  private readonly code: string

  constructor(ast: Node, code: string) {
    this.ast = ast
    this.code = code
    walk.fullAncestor(ast, (node, _state, ancestors) => {
      const parent = ancestors[ancestors.length - 2]
      if (parent) this.parents.set(node as Node, parent as Node)
    })
    const scopes = eslintScope.analyze(ast as never, { ecmaVersion: 2017, sourceType: "script" })
    for (const scope of scopes.scopes) for (const ref of scope.references) this.refs.set(ref.identifier as unknown as Node, ref)
    if (!scopes.globalScope) throw new Error("eslint-scope gave no global scope")
    this.global = scopes.globalScope
  }

  findings(): Finding[] {
    walk.full(this.ast, (n) => this.noteDefinition(n as Node))
    for (const ref of this.global.through) {
      const node = ref.identifier as unknown as Node
      if (this.isGlobal(node) && node.name in DATA.globals) this.flag(node, node.name, describe(node.name, DATA.globals[node.name]!))
    }
    walk.full(this.ast, (n) => {
      const node = n as Node
      if (node.type === "MemberExpression") this.checkMember(node)
      else if (node.type === "NewExpression" || node.type === "CallExpression") this.checkCall(node)
    })
    return this.found.sort((a, b) => a.line - b.line || a.column - b.column)
  }

  private noteDefinition(node: Node): void {
    if (node.type === "AssignmentExpression") {
      if (node.left.type === "MemberExpression") {
        const name = propertyName(node.left)
        if (name) this.defined.add(name)
      } else if (node.left.type === "Identifier" && this.isGlobal(node.left)) {
        this.defined.add(node.left.name)
      }
    } else if (node.type === "CallExpression" && node.callee.type === "MemberExpression") {
      const callee = `${node.callee.object.name}.${propertyName(node.callee)}`
      const name = node.arguments[1]
      if ((callee === "Object.defineProperty" || callee === "Reflect.defineProperty") && name?.type === "Literal") {
        this.defined.add(String(name.value))
      }
    }
  }

  private checkMember(node: Node): void {
    const name = propertyName(node)
    if (!name || this.isAssigned(node)) return
    if (this.isGlobalObject(node.object) && name in DATA.globals) {
      this.flag(node.property, name, describe(name, DATA.globals[name]!), node)
      return
    }
    // A static is `Object.fromEntries`, or `window.Object.fromEntries`.
    const object = node.object
    const owner =
      object.type === "Identifier" && this.isGlobal(object)
        ? object.name
        : object.type === "MemberExpression" && this.isGlobalObject(object.object)
          ? propertyName(object)
          : undefined
    const full = `${owner}.${name}`
    if (owner && full in DATA.statics) {
      this.flag(node.property, name, describe(full, DATA.statics[full]!), node)
      return
    }
    const builtins = METHODS.get(name)
    if (builtins && !this.isOwnReceiver(node.object, name)) {
      const which = builtins.join(" or ")
      const status = DATA.methods[builtins[0]!]!
      this.flag(node.property, name, `.${name} is ${which}, ${status === "missing" ? "missing in Coherent GT" : status}`, node)
    }
  }

  private checkCall(node: Node): void {
    const callee = node.callee
    if (callee.type !== "Identifier" || !this.isGlobal(callee)) return
    if (node.type === "NewExpression" && /Error$/.test(callee.name)) {
      const options = node.arguments[1]
      if (options?.type === "ObjectExpression" && options.properties.some((p: Node) => p.type === "Property" && keyName(p) === "cause")) {
        this.flag(options, "cause", "an Error's cause is missing in Coherent GT")
      }
    }
    if (callee.name === "RegExp") this.checkRegExp(node)
  }

  // A regex literal carries its own flags, which acorn already checked at ES2017, so only a
  // RegExp built from strings needs this, as esbuild writes each regex it can't lower.
  private checkRegExp(node: Node): void {
    const pattern = stringValue(node.arguments[0])
    const flags = node.arguments.length > 1 ? stringValue(node.arguments[1]) : ""
    if (pattern === undefined || flags === undefined) return
    try {
      const validator = new RegExpValidator({ ecmaVersion: 2017 })
      validator.validateFlags(flags)
      validator.validatePattern(pattern, 0, pattern.length, { unicode: flags.includes("u"), unicodeSets: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.flag(node, "RegExp", `this regular expression throws in Coherent GT, which runs ES2017's: ${message}`)
    }
  }

  /**
   * Records a finding at `at`, unless a rule passes this use of `name`. `member` is the
   * member expression `at` names the property of, which the walk reaches where it doesn't
   * reach a property's name.
   */
  private flag(at: Node, name: string, message: string, member?: Node): void {
    if (this.defined.has(name) || this.isGuarded(member ?? at, name)) return
    if (member && DATA.allowed.receivers.some((r) => r.name === this.code.slice(member.object.start, member.object.end))) return
    const loc = at.loc!.start
    this.found.push({ line: loc.line, column: loc.column + 1, message })
  }

  /** Whether `node` is the global of its name: unresolved, and declared nowhere in the file. */
  private isGlobal(node: Node): boolean {
    const ref = this.refs.get(node)
    return ref !== undefined && ref.resolved === null && !this.global.set.has(node.name)
  }

  /** Whether `node` is the page's global object, through which `window.X` names the global `X`. */
  private isGlobalObject(node: Node): boolean {
    return node.type === "Identifier" && GLOBAL_OBJECTS.has(node.name) && this.isGlobal(node)
  }

  private isAssigned(member: Node): boolean {
    const parent = this.parents.get(member)
    return parent?.type === "AssignmentExpression" && parent.left === member
  }

  /**
   * A receiver the file binds to its own class or object declaring the member isn't the
   * built-in, as the framework's own `ArrayUtils.flatMap` isn't `Array.prototype.flatMap`.
   */
  private isOwnReceiver(receiver: Node, name: string): boolean {
    if (receiver.type !== "Identifier") return false
    const variable = this.refs.get(receiver)?.resolved ?? this.global.set.get(receiver.name)
    const def = variable?.defs[0]?.node as Node | undefined
    if (!def) return false
    const body = def.type === "ClassDeclaration" ? def : def.type === "VariableDeclarator" ? def.init : undefined
    if (body?.type === "ClassDeclaration" || body?.type === "ClassExpression") {
      return body.body.body.some((m: Node) => keyName(m) === name)
    }
    if (body?.type === "ObjectExpression") return body.properties.some((p: Node) => keyName(p) === name)
    return false
  }

  /**
   * A guard isn't a use: `typeof X`, or `X` or `Y.x` in the test of an `if`, a ternary, or an
   * `&&`. The branch a test guards passes too, as in `typeof ResizeObserver !== "undefined" ?
   * new ResizeObserver(f) : null`, and so does `"x" in Y` in the test.
   */
  private isGuarded(node: Node, name: string): boolean {
    let child = node
    for (let parent = this.parents.get(node); parent; child = parent, parent = this.parents.get(parent)) {
      if (parent.type === "UnaryExpression" && parent.operator === "typeof" && parent.argument === child) return true
      const test = parent.type === "IfStatement" || parent.type === "ConditionalExpression" ? parent.test : parent.type === "LogicalExpression" && parent.operator === "&&" ? parent.left : undefined
      if (!test) continue
      if (child === test) return true
      const guarded = parent.type === "LogicalExpression" ? parent.right : parent.consequent
      if (child === guarded && namesIn(test).has(name)) return true
    }
    return false
  }
}

function describe(name: string, status: string): string {
  return status === "missing" ? `${name} is missing in Coherent GT` : `${name} is ${status}, so count on it nowhere`
}

/** A member's property name, when the code names it: `a.b`, or `a["b"]`. */
function propertyName(member: Node): string | undefined {
  if (!member.computed && member.property.type === "Identifier") return member.property.name
  if (member.computed && member.property.type === "Literal" && typeof member.property.value === "string") return member.property.value
  return undefined
}

/** A class member's or an object property's key, when the code names it. */
function keyName(p: Node): string | undefined {
  if (!p.key) return undefined
  if (!p.computed && p.key.type === "Identifier") return p.key.name
  if (p.key.type === "Literal") return String(p.key.value)
  return undefined
}

/** A string literal's value, or a template literal's with no expressions. */
function stringValue(node: Node | undefined): string | undefined {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked
  return undefined
}

/** Every name a guard's test mentions: identifiers, members' property names, and `"x" in Y`'s `x`. */
function namesIn(test: Node): Set<string> {
  const names = new Set<string>()
  walk.full(test, (n) => {
    const node = n as Node
    if (node.type === "Identifier") names.add(node.name)
    else if (node.type === "MemberExpression") {
      const name = propertyName(node)
      if (name) names.add(name)
    } else if (node.type === "BinaryExpression" && node.operator === "in" && node.left.type === "Literal") {
      names.add(String(node.left.value))
    }
  })
  return names
}

/** Adds each finding's place in our source, through esbuild's map, and drops what the data file allows by source. */
function withSources(findings: Finding[], map: string | undefined, mapDir: string): Finding[] {
  if (!map) return findings
  const consumer = new SourceMapConsumer(JSON.parse(map))
  const out: Finding[] = []
  for (const f of findings) {
    const at = consumer.originalPositionFor({ line: f.line, column: f.column - 1 })
    if (at.source && at.line !== null) {
      const file = path.relative(process.cwd(), path.resolve(mapDir, at.source)).split(path.sep).join("/")
      if (DATA.allowed.sources.some((s) => matches(file, s.path))) continue
      const text = consumer.sourceContentFor(at.source, true)?.split(/\r?\n/)[at.line - 1]
      out.push({ ...f, source: { file, line: at.line, column: at.column + 1, text: text ?? undefined } })
    } else {
      out.push(f)
    }
  }
  return out
}

/** Whether `file` matches `pattern`, where `**` crosses folders and `*` doesn't. */
function matches(file: string, pattern: string): boolean {
  const re = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*")
  return new RegExp(`(^|/)${re}$`).test(file)
}
