/*
 * A client for ChasePlane's WebSocket API, which its bridge, CP MSFS Bridge,
 * serves on port 8652. Nobody documents the API; this speaks it as ChasePlane
 * Remote's script does (read in ChasePlane 2026.39.1.16,
 * http://localhost:8651/remote_assets/remote-ui.js, class uM): an api_connect
 * message with a client name, answered by api_version and initialized, then
 * api_request messages with a request ID, answered by api_reply. Logged in
 * record/areas/aircraft/log.md, "ChasePlane's own API moves the pilot's camera
 * to the copilot's seat by loading its CoPilot view".
 */

const URL = "ws://localhost:8652"

export async function connectChasePlane(clientName, { rec = null, timeoutMs = 5000 } = {}) {
  const ws = new WebSocket(URL)
  const pending = new Map()
  const state = { version: null, apiVersion: null, masterEnabled: null }
  const log = (kind, text, data) => rec?.log(kind, text, data)
  const send = (obj) => { log("chaseplane", `send ${JSON.stringify(obj).slice(0, 200)}`, { sent: obj }); ws.send(JSON.stringify(obj)) }
  // ChasePlane Remote unwraps replies nested up to four deep the same way.
  const unwrap = (p) => { for (let i = 0; i < 4 && p && typeof p === "object" && "payload" in p; i++) p = p.payload; return p }

  await new Promise((resolve, reject) => {
    ws.onopen = () => send({ message: "api_connect", payload: { client_name: clientName } })
    ws.onerror = () => reject(new Error(`could not reach ChasePlane's API at ${URL}; is ChasePlane running?`))
    ws.onmessage = (m) => {
      if (typeof m.data !== "string" || m.data === "PING" || m.data === "PING_BRIDGE") return
      let x
      try { x = JSON.parse(m.data) } catch { return }
      if (x.message === "api_version") state.apiVersion = x.payload?.version
      else if (x.message === "initialized") { state.version = x.payload?.chaseplane_version; resolve() }
      else if (x.message === "cam_mode_set" || x.message === "camera_runtime_state") {
        if (typeof x.payload?.master_enabled === "boolean") state.masterEnabled = x.payload.master_enabled
      } else if (x.message === "api_reply") {
        const p = pending.get(x.request_id)
        if (p) { pending.delete(x.request_id); x.status === 200 ? p.resolve(unwrap(x.payload)) : p.reject(new Error(`${x.error} (${x.status})`)) }
      }
    }
    setTimeout(() => reject(new Error(`ChasePlane sent no initialized message in ${timeoutMs / 1000}s`)), timeoutMs)
  })

  const request = (command, payload = {}) => new Promise((resolve, reject) => {
    const id = `${command}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
    pending.set(id, { resolve, reject })
    send({ message: "api_request", request_id: id, command, payload })
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${command}: no reply in ${timeoutMs / 1000}s`)) }, timeoutMs)
  })

  return {
    state,
    request,
    send,
    getViews: async () => { const r = await request("get_views"); return Array.isArray(r) ? r : r?.views ?? [] },
    setViewByGuid: (guid) => request("set_view_by_guid", { guid }),
    setMasterEnabled: (enabled) => request("set_master_enabled", { enabled }),
    close: () => ws.close(),
  }
}
