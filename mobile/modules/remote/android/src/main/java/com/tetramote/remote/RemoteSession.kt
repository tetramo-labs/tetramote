package com.tetramote.remote

import android.os.SystemClock
import org.json.JSONObject

/**
 * Drains one core handle's events on a dedicated thread: video and audio go
 * straight to the decoders, state and control messages go to JS.
 */
class RemoteSession(
    private val handle: Long,
    private val emit: (String, Map<String, Any?>) -> Unit,
) {
    private val thread = Thread(::run, "tetra-events")

    @Volatile private var running = true

    private var windowStart = SystemClock.elapsedRealtime()
    private var windowBytes = 0L
    private var windowFrames = 0
    private var renderedMark = 0
    private var droppedMark = 0

    fun start() {
        RemoteMedia.video.keyframeRequester = { requestKeyframe() }
        thread.start()
    }

    fun stop() {
        running = false
        runCatching { thread.join(STOP_TIMEOUT_MS) }
        RemoteMedia.video.keyframeRequester = null
        RemoteMedia.video.reset()
        RemoteMedia.audio.release()
    }

    private fun requestKeyframe() {
        if (running) TetraNative.clientSendControl(handle, KEYFRAME_REQUEST)
    }

    private fun run() {
        while (running) {
            val event = TetraNative.nextEvent(handle, POLL_MS)
            if (event != null && event.isNotEmpty()) {
                when (event[0].toInt()) {
                    TetraNative.EVENT_CLOSED -> return
                    TetraNative.EVENT_STATE -> onState(text(event))
                    TetraNative.EVENT_CONTROL -> onControl(text(event))
                    TetraNative.EVENT_VIDEO -> onVideo(event)
                    TetraNative.EVENT_AUDIO -> onAudio(event)
                }
            }
            reportStats()
        }
    }

    private fun text(event: ByteArray) = String(event, 1, event.size - 1, Charsets.UTF_8)

    private fun onState(json: String) {
        val type = runCatching { JSONObject(json).optString("type") }.getOrDefault("")
        if (type == "disconnected" || type == "rejected") {
            RemoteMedia.video.reset()
            RemoteMedia.audio.flush()
        }
        emit("onState", mapOf("json" to json))
    }

    private fun onControl(json: String) {
        val message = runCatching { JSONObject(json) }.getOrNull()
        when (message?.optString("t")) {
            "video" -> {
                val width = message.optInt("width")
                val height = message.optInt("height")
                if (width > 0 && height > 0) RemoteMedia.video.onStreamSize(width, height)
            }
            "audio" -> RemoteMedia.audio.configure()
        }
        emit("onControl", mapOf("json" to json))
    }

    private fun onVideo(event: ByteArray) {
        if (event.size <= VIDEO_PAYLOAD_OFFSET) return
        val flags = event[VIDEO_PAYLOAD_OFFSET - 1].toInt()
        val ptsUs = readLong(event, 5)
        RemoteMedia.video.submit(event, VIDEO_PAYLOAD_OFFSET, flags and FLAG_KEYFRAME != 0, ptsUs)
        windowFrames++
        windowBytes += event.size - VIDEO_PAYLOAD_OFFSET
    }

    private fun onAudio(event: ByteArray) {
        if (event.size <= AUDIO_PAYLOAD_OFFSET) return
        RemoteMedia.audio.push(event, AUDIO_PAYLOAD_OFFSET)
    }

    private fun reportStats() {
        val now = SystemClock.elapsedRealtime()
        val elapsed = now - windowStart
        if (elapsed < STATS_INTERVAL_MS) return
        val rendered = RemoteMedia.video.rendered.get()
        val dropped = RemoteMedia.video.dropped.get()
        if (windowFrames > 0) {
            emit(
                "onStats",
                mapOf(
                    "fps" to (rendered - renderedMark) * 1000.0 / elapsed,
                    "kbps" to windowBytes * 8.0 / elapsed,
                    "dropped" to dropped - droppedMark,
                ),
            )
        }
        windowStart = now
        windowFrames = 0
        windowBytes = 0
        renderedMark = rendered
        droppedMark = dropped
    }

    private fun readLong(bytes: ByteArray, at: Int): Long {
        var value = 0L
        for (i in 0 until 8) value = (value shl 8) or (bytes[at + i].toLong() and 0xff)
        return value
    }

    private companion object {
        const val POLL_MS = 250
        const val STOP_TIMEOUT_MS = 1000L
        const val STATS_INTERVAL_MS = 1000L
        const val VIDEO_PAYLOAD_OFFSET = 14
        const val AUDIO_PAYLOAD_OFFSET = 13
        const val FLAG_KEYFRAME = 0x01
        const val KEYFRAME_REQUEST = """{"t":"keyframe"}"""
    }
}
