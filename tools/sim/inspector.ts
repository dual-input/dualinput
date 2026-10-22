// The WebKit inspector MSFS 2024 hosts on 127.0.0.1:19999, which runs JavaScript in any of
// the sim's pages with Developer Mode off, so a case in the sim needs no one pasting code
// into a panel (measured on MSFS 2024, 2026-09-01, FS Copilot fork,
// record/pointer-forwarding/docs/06-open-questions.md, Q00).
//
//   GET /pagelist.json                     the pages, each with its id and title
//   ws://127.0.0.1:19999/devtools/page/N   the inspector's protocol for one of them

const ORIGIN = "127.0.0.1:19999"

/** One of the sim's pages. A cockpit panel's title is `VCockpitNN - <instrument identifier>`. */
export type Page = { id: number; title: string; url: string }

/** The sim's pages, or an empty list while nothing answers on the inspector's port. */
export async function listPages(): Promise<Page[]> {
  try {
    const response = await fetch(`http://${ORIGIN}/pagelist.json`, { signal: AbortSignal.timeout(5_000) })
    return (await response.json()) as Page[]
  } catch {
    return []
  }
}

/** Runs `expression` in `page` and returns its value, or throws what the page threw. */
export async function evaluate<T>(page: Page, expression: string, ms = 10_000): Promise<T> {
  const ws = new WebSocket(`ws://${ORIGIN}/devtools/page/${page.id}`)
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`the inspector didn't open page ${page.id}`)), ms)
      ws.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
      ws.onerror = () => reject(new Error(`the inspector refused page ${page.id}`))
    })
    const answer = await new Promise<{ result?: { result?: { value?: T; description?: string }; wasThrown?: boolean }; error?: unknown }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`page ${page.id} didn't answer within ${ms}ms`)), ms)
      ws.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as { id?: number }
        if (message.id !== 1) return
        clearTimeout(timer)
        resolve(message as never)
      }
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }))
    })
    if (answer.error) throw new Error(`the inspector said ${JSON.stringify(answer.error)}`)
    if (answer.result?.wasThrown) throw new Error(`page ${page.id} threw ${answer.result.result?.description}`)
    return answer.result?.result?.value as T
  } finally {
    ws.close()
  }
}
