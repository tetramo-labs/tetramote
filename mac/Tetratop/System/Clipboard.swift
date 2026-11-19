import AppKit

/// Text-only clipboard bridge. Text the phone sent is not echoed back to it.
final class Clipboard {
  static let maxBytes = 512 * 1024
  private var changeCount = NSPasteboard.general.changeCount
  private var lastFromPhone: String?

  func read() -> String? {
    guard let text = NSPasteboard.general.string(forType: .string) else { return nil }
    return Self.truncate(text)
  }

  func write(_ text: String) {
    lastFromPhone = text
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
    changeCount = NSPasteboard.general.changeCount
  }

  func resetBaseline() {
    changeCount = NSPasteboard.general.changeCount
  }

  func newText() -> String? {
    let current = NSPasteboard.general.changeCount
    guard current != changeCount else { return nil }
    changeCount = current
    guard let text = read(), text != lastFromPhone else { return nil }
    return text
  }

  private static func truncate(_ text: String) -> String {
    guard text.utf8.count > maxBytes else { return text }
    var end = text.utf8.index(text.utf8.startIndex, offsetBy: maxBytes)
    while end > text.utf8.startIndex, String(text.utf8[..<end]) == nil {
      end = text.utf8.index(before: end)
    }
    return String(text.utf8[..<end]) ?? ""
  }
}
