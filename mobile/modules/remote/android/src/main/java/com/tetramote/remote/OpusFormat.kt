package com.tetramote.remote

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The audio format PROTOCOL.md fixes (Opus, 48 kHz stereo) and the csd-0..2 buffers MediaCodec's Opus
 * decoder needs: an RFC 7845 OpusHead, then pre-skip and seek pre-roll as little-endian nanoseconds.
 */
object OpusFormat {
    const val SAMPLE_RATE = 48_000
    const val CHANNELS = 2

    private const val SEEK_PRE_ROLL_NS = 80_000_000L

    fun head(): ByteArray =
        ByteBuffer.allocate(19)
            .order(ByteOrder.LITTLE_ENDIAN)
            .put("OpusHead".toByteArray(Charsets.US_ASCII))
            .put(1)
            .put(CHANNELS.toByte())
            .putShort(0)
            .putInt(SAMPLE_RATE)
            .putShort(0)
            .put(0)
            .array()

    fun preSkip(): ByteArray = nanoseconds(0)

    fun seekPreRoll(): ByteArray = nanoseconds(SEEK_PRE_ROLL_NS)

    private fun nanoseconds(value: Long): ByteArray =
        ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(value).array()
}
