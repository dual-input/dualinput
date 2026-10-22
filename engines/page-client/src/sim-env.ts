// The page client's surroundings in a page of the sim: the page's WebSocket, its timers, and
// the CommBus, through the sim's own `RegisterCommBusListener`.

import { ANNOUNCE, type Env, type Socket } from "./page-client.ts"

// The sim's Services/CommBus.js defines this in each page that loads it, cockpit panels
// among them (read in fs-base-ui, html_ui/JS/Services/CommBus.js).
declare function RegisterCommBusListener(ready: () => void): { on(name: string, f: (data: string) => void): void }

/** Where the sim keeps CommBus.js, which a page that has the sim's common.js but not it loads. */
const COMMBUS_JS = "/JS/Services/CommBus.js"

export function simEnv(): Env {
  return {
    connect(port: number): Socket {
      const socket: Socket = { onopen: null, onmessage: null, onclose: null, send: () => {}, close: () => {} }
      let ws: WebSocket
      try {
        // The page sends its Origin, coui://html_ui, which the core takes (decision 013).
        ws = new WebSocket(`ws://127.0.0.1:${port}`)
      } catch (e) {
        setTimeout(() => socket.onclose && socket.onclose(), 0)
        return socket
      }
      socket.send = (text) => ws.send(text)
      socket.close = () => ws.close()
      ws.onopen = () => socket.onopen && socket.onopen()
      ws.onmessage = (event) => {
        if (typeof event.data === "string" && socket.onmessage) socket.onmessage(event.data)
      }
      ws.onclose = () => socket.onclose && socket.onclose()
      return socket
    },
    every(ms, f) {
      setInterval(f, ms)
    },
    now: () => Date.now(),
    listen(hear) {
      withCommBus(() => {
        const listener = RegisterCommBusListener(() => {})
        // Coherent calls a CommBus name's handlers with no try, so one that throws would stop
        // the aircraft's own handlers after it (record/areas/architecture/02-code-map.md,
        // "What the bridge owns").
        listener.on(ANNOUNCE, (data) => {
          try {
            hear(data)
          } catch (e) {
            console.error(`Dual Input: the core's announcement threw: ${e}`)
          }
        })
      })
    },
    log(message) {
      console.log(`Dual Input: ${message}`)
    },
  }
}

/** Runs `then` once the page has `RegisterCommBusListener`, loading the sim's CommBus.js through a script element of our own where the page lacks it. */
function withCommBus(then: () => void): void {
  if (typeof RegisterCommBusListener === "function") {
    then()
    return
  }
  const script = document.createElement("script")
  script.src = COMMBUS_JS
  script.onload = () => {
    if (typeof RegisterCommBusListener === "function") then()
  }
  script.onerror = () => console.error(`Dual Input: ${COMMBUS_JS} didn't load, so this page can't hear the core`)
  document.head.appendChild(script)
}
