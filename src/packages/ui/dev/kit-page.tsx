// Every component of the kit in every state, on one page, to check by eye in Coherent GT. Each row
// holds its states as they'd rest; what a state needs a mouse for shows through data-force, which only
// this page's stylesheet reads (tools/dev.ts), and the components beside them take a real mouse.
//
//   node tools/dev.ts kit

import { ArrowRightLeft, Check, Copy, Headset, Plane, PersonStanding, Settings, Trash2, TriangleAlert, Users, Volume2, X } from "lucide-react"
import { useEffect, useState } from "react"
import type { ReactNode } from "react"

import { Badge, Button, Card, CardContent, CodeInput, Confirm, Dialog, Input, Kbd, Label, Link, Popover, PopoverContent, PopoverTrigger, Root, Select, SelectContent, SelectItem, SelectTrigger, Separator, Slider, Spinner, Switch, TabBar, toast, ToastCard, Toaster, Tooltip } from "../src/index.ts"
import type { ButtonProps, ButtonSize, ButtonVariant } from "../src/index.ts"

const SCALES = [0.72, 0.884, 1, 1.056, 1.225]
const VARIANTS: ButtonVariant[] = ["default", "secondary", "outline", "ghost", "destructive", "success", "warning", "danger"]
const SIZES: ButtonSize[] = ["xs", "sm", "default", "lg"]
const FORCED: [string, string | undefined, boolean, boolean][] = [
  ["At rest", undefined, false, false],
  ["Hover", "hover", false, false],
  ["Pressed", "hover", false, true],
  ["Disabled", undefined, true, false],
]

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold">{title}</h2>
      {note && <p className="mt-1 text-sm text-muted-foreground">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

/** One state, under its name. */
function State({ name, width, children }: { name: string; width?: number; children: ReactNode }) {
  return (
    <div className="mb-4 mr-6" style={{ width }}>
      <div className="mb-2 text-xs text-muted-foreground">{name}</div>
      {children}
    </div>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-start">{children}</div>
}

function Buttons() {
  return (
    <Section title="Button" note="Each variant at rest, hovered, pressed, and disabled; then each size, with an icon, working, and asking.">
      {VARIANTS.map((variant) => (
        <Row key={variant}>
          <div className="w-24 pt-7 text-xs text-muted-foreground">{variant}</div>
          {FORCED.map(([name, force, disabled, pressed]) => (
            <State key={name} name={name}>
              <Button variant={variant} disabled={disabled} {...({ "data-force": force, "data-pressed": pressed ? "" : undefined } as ButtonProps)}>
                Host a session
              </Button>
            </State>
          ))}
        </Row>
      ))}
      <Row>
        {SIZES.map((size) => (
          <State key={size} name={size}>
            <Button size={size}>Join</Button>
          </State>
        ))}
        <State name="icon-sm">
          <Button variant="ghost" size="icon-sm" aria-label="Copy">
            <Copy />
          </Button>
        </State>
        <State name="icon">
          <Button variant="secondary" size="icon" aria-label="Close">
            <X />
          </Button>
        </State>
        <State name="Icon and word">
          <Button variant="outline">
            <ArrowRightLeft />
            Take over
          </Button>
        </State>
        <State name="Word and icon, small">
          <Button size="sm" variant="secondary">
            Check now
            <Check />
          </Button>
        </State>
        <State name="Working">
          <Button disabled>
            <Spinner />
            Starting
          </Button>
        </State>
        <State name="Done">
          <Button variant="success">
            <Check />
            Ready
          </Button>
        </State>
      </Row>
    </Section>
  )
}

function Links() {
  return (
    <Section title="Link" note="One link, in a sentence or on its own. Hovering draws its line, in the color of its words.">
      <Row>
        <State name="In a sentence, live" width={260}>
          <p className="text-muted-foreground">
            Something wrong? <Link>Ask on our Discord</Link>
          </p>
        </State>
        <State name="Hover" width={260}>
          <p className="text-muted-foreground">
            Something wrong? <Link data-force="hover">Ask on our Discord</Link>
          </p>
        </State>
        <State name="Pressed" width={260}>
          <p className="text-muted-foreground">
            Something wrong? <Link data-force="hover" data-pressed="">Ask on our Discord</Link>
          </p>
        </State>
        <State name="Hover, over lines" width={200}>
          <p className="text-muted-foreground">
            Something wrong? <Link data-force="hover">Ask on our Discord, where people can help</Link>
          </p>
        </State>
      </Row>
      <Row>
        <State name="On its own, live">
          <Link className="font-medium">See how</Link>
        </State>
        <State name="Hover">
          <Link className="font-medium" data-force="hover">See how</Link>
        </State>
        <State name="Pressed">
          <Link className="font-medium" data-force="hover" data-pressed="">
            See how
          </Link>
        </State>
        <State name="Disabled">
          <Link className="font-medium" disabled>See how</Link>
        </State>
        <State name="Muted, live">
          <Link className="font-medium" tone="muted">Skip guide</Link>
        </State>
        <State name="Warning box's, live">
          <Link className="font-medium" tone="warning">Continue anyway</Link>
        </State>
        <State name="Trouble box's, hover">
          <Link className="font-medium" tone="destructive" data-force="hover">
            Continue anyway
          </Link>
        </State>
        <State name="With an icon, live">
          <Link className="font-medium" icon={<ArrowRightLeft />}>Switch to a supported aircraft</Link>
        </State>
        <State name="With an icon, hover">
          <Link className="font-medium" icon={<ArrowRightLeft />} data-force="hover">
            Switch to a supported aircraft
          </Link>
        </State>
        <State name="With an icon, disabled">
          <Link className="font-medium" icon={<ArrowRightLeft />} disabled>
            Learn how to build a profile
          </Link>
        </State>
      </Row>
    </Section>
  )
}

function Fields() {
  const [name, setName] = useState("James")
  const [code, setCode] = useState("")
  return (
    <Section title="Fields" note="The live ones take the keyboard. A field holds it while focused, and gives it back on blur.">
      <Row>
        <State name="Live" width={220}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} title="Display name" />
        </State>
        <State name="Placeholder" width={220}>
          <Input placeholder="Your name" readOnly />
        </State>
        <State name="Filled" width={220}>
          <Input defaultValue="James" readOnly />
        </State>
        <State name="Focused" width={220}>
          <Input defaultValue="James" readOnly {...({ "data-force": "focus" } as object)} />
        </State>
        <State name="Refused" width={220}>
          <Input defaultValue="James" readOnly invalid />
        </State>
        <State name="Disabled" width={220}>
          <Input defaultValue="James" disabled />
        </State>
      </Row>
      <Row>
        <State name="Invite code, live" width={280}>
          <CodeInput value={code} onChange={setCode} />
        </State>
        <State name="Empty" width={280}>
          <CodeInput value="" onChange={() => {}} />
        </State>
        <State name="Part typed, active" width={280}>
          <CodeInput value="XK4" onChange={() => {}} focused />
        </State>
        <State name="Whole" width={280}>
          <CodeInput value="XK492Q" onChange={() => {}} />
        </State>
        <State name="No such session" width={280}>
          <CodeInput value="XK492Q" onChange={() => {}} invalid />
        </State>
        <State name="No such session, active" width={280}>
          <CodeInput value="XK4" onChange={() => {}} invalid focused />
        </State>
        <State name="Locked while our servers answer" width={280}>
          <CodeInput value="XK492Q" onChange={() => {}} disabled />
        </State>
      </Row>
    </Section>
  )
}

function Switches() {
  const [on, setOn] = useState(true)
  const [volume, setVolume] = useState(70)
  return (
    <Section title="Switch and slider">
      <Row>
        <State name="Live">
          <Switch checked={on} onCheckedChange={setOn} />
        </State>
        <State name="Off">
          <Switch checked={false} />
        </State>
        <State name="On">
          <Switch checked />
        </State>
        <State name="Off, disabled">
          <Switch checked={false} disabled />
        </State>
        <State name="On, disabled">
          <Switch checked disabled />
        </State>
      </Row>
      <Row>
        <State name={`Live, ${volume}%`} width={220}>
          <Slider value={volume} onValueChange={setVolume} />
        </State>
        <State name="Empty" width={220}>
          <Slider value={0} />
        </State>
        <State name="Half" width={220}>
          <Slider value={50} />
        </State>
        <State name="Full" width={220}>
          <Slider value={100} />
        </State>
        <State name="Disabled" width={220}>
          <Slider value={40} disabled />
        </State>
      </Row>
    </Section>
  )
}

const DEVICES = ["Windows default", "Speakers (Realtek)", "Headset (Quest Link)"]

function Selects() {
  const [device, setDevice] = useState(DEVICES[0]!)
  return (
    <Section title="Select">
      <Row>
        <State name="Live" width={240}>
          <Select value={device} onValueChange={setDevice}>
            <SelectTrigger className="w-full">{device}</SelectTrigger>
            <SelectContent>
              {DEVICES.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </State>
        <State name="Closed, with a status" width={240}>
          <Select value="auto" onValueChange={() => {}}>
            <SelectTrigger className="w-full">
              <span className="size-2 rounded-full bg-success" />
              <span>Automatic · BeyondATC</span>
            </SelectTrigger>
          </Select>
        </State>
        <State name="Disabled" width={240}>
          <Select value="auto" onValueChange={() => {}}>
            <SelectTrigger className="w-full" disabled>
              Automatic
            </SelectTrigger>
          </Select>
        </State>
        <State name="Its rows, as they show open" width={240}>
          <div className="rounded-3xl bg-popover p-1.5 shadow-lg ring-1 ring-foreground/10">
            <Select value="b" onValueChange={() => {}}>
              <SelectItem value="a">At rest</SelectItem>
              <SelectItem value="c" {...({ "data-force": "hover" } as object)}>
                Hovered
              </SelectItem>
              <SelectItem value="b">Chosen</SelectItem>
              <SelectItem value="d" disabled>
                Disabled
              </SelectItem>
            </Select>
          </div>
        </State>
      </Row>
    </Section>
  )
}

const TABS = [
  { id: "session", icon: Users, label: "Session" },
  { id: "traffic", icon: Plane, label: "Traffic" },
  { id: "atc", icon: Headset, label: "ATC audio" },
  { id: "figures", icon: PersonStanding, label: "Figures" },
  { id: "settings", icon: Settings, label: "Settings" },
]

function Tabs() {
  const [active, setActive] = useState("session")
  return (
    <Section title="Tab bar" note="The active tab in the main color, the one under the mouse lifted, and an amber dot on a tab holding a warning.">
      <Row>
        <State name="Live, with a dot on Traffic" width={420}>
          <TabBar tabs={TABS.map((t) => (t.id === "traffic" ? { ...t, dot: true } : t))} active={active} onSelect={setActive} />
        </State>
        <State name="Hovered: ATC audio" width={420}>
          <TabBar tabs={TABS.map((t) => (t.id === "atc" ? { ...t, force: "hover" as const } : t))} active="settings" />
        </State>
      </Row>
    </Section>
  )
}

function Popups() {
  const [dialog, setDialog] = useState(false)
  const [left, setLeft] = useState(0)
  return (
    <Section title="Popups" note="The live ones open on a press. A press outside or Escape closes each. The rest are held open to show their look.">
      <Row>
        <State name="Tooltip, live">
          <Tooltip content="Copy the invite code">
            <Button variant="ghost" size="icon-sm" aria-label="Copy">
              <Copy />
            </Button>
          </Tooltip>
        </State>
        <State name="On a disabled button">
          <Tooltip content="Disabled until your aircraft settles" className="max-w-60">
            <span className="inline-flex">
              <Button size="sm" variant="outline" disabled>
                Ready
              </Button>
            </span>
          </Tooltip>
        </State>
        <State name="Popover, live">
          <Popover>
            <PopoverTrigger>
              <Button variant="outline">Open it</Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-4" arrow>
              <div className="text-base font-medium">Your PC seems offline</div>
              <p className="mt-1 text-muted-foreground">Dual Input needs an internet connection to host or join.</p>
            </PopoverContent>
          </Popover>
        </State>
        <State name="Confirm, live">
          <Confirm question="Restart the sim?" go="Restart now" onConfirm={() => toast("Restarting the sim to update")} variant="warning" size="sm">
            Restart
          </Confirm>
        </State>
        <State name="Confirm, tinted button">
          <Confirm question="Leave the session?" go="Leave" onConfirm={() => toast("You left the session")} variant="destructive" size="sm">
            Leave
          </Confirm>
        </State>
        <State name="Confirm, two answers">
          <Confirm question="Join James?" go="Join now" also={{ label: "Set up only", onSelect: () => toast("Set up James's flight") }} onConfirm={() => toast("Joining James")} size="sm">
            Join
          </Confirm>
        </State>
        <State name="Dialog, live">
          <Button variant="secondary" onClick={() => setDialog(true)}>
            Switch aircraft
          </Button>
        </State>
        <State name="Toast, live">
          <Button
            variant="secondary"
            onClick={() => {
              toast(["Copied the invite code", "Opening our Discord in your browser", "Opened in File Explorer, on your desktop"][left % 3]!)
              setLeft(left + 1)
            }}
          >
            Show a toast
          </Button>
        </State>
      </Row>
      <Dialog open={dialog} onOpenChange={setDialog} title="Supported aircraft" description="Click one to load it in the sim.">
        <div className="px-6 pb-6">
          <Card>
            <CardContent>Baron 58P</CardContent>
          </Card>
        </div>
      </Dialog>
      <Row>
        <State name="Toast, as it shows" width={340}>
          <ToastCard text="Copied the invite code" />
        </State>
        <State name="Tooltip, held open, above" width={240}>
          <div className="flex h-20 items-end justify-center">
            <Tooltip content="Copy the invite code" open>
              <Button size="sm" variant="secondary">
                Anchor
              </Button>
            </Tooltip>
          </div>
        </State>
        <State name="Confirm, held open: solid" width={280}>
          <div className="flex h-28 items-end justify-center">
            <Confirm question="Restart the sim?" go="Restart now" onConfirm={() => {}} variant="warning" size="sm" open>
              Restart
            </Confirm>
          </div>
        </State>
        <State name="Confirm, held open: tinted" width={280}>
          <div className="flex h-28 items-end justify-center">
            <Confirm question="Delete this run?" go="Delete" onConfirm={() => {}} variant="destructive" size="sm" open>
              Delete
            </Confirm>
          </div>
        </State>
        <State name="Popover, held open, below" width={340}>
          <div className="h-36">
          <Popover open>
            <PopoverTrigger>
              <Button size="sm" variant="secondary">
                Anchor
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-4" arrow offset={11}>
              <div className="font-medium">Windows Firewall is blocking Dual Input</div>
              <p className="mt-1 text-muted-foreground">Links to other pilots may be slower.</p>
            </PopoverContent>
          </Popover>
          </div>
        </State>
      </Row>
    </Section>
  )
}

function Surfaces() {
  return (
    <Section title="Card, chips, and small marks">
      <Row>
        <State name="Card" width={320}>
          <Card>
            <CardContent>
              <div className="text-base font-medium">Baron 58P</div>
              <p className="mt-1 text-muted-foreground">Asobo · N58DI</p>
            </CardContent>
            <Separator />
            <CardContent className="flex items-center justify-between">
              <span className="text-muted-foreground">Invite code</span>
              <span className="font-mono font-medium">XK4-92Q</span>
            </CardContent>
          </Card>
        </State>
        <State name="Flush, rows to its edges" width={320}>
          <Card flush>
            <div className="flex items-center justify-between px-5 py-3">
              <span>Share my traffic</span>
              <Switch checked={false} />
            </div>
            <Separator />
            <div className="flex items-center justify-between px-5 py-3">
              <span className="flex items-center">
                <Volume2 className="mr-2 size-4 text-muted-foreground" />
                Output device
              </span>
              <Button size="icon-sm" variant="ghost" aria-label="Delete">
                <Trash2 />
              </Button>
            </div>
          </Card>
        </State>
      </Row>
      <Row>
        {(["secondary", "outline", "primary", "info", "warning", "trouble", "success"] as const).map((variant) => (
          <State key={variant} name={variant}>
            <Badge variant={variant}>{variant === "trouble" ? "Sim crashed" : variant === "success" ? "Ready" : variant === "warning" ? "Experimental" : variant === "info" ? "Catching up" : variant === "primary" ? "New" : variant === "outline" ? "Relay · 120ms" : "Stable"}</Badge>
          </State>
        ))}
        <State name="With an icon">
          <Badge variant="warning">
            <TriangleAlert />
            Not ready
          </Badge>
        </State>
        <State name="Kbd">
          <Kbd>F9</Kbd>
        </State>
        <State name="Label">
          <Label>Output device</Label>
        </State>
        <State name="Spinner">
          <Spinner />
        </State>
        <State name="Separator" width={120}>
          <div className="pt-2">
            <Separator />
          </div>
        </State>
        <State name="Between words">
          <div className="flex h-5 items-center">
            <span>Host</span>
            <Separator vertical className="mx-2" />
            <span>Join</span>
          </div>
        </State>
      </Row>
    </Section>
  )
}

function Type() {
  return (
    <Section title="Type and color" note="Geist, drawn by Coherent GT, with Geist Mono for codes.">
      <Row>
        <State name="Sizes" width={360}>
          <p className="text-2xl font-semibold">Fly together, text-2xl</p>
          <p className="text-lg font-semibold">Fly together, text-lg</p>
          <p className="text-base font-medium">Fly together, text-base</p>
          <p className="text-sm">Fly together, text-sm</p>
          <p className="text-xs text-muted-foreground">Fly together, text-xs, muted</p>
          <p className="font-mono text-sm font-medium">XK4-92Q, Geist Mono</p>
        </State>
        <State name="Colors" width={520}>
          <div className="flex flex-wrap">
            {[
              ["background", "bg-background"],
              ["card", "bg-card"],
              ["secondary", "bg-secondary"],
              ["muted-foreground", "bg-muted-foreground"],
              ["foreground", "bg-foreground"],
              ["primary", "bg-primary"],
              ["info", "bg-info"],
              ["warning", "bg-warning"],
              ["destructive", "bg-destructive"],
              ["success", "bg-success"],
            ].map(([label, color]) => (
              <div key={label} className="mb-3 mr-3 w-24">
                <div className={"h-10 rounded-xl ring-1 ring-foreground/10 " + color} />
                <div className="mt-1 text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </State>
      </Row>
    </Section>
  )
}

/** The page. Given a size and a scale, it fills them, as it does in the sim's EFB; given none, it fills the window, with buttons for the scale. */
export function KitPage({ width, height, scale: given }: { width?: number; height?: number; scale?: number }) {
  const [picked, setScale] = useState(1)
  const scale = given ?? picked
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  return (
    <Root scale={scale} className="" style={{ width: `${width ?? size.width / scale}px`, height: `${height ?? size.height / scale}px`, overflow: "hidden" }}>
      <div className="h-full bg-background">
      <div className="flex h-12 items-center border-b bg-card px-5">
        <div className="mr-6 text-sm font-semibold">The kit</div>
        <div className="mr-3 text-xs text-muted-foreground">{given ? `Scale ${given.toFixed(3)}, from the tablet` : "Scale, as the tablet's size would set it"}</div>
        <div className="flex items-center space-x-1">
          {!given && SCALES.map((s) => (
            <Button key={s} size="xs" variant={s === scale ? "default" : "secondary"} onClick={() => setScale(s)}>
              {String(s)}
            </Button>
          ))}
        </div>
      </div>
      <div id="kit-scroll" className="overflow-y-auto px-5 pt-6 [&::-webkit-scrollbar]:w-0" style={{ height: "calc(100% - 48px)" }}>
        <Type />
        <Buttons />
        <Links />
        <Fields />
        <Switches />
        <Selects />
        <Tabs />
        <Popups />
        <Surfaces />
      </div>
      </div>
      <Toaster />
    </Root>
  )
}
