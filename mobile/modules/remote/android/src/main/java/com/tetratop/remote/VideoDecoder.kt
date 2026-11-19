package com.tetratop.remote

import android.media.MediaCodec
import android.media.MediaFormat
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.view.Surface
import java.nio.ByteBuffer
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.atomic.AtomicInteger

/**
 * One hardware H.264 decoder for the whole app, rendering into whichever
 * RemoteScreenView attached its surface last. Every codec call runs on its own
 * handler thread; frames with no surface are dropped and a keyframe is
 * requested once one arrives, since P-frames need the frames before them.
 */
class VideoDecoder {
    private class Frame(val data: ByteArray, val offset: Int, val length: Int, val key: Boolean, val ptsUs: Long)

    private val thread = HandlerThread("tetra-video").apply { start() }
    private val handler = Handler(thread.looper)
    private val main = Handler(Looper.getMainLooper())

    private var surface: Surface? = null
    private var codec: MediaCodec? = null
    private var configuredSps: ByteArray? = null
    private var streamWidth = 0
    private var streamHeight = 0
    private val freeInputs = ArrayDeque<Int>()
    private val pending = ArrayDeque<Frame>()
    private var needKeyframe = true
    private var lastRequest = 0L

    private val sizeListeners = CopyOnWriteArraySet<(Int, Int) -> Unit>()

    @Volatile var keyframeRequester: (() -> Unit)? = null

    @Volatile var videoWidth = 0
        private set

    @Volatile var videoHeight = 0
        private set

    val rendered = AtomicInteger()
    val dropped = AtomicInteger()

    fun submit(data: ByteArray, offset: Int, key: Boolean, ptsUs: Long) {
        val frame = Frame(data, offset, data.size - offset, key, ptsUs)
        handler.post { accept(frame) }
    }

    fun onStreamSize(width: Int, height: Int) {
        handler.post {
            if (width == streamWidth && height == streamHeight) return@post
            streamWidth = width
            streamHeight = height
            releaseCodec()
            publishSize(width, height)
        }
    }

    fun attachSurface(target: Surface) {
        handler.post {
            if (surface === target) return@post
            surface = target
            val current = codec
            if (current != null) {
                val switched = runCatching { current.setOutputSurface(target) }.isSuccess
                if (!switched) releaseCodec()
            }
            requestKeyframe(force = true)
        }
    }

    fun detachSurface(target: Surface) {
        handler.post {
            if (surface !== target) return@post
            surface = null
            releaseCodec()
        }
    }

    fun reset() {
        handler.post { releaseCodec() }
    }

    fun addSizeListener(listener: (Int, Int) -> Unit) {
        sizeListeners.add(listener)
        if (videoWidth > 0 && videoHeight > 0) main.post { listener(videoWidth, videoHeight) }
    }

    fun removeSizeListener(listener: (Int, Int) -> Unit) {
        sizeListeners.remove(listener)
    }

    private fun accept(frame: Frame) {
        if (surface == null) {
            dropped.incrementAndGet()
            needKeyframe = true
            return
        }
        if (frame.key) {
            val sets = AnnexB.parameterSets(frame.data, frame.offset, frame.length)
            if (sets != null && (codec == null || !sets.first.contentEquals(configuredSps))) {
                releaseCodec()
                if (!configure(sets.first, sets.second)) {
                    drop()
                    return
                }
            }
            if (codec != null) needKeyframe = false
        }
        if (codec == null || needKeyframe) {
            drop()
            return
        }
        pending.addLast(frame)
        if (pending.size > MAX_PENDING) {
            pending.clear()
            needKeyframe = true
            drop()
            return
        }
        feed()
    }

    private fun configure(sps: ByteArray, pps: ByteArray): Boolean {
        val target = surface ?: return false
        val width = if (streamWidth > 0) streamWidth else DEFAULT_WIDTH
        val height = if (streamHeight > 0) streamHeight else DEFAULT_HEIGHT
        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setByteBuffer("csd-0", ByteBuffer.wrap(sps))
            setByteBuffer("csd-1", ByteBuffer.wrap(pps))
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, maxOf(MIN_INPUT_SIZE, width * height))
            setInteger(MediaFormat.KEY_PRIORITY, 0)
            setInteger(MediaFormat.KEY_OPERATING_RATE, OPERATING_RATE)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) setInteger(MediaFormat.KEY_LOW_LATENCY, 1)
        }
        val created = runCatching {
            MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_AVC).also { c ->
                c.setCallback(callback, handler)
                try {
                    c.configure(format, target, null, 0)
                } catch (e: IllegalArgumentException) {
                    format.removeKey(MediaFormat.KEY_OPERATING_RATE)
                    c.configure(format, target, null, 0)
                }
                c.start()
            }
        }
        val c = created.getOrNull() ?: run {
            needKeyframe = true
            return false
        }
        codec = c
        configuredSps = sps
        return true
    }

    private fun feed() {
        val c = codec ?: return
        while (freeInputs.isNotEmpty() && pending.isNotEmpty()) {
            val index = freeInputs.removeFirst()
            val frame = pending.removeFirst()
            try {
                val buffer = c.getInputBuffer(index) ?: continue
                if (frame.length > buffer.capacity()) {
                    c.queueInputBuffer(index, 0, 0, frame.ptsUs, 0)
                    needKeyframe = true
                    drop()
                    continue
                }
                buffer.clear()
                buffer.put(frame.data, frame.offset, frame.length)
                val flags = if (frame.key) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
                c.queueInputBuffer(index, 0, frame.length, frame.ptsUs, flags)
            } catch (e: IllegalStateException) {
                releaseCodec()
                drop()
                return
            }
        }
    }

    private val callback = object : MediaCodec.Callback() {
        override fun onInputBufferAvailable(c: MediaCodec, index: Int) {
            if (c !== codec) return
            freeInputs.addLast(index)
            feed()
        }

        override fun onOutputBufferAvailable(c: MediaCodec, index: Int, info: MediaCodec.BufferInfo) {
            if (c !== codec) return
            runCatching { c.releaseOutputBuffer(index, info.size > 0) }
            if (info.size > 0) rendered.incrementAndGet()
        }

        override fun onError(c: MediaCodec, e: MediaCodec.CodecException) {
            if (c !== codec) return
            releaseCodec()
            requestKeyframe(force = true)
        }

        override fun onOutputFormatChanged(c: MediaCodec, format: MediaFormat) {
            if (c !== codec) return
            val width = cropped(format, "crop-right", "crop-left", MediaFormat.KEY_WIDTH)
            val height = cropped(format, "crop-bottom", "crop-top", MediaFormat.KEY_HEIGHT)
            if (width > 0 && height > 0) publishSize(width, height)
        }
    }

    private fun cropped(format: MediaFormat, endKey: String, startKey: String, sizeKey: String): Int {
        if (format.containsKey(endKey) && format.containsKey(startKey)) {
            return format.getInteger(endKey) - format.getInteger(startKey) + 1
        }
        return if (format.containsKey(sizeKey)) format.getInteger(sizeKey) else 0
    }

    private fun publishSize(width: Int, height: Int) {
        if (width == videoWidth && height == videoHeight) return
        videoWidth = width
        videoHeight = height
        main.post { sizeListeners.forEach { it(width, height) } }
    }

    private fun releaseCodec() {
        val c = codec
        codec = null
        configuredSps = null
        freeInputs.clear()
        pending.clear()
        needKeyframe = true
        if (c != null) {
            runCatching { c.stop() }
            runCatching { c.release() }
        }
    }

    private fun drop() {
        dropped.incrementAndGet()
        requestKeyframe(force = false)
    }

    private fun requestKeyframe(force: Boolean) {
        val now = SystemClock.elapsedRealtime()
        if (!force && now - lastRequest < KEYFRAME_RETRY_MS) return
        lastRequest = now
        keyframeRequester?.invoke()
    }

    private companion object {
        const val MAX_PENDING = 10
        const val KEYFRAME_RETRY_MS = 300L
        const val DEFAULT_WIDTH = 1920
        const val DEFAULT_HEIGHT = 1080
        const val MIN_INPUT_SIZE = 2 * 1024 * 1024
        const val OPERATING_RATE = 240
    }
}
