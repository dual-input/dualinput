// What the header's pill and island show: only what needs the pilot, each as a word, and as a row with what
// it costs (record/areas/interface/decisions.md, "The header shows only what needs the pilot").

import { Button, toast } from "@dualinput/ui"
import { CircleArrowUp, CircleX, TriangleAlert } from "lucide-react"
import type { ReactNode } from "react"

/** What needs this PC's pilot, as the header reads it from the core's slices and the desktop app's local port. */
export type HeaderStatus = {
  offline?: boolean
  servers?: "reachable" | "unreachable"
  firewall?: "allows" | "blocks"
  /** Asks the desktop app to add the rule, with its UAC prompt. */
  fixFirewall?: () => void
  /** The connection to other pilots failed to open. */
  connection?: boolean
  module?: "stopped" | "missing"
  bridge?: boolean
  helper?: boolean
  /** Something a feature asked of the Windows helper that it can't carry out, in the feature's own words, as a key Windows refuses. */
  want?: { title: string; detail?: string }
  update?: { next: string; have: string; view: () => void }
}

export type Tone = "bad" | "warn" | "news"

export const TONE_ICON: Record<Tone, ReactNode> = {
  bad: <CircleX className="size-4 text-destructive" />,
  warn: <TriangleAlert className="size-4 text-warning" />,
  news: <CircleArrowUp className="size-4 text-primary" />,
}

/** A row's title says what's wrong, as the pilot sees it, and its detail what that costs. */
export type Issue = {
  tone: Tone
  word: string
  title: string
  detail: string
  action?: ReactNode
  /** Its action takes the pilot elsewhere, so the island closes with it. */
  actionCloses?: boolean
}

/**
 * What a status shows, in the header's order. The PC offline stands in for our servers, since with no
 * internet Dual Input can't tell whether they answer. In a session each row says what it costs there:
 * offline cuts every link to the crew, so it stays an error; a running session doesn't wait on our servers,
 * and its links have their paths already, so those two become warnings; and installing an update restarts the
 * sim, so its row waits until the session ends.
 */
export function issuesOf(status: HeaderStatus, inSession: boolean): Issue[] {
  const issues: Issue[] = []
  if (status.offline) {
    issues.push({
      tone: "bad",
      word: "Internet",
      title: "Your PC seems offline",
      detail: inSession ? "You've lost the connection to the others. When it's back, Dual Input will reconnect you and catch you up." : "Dual Input needs an internet connection to host or join.",
    })
  } else if (status.servers === "unreachable") {
    issues.push({
      tone: inSession ? "warn" : "bad",
      word: "Servers",
      title: "Can't reach our servers",
      detail: inSession ? "Pilots can't join or rejoin your session until our servers are back." : "Dual Input needs them to connect you and your crew.",
    })
  }
  if (status.firewall === "blocks") {
    issues.push({
      tone: inSession ? "warn" : "bad",
      word: "Firewall",
      title: "Windows Firewall is blocking Dual Input",
      detail: inSession ? "Connections may run through our relay servers, with more latency." : "You can still connect through our relay servers, but with more latency.",
      action: (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            status.fixFirewall?.()
            toast("Waiting for Windows")
          }}
        >
          Fix
        </Button>
      ),
    })
  }
  if (status.connection) {
    issues.push({
      tone: "bad",
      word: "Connection",
      title: "Dual Input can't open its connection to other pilots",
      detail: inSession ? "Your crew can't reach you until it opens." : "You can't host or join until it opens.",
    })
  }
  if (status.bridge) issues.push({ tone: "bad", word: "Screens", title: "Cockpit screens aren't syncing", detail: "Dual Input couldn't load into the cockpit's panels. Another add-on that replaces VCockpit.js is the likeliest cause." })
  if (status.module === "stopped") issues.push({ tone: "bad", word: "WASM", title: "Dual Input's WASM module stopped", detail: "Restart the sim to fly together again." })
  if (status.module === "missing") issues.push({ tone: "bad", word: "WASM", title: "Dual Input's WASM module is missing", detail: "Reinstall Dual Input with the sim closed to fly together again." })
  if (status.helper) issues.push({ tone: "bad", word: "Helper", title: "Dual Input's Windows helper is down", detail: "Keybinds, audio, and your figure's pointing won't work until it's back." })
  if (status.want) issues.push({ tone: "warn", word: "Keybind", title: status.want.title, detail: status.want.detail ?? "" })
  if (status.update && !inSession) {
    issues.push({
      tone: "news",
      word: "Update",
      title: `Dual Input ${status.update.next} is ready`,
      detail: `You have ${status.update.have}.`,
      actionCloses: true,
      action: (
        <Button size="sm" variant="secondary" onClick={status.update.view}>
          View update
        </Button>
      ),
    })
  }
  return issues
}
