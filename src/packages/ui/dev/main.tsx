// The kit's page on its own, as tools/dev.ts runs it.

import { createRoot } from "react-dom/client"

import { KitPage } from "./kit-page.tsx"

createRoot(document.getElementById("page") as HTMLElement).render(<KitPage />)