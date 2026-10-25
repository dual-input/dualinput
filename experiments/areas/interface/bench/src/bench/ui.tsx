// Every preset's components, by preset, so one window can draw with Nova's and the next with Sera's.
import { createContext, useContext } from "react"

const modules = import.meta.glob("/src/presets/*/*.tsx", { eager: true }) as Record<string, Record<string, unknown>>

export const UI: Record<string, any> = {}
for (const [path, mod] of Object.entries(modules)) {
  const preset = path.split("/")[3]
  UI[preset] = { ...(UI[preset] ?? {}), ...mod }
}

export const UIContext = createContext<any>(UI.nova)
export const useUI = () => useContext(UIContext)

// The window's theme, for what draws by a switch rather than by a variable, such as the chips' style.
export const ThemeContext = createContext<any>({})
export const useTheme = () => useContext(ThemeContext)
