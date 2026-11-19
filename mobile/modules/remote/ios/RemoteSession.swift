import Foundation
import UIKit

private enum EventKind: UInt8 {
  case closed = 0
  case state = 1
  case control = 2
  case video = 4
  case audio = 5
}

/// One iroh client per app. Its event thread feeds video and audio straight to
/// the decoders and forwards JSON to JS, so frames never cross the JS bridge.
final class RemoteSession {
  static let shared = RemoteSession()

  var emit: ((String, [String: Any]) -> Void)?
  let video = VideoRenderer()
  let audio = AudioPlayer()

  private let lock = NSLock()
  private var handle: UInt64 = 0

  private init() {
    video.requestKeyframe = { [weak self] in
      self?.sendControl(#"{"t":"keyframe"}"#)
    }
    video.onStats = { [weak self] stats in
      self?.emit?("onStats", stats)
    }
  }

  func start(secretKey: String, relayUrl: String?) throws {
    stop()
    let config: [String: Any] = ["secretKey": secretKey, "relayUrl": relayUrl.map { $0 as Any } ?? NSNull()]
    let handle = try TetraCore.clientStart(configJSON: Self.json(config))
    lock.withLock { self.handle = handle }
    let thread = Thread { [weak self] in self?.runEvents(handle) }
    thread.name = "tetra.events"
    thread.qualityOfService = .userInteractive
    thread.start()
  }

  func stop() {
    let old = lock.withLock { () -> UInt64 in
      let old = handle
      handle = 0
      return old
    }
    guard old != 0 else { return }
    TetraCore.stop(old)
    video.reset()
    audio.reset()
  }

  func connect(_ request: [String: Any]) {
    let handle = currentHandle()
    guard handle != 0 else { return }
    video.reset()
    _ = TetraCore.connect(handle, json: Self.json(request))
  }

  func disconnect() {
    let handle = currentHandle()
    guard handle != 0 else { return }
    TetraCore.disconnect(handle)
  }

  func sendControl(_ json: String) {
    let handle = currentHandle()
    guard handle != 0 else { return }
    _ = TetraCore.sendControl(handle, json: json)
  }

  func sendInput(_ bytes: UnsafeRawPointer, count: Int) {
    let handle = currentHandle()
    guard handle != 0, count > 0 else { return }
    _ = TetraCore.sendInput(handle, bytes, count: count)
  }

  private func currentHandle() -> UInt64 {
    lock.withLock { handle }
  }

  private func runEvents(_ handle: UInt64) {
    while true {
      guard let event = TetraCore.nextEvent(handle, timeoutMs: 250) else {
        if currentHandle() != handle { return }
        continue
      }
      guard let first = event.first, let kind = EventKind(rawValue: first) else { continue }
      let body = event.dropFirst()
      switch kind {
      case .closed:
        return
      case .state:
        handleState(body)
      case .control:
        handleControl(body)
      case .video:
        video.enqueue(body)
      case .audio:
        audio.enqueue(body)
      }
    }
  }

  private func handleState(_ body: Data) {
    guard let json = String(data: body, encoding: .utf8) else { return }
    let type = (try? JSONSerialization.jsonObject(with: body) as? [String: Any])?["type"] as? String
    switch type {
    case "connected":
      setIdleTimer(disabled: true)
    case "disconnected", "rejected":
      video.reset()
      audio.reset()
      setIdleTimer(disabled: false)
    default:
      break
    }
    emit?("onState", ["json": json])
  }

  private func handleControl(_ body: Data) {
    guard let json = String(data: body, encoding: .utf8) else { return }
    if let message = try? JSONSerialization.jsonObject(with: body) as? [String: Any] {
      switch message["t"] as? String {
      case "audio":
        audio.configure()
      case "video":
        video.expectNewStream()
      default:
        break
      }
    }
    emit?("onControl", ["json": json])
  }

  private func setIdleTimer(disabled: Bool) {
    DispatchQueue.main.async {
      UIApplication.shared.isIdleTimerDisabled = disabled
    }
  }

  private static func json(_ object: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: object) else { return "{}" }
    return String(decoding: data, as: UTF8.self)
  }
}
