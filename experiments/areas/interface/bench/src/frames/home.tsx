// The EFB app's home page on a pilot's first visit, designed from the user's sketch of 2026-10-26,
// in its two variants: an aircraft Dual Input supports, and one it doesn't, which lists the
// aircraft it does. The pilot's name and the aircraft are examples.
import { useState } from "react"

import { useUI } from "@/bench/ui"
import type { Theme } from "@/bench/theme"
import { AppFrame, Label } from "./shell"

const DISPLAY_NAME = "jordan"
const UNSUPPORTED = "Fenix A320"
const SUPPORTED = [
  { name: "Black Square Baron 58P", maturity: "Stable" },
  { name: "Synaptic A220", maturity: "Stable" },
  { name: "A2A Simulations PA24-250 Comanche", maturity: "Experimental" },
]

// Host and Join, where Join opens the code field in place of the two buttons.
function HostJoin() {
  const { Button, Card, CardContent, InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } = useUI()
  const [joining, setJoining] = useState(false)
  const [code, setCode] = useState("")
  return (
    <Card>
      <CardContent>
        {joining ? (
          <div className="flex flex-col gap-3">
            <Label>Invite code</Label>
            <div className="flex flex-wrap items-center gap-2">
              <InputOTP maxLength={6} value={code} onChange={(v: string) => setCode(v.toUpperCase())}>
                <InputOTPGroup>
                  {[0, 1, 2].map((i) => (
                    <InputOTPSlot key={i} index={i} className="font-mono" />
                  ))}
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                  {[3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} className="font-mono" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              <Button className="ml-auto" disabled={code.length < 6}>
                Join
              </Button>
              <Button variant="ghost" onClick={() => setJoining(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button size="lg">Host</Button>
            <Button size="lg" variant="ghost" onClick={() => setJoining(true)}>
              Join
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SeeHow() {
  return (
    <a href="#" onClick={(e) => e.preventDefault()} className="text-primary underline-offset-4 hover:underline">
      see how
    </a>
  )
}

function SupportedAircraft() {
  const { Badge, Card, CardContent, Separator } = useUI()
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-3">
        <Label>Supported aircraft</Label>
        {SUPPORTED.map((a, i) => (
          <div key={a.name} className="flex flex-col gap-3">
            {i > 0 && <Separator />}
            <div className="flex items-center justify-between gap-3 text-sm">
              {a.name}
              <Badge variant="secondary">{a.maturity}</Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function HomeFirstTimeFrame({ theme, aircraft }: { theme: Theme; aircraft: "supported" | "unsupported" }) {
  const supported = aircraft === "supported"
  return (
    <AppFrame theme={theme} status={{ aircraft }}>
      <div className="flex flex-1 flex-col gap-6 p-5">
        <HostJoin />
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">Welcome to Dual Input, {DISPLAY_NAME}.</h2>
          {supported ? (
            <p className="text-sm text-muted-foreground">Looks like you've already loaded an aircraft supported by Dual Input. Click Host above and share the invite code with someone to start flying together.</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Looks like you've loaded an aircraft that's currently not supported by Dual Input. You can switch to a supported aircraft from the list below, or get your hands dirty building a profile for the {UNSUPPORTED} (<SeeHow />).
            </p>
          )}
        </section>
        {!supported && <SupportedAircraft />}
      </div>
    </AppFrame>
  )
}
