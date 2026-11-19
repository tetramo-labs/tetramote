import XCTest

final class InputRecordTests: XCTestCase {
  func testRelativeMove() {
    let record = Data([0x01, 0x3F, 0x80, 0x00, 0x00, 0xC0, 0x00, 0x00, 0x00])
    XCTAssertEqual(InputRecord.parse(record), .move(dx: 1, dy: -2))
  }

  func testAbsoluteMove() {
    let record = Data([0x02, 0x3F, 0x00, 0x00, 0x00, 0x3E, 0x80, 0x00, 0x00])
    XCTAssertEqual(InputRecord.parse(record), .moveTo(x: 0.5, y: 0.25))
  }

  func testButtonClampsClicks() {
    XCTAssertEqual(InputRecord.parse(Data([0x03, 0x01, 0x01, 0x02])), .button(button: 1, down: true, clicks: 2))
    XCTAssertEqual(InputRecord.parse(Data([0x03, 0x00, 0x00, 0x09])), .button(button: 0, down: false, clicks: 3))
  }

  func testScroll() {
    let record = Data([0x04, 0x00, 0x00, 0x00, 0x00, 0x41, 0x20, 0x00, 0x00, 0x02])
    XCTAssertEqual(InputRecord.parse(record), .scroll(dx: 0, dy: 10, phase: 2))
  }

  func testKeyWithCommandFlag() {
    let record = Data([0x05, 0x00, 0x08, 0x01, 0x00, 0x10, 0x00, 0x00])
    XCTAssertEqual(InputRecord.parse(record), .key(keyCode: 8, down: true, flags: 0x100000))
  }

  func testText() {
    XCTAssertEqual(InputRecord.parse(Data([0x06]) + Data("héllo".utf8)), .text("héllo"))
  }

  func testRejectsShortAndUnknownRecords() {
    XCTAssertNil(InputRecord.parse(Data([0x01, 0x00])))
    XCTAssertNil(InputRecord.parse(Data([0x7F, 0x00])))
    XCTAssertNil(InputRecord.parse(Data()))
    XCTAssertNil(InputRecord.parse(Data([0x06])))
  }
}
