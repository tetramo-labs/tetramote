import AVFoundation
import CoreMedia
import QuartzCore

private let headerLength = 13
private let keyframeRetry: CFTimeInterval = 0.3

/// Turns Annex B access units into AVCC sample buffers for an
/// AVSampleBufferDisplayLayer, which decodes in hardware and shows each frame
/// as soon as it is enqueued. All state lives on `queue`.
final class VideoRenderer {
  var requestKeyframe: (() -> Void)?
  var onStats: (([String: Any]) -> Void)?

  private let queue = DispatchQueue(label: "tetra.video", qos: .userInteractive)
  private var layer: AVSampleBufferDisplayLayer?
  private var format: CMVideoFormatDescription?
  private var sps = Data()
  private var pps = Data()
  private var waitingForKeyframe = true
  private var frames = 0
  private var bytes = 0
  private var dropped = 0
  private var windowStart = CACurrentMediaTime()
  private var lastKeyframeRequest = -Double.infinity

  func attach(_ layer: AVSampleBufferDisplayLayer) {
    queue.async {
      self.layer = layer
      self.waitingForKeyframe = true
      self.requestKeyframe?()
    }
  }

  func detach(_ layer: AVSampleBufferDisplayLayer) {
    queue.async {
      if self.layer === layer { self.layer = nil }
    }
  }

  func reset() {
    queue.async {
      self.format = nil
      self.sps = Data()
      self.pps = Data()
      self.waitingForKeyframe = true
      self.layer?.sampleBufferRenderer.flush()
    }
  }

  func expectNewStream() {
    queue.async { self.waitingForKeyframe = true }
  }

  func enqueue(_ frame: Data) {
    queue.async { self.render(frame) }
  }

  private func render(_ frame: Data) {
    guard frame.count > headerLength else { return }
    let start = frame.startIndex
    let keyframe = frame[start + 12] & 0x01 != 0
    let payload = frame[(start + headerLength)...]
    bytes += payload.count
    defer { reportStats() }

    guard let layer else {
      waitingForKeyframe = true
      drop()
      return
    }
    if waitingForKeyframe && !keyframe {
      drop()
      return
    }

    var avcc = Data(capacity: payload.count + 16)
    for nal in AnnexB.nalUnits(payload) {
      switch nal.first.map({ $0 & 0x1f }) {
      case 7: if nal != sps { sps = Data(nal); format = nil }
      case 8: if nal != pps { pps = Data(nal); format = nil }
      case 9, nil: break
      default:
        var length = UInt32(nal.count).bigEndian
        withUnsafeBytes(of: &length) { avcc.append(contentsOf: $0) }
        avcc.append(nal)
      }
    }
    if format == nil, !sps.isEmpty, !pps.isEmpty {
      format = AnnexB.formatDescription(sps: sps, pps: pps)
    }
    guard let format, !avcc.isEmpty, let sample = AnnexB.sampleBuffer(avcc, format: format) else {
      dropped += 1
      return
    }

    let renderer = layer.sampleBufferRenderer
    if renderer.status == .failed {
      renderer.flush()
      waitingForKeyframe = true
      dropped += 1
      requestKeyframe?()
      return
    }
    renderer.enqueue(sample)
    if keyframe { waitingForKeyframe = false }
    frames += 1
  }

  private func drop() {
    dropped += 1
    let now = CACurrentMediaTime()
    guard now - lastKeyframeRequest >= keyframeRetry else { return }
    lastKeyframeRequest = now
    requestKeyframe?()
  }

  private func reportStats() {
    let now = CACurrentMediaTime()
    let elapsed = now - windowStart
    guard elapsed >= 1 else { return }
    onStats?([
      "fps": Double(frames) / elapsed,
      "kbps": Double(bytes * 8) / elapsed / 1000,
      "dropped": dropped,
    ])
    frames = 0
    bytes = 0
    dropped = 0
    windowStart = now
  }
}

enum AnnexB {
  /// NAL units between start codes (`00 00 01` or `00 00 00 01`), start codes removed.
  static func nalUnits(_ data: Data) -> [Data] {
    var units: [Data] = []
    let base = data.startIndex
    let count = data.count
    var nalStart: Int?
    var i = 0
    data.withUnsafeBytes { raw in
      let b = raw.bindMemory(to: UInt8.self)
      while i + 2 < count {
        if b[i] == 0, b[i + 1] == 0, b[i + 2] == 1 {
          if let s = nalStart {
            var end = i
            while end > s, b[end - 1] == 0 { end -= 1 }
            if end > s { units.append(data[(base + s)..<(base + end)]) }
          }
          i += 3
          nalStart = i
        } else {
          i += 1
        }
      }
    }
    if let s = nalStart, s < count {
      units.append(data[(base + s)..<(base + count)])
    }
    return units
  }

  static func formatDescription(sps: Data, pps: Data) -> CMVideoFormatDescription? {
    var format: CMVideoFormatDescription?
    let status = sps.withUnsafeBytes { s in
      pps.withUnsafeBytes { p in
        let pointers = [
          s.bindMemory(to: UInt8.self).baseAddress!,
          p.bindMemory(to: UInt8.self).baseAddress!,
        ]
        let sizes = [sps.count, pps.count]
        return CMVideoFormatDescriptionCreateFromH264ParameterSets(
          allocator: kCFAllocatorDefault,
          parameterSetCount: 2,
          parameterSetPointers: pointers,
          parameterSetSizes: sizes,
          nalUnitHeaderLength: 4,
          formatDescriptionOut: &format
        )
      }
    }
    return status == noErr ? format : nil
  }

  static func sampleBuffer(_ avcc: Data, format: CMVideoFormatDescription) -> CMSampleBuffer? {
    var block: CMBlockBuffer?
    let length = avcc.count
    guard CMBlockBufferCreateWithMemoryBlock(
      allocator: kCFAllocatorDefault,
      memoryBlock: nil,
      blockLength: length,
      blockAllocator: kCFAllocatorDefault,
      customBlockSource: nil,
      offsetToData: 0,
      dataLength: length,
      flags: kCMBlockBufferAssureMemoryNowFlag,
      blockBufferOut: &block
    ) == noErr, let block else { return nil }
    let copied = avcc.withUnsafeBytes {
      CMBlockBufferReplaceDataBytes(with: $0.baseAddress!, blockBuffer: block, offsetIntoDestination: 0, dataLength: length)
    }
    guard copied == noErr else { return nil }

    var sample: CMSampleBuffer?
    var size = length
    guard CMSampleBufferCreateReady(
      allocator: kCFAllocatorDefault,
      dataBuffer: block,
      formatDescription: format,
      sampleCount: 1,
      sampleTimingEntryCount: 0,
      sampleTimingArray: nil,
      sampleSizeEntryCount: 1,
      sampleSizeArray: &size,
      sampleBufferOut: &sample
    ) == noErr, let sample else { return nil }

    if let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true),
       CFArrayGetCount(attachments) > 0 {
      let dict = unsafeBitCast(CFArrayGetValueAtIndex(attachments, 0), to: CFMutableDictionary.self)
      CFDictionarySetValue(
        dict,
        Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
        Unmanaged.passUnretained(kCFBooleanTrue).toOpaque()
      )
    }
    return sample
  }
}
