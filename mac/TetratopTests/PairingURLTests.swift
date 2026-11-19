import XCTest

final class PairingURLTests: XCTestCase {
  func testEncodesNameWithApostropheAndSpaces() {
    XCTAssertEqual(
      PairingURL.make(ticket: "endpointabc", secret: "00ff", name: "Fosse's MacBook Pro"),
      "tetratop://pair?ticket=endpointabc&secret=00ff&name=Fosse%27s%20MacBook%20Pro"
    )
  }

  func testEncodesReservedAndUnicode() {
    XCTAssertEqual(PairingURL.encode("a+b&c=d/é"), "a%2Bb%26c%3Dd%2F%C3%A9")
  }

  func testHex() {
    XCTAssertEqual(PairingURL.hex([0x00, 0x0A, 0xFF]), "000aff")
  }
}
