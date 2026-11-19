import Foundation
import Security

struct PairedPhone: Codable, Identifiable, Equatable {
  let id: String
  var name: String
  let pairedAt: Date
}

/// The host's iroh key lives in the Keychain; paired phones and the relay URL in
/// UserDefaults. A profile name (`-TetratopProfile`) keeps test runs apart.
final class HostStore {
  private static let service = "com.tetramo.tetratop.host"
  private let account: String
  private let defaults: UserDefaults

  init(profile: String?) {
    if let profile, !profile.isEmpty {
      account = "endpoint-secret-key.\(profile)"
      defaults = UserDefaults(suiteName: "\(Self.service).\(profile)") ?? .standard
    } else {
      account = "endpoint-secret-key"
      defaults = .standard
    }
  }

  var phones: [PairedPhone] {
    get {
      guard let data = defaults.data(forKey: "pairedPhones") else { return [] }
      return (try? JSONDecoder().decode([PairedPhone].self, from: data)) ?? []
    }
    set { defaults.set(try? JSONEncoder().encode(newValue), forKey: "pairedPhones") }
  }

  var relayURL: String {
    get { defaults.string(forKey: "relayURL") ?? "" }
    set { defaults.set(newValue, forKey: "relayURL") }
  }

  func secretKey() -> String? {
    if let existing = readKey() {
      return existing
    }
    let key = RustHost.generateSecretKey()
    guard key.count == 64, saveKey(key) else { return nil }
    return key
  }

  private func readKey() -> String? {
    let query: [CFString: Any] = [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: Self.service,
      kSecAttrAccount: account,
      kSecReturnData: true,
      kSecMatchLimit: kSecMatchLimitOne,
    ]
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private func saveKey(_ key: String) -> Bool {
    let item: [CFString: Any] = [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: Self.service,
      kSecAttrAccount: account,
      kSecAttrLabel: "Tetratop host key",
      kSecValueData: Data(key.utf8),
      kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
  }
}
