import AppKit
import Combine
import CoreImage
import Foundation
import os
import Security
import ServiceManagement
import SwiftUI

enum HostStatus: Equatable {
  case starting
  case waiting
  case connected(name: String, path: String?, rttMs: Int?)
  case failed(String)
}

struct LaunchOptions {
  let testPattern: Bool
  let localOnly: Bool
  let pairingFile: String?
  let profile: String?
  let snapshotFile: String?

  static var current: LaunchOptions {
    let defaults = UserDefaults.standard
    return LaunchOptions(
      testPattern: defaults.bool(forKey: "TetratopTestPattern"),
      localOnly: defaults.bool(forKey: "TetratopLocalOnly"),
      pairingFile: defaults.string(forKey: "TetratopPairingFile"),
      profile: defaults.string(forKey: "TetratopProfile"),
      snapshotFile: defaults.string(forKey: "TetratopSnapshot")
    )
  }
}

@MainActor
final class HostController: ObservableObject {
  @Published private(set) var status: HostStatus = .starting
  @Published private(set) var pairingURL: String?
  @Published private(set) var qrCode: NSImage?
  @Published private(set) var phones: [PairedPhone] = []
  @Published private(set) var screenRecording = Permissions.screenRecording
  @Published private(set) var accessibility = Permissions.accessibility
  @Published private(set) var streamError: String?
  @Published var relayURL: String
  @Published private(set) var launchAtLogin = SMAppService.mainApp.status == .enabled

  let options = LaunchOptions.current
  private let log = Logger(subsystem: "com.tetramo.tetratop.host", category: "host")
  private let store: HostStore
  private let clipboard = Clipboard()
  private let injector = InputInjector()
  private let hostName = Host.current().localizedName ?? "Mac"
  private var host: RustHost?
  private var session: StreamSession?
  private var peerID: String?
  private var ticket: String?
  private var pairingSecret = HostController.newSecret()
  private var timer: Timer?
  private var lastDeniedStatus = Date.distantPast

  init() {
    store = HostStore(profile: options.profile ?? (options.testPattern ? "test" : nil))
    phones = store.phones
    relayURL = store.relayURL
    injector.onDenied = { [weak self] in
      Task { @MainActor in self?.accessibilityDenied() }
    }
    timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
      Task { @MainActor in self?.tick() }
    }
    startHost()
  }

  var isConnected: Bool {
    if case .connected = status {
      return true
    }
    return false
  }

  func rotateSecret() {
    pairingSecret = Self.newSecret()
    host?.setPairingSecret(pairingSecret)
    refreshPairing()
  }

  func remove(_ phone: PairedPhone) {
    phones.removeAll { $0.id == phone.id }
    store.phones = phones
    host?.setTrusted(phones.map(\.id))
  }

  func disconnect() {
    host?.disconnectPeer()
  }

  func applyRelay() {
    let trimmed = relayURL.trimmingCharacters(in: .whitespacesAndNewlines)
    relayURL = trimmed
    store.relayURL = trimmed
    restartHost()
  }

  func setLaunchAtLogin(_ enabled: Bool) {
    do {
      if enabled {
        try SMAppService.mainApp.register()
      } else {
        try SMAppService.mainApp.unregister()
      }
    } catch {
      log.error("launch at login: \(error.localizedDescription, privacy: .public)")
    }
    launchAtLogin = SMAppService.mainApp.status == .enabled
  }

  func requestScreenRecording() {
    Permissions.requestScreenRecording()
  }

  func requestAccessibility() {
    Permissions.requestAccessibility()
  }

  func quit() {
    let host = host
    self.host = nil
    Task {
      await Task.detached { host?.stop() }.value
      NSApp.terminate(nil)
    }
  }

  private func startHost() {
    status = .starting
    guard let key = store.secretKey() else {
      status = .failed("Tetratop could not read or save its key in the Keychain. Unlock the login keychain and reopen Tetratop.")
      return
    }
    var config: [String: Any] = [
      "secretKey": key,
      "hostName": hostName,
      "trusted": phones.map(\.id),
      "pairingSecret": pairingSecret,
      "localOnly": options.localOnly,
    ]
    if !relayURL.isEmpty {
      config["relayUrl"] = relayURL
    }
    let json = String(decoding: (try? JSONSerialization.data(withJSONObject: config)) ?? Data(), as: UTF8.self)
    Task { [weak self] in
      let result = await Task.detached { Result { try RustHost(configJSON: json) } }.value
      switch result {
      case let .success(host):
        self?.attach(host)
      case let .failure(error):
        self?
          .status =
          .failed(
            "Tetratop could not start: \(error.localizedDescription). Check the relay URL in Settings, or clear it to use the public relays."
          )
      }
    }
  }

  private func restartHost() {
    let old = host
    host = nil
    ticket = nil
    endSession()
    refreshPairing()
    Task { [weak self] in
      await Task.detached { old?.stop() }.value
      self?.startHost()
    }
  }

  private func attach(_ host: RustHost) {
    self.host = host
    status = .waiting
    ticket = host.ticket
    refreshPairing()
    let injector = injector
    host.startEvents { [weak self] event in
      if case let .input(record) = event {
        injector.handle(record)
        return
      }
      Task { @MainActor in self?.handle(event, from: host) }
    }
  }

  private func handle(_ event: HostEvent, from source: RustHost) {
    guard source === host else { return }
    switch event {
    case let .state(state):
      handleState(state)
    case let .control(message):
      handleControl(message)
    case .input:
      break
    }
  }

  private func handleState(_ state: [String: Any]) {
    let type = state["type"] as? String
    switch type {
    case "ticket":
      ticket = state["ticket"] as? String
      refreshPairing()
    case "paired":
      guard let id = state["id"] as? String else { return }
      let name = (state["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Phone"
      phones.removeAll { $0.id == id }
      phones.append(PairedPhone(id: id, name: name, pairedAt: Date()))
      store.phones = phones
      rotateSecret()
    case "peerConnected":
      guard let id = state["id"] as? String else { return }
      let name = (state["name"] as? String) ?? phones.first { $0.id == id }?.name ?? "Phone"
      peerID = id
      if let index = phones.firstIndex(where: { $0.id == id }), !name.isEmpty, phones[index].name != name {
        phones[index].name = name
        store.phones = phones
      }
      status = .connected(name: name, path: state["path"] as? String, rttMs: state["rttMs"] as? Int)
      beginSession()
    case "path":
      guard case let .connected(name, _, _) = status, state["id"] as? String == peerID else { return }
      status = .connected(name: name, path: state["path"] as? String, rttMs: state["rttMs"] as? Int)
    case "peerDisconnected":
      guard state["id"] as? String == peerID else { return }
      peerID = nil
      status = .waiting
      endSession()
    case "rejected", "handshakeFailed":
      log.info("\(type ?? "", privacy: .public): \(String(describing: state), privacy: .public)")
    default:
      break
    }
  }

  private func handleControl(_ message: [String: Any]) {
    guard let host, let session else { return }
    switch message["t"] as? String {
    case "keyframe":
      session.requestKeyframe()
    case "selectDisplay":
      guard let id = message["id"] as? Int else { return }
      Task { await startCapture(session, display: CGDirectDisplayID(id)) }
    case "clipboard":
      if let text = message["text"] as? String {
        clipboard.write(text)
      }
    case "getClipboard":
      host.sendControl(["t": "clipboard", "text": clipboard.read() ?? ""])
    case "setAudio":
      session.setAudioEnabled(message["enabled"] as? Bool ?? true)
    default:
      break
    }
  }

  private func beginSession() {
    guard let host else { return }
    endSession()
    let session = StreamSession(host: host, testPattern: options.testPattern, injector: injector)
    self.session = session
    clipboard.resetBaseline()
    refreshPermissions()
    sendStatus()
    Task {
      let displays = await session.displays()
      host.sendControl([
        "t": "displays",
        "displays": displays.map(\.message),
        "active": Int(displays.first { $0.main }?.id ?? CGMainDisplayID()),
      ])
      await startCapture(session, display: nil)
    }
  }

  private func startCapture(_ session: StreamSession, display: CGDirectDisplayID?) async {
    do {
      try await session.start(displayID: display)
      streamError = nil
    } catch {
      streamError = error.localizedDescription
      refreshPermissions()
      sendStatus()
    }
  }

  private func endSession() {
    guard let session else { return }
    self.session = nil
    Task { await session.stop() }
  }

  private func sendStatus() {
    host?.sendControl(["t": "status", "screenRecording": screenRecording || options.testPattern, "accessibility": accessibility])
  }

  private func accessibilityDenied() {
    guard Date().timeIntervalSince(lastDeniedStatus) > 5 else { return }
    lastDeniedStatus = Date()
    refreshPermissions()
    sendStatus()
  }

  private func tick() {
    let before = (screenRecording, accessibility)
    refreshPermissions()
    if session != nil {
      if before != (screenRecording, accessibility) {
        sendStatus()
      }
      if let text = clipboard.newText() {
        host?.sendControl(["t": "clipboard", "text": text])
      }
    }
  }

  private func refreshPermissions() {
    screenRecording = Permissions.screenRecording
    accessibility = Permissions.accessibility
  }

  private func refreshPairing() {
    guard let ticket else {
      pairingURL = nil
      qrCode = nil
      return
    }
    let url = PairingURL.make(ticket: ticket, secret: pairingSecret, name: hostName)
    guard url != pairingURL else { return }
    pairingURL = url
    qrCode = QRCode.image(for: url)
    if let file = options.pairingFile {
      try? url.write(toFile: file, atomically: true, encoding: .utf8)
    }
    if let file = options.snapshotFile {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.writeSnapshot(to: file) }
    }
  }

  private func writeSnapshot(to file: String) {
    let renderer = ImageRenderer(content: MenuView().environmentObject(self).fontDesign(.rounded))
    renderer.scale = 2
    guard let image = renderer.cgImage else { return }
    let rep = NSBitmapImageRep(cgImage: image)
    try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: file))
  }

  private static func newSecret() -> String {
    var bytes = [UInt8](repeating: 0, count: 16)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    return PairingURL.hex(bytes)
  }
}
