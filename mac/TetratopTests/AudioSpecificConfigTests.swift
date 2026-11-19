import XCTest

final class AudioSpecificConfigTests: XCTestCase {
  func testAACLC48kStereo() {
    XCTAssertEqual(AudioSpecificConfig.aacLC(sampleRate: 48000, channels: 2), Data([0x11, 0x90]))
  }

  func testAACLC44kMono() {
    XCTAssertEqual(AudioSpecificConfig.aacLC(sampleRate: 44100, channels: 1), Data([0x12, 0x08]))
  }

  func testUnsupportedRate() {
    XCTAssertNil(AudioSpecificConfig.aacLC(sampleRate: 47000, channels: 2))
  }
}
