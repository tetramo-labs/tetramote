/** "Safari on iPhone": the name the computer shows for this browser. */
export function deviceName(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\/|FxiOS\//.test(userAgent)
      ? "Firefox"
      : /Chrome\/|CriOS\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser"
  const os = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /CrOS/.test(userAgent)
          ? "ChromeOS"
          : /Mac OS X|Macintosh/.test(userAgent)
            ? "Mac"
            : /Windows/.test(userAgent)
              ? "Windows"
              : /Linux/.test(userAgent)
                ? "Linux"
                : null
  return os ? `${browser} on ${os}` : browser
}

/** What went wrong and what to do next, for a `rejected` reason or a `disconnected` close reason. */
export function failureText(reason: string, name: string): string {
  if (reason === "badSecret" || reason === "notPaired" || reason.includes("linkChanged")) {
    return `This link no longer works because ${name} made a new one. Copy the current link from Tetramote on that computer.`
  }
  if (reason === "version") {
    return `${name} runs a different version of Tetramote. Update Tetramote on that computer, then try again.`
  }
  if (reason === "badHello") {
    return `${name} didn't accept this browser's first message. Update Tetramote on that computer, then try again.`
  }
  if (reason === "timedOut" || reason.startsWith("connect failed")) {
    return `Couldn't reach ${name}. Check that it's on and Tetramote is running, then try again.`
  }
  if (reason.includes("replaced")) {
    return `Another device connected to ${name} and ended this session. Try again to reconnect, which disconnects that device.`
  }
  return `The connection to ${name} ended (${reason}). Try again.`
}
