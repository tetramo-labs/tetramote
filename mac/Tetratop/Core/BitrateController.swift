import Foundation

/// Lowers the encoder bitrate when the core's send backlog makes us skip frames,
/// and raises it again after a stretch without skips.
struct BitrateController {
  static let floor = 1_500_000
  static let cap = 20_000_000
  static let start = 8_000_000

  private(set) var bitrate: Int = BitrateController.start
  private var skips: [TimeInterval] = []
  private var lastChange: TimeInterval
  private var lastSkip: TimeInterval

  init(startingAt now: TimeInterval) {
    lastChange = now
    lastSkip = now
  }

  mutating func frameSkipped(at now: TimeInterval) -> Int? {
    lastSkip = now
    skips = skips.filter { now - $0 < 1 } + [now]
    guard skips.count >= 2, now - lastChange >= 1 else { return nil }
    let lowered = max(Self.floor, Int((Double(bitrate) * 0.7).rounded()))
    skips.removeAll()
    lastChange = now
    guard lowered != bitrate else { return nil }
    bitrate = lowered
    return bitrate
  }

  mutating func frameSent(at now: TimeInterval) -> Int? {
    guard now - lastSkip >= 3, now - lastChange >= 3, bitrate < Self.cap else { return nil }
    bitrate = min(Self.cap, Int((Double(bitrate) * 1.1).rounded()))
    lastChange = now
    return bitrate
  }
}
