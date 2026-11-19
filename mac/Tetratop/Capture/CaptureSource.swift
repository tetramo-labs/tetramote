import AVFoundation
import CoreMedia
import CoreVideo

enum CapturedAudio {
  case sampleBuffer(CMSampleBuffer)
  case pcm(AVAudioPCMBuffer, ptsMicros: UInt64)
}

struct CaptureSink {
  let video: (CVPixelBuffer, UInt64) -> Void
  let audio: (CapturedAudio) -> Void
}

protocol CaptureSource: AnyObject {
  var width: Int { get }
  var height: Int { get }
  func start(_ sink: CaptureSink) async throws
  func stop() async
}

enum CaptureClock {
  static func nowMicros() -> UInt64 {
    UInt64(CMClockGetTime(CMClockGetHostTimeClock()).seconds * 1_000_000)
  }

  static func micros(_ time: CMTime) -> UInt64 {
    time.isValid ? UInt64(max(0, time.seconds) * 1_000_000) : nowMicros()
  }
}

/// Fits the display's pixel size inside a 2560-pixel long edge, with even sides
/// as H.264's 4:2:0 subsampling needs.
func streamSize(pixelWidth: Int, pixelHeight: Int, maxLongEdge: Int = 2560) -> (width: Int, height: Int) {
  let longEdge = max(pixelWidth, pixelHeight)
  let scale = longEdge > maxLongEdge ? Double(maxLongEdge) / Double(longEdge) : 1
  let even = { (value: Double) in max(2, Int(value.rounded(.down)) & ~1) }
  return (even(Double(pixelWidth) * scale), even(Double(pixelHeight) * scale))
}
