// How our app joins the sim's EFB, the only code of ours that touches the MSFS Avionics Framework:
// the app's `available` subject and the one element the EFB renders, into which React mounts. It
// uses the EFB's own copy of the framework, its global `msfssdk`, as 11 of the 12 EFB apps on our
// development machine do, so a sim update that changes that copy reaches only this file
// (record/areas/interface/decisions.md, "The EFB app touches the framework only to register").

type Subject = unknown
type Ref = { instance: HTMLElement }

declare const msfssdk: {
  Subject: { create(value: boolean): Subject }
  DisplayComponent: new (props: unknown) => object
  FSComponent: { createRef(): Ref; buildComponent(type: unknown, props: unknown): unknown }
}

declare const Coherent: { trigger(name: string, ...args: unknown[]): void }

declare global {
  interface Window {
    EFB_API?: { bus?: unknown; use(app: unknown): void }
    DUALINPUT_EFB_REGISTERED?: number
  }
}

/** The EFB API this speaks, which the EFB hears when an app installs (read in the SDK's samples, by p19's builder). */
const EFB_API_VERSION = "1.0.3"

/** How long registering keeps trying, since the EFB's container and its bus come after our script: 150 tries, 200ms apart. */
const TRY_EVERY = 200
const TRIES = 150

export type EfbApp = {
  /** The folder our app sits in under `html_ui/efb_ui/efb_apps/`, by which the EFB finds it. */
  internalName: string
  name: string
  version: string
  /** Mounts the app into the element the EFB rendered for it. */
  mount(host: HTMLElement): void
  /** The app left the screen, so anything it holds of the pilot's input goes back. */
  left(): void
  /** The app came back on screen. */
  shown(): void
}

/** The class the EFB takes. The framework's classes exist only once the EFB has loaded, so it's made here. */
function appClass(app: EfbApp) {
  const folder = `coui://html_ui/efb_ui/efb_apps/${app.internalName}`

  class View extends msfssdk.DisplayComponent {
    private readonly root = msfssdk.FSComponent.createRef()
    onAfterRender() {
      app.mount(this.root.instance)
    }
    onOpen() {
      app.shown()
    }
    onClose() {
      app.left()
    }
    onResume() {
      app.shown()
    }
    onPause() {
      app.left()
    }
    onUpdate() {}
    registerViews() {}
    routeGamepadInteractionEvent() {}
    handlePageKeyAction() {}
    render() {
      return msfssdk.FSComponent.buildComponent("div", { style: "width: 100%; height: 100%", ref: this.root })
    }
  }

  // The members the EFB reads, as the SDK's apps have them. Our code has to run while the EFB is closed,
  // and only BootMode 2, HOT, renders the view as the EFB starts, where 1, WARM, waits for the app's first
  // opening (read in fs-base-efb, efb_ui/efb_os/efb_os.js, registerApp).
  return class {
    private installed = false
    private ready = false
    private favorite = -1
    private settings: Record<string, unknown> = {}
    readonly available = msfssdk.Subject.create(true)
    readonly BootMode = 2
    readonly SuspendMode = 0
    readonly name = app.name
    readonly icon = `${folder}/Assets/app-icon.svg`
    options = {}
    bus: unknown

    _install(props: Record<string, unknown>) {
      if (this.installed) return Promise.reject("App already installed.")
      this.installed = true
      this.bus = props.bus
      this.settings = props
      this.favorite = typeof props.favoriteIndex === "number" ? props.favoriteIndex : -1
      this.options = (props.options as object) || {}
      this.ready = true
      // The EFB loads no app's stylesheet, so each adds its own link (record/areas/interface/log.md,
      // 2026-10-25).
      if (!document.querySelector(`link[href*="${app.internalName}.css"]`)) {
        const link = document.createElement("link")
        link.rel = "stylesheet"
        link.href = `${folder}/${app.internalName}.css`
        document.head.appendChild(link)
      }
      Coherent.trigger("EFB_APP_INSTALLED", app.name, app.internalName, EFB_API_VERSION, app.version)
      return Promise.resolve()
    }
    install() {
      return Promise.resolve()
    }
    get isReady() {
      return this.ready
    }
    get internalName() {
      return app.internalName
    }
    get unitsSettingsManager() {
      return this.settings.unitsSettingManager
    }
    get efbSettingsManager() {
      return this.settings.efbSettingsManager
    }
    get notificationManager() {
      return this.settings.notificationManager
    }
    get onboardingManager() {
      return this.settings.onboardingManager
    }
    get compatibleAircraftModels() {
      return undefined
    }
    get favoriteIndex() {
      return this.favorite
    }
    set favoriteIndex(index: number) {
      this.favorite = index
    }
    getIsSearchable() {
      return true
    }
    getIsFavoritable() {
      return true
    }
    getVersion() {
      return app.version
    }
    render() {
      return msfssdk.FSComponent.buildComponent(View, {})
    }
  }
}

/** Registers the app once the EFB's container exists and has its bus, as p19's did (record/areas/interface/log.md, 2026-10-25). */
export function registerEfbApp(app: EfbApp): void {
  if (window.DUALINPUT_EFB_REGISTERED) return
  let tries = 0
  const attempt = () => {
    try {
      if (typeof msfssdk !== "undefined" && window.EFB_API && window.EFB_API.bus) {
        window.EFB_API.use(appClass(app))
        window.DUALINPUT_EFB_REGISTERED = Date.now()
        return
      }
    } catch (error) {
      console.error(`Dual Input: the EFB didn't take our app: ${error}`)
    }
    if (++tries < TRIES) setTimeout(attempt, TRY_EVERY)
  }
  attempt()
}
