// Packs a VS Code extension as a .vsix, the zip that VS Code installs and the Marketplace takes,
// with Node's own deflate and CRC-32, since vsce, Microsoft's packer, would add 135 packages to
// every `npm ci` (record/areas/profiles/03-the-extension.md, "Packing and publishing"). VS Code's
// installer reads only extension/package.json from a .vsix, and the Marketplace reads
// extension.vsixmanifest, which this writes as vsce 4.1.1 does (read in @vscode/vsce 4.1.1,
// out/package.js, `toVsixManifest` and `toContentTypes`).

import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"

import { Failed } from "./run.ts"

/** A file of the extension, by its path in the extension's folder, such as `dist/extension.js`. */
export type ExtensionFile = { path: string; data: Buffer }

/** The fields of an extension's package.json that the vsixmanifest repeats, and the rest of it as it is. */
export type Manifest = {
  name: string
  publisher: string
  version: string
  displayName?: string
  description?: string
  engines: { vscode: string }
  categories?: string[]
  keywords?: string[]
  icon?: string
  preview?: boolean
  repository?: string | { url: string }
  main?: string
  activationEvents?: string[]
  contributes?: { languages?: { id: string; aliases?: string[] }[]; grammars?: { language?: string }[] }
  [field: string]: unknown
}

/**
 * Each file type's media type in [Content_Types].xml, as vsce takes them from the `mime` package
 * 1.6.0, which names an .exe's `application/octet-stream`. When you pack a file of another type,
 * add it here.
 */
const MEDIA_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".exe": "application/octet-stream",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain",
  ".vsixmanifest": "text/xml",
}

/**
 * Writes the .vsix at `file`: extension.vsixmanifest, [Content_Types].xml, and under extension/,
 * the manifest as package.json and each of `files`. `target` is the platform the Marketplace
 * offers it to, such as `win32-x64`. The extension's own files pack in order of path, so the same
 * files pack to the same bytes.
 */
export function writeVsix(file: string, manifest: Manifest, files: ExtensionFile[], target: string): void {
  const packed = [{ path: "package.json", data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) }, ...files.toSorted((a, b) => (a.path < b.path ? -1 : 1))]
  const entries = [
    { path: "extension.vsixmanifest", data: Buffer.from(vsixManifest(manifest, packed, target)) },
    { path: "[Content_Types].xml", data: Buffer.from(contentTypes(packed)) },
    ...packed.map((one) => ({ path: `extension/${one.path}`, data: one.data })),
  ]
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, zip(entries))
}

/** The manifest the Marketplace reads, with the fields vsce writes for an extension like this one. */
function vsixManifest(manifest: Manifest, files: ExtensionFile[], target: string): string {
  const icon = manifest.icon && `extension/${manifest.icon.replace(/^\.\//, "")}`
  if (icon && !files.some((one) => `extension/${one.path}` === icon)) throw new Failed(`the extension's manifest names the icon ${manifest.icon}, which isn't among its files`)
  const links = repositoryLinks(manifest.repository)
  const properties: [string, string][] = [
    ["Microsoft.VisualStudio.Code.Engine", manifest.engines.vscode],
    ["Microsoft.VisualStudio.Code.ExtensionDependencies", ""],
    ["Microsoft.VisualStudio.Code.ExtensionPack", ""],
    // vsce deduces `workspace` for an extension with `main` and no `browser`.
    ["Microsoft.VisualStudio.Code.ExtensionKind", "workspace"],
    ["Microsoft.VisualStudio.Code.LocalizedLanguages", ""],
    ["Microsoft.VisualStudio.Code.EnabledApiProposals", ""],
    ...(manifest.main ? [["Microsoft.VisualStudio.Code.ExecutesCode", "true"] as [string, string]] : []),
    ...links,
    ["Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown", "true"],
    ["Microsoft.VisualStudio.Services.Content.Pricing", "Free"],
  ]
  // vsce adds an asset for a README.md, a CHANGELOG.md, and a license file too, so when the
  // extension packs one, add its asset as vsce's ReadmeProcessor, ChangelogProcessor, or
  // LicenseProcessor does.
  const assets: [string, string][] = [
    ["Microsoft.VisualStudio.Code.Manifest", "extension/package.json"],
    ...(icon ? [["Microsoft.VisualStudio.Services.Icons.Default", icon] as [string, string]] : []),
  ]
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${xml(manifest.name)}" Version="${xml(manifest.version)}" Publisher="${xml(manifest.publisher)}" TargetPlatform="${xml(target)}"/>
    <DisplayName>${xml(manifest.displayName ?? manifest.name)}</DisplayName>
    <Description xml:space="preserve">${xml(manifest.description ?? "")}</Description>
    <Tags>${xml(tags(manifest).join(","))}</Tags>
    <Categories>${xml((manifest.categories ?? []).join(","))}</Categories>
    <GalleryFlags>${manifest.preview ? "Public Preview" : "Public"}</GalleryFlags>
    <Properties>
${properties.map(([id, value]) => `      <Property Id="${id}" Value="${xml(value)}" />`).join("\n")}
    </Properties>${icon ? `\n    <Icon>${xml(icon)}</Icon>` : ""}
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
${assets.map(([type, at]) => `    <Asset Type="${type}" Path="${xml(at)}" Addressable="true" />`).join("\n")}
  </Assets>
</PackageManifest>
`
}

/**
 * The Marketplace's search tags, as vsce gives an extension whose contributions are languages and
 * grammars: its keywords, each language's ID and its aliases without spaces, each language an
 * activation event names, and each grammar's language. vsce also tags themes, snippets, and other
 * contributions, and a few words of the description, such as "javascript", which this doesn't.
 */
function tags(manifest: Manifest): string[] {
  const contributes = manifest.contributes ?? {}
  return [
    ...new Set([
      ...(manifest.keywords ?? []),
      ...(contributes.languages ?? []).flatMap((language) => [language.id, ...(language.aliases ?? []).map((alias) => alias.replace(/[^\w.-]/g, ""))]),
      ...(manifest.activationEvents ?? []).flatMap((event) => /^onLanguage:(.*)$/.exec(event)?.[1] ?? []),
      ...(contributes.grammars ?? []).flatMap((grammar) => grammar.language ?? []),
    ]),
  ].filter((tag) => tag)
}

/**
 * The links vsce writes for a repository, which for one on GitHub it takes from the
 * hosted-git-info package 4.1.0: the clone URL for the source, the issues for support, and the
 * README for learning.
 */
function repositoryLinks(repository: Manifest["repository"]): [string, string][] {
  const url = typeof repository === "string" ? repository : repository?.url
  if (!url) return []
  const github = /^(?:git\+)?https:\/\/github\.com\/([^/]+)\/([^/#]+?)(?:\.git)?\/?$/.exec(url)
  if (!github) return [["Microsoft.VisualStudio.Services.Links.Source", url], ["Microsoft.VisualStudio.Services.Links.Getstarted", url], ["Microsoft.VisualStudio.Services.Links.Repository", url]]
  const project = `https://github.com/${github[1]}/${github[2]}`
  return [
    ["Microsoft.VisualStudio.Services.Links.Source", `${project}.git`],
    ["Microsoft.VisualStudio.Services.Links.Getstarted", `${project}.git`],
    ["Microsoft.VisualStudio.Services.Links.GitHub", `${project}.git`],
    ["Microsoft.VisualStudio.Services.Links.Support", `${project}/issues`],
    ["Microsoft.VisualStudio.Services.Links.Learn", `${project}#readme`],
  ]
}

/** [Content_Types].xml, with a media type for each file type the package holds, sorted as vsce sorts them. */
function contentTypes(files: ExtensionFile[]): string {
  const types = new Set([".json", ".vsixmanifest", ...files.map((one) => path.extname(one.path).toLowerCase()).filter((type) => type)])
  const defaults = [...types].map((type) => {
    const media = MEDIA_TYPES[type]
    if (!media) throw new Failed(`tools/lib/vsix.ts has no media type for ${type} files; add one to MEDIA_TYPES`)
    return `<Default Extension="${type}" ContentType="${media}"/>`
  })
  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults.sort().join("")}</Types>
`
}

const XML_ESCAPES: Record<string, string> = { "'": "&apos;", '"': "&quot;", "<": "&lt;", ">": "&gt;", "&": "&amp;" }

function xml(text: string): string {
  return text.replace(/['"<>&]/g, (character) => XML_ESCAPES[character]!)
}

/**
 * A zip of `entries`, each deflated. It writes every entry's time as 1980-01-01 00:00, the
 * format's first, so the same entries zip to the same bytes, and gives each the Unix mode
 * 0o100644, which vsce gives package.json so VS Code can write its metadata into the installed
 * copy. It holds no ZIP64 records, so it refuses an entry of 4 GiB or more.
 */
function zip(entries: { path: string; data: Buffer }[]): Buffer {
  const UTF8_NAMES = 0x0800
  const DEFLATE = 8
  const VERSION = 20
  // A Unix host, which says the high half of each entry's external attributes is its mode.
  const MADE_BY = (3 << 8) | VERSION
  const DOS_DATE = (1 << 5) | 1
  const MODE = 0o100644

  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8")
    const deflated = zlib.deflateRawSync(entry.data, { level: 9 })
    if (entry.data.length >= 0xffffffff || offset >= 0xffffffff) throw new Failed(`${entry.path} doesn't fit a zip without ZIP64`)
    const crc = zlib.crc32(entry.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(VERSION, 4)
    local.writeUInt16LE(UTF8_NAMES, 6)
    local.writeUInt16LE(DEFLATE, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(MADE_BY, 4)
    central.writeUInt16LE(VERSION, 6)
    central.writeUInt16LE(UTF8_NAMES, 8)
    central.writeUInt16LE(DEFLATE, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(deflated.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE((MODE << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)

    locals.push(local, name, deflated)
    centrals.push(central, name)
    offset += local.length + name.length + deflated.length
  }
  const directory = Buffer.concat(centrals)
  if (entries.length > 0xffff || offset >= 0xffffffff) throw new Failed("the package doesn't fit a zip without ZIP64")
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
