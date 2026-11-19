import AudioToolbox
import AVFoundation

private let packetHeaderLength = 12
private let startAfterPackets = 3
private let maxQueuedPackets = 12
private let opusFormat = AudioStreamBasicDescription(
  mSampleRate: 48000,
  mFormatID: kAudioFormatOpus,
  mFormatFlags: 0,
  mBytesPerPacket: 0,
  mFramesPerPacket: 960,
  mBytesPerFrame: 0,
  mChannelsPerFrame: 2,
  mBitsPerChannel: 0,
  mReserved: 0
)

/// Plays the Mac's Opus packets (20 ms, 48 kHz stereo) through an AudioQueue, which
/// decodes them. Packets beyond ~250 ms of backlog are dropped so latency cannot build up.
final class AudioPlayer {
  private let queue = DispatchQueue(label: "tetra.audio", qos: .userInitiated)
  private var audioQueue: AudioQueueRef?
  private var configured = false
  private var enabled = true
  private var running = false
  private var queued = 0

  func configure() {
    queue.async {
      self.teardown()
      self.configured = true
    }
  }

  func setEnabled(_ enabled: Bool) {
    queue.async {
      self.enabled = enabled
      if !enabled { self.teardown() }
    }
  }

  func reset() {
    queue.async {
      self.teardown()
      self.configured = false
    }
  }

  func enqueue(_ packet: Data) {
    queue.async { self.play(packet) }
  }

  private func play(_ packet: Data) {
    guard enabled, packet.count > packetHeaderLength else { return }
    let frame = packet.dropFirst(packetHeaderLength)
    guard let audioQueue = audioQueue ?? makeQueue() else { return }
    if queued >= maxQueuedPackets { return }

    var buffer: AudioQueueBufferRef?
    guard AudioQueueAllocateBufferWithPacketDescriptions(audioQueue, UInt32(frame.count), 1, &buffer) == noErr,
          let buffer else { return }
    frame.withUnsafeBytes { raw in
      buffer.pointee.mAudioData.copyMemory(from: raw.baseAddress!, byteCount: frame.count)
    }
    buffer.pointee.mAudioDataByteSize = UInt32(frame.count)
    var description = AudioStreamPacketDescription(
      mStartOffset: 0,
      mVariableFramesInPacket: 0,
      mDataByteSize: UInt32(frame.count)
    )
    guard AudioQueueEnqueueBuffer(audioQueue, buffer, 1, &description) == noErr else {
      AudioQueueFreeBuffer(audioQueue, buffer)
      return
    }
    queued += 1
    if !running, queued >= startAfterPackets {
      running = AudioQueueStart(audioQueue, nil) == noErr
    }
  }

  private func makeQueue() -> AudioQueueRef? {
    guard configured else { return nil }
    var format = opusFormat
    try? AVAudioSession.sharedInstance().setCategory(.playback, options: [.mixWithOthers])
    try? AVAudioSession.sharedInstance().setActive(true)
    var created: AudioQueueRef?
    let status = AudioQueueNewOutputWithDispatchQueue(&created, &format, 0, queue) { [weak self] aq, buffer in
      AudioQueueFreeBuffer(aq, buffer)
      guard let self else { return }
      self.queued = max(0, self.queued - 1)
      if self.queued == 0, self.running {
        AudioQueuePause(aq)
        self.running = false
      }
    }
    guard status == noErr, let created else { return nil }
    audioQueue = created
    queued = 0
    running = false
    return created
  }

  private func teardown() {
    guard let audioQueue else { return }
    AudioQueueStop(audioQueue, true)
    AudioQueueDispose(audioQueue, true)
    self.audioQueue = nil
    queued = 0
    running = false
  }
}
