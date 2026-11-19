import Foundation

/// The two-byte AAC-LC config (object type 2) the phone's decoder is primed with.
enum AudioSpecificConfig {
  private static let sampleRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]

  static func aacLC(sampleRate: Int, channels: Int) -> Data? {
    guard let index = sampleRates.firstIndex(of: sampleRate), (1 ... 7).contains(channels) else { return nil }
    let bits = UInt16(2) << 11 | UInt16(index) << 7 | UInt16(channels) << 3
    return Data([UInt8(bits >> 8), UInt8(bits & 0xFF)])
  }
}
