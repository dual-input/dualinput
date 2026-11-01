// Compiles the banner's in-game panel definition, the one file of ours in the sim's own binary format apart from the
// figure's model, with the sim's fspackagetool, and commits nothing itself: it leaves what came out in
// src/sim-package/panel/compiled/, with source.json holding the source's SHA-256, for you to commit
// (record/areas/build/01-the-build.md, "Files compiled with the sim").
//
// When you change src/sim-package/panel/InGamePanels/dualinput-banner.xml:
//   1. Close the sim in full, since fspackagetool hangs while it runs and fails while a crashed one lingers.
//   2. Run this: node tools/compile-panel.ts
//   3. Commit src/sim-package/panel/compiled/.

import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { COMPILED, PANEL_SOURCE, panelSourceHash, SOURCE_JSON, SPB } from "./lib/panel.ts"
import { ROOT } from "./lib/repo.ts"
import { Failed, main } from "./lib/run.ts"
import { sdkFolder } from "./lib/sdk.ts"

/** The name our temporary package goes by. It's never installed, since only its compiled file is kept. */
const NAME = "dualinput-panel"
const WORK = path.join(ROOT, "target", "compile-panel")

const DEFINITION = `<?xml version="1.0" encoding="utf-8"?>
<AssetPackage Version="0.1.0">
	<ItemSettings>
		<ContentType>MISC</ContentType>
		<Title>Dual Input panel</Title>
		<Manufacturer/>
		<Creator>Dual Input</Creator>
	</ItemSettings>
	<Flags>
		<VisibleInStore>false</VisibleInStore>
		<CanBeReferenced>false</CanBeReferenced>
	</Flags>
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
	</AssetGroups>
</AssetPackage>
`

const PROJECT = `<?xml version="1.0" encoding="utf-8"?>
<Project Version="2" Name="DualInputPanel" FolderName="Packages" MetadataFolderName="PackagesMetadata">
	<OutputDirectory>.</OutputDirectory>
	<TemporaryOutputDirectory>_PackageInt</TemporaryOutputDirectory>
	<Packages>
		<Package>PackageDefinitions\\${NAME}.xml</Package>
	</Packages>
	<PublishingGroups/>
</Project>
`

main(async () => {
  const tasks = execFileSync("tasklist", ["/fo", "csv", "/nh"], { encoding: "utf8" })
  if (/"FlightSimulator2024\.exe"/i.test(tasks)) throw new Failed("the sim is running, and fspackagetool hangs while it runs: close the sim and run this again")
  const tool = path.join(sdkFolder(), "Tools", "bin", "fspackagetool.exe")
  if (!fs.existsSync(tool)) throw new Failed(`no fspackagetool at ${tool}: run node tools/setup.ts`)

  fs.rmSync(WORK, { recursive: true, force: true })
  fs.mkdirSync(path.join(WORK, "PackageDefinitions"), { recursive: true })
  fs.mkdirSync(path.join(WORK, "PackageSources", "InGamePanels"), { recursive: true })
  fs.copyFileSync(PANEL_SOURCE, path.join(WORK, "PackageSources", "InGamePanels", path.basename(PANEL_SOURCE)))
  fs.writeFileSync(path.join(WORK, "PackageDefinitions", `${NAME}.xml`), DEFINITION)
  fs.writeFileSync(path.join(WORK, "project.xml"), PROJECT)

  const compile = spawnSync(tool, [path.join(WORK, "project.xml"), "-nopause"], { stdio: "inherit", cwd: WORK })
  const out = path.join(WORK, "Packages", NAME, "InGamePanels", SPB)
  if (compile.status !== 0 || !fs.existsSync(out)) throw new Failed(`fspackagetool wrote no ${SPB} at ${out}`)

  // manifest.json and _PackageInt\ stay behind, since tools/build.ts writes the package's own, and _PackageInt\ holds the home folder's path.
  fs.mkdirSync(COMPILED, { recursive: true })
  fs.copyFileSync(out, path.join(COMPILED, SPB))
  fs.writeFileSync(SOURCE_JSON, `${JSON.stringify({ [path.basename(PANEL_SOURCE)]: panelSourceHash() }, null, 2)}\n`)
  console.log(`compiled ${SPB} into ${path.relative(ROOT, COMPILED)}: commit it`)
})
