// The EFB app's preflight page, designed from the user's sketch of 2026-10-26, with an example of
// every component the UI kit will have where the sketch puts the preflight checklist, so the kit
// is judged on a real page. The crew, the aircraft, and the words are examples.
import { useState } from "react"
import { toast } from "sonner"
import { AlertTriangle, Check, CircleX, Copy, Info, Keyboard, LogOut, PackageOpen, Settings as Gear, X } from "lucide-react"

import { useUI } from "@/bench/ui"
import { color, PILOT_COLORS, type Theme } from "@/bench/theme"
import { StatusChip } from "@/bench/screens"
import { AppFrame, Label } from "./shell"

const CREW = [
  { name: "You", hue: "orange", chip: "Pilot flying", you: true },
  { name: "James", hue: "red", chip: "Relay · 120ms", state: "ready" },
  { name: "Adam", hue: "green", chip: "Direct · 40ms", state: "not-ready" },
]

const DEVICES = [
  { value: "default", label: "Windows' default" },
  { value: "headset", label: "Headset (USB Audio)" },
  { value: "speakers", label: "Speakers (Realtek)" },
]

function LeaveDialog({ trigger }: { trigger: React.ReactElement }) {
  const ui = useUI()
  const { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } = ui
  return (
    <AlertDialog>
      <AlertDialogTrigger render={trigger} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave the session?</AlertDialogTitle>
          <AlertDialogDescription>You can join again with the same code.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Stay</AlertDialogCancel>
          <AlertDialogAction variant="destructive">Leave</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function SessionCard() {
  const { Button, Badge, Card, CardContent, Separator } = useUI()
  const [ready, setReady] = useState(false)
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label>Invite code</Label>
          <div className="flex items-center gap-1">
            <span className="font-mono text-2xl font-medium tracking-wider">K7R-4XM</span>
            <Button variant="ghost" size="icon-sm" aria-label="Copy the invite code" onClick={() => toast("Copied the invite code")}>
              <Copy />
            </Button>
          </div>
        </div>
        <LeaveDialog
          trigger={
            <Button variant="ghost" size="sm">
              Leave <LogOut data-icon="inline-end" />
            </Button>
          }
        />
      </CardContent>
      <Separator />
      <CardContent className="flex flex-col gap-3">
        <Label>Crew</Label>
        <ul className="flex flex-col gap-3">
          {CREW.map((m) => (
            <li key={m.name} className="flex items-center gap-3">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: color(m.hue, 400) }} />
              <span className="text-sm font-medium">{m.name}</span>
              <Badge variant="secondary">{m.chip}</Badge>
              <span className="ml-auto">
                {m.you ? (
                  <Button size="sm" variant={ready ? "default" : "outline"} onClick={() => setReady((r) => !r)}>
                    {ready && <Check data-icon="inline-start" />}
                    Ready
                  </Button>
                ) : m.state === "ready" ? (
                  <StatusChip level="success">Ready</StatusChip>
                ) : (
                  <span className="text-xs text-muted-foreground">Not ready</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        <ul className="flex flex-col gap-2 pt-1 text-sm">
          <li className="flex items-start gap-2">
            <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span>
              Adam runs version 2.1.2 of the aircraft, and you run 2.1.3. <span className="text-muted-foreground">Adam updates it.</span>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              Different liveries. <span className="text-muted-foreground">Each pilot sees their own.</span>
            </span>
          </li>
        </ul>
      </CardContent>
    </Card>
  )
}

// One component of the kit, under the name the user gives feedback by.
function Kit({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <Label>{name}</Label>
      {children}
    </section>
  )
}

function UiKit() {
  const ui = useUI()
  const { Button, Badge, Card, CardContent, Separator, Input, Field, FieldLabel, FieldDescription, FieldError, FieldContent } = ui
  const { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } = ui
  const { Slider, Switch, Checkbox, ToggleGroup, ToggleGroupItem, Kbd, Progress, Spinner, Tooltip, TooltipTrigger, TooltipContent } = ui
  const { Avatar, AvatarFallback, AvatarGroup, Tabs, TabsList, TabsTrigger, TabsContent, Alert, AlertTitle, AlertDescription, AlertAction } = ui
  const [code, setCode] = useState("K7R4")
  const [volume, setVolume] = useState([80])
  const [figure, setFigure] = useState("orange")

  return (
    <div className="flex flex-col gap-8">
      <Kit name="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Ready</Button>
          <Button variant="secondary">Go without Adam</Button>
          <Button variant="outline">Join</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="destructive">Leave session</Button>
          <Button variant="link">Learn more</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">Bind</Button>
          <Button>Host</Button>
          <Button size="lg">Take control</Button>
          <Button variant="outline" size="icon" aria-label="Copy">
            <Copy />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Settings">
            <Gear />
          </Button>
          <Button disabled>Ready</Button>
          <Button disabled>
            <Spinner data-icon="inline-start" /> Joining
          </Button>
        </div>
      </Kit>

      <Kit name="Copy field">
        <div className="flex gap-2">
          <Input readOnly value="K7R-4XM" className="font-mono tracking-wider" aria-label="Invite code" />
          <Button variant="secondary" onClick={() => toast("Copied the invite code")}>
            <Copy data-icon="inline-start" /> Copy
          </Button>
        </div>
      </Kit>

      <Kit name="Text field">
        <Field>
          <FieldLabel htmlFor="kit-name">Display name</FieldLabel>
          <Input id="kit-name" defaultValue="Jordan" />
          <FieldDescription>This will be shown to other pilots.</FieldDescription>
        </Field>
        <Field data-invalid>
          <FieldLabel htmlFor="kit-name-empty">Display name</FieldLabel>
          <Input id="kit-name-empty" aria-invalid placeholder="Your name" />
          <FieldError>Pick a name before you host or join.</FieldError>
        </Field>
      </Kit>

      <Kit name="Code field">
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
      </Kit>

      <Kit name="Select">
        <Field>
          <FieldLabel>Play the crew's ATC on</FieldLabel>
          <Select items={DEVICES} defaultValue="headset">
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEVICES.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Kit>

      <Kit name="Slider">
        <Field>
          <div className="flex items-center justify-between">
            <FieldLabel>ATC volume</FieldLabel>
            <span className="text-sm text-muted-foreground tabular-nums">{volume[0]}%</span>
          </div>
          <Slider value={volume} onValueChange={(v: number | number[]) => setVolume(Array.isArray(v) ? v : [v])} max={100} step={5} />
        </Field>
      </Kit>

      <Kit name="Switch">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Share my traffic and ATC</FieldLabel>
            <FieldDescription>The crew sees the aircraft around you and hears your ATC.</FieldDescription>
          </FieldContent>
          <Switch defaultChecked />
        </Field>
      </Kit>

      <Kit name="Checkbox">
        <div className="flex flex-col gap-3">
          <label className="flex items-start gap-3 text-sm">
            <Checkbox defaultChecked className="mt-0.5" />
            <span className="flex-1">Set speed to 80.</span>
            <Badge variant="outline">Pilot flying</Badge>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox className="mt-0.5" />
            <span className="flex-1">In the tablet, set the radios the same for every pilot.</span>
          </label>
        </div>
      </Kit>

      <Kit name="Segmented control">
        <Field>
          <FieldLabel>Take control with</FieldLabel>
          <ToggleGroup defaultValue={["single"]} variant="outline">
            <ToggleGroupItem value="single">A single press</ToggleGroupItem>
            <ToggleGroupItem value="long">A long press</ToggleGroupItem>
          </ToggleGroup>
        </Field>
      </Kit>

      <Kit name="Key binding">
        <div className="flex items-center gap-2">
          <Kbd>Joystick 1 · Button 7</Kbd>
          <Button variant="outline" size="sm" className="ml-auto">
            <Keyboard data-icon="inline-start" /> Bind
          </Button>
          <Button variant="ghost" size="sm">
            Clear
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Press a key or a button on your hardware
          </span>
          <Button variant="ghost" size="sm" className="ml-auto">
            Cancel
          </Button>
        </div>
      </Kit>

      <Kit name="Color swatches">
        <div className="flex flex-wrap gap-2">
          {PILOT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setFigure(c)}
              aria-label={c}
              className="size-7 rounded-full ring-offset-2 ring-offset-background transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-ring data-[on=true]:ring-2 data-[on=true]:ring-foreground"
              data-on={figure === c}
              style={{ background: color(c, 400) }}
            />
          ))}
        </div>
      </Kit>

      <Kit name="Status chips">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip level="info">Relay</StatusChip>
          <StatusChip level="warning">Different livery</StatusChip>
          <StatusChip level="trouble">Link lost</StatusChip>
          <StatusChip level="success">Ready</StatusChip>
          <Badge variant="secondary">Pilot flying</Badge>
          <Badge variant="outline">Experimental</Badge>
        </div>
      </Kit>

      <Kit name="Avatars">
        <div className="flex items-center gap-4">
          {CREW.map((m) => (
            <Avatar key={m.name}>
              <AvatarFallback style={{ background: color(m.hue, 400), color: "black" }}>{m.name === "You" ? "J" : m.name[0]}</AvatarFallback>
            </Avatar>
          ))}
          <AvatarGroup>
            {CREW.map((m) => (
              <Avatar key={m.name} size="sm">
                <AvatarFallback style={{ background: color(m.hue, 400), color: "black" }}>{m.name === "You" ? "J" : m.name[0]}</AvatarFallback>
              </Avatar>
            ))}
          </AvatarGroup>
        </div>
      </Kit>

      <Kit name="Progress">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span>Downloading Dual Input 1.0.3</span>
            <span className="text-muted-foreground tabular-nums">62%</span>
          </div>
          <Progress value={62} />
        </div>
      </Kit>

      <Kit name="Spinner">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Reconnecting to James
        </span>
      </Kit>

      <Kit name="Tooltip">
        <span className="flex items-center gap-1 text-sm">
          Relay · 120ms
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label="What's a relay?" />}>
              <Info />
            </TooltipTrigger>
            <TooltipContent>Your link to James goes through our relay server, since a direct one couldn't open.</TooltipContent>
          </Tooltip>
        </span>
      </Kit>

      <Kit name="Tabs">
        <Tabs defaultValue="mine">
          <TabsList>
            <TabsTrigger value="mine">This PC</TabsTrigger>
            <TabsTrigger value="crew">The crew</TabsTrigger>
          </TabsList>
          <TabsContent value="mine" className="pt-2 text-sm text-muted-foreground">
            FSLTL and AIG traffic packs.
          </TabsContent>
          <TabsContent value="crew" className="pt-2 text-sm text-muted-foreground">
            James runs the same packs.
          </TabsContent>
        </Tabs>
      </Kit>

      <Kit name="List">
        <Card size="sm">
          <CardContent className="flex flex-col gap-3">
            {["FSLTL", "AIG", "Asobo's traffic"].map((p, i) => (
              <div key={p} className="flex flex-col gap-3">
                {i > 0 && <Separator />}
                <div className="flex items-center justify-between text-sm">
                  {p}
                  <span className="text-xs text-muted-foreground">{i === 2 ? "Off" : "On"}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </Kit>

      <Kit name="Empty state">
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-8 text-center">
          <PackageOpen className="size-6 text-muted-foreground" />
          <span className="text-sm font-medium">No traffic packs found</span>
          <span className="max-w-64 text-xs text-muted-foreground">Dual Input looks for them in your Community folder.</span>
        </div>
      </Kit>

      <Kit name="Inline alerts">
        <Alert>
          <Info />
          <AlertTitle>Dual Input 1.0.3 is ready</AlertTitle>
          <AlertDescription>Restart the sim to install it.</AlertDescription>
          <AlertAction>
            <Button size="sm">Restart</Button>
          </AlertAction>
        </Alert>
        <Alert variant="destructive">
          <CircleX />
          <AlertTitle>Windows Firewall blocks Dual Input</AlertTitle>
          <AlertDescription>Your crew's links go through our relay server until you allow it.</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline">
              Fix
            </Button>
          </AlertAction>
        </Alert>
      </Kit>

      <Kit name="Confirm dialog">
        <LeaveDialog trigger={<Button variant="outline">Leave the session…</Button>} />
      </Kit>

      <Kit name="Notification">
        <div className="flex items-start gap-3 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium">Lost the link to James</span>
            <span className="text-xs text-muted-foreground">Dual Input is reconnecting. You can take control.</span>
          </div>
          <Button size="sm" variant="secondary">
            Take control
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Dismiss">
            <X />
          </Button>
        </div>
      </Kit>
    </div>
  )
}

// The frame grows with its content, so every component shows without scrolling; the canvas marks
// where the EFB's own 716px height ends.
export function PreflightFrame({ theme }: { theme: Theme }) {
  return (
    <AppFrame theme={theme}>
      <div className="flex flex-1 flex-col gap-6 p-5 pt-0">
        <SessionCard />
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium">UI kit, in place of the preflight checklist</h2>
          <UiKit />
        </section>
      </div>
    </AppFrame>
  )
}
