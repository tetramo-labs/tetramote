import Foundation

/// One input record from the phone, as PROTOCOL.md lays it out (type byte, then a big-endian payload).
enum InputRecord: Equatable {
  case move(dx: Float, dy: Float)
  case moveTo(x: Float, y: Float)
  case button(button: UInt8, down: Bool, clicks: UInt8)
  case scroll(dx: Float, dy: Float, phase: UInt8)
  case key(keyCode: UInt16, down: Bool, flags: UInt32)
  case text(String)

  static func parse(_ record: Data) -> InputRecord? {
    let bytes = [UInt8](record)
    guard let type = bytes.first else { return nil }
    let p = Array(bytes.dropFirst())
    switch type {
    case 0x01:
      guard p.count >= 8 else { return nil }
      return .move(dx: float(p, 0), dy: float(p, 4))
    case 0x02:
      guard p.count >= 8 else { return nil }
      return .moveTo(x: float(p, 0), y: float(p, 4))
    case 0x03:
      guard p.count >= 3 else { return nil }
      return .button(button: p[0], down: p[1] != 0, clicks: max(1, min(p[2], 3)))
    case 0x04:
      guard p.count >= 9 else { return nil }
      return .scroll(dx: float(p, 0), dy: float(p, 4), phase: p[8])
    case 0x05:
      guard p.count >= 7 else { return nil }
      return .key(keyCode: UInt16(p[0]) << 8 | UInt16(p[1]), down: p[2] != 0, flags: uint32(p, 3))
    case 0x06:
      guard let text = String(bytes: p, encoding: .utf8), !text.isEmpty else { return nil }
      return .text(text)
    default:
      return nil
    }
  }

  private static func uint32(_ p: [UInt8], _ at: Int) -> UInt32 {
    UInt32(p[at]) << 24 | UInt32(p[at + 1]) << 16 | UInt32(p[at + 2]) << 8 | UInt32(p[at + 3])
  }

  private static func float(_ p: [UInt8], _ at: Int) -> Float {
    Float(bitPattern: uint32(p, at))
  }
}
