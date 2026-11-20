package com.tetramote.remote

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaFormat
import java.nio.ByteBuffer
import java.util.concurrent.LinkedBlockingDeque
import java.util.concurrent.TimeUnit

/**
 * Plays the Mac's 20 ms Opus packets. The queue is capped at 200 ms and drops its
 * oldest packets beyond that, so playback latency can never build up.
 */
class AudioPlayer {
    private var configured = false
    private var pipeline: Pipeline? = null
    private var enabled = true

    @Synchronized
    fun configure() {
        pipeline?.stop()
        pipeline = null
        configured = true
        if (enabled) startPipeline()
    }

    @Synchronized
    fun setEnabled(on: Boolean) {
        enabled = on
        if (!on) {
            pipeline?.stop()
            pipeline = null
        } else if (pipeline == null) {
            startPipeline()
        }
    }

    fun push(packet: ByteArray, offset: Int) {
        val p = synchronized(this) { pipeline } ?: return
        p.offer(packet.copyOfRange(offset, packet.size))
    }

    @Synchronized
    fun flush() {
        pipeline?.clear()
    }

    @Synchronized
    fun release() {
        pipeline?.stop()
        pipeline = null
        configured = false
    }

    private fun startPipeline() {
        if (configured) pipeline = Pipeline().also { it.start() }
    }

    private class Pipeline {
        private val queue = LinkedBlockingDeque<ByteArray>()
        private val thread = Thread(::run, "tetra-audio")

        @Volatile private var running = true

        fun start() = thread.start()

        fun offer(packet: ByteArray) {
            queue.offerLast(packet)
            while (queue.size > MAX_QUEUED_PACKETS) queue.pollFirst()
        }

        fun clear() = queue.clear()

        fun stop() {
            running = false
            thread.interrupt()
            runCatching { thread.join(STOP_TIMEOUT_MS) }
        }

        private fun run() {
            val codec = runCatching { createCodec() }.getOrNull() ?: return
            val track = runCatching { createTrack() }.getOrNull()
            if (track == null) {
                runCatching { codec.release() }
                return
            }
            try {
                track.play()
                val info = MediaCodec.BufferInfo()
                while (running) {
                    val packet = queue.pollFirst(POLL_MS, TimeUnit.MILLISECONDS)
                    if (packet != null) queueInput(codec, packet)
                    drainOutput(codec, track, info)
                }
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
            } catch (e: IllegalStateException) {
                running = false
            } finally {
                runCatching { track.pause() }
                runCatching { track.flush() }
                runCatching { track.release() }
                runCatching { codec.stop() }
                runCatching { codec.release() }
            }
        }

        private fun queueInput(codec: MediaCodec, packet: ByteArray) {
            val index = codec.dequeueInputBuffer(INPUT_TIMEOUT_US)
            if (index < 0) return
            val buffer = codec.getInputBuffer(index) ?: return
            if (packet.size > buffer.capacity()) {
                codec.queueInputBuffer(index, 0, 0, 0, 0)
                return
            }
            buffer.clear()
            buffer.put(packet)
            codec.queueInputBuffer(index, 0, packet.size, 0, 0)
        }

        private fun drainOutput(codec: MediaCodec, track: AudioTrack, info: MediaCodec.BufferInfo) {
            while (running) {
                val index = codec.dequeueOutputBuffer(info, 0)
                if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) continue
                if (index < 0) return
                val buffer = codec.getOutputBuffer(index)
                if (buffer != null && info.size > 0) {
                    val pcm = ByteArray(info.size)
                    buffer.position(info.offset)
                    buffer.get(pcm, 0, info.size)
                    track.write(pcm, 0, pcm.size)
                }
                codec.releaseOutputBuffer(index, false)
            }
        }

        private fun createCodec(): MediaCodec {
            val format = MediaFormat.createAudioFormat(
                MediaFormat.MIMETYPE_AUDIO_OPUS,
                OpusFormat.SAMPLE_RATE,
                OpusFormat.CHANNELS,
            ).apply {
                setByteBuffer("csd-0", ByteBuffer.wrap(OpusFormat.head()))
                setByteBuffer("csd-1", ByteBuffer.wrap(OpusFormat.preSkip()))
                setByteBuffer("csd-2", ByteBuffer.wrap(OpusFormat.seekPreRoll()))
                setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
            }
            return MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_OPUS).apply {
                configure(format, null, null, 0)
                start()
            }
        }

        private fun createTrack(): AudioTrack {
            val mask = AudioFormat.CHANNEL_OUT_STEREO
            val minBuffer = AudioTrack.getMinBufferSize(OpusFormat.SAMPLE_RATE, mask, AudioFormat.ENCODING_PCM_16BIT)
            return AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build(),
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(OpusFormat.SAMPLE_RATE)
                        .setChannelMask(mask)
                        .build(),
                )
                .setBufferSizeInBytes(minBuffer * 4)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
                .build()
        }
    }

    private companion object {
        const val MAX_QUEUED_PACKETS = 10
        const val POLL_MS = 20L
        const val INPUT_TIMEOUT_US = 10_000L
        const val STOP_TIMEOUT_MS = 500L
    }
}
