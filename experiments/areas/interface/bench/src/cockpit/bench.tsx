// A bench for the session card's cockpit scene alone: the picture in a card the session card's
// size, with sliders for where the camera stands and looks, its field of view, the cockpit's main
// proportions, and the crew, so a change shows in a second, apart from the design frames. The
// settings live in the page's address, after the #, so a reload keeps them and a link shares them.
import { useEffect, useState } from "react"

import { BLOCKOUT_CAMERAS, CockpitScene, DIMS, PICTURE, toPicture, type Dims, type SceneCamera } from "../frames/cockpit-scene"
import type { V } from "../frames/figure-portrait"

type Settings = { camera: SceneCamera; dims: Dims; crew: 1 | 2; figures: boolean; code: boolean; codeHeight: number; zoom: number }
const DEFAULTS: Settings = { camera: BLOCKOUT_CAMERAS[1].camera, dims: DIMS, crew: 2, figures: true, code: true, codeHeight: 0.7, zoom: 2 }

function fromAddress(): Settings {
  try {
    const saved = JSON.parse(decodeURIComponent(location.hash.slice(1)))
    return { ...DEFAULTS, ...saved, camera: { ...DEFAULTS.camera, ...saved.camera }, dims: { ...DEFAULTS.dims, ...saved.dims } }
  } catch {
    return DEFAULTS
  }
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    // The columns are set inline, since the dev server's Tailwind doesn't pick up a brand-new file's
    // arbitrary classes until it restarts.
    <label className="grid items-center gap-3 text-sm" style={{ gridTemplateColumns: "7.5rem 1fr 3rem" }}>
      <span className="text-muted-foreground">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-sky-400" />
      <span className="text-right font-mono text-xs tabular-nums">{value.toFixed(step < 1 ? 2 : 0)}</span>
    </label>
  )
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="accent-sky-400" />
      <span>{label}</span>
    </label>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  )
}

export function CockpitBench() {
  const [s, setS] = useState<Settings>(fromAddress)
  useEffect(() => history.replaceState(null, "", "#" + encodeURIComponent(JSON.stringify(s))), [s])
  const cam = s.camera
  const setCam = (part: Partial<SceneCamera>) => setS({ ...s, camera: { ...cam, ...part } })
  const setFrom = (i: number, v: number) => setCam({ from: cam.from.map((c, k) => (k === i ? v : c)) as V })
  const setTo = (i: number, v: number) => setCam({ to: cam.to.map((c, k) => (k === i ? v : c)) as V })
  const setDims = (part: Partial<Dims>) => setS({ ...s, dims: { ...s.dims, ...part } })
  const [, codeY] = toPicture([0, s.codeHeight, -0.75], cam)
  const settings = JSON.stringify({ camera: cam, dims: s.dims, crew: s.crew })

  return (
    <div className="flex min-h-screen flex-wrap items-start gap-8 bg-background p-8 text-foreground">
      <div className="flex flex-col gap-3">
        <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10" style={{ padding: 20 * s.zoom }}>
          <div className="relative">
            <CockpitScene camera={cam} crew={s.crew} dims={s.dims} zoom={s.zoom} figures={s.figures} />
            {s.code && (
              <div className="pointer-events-none absolute left-0 flex w-full flex-col items-center" style={{ top: (codeY - 22) * s.zoom, gap: 2 * s.zoom }}>
                <span className="text-white/70" style={{ fontSize: 12 * s.zoom }}>
                  Invite code
                </span>
                <span className="font-mono font-medium text-white" style={{ fontSize: 24 * s.zoom, lineHeight: 1.2 }}>
                  K7R-4XM
                </span>
              </div>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          The card's picture, {PICTURE.width} by {PICTURE.height}, at {s.zoom}×.
        </p>
      </div>

      <div className="flex w-96 flex-col gap-6">
        <Group title="Camera">
          <div className="flex flex-wrap gap-2">
            {BLOCKOUT_CAMERAS.map((c) => (
              <button key={c.name} onClick={() => setS({ ...s, camera: c.camera })} className="rounded-md bg-secondary px-2.5 py-1 text-xs hover:bg-accent">
                {c.name}
              </button>
            ))}
          </div>
          <Slider label="Height" value={cam.from[1]} min={0.2} max={1.8} step={0.01} onChange={(v) => setFrom(1, v)} />
          <Slider label="Back from hips" value={cam.from[2]} min={0.6} max={6} step={0.01} onChange={(v) => setFrom(2, v)} />
          <Slider label="Across" value={cam.from[0]} min={-0.6} max={0.6} step={0.01} onChange={(v) => setFrom(0, v)} />
          <Slider label="Looks at height" value={cam.to[1]} min={-0.4} max={1.2} step={0.01} onChange={(v) => setTo(1, v)} />
          <Slider label="Looks at depth" value={cam.to[2]} min={-1.5} max={0.5} step={0.01} onChange={(v) => setTo(2, v)} />
          <Slider label="Field of view" value={cam.fov} min={10} max={60} step={0.5} onChange={(v) => setCam({ fov: v })} />
        </Group>
        <Group title="Cockpit">
          <Slider label="Seats apart" value={s.dims.seatX} min={0.4} max={0.75} step={0.01} onChange={(v) => setDims({ seatX: v })} />
          <Slider label="Back lean" value={s.dims.recline} min={0} max={30} step={1} onChange={(v) => setDims({ recline: v })} />
          <Slider label="Headrest top" value={s.dims.headrestTop} min={0.4} max={0.8} step={0.01} onChange={(v) => setDims({ headrestTop: v })} />
          <Slider label="Ceiling rise" value={s.dims.ceiling} min={0} max={30} step={1} onChange={(v) => setDims({ ceiling: v })} />
          <div className="flex gap-5">
            <Toggle label="Overhead panel" on={s.dims.overhead} onChange={(v) => setDims({ overhead: v })} />
            <Toggle label="Pedestal" on={s.dims.pedestal} onChange={(v) => setDims({ pedestal: v })} />
          </div>
        </Group>
        <Group title="Crew and code">
          <div className="flex flex-wrap gap-5">
            <Toggle label="Figures" on={s.figures} onChange={(v) => setS({ ...s, figures: v })} />
            <Toggle label="Crewmate" on={s.crew === 2} onChange={(v) => setS({ ...s, crew: v ? 2 : 1 })} />
            <Toggle label="Code" on={s.code} onChange={(v) => setS({ ...s, code: v })} />
          </div>
          <Slider label="Code height" value={s.codeHeight} min={0.3} max={1.0} step={0.01} onChange={(v) => setS({ ...s, codeHeight: v })} />
          <Slider label="Zoom" value={s.zoom} min={1} max={3} step={1} onChange={(v) => setS({ ...s, zoom: v })} />
        </Group>
        <Group title="Settings">
          <textarea readOnly value={settings} className="h-20 rounded-md bg-secondary p-2 font-mono text-xs" />
          <div className="flex gap-2">
            <button onClick={() => navigator.clipboard?.writeText(settings)} className="rounded-md bg-secondary px-2.5 py-1 text-xs hover:bg-accent">
              Copy settings
            </button>
            <button onClick={() => setS(DEFAULTS)} className="rounded-md bg-secondary px-2.5 py-1 text-xs hover:bg-accent">
              Reset
            </button>
          </div>
        </Group>
      </div>
    </div>
  )
}
