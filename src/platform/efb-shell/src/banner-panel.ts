// Opens the banner's panel in each flight of a session, and closes it when the session ends or the core says `bye`
// (record/areas/interface/01-apps.md, "The banner"). A call to the toolbar can go unheard, since one our toolbar script
// made once left the panel closed with no error, and nothing but the core's `banner` slice says whether a page came up,
// so it calls again until the slice says one did. A call that asks for the state the panel is in changes nothing
// (measured on MSFS 2024, 2026-11-02, record/areas/interface/log.md), so calling too often costs nothing. From then on
// the panel is the pilot's: one closed from its toolbar button stays closed until the next flight.

/** How long to wait before calling again, in milliseconds. */
export const CALL_AGAIN_AFTER = 3000

/**
 * How long after a load's end the page it took down can still close, in milliseconds. The core closes a socket that has
 * been quiet for 8s, on a tick every 2s, so after a load as short as a Restart's 9s the slice still says that page is
 * open when the flight starts (measured on MSFS 2024, 2026-11-02, record/areas/interface/log.md).
 */
export const OLD_PAGE_CLOSES_WITHIN = 12_000

/** What the core says that decides the panel. */
export type PanelFacts = {
  /** This pilot's sim is in or loading a flight, in a session. */
  flying: boolean
  /** This pilot's sim is loading a flight, which begins the next flight whether it came from the menu or a Restart, which has no menu between. */
  loading: boolean
  held: boolean
  /** A banner page's socket is open, as the `banner` slice says. */
  pageOpen: boolean
}

export type PanelEnv = {
  /** Calls the toolbar for the panel. */
  toolbar(open: boolean): void
  setTimer(then: () => void, ms: number): number
  clearTimer(timer: number): void
}

export class BannerPanel {
  private readonly env: PanelEnv
  /** Whether this flight has had its first call, so a panel the pilot closed stays closed. */
  private calledThisFlight = false
  /** Whether a call asked for the panel since the last close, so an end with nothing open makes no call. */
  private opened = false
  private retry: number | null = null
  /** Runs while a closing page may still be the one the last load took down, rather than the pilot's doing. */
  private oldPage: number | null = null
  private pageOpen = false
  private wasLoading = false

  constructor(env: PanelEnv) {
    this.env = env
  }

  follow(facts: PanelFacts): void {
    const nextFlight = facts.loading && !this.wasLoading
    const loadEnded = this.wasLoading && !facts.loading
    const pageClosed = this.pageOpen && !facts.pageOpen
    this.wasLoading = facts.loading
    this.pageOpen = facts.pageOpen
    if (facts.pageOpen) this.stopRetrying()
    if (!facts.held) {
      this.close()
      return
    }
    if (!facts.flying || nextFlight) {
      this.calledThisFlight = false
      this.stopRetrying()
      this.stopWatchingOldPage()
    }
    if (!facts.flying) return
    if (loadEnded) {
      this.calledThisFlight = true
      this.watchOldPage()
      this.call()
      return
    }
    if (pageClosed && this.oldPage !== null) {
      this.call()
      return
    }
    if (this.calledThisFlight) return
    if (facts.pageOpen) {
      // A load may take the page down, and its socket says so only a few seconds later, so while one runs an open page settles nothing.
      if (!facts.loading) this.calledThisFlight = true
      return
    }
    this.calledThisFlight = true
    this.call()
  }

  /** The sim sizes a panel as it opens, and only stretches it with the window after that, so a changed window needs a new opening. The two calls in a row reload the page (same log). */
  reopen(): void {
    this.env.toolbar(false)
    this.env.toolbar(true)
  }

  /** The core said `bye`, so it says nothing more: the panel closes now, with no retry. */
  coreQuit(): void {
    this.close()
  }

  /** The link to the core dropped, so nothing can say a page came up. Calling stops, and starts again once the core is back. */
  coreLost(): void {
    if (this.retry === null) return
    this.stopRetrying()
    this.calledThisFlight = false
  }

  private call(): void {
    this.stopRetrying()
    this.opened = true
    this.env.toolbar(true)
    this.retry = this.env.setTimer(() => {
      this.retry = null
      if (!this.pageOpen) this.call()
    }, CALL_AGAIN_AFTER)
  }

  private close(): void {
    this.stopRetrying()
    this.stopWatchingOldPage()
    this.calledThisFlight = false
    if (!this.opened) return
    this.opened = false
    this.env.toolbar(false)
  }

  private stopRetrying(): void {
    if (this.retry === null) return
    this.env.clearTimer(this.retry)
    this.retry = null
  }

  private watchOldPage(): void {
    this.stopWatchingOldPage()
    this.oldPage = this.env.setTimer(() => {
      this.oldPage = null
    }, OLD_PAGE_CLOSES_WITHIN)
  }

  private stopWatchingOldPage(): void {
    if (this.oldPage === null) return
    this.env.clearTimer(this.oldPage)
    this.oldPage = null
  }
}
