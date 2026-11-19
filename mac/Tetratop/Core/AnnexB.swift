import Foundation

enum AnnexB {
  static let startCode: [UInt8] = [0, 0, 0, 1]

  /// Rewrites length-prefixed (AVCC) NAL units with start codes, after the given
  /// parameter sets. Returns nil when a length runs past the buffer.
  static func fromAVCC(_ avcc: Data, lengthSize: Int, parameterSets: [Data] = []) -> Data? {
    guard (1 ... 4).contains(lengthSize) else { return nil }
    var out = Data(capacity: avcc.count + parameterSets.reduce(0) { $0 + $1.count + 4 } + 16)
    for set in parameterSets {
      out.append(contentsOf: startCode)
      out.append(set)
    }
    let bytes = [UInt8](avcc)
    var at = 0
    while at < bytes.count {
      guard at + lengthSize <= bytes.count else { return nil }
      var length = 0
      for i in 0 ..< lengthSize {
        length = length << 8 | Int(bytes[at + i])
      }
      at += lengthSize
      guard length > 0, at + length <= bytes.count else { return nil }
      out.append(contentsOf: startCode)
      out.append(contentsOf: bytes[at ..< at + length])
      at += length
    }
    return out
  }
}
