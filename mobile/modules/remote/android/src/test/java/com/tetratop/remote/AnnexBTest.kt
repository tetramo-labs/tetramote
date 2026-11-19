package com.tetratop.remote

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AnnexBTest {
    private fun bytes(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }

    private val keyframe = bytes(
        0, 0, 0, 1, 0x67, 0x64, 0x00, 0x1f,
        0, 0, 0, 1, 0x68, 0xee, 0x3c, 0x80,
        0, 0, 1, 0x65, 0x88, 0x84,
    )

    @Test
    fun splitsThreeAndFourByteStartCodes() {
        val units = AnnexB.nalUnits(keyframe)
        assertEquals(3, units.size)
        assertArrayEquals(bytes(0, 0, 0, 1, 0x67, 0x64, 0x00, 0x1f), units[0])
        assertArrayEquals(bytes(0, 0, 0, 1, 0x68, 0xee, 0x3c, 0x80), units[1])
        assertArrayEquals(bytes(0, 0, 0, 1, 0x65, 0x88, 0x84), units[2])
        assertEquals(listOf(7, 8, 5), units.map(AnnexB::nalType))
    }

    @Test
    fun findsParameterSetsAfterAnOffset() {
        val event = bytes(4, 9, 9) + keyframe
        val sets = AnnexB.parameterSets(event, 3, keyframe.size)
        assertArrayEquals(bytes(0, 0, 0, 1, 0x67, 0x64, 0x00, 0x1f), sets?.first)
        assertArrayEquals(bytes(0, 0, 0, 1, 0x68, 0xee, 0x3c, 0x80), sets?.second)
    }

    @Test
    fun deltaFramesHaveNoParameterSets() {
        assertNull(AnnexB.parameterSets(bytes(0, 0, 0, 1, 0x41, 0x9a), 0, 6))
    }
}
