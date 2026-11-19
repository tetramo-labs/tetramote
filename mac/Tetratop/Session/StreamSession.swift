import AppKit
import CoreGraphics
import Foundation
import QuartzCore
import ScreenCaptureKit

struct DisplayInfo {
  let id: CGDirectDisplayID
  let name: String
  let width: Int
  let height: Int
  let main: Bool

  var message: [String: Any] {
    ["id": Int(id), "name": name, "width": width, "height": height, "main": main]
  }
}

struct CaptureError: LocalizedError {
  let errorDescription: String?
}

/// Capture, encoding and input for one connected phone.
final class StreamSession: @unchecked Sendable {
  private let host: RustHost
  private let testPattern: Bool
  private let injector: InputInjector
  private let lock = NSLock()
  private var source: CaptureSource?
  private var encoder: VideoEncoder?
  private var audioEncoder: AudioEncoder?
  private var bitrate = BitrateController(startingAt: CACurrentMediaTime())
  private var needsKeyframe = true
  private var audioEnabled = true
  private(set) var displayID: CGDirectDisplayID = CGMainDisplayID()

  init(host: RustHost, testPattern: Bool, injector: InputInjector) {
    self.host = host
    self.testPattern = testPattern
    self.injector = injector
  }

  func displays() async -> [DisplayInfo] {
    let main = CGMainDisplayID()
    if testPattern {
      return [DisplayInfo(id: main, name: "Test pattern", width: 1280, height: 800, main: true)]
    }
    guard let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true) else {
      return []
    }
    let names = await MainActor.run { Self.screenNames() }
    return content.displays.map { display in
      let mode = CGDisplayCopyDisplayMode(display.displayID)
      return DisplayInfo(
        id: display.displayID,
        name: names[display.displayID] ?? "Display \(display.displayID)",
        width: mode?.pixelWidth ?? display.width,
        height: mode?.pixelHeight ?? display.height,
        main: display.displayID == main
      )
    }
  }

  func start(displayID requested: CGDirectDisplayID?) async throws {
    await stopCapture()
    let source: CaptureSource
    let id: CGDirectDisplayID
    if testPattern {
      source = TestPatternSource()
      id = CGMainDisplayID()
    } else {
      let content: SCShareableContent
      do {
        content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
      } catch {
        throw CaptureError(
          errorDescription: "Screen Recording is off for Tetratop. Turn it on in System Settings > Privacy & Security > Screen & System Audio Recording, then reconnect."
        )
      }
      let wanted = requested ?? CGMainDisplayID()
      guard let display = content.displays.first(where: { $0.displayID == wanted }) ?? content.displays.first else {
        throw CaptureError(errorDescription: "No display to stream. Connect a display and reconnect.")
      }
      source = ScreenSource(display: display)
      id = display.displayID
    }

    let host = host
    let encoder = try VideoEncoder(width: Int32(source.width), height: Int32(source.height), bitrate: bitrate.bitrate) {
      [weak self] frame in
      let result = host.sendVideo(ptsMicros: frame.ptsMicros, keyframe: frame.keyframe, data: frame.annexB)
      if result == RustHost.sendDropped {
        self?.requestKeyframe()
      }
    }
    let audioEncoder = AudioEncoder { frame in
      host.sendAudio(ptsMicros: frame.ptsMicros, data: frame.frame)
    }
    lock.withLock {
      self.source = source
      self.encoder = encoder
      self.audioEncoder = audioEncoder
      self.displayID = id
      needsKeyframe = true
    }
    injector.setDisplay(id)

    let points = CGDisplayBounds(id).size
    host.sendControl([
      "t": "video", "codec": "h264", "width": source.width, "height": source.height, "displayId": Int(id),
      "pointWidth": Int(points.width), "pointHeight": Int(points.height),
    ])
    host.sendControl([
      "t": "audio", "codec": "aac", "sampleRate": AudioEncoder.sampleRate, "channels": AudioEncoder.channels,
      "config": AudioEncoder.config.base64EncodedString(),
    ])
    try await source.start(CaptureSink(
      video: { [weak self] pixels, pts in self?.encode(pixels, pts: pts) },
      audio: { [weak self] audio in self?.encodeAudio(audio) }
    ))
  }

  func requestKeyframe() {
    lock.lock()
    needsKeyframe = true
    lock.unlock()
  }

  func setAudioEnabled(_ enabled: Bool) {
    lock.lock()
    audioEnabled = enabled
    lock.unlock()
  }

  func stop() async {
    await stopCapture()
  }

  private func stopCapture() async {
    let source = lock.withLock {
      let current = self.source
      self.source = nil
      encoder = nil
      audioEncoder = nil
      return current
    }
    await source?.stop()
  }

  private func encode(_ pixels: CVPixelBuffer, pts: UInt64) {
    let now = CACurrentMediaTime()
    lock.lock()
    guard let encoder else {
      lock.unlock()
      return
    }
    if host.backlog > 4 {
      let lowered = bitrate.frameSkipped(at: now)
      lock.unlock()
      if let lowered {
        encoder.setBitrate(lowered)
      }
      return
    }
    let raised = bitrate.frameSent(at: now)
    let keyframe = needsKeyframe
    needsKeyframe = false
    lock.unlock()
    if let raised {
      encoder.setBitrate(raised)
    }
    encoder.encode(pixels, ptsMicros: pts, forceKeyframe: keyframe)
  }

  private func encodeAudio(_ audio: CapturedAudio) {
    lock.lock()
    let encoder = audioEnabled ? audioEncoder : nil
    lock.unlock()
    switch audio {
    case let .sampleBuffer(buffer): encoder?.encode(sampleBuffer: buffer)
    case let .pcm(buffer, pts): encoder?.encode(buffer, ptsMicros: pts)
    }
  }

  @MainActor
  private static func screenNames() -> [CGDirectDisplayID: String] {
    var names: [CGDirectDisplayID: String] = [:]
    for screen in NSScreen.screens {
      if let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber {
        names[CGDirectDisplayID(number.uint32Value)] = screen.localizedName
      }
    }
    return names
  }
}
