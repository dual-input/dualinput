import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import "@fontsource-variable/inter"
import "@fontsource-variable/figtree"
import "@fontsource-variable/jetbrains-mono"
import "@fontsource/roboto/400.css"
import "@fontsource/roboto/500.css"
import "@fontsource/roboto/700.css"
import "@fontsource/roboto-mono/400.css"
import "@fontsource/ibm-plex-sans/400.css"
import "@fontsource/ibm-plex-sans/500.css"
import "@fontsource/ibm-plex-sans/600.css"
import "@fontsource/ibm-plex-mono/400.css"
import "../index.css"
import { Canvas } from "./canvas"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Canvas />
  </StrictMode>
)
