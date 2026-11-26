// The profile extension, VS Code's client of the language server it carries,
// `dualinput-profile-builder serve`, which checks and formats profiles and builds each save into
// Dual Input's local folder. The server owns building and the local folder, so another editor
// needs only a client of its own, and this holds what only VS Code draws: the status bar, the
// commands, the Output panel, where the server's log and each build's report go, the palette
// each theme needs in the author's settings, and in a session's flight, the boxes after `watch:`
// lines with each entry's hint, the Dual Input panel, and the Sync log
// (record/areas/profiles/03-the-extension.md, "How it works", 04-the-extension-in-the-sim.md,
// "The connection", and 06-the-sync-log.md, "The Sync log view").

import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import * as vscode from "vscode"
import { ExecuteCommandRequest, LanguageClient, State } from "vscode-languageclient/node"

import type { FromPanel, ToPanel } from "../panel/src/messages.ts"
import type { FromSyncLog, ToSyncLog } from "../sync-log/src/messages.ts"
import type { Update } from "../sync-log/src/view.ts"
import { type Box, type BoxKind, boxStyle, byKind, type Hint, hintStyles, hintText, KINDS, type Values } from "./boxes.ts"
import { PanelBridge, placeOf, type ServerView } from "./bridge.ts"
import { webviewPage } from "./page.ts"
import { isForced, type Palette, paletteFor, type Rule, palettes, uiThemeOf, withPalette } from "./palette.ts"
import { type Build, Builds, kindOf, PATTERNS, profileName } from "./status.ts"
import { SyncLogMirror } from "./sync-log.ts"
import { syntaxes } from "./syntax.ts"
import { docsLink, WORDS } from "./words.ts"

/** The language's ID, which package.json's `contributes.languages` names too. */
const LANGUAGE = "dualinput-profile"

/**
 * The Dual Input panel's view, which package.json's `views` names too. VS Code gives every view a command that shows
 * and focuses it, `dualInput.view.focus` for this one.
 */
const VIEW = "dualInput.view"

/** The Sync log's view, in the bottom panel, which package.json's `views` names too. */
const SYNC_LOG_VIEW = "dualInput.syncLog"

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

  /**
   * Sends the server one of its commands for the sim's features, whose answer says only that it was taken, since what
   * follows comes back in `dualInput/panel` and `dualInput/values`. A failure only logs, as the panel's calls run on
   * each key typed.
   */
  const tell = (command: string, args: unknown[]): void => {
    server.sendRequest(ExecuteCommandRequest.method, { command, arguments: args }).then(undefined, (error: unknown) => {
      output.error(`Dual Input's language server didn't take ${command}: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /**
   * Shows and focuses the Dual Input panel, then tells the server what to open in it. A panel that wasn't open loads as
   * it's shown and asks for the view the server sends next, and with the focus there, Enter in Run's value field runs.
   */
  const openPanel = async (command: string, args: unknown[]): Promise<void> => {
    await vscode.commands.executeCommand(`${VIEW}.focus`)
    tell(command, args)
  }

  const syntax = syntaxes(context.extension.packageJSON)
  const bridge = new PanelBridge(currentPalette(), { execute: ({ command, arguments: args }) => tell(command, args), reveal: (where) => void reveal(where) }, syntax)
  const syncLog = new SyncLogMirror(currentPalette(), ({ command, arguments: args }) => tell(command, args), syntax)
  const boxes = new Boxes(currentPalette())
  const repaint = (): void => {
    const palette = currentPalette()
    bridge.repaint(palette)
    syncLog.repaint(palette)
    boxes.repaint(palette)
  }
  server.onNotification("dualInput/panel", (view: ServerView) => bridge.show(view))
  server.onNotification("dualInput/values", (values: Values) => boxes.show(values))
  server.onNotification("dualInput/syncLog", (update: Update) => syncLog.show(update))
  // A stopped server sends nothing more, so the panel and the boxes would show the last state they heard as the sim's,
  // and the Sync log's rows go with it, since a new server numbers its rows afresh.
  server.onDidChangeState(({ newState }) => {
    if (newState !== State.Stopped) return
    bridge.reset()
    syncLog.reset()
    boxes.clear()
  })

  // The client registers the server's own commands, `dualInput.build`, `dualInput.removeLocalBundle`,
  // `dualInput.importers`, `dualInput.localFolder`, and the panel's `dualInput.panel.*`, with VS Code
  // under those IDs, so the extension's take others, `dualInput.run`, `dualInput.pickDisplays`, and
  // `dualInput.addAircraft` among them, which the server's code lenses name. `COMMANDS` in tools/profile-builder/src/serve.rs
  // lists the server's, so change both together.
  context.subscriptions.push(
    output,
    item,
    ...watchers,
    ...watchColors(context, output),
    boxes,
    registerPanel(context, bridge),
    registerSyncLog(context, syncLog),
    vscode.window.onDidChangeActiveColorTheme(repaint),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("dualInput.colors")) repaint()
    }),
    vscode.window.onDidChangeActiveTextEditor(show),
    // A `▶ Run` lens's command, with the file's URI and the entry's key, as the server wrote them.
    vscode.commands.registerCommand("dualInput.run", (uri: unknown, key: unknown) => {
      if (typeof uri === "string" && typeof key === "string") void openPanel("dualInput.panel.open", [uri, key])
    }),
    // The Dual Input panel's title bar shows the Sync log from a button of VS Code's own, since an author reading the
    // panel in the side bar can miss a view in the bottom panel.
    vscode.commands.registerCommand("dualInput.showSyncLog", () => vscode.commands.executeCommand(`${SYNC_LOG_VIEW}.focus`)),
    // "Run entry" names the entry by the cursor's place, which the server reads its entry from.
    vscode.commands.registerCommand("dualInput.runEntry", () => {
      const editor = vscode.window.activeTextEditor
      if (editor?.document.languageId !== LANGUAGE) return
      const converter = server.code2ProtocolConverter
      void openPanel("dualInput.panel.open", [converter.asUri(editor.document.uri), converter.asPosition(editor.selection.active)])
    }),
    // The "Pick displays" lens passes its file's URI, and from the palette, the command takes the active editor's file.
    vscode.commands.registerCommand("dualInput.pickDisplays", (uri: unknown) => {
      const document = active()?.document
      const file = typeof uri === "string" ? uri : document && server.code2ProtocolConverter.asUri(document.uri)
      if (file) void openPanel("dualInput.panel.pick", [file])
    }),
    // The lens that adds the loaded aircraft passes its file's URI, and from the palette, as in a profile with no
    // `aircraft:` yet, the command takes the active editor's file.
    vscode.commands.registerCommand("dualInput.addAircraft", (uri: unknown) => {
      const document = active()?.document
      const file = typeof uri === "string" ? uri : document && server.code2ProtocolConverter.asUri(document.uri)
      if (file) void openPanel("dualInput.panel.addAircraft", [file])
    }),
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
  // The client tells the server of each language change, so the open profiles are refreshed before
  // it starts. A server that fails to start leaves the commands and the status bar working, and the
  // client shows the failure and logs it to the Output panel.
  void refreshOptions(output).then(() => server.start().catch(() => undefined))
}

/**
 * Gives each open profile the editor settings package.json's `configurationDefaults` sets for the language, bracket pair
 * colorization off among them, which a profile VS Code restored at startup lacks. VS Code keeps no extension's defaults
 * for a language between sessions, and a restored profile keeps its bracket colors until it's reopened. A language
 * change makes VS Code read the language's settings again, so each profile goes to plain text and back
 * (record/areas/profiles/03-the-extension.md, "Highlighting").
 */
async function refreshOptions(output: vscode.LogOutputChannel): Promise<void> {
  for (const document of vscode.workspace.textDocuments.filter((open) => open.languageId === LANGUAGE)) {
    try {
      await vscode.languages.setTextDocumentLanguage(document, "plaintext")
      await vscode.languages.setTextDocumentLanguage(document, LANGUAGE)
    } catch (error) {
      output.error(`Dual Input couldn't refresh ${profileName(document.uri.path)}'s editor settings: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
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

/** The palette the active theme and `dualInput.colors` give the profile's token colors, which the boxes and the panel take too. */
function currentPalette(): Palette {
  return paletteFor(vscode.workspace.getConfiguration("dualInput").get("colors"), UI_THEMES[vscode.window.activeColorTheme.kind])
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
  const active = UI_THEMES[vscode.window.activeColorTheme.kind]
  // The theme picker applies each theme it previews without writing its name to
  // `workbench.colorTheme`, and writes the name once a theme is picked, which the listener on
  // that setting catches (read in VS Code 1.147.0, workbench.desktop.main.js,
  // `writeConfiguration`). A check during a preview would put the previewed theme's palette under
  // the named theme's key, so unless a palette is forced, the check acts only while the active
  // theme is of the kind the named theme declares, when the palette it picks is the named theme's own.
  if (!isForced(forced) && uiThemeOf(theme, vscode.extensions.all.map((extension) => extension.packageJSON)) !== active) return
  const palette = paletteFor(forced, active)
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

/**
 * Gives a view its webview's page, which loads `script`: one of the files tools/lib/profile-extension.ts packs into
 * webviews/, which the webview may load and nothing else of the extension's. VS Code drops a hidden webview's page unless
 * the extension asks it to keep the page, which its guide advises against, since a kept page costs a lot of memory
 * (documented, https://code.visualstudio.com/api/extension-guides/webview, "retainContextWhenHidden"). So each page asks
 * for its view each time it loads.
 */
function showPage(context: vscode.ExtensionContext, { webview }: vscode.WebviewView, script: string): void {
  const folder = vscode.Uri.joinPath(context.extensionUri, "webviews")
  webview.options = { enableScripts: true, localResourceRoots: [folder] }
  const file = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(folder, name)).toString()
  webview.html = webviewPage({ source: webview.cspSource, nonce: randomBytes(16).toString("base64"), script: file(script), style: file("webviews.css") })
}

/** Gives the Dual Input panel's view its webview. */
function registerPanel(context: vscode.ExtensionContext, bridge: PanelBridge): vscode.Disposable {
  return vscode.window.registerWebviewViewProvider(VIEW, {
    resolveWebviewView(view) {
      const { webview } = view
      showPage(context, view, "panel.js")
      const heard = webview.onDidReceiveMessage((message: FromPanel) => bridge.heard(message))
      const detach = bridge.attach((message: ToPanel) => void webview.postMessage(message))
      view.onDidDispose(() => {
        heard.dispose()
        detach()
      })
    },
  })
}

/** Gives the Sync log's view, in the bottom panel, its webview. */
function registerSyncLog(context: vscode.ExtensionContext, mirror: SyncLogMirror): vscode.Disposable {
  return vscode.window.registerWebviewViewProvider(SYNC_LOG_VIEW, {
    resolveWebviewView(view) {
      const { webview } = view
      showPage(context, view, "sync-log.js")
      const heard = webview.onDidReceiveMessage((message: FromSyncLog) => mirror.heard(message))
      const detach = mirror.attach((message: ToSyncLog) => void webview.postMessage(message))
      view.onDidDispose(() => {
        heard.dispose()
        detach()
      })
    },
  })
}

/**
 * Opens the file at a build error's place, as Run's preview names it, as `bksq-baronpro.yaml:270:45`, in the editor
 * that shows the file already, if one does.
 */
async function reveal(where: string): Promise<void> {
  const place = placeOf(where)
  const uri = place && (await findProfile(place.file))
  if (!place || !uri) {
    void vscode.window.showWarningMessage(`Dual Input couldn't find ${where}.`)
    return
  }
  const at = new vscode.Position(place.line, place.character)
  const shown = vscode.window.visibleTextEditors.find((editor) => editor.document.uri.toString() === uri.toString())
  await vscode.window.showTextDocument(uri, { viewColumn: shown?.viewColumn, selection: new vscode.Range(at, at) })
}

/**
 * The profile or module a build error names by its file's name: an open one, since Run builds the open text, or else
 * the first of the workspace's.
 */
async function findProfile(file: string): Promise<vscode.Uri | undefined> {
  if (path.isAbsolute(file)) return vscode.Uri.file(file)
  const name = `/${file.replaceAll("\\", "/").toLowerCase()}`
  const named = (uri: vscode.Uri) => uri.path.toLowerCase().endsWith(name)
  const open = vscode.workspace.textDocuments.find((document) => document.languageId === LANGUAGE && named(document.uri))
  return open?.uri ?? (await vscode.workspace.findFiles(`{${PATTERNS.join(",")}}`)).find(named)
}

/**
 * Draws each open file's boxes, as `serve` sends them, with each entry's hint after its first, into every editor that
 * shows the file. An editor's decorations last only while VS Code shows it, so the boxes are kept by file and drawn again
 * into each editor VS Code shows.
 */
class Boxes implements vscode.Disposable {
  /** Each open file's boxes, by its URI, which the server writes as VS Code does. */
  private readonly files = new Map<string, Box[]>()
  private palette: Palette
  private types: DecorationTypes
  private readonly listening: vscode.Disposable[]

  constructor(palette: Palette) {
    this.palette = palette
    this.types = decorationTypes(palette)
    this.listening = [
      vscode.window.onDidChangeVisibleTextEditors((editors) => editors.forEach((editor) => this.draw(editor))),
      vscode.workspace.onDidCloseTextDocument((document) => this.files.delete(document.uri.toString())),
    ]
  }

  /** The server's `dualInput/values`, whose boxes replace every box the file had. */
  show({ uri, boxes }: Values): void {
    this.files.set(uri, boxes)
    this.drawEach((editor) => editor.document.uri.toString() === uri)
  }

  clear(): void {
    this.files.clear()
    this.drawEach(() => true)
  }

  /** A decoration type's look is fixed when it's made, so another palette takes new ones, which disposing the old clears. */
  repaint(palette: Palette): void {
    if (palette === this.palette) return
    this.palette = palette
    for (const type of allOf(this.types)) type.dispose()
    this.types = decorationTypes(palette)
    this.drawEach(() => true)
  }

  dispose(): void {
    for (const type of allOf(this.types)) type.dispose()
    for (const listener of this.listening) listener.dispose()
  }

  private drawEach(which: (editor: vscode.TextEditor) => boolean): void {
    for (const editor of vscode.window.visibleTextEditors) if (which(editor)) this.draw(editor)
  }

  /**
   * Each box after the end of its line, and a hint after its box. The boxes come as typing pauses, so they can name a
   * line past the file's end after the author deletes lines, and such a box is skipped.
   */
  private draw(editor: vscode.TextEditor): void {
    const { document } = editor
    const boxes = (this.files.get(document.uri.toString()) ?? []).filter((box) => box.line >= 0 && box.line < document.lineCount)
    const at = (box: Box) => {
      const end = document.lineAt(box.line).range.end
      return new vscode.Range(end, end)
    }
    const kinds = byKind(boxes)
    for (const kind of KINDS) {
      editor.setDecorations(
        this.types.boxes[kind],
        kinds[kind].map((box) => ({ range: at(box), renderOptions: { after: { contentText: box.text } } })),
      )
    }
    const hinted = boxes.flatMap((box) => (box.hint ? [{ range: at(box), hint: box.hint, text: hintText(box.hint) }] : []))
    editor.setDecorations(
      this.types.word,
      hinted.map(({ range, hint, text }) => ({ range, renderOptions: { after: { contentText: text.word } }, hoverMessage: definitionOf(hint) })),
    )
    editor.setDecorations(
      this.types.rest,
      hinted.flatMap(({ range, text }) => (text.rest ? [{ range, renderOptions: { after: { contentText: text.rest } } }] : [])),
    )
  }
}

/**
 * A hint's word's definition, which its hover shows, and its second word's, such as `withdrawn`'s reason `lost`, which
 * the log defines on a hover of its own and the hint's hover gives below the first.
 */
function definitionOf(hint: Hint): vscode.MarkdownString {
  const shown = new vscode.MarkdownString()
  for (const [at, word] of [hint.word, ...(hint.also ? [hint.also] : [])].entries()) {
    const { label, definition } = WORDS[word]
    shown.appendMarkdown(at ? "\n\n**" : "**").appendText(label).appendMarkdown("**\n\n").appendText(definition)
    const link = docsLink(word)
    if (link) shown.appendMarkdown(`\n\n[In the authors' docs](${link})`)
  }
  return shown.appendMarkdown("\n\n").appendText("The entry's latest step in the Sync log.")
}

/** The decoration types for one palette: a box of each kind, then the hint's word and the rest of its text. */
type DecorationTypes = { boxes: Record<BoxKind, vscode.TextEditorDecorationType>; word: vscode.TextEditorDecorationType; rest: vscode.TextEditorDecorationType }

function allOf(types: DecorationTypes): vscode.TextEditorDecorationType[] {
  return [types.boxes.value, types.boxes.firing, types.boxes.error, types.word, types.rest]
}

/**
 * The decoration types for `palette`, made in the order they draw at a line's end: the box, then the hint's word, then
 * the rest of its text. VS Code draws the `after`s at one place in the order of their CSS class names, which hold each
 * type's key followed by a hyphen, as `TextEditorDecorationType12-`, from a counter every extension in the host shares
 * (read in VS Code 1.147.0, workbench.desktop.main.js, `LineDecoration.compare`, and extensionHostProcess.js, the
 * decoration type's key). So a key a digit longer than the one made before it, as 10 after 9, would draw a hint before
 * its box, and then the types are made again, once, which takes the counter past the power of ten that broke the order.
 */
function decorationTypes(palette: Palette): DecorationTypes {
  const hint = hintStyles(palette)
  for (let tries = 1; ; tries++) {
    const make = (options: vscode.DecorationRenderOptions) => vscode.window.createTextEditorDecorationType(options)
    const types: DecorationTypes = {
      boxes: { value: make(boxStyle("value", palette)), firing: make(boxStyle("firing", palette)), error: make(boxStyle("error", palette)) },
      word: make(hint.word),
      rest: make(hint.rest),
    }
    const made = allOf(types)
    if (tries === 2 || made.every((type, at) => at === 0 || `${made[at - 1]!.key}-` < `${type.key}-`)) return types
    for (const type of made) type.dispose()
  }
}
