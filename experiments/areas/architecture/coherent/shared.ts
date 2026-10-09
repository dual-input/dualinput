// p09's stand-in for the logic the EFB app and the desktop app's pages would
// share: written in today's TypeScript, compiled to es2017 by tsc and by
// esbuild, then run in Coherent GT. It uses what the engine lacks as syntax,
// such as ?., ??, ??=, class fields, #private, and numeric separators, so the
// compilers have to lower each one. It's a script, not a module, so its output
// runs as it is evaluated, and it leaves its tests on window.

enum Role {
  Pf = "pf",
  Pm = "pm",
}

interface Pilot {
  id: string
  name?: string
  role: Role
}

class Crew {
  static readonly max = 8
  #pilots = new Map<string, Pilot>()
  readonly created = Date.now()

  join(p: Pilot): this {
    this.#pilots.set(p.id, { ...p })
    return this
  }

  get pf(): Pilot | undefined {
    for (const p of this.#pilots.values()) if (p.role === Role.Pf) return p
    return undefined
  }

  names(): string[] {
    return [...this.#pilots.values()].map((p) => p.name ?? "unnamed")
  }

  async settle(ms: number): Promise<number> {
    await new Promise((r) => setTimeout(r, ms))
    return this.#pilots.size
  }
}

function summarize({ id, ...rest }: Pilot & { extra?: number }): string {
  return `${id}:${Object.keys(rest).sort().join(",")}`
}

interface Check {
  name: string
  ok: boolean
  got: string
}

function selfTest(): Check[] {
  const out: Check[] = []
  const check = (name: string, got: unknown, want: unknown) => out.push({ name, ok: got === want, got: String(got) })
  const crew = new Crew().join({ id: "a", name: "Ada", role: Role.Pf }).join({ id: "b", role: Role.Pm })
  check("a #private Map behind a getter", crew.pf?.id, "a")
  check("?? as a default", crew.names().join("|"), "Ada|unnamed")
  check("a static field", Crew.max, 8)
  check("object rest in a parameter", summarize({ id: "a", role: Role.Pf, extra: 1 }), "a:extra,role")
  check("?. on null", (null as Pilot | null)?.name ?? "none", "none")
  check(
    "??=",
    (() => {
      let x: number | undefined
      x ??= 3
      return x
    })(),
    3,
  )
  check("a numeric separator", 1_000_000, 1000000)
  return out
}

;(window as unknown as Record<string, unknown>).CROSSCHECK_P09_SHARED = {
  selfTest,
  settle: (ms: number) => new Crew().join({ id: "c", role: Role.Pm }).settle(ms),
}
