import GameController

/// Physical keys from a hardware keyboard, as HID usages, from the GameController framework, which sees every key
/// the app gets whatever has focus. Off until a session turns it on.
final class HardwareKeyboard {
  static let shared = HardwareKeyboard()

  var emit: ((String, [String: Any]) -> Void)?
  private var enabled = false
  private var observers: [NSObjectProtocol] = []

  func setEnabled(_ on: Bool) {
    DispatchQueue.main.async {
      self.enabled = on
      if on { self.attach() } else { self.detach() }
    }
  }

  private func attach() {
    if observers.isEmpty {
      let center = NotificationCenter.default
      observers.append(center.addObserver(forName: .GCKeyboardDidConnect, object: nil, queue: .main) { [weak self] note in
        self?.bind(note.object as? GCKeyboard)
        self?.report()
      })
      observers.append(center.addObserver(forName: .GCKeyboardDidDisconnect, object: nil, queue: .main) { [weak self] _ in
        self?.report()
      })
    }
    bind(GCKeyboard.coalesced)
    report()
  }

  private func detach() {
    GCKeyboard.coalesced?.keyboardInput?.keyChangedHandler = nil
    observers.forEach(NotificationCenter.default.removeObserver)
    observers = []
  }

  private func bind(_ keyboard: GCKeyboard?) {
    keyboard?.keyboardInput?.keyChangedHandler = { [weak self] _, _, keyCode, pressed in
      guard let self, self.enabled else { return }
      self.emit?("onKey", ["usage": keyCode.rawValue, "down": pressed])
    }
  }

  private func report() {
    emit?("onKeyboard", ["connected": GCKeyboard.coalesced != nil])
  }
}
