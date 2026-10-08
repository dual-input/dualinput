// A tray icon and nothing else, in Electron's main process, for p01. Prints
// TRAY once the icon is in place.

const { app, Tray, nativeImage } = require("electron")
const zlib = require("node:zlib")

// A 16x16 solid PNG, so the tray has an image without a file beside the script.
function png(size, [r, g, b]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6 // 8 bits, RGBA
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 4).fill(Buffer.from([r, g, b, 255]))])
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
}

let tray
app.on("window-all-closed", () => { /* no windows, and staying up anyway */ })
app.whenReady().then(() => {
  tray = new Tray(nativeImage.createFromBuffer(png(16, [40, 120, 200])))
  tray.setToolTip("p01 tray: Electron")
  process.stdout.write("TRAY\n")
})
