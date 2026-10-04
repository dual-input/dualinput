/*
 * Builds p05's package, crosscheck-p05-ingame: one see-through in-game panel,
 * a column down the right of the screen, that stays open and slides its own
 * elements in and out: the pre-flight card with a Start flying button, and a
 * short notice. Whether clicks on the column's clear part reach the cockpit
 * is untested.
 *
 *   node experiments/areas/interface/ingame/build.mjs
 *
 * The definition and the page follow a working MSFS 2020 template
 * (github.com/bymaximus/msfs2020-toolbar-window-template, master,
 * maximus-ingamepanels-custom): an InGamePanels document compiled by an SPB
 * asset group, sizes and position in percent of the screen, and a page whose
 * ingame-ui element is wrapped in a custom element. The always-open,
 * see-through frame is ChasePlane's overlay's, which covers the whole screen:
 * its ingame-ui attributes, pointer-events none on the page, and CSS
 * transitions (read in p42-util-chaseplane 2026.39.1.16,
 * HTML_UI/InGamePanels/P42ChasePlane/P42ChasePlane_overlay.html).
 *
 * The first build, a column 22% wide, opened from the toolbar, counted clicks
 * on its button, and opened and closed from code with
 * Coherent.call("TOOLBAR_BUTTON_TOGGLE", id, open) run in the toolbar's page
 * or the EFB's page, though not in a cockpit page (p05, 2026-10-04).
 *
 * The page keeps its state, and functions to drive it from the inspector, on
 * window.CROSSCHECK_P05: show("preflight"), hide("preflight"), and
 * notice(title, body, severity, ms).
 *
 * Then: in the sim, Dev Mode, Project Editor, open ingame/package/project.xml
 * and Build and Mount crosscheck-p05-ingame.
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

// A column down the right of the screen. Sizes are percent of the screen's
// height: a width of 100 came out as a square at the left, 1,360 by 1,360
// pixels in a 2,401 by 1,360 window, and 1,000 as 2,040 by 1,360, still at
// the left, so the sim caps a panel at 150% of the height (p05, 2026-10-04).
// The first build's column, 22 wide, sat at the right.
write("PackageSources/InGamePanels/crosscheck-p05.xml", `<?xml version="1.0" encoding="Windows-1252"?>
<SimBase.Document Type="InGamePanels" version="1,0">
  <Filename>InGamePanel_CrosscheckP05.spb</Filename>
  <InGamePanels.InGamePanelDefinition id="${PANEL_ID}" Name="Crosscheck" url="html_UI/InGamePanels/${DIR}/p05.html" resizeDirections="None" minWidth="48" minHeight="100" defaultWidth="48" defaultHeight="100" defaultTop="0" defaultRight="0" icon="${ICON}" buttonVisible="true">
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
    <ingame-ui id="CrosscheckP05" panel-id="${PANEL_ID}" title="" class="ingameUiFrame" isPanelCloseable="false" collapsible="false" noBackground="true" handlebygame="true" resize="none" auto-inside="" is-transparent>
      <div class="cc-card" id="cc-preflight">
        <div class="cc-head"><span class="cc-brand">CROSSCHECK</span><span class="cc-pill">PRE-FLIGHT</span></div>
        <div class="cc-title">James joined in the right seat</div>
        <div class="cc-row"><span class="cc-dot cc-error"></span>Different Baron versions: you 0.1.1, James 0.1.0</div>
        <div class="cc-row"><span class="cc-dot cc-warning"></span>Different liveries: you N58BK, James N2238Z</div>
        <div class="cc-row"><span class="cc-dot cc-ok"></span>Same Crosscheck, 0.4.2</div>
        <div class="cc-start" id="cc-start">Start flying</div>
        <div class="cc-live" id="cc-live">0 clicks</div>
      </div>
      <div class="cc-notice" id="cc-notice">
        <span class="cc-mark cc-ok" id="cc-notice-mark"></span>
        <div><div class="cc-notice-title" id="cc-notice-title"></div><div class="cc-notice-body" id="cc-notice-body"></div></div>
      </div>
    </ingame-ui>
  </crosscheck-p05-panel>
</body>
</html>
`)

// The column is the screen's full height, so vh is the screen's. Only the
// card and the notice take the mouse, as ChasePlane's overlay does with
// pointer-events none on its page.
write(`PackageSources/html_ui/InGamePanels/${DIR}/p05.css`, `/* Written by experiments/areas/interface/ingame/build.mjs. */
html, body { background: transparent !important; pointer-events: none; width: 100%; height: 100%; overflow: hidden; }
ingame-ui#CrosscheckP05, ingame-ui#CrosscheckP05 .ingameUiContent, ingame-ui#CrosscheckP05 .ingameUiWrapper {
  background: transparent !important; width: 100% !important; height: 100% !important; pointer-events: none !important;
}
.cc-card, .cc-notice {
  position: absolute; right: 1.6vh; box-sizing: border-box;
  border-radius: 1.6vh; border: 0.15vh solid rgba(160, 190, 255, 0.35);
  background-color: rgba(12, 18, 30, 0.84);
  color: #f2f5fa; font-family: "Roboto", "Segoe UI", sans-serif;
  pointer-events: all;
  opacity: 0; transform: translateX(115%);
  transition: transform 0.45s ease, opacity 0.45s ease;
}
.cc-shown { opacity: 1; transform: translateX(0); }
.cc-card { top: 24vh; width: 42vh; padding: 1.6vh 1.8vh; font-size: 1.6vh; }
.cc-head { display: flex; flex-direction: row; justify-content: space-between; align-items: center; }
.cc-brand { font-size: 1.1vh; letter-spacing: 0.3vh; color: #9db8ff; font-weight: bold; }
.cc-pill { font-size: 1vh; letter-spacing: 0.15vh; padding: 0.3vh 0.8vh; border-radius: 1vh; background-color: rgba(157, 184, 255, 0.18); color: #c9d7ff; }
.cc-title { font-size: 2.1vh; font-weight: bold; margin: 1.1vh 0 0.9vh 0; }
.cc-row { display: flex; flex-direction: row; align-items: center; margin-bottom: 0.6vh; }
.cc-dot { display: inline-block; width: 1vh; height: 1vh; border-radius: 0.5vh; margin-right: 1vh; flex-shrink: 0; }
.cc-error { background-color: #ff5a4e; }
.cc-warning { background-color: #ffb732; }
.cc-ok { background-color: #3ccf7a; }
.cc-info { background-color: #6f9bff; }
.cc-start {
  margin-top: 1.4vh; padding: 1vh 0; text-align: center; border-radius: 2vh;
  background-color: #3d7bff; color: #ffffff; font-size: 1.8vh; font-weight: bold; cursor: pointer;
}
.cc-start:hover { background-color: #5a8fff; }
.cc-start.cc-pressed { background-color: #2c5fd0; }
.cc-live { margin-top: 0.8vh; font-size: 1.1vh; color: #6f7b90; text-align: right; }
.cc-notice { top: 14vh; width: 42vh; padding: 1.3vh 1.8vh; display: flex; flex-direction: row; align-items: center; }
.cc-mark { width: 0.7vh; align-self: stretch; border-radius: 0.35vh; margin-right: 1.4vh; flex-shrink: 0; }
.cc-notice-title { font-size: 2vh; font-weight: bold; }
.cc-notice-body { font-size: 1.5vh; color: #c3cad6; margin-top: 0.4vh; }
`)

// Runs in Coherent GT: no class fields, optional chaining, or ??
// (CLAUDE.md, Before writing code that runs in a panel).
write(`PackageSources/html_ui/InGamePanels/${DIR}/p05.js`, `// Written by experiments/areas/interface/ingame/build.mjs.
// Shows the pre-flight card when the panel opens. Start flying counts its
// presses into L:CROSSCHECK_P05_CLICKS, slides the card out, and shows a
// notice for 4s. window.CROSSCHECK_P05 keeps the state and the functions the
// inspector drives it with.
class CrosscheckP05Panel extends TemplateElement {
  constructor() {
    super();
    this.clicks = 0;
    this.noticeTimer = null;
  }
  connectedCallback() {
    super.connectedCallback();
    var self = this;
    var ui = this.querySelector("ingame-ui");
    // Sim Update 2 put a hide class on every ingame-ui, and removing it is the
    // workaround developers report (MSFS DevSupport, "In-game panels do not
    // appear on the screen or there are issues with the windows").
    if (ui) { ui.classList.remove("hide"); ui.classList.remove("panelInvisible"); }
    var api = window.CROSSCHECK_P05 = { clicks: 0, connected: Date.now(), active: false };
    api.show = function (id) { var el = document.getElementById("cc-" + id); if (el) el.classList.add("cc-shown"); return !!el; };
    api.hide = function (id) { var el = document.getElementById("cc-" + id); if (el) el.classList.remove("cc-shown"); return !!el; };
    api.notice = function (title, body, severity, ms) {
      document.getElementById("cc-notice-title").textContent = title;
      document.getElementById("cc-notice-body").textContent = body || "";
      document.getElementById("cc-notice-mark").className = "cc-mark cc-" + (severity || "info");
      api.show("notice");
      if (self.noticeTimer) clearTimeout(self.noticeTimer);
      self.noticeTimer = setTimeout(function () { api.hide("notice"); }, ms || 4000);
      return true;
    };
    var start = document.getElementById("cc-start");
    var live = document.getElementById("cc-live");
    start.addEventListener("mousedown", function () { start.classList.add("cc-pressed"); });
    start.addEventListener("mouseup", function () { start.classList.remove("cc-pressed"); });
    start.addEventListener("click", function () {
      self.clicks++;
      api.clicks = self.clicks;
      live.textContent = self.clicks + (self.clicks === 1 ? " click" : " clicks");
      SimVar.SetSimVarValue("L:CROSSCHECK_P05_CLICKS", "number", self.clicks);
      api.hide("preflight");
      setTimeout(function () { api.notice("You're flying with James", "Sync started. James is in the right seat.", "ok", 4000); }, 500);
    });
    if (ui) {
      ui.addEventListener("panelActive", function () { api.active = true; });
      ui.addEventListener("panelInactive", function () { api.active = false; });
    }
    // In after a moment, so the slide shows.
    setTimeout(function () { api.show("preflight"); }, 600);
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
	<!-- The Project Editor asks for a hint before it builds. The package adds
	     files and overrides none, so the closest kind serves. -->
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
