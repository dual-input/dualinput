// One Electron window showing ../page, for p05. The probe passes the port of
// its WebSocket server as the only argument, and the page opens a WebSocket to
// it, so the server logs the Origin the page sent.

const { app, BrowserWindow, Menu } = require("electron")
const path = require("node:path")

const port = process.argv[2] ?? ""

// Tauri's window has no menu bar, so this one has none either.
Menu.setApplicationMenu(null)
app.on("window-all-closed", () => app.quit())
app.whenReady().then(() => {
  // useContentSize makes 480x360 the page's size, as Tauri's inner_size does.
  const win = new BrowserWindow({ width: 480, height: 360, useContentSize: true, title: "p05: Electron" })
  win.loadFile(path.join(__dirname, "..", "page", "index.html"), { query: { port, from: "electron-page" } })
})
