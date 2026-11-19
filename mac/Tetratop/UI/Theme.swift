import AppKit
import SwiftUI

enum Theme {
  static let primary = dynamic(light: 0x0043E0, dark: 0x004DFC)
  static let surface = dynamic(light: 0xF5F5F5, dark: 0x2E2E2E)
  static let background = dynamic(light: 0xFFFFFF, dark: 0x171717)
  static let foreground = dynamic(light: 0x0A0A0A, dark: 0xFAFAFA)
  static let muted = dynamic(light: 0x737373, dark: 0xA3A3A3)
  static let border = dynamic(light: 0xE5E5E5, dark: 0x525252)
  static let destructive = dynamic(light: 0xDC2626, dark: 0xF87171)
  static let success = dynamic(light: 0x16A34A, dark: 0x4ADE80)
  static let warning = dynamic(light: 0xD97706, dark: 0xFBBF24)

  private static func dynamic(light: UInt32, dark: UInt32) -> Color {
    Color(nsColor: NSColor(name: nil) { appearance in
      let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
      return color(isDark ? dark : light)
    })
  }

  private static func color(_ hex: UInt32) -> NSColor {
    NSColor(
      srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
      blue: CGFloat(hex & 0xFF) / 255, alpha: 1
    )
  }
}

/// A row in a grouped stack: 16 pt outer corners, 4 pt where rows meet.
struct GroupedRow<Content: View>: View {
  let isFirst: Bool
  let isLast: Bool
  @ViewBuilder let content: Content

  var body: some View {
    content
      .padding(.horizontal, 14)
      .padding(.vertical, 10)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        UnevenRoundedRectangle(
          topLeadingRadius: isFirst ? 16 : 4, bottomLeadingRadius: isLast ? 16 : 4,
          bottomTrailingRadius: isLast ? 16 : 4, topTrailingRadius: isFirst ? 16 : 4
        )
        .fill(Theme.surface)
      )
  }
}

struct PillButtonStyle: ButtonStyle {
  enum Kind { case primary, secondary, destructive }
  var kind: Kind = .secondary

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 12, weight: .medium, design: .rounded))
      .padding(.horizontal, 14)
      .frame(minHeight: 28)
      .foregroundStyle(foreground)
      .background(Capsule().fill(background))
      .overlay(Capsule().strokeBorder(kind == .secondary ? Theme.border : .clear, lineWidth: 1))
      .opacity(configuration.isPressed ? 0.75 : 1)
      .contentShape(Capsule())
  }

  private var foreground: Color {
    switch kind {
    case .primary: .white
    case .secondary: Theme.foreground
    case .destructive: Theme.destructive
    }
  }

  private var background: Color {
    switch kind {
    case .primary: Theme.primary
    case .secondary, .destructive: Theme.background
    }
  }
}

struct GroupTitle: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.system(size: 12, weight: .medium, design: .rounded))
      .foregroundStyle(Theme.muted)
      .padding(.horizontal, 14)
      .padding(.top, 6)
  }
}
