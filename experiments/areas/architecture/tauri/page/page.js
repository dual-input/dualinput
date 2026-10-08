// The page both p05 apps show. It opens one WebSocket to the probe's server,
// which logs the Origin the page sent. Electron passes the port and a label in
// the query; Tauri sets them as globals before this script runs.

const query = new URLSearchParams(location.search)
const port = query.get("port") || window.CROSSCHECK_P05_PORT
const from = query.get("from") || window.CROSSCHECK_P05_FROM || "page"
const status = document.getElementById("status")

if (port) {
  // The page's own idea of its origin and its engine go along, so the report
  // can set them beside the Origin header the engine sent.
  const url = `ws://127.0.0.1:${port}/?from=${encodeURIComponent(from)}` +
    `&page=${encodeURIComponent(location.origin)}&ua=${encodeURIComponent(navigator.userAgent)}`
  const ws = new WebSocket(url)
  status.textContent = `Connecting to 127.0.0.1:${port} as ${from}.`
  ws.onopen = () => { status.textContent = `Connected to 127.0.0.1:${port} as ${from}, from ${location.origin}.` }
  ws.onclose = () => { status.textContent = `The connection to 127.0.0.1:${port} closed.` }
}

for (const button of document.querySelectorAll("button")) {
  button.addEventListener("click", () => { document.getElementById("said").textContent = button.dataset.say })
}
