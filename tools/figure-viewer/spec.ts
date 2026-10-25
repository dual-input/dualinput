// Changing figure.json's numbers in place, so an applied change shows in a diff as the numbers
// that changed: the file keeps each part of the figure on one line, which a JSON writer would
// reflow.

/** `text` with the number at each JSON pointer in `changes`, such as `/head/radius`, replaced. */
export function setNumbers(text: string, changes: Record<string, number>): string {
  const left = new Set(Object.keys(changes))
  const replaced: [number, number, string][] = []
  let at = 0
  const fail = (what: string): never => {
    throw new Error(`figure.json at character ${at}: ${what}`)
  }
  const space = () => {
    while (at < text.length && /\s/.test(text[at]!)) at++
  }
  const string = (): string => {
    const start = at
    at++
    while (at < text.length && text[at] !== '"') at += text[at] === "\\" ? 2 : 1
    at++
    return JSON.parse(text.slice(start, at)) as string
  }
  const value = (pointer: string): void => {
    space()
    const open = text[at]
    if (open === "{" || open === "[") {
      const close = open === "{" ? "}" : "]"
      at++
      space()
      for (let index = 0; text[at] !== close; index++) {
        let key = String(index)
        if (open === "{") {
          key = string()
          space()
          if (text[at] !== ":") fail("expected a colon")
          at++
        }
        value(`${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`)
        space()
        if (text[at] === ",") at++
        else if (text[at] !== close) fail("expected a comma")
        space()
      }
      at++
    } else if (open === '"') {
      string()
    } else {
      const token = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(at))?.[0] ?? fail("expected a value")
      if (left.has(pointer) && /^-?\d/.test(token)) {
        replaced.push([at, at + token.length, JSON.stringify(changes[pointer])])
        left.delete(pointer)
      }
      at += token.length
    }
  }
  value("")
  if (left.size) throw new Error(`figure.json has no number at ${[...left].join(", ")}`)
  let out = ""
  let from = 0
  for (const [start, end, number] of replaced) {
    out += text.slice(from, start) + number
    from = end
  }
  return out + text.slice(from)
}
