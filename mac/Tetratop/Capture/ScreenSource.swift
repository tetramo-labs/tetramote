import CoreGraphics
import CoreMedia
import Foundation
import ScreenCaptureKit

final class ScreenSource: NSObject, CaptureSource, SCStreamOutput, SCStreamDelegate {
  let displayID: CGDirectDisplayID
  let width: Int
  let height: Int
  private let display: SCDisplay
  private let queue = DispatchQueue(label: "tetratop.capture", qos: .userInteractive)
  private var stream: SCStream?
  private var sink: CaptureSink?

  init(display: SCDisplay) {
    self.display = display
    displayID = display.displayID
    let mode = CGDisplayCopyDisplayMode(display.displayID)
    let size = streamSize(pixelWidth: mode?.pixelWidth ?? display.width, pixelHeight: mode?.pixelHeight ?? display.height)
    width = size.width
    height = size.height
  }

  func start(_ sink: CaptureSink) async throws {
    self.sink = sink
    let config = SCStreamConfiguration()
    config.width = width
    config.height = height
    config.minimumFrameInterval = CMTime(value: 1, timescale: 60)
    config.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
    config.showsCursor = true
    config.queueDepth = 5
    config.capturesAudio = true
    config.sampleRate = AudioEncoder.sampleRate
    config.channelCount = AudioEncoder.channels
    config.excludesCurrentProcessAudio = true
    let filter = SCContentFilter(display: display, excludingWindows: [])
    let stream = SCStream(filter: filter, configuration: config, delegate: self)
    try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
    try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
    try await stream.startCapture()
    self.stream = stream
  }

  func stop() async {
    try? await stream?.stopCapture()
    stream = nil
    sink = nil
  }

  func stream(_: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard let sink, sampleBuffer.isValid else { return }
    switch type {
    case .screen:
      guard Self.isComplete(sampleBuffer), let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
      sink.video(pixels, CaptureClock.micros(CMSampleBufferGetPresentationTimeStamp(sampleBuffer)))
    case .audio:
      sink.audio(.sampleBuffer(sampleBuffer))
    default:
      break
    }
  }

  func stream(_: SCStream, didStopWithError _: Error) {
    stream = nil
  }

  private static func isComplete(_ sampleBuffer: CMSampleBuffer) -> Bool {
    guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false)
      as? [[SCStreamFrameInfo: Any]],
      let raw = attachments.first?[.status] as? Int,
      let status = SCFrameStatus(rawValue: raw)
    else { return false }
    return status == .complete
  }
}
