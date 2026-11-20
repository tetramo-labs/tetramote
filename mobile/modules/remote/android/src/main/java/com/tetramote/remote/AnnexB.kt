package com.tetramote.remote

/** Splits an H.264 Annex B access unit into NAL units, each returned with a 4-byte start code. */
object AnnexB {
    const val NAL_SPS = 7
    const val NAL_PPS = 8

    private val START_CODE = byteArrayOf(0, 0, 0, 1)

    fun nalUnits(data: ByteArray, offset: Int = 0, length: Int = data.size - offset): List<ByteArray> {
        val end = offset + length
        val starts = mutableListOf<Pair<Int, Int>>()
        var i = offset
        while (i + 2 < end) {
            if (data[i].toInt() == 0 && data[i + 1].toInt() == 0 && data[i + 2].toInt() == 1) {
                starts.add(i to i + 3)
                i += 3
            } else {
                i++
            }
        }
        return starts.mapIndexed { index, (_, bodyStart) ->
            var bodyEnd = if (index + 1 < starts.size) starts[index + 1].first else end
            while (bodyEnd > bodyStart && data[bodyEnd - 1].toInt() == 0) bodyEnd--
            START_CODE + data.copyOfRange(bodyStart, bodyEnd)
        }.filter { it.size > START_CODE.size }
    }

    fun nalType(unit: ByteArray): Int = unit[START_CODE.size].toInt() and 0x1f

    /** Returns the SPS and PPS of a keyframe, or null when it carries neither. */
    fun parameterSets(data: ByteArray, offset: Int, length: Int): Pair<ByteArray, ByteArray>? {
        val units = nalUnits(data, offset, length)
        val sps = units.firstOrNull { nalType(it) == NAL_SPS } ?: return null
        val pps = units.firstOrNull { nalType(it) == NAL_PPS } ?: return null
        return sps to pps
    }
}
