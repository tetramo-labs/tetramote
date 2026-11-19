import AppKit
import ApplicationServices
import CoreGraphics

enum Permissions {
  static var screenRecording: Bool {
    CGPreflightScreenCaptureAccess()
  }

  static var accessibility: Bool {
    AXIsProcessTrusted()
  }

  static func requestScreenRecording() {
    if !CGRequestScreenCaptureAccess() {
      open("Privacy_ScreenCapture")
    }
  }

  static func requestAccessibility() {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary
    if !AXIsProcessTrustedWithOptions(options) {
      open("Privacy_Accessibility")
    }
  }

  private static func open(_ anchor: String) {
    if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(anchor)") {
      NSWorkspace.shared.open(url)
    }
  }
}
