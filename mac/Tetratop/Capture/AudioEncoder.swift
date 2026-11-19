import AVFoundation
import CoreMedia
import Foundation

struct EncodedAudio {
  let frame: Data
  let ptsMicros: UInt64
}

/// PCM in, one raw AAC-LC frame (1024 samples, no ADTS) out per callback.
final class AudioEncoder {
  static let sampleRate = 48000
  static let channels = 2
  static let bitrate = 128_000

  static var config: Data {
    AudioSpecificConfig.aacLC(sampleRate: sampleRate, channels: channels) ?? Data([0x11, 0x90])
  }

  private let output: AVAudioFormat
  private var converter: AVAudioConverter?
  private var inputFormat: AVAudioFormat?
  private var pending: [AVAudioPCMBuffer] = []
  private var nextPts: UInt64?
  private let onFrame: (EncodedAudio) -> Void

  init(onFrame: @escaping (EncodedAudio) -> Void) {
    var description = AudioStreamBasicDescription(
      mSampleRate: Double(Self.sampleRate), mFormatID: kAudioFormatMPEG4AAC, mFormatFlags: 0,
      mBytesPerPacket: 0, mFramesPerPacket: 1024, mBytesPerFrame: 0,
      mChannelsPerFrame: UInt32(Self.channels), mBitsPerChannel: 0, mReserved: 0
    )
    output = AVAudioFormat(streamDescription: &description)!
    self.onFrame = onFrame
  }

  func encode(sampleBuffer: CMSampleBuffer) {
    guard let buffer = Self.pcmBuffer(from: sampleBuffer) else { return }
    let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    encode(buffer, ptsMicros: pts.isValid ? UInt64(max(0, pts.seconds) * 1_000_000) : nil)
  }

  func encode(_ buffer: AVAudioPCMBuffer, ptsMicros: UInt64?) {
    if inputFormat != buffer.format {
      inputFormat = buffer.format
      converter = AVAudioConverter(from: buffer.format, to: output)
      converter?.bitRate = Self.bitrate
      pending.removeAll()
    }
    guard let converter else { return }
    if nextPts == nil, let ptsMicros {
      nextPts = ptsMicros
    }
    pending.append(buffer)
    while true {
      let packets = AVAudioCompressedBuffer(
        format: output,
        packetCapacity: 8,
        maximumPacketSize: converter.maximumOutputPacketSize
      )
      var error: NSError?
      let status = converter.convert(to: packets, error: &error) { [weak self] _, inputStatus in
        guard let self, !self.pending.isEmpty else {
          inputStatus.pointee = .noDataNow
          return nil
        }
        inputStatus.pointee = .haveData
        return pending.removeFirst()
      }
      emit(packets)
      if status != .haveData || packets.packetCount == 0 {
        break
      }
    }
  }

  private func emit(_ packets: AVAudioCompressedBuffer) {
    guard let descriptions = packets.packetDescriptions else { return }
    let base = packets.data.assumingMemoryBound(to: UInt8.self)
    for index in 0 ..< Int(packets.packetCount) {
      let description = descriptions[index]
      let frame = Data(bytes: base + Int(description.mStartOffset), count: Int(description.mDataByteSize))
      let pts = nextPts ?? 0
      nextPts = pts + UInt64(1024 * 1_000_000 / Self.sampleRate)
      onFrame(EncodedAudio(frame: frame, ptsMicros: pts))
    }
  }

  private static func pcmBuffer(from sampleBuffer: CMSampleBuffer) -> AVAudioPCMBuffer? {
    guard let description = CMSampleBufferGetFormatDescription(sampleBuffer),
          let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(description),
          let format = AVAudioFormat(streamDescription: asbd)
    else { return nil }
    let frames = AVAudioFrameCount(CMSampleBufferGetNumSamples(sampleBuffer))
    guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
    buffer.frameLength = frames
    let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
      sampleBuffer, at: 0, frameCount: Int32(frames), into: buffer.mutableAudioBufferList
    )
    return status == noErr ? buffer : nil
  }
}
