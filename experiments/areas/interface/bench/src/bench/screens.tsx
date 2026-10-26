// What the window shows behind each of the sketch's tabs, and a sheet of every component,
// drawn with whichever preset's components the window's context holds. The words are
// placeholders for judging colors and style, not the apps' copy.
import { useState } from "react"
import { toast } from "sonner"
import {
  AlertTriangle, ArrowLeft, Check, CircleAlert, Copy, Headset, Info, Keyboard, LogOut, OctagonX, PersonStanding, Plane, RefreshCw,
} from "lucide-react"

import { useTheme, useUI } from "./ui"
import { CHIPS, color, PILOT_COLORS } from "./theme"

export type Status = "ok" | "warning" | "trouble"

type Level = "info" | "warning" | "trouble" | "success"

// Written out whole, since Tailwind finds a class only where its full name appears.
const CHIP_CLASSES: Record<string, Record<Level, string>> = {
  soft: { info: "bg-info/15 text-info", warning: "bg-warning/15 text-warning", trouble: "bg-destructive/15 text-destructive", success: "bg-success/15 text-success" },
  solid: { info: "bg-info text-info-foreground", warning: "bg-warning text-warning-foreground", trouble: "bg-destructive text-destructive-foreground", success: "bg-success text-success-foreground" },
  outline: { info: "border-info/50 text-info", warning: "border-warning/50 text-warning", trouble: "border-destructive/50 text-destructive", success: "border-success/50 text-success" },
  dot: { info: "bg-secondary text-secondary-foreground", warning: "bg-secondary text-secondary-foreground", trouble: "bg-secondary text-secondary-foreground", success: "bg-secondary text-secondary-foreground" },
}
const DOT_CLASSES: Record<Level, string> = { info: "bg-info", warning: "bg-warning", trouble: "bg-destructive", success: "bg-success" }

export function StatusChip({ level, children, style }: { level: Level; children: React.ReactNode; style?: string }) {
  const { Badge } = useUI()
  const theme = useTheme()
  const chip = style ?? theme.chip ?? "soft"
  return (
    <Badge variant="outline" className={(chip === "outline" ? "" : "border-transparent ") + CHIP_CLASSES[chip][level]}>
      {chip === "dot" && <span className={"size-1.5 rounded-full " + DOT_CLASSES[level]} />}
      {children}
    </Badge>
  )
}

const CREW = [
  { name: "Alex", initials: "AL", color: "blue", role: "Pilot flying", where: "In the flight", ready: true },
  { name: "Sam", initials: "SA", color: "orange", role: "", where: "In the menu", ready: false },
  { name: "Robin", initials: "RO", color: "teal", role: "", where: "Link lost", ready: false },
]

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Dot({ hue }: { hue: string }) {
  return <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: color(hue, 400) }} />
}

export function StatusRow({ status, inSession }: { status: Status; inSession: boolean }) {
  const { Tooltip, TooltipTrigger, TooltipContent } = useUI()
  const ok = (label: string) => (
    <span className="flex items-center gap-1 text-muted-foreground">
      {label} <Check className="size-3.5 text-success" />
    </span>
  )
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 px-4 text-xs">
      {ok("Sim")}
      {status === "warning" ? (
        <Tooltip>
          <TooltipTrigger render={<span className="flex cursor-default items-center gap-1 text-warning" />}>
            <AlertTriangle className="size-3.5" /> No profile for this aircraft
          </TooltipTrigger>
          <TooltipContent>Dual Input syncs nothing in the cockpit of an aircraft without a profile.</TooltipContent>
        </Tooltip>
      ) : (
        ok("Aircraft")
      )}
      {inSession && status !== "trouble" && ok("Crew")}
      {status === "trouble" && (
        <span className="flex items-center gap-1 text-destructive">
          <OctagonX className="size-3.5" /> Lost the link to Robin, reconnecting
        </span>
      )}
    </div>
  )
}

export function Home({ onJoin, onHost }: { onJoin: () => void; onHost: () => void }) {
  const { Button } = useUI()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <Button size="lg" className="w-44" onClick={onHost}>
        Host
      </Button>
      <Button variant="link" onClick={onJoin}>
        Join
      </Button>
    </div>
  )
}

export function Join({ onBack, onJoined }: { onBack: () => void; onJoined: () => void }) {
  const { Button, Field, FieldLabel, FieldDescription, Input, InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } = useUI()
  const [code, setCode] = useState("K7R4")
  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <Button variant="ghost" size="sm" className="self-start" onClick={onBack}>
        <ArrowLeft data-icon="inline-start" /> Back
      </Button>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Join a session</h1>
        <p className="text-sm text-muted-foreground">Ask the host for the six-character invite code.</p>
      </div>
      <Field>
        <FieldLabel>Your name</FieldLabel>
        <Input defaultValue="Jordan" />
        <FieldDescription>The crew sees this name.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel>Invite code</FieldLabel>
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
      </Field>
      <Button className="mt-2" onClick={onJoined}>
        Join
      </Button>
    </div>
  )
}

export function Session({ onLeave }: { onLeave: () => void }) {
  const ui = useUI()
  const { Button, Badge, Card, CardContent, Separator, Tooltip, TooltipTrigger, TooltipContent, Avatar, AvatarFallback } = ui
  const { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } = ui
  return (
    <div className="flex flex-col gap-6 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Invite code</span>
          <span className="font-mono text-base tracking-widest">K7R-4XM</span>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" />}>
              <Copy />
            </TooltipTrigger>
            <TooltipContent>Copy</TooltipContent>
          </Tooltip>
        </div>
        <Badge variant="secondary">Preflight</Badge>
      </div>

      <Section title="Crew">
        <Card size="sm">
          <CardContent className="flex flex-col gap-3">
            {CREW.map((m, i) => (
              <div key={m.name} className="flex flex-col gap-3">
                {i > 0 && <Separator />}
                <div className="flex items-center gap-3">
                  <Avatar size="sm">
                    <AvatarFallback style={{ background: color(m.color, 500), color: "white" }}>{m.initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {m.name} {m.role && <Badge variant="outline">{m.role}</Badge>}
                    </span>
                    <span className={m.where === "Link lost" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{m.where}</span>
                  </div>
                  {m.ready ? <StatusChip level="success">Ready</StatusChip> : m.where === "Link lost" ? <StatusChip level="trouble">Link lost</StatusChip> : <Badge variant="ghost">Not ready</Badge>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </Section>

      <Section title="Control">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm">
            <Dot hue="blue" /> Alex has control
          </span>
          <Button variant="secondary" size="sm">
            Take control
          </Button>
        </div>
      </Section>

      <Section title="Match check">
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-start gap-2">
            <OctagonX className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span>
              Sam runs version 2.1.2 of the aircraft, and Alex runs 2.1.3. <span className="text-muted-foreground">Sam updates it.</span>
            </span>
          </div>
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              Different liveries. <span className="text-muted-foreground">Each pilot sees their own.</span>
            </span>
          </div>
        </div>
      </Section>

      <div className="flex flex-wrap items-center gap-2">
        <Button>Ready</Button>
        <Button variant="outline">Go without Robin</Button>
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="ghost" className="ml-auto text-destructive" />}>
            <LogOut data-icon="inline-start" /> Leave
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Leave the session?</AlertDialogTitle>
              <AlertDialogDescription>The crew flies on without you. You can join again with the same code.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Stay</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onLeave}>
                Leave
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}

export function Traffic() {
  const { Switch, Slider, Field, FieldLabel, FieldDescription, FieldContent, Checkbox, Card, CardContent, Separator } = useUI()
  const [radius, setRadius] = useState([40])
  const packs = ["FSLTL", "AIG", "Asobo's traffic"]
  return (
    <div className="flex flex-col gap-6 p-5">
      <h1 className="flex items-center gap-2 text-lg font-semibold">
        <Plane className="size-5" /> Traffic
      </h1>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel>Share my traffic and ATC</FieldLabel>
          <FieldDescription>The crew sees the aircraft around you and hears your ATC.</FieldDescription>
        </FieldContent>
        <Switch defaultChecked />
      </Field>
      <Field>
        <div className="flex items-center justify-between">
          <FieldLabel>Radius</FieldLabel>
          <span className="font-mono text-sm text-muted-foreground">{radius[0]} km</span>
        </div>
        <Slider value={radius} onValueChange={(v: number | number[]) => setRadius(Array.isArray(v) ? v : [v])} max={100} step={5} />
      </Field>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Traffic packs on this PC</h2>
        <Card size="sm">
          <CardContent className="flex flex-col gap-3">
            {packs.map((p, i) => (
              <div key={p} className="flex flex-col gap-3">
                {i > 0 && <Separator />}
                <label className="flex items-center gap-3 text-sm">
                  <Checkbox defaultChecked={i < 2} /> {p}
                </label>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export function AtcAudio() {
  const { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Field, FieldLabel, FieldDescription, Spinner, Alert, AlertTitle, AlertDescription } = useUI()
  const programs = [
    { value: "beyondatc", label: "BeyondATC" },
    { value: "sayintentions", label: "SayIntentions" },
  ]
  const devices = [
    { value: "default", label: "Windows' default" },
    { value: "headset", label: "Headset (USB Audio)" },
    { value: "speakers", label: "Speakers (Realtek)" },
  ]
  return (
    <div className="flex flex-col gap-6 p-5">
      <h1 className="flex items-center gap-2 text-lg font-semibold">
        <Headset className="size-5" /> ATC audio
      </h1>
      <Alert>
        <Spinner />
        <AlertTitle>Waiting for BeyondATC</AlertTitle>
        <AlertDescription>Dual Input starts sending its voice to the crew once it runs.</AlertDescription>
      </Alert>
      <Field>
        <FieldLabel>Program to capture</FieldLabel>
        <Select items={programs} defaultValue="beyondatc">
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {programs.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel>Play the crew's ATC on</FieldLabel>
        <Select items={devices} defaultValue="headset">
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {devices.map((d) => (
              <SelectItem key={d.value} value={d.value}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>Unplugged, it plays on Windows' default.</FieldDescription>
      </Field>
    </div>
  )
}

export function Avatars() {
  const { Switch, Field, FieldLabel, FieldDescription, FieldContent, Separator } = useUI()
  const [pick, setPick] = useState("blue")
  return (
    <div className="flex flex-col gap-6 p-5">
      <h1 className="flex items-center gap-2 text-lg font-semibold">
        <PersonStanding className="size-5" /> Avatars
      </h1>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel>Show my figure</FieldLabel>
          <FieldDescription>Your own figure, in your seat.</FieldDescription>
        </FieldContent>
        <Switch defaultChecked />
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel>Show the crew's figures</FieldLabel>
        </FieldContent>
        <Switch defaultChecked />
      </Field>
      <Separator />
      <Field>
        <FieldLabel>My figure's color</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {PILOT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setPick(c)}
              aria-label={c}
              className="size-8 rounded-full ring-offset-2 ring-offset-background transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-ring data-[on=true]:ring-2 data-[on=true]:ring-foreground"
              data-on={pick === c}
              style={{ background: color(c, 500) }}
            />
          ))}
        </div>
        <FieldDescription>Two pilots with one color both show it, and sort it out between themselves.</FieldDescription>
      </Field>
    </div>
  )
}

export function Settings() {
  const { Field, FieldLabel, FieldDescription, FieldContent, Input, Switch, Button, Kbd, Progress, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } = useUI()
  return (
    <div className="flex flex-col gap-6 p-5">
      <h1 className="text-lg font-semibold">Settings</h1>
      <Field>
        <FieldLabel>Your name</FieldLabel>
        <Input defaultValue="Jordan" />
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel>Take-control key</FieldLabel>
          <FieldDescription>Press it to take control, and again to confirm.</FieldDescription>
        </FieldContent>
        <div className="flex items-center gap-2">
          <Kbd>Joystick 1 · Button 7</Kbd>
          <Button variant="outline" size="sm">
            <Keyboard data-icon="inline-start" /> Bind
          </Button>
        </div>
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel>Start with Windows</FieldLabel>
          <FieldDescription>Dual Input waits in the tray and starts its core when the sim does.</FieldDescription>
        </FieldContent>
        <Switch defaultChecked />
      </Field>
      <Card size="sm">
        <CardHeader>
          <CardTitle>Update</CardTitle>
          <CardDescription>Version 1.0.3 is downloading.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Progress value={64} />
          <span className="text-xs text-muted-foreground">It installs once the sim closes and you leave the session.</span>
        </CardContent>
        <CardFooter className="gap-2">
          <Button size="sm" disabled>
            Install now
          </Button>
          <Button size="sm" variant="ghost">
            <RefreshCw data-icon="inline-start" /> Check now
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

// Every component and state the screens don't show, for judging a style as a whole.
export function Components() {
  const ui = useUI()
  const { Button, Badge, Alert, AlertTitle, AlertDescription, ToggleGroup, ToggleGroupItem, Tabs, TabsList, TabsTrigger, TabsContent } = ui
  const { RadioGroup, RadioGroupItem, Checkbox, Switch, Skeleton, Spinner, Kbd, Input } = ui
  const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } = ui
  const { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } = ui
  return (
    <div className="flex flex-col gap-6 p-5">
      <Section title="Buttons">
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs">Extra small</Button>
          <Button size="sm">Small</Button>
          <Button>Default</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" variant="outline">
            <Copy />
          </Button>
        </div>
      </Section>

      <Section title="Notifications, by level">
        <Alert className="border-info/30 text-info">
          <Info />
          <AlertTitle>Sam joined the session</AlertTitle>
          <AlertDescription className="text-muted-foreground">Information</AlertDescription>
        </Alert>
        <Alert className="border-warning/30 bg-warning/10 text-warning">
          <AlertTriangle />
          <AlertTitle>Sam is in the pause menu</AlertTitle>
          <AlertDescription className="text-warning/80">Warning</AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>You've lost the connection</AlertTitle>
          <AlertDescription>Trouble that costs you a feature</AlertDescription>
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => toast("Sam joined the session")}>
            Toast
          </Button>
          <Button size="sm" variant="outline" onClick={() => toast.warning("Sam is in the pause menu")}>
            Warning toast
          </Button>
          <Button size="sm" variant="outline" onClick={() => toast.error("You've lost the connection")}>
            Trouble toast
          </Button>
          <Button size="sm" variant="outline" onClick={() => toast.success("You have control")}>
            Success toast
          </Button>
        </div>
      </Section>

      <Section title="Status chips, in each style">
        <div className="grid grid-cols-[4.5rem_repeat(4,auto)] items-center justify-start gap-x-2 gap-y-2">
          {CHIPS.map((style) => (
            <div key={style} className="contents">
              <span className="text-xs text-muted-foreground">{style}</span>
              <StatusChip level="success" style={style}>Ready</StatusChip>
              <StatusChip level="warning" style={style}>Warning</StatusChip>
              <StatusChip level="trouble" style={style}>Link lost</StatusChip>
              <StatusChip level="info" style={style}>Info</StatusChip>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap gap-2">
          <Badge>Primary</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
        </div>
      </Section>

      <Section title="Controls">
        <div className="flex flex-wrap items-center gap-4">
          <ToggleGroup defaultValue={["all"]} variant="outline">
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="mine">Mine</ToggleGroupItem>
            <ToggleGroupItem value="crew">Crew</ToggleGroupItem>
          </ToggleGroup>
          <RadioGroup defaultValue="a" className="flex gap-3">
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="a" /> One
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="b" /> Two
            </label>
          </RadioGroup>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox defaultChecked /> Check
          </label>
          <Switch defaultChecked />
          <Spinner />
          <Kbd>Ctrl</Kbd>
        </div>
        <Input placeholder="A text field" />
        <Tabs defaultValue="one">
          <TabsList>
            <TabsTrigger value="one">One</TabsTrigger>
            <TabsTrigger value="two">Two</TabsTrigger>
            <TabsTrigger value="three">Three</TabsTrigger>
          </TabsList>
          <TabsContent value="one" className="pt-2 text-sm text-muted-foreground">
            Tabs, as shadcn draws them.
          </TabsContent>
        </Tabs>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>Menu</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuGroup>
                <DropdownMenuLabel>Session</DropdownMenuLabel>
                <DropdownMenuItem>Copy the invite code</DropdownMenuItem>
                <DropdownMenuItem>Mark the moment</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">Leave</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog>
            <DialogTrigger render={<Button variant="outline" size="sm" />}>Dialog</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Bind the take-control key</DialogTitle>
                <DialogDescription>Press the key or button you want, on any device.</DialogDescription>
              </DialogHeader>
              <div className="flex h-20 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">Waiting for a press</div>
              <DialogFooter>
                <Button variant="outline">Cancel</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </Section>

      <Section title="Loading">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      </Section>
    </div>
  )
}
