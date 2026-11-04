import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import "../index.css"
import { CockpitBench } from "./bench"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CockpitBench />
  </StrictMode>
)
