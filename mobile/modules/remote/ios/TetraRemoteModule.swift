import ExpoModulesCore

struct StartConfig: Record {
  @Field var secretKey: String = ""
  @Field var relayUrl: String?
}

struct ConnectRequest: Record {
  @Field var ticket: String?
  @Field var endpointId: String = ""
  @Field var pairingSecret: String?
  @Field var deviceName: String = ""
  @Field var stream: [String: Any]?
}

public class TetraRemoteModule: Module {
  private var session: RemoteSession { RemoteSession.shared }

  public func definition() -> ModuleDefinition {
    Name("TetraRemote")

    Events("onState", "onControl", "onStats", "onKey", "onKeyboard")

    OnCreate {
      self.session.emit = { [weak self] name, body in
        self?.sendEvent(name, body)
      }
      HardwareKeyboard.shared.emit = { [weak self] name, body in
        self?.sendEvent(name, body)
      }
    }

    Function("setHardwareKeyboard") { (enabled: Bool) in
      HardwareKeyboard.shared.setEnabled(enabled)
    }

    Function("generateSecretKey") { () -> String in
      TetraCore.generateSecretKey()
    }

    Function("endpointId") { (secretKey: String) -> String? in
      TetraCore.endpointId(secretKey: secretKey)
    }

    AsyncFunction("start") { (config: StartConfig, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try self.session.start(secretKey: config.secretKey, relayUrl: config.relayUrl)
          promise.resolve(nil)
        } catch {
          promise.reject("ERR_TETRA_START", error.localizedDescription)
        }
      }
    }

    AsyncFunction("stop") { (promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        self.session.stop()
        promise.resolve(nil)
      }
    }

    Function("connect") { (request: ConnectRequest) in
      self.session.connect([
        "ticket": request.ticket.map { $0 as Any } ?? NSNull(),
        "endpointId": request.endpointId,
        "pairingSecret": request.pairingSecret.map { $0 as Any } ?? NSNull(),
        "deviceName": request.deviceName,
        "stream": request.stream.map { $0 as Any } ?? NSNull(),
      ])
    }

    Function("disconnect") {
      self.session.disconnect()
    }

    Function("sendControl") { (json: String) in
      self.session.sendControl(json)
    }

    Function("sendInput") { (records: Uint8Array) in
      self.session.sendInput(records.rawPointer, count: records.byteLength)
    }

    Function("setAudioEnabled") { (enabled: Bool) in
      self.session.audio.setEnabled(enabled)
    }

    Function("launchPairingUrl") { () -> String? in
      UserDefaults.standard.string(forKey: "TetramotePairURL")
    }

    View(RemoteScreenView.self) {}
  }
}
