// Tests that tools/lib/vsix.ts writes a zip whose entries read back byte for byte, with the
// manifests VS Code and the Marketplace read. The reader below follows the zip format from the
// end of central directory record, apart from the writer's code, so a mistake in one doesn't
// cancel out in the other.
//
//   node --test tools/vsix.test.ts

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import zlib from "node:zlib"

import { type Manifest, writeVsix } from "./lib/vsix.ts"

const MANIFEST: Manifest = {
  name: "dualinput-profiles",
  publisher: "dual-input",
  displayName: "Dual Input Profiles",
  description: "Profiles & <checks>",
  version: "0.1.0",
  engines: { vscode: "^1.91.0" },
  categories: ["Programming Languages"],
  icon: "icon.png",
  repository: { url: "https://github.com/dual-input/dualinput" },
  main: "./dist/extension.js",
  activationEvents: ["onLanguage:dualinput-profile"],
  contributes: { languages: [{ id: "dualinput-profile", aliases: ["Dual Input Profile"] }], grammars: [{ language: "dualinput-profile" }] },
}

const FILES = [
  { path: "dist/extension.js", data: Buffer.from("exports.activate = () => {}\n".repeat(200)) },
  { path: "icon.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]) },
  { path: "bin/dualinput-profile-builder.exe", data: Buffer.alloc(0) },
]

/** Every entry of a zip, by name, inflated, with its Unix mode, checked against its CRC-32. */
function unzip(zip: Buffer): Map<string, { data: Buffer; mode: number }> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  assert.ok(end >= 0, "the zip has an end of central directory record")
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const entries = new Map<string, { data: Buffer; mode: number }>()
  for (let index = 0; index < count; index++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50, "each central directory header starts with its signature")
    const method = zip.readUInt16LE(at + 10)
    const crc = zip.readUInt32LE(at + 16)
    const size = zip.readUInt32LE(at + 20)
    const names = zip.readUInt16LE(at + 28)
    const extra = zip.readUInt16LE(at + 30)
    const comment = zip.readUInt16LE(at + 32)
    const mode = zip.readUInt32LE(at + 38) >>> 16
    const local = zip.readUInt32LE(at + 42)
    const name = zip.toString("utf8", at + 46, at + 46 + names)
    assert.equal(zip.readUInt32LE(local), 0x04034b50, `${name}'s local header starts with its signature`)
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const stored = zip.subarray(start, start + size)
    const data = method === 8 ? zlib.inflateRawSync(stored) : stored
    assert.equal(zlib.crc32(data), crc, `${name}'s CRC-32 matches its data`)
    entries.set(name, { data, mode })
    at += 46 + names + extra + comment
  }
  return entries
}

function pack(files = FILES, manifest = MANIFEST): Buffer {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "dualinput-vsix-"))
  try {
    const file = path.join(folder, "test.vsix")
    writeVsix(file, manifest, files, "win32-x64")
    return fs.readFileSync(file)
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
}

test("a .vsix holds the two manifests, then package.json and each file under extension/, each as written", () => {
  const entries = unzip(pack())
  assert.deepEqual(
    [...entries.keys()],
    ["extension.vsixmanifest", "[Content_Types].xml", "extension/package.json", "extension/bin/dualinput-profile-builder.exe", "extension/dist/extension.js", "extension/icon.png"],
  )
  for (const file of FILES) assert.deepEqual(entries.get(`extension/${file.path}`)?.data, file.data)
  assert.deepEqual(JSON.parse(entries.get("extension/package.json")!.data.toString("utf8")), MANIFEST)
  for (const [name, entry] of entries) assert.equal(entry.mode, 0o100644, `${name} is writable once VS Code extracts it`)
})

test("the vsixmanifest names the extension, its platform, its links, and its icon, with its text escaped", () => {
  const manifest = unzip(pack()).get("extension.vsixmanifest")!.data.toString("utf8")
  assert.match(manifest, /<Identity Language="en-US" Id="dualinput-profiles" Version="0\.1\.0" Publisher="dual-input" TargetPlatform="win32-x64"\/>/)
  assert.match(manifest, /<Description xml:space="preserve">Profiles &amp; &lt;checks&gt;<\/Description>/)
  assert.match(manifest, /<Tags>dualinput-profile,DualInputProfile<\/Tags>/)
  assert.match(manifest, /<Property Id="Microsoft\.VisualStudio\.Code\.Engine" Value="\^1\.91\.0" \/>/)
  assert.match(manifest, /<Property Id="Microsoft\.VisualStudio\.Services\.Links\.GitHub" Value="https:\/\/github\.com\/dual-input\/dualinput\.git" \/>/)
  assert.match(manifest, /<Property Id="Microsoft\.VisualStudio\.Services\.Links\.Support" Value="https:\/\/github\.com\/dual-input\/dualinput\/issues" \/>/)
  assert.match(manifest, /<InstallationTarget Id="Microsoft\.VisualStudio\.Code"\/>/)
  assert.match(manifest, /<Asset Type="Microsoft\.VisualStudio\.Code\.Manifest" Path="extension\/package\.json" Addressable="true" \/>/)
  assert.match(manifest, /<Asset Type="Microsoft\.VisualStudio\.Services\.Icons\.Default" Path="extension\/icon\.png" Addressable="true" \/>/)
  assert.match(manifest, /<Icon>extension\/icon\.png<\/Icon>/)
})

test("[Content_Types].xml gives each of the package's file types its media type, sorted", () => {
  const types = unzip(pack()).get("[Content_Types].xml")!.data.toString("utf8")
  const defaults = [...types.matchAll(/<Default Extension="([^"]+)" ContentType="([^"]+)"\/>/g)].map((m) => `${m[1]} ${m[2]}`)
  assert.deepEqual(defaults, [".exe application/octet-stream", ".js application/javascript", ".json application/json", ".png image/png", ".vsixmanifest text/xml"])
})

test("the same files pack to the same bytes", () => {
  assert.deepEqual(pack(), pack([...FILES].reverse()))
})

test("a manifest naming an icon the files lack, or a file type with no media type, stops the packer", () => {
  assert.throws(() => pack(FILES.filter((file) => file.path !== "icon.png")), /names the icon icon\.png, which isn't among its files/)
  assert.throws(() => pack([...FILES, { path: "README.md", data: Buffer.from("#") }]), /no media type for \.md files/)
})
