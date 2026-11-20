@_implementationOnly import TetraCoreFFI
import Foundation

struct TetraCoreError: LocalizedError {
  let errorDescription: String?
}

enum TetraCore {
  static func generateSecretKey() -> String {
    take(tetra_generate_secret_key()) ?? ""
  }

  static func endpointId(secretKey: String) -> String? {
    take(tetra_endpoint_id(secretKey))
  }

  static func clientStart(configJSON: String) throws -> UInt64 {
    var error: UnsafeMutablePointer<CChar>?
    let handle = tetra_client_start(configJSON, &error)
    if handle == 0 {
      throw TetraCoreError(errorDescription: take(error) ?? "The connection engine failed to start. Restart Tetramote.")
    }
    return handle
  }

  static func connect(_ handle: UInt64, json: String) -> Int32 {
    tetra_client_connect(handle, json)
  }

  static func disconnect(_ handle: UInt64) {
    tetra_client_disconnect(handle)
  }

  static func sendControl(_ handle: UInt64, json: String) -> Int32 {
    tetra_client_send_control(handle, json)
  }

  static func sendInput(_ handle: UInt64, _ bytes: UnsafeRawPointer, count: Int) -> Int32 {
    tetra_client_send_input(handle, bytes.assumingMemoryBound(to: UInt8.self), count)
  }

  /// The returned Data owns the core's buffer and frees it when released.
  static func nextEvent(_ handle: UInt64, timeoutMs: UInt32) -> Data? {
    var length = 0
    guard let pointer = tetra_next_event(handle, timeoutMs, &length) else { return nil }
    return Data(bytesNoCopy: pointer, count: length, deallocator: .custom { ptr, len in
      tetra_bytes_free(ptr.assumingMemoryBound(to: UInt8.self), len)
    })
  }

  static func stop(_ handle: UInt64) {
    tetra_stop(handle)
  }

  private static func take(_ pointer: UnsafeMutablePointer<CChar>?) -> String? {
    guard let pointer else { return nil }
    defer { tetra_string_free(pointer) }
    return String(cString: pointer)
  }
}
