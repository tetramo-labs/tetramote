// Asks scripts/screenshots-ios.mjs to capture the current screen; it answers once every posture is done.
// Without CAPTURE_URL (a plain `maestro test`) the flow falls back to Maestro's own screenshot.
var name = typeof SHOT !== "undefined" && SHOT ? SHOT : "screenshot"
var base = typeof CAPTURE_URL !== "undefined" ? CAPTURE_URL : ""

if (base && base.indexOf("http") === 0) {
  http.get(base + "/capture?name=" + name)
} else {
  output.captureFallback = name
}
