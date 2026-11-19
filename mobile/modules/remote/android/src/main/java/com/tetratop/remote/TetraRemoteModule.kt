package com.tetratop.remote

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.typedarray.Uint8Array
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

class StartConfig : Record {
    @Field val secretKey: String = ""

    @Field val relayUrl: String? = null
}

class ConnectRequest : Record {
    @Field val ticket: String? = null

    @Field val endpointId: String = ""

    @Field val pairingSecret: String? = null

    @Field val deviceName: String = ""
}

class TetraRemoteModule : Module() {
    @Volatile private var handle = 0L

    @Volatile private var session: RemoteSession? = null

    override fun definition() = ModuleDefinition {
        Name("TetraRemote")

        Events("onState", "onControl", "onStats")

        OnCreate {
            val context = appContext.reactContext?.applicationContext
            if (TetraNative.loaded && context != null) TetraNative.init(context)
        }

        OnDestroy {
            Thread { stopSession() }.start()
        }

        Function("generateSecretKey") {
            requireLoaded().generateSecretKey()
        }

        Function("endpointId") { secretKey: String ->
            requireLoaded().endpointId(secretKey)
        }

        AsyncFunction("start") Coroutine { config: StartConfig ->
            withContext(Dispatchers.IO) { start(config) }
        }

        AsyncFunction("stop") Coroutine { ->
            withContext(Dispatchers.IO) { stopSession() }
        }

        Function("connect") { request: ConnectRequest ->
            val json = JSONObject()
                .put("ticket", request.ticket ?: JSONObject.NULL)
                .put("endpointId", request.endpointId)
                .put("pairingSecret", request.pairingSecret ?: JSONObject.NULL)
                .put("deviceName", request.deviceName)
            val result = requireLoaded().clientConnect(requireHandle(), json.toString())
            if (result == TetraNative.ERR_INVALID) {
                throw CodedException("ERR_TETRA_CONNECT", "The connect request was malformed; pair the Mac again.", null)
            }
        }

        Function("disconnect") {
            if (handle != 0L) TetraNative.clientDisconnect(handle)
        }

        Function("sendControl") { json: String ->
            if (handle != 0L) TetraNative.clientSendControl(handle, json)
        }

        Function("sendInput") { records: Uint8Array ->
            if (handle != 0L && records.byteLength > 0) {
                val bytes = ByteArray(records.byteLength)
                records.read(bytes, 0, records.byteLength)
                TetraNative.clientSendInput(handle, bytes)
            }
        }

        Function("setAudioEnabled") { enabled: Boolean ->
            RemoteMedia.audio.setEnabled(enabled)
        }

        Function("launchPairingUrl") {
            appContext.currentActivity?.intent?.getStringExtra("TetratopPairURL")
        }

        View(RemoteScreenView::class) {}
    }

    private fun start(config: StartConfig) {
        val native = requireLoaded()
        stopSession()
        val json = JSONObject()
            .put("secretKey", config.secretKey)
            .put("relayUrl", config.relayUrl?.takeIf { it.isNotBlank() } ?: JSONObject.NULL)
        val result = JSONObject(native.clientStart(json.toString()))
        if (result.has("error")) {
            throw CodedException(
                "ERR_TETRA_START",
                "Couldn't start the iroh endpoint: ${result.getString("error")}. Check the relay URL in Settings and try again.",
                null,
            )
        }
        val started = result.getLong("handle")
        handle = started
        session = RemoteSession(started) { name, body -> sendEvent(name, body) }.also { it.start() }
    }

    @Synchronized
    private fun stopSession() {
        val current = handle
        handle = 0L
        if (current != 0L) TetraNative.stop(current)
        session?.stop()
        session = null
    }

    private fun requireHandle(): Long {
        val current = handle
        if (current == 0L) {
            throw CodedException("ERR_TETRA_NOT_STARTED", "The iroh endpoint isn't running. Call start() before connect().", null)
        }
        return current
    }

    private fun requireLoaded(): TetraNative {
        if (!TetraNative.loaded) {
            throw CodedException(
                "ERR_TETRA_MISSING",
                "The Tetratop core library is missing for this device's ABI. Rebuild it with `bun run build:core android`.",
                null,
            )
        }
        return TetraNative
    }
}
