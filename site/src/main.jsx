import {StrictMode} from "react"
import {createRoot, hydrateRoot} from "react-dom/client"

import App from "./App.jsx"
import "./styles.css"

const root = document.getElementById("root")
const app = (
  <StrictMode>
    <App />
  </StrictMode>
)

if (root.hasChildNodes()) hydrateRoot(root, app)
else createRoot(root).render(app)

import("posthog-js").then(({default: posthog}) =>
  posthog.init("phc_CgPN6GEjcAmbeVNni29PgWcoRnSM3MUrCu8FTxRDtXCh", {
    api_host: "https://z.tetramo.com",
    ui_host: "https://us.posthog.com",
    defaults: "2026-08-30",
    person_profiles: "never",
    persistence: "localStorage",
    disable_session_recording: true,
  }),
)
