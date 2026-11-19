import XCTest

final class AnnexBTests: XCTestCase {
  func testRewritesLengthsAndPrependsParameterSets() {
    let avcc = Data([0x00, 0x00, 0x00, 0x02, 0x65, 0xAA, 0x00, 0x00, 0x00, 0x01, 0x41])
    let sps = Data([0x67, 0x64])
    let pps = Data([0x68, 0xEE])
    let expected = Data([
      0, 0, 0, 1, 0x67, 0x64,
      0, 0, 0, 1, 0x68, 0xEE,
      0, 0, 0, 1, 0x65, 0xAA,
      0, 0, 0, 1, 0x41,
    ])
    XCTAssertEqual(AnnexB.fromAVCC(avcc, lengthSize: 4, parameterSets: [sps, pps]), expected)
  }

  func testTwoByteLengths() {
    XCTAssertEqual(AnnexB.fromAVCC(Data([0x00, 0x01, 0x41]), lengthSize: 2), Data([0, 0, 0, 1, 0x41]))
  }

  func testRejectsTruncatedUnits() {
    XCTAssertNil(AnnexB.fromAVCC(Data([0x00, 0x00, 0x00, 0x05, 0x65]), lengthSize: 4))
    XCTAssertNil(AnnexB.fromAVCC(Data([0x00, 0x00]), lengthSize: 4))
  }
}
