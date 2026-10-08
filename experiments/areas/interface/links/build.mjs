/*
 * Builds crosscheck-p13-links for p13-sim-links.mjs and installs it into the
 * Community folder, with MSFS closed: one in-game panel of ours, standing in
 * for the notification banner, so p13 can try a WebSocket and an L: read from
 * a panel of our own, which nobody has run (record/areas/interface/log.md,
 * 2026-10-05, "An EFB app, the toolbar, and in-game panels each reach a
 * program on the same PC").
 *
 *   node experiments/areas/interface/links/build.mjs [--no-install]
 *
 * The panel's page loads the sim's simvar.js, as p05's did, because the real
 * banner would. It runs nothing of its own beyond the SU2 workaround below:
 * p13 runs its code through the inspector, as it does in every other page, so
 * every page gets the same test. It touches no input, so it has nothing to
 * fail open from.
 *
 * Its icon is plain, with no script in it: p13 opens the panel by calling
 * TOOLBAR_BUTTON_TOGGLE in the toolbar's document, which opened p05's panel
 * (2026-10-04, same log, "An in-game panel of ours takes clicks, and opens
 * from code in the toolbar's and the EFB's pages").
 *
 * The SPB asset group needs fspackagetool, which hangs while MSFS runs, so
 * close the sim first; a package is read when the sim starts. To take it out,
 * delete crosscheck-p13-links from Community.
 */

import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const NAME = "crosscheck-p13-links"
const PANEL_ID = "PANEL_CROSSCHECK_P13"
const DIR = "CrosscheckP13"
const ICON = "ICON_TOOLBAR_CROSSCHECK_P13"
const SDK = process.env.MSFS_SDK ?? process.env.MSFS2024_SDK ?? "C:/MSFS 2024 SDK"
const PACKAGE_TOOL = path.join(SDK, "Tools", "bin", "fspackagetool.exe")
const OUT = path.join(HERE, "package")
const BUILT = path.join(OUT, "Packages", NAME)

const die = (why) => { console.error(`\n${why}`); process.exit(1) }

const tasks = execFileSync("tasklist", ["/fo", "csv", "/nh"], { encoding: "utf8" })
if (/"FlightSimulator2024\.exe"/i.test(tasks)) die("MSFS is running. fspackagetool hangs while it runs: close the sim and run this again.")
if (!fs.existsSync(PACKAGE_TOOL)) die(`No fspackagetool at ${PACKAGE_TOOL}: set MSFS_SDK.`)

function community() {
  const cfg = path.join(process.env.APPDATA ?? "", "Microsoft Flight Simulator 2024", "UserCfg.opt")
  if (!fs.existsSync(cfg)) die(`No UserCfg.opt at ${cfg}.`)
  const line = fs.readFileSync(cfg, "utf8").split(/\r?\n/).find((l) => /^\s*InstalledPackagesPath/i.test(l))
  const packages = line?.match(/"([^"]+)"/)?.[1]
  const dir = packages && path.join(packages, "Community")
  if (!dir || !fs.existsSync(dir)) die(`No Community folder from ${cfg}.`)
  return dir
}

const write = (rel, text) => {
  const file = path.join(OUT, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  return file
}

fs.rmSync(path.join(OUT, "PackageSources"), { recursive: true, force: true })

write(`PackageSources/InGamePanels/crosscheck-p13.xml`, `<?xml version="1.0" encoding="Windows-1252"?>
<SimBase.Document Type="InGamePanels" version="1,0">
  <Filename>InGamePanel_CrosscheckP13.spb</Filename>
  <InGamePanels.InGamePanelDefinition id="${PANEL_ID}" Name="Crosscheck P13" url="html_UI/InGamePanels/${DIR}/p13.html" resizeDirections="None" minWidth="20" minHeight="10" defaultWidth="20" defaultHeight="10" icon="${ICON}" buttonVisible="true">
  </InGamePanels.InGamePanelDefinition>
</SimBase.Document>
`)

// 2024 looks for toolbar icons in html_ui/icons/toolbar/ (p05, 2026-10-04).
write(`PackageSources/html_ui/icons/toolbar/${ICON}.svg`, `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M14 20 L32 10 L50 20 M14 44 L32 54 L50 44" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="32" y="38" font-family="Arial" font-size="14" font-weight="bold" fill="#ffffff" text-anchor="middle">13</text>
</svg>
`)

// Sim Update 2 put a hide class on every ingame-ui, and removing it is the
// workaround developers report (MSFS DevSupport, "In-game panels do not
// appear on the screen or there are issues with the windows"), as p05 does.
write(`PackageSources/html_ui/InGamePanels/${DIR}/p13.html`, `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <script type="text/javascript" src="/JS/coherent.js"></script>
  <script type="text/javascript" src="/JS/common.js"></script>
  <script type="text/javascript" src="/JS/simvar.js"></script>
  <link rel="import" href="/templates/ingameUi/ingameUi.html" />
</head>
<body>
  <ingame-ui id="CrosscheckP13" panel-id="${PANEL_ID}" title="Crosscheck P13" class="ingameUiFrame">
    <div style="color: #ffffff; font-size: 2vh; padding: 1vh;">Crosscheck p13 probe</div>
  </ingame-ui>
  <script type="text/javascript">
    (function () {
      var ui = document.getElementById("CrosscheckP13");
      if (ui) { ui.classList.remove("hide"); ui.classList.remove("panelInvisible"); }
    })();
  </script>
</body>
</html>
`)

write(`PackageDefinitions/${NAME}.xml`, `<?xml version="1.0" encoding="utf-8"?>
<AssetPackage Version="0.1.0">
	<ItemSettings>
		<ContentType>MISC</ContentType>
		<Title>Crosscheck p13 links probe</Title>
		<Manufacturer/>
		<Creator>Crosscheck</Creator>
	</ItemSettings>
	<Flags>
		<VisibleInStore>false</VisibleInStore>
		<CanBeReferenced>false</CanBeReferenced>
	</Flags>
	<!-- The package adds files and overrides none, so the closest hint serves. -->
	<PackageOrderHint>UI_PATCH</PackageOrderHint>
	<AssetGroups>
		<AssetGroup Name="InGamePanels">
			<Type>SPB</Type>
			<Flags>
				<FSXCompatibility>false</FSXCompatibility>
			</Flags>
			<AssetDir>PackageSources\\InGamePanels\\</AssetDir>
			<OutputDir>InGamePanels\\</OutputDir>
		</AssetGroup>
		<AssetGroup Name="html_ui">
			<Type>Copy</Type>
			<Flags>
				<FSXCompatibility>false</FSXCompatibility>
			</Flags>
			<AssetDir>PackageSources\\html_ui\\</AssetDir>
			<OutputDir>html_ui\\</OutputDir>
		</AssetGroup>
	</AssetGroups>
</AssetPackage>
`)
write("project.xml", `<?xml version="1.0" encoding="utf-8"?>
<Project Version="2" Name="CrosscheckP13Links" FolderName="Packages" MetadataFolderName="PackagesMetadata">
	<OutputDirectory>.</OutputDirectory>
	<TemporaryOutputDirectory>_PackageInt</TemporaryOutputDirectory>
	<Packages>
		<Package>PackageDefinitions\\${NAME}.xml</Package>
	</Packages>
	<PublishingGroups/>
</Project>
`)

console.log("packaging (fspackagetool)...")
fs.rmSync(BUILT, { recursive: true, force: true })
const p = spawnSync(PACKAGE_TOOL, [path.join(OUT, "project.xml"), "-nopause"], { stdio: "inherit", cwd: OUT })
if (p.status !== 0 || !fs.existsSync(path.join(BUILT, "manifest.json"))) die(`fspackagetool wrote no package at ${BUILT}.`)

// The sim reads a package's files from its layout.json, as menu/build.mjs
// writes it for the package fspackagetool built.
const filetime = (ms) => ((BigInt(Math.floor(ms)) + 11644473600000n) * 10000n).toString()
const files = []
;(function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) walk(abs, r)
    else if (e.name !== "layout.json" && e.name !== "manifest.json") files.push({ path: r.toLowerCase(), size: fs.statSync(abs).size, date: filetime(fs.statSync(abs).mtimeMs) })
  }
})(BUILT, "")
const rows = files.map((f) => `    {\n      "path": ${JSON.stringify(f.path)},\n      "size": ${f.size},\n      "date": ${f.date}\n    }`).join(",\n")
fs.writeFileSync(path.join(BUILT, "layout.json"), `{\n  "content": [\n${rows}\n  ]\n}\n`)
console.log(`layout.json written: ${files.length} file(s)`)
if (process.argv.includes("--no-install")) process.exit(0)

const target = path.join(community(), NAME)
fs.rmSync(target, { recursive: true, force: true })
fs.cpSync(BUILT, target, { recursive: true })
console.log(`\ninstalled to Community\\${NAME}. Start MSFS: packages are read at startup.`)
