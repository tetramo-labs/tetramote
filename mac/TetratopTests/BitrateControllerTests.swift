import XCTest

final class BitrateControllerTests: XCTestCase {
  func testStepsDownOnRepeatedSkipsAndUpAfterThreeCleanSeconds() {
    var controller = BitrateController(startingAt: 0)
    XCTAssertNil(controller.frameSent(at: 1))
    XCTAssertNil(controller.frameSkipped(at: 1.0))
    XCTAssertEqual(controller.frameSkipped(at: 1.5), 5_600_000)
    XCTAssertNil(controller.frameSkipped(at: 1.6))
    XCTAssertNil(controller.frameSkipped(at: 1.7))
    XCTAssertEqual(controller.frameSkipped(at: 2.6), 3_920_000)
    XCTAssertNil(controller.frameSent(at: 4.0))
    XCTAssertEqual(controller.frameSent(at: 5.7), 4_312_000)
    XCTAssertNil(controller.frameSent(at: 6.0))
  }

  func testFloorAndCap() {
    var down = BitrateController(startingAt: 0)
    var t = 0.0
    for _ in 0 ..< 20 {
      t += 1
      _ = down.frameSkipped(at: t)
      _ = down.frameSkipped(at: t + 0.1)
    }
    XCTAssertEqual(down.bitrate, 1_500_000)

    var up = BitrateController(startingAt: 0)
    for step in 1 ... 40 {
      _ = up.frameSent(at: Double(step) * 3)
    }
    XCTAssertEqual(up.bitrate, 20_000_000)
  }
}
