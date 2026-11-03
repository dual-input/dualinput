// The window's entry, one esbuild bundle of React, the kit, and the desktop shell, which Tauri embeds in the program.

import { createRoot } from "react-dom/client"

import { VERSION } from "../../../engines/messages/ts/stamp.ts"
import { tauriLink } from "../../../platform/desktop-shell/src/link.ts"
import { DesktopWindow } from "../../../platform/desktop-shell/src/window.tsx"

createRoot(document.getElementById("page") as HTMLElement).render(<DesktopWindow version={VERSION} link={tauriLink} />)
