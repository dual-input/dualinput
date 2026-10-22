// Reads the two TOML files deploy.ts needs, relays.toml and the tokens repository's
// tokens.toml, which hold only tables of arrays, strings, integers, and arrays of strings.
// The network crate's build reads the same files with the toml crate, so a file that
// passes this and fails there stops the build.

export type Value = string | number | string[]

/** `[[name]]` tables in order, each a map of its keys, and the keys before any table. */
export type Toml = { top: Map<string, Value>; tables: Map<string, Map<string, Value>[]> }

export function parse(text: string): Toml {
  const top = new Map<string, Value>()
  const tables = new Map<string, Map<string, Value>[]>()
  let at = top
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$/, "").trim()
    if (line === "" || line.startsWith("#")) return
    const table = /^\[\[([a-z_-]+)\]\]$/.exec(line)
    if (table?.[1]) {
      at = new Map()
      tables.set(table[1], [...(tables.get(table[1]) ?? []), at])
      return
    }
    const pair = /^([a-z_-]+)\s*=\s*(.+)$/.exec(line)
    if (!pair?.[1] || !pair[2]) throw new Error(`line ${i + 1} isn't a key and value: ${raw}`)
    at.set(pair[1], value(pair[2], i + 1))
  })
  return { top, tables }
}

function value(text: string, line: number): Value {
  if (/^-?\d+$/.test(text)) return Number(text)
  if (/^"[^"\\]*"$/.test(text)) return text.slice(1, -1)
  const array = /^\[(.*)\]$/.exec(text)
  if (array) {
    const items = (array[1] ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "")
    if (items.every((s) => /^"[^"\\]*"$/.test(s))) return items.map((s) => s.slice(1, -1))
  }
  throw new Error(`line ${line}'s value isn't a string, an integer, or an array of strings: ${text}`)
}
