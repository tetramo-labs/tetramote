package com.tetramote.remote

import android.content.Context

object TetraNative {
    val loaded: Boolean = runCatching { System.loadLibrary("tetra_core") }.isSuccess

    const val EVENT_CLOSED = 0
    const val EVENT_STATE = 1
    const val EVENT_CONTROL = 2
    const val EVENT_VIDEO = 4
    const val EVENT_AUDIO = 5

    const val ERR_INVALID = -3

    @JvmStatic external fun init(context: Context)

    @JvmStatic external fun generateSecretKey(): String

    @JvmStatic external fun endpointId(secretKey: String): String?

    @JvmStatic external fun clientStart(configJson: String): String

    @JvmStatic external fun clientConnect(handle: Long, requestJson: String): Int

    @JvmStatic external fun clientDisconnect(handle: Long)

    @JvmStatic external fun clientSendControl(handle: Long, json: String): Int

    @JvmStatic external fun clientSendInput(handle: Long, records: ByteArray): Int

    @JvmStatic external fun nextEvent(handle: Long, timeoutMs: Int): ByteArray?

    @JvmStatic external fun stop(handle: Long)
}
