// Writes the JavaScript a profile's write functions are type-checked against: TypeScript
// 6.0.3's own library declarations, kept to the globals the sandbox's QuickJS-ng context
// defines, and each to the members it defines, which src/engines/profile-engine/javascript/
// sandbox.json lists, as the sandbox's probe found them (record/areas/profiles/log.md,
// 2026-10-24). A global the context lacks, such as Date, JSON, or Promise, goes, and so does
// every member or type that names one, so a write function that would fail in the sandbox
// fails its type check instead. The profile engine puts the result in level 1's
// declarations.
//
//   node tools/javascript-types.ts

import fs from "node:fs"
import path from "node:path"

import ts from "typescript-6"

import { ROOT } from "./lib/repo.ts"

const LIB = path.join(ROOT, "node_modules", "typescript-6", "lib")
const FOLDER = path.join(ROOT, "src", "engines", "profile-engine", "javascript")
export const OUTPUT = path.join(FOLDER, "javascript.d.ts")

type Global = { type: string; own: string[]; prototype: string[] }

/** One of the libraries' top-level statements, with the name it declares. */
type Declared = { name: string; statement: ts.Statement; value: boolean }

/**
 * TypeScript's libraries for the language, ES5 first, then each year's in order, leaving out
 * those that describe a host rather than the language: the DOM, web workers, the Windows
 * script host, and the decorators, which reference their own libraries.
 */
function libraries(): string[] {
  const host = /dom|webworker|scripthost|decorators|\.full\./
  const year = (name: string) => (name === "lib.es5.d.ts" ? 0 : name.startsWith("lib.esnext") ? 9999 : Number(/lib\.es(\d+)/.exec(name)?.[1] ?? 0))
  return fs
    .readdirSync(LIB)
    .filter((n) => n.startsWith("lib.es") && n.endsWith(".d.ts") && !host.test(n) && n !== "lib.es6.d.ts")
    .sort((a, b) => year(a) - year(b) || a.localeCompare(b))
}

function nameOf(statement: ts.Statement): Declared | undefined {
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
    return { name: statement.name.text, statement, value: false }
  }
  if (ts.isFunctionDeclaration(statement) && statement.name) return { name: statement.name.text, statement, value: true }
  if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) return { name: statement.name.text, statement, value: true }
  if (ts.isVariableStatement(statement)) {
    const declaration = statement.declarationList.declarations[0]
    if (declaration && ts.isIdentifier(declaration.name)) return { name: declaration.name.text, statement, value: true }
  }
  return undefined
}

/** The name a member is reached by at runtime, as the probe lists it: `Symbol(Symbol.iterator)` for `[Symbol.iterator]`. */
function memberName(member: ts.Node): string | undefined {
  const name = (member as { name?: ts.PropertyName }).name
  if (!name) return undefined
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name)) return name.text
  if (ts.isComputedPropertyName(name)) return `Symbol(${name.expression.getText()})`
  return undefined
}

/** Every name a node's types reference, by the leftmost part of a qualified name. */
function references(node: ts.Node): Set<string> {
  const found = new Set<string>()
  const left = (n: ts.EntityName | ts.Expression): string | undefined => {
    if (ts.isIdentifier(n)) return n.text
    if (ts.isQualifiedName(n)) return left(n.left)
    if (ts.isPropertyAccessExpression(n)) return left(n.expression)
    return undefined
  }
  const walk = (n: ts.Node): void => {
    let name: string | undefined
    if (ts.isTypeReferenceNode(n)) name = left(n.typeName)
    else if (ts.isExpressionWithTypeArguments(n)) name = left(n.expression)
    else if (ts.isTypeQueryNode(n)) name = left(n.exprName)
    if (name) found.add(name)
    ts.forEachChild(n, walk)
  }
  walk(node)
  return found
}

/** A node's JSDoc, as written, then the node. */
function withDoc(node: ts.Node, indent: string): string {
  const docs = ((node as { jsDoc?: ts.JSDoc[] }).jsDoc ?? []).map((d) => d.getText())
  return [...docs, node.getText()].map((t) => indent + t.replace(/\n\s*/g, `\n${indent} `).replace(/\n\s+\*/g, `\n${indent} *`)).join("\n")
}

export function generate(): string {
  const sandbox = JSON.parse(fs.readFileSync(path.join(FOLDER, "sandbox.json"), "utf8")) as Record<string, Global>
  const files = libraries().map((name) => ts.createSourceFile(name, fs.readFileSync(path.join(LIB, name), "utf8"), ts.ScriptTarget.ESNext, true))
  const declared = files.flatMap((f) => f.statements.map(nameOf).filter((d) => d !== undefined))

  // A global the context lacks goes, with the type its variable is declared as, such as
  // DateConstructor for Date.
  const dropped = new Set<string>()
  // The members the context defines, by the type that declares them: for `declare var Array:
  // ArrayConstructor`, ArrayConstructor's are Array's own, and Array's its prototype's.
  const allowed = new Map<string, Set<string>>()
  for (const d of declared) {
    if (!d.value) continue
    const present = Object.hasOwn(sandbox, d.name)
    let type: string | undefined
    if (ts.isVariableStatement(d.statement)) {
      const t = d.statement.declarationList.declarations[0]?.type
      if (t && ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName)) type = t.typeName.text
    }
    if (!present) {
      dropped.add(d.name)
      if (type) dropped.add(type)
      continue
    }
    const global = sandbox[d.name]!
    if (ts.isModuleDeclaration(d.statement) || type === d.name) {
      allowed.set(d.name, new Set(global.own))
    } else if (type) {
      allowed.set(type, new Set(global.own))
      if (global.prototype.length) allowed.set(d.name, new Set(global.prototype))
    }
  }
  // A ReadonlyArray is an Array at runtime.
  if (allowed.has("Array")) allowed.set("ReadonlyArray", allowed.get("Array")!)

  // Drops, until nothing more goes, each type alias or interface whose own type names one
  // dropped, and keeps a member only if the context defines it and its types name none.
  const keepMember = (owner: string, member: ts.Node): boolean => {
    const name = memberName(member)
    const runtime = allowed.get(owner)
    if (runtime && name !== undefined && !runtime.has(name)) return false
    return ![...references(member)].some((r) => dropped.has(r))
  }
  for (let changed = true; changed; ) {
    changed = false
    for (const d of declared) {
      if (dropped.has(d.name) || d.value) continue
      const s = d.statement
      const own = ts.isInterfaceDeclaration(s) ? [...(s.heritageClauses ?? []), ...(s.typeParameters ?? [])] : [s]
      if (own.some((n) => [...references(n)].some((r) => dropped.has(r) && r !== d.name))) {
        dropped.add(d.name)
        changed = true
      }
    }
  }

  const out: string[] = [header(files[0]!)]
  for (const file of files) {
    const kept: string[] = []
    for (const statement of file.statements) {
      const d = nameOf(statement)
      if (!d || dropped.has(d.name)) continue
      if (ts.isInterfaceDeclaration(statement)) {
        const members = statement.members.filter((m) => keepMember(d.name, m))
        const head = statement.getText().slice(0, statement.members.pos - statement.getStart()).trimEnd()
        const docs = ((statement as { jsDoc?: ts.JSDoc[] }).jsDoc ?? []).map((j) => j.getText())
        kept.push([...docs, `${head}\n${members.map((m) => withDoc(m, "    ")).join("\n")}\n}`].join("\n"))
      } else if (ts.isModuleDeclaration(statement) && statement.body && ts.isModuleBlock(statement.body)) {
        const members = statement.body.statements.filter((m) => keepMember(d.name, m))
        kept.push(`declare namespace ${d.name} {\n${members.map((m) => withDoc(m, "    ")).join("\n")}\n}`)
      } else if (keepMember("", statement) || ts.isTypeAliasDeclaration(statement)) {
        kept.push(withDoc(statement, ""))
      }
    }
    if (kept.length) out.push(`// From ${file.fileName}.\n\n${kept.join("\n\n")}`)
  }
  return `${out.join("\n\n")}\n`
}

/** The libraries' own license notice, which their Apache 2.0 license asks a copy to keep. */
function header(es5: ts.SourceFile): string {
  const notice = /\/\*![\s\S]*?\*\//.exec(es5.text)?.[0] ?? ""
  return [
    '/// <reference no-default-lib="true"/>',
    "// Generated by tools/javascript-types.ts from TypeScript 6.0.3's library declarations, kept to",
    "// what the sandbox's context defines, which javascript/sandbox.json lists. Run it again after",
    "// changing either, rather than editing this file.",
    "",
    notice,
  ].join("\n")
}

if (import.meta.main) {
  fs.writeFileSync(OUTPUT, generate())
  console.log(`wrote ${path.relative(ROOT, OUTPUT)}`)
}
