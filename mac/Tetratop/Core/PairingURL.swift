import Foundation

enum PairingURL {
  private static let unreserved = CharacterSet(
    charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  )

  static func make(ticket: String, secret: String, name: String) -> String {
    "tetratop://pair?ticket=\(encode(ticket))&secret=\(encode(secret))&name=\(encode(name))"
  }

  static func encode(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
  }

  static func hex(_ bytes: [UInt8]) -> String {
    bytes.map { String(format: "%02x", $0) }.joined()
  }
}
