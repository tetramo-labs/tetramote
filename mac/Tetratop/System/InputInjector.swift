import CoreGraphics
import Foundation

/// Turns phone input records into CGEvents on the streamed display. Without
/// Accessibility permission macOS drops posted events, so records are dropped
/// here instead and `onDenied` fires.
final class InputInjector {
  private let lock = NSLock()
  private var bounds = CGDisplayBounds(CGMainDisplayID())
  private var held: Set<UInt8> = []
  private var scrollRemainder = CGPoint.zero
  private let source = CGEventSource(stateID: .hidSystemState)
  var onDenied: (() -> Void)?

  func setDisplay(_ id: CGDirectDisplayID) {
    lock.lock()
    bounds = CGDisplayBounds(id)
    lock.unlock()
  }

  func handle(_ data: Data) {
    guard let record = InputRecord.parse(data) else { return }
    guard Permissions.accessibility else {
      onDenied?()
      return
    }
    lock.lock()
    defer { lock.unlock() }
    switch record {
    case let .move(dx, dy):
      let current = CGEvent(source: nil)?.location ?? CGPoint(x: bounds.midX, y: bounds.midY)
      moveCursor(to: CGPoint(x: current.x + CGFloat(dx), y: current.y + CGFloat(dy)), dx: dx, dy: dy)
    case let .moveTo(x, y):
      let point = CGPoint(x: bounds.minX + CGFloat(x) * bounds.width, y: bounds.minY + CGFloat(y) * bounds.height)
      moveCursor(to: point, dx: 0, dy: 0)
    case let .button(button, down, clicks):
      press(button: button, down: down, clicks: clicks)
    case let .scroll(dx, dy, phase):
      scroll(dx: dx, dy: dy, phase: phase)
    case let .key(keyCode, down, flags):
      let event = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(keyCode), keyDown: down)
      event?.flags = CGEventFlags(rawValue: UInt64(flags))
      event?.post(tap: .cghidEventTap)
    case let .text(text):
      type(text)
    }
  }

  private func clamp(_ point: CGPoint) -> CGPoint {
    CGPoint(x: min(max(point.x, bounds.minX), bounds.maxX - 1), y: min(max(point.y, bounds.minY), bounds.maxY - 1))
  }

  private func moveCursor(to point: CGPoint, dx: Float, dy: Float) {
    let type: CGEventType = held.contains(0) ? .leftMouseDragged : held.contains(1) ? .rightMouseDragged
      : held.contains(2) ? .otherMouseDragged : .mouseMoved
    let button: CGMouseButton = held.contains(1) ? .right : held.contains(2) ? .center : .left
    let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: clamp(point), mouseButton: button)
    event?.setIntegerValueField(.mouseEventDeltaX, value: Int64(dx.rounded()))
    event?.setIntegerValueField(.mouseEventDeltaY, value: Int64(dy.rounded()))
    event?.post(tap: .cghidEventTap)
  }

  private func press(button: UInt8, down: Bool, clicks: UInt8) {
    let location = clamp(CGEvent(source: nil)?.location ?? CGPoint(x: bounds.midX, y: bounds.midY))
    let (type, mouseButton): (CGEventType, CGMouseButton) = switch button {
    case 1: (down ? .rightMouseDown : .rightMouseUp, .right)
    case 2: (down ? .otherMouseDown : .otherMouseUp, .center)
    default: (down ? .leftMouseDown : .leftMouseUp, .left)
    }
    if down {
      held.insert(button)
    } else {
      held.remove(button)
    }
    let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: location, mouseButton: mouseButton)
    event?.setIntegerValueField(.mouseEventClickState, value: Int64(clicks))
    event?.post(tap: .cghidEventTap)
  }

  private func scroll(dx: Float, dy: Float, phase: UInt8) {
    let x = scrollRemainder.x + CGFloat(dx)
    let y = scrollRemainder.y + CGFloat(dy)
    let wheelX = Int32(x.rounded(.towardZero))
    let wheelY = Int32(y.rounded(.towardZero))
    scrollRemainder = CGPoint(x: x - CGFloat(wheelX), y: y - CGFloat(wheelY))
    guard let event = CGEvent(
      scrollWheelEvent2Source: source, units: .pixel, wheelCount: 2, wheel1: wheelY, wheel2: wheelX, wheel3: 0
    )
    else { return }
    event.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
    switch phase {
    case 1: event.setIntegerValueField(.scrollWheelEventScrollPhase, value: 1)
    case 2: event.setIntegerValueField(.scrollWheelEventScrollPhase, value: 2)
    case 3:
      event.setIntegerValueField(.scrollWheelEventScrollPhase, value: 4)
      scrollRemainder = .zero
    case 4: event.setIntegerValueField(.scrollWheelEventMomentumPhase, value: 2)
    default: break
    }
    event.post(tap: .cghidEventTap)
  }

  private func type(_ text: String) {
    let units = Array(text.utf16)
    var start = 0
    while start < units.count {
      let end = min(units.count, start + 20)
      let chunk = Array(units[start ..< end])
      for down in [true, false] {
        let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down)
        chunk
          .withUnsafeBufferPointer { event?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: $0.baseAddress) }
        event?.post(tap: .cghidEventTap)
      }
      start = end
    }
  }
}
