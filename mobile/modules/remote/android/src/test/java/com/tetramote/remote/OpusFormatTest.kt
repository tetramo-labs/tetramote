package com.tetramote.remote

import org.junit.Assert.assertArrayEquals
import org.junit.Test

class OpusFormatTest {
    private fun bytes(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }

    @Test
    fun headIsAStereo48kHzOpusHeadWithoutPreSkipOrGain() {
        val expected = bytes(
            0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64,
            0x01, 0x02, 0x00, 0x00,
            0x80, 0xbb, 0x00, 0x00,
            0x00, 0x00, 0x00,
        )
        assertArrayEquals(expected, OpusFormat.head())
    }

    @Test
    fun preSkipIsZeroAndSeekPreRollIs80Milliseconds() {
        assertArrayEquals(bytes(0, 0, 0, 0, 0, 0, 0, 0), OpusFormat.preSkip())
        assertArrayEquals(bytes(0x00, 0xb4, 0xc4, 0x04, 0, 0, 0, 0), OpusFormat.seekPreRoll())
    }
}
