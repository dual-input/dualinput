// The profile extension, VS Code's client of the language server it carries,
// `dualinput-profile-builder serve`, which checks and formats profiles and builds each save into
// Dual Input's local folder. The server owns building and the local folder, so another editor
// needs only a client of its own, and this holds what only VS Code draws: the status bar, the
// commands, the Output panel, where the server's log and each build's report go, and the palette
// each theme needs in the author's settings (record/areas/profiles/03-the-extension.md, "How it
// works").

import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import * as vscode from "vscode"
import { ExecuteCommandRequest, LanguageClient } from "vscode-languageclient/node"

import { type Palette, type Rule, paletteOf, palettes, uiThemeOf, withPalette } from "./palette.ts"
import { type Build, Builds, kindOf, PATTERNS, profileName } from "./status.ts"

/** The language's ID, which package.json's `contributes.languages` names too. */
const LANGUAGE = "dualinput-profile"

let client: LanguageClient | undefined

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Dual Input Profiles", { log: true })
  const watchers = PATTERNS.map((glob) => vscode.workspace.createFileSystemWatcher(glob))
  // The client reads `dualInput.trace.server` by its ID, and logs to the panel it's given. The
  // .vsix carries the server at bin/dualinput-profile-builder.exe, which tools/lib/profile-extension.ts
  // packs it as, so change both together.
  const server = new LanguageClient(
    "dualInput",
    "Dual Input Profiles",
    { command: context.asAbsolutePath(path.join("bin", "dualinput-profile-builder.exe")), args: ["serve"] },
    {
      documentSelector: [{ scheme: "file", language: LANGUAGE }],
      synchronize: { configurationSection: "dualInput", fileEvents: watchers },
      outputChannel: output,
    },
  )
  client = server

  const builds = new Builds()
  const item = vscode.window.createStatusBarItem("dualInput.bundle", vscode.StatusBarAlignment.Left)
  item.name = "Dual Input bundle"
  const show = (): void => {
    const document = vscode.window.activeTextEditor?.document
    const kind = document?.languageId === LANGUAGE ? kindOf(document.uri.path) : null
    const status = document && kind ? builds.status(document.uri.toString(), kind) : null
    if (!status) return item.hide()
    item.text = status.text
    item.tooltip = status.tooltip
    item.show()
  }

  // The server writes each URI as VS Code does, as `file:///c%3A/...`, so its URIs, here and in
  // `dualInput.importers`' answer, compare with an editor's as strings.
  server.onNotification("dualInput/build", (build: Build) => {
    builds.record(build)
    show()
  })

  /** Runs one of the server's commands on a file, or shows why it couldn't. */
  const execute = async (command: string, uri: vscode.Uri, failed: string): Promise<boolean> => {
    try {
      await server.sendRequest(ExecuteCommandRequest.type, { command, arguments: [server.code2ProtocolConverter.asUri(uri)] })
      return true
    } catch (error) {
      void vscode.window.showErrorMessage(`${failed}: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  /** The profiles importing a module, which the server knows from reading every profile in the workspace. */
  const importers = async (module: vscode.Uri): Promise<string[]> => {
    try {
      const found: unknown = await server.sendRequest(ExecuteCommandRequest.type, { command: "dualInput.importers", arguments: [server.code2ProtocolConverter.asUri(module)] })
      return Array.isArray(found) ? found.filter((uri): uri is string => typeof uri === "string") : []
    } catch (error) {
      void vscode.window.showErrorMessage(`Dual Input couldn't list the profiles importing ${profileName(module.toString())}: ${error instanceof Error ? error.message : String(error)}`)
      return []
    }
  }

  /** The profile or module in the active editor, which the palette offers these commands for. */
  const active = (): { document: vscode.TextDocument; kind: "profile" | "module" } | undefined => {
    const document = vscode.window.activeTextEditor?.document
    const kind = document?.languageId === LANGUAGE ? kindOf(document.uri.path) : null
    return document && kind ? { document, kind } : undefined
  }

  // The client registers the server's own commands, `dualInput.build`, `dualInput.removeLocalBundle`,
  // `dualInput.importers`, and `dualInput.localFolder`, with VS Code under those IDs, so the
  // extension's take others. `COMMANDS` in tools/profile-builder/src/serve.rs lists the server's,
  // so change both together.
  context.subscriptions.push(
    output,
    item,
    ...watchers,
    ...watchColors(context, output),
    vscode.window.onDidChangeActiveTextEditor(show),
    vscode.commands.registerCommand("dualInput.buildNow", async () => {
      const file = active()
      if (!file) return
      // Saving a changed file reaches the server's `willSave` as a manual save, which builds when
      // `dualInput.buildOnSave` is on, so a second build here would repeat it. Saving an unchanged
      // file sends the server nothing, so "Build now" builds that one itself. That VS Code gives an
      // extension's save the manual reason is unverified; the Output panel showing one build per
      // "Build now" on a changed file settles it.
      const builtBySave = file.document.isDirty && vscode.workspace.getConfiguration("dualInput", file.document.uri).get<boolean>("buildOnSave", true)
      if (!(await file.document.save())) {
        void vscode.window.showErrorMessage(`Dual Input couldn't save ${profileName(file.document.uri.path)}, so it built nothing`)
        return
      }
      if (!builtBySave) await execute("dualInput.build", file.document.uri, `Dual Input didn't build ${profileName(file.document.uri.path)}`)
    }),
    // The server reports a removed bundle in a `dualInput/build` notification of its own, with no
    // hash, before it answers, so the status bar follows from that.
    vscode.commands.registerCommand("dualInput.removeBundle", async () => {
      const file = active()
      if (!file) return
      const profile = file.kind === "profile" ? file.document.uri.toString() : await pickImporter(builds, await importers(file.document.uri))
      if (!profile) return
      await execute("dualInput.removeLocalBundle", vscode.Uri.parse(profile), `Dual Input didn't remove ${profileName(profile)}'s bundle`)
    }),
    vscode.commands.registerCommand("dualInput.openLocalFolder", () => openLocalFolder(server, output)),
    vscode.commands.registerCommand("dualInput.restartServer", async () => {
      try {
        if (server.needsStop()) await server.stop()
        await server.start()
      } catch {
        // The client has shown the failure and logged it to the Output panel.
      }
    }),
  )
  show()
  // A server that fails to start leaves the commands and the status bar working, and the client
  // shows the failure and logs it to the Output panel.
  server.start().catch(() => undefined)
}

export function deactivate(): Promise<void> | undefined {
  return client?.needsStop() ? client.stop() : undefined
}

/** The `uiTheme` a theme of each kind declares in its contribution, which `uiThemeOf` reads. */
const UI_THEMES: Record<vscode.ColorThemeKind, string> = {
  [vscode.ColorThemeKind.Light]: "vs",
  [vscode.ColorThemeKind.Dark]: "vs-dark",
  [vscode.ColorThemeKind.HighContrast]: "hc-black",
  [vscode.ColorThemeKind.HighContrastLight]: "hc-light",
}

/**
 * Keeps the palette the active theme's kind calls for, or the one `dualInput.colors` forces, in
 * the author's user settings, now and whenever the theme or that setting changes. The defaults
 * give a theme the light palette by its name alone, so without this a light theme whose name
 * lacks "Light" colors profiles for a dark background.
 *
 * Each check runs after the one before has written, since each writes the whole setting from what
 * it read, and two at once would lose the first one's change.
 */
function watchColors(context: vscode.ExtensionContext, output: vscode.LogOutputChannel): vscode.Disposable[] {
  const all = palettes(context.extension.packageJSON)
  let checked = Promise.resolve()
  const check = (): void => {
    checked = checked.then(() => keepColors(all, output)).catch((error) => output.error(`Dual Input couldn't check the theme's colors: ${error instanceof Error ? error.message : String(error)}`))
  }
  check()
  return [
    vscode.window.onDidChangeActiveColorTheme(check),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("workbench.colorTheme") || event.affectsConfiguration("dualInput.colors")) check()
    }),
  ]
}

/** Writes the palette the theme `workbench.colorTheme` names needs, under its key, if the setting lacks it. */
async function keepColors(all: Record<Palette, Rule[]>, output: vscode.LogOutputChannel): Promise<void> {
  const theme = vscode.workspace.getConfiguration("workbench").get<string>("colorTheme")
  if (!theme) return
  const forced = vscode.workspace.getConfiguration("dualInput").get<string>("colors")
  let palette: Palette
  if (forced === "dark" || forced === "light") palette = forced
  else {
    // The theme picker applies each theme it previews without writing its name to
    // `workbench.colorTheme`, and writes the name once a theme is picked, which the listener on
    // that setting catches (read in VS Code 1.147.0, workbench.desktop.main.js,
    // `writeConfiguration`). A check during a preview would put the previewed theme's palette under
    // the named theme's key, so the check acts only while the active theme is of the kind the named
    // theme declares, when the palette it picks is the named theme's own.
    const active = UI_THEMES[vscode.window.activeColorTheme.kind]
    if (uiThemeOf(theme, vscode.extensions.all.map((extension) => extension.packageJSON)) !== active) return
    palette = paletteOf(active)
  }
  const editor = vscode.workspace.getConfiguration("editor")
  const next = withPalette(editor.inspect("tokenColorCustomizations")?.globalValue, theme, palette, all)
  if (!next) return
  try {
    await editor.update("tokenColorCustomizations", next.value, vscode.ConfigurationTarget.Global)
  } catch (error) {
    output.error(`Dual Input couldn't write the ${palette} palette for ${theme} into your user settings: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Asks which profile's bundle to remove, of the module's importers that have one in the local
 * folder, and returns its URI.
 */
async function pickImporter(builds: Builds, importers: string[]): Promise<string | undefined> {
  const bundled = builds.bundled(importers)
  if (!bundled.length) {
    void vscode.window.showInformationMessage("No profile that imports this module has a bundle in the local folder.")
    return undefined
  }
  const items = bundled.map((build) => ({ label: profileName(build.profile), description: build.hash?.slice(0, 7), profile: build.profile }))
  return (await vscode.window.showQuickPick(items, { placeHolder: "Remove which profile's bundle from the local folder?" }))?.profile
}

/**
 * Shows the local folder in File Explorer, at the path the server's `dualInput.localFolder` gives,
 * since the server owns the folder: the one the `dualInput.localFolder` setting names, or else the
 * one in the core's data folder.
 */
async function openLocalFolder(server: LanguageClient, output: vscode.LogOutputChannel): Promise<void> {
  let folder: unknown
  try {
    folder = await server.sendRequest(ExecuteCommandRequest.type, { command: "dualInput.localFolder", arguments: [] })
  } catch (error) {
    void vscode.window.showErrorMessage(`Dual Input couldn't find the local folder: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  if (typeof folder !== "string" || !folder) {
    void vscode.window.showErrorMessage("Dual Input couldn't find the local folder: the language server named none.")
    return
  }
  if (!fs.existsSync(folder)) {
    void vscode.window.showInformationMessage(`The local folder, ${folder}, doesn't exist yet. The first save that builds a bundle makes it.`)
    return
  }
  // explorer.exe exits with 1 when it opens a folder, so only a failure to start it is an error.
  spawn("explorer.exe", [folder], { detached: true, stdio: "ignore" })
    .on("error", (error) => output.error(`File Explorer didn't start: ${error.message}`))
    .unref()
}
