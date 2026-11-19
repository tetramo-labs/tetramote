import AVFoundation
import CoreVideo
import Foundation

/// A synthetic 1280x800 picture and a 440 Hz tone, so the pipeline runs
/// without Screen Recording permission (`-TetratopTestPattern YES`).
final class TestPatternSource: CaptureSource {
  let width = 1280
  let height = 800
  private let queue = DispatchQueue(label: "tetratop.testpattern", qos: .userInteractive)
  private var videoTimer: DispatchSourceTimer?
  private var audioTimer: DispatchSourceTimer?
  private var pool: CVPixelBufferPool?
  private var frame = 0
  private var phase = 0.0
  private let audioQueue = DispatchQueue(label: "tetratop.testpattern.audio", qos: .userInteractive)
  private let audioFormat = AVAudioFormat(standardFormatWithSampleRate: Double(AudioEncoder.sampleRate), channels: 2)!
  private lazy var chromaPlane: [UInt8] = {
    var plane = [UInt8](repeating: 128, count: width * height / 2)
    for y in 0 ..< height / 2 {
      for x in 0 ..< width / 2 {
        plane[y * width + x * 2] = UInt8(80 + (x * 96) / (width / 2))
        plane[y * width + x * 2 + 1] = UInt8(80 + (y * 96) / (height / 2))
      }
    }
    return plane
  }()

  func start(_ sink: CaptureSink) async throws {
    let attributes: [CFString: Any] = [
      kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
      kCVPixelBufferWidthKey: width,
      kCVPixelBufferHeightKey: height,
      kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary,
    ]
    CVPixelBufferPoolCreate(nil, nil, attributes as CFDictionary, &pool)
    let video = DispatchSource.makeTimerSource(queue: queue)
    video.schedule(deadline: .now(), repeating: .nanoseconds(1_000_000_000 / 60))
    video.setEventHandler { [weak self] in self?.emitFrame(sink) }
    let audio = DispatchSource.makeTimerSource(queue: audioQueue)
    audio.schedule(deadline: .now(), repeating: .microseconds(1024 * 1_000_000 / AudioEncoder.sampleRate))
    audio.setEventHandler { [weak self] in self?.emitTone(sink) }
    videoTimer = video
    audioTimer = audio
    video.resume()
    audio.resume()
  }

  func stop() async {
    videoTimer?.cancel()
    audioTimer?.cancel()
    videoTimer = nil
    audioTimer = nil
  }

  private func emitFrame(_ sink: CaptureSink) {
    guard let pool else { return }
    var buffer: CVPixelBuffer?
    guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let buffer else { return }
    draw(into: buffer)
    frame += 1
    sink.video(buffer, CaptureClock.nowMicros())
  }

  private func draw(into buffer: CVPixelBuffer) {
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    let luma = CVPixelBufferGetBaseAddressOfPlane(buffer, 0)!.assumingMemoryBound(to: UInt8.self)
    let lumaStride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0)
    let chroma = CVPixelBufferGetBaseAddressOfPlane(buffer, 1)!.assumingMemoryBound(to: UInt8.self)
    let chromaStride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 1)
    let barX = (frame * 8) % width
    let barY = (frame * 4) % height
    for y in 0 ..< height {
      let row = luma + y * lumaStride
      let base = UInt8(16 + (y * 64) / height)
      memset(row, Int32(base), width)
      if abs(y - barY) < 24 {
        memset(row, 180, width)
      }
      let start = barX
      let end = min(width, barX + 64)
      memset(row + start, 235, end - start)
    }
    for bit in 0 ..< 16 where frame & (1 << bit) != 0 {
      for y in 16 ..< 48 {
        memset(luma + y * lumaStride + 16 + bit * 40, 235, 32)
      }
    }
    chromaPlane.withUnsafeBytes { plane in
      for y in 0 ..< height / 2 {
        memcpy(chroma + y * chromaStride, plane.baseAddress! + y * width, width)
      }
    }
  }

  private func emitTone(_ sink: CaptureSink) {
    guard let buffer = AVAudioPCMBuffer(pcmFormat: audioFormat, frameCapacity: 1024) else { return }
    buffer.frameLength = 1024
    let step = 2 * Double.pi * 440 / Double(AudioEncoder.sampleRate)
    for i in 0 ..< 1024 {
      let sample = Float(sin(phase) * 0.2)
      phase += step
      buffer.floatChannelData![0][i] = sample
      buffer.floatChannelData![1][i] = sample
    }
    phase = phase.truncatingRemainder(dividingBy: 2 * Double.pi)
    sink.audio(.pcm(buffer, ptsMicros: CaptureClock.nowMicros()))
  }
}
