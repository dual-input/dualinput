// The style bench: a mockup on the left, either the EFB app from the sketches of 2026-10-26 or
// the earlier desktop window, switches for preset, gray, main color, radius, font, and the
// mockup's states on the right, and a strip of kept combinations below to compare.
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { UI } from "@/bench/ui"
import { AppWindow, SCREENS, WINDOW, type Screen } from "@/bench/window"
import { DEFAULT_EFB, EFB, EfbApp, type EfbState } from "@/bench/efb"
import {
  BASES, CHIPS, color, DEFAULT_THEME, FONTS, HUES, INFO_CHROMAS, INFO_COLORS, PRESETS, RADII, STATUS_CAPS, STATUS_SHADES,
  SUCCESS_HUES, themeLabel, themeVars, TROUBLE_HUES, WARNING_HUES, type Theme,
} from "@/bench/theme"
import type { Status } from "@/bench/screens"

const PRESET_NOTES: Record<string, string> = {
  nova: "rounded, small type",
  vega: "medium radius, shadows",
  maia: "pill buttons, roomy cards",
  lyra: "square, extra-small type",
  mira: "compact, small type",
  luma: "pills, very round cards",
  sera: "square, uppercase buttons",
  rhea: "very round",
}

// Per-viewer conveniences only; the bench works the same when storage is blocked.
function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage blocked: nothing to keep
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={"rounded-md border px-2 py-1 text-xs transition-colors " + (on ? "border-foreground bg-foreground text-background" : "hover:bg-accent")}
    >
      {children}
    </button>
  )
}

function Swatch({ on, onClick, fill, title }: { on: boolean; onClick: () => void; fill: string; title: string }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={"size-6 rounded-full border transition-shadow " + (on ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : "")}
      style={{ background: fill }}
    />
  )
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => ({ ...DEFAULT_THEME, ...load("bench.theme", {}) }))
  const [screen, setScreen] = useState<Screen>(() => load("bench.screen", "home"))
  const [status, setStatus] = useState<Status>("ok")
  const [inSession, setInSession] = useState(false)
  // At first the window fits the screen's height, and a picked zoom holds from then on.
  const [zoom, setZoom] = useState(() => load("bench.zoom", Math.min(1, Math.floor(((window.innerHeight - 48) / WINDOW.height) * 20) / 20)))
  const [kept, setKept] = useState<{ id: number; theme: Theme }[]>(() => load("bench.kept", []))
  // The EFB app from the sketches of 2026-10-26, or the desktop window from the sketch of 2026-10-25.
  const [mockup, setMockup] = useState<"efb" | "desktop">(() => load("bench.mockup", "efb"))
  const [efb, setEfb] = useState<EfbState>(() => ({ ...DEFAULT_EFB, ...load("bench.efb", {}) }))
  const set = (patch: Partial<Theme>) => setTheme((t) => ({ ...t, ...patch }))
  const setE = (patch: Partial<EfbState>) => setEfb((s) => ({ ...s, ...patch }))
  const width = mockup === "efb" ? EFB.width : WINDOW.width
  const draw = (t: Theme, live: boolean) =>
    mockup === "efb" ? (
      <EfbApp theme={t} state={efb} onState={live ? setE : undefined} />
    ) : (
      <AppWindow theme={t} screen={screen} status={status} inSession={inSession} onScreen={live ? setScreen : undefined} onSession={live ? setInSession : undefined} />
    )

  useEffect(() => save("bench.theme", theme), [theme])
  useEffect(() => save("bench.screen", screen), [screen])
  useEffect(() => save("bench.zoom", zoom), [zoom])
  useEffect(() => save("bench.kept", kept), [kept])
  useEffect(() => save("bench.mockup", mockup), [mockup])
  useEffect(() => save("bench.efb", efb), [efb])

  // Menus, dialogs, and toasts open in a portal at the document's root, outside the window,
  // so the root takes the window's theme too.
  useEffect(() => {
    const root = document.documentElement
    for (const [k, v] of Object.entries(themeVars(theme))) root.style.setProperty(k, v)
  }, [theme])

  const Toaster = (UI[theme.preset] ?? UI.nova).Toaster

  return (
    <TooltipProvider>
      <div className="flex min-h-svh flex-col gap-6 p-6">
        <div className="flex flex-wrap items-start gap-6">
          <div style={{ zoom }}>{draw(theme, true)}</div>

          <aside className="flex w-80 flex-col gap-5 rounded-xl border bg-card p-4 text-card-foreground">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Style bench</span>
              <div className="flex gap-1">
                <Button size="sm" onClick={() => setKept((k) => [...k, { id: Date.now() + Math.random(), theme }])}>
                  Keep
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setTheme(DEFAULT_THEME)}>
                  Reset
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{themeLabel(theme)}</p>

            <Row label="Preset: shadcn's style of its components">
              {PRESETS.map((p) => (
                <Chip key={p} on={theme.preset === p} onClick={() => set({ preset: p })} title={PRESET_NOTES[p]}>
                  {p}
                </Chip>
              ))}
            </Row>
            <p className="-mt-3 text-xs text-muted-foreground">{PRESET_NOTES[theme.preset]}</p>

            <Row label="Base gray">
              {BASES.map((b) => (
                <Swatch
                  key={b}
                  title={b}
                  on={theme.base === b}
                  onClick={() => set({ base: b })}
                  fill={`linear-gradient(135deg, ${color(b, 950)} 50%, ${color(b, 500)} 50%)`}
                />
              ))}
            </Row>

            <Row label="Main color">
              <Chip on={theme.accent === "none"} onClick={() => set({ accent: "none" })}>
                none
              </Chip>
              {HUES.map((h) => (
                <Swatch key={h} title={h} on={theme.accent === h} onClick={() => set({ accent: h })} fill={color(h, theme.shade)} />
              ))}
              <Swatch title="the sim's EFB blue, #00b4ff" on={theme.accent === "custom" && theme.custom === "#00b4ff"} onClick={() => set({ accent: "custom", custom: "#00b4ff" })} fill="#00b4ff" />
              <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Any color">
                <input type="color" value={theme.custom} onChange={(e) => set({ accent: "custom", custom: e.target.value })} className="size-6 cursor-pointer rounded-full border-0 bg-transparent p-0" />
                custom
              </label>
            </Row>
            <Row label="Main color's shade">
              {[300, 400, 500, 600, 700].map((s) => (
                <Chip key={s} on={theme.shade === s} onClick={() => set({ shade: s })}>
                  {s}
                </Chip>
              ))}
            </Row>

            <Row label="Information's color">
              {INFO_COLORS.map((c) => (
                <Swatch
                  key={c}
                  title={c}
                  on={(theme.info ?? "neutral") === c}
                  onClick={() => set({ info: c })}
                  fill={themeVars({ ...theme, info: c })["--info"]}
                />
              ))}
              <span className="self-center text-xs text-muted-foreground">{theme.info ?? "neutral"}</span>
            </Row>
            {theme.info === "slate" && (
              <Row label="Slate's tint, as oklch chroma (slate-300's own is 0.022)">
                {INFO_CHROMAS.map((c) => (
                  <Chip key={c} on={(theme.infoChroma ?? 0.022) === c} onClick={() => set({ infoChroma: c })}>
                    {c}
                  </Chip>
                ))}
              </Row>
            )}

            <Row label="Warning, trouble, and success: shade">
              {STATUS_SHADES.map((s) => (
                <Chip key={s} on={(theme.statusShade ?? 400) === s} onClick={() => set({ statusShade: s })}>
                  {s}
                </Chip>
              ))}
            </Row>
            <Row label="Their chroma, at most (sky-300's is 0.111)">
              {STATUS_CAPS.map((c) => (
                <Chip key={c} on={(theme.statusCap ?? 0) === c} onClick={() => set({ statusCap: c })}>
                  {c === 0 ? "no cap" : c}
                </Chip>
              ))}
            </Row>
            <Row label="Warning's hue">
              {WARNING_HUES.map((h) => (
                <Chip key={h} on={(theme.warningHue ?? "amber") === h} onClick={() => set({ warningHue: h })}>
                  {h}
                </Chip>
              ))}
            </Row>
            <Row label="Trouble's hue">
              {TROUBLE_HUES.map((h) => (
                <Chip key={h} on={(theme.troubleHue ?? "red") === h} onClick={() => set({ troubleHue: h })}>
                  {h}
                </Chip>
              ))}
            </Row>
            <Row label="Success's hue">
              {SUCCESS_HUES.map((h) => (
                <Chip key={h} on={(theme.successHue ?? "emerald") === h} onClick={() => set({ successHue: h })}>
                  {h}
                </Chip>
              ))}
            </Row>
            <Row label="Status chips' style">
              {CHIPS.map((c) => (
                <Chip key={c} on={(theme.chip ?? "soft") === c} onClick={() => set({ chip: c })}>
                  {c}
                </Chip>
              ))}
            </Row>

            <Row label="Corner radius">
              {RADII.map((r) => (
                <Chip key={r} on={theme.radius === r} onClick={() => set({ radius: r })}>
                  {r * 16}px
                </Chip>
              ))}
            </Row>

            <Row label="Font">
              {Object.entries(FONTS).map(([id, f]) => (
                <Chip key={id} on={theme.font === id} onClick={() => set({ font: id })}>
                  <span style={{ fontFamily: f.sans }}>{f.label}</span>
                </Chip>
              ))}
            </Row>

            <div className="h-px bg-border" />

            <Row label="Mockup">
              <Chip on={mockup === "efb"} onClick={() => setMockup("efb")} title="The sketches of 2026-10-26">
                EFB app
              </Chip>
              <Chip on={mockup === "desktop"} onClick={() => setMockup("desktop")} title="The sketch of 2026-10-25">
                desktop window, earlier sketch
              </Chip>
            </Row>

            {mockup === "efb" ? (
              <>
                <Row label="Screen">
                  {(["setup", "home", "preflight"] as const).map((s) => (
                    <Chip key={s} on={efb.screen === s} onClick={() => setE({ screen: s })}>
                      {{ setup: "first-time setup", home: "home", preflight: "preflight" }[s]}
                    </Chip>
                  ))}
                </Row>
                {efb.screen === "home" && (
                  <>
                    <Row label="Visit">
                      <Chip on={efb.firstTime} onClick={() => setE({ firstTime: true })}>
                        first time
                      </Chip>
                      <Chip on={!efb.firstTime} onClick={() => setE({ firstTime: false })}>
                        later
                      </Chip>
                    </Row>
                    <Row label="Loaded aircraft">
                      <Chip on={efb.aircraft === "supported"} onClick={() => setE({ aircraft: "supported" })}>
                        supported
                      </Chip>
                      <Chip on={efb.aircraft === "unsupported"} onClick={() => setE({ aircraft: "unsupported" })}>
                        unsupported
                      </Chip>
                    </Row>
                    {!efb.firstTime && efb.aircraft === "supported" && (
                      <Row label="Notes from the profile authors">
                        <Chip on={efb.notes} onClick={() => setE({ notes: true })}>
                          some
                        </Chip>
                        <Chip on={!efb.notes} onClick={() => setE({ notes: false })}>
                          none
                        </Chip>
                      </Row>
                    )}
                  </>
                )}
                {efb.screen === "preflight" && (
                  <>
                    <Row label="Crew">
                      <Chip on={efb.crew === "alone"} onClick={() => setE({ crew: "alone" })}>
                        nobody joined yet
                      </Chip>
                      <Chip on={efb.crew === "full"} onClick={() => setE({ crew: "full" })}>
                        James and Adam
                      </Chip>
                    </Row>
                    {efb.crew === "full" && (
                      <>
                        <Row label="You are">
                          <Chip on={efb.flying} onClick={() => setE({ flying: true })}>
                            the pilot flying
                          </Chip>
                          <Chip on={!efb.flying} onClick={() => setE({ flying: false })}>
                            not flying
                          </Chip>
                        </Row>
                        <Row label="Adam">
                          {(["ready", "not-ready", "other-aircraft", "link-lost"] as const).map((a) => (
                            <Chip key={a} on={efb.adam === a} onClick={() => setE({ adam: a })}>
                              {{ ready: "ready", "not-ready": "not ready", "other-aircraft": "in another aircraft", "link-lost": "link lost" }[a]}
                            </Chip>
                          ))}
                        </Row>
                      </>
                    )}
                    <Row label="Crew card">
                      <Chip on={!efb.folded} onClick={() => setE({ folded: false })}>
                        open
                      </Chip>
                      <Chip on={efb.folded} onClick={() => setE({ folded: true })}>
                        folded, checklist expanded
                      </Chip>
                    </Row>
                  </>
                )}
              </>
            ) : (
              <>
                <Row label="Screen">
                  {SCREENS.map((s) => (
                    <Chip key={s.id} on={screen === s.id} onClick={() => setScreen(s.id)}>
                      {s.label}
                    </Chip>
                  ))}
                </Row>
                <Row label="Status row">
                  {(["ok", "warning", "trouble"] as Status[]).map((s) => (
                    <Chip key={s} on={status === s} onClick={() => setStatus(s)}>
                      {s === "ok" ? "all good" : s}
                    </Chip>
                  ))}
                  <Chip on={inSession} onClick={() => setInSession((v) => !v)}>
                    in a session
                  </Chip>
                </Row>
              </>
            )}
            <Row label="Window zoom">
              {[0.5, 0.6, 0.75, 0.9, 1].map((z) => (
                <Chip key={z} on={zoom === z} onClick={() => setZoom(z)}>
                  {Math.round(z * 100)}%
                </Chip>
              ))}
            </Row>
          </aside>
        </div>

        {kept.length > 0 && (
          <section className="flex flex-col gap-3">
            <span className="text-sm font-semibold">Kept, on the screen above</span>
            <div className="flex gap-4 overflow-x-auto pb-2">
              {kept.map((k) => (
                <div key={k.id} className="flex shrink-0 flex-col gap-2">
                  {/* A div, since the window it holds has buttons of its own. */}
                  <div role="button" tabIndex={0} onClick={() => setTheme(k.theme)} onKeyDown={(e) => e.key === "Enter" && setTheme(k.theme)} title="Load into the editor" className="cursor-pointer" style={{ width: width * 0.42 }}>
                    <div style={{ zoom: 0.42 }} className="pointer-events-none">
                      {draw(k.theme, false)}
                    </div>
                  </div>
                  <div className="flex items-start justify-between gap-2" style={{ width: width * 0.42 }}>
                    <span className="text-[11px] leading-tight text-muted-foreground">{themeLabel(k.theme)}</span>
                    <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setKept((all) => all.filter((x) => x.id !== k.id))}>
                      remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      {Toaster && <Toaster theme="dark" position="bottom-left" />}
    </TooltipProvider>
  )
}
