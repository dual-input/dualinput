/*
 * Builds p05's package, crosscheck-p05-ingame: one in-game panel, see-through
 * and pinned to the right of the screen, holding the pre-flight card with a
 * Start flying button, for the sim's Project Editor to Build and Mount.
 *
 *   node experiments/areas/interface/ingame/build.mjs
 *
 * The definition and the page follow a working MSFS 2020 template
 * (github.com/bymaximus/msfs2020-toolbar-window-template, master,
 * maximus-ingamepanels-custom): an InGamePanels document compiled by an SPB
 * asset group, sizes and position in percent of the screen, and a page whose
 * ingame-ui element is wrapped in a custom element. The see-through frame
 * takes ChasePlane's overlay's attributes, noBackground, is-transparent, and
 * an empty title (read in p42-util-chaseplane 2026.39.1.16,
 * HTML_UI/InGamePanels/P42ChasePlane/P42ChasePlane_overlay.html).
 *
 * Then: in the sim, Dev Mode, Project Editor, open ingame/package/project.xml
 * and Build and Mount crosscheck-p05-ingame. The panel's toolbar button opens
 * it, and so does Coherent.call("TOOLBAR_BUTTON_TOGGLE", "PANEL_CROSSCHECK_P05",
 * true) from a page that has the sim's toolbar service (read in fs-base-ui,
 * html_ui/JS/Services/ToolBarPanels.js, ToolBarListener.setButtonChildActive).
 *
 * Everything under package/ is written here, and .gitignore keeps it out.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, "package")
const NAME = "crosscheck-p05-ingame"
const PANEL_ID = "PANEL_CROSSCHECK_P05"
const DIR = "CrosscheckP05"
const ICON = "ICON_TOOLBAR_CROSSCHECK_P05"

const write = (rel, text) => {
  const file = path.join(OUT, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}
fs.rmSync(path.join(OUT, "PackageSources"), { recursive: true, force: true })

// Percent of the screen, as the template's are: a column on the right.
write("PackageSources/InGamePanels/crosscheck-p05.xml", `<?xml version="1.0" encoding="Windows-1252"?>
<SimBase.Document Type="InGamePanels" version="1,0">
  <Filename>InGamePanel_CrosscheckP05.spb</Filename>
  <InGamePanels.InGamePanelDefinition id="${PANEL_ID}" Name="Crosscheck" url="html_UI/InGamePanels/${DIR}/p05.html" resizeDirections="Both" minWidth="16" minHeight="20" defaultWidth="22" defaultHeight="42" defaultTop="22" defaultRight="1" icon="${ICON}" buttonVisible="true">
  </InGamePanels.InGamePanelDefinition>
</SimBase.Document>
`)

write(`PackageSources/html_ui/Textures/Menu/toolbar/${ICON}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M14 20 L32 10 L50 20 M14 44 L32 54 L50 44" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="32" cy="32" r="6" fill="#ffffff"/></svg>\n`)

write(`PackageSources/html_ui/InGamePanels/${DIR}/p05.html`, `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="/SCSS/common.css" />
  <link rel="stylesheet" href="p05.css" />
  <script type="text/javascript" src="/JS/coherent.js"></script>
  <script type="text/javascript" src="/JS/common.js"></script>
  <script type="text/javascript" src="/JS/dataStorage.js"></script>
  <script type="text/javascript" src="/JS/simvar.js"></script>
  <script type="text/javascript" src="/JS/buttons.js"></script>
  <script type="text/javascript" src="/JS/Services/ToolBarPanels.js"></script>
  <link rel="import" href="/templates/ingameUi/ingameUi.html" />
  <script type="text/javascript" src="p05.js"></script>
</head>
<body class="border-box">
  <crosscheck-p05-panel>
    <ingame-ui id="CrosscheckP05" panel-id="${PANEL_ID}" title="" class="ingameUiFrame" noBackground="true" is-transparent>
      <div class="cc-card">
        <div class="cc-head"><span class="cc-brand">CROSSCHECK</span><span class="cc-pill">PRE-FLIGHT</span></div>
        <div class="cc-title">James joined in the right seat</div>
        <div class="cc-row"><span class="cc-dot cc-error"></span>Different Baron versions: you 0.1.1, James 0.1.0</div>
        <div class="cc-row"><span class="cc-dot cc-warning"></span>Different liveries: you N58BK, James N2238Z</div>
        <div class="cc-row"><span class="cc-dot cc-ok"></span>Same Crosscheck, 0.4.2</div>
        <div class="cc-start" id="crosscheck-start">Start flying</div>
        <div class="cc-live" id="crosscheck-live">0 clicks</div>
      </div>
    </ingame-ui>
  </crosscheck-p05-panel>
</body>
</html>
`)

write(`PackageSources/html_ui/InGamePanels/${DIR}/p05.css`, `/* Written by experiments/areas/interface/ingame/build.mjs. */
html, body { background: transparent !important; }
ingame-ui#CrosscheckP05 { width: 100% !important; height: 100% !important; background: transparent !important; }
ingame-ui#CrosscheckP05 .ingameUiContent, ingame-ui#CrosscheckP05 .ingameUiWrapper { background: transparent !important; width: 100% !important; height: 100% !important; }
.cc-card {
  box-sizing: border-box; width: 100%; padding: 1.4vh 1.6vh;
  border-radius: 1.6vh; border: 0.15vh solid rgba(160, 190, 255, 0.35);
  background-color: rgba(12, 18, 30, 0.82);
  color: #f2f5fa; font-family: "Roboto", "Segoe UI", sans-serif; font-size: 1.6vh;
}
.cc-head { display: flex; flex-direction: row; justify-content: space-between; align-items: center; }
.cc-brand { font-size: 1.1vh; letter-spacing: 0.3vh; color: #9db8ff; font-weight: bold; }
.cc-pill { font-size: 1vh; letter-spacing: 0.15vh; padding: 0.3vh 0.8vh; border-radius: 1vh; background-color: rgba(157, 184, 255, 0.18); color: #c9d7ff; }
.cc-title { font-size: 2.1vh; font-weight: bold; margin: 1.1vh 0 0.9vh 0; }
.cc-row { display: flex; flex-direction: row; align-items: center; margin-bottom: 0.6vh; }
.cc-dot { display: inline-block; width: 1vh; height: 1vh; border-radius: 0.5vh; margin-right: 1vh; flex-shrink: 0; }
.cc-error { background-color: #ff5a4e; }
.cc-warning { background-color: #ffb732; }
.cc-ok { background-color: #3ccf7a; }
.cc-start {
  margin-top: 1.4vh; padding: 1vh 0; text-align: center; border-radius: 2vh;
  background-color: #3d7bff; color: #ffffff; font-size: 1.8vh; font-weight: bold; cursor: pointer;
}
.cc-start:hover { background-color: #5a8fff; }
.cc-start.cc-pressed { background-color: #2c5fd0; }
.cc-live { margin-top: 0.8vh; font-size: 1.1vh; color: #6f7b90; text-align: right; }
`)

// Runs in Coherent GT: no class fields, optional chaining, or ??
// (CLAUDE.md, Before writing code that runs in a panel).
write(`PackageSources/html_ui/InGamePanels/${DIR}/p05.js`, `// Written by experiments/areas/interface/ingame/build.mjs.
// Counts presses of Start flying into L:CROSSCHECK_P05_CLICKS, so p05 can tell
// from outside that the panel takes clicks, and keeps its state on
// window.CROSSCHECK_P05 for the inspector.
class CrosscheckP05Panel extends TemplateElement {
  constructor() {
    super();
    this.clicks = 0;
  }
  connectedCallback() {
    super.connectedCallback();
    var self = this;
    var ui = this.querySelector("ingame-ui");
    // Sim Update 2 put a hide class on every ingame-ui, and removing it is the
    // workaround developers report (MSFS DevSupport, "In-game panels do not
    // appear on the screen or there are issues with the windows").
    if (ui) { ui.classList.remove("hide"); ui.classList.remove("panelInvisible"); }
    var start = this.querySelector("#crosscheck-start");
    var live = this.querySelector("#crosscheck-live");
    window.CROSSCHECK_P05 = { clicks: 0, connected: Date.now(), active: false };
    if (start) {
      start.addEventListener("mousedown", function () { start.classList.add("cc-pressed"); });
      start.addEventListener("mouseup", function () { start.classList.remove("cc-pressed"); });
      start.addEventListener("click", function () {
        self.clicks++;
        window.CROSSCHECK_P05.clicks = self.clicks;
        if (live) live.textContent = self.clicks + (self.clicks === 1 ? " click" : " clicks");
        SimVar.SetSimVarValue("L:CROSSCHECK_P05_CLICKS", "number", self.clicks);
      });
    }
    if (ui) {
      ui.addEventListener("panelActive", function () { window.CROSSCHECK_P05.active = true; });
      ui.addEventListener("panelInactive", function () { window.CROSSCHECK_P05.active = false; });
    }
  }
}
window.customElements.define("crosscheck-p05-panel", CrosscheckP05Panel);
checkAutoload();
`)
const check = spawnSync(process.execPath, ["--check", path.join(OUT, "PackageSources", "html_ui", "InGamePanels", DIR, "p05.js")], { stdio: "inherit" })
if (check.status !== 0) { console.error("p05.js doesn't parse."); process.exit(1) }

write(`PackageDefinitions/${NAME}.xml`, `<?xml version="1.0" encoding="utf-8"?>
<AssetPackage Version="0.1.0">
	<ItemSettings>
		<ContentType>MISC</ContentType>
		<Title>Crosscheck p05 in-game panel probe</Title>
		<Manufacturer/>
		<Creator>Crosscheck</Creator>
	</ItemSettings>
	<Flags>
		<VisibleInStore>false</VisibleInStore>
		<CanBeReferenced>false</CanBeReferenced>
	</Flags>
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
<Project Version="2" Name="CrosscheckP05InGame" FolderName="Packages" MetadataFolderName="PackagesMetadata">
	<OutputDirectory>.</OutputDirectory>
	<TemporaryOutputDirectory>_PackageInt</TemporaryOutputDirectory>
	<Packages>
		<Package>PackageDefinitions\\${NAME}.xml</Package>
	</Packages>
	<PublishingGroups/>
</Project>
`)
console.log(`sources written. In the sim: Dev Mode, Project Editor, open ${path.join(OUT, "project.xml")}, then Build and Mount ${NAME}.`)
