import Foundation
import TetraCoreFFI

enum HostEvent {
  case state([String: Any])
  case control([String: Any])
  case input(Data)
}

struct HostStartError: LocalizedError {
  let message: String
  var errorDescription: String? {
    message
  }
}

/// Owns one `tetra_host_*` handle. Every method is safe to call from any thread;
/// events arrive on a dedicated thread, which exits once `stop()` (blocking) has closed the endpoint.
final class RustHost: @unchecked Sendable {
  static let sendOK: Int32 = 0
  static let sendDropped: Int32 = 1

  private let handle: UInt64
  private var thread: Thread?

  init(configJSON json: String) throws {
    var error: UnsafeMutablePointer<CChar>?
    let handle = json.withCString { tetra_host_start($0, &error) }
    if handle == 0 {
      let message = error.map { String(cString: $0) } ?? "the iroh endpoint did not start"
      if let error {
        tetra_string_free(error)
      }
      throw HostStartError(message: message)
    }
    self.handle = handle
  }

  static func generateSecretKey() -> String {
    guard let raw = tetra_generate_secret_key() else { return "" }
    defer { tetra_string_free(raw) }
    return String(cString: raw)
  }

  static func endpointID(secretKey: String) -> String? {
    guard let raw = secretKey.withCString({ tetra_endpoint_id($0) }) else { return nil }
    defer { tetra_string_free(raw) }
    return String(cString: raw)
  }

  var ticket: String? {
    guard let raw = tetra_host_ticket(handle) else { return nil }
    defer { tetra_string_free(raw) }
    return String(cString: raw)
  }

  var backlog: UInt32 {
    tetra_host_video_backlog(handle)
  }

  func setTrusted(_ ids: [String]) {
    let json = String(decoding: (try? JSONSerialization.data(withJSONObject: ids)) ?? Data("[]".utf8), as: UTF8.self)
    json.withCString { tetra_host_set_trusted(handle, $0) }
  }

  func setPairingSecret(_ secret: String?) {
    if let secret {
      secret.withCString { tetra_host_set_pairing_secret(handle, $0) }
    } else {
      tetra_host_set_pairing_secret(handle, nil)
    }
  }

  @discardableResult
  func sendControl(_ message: [String: Any]) -> Int32 {
    guard let data = try? JSONSerialization.data(withJSONObject: message) else { return -3 }
    return String(decoding: data, as: UTF8.self).withCString { tetra_host_send_control(handle, $0) }
  }

  func sendVideo(ptsMicros: UInt64, keyframe: Bool, data: Data) -> Int32 {
    data.withUnsafeBytes { raw in
      tetra_host_send_video(handle, ptsMicros, keyframe ? 1 : 0, raw.bindMemory(to: UInt8.self).baseAddress, raw.count)
    }
  }

  @discardableResult
  func sendAudio(ptsMicros: UInt64, data: Data) -> Int32 {
    data.withUnsafeBytes { raw in
      tetra_host_send_audio(handle, ptsMicros, raw.bindMemory(to: UInt8.self).baseAddress, raw.count)
    }
  }

  func disconnectPeer() {
    tetra_host_disconnect_peer(handle)
  }

  func startEvents(_ handler: @escaping (HostEvent) -> Void) {
    let handle = handle
    let thread = Thread {
      while true {
        var length = 0
        guard let raw = tetra_next_event(handle, 250, &length) else { continue }
        let event = Data(bytes: raw, count: length)
        tetra_bytes_free(raw, length)
        guard let kind = event.first, kind != 0 else { return }
        let body = Data(event.dropFirst())
        switch kind {
        case 1:
          if let object = Self.object(body) {
            handler(.state(object))
          }
        case 2:
          if let object = Self.object(body) {
            handler(.control(object))
          }
        case 3:
          handler(.input(body))
        default:
          break
        }
      }
    }
    thread.name = "tetratop-host-events"
    thread.qualityOfService = .userInteractive
    self.thread = thread
    thread.start()
  }

  func stop() {
    tetra_stop(handle)
  }

  private static func object(_ data: Data) -> [String: Any]? {
    (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  }
}
