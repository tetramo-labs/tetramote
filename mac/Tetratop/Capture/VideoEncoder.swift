import CoreMedia
import CoreVideo
import Foundation
import VideoToolbox

struct EncodedFrame {
  let annexB: Data
  let keyframe: Bool
  let ptsMicros: UInt64
}

struct EncoderError: LocalizedError {
  let status: OSStatus
  var errorDescription: String? {
    "The H.264 encoder did not start (VideoToolbox error \(status)). Quit and reopen Tetratop."
  }
}

/// Low-latency H.264: no B-frames, keyframes only on request.
final class VideoEncoder {
  let width: Int32
  let height: Int32
  private let session: VTCompressionSession
  private let onFrame: (EncodedFrame) -> Void

  init(width: Int32, height: Int32, bitrate: Int, onFrame: @escaping (EncodedFrame) -> Void) throws {
    self.width = width
    self.height = height
    self.onFrame = onFrame
    let lowLatency = [kVTVideoEncoderSpecification_EnableLowLatencyRateControl: true] as CFDictionary
    var created: VTCompressionSession?
    var status = noErr
    for spec in [lowLatency, nil] {
      status = VTCompressionSessionCreate(
        allocator: nil, width: width, height: height, codecType: kCMVideoCodecType_H264,
        encoderSpecification: spec, imageBufferAttributes: nil, compressedDataAllocator: nil,
        outputCallback: nil, refcon: nil, compressionSessionOut: &created
      )
      if status == noErr {
        break
      }
    }
    guard status == noErr, let created else { throw EncoderError(status: status) }
    session = created
    set(kVTCompressionPropertyKey_RealTime, kCFBooleanTrue)
    set(kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse)
    if set(kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_High_AutoLevel) != noErr {
      set(kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_Main_AutoLevel)
    }
    set(kVTCompressionPropertyKey_MaxKeyFrameInterval, 1_000_000 as CFNumber)
    set(kVTCompressionPropertyKey_ExpectedFrameRate, 60 as CFNumber)
    setBitrate(bitrate)
    VTCompressionSessionPrepareToEncodeFrames(session)
  }

  deinit {
    VTCompressionSessionCompleteFrames(session, untilPresentationTimeStamp: .invalid)
    VTCompressionSessionInvalidate(session)
  }

  func setBitrate(_ bitrate: Int) {
    set(kVTCompressionPropertyKey_AverageBitRate, bitrate as CFNumber)
  }

  func encode(_ pixelBuffer: CVPixelBuffer, ptsMicros: UInt64, forceKeyframe: Bool) {
    let pts = CMTime(value: CMTimeValue(ptsMicros), timescale: 1_000_000)
    let properties = forceKeyframe ? [kVTEncodeFrameOptionKey_ForceKeyFrame: true] as CFDictionary : nil
    let onFrame = onFrame
    VTCompressionSessionEncodeFrame(
      session, imageBuffer: pixelBuffer, presentationTimeStamp: pts, duration: .invalid,
      frameProperties: properties, infoFlagsOut: nil
    ) { status, _, sampleBuffer in
      guard status == noErr, let sampleBuffer, let frame = Self.annexB(sampleBuffer, ptsMicros: ptsMicros) else { return }
      onFrame(frame)
    }
  }

  @discardableResult
  private func set(_ key: CFString, _ value: CFTypeRef?) -> OSStatus {
    VTSessionSetProperty(session, key: key, value: value)
  }

  private static func annexB(_ sampleBuffer: CMSampleBuffer, ptsMicros: UInt64) -> EncodedFrame? {
    guard let block = CMSampleBufferGetDataBuffer(sampleBuffer),
          let format = CMSampleBufferGetFormatDescription(sampleBuffer)
    else { return nil }
    let keyframe = isKeyframe(sampleBuffer)
    var parameterSets: [Data] = []
    var lengthSize: Int32 = 4
    var count = 0
    CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
      format, parameterSetIndex: 0, parameterSetPointerOut: nil, parameterSetSizeOut: nil,
      parameterSetCountOut: &count, nalUnitHeaderLengthOut: &lengthSize
    )
    if keyframe {
      for index in 0 ..< count {
        var pointer: UnsafePointer<UInt8>?
        var size = 0
        if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
          format, parameterSetIndex: index, parameterSetPointerOut: &pointer, parameterSetSizeOut: &size,
          parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil
        ) == noErr, let pointer {
          parameterSets.append(Data(bytes: pointer, count: size))
        }
      }
    }
    var avcc = Data(count: CMBlockBufferGetDataLength(block))
    let copied = avcc.withUnsafeMutableBytes { raw in
      CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: raw.count, destination: raw.baseAddress!)
    }
    guard copied == noErr,
          let data = AnnexB.fromAVCC(avcc, lengthSize: Int(lengthSize), parameterSets: parameterSets)
    else { return nil }
    return EncodedFrame(annexB: data, keyframe: keyframe, ptsMicros: ptsMicros)
  }

  private static func isKeyframe(_ sampleBuffer: CMSampleBuffer) -> Bool {
    guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false)
      as? [[CFString: Any]], let first = attachments.first
    else { return true }
    return (first[kCMSampleAttachmentKey_NotSync] as? Bool) != true
  }
}
