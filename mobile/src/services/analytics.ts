import PostHog from "posthog-react-native"

import {getSetting} from "@/stores/settings"

/**
 * Anonymous usage statistics: screen views and how sessions go, never names,
 * addresses, keys, typed text or anything on the computer's screen. No person
 * profiles, no session replay. Off when "Share usage statistics" is off.
 */
const posthog = new PostHog("phc_CgPN6GEjcAmbeVNni29PgWcoRnSM3MUrCu8FTxRDtXCh", {
  host: "https://z.tetramo.com",
  personProfiles: "never",
  defaultOptIn: getSetting("share_analytics"),
  enableSessionReplay: false,
  before_send: (event) => event && {...event, properties: {...event.properties, surface: "mobile"}},
})

type Properties = Record<string, string | number | boolean>

export function setAnalyticsEnabled(enabled: boolean) {
  void (enabled ? posthog.optIn() : posthog.optOut())
}

export function trackScreen(name: string) {
  posthog.screen(name)
}

export function track(event: string, properties?: Properties) {
  posthog.capture(event, properties)
}
