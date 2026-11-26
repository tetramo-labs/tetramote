package com.tetramote.remote

import android.content.Context
import android.hardware.input.InputManager
import android.os.Handler
import android.os.Looper
import android.view.InputDevice
import android.view.KeyEvent

/**
 * Keys from a hardware keyboard, which MainActivity hands here before anything else sees them (an app config
 * plugin adds the call). While a session has it on, every key from a physical alphabetic keyboard is taken and
 * sent on with its Android key code and the character the device's layout makes of it.
 */
object HardwareKeyboard : InputManager.InputDeviceListener {
    @Volatile var emit: ((String, Map<String, Any>) -> Unit)? = null
    @Volatile private var enabled = false
    private var inputManager: InputManager? = null

    private val passThrough = setOf(
        KeyEvent.KEYCODE_BACK,
        KeyEvent.KEYCODE_HOME,
        KeyEvent.KEYCODE_POWER,
        KeyEvent.KEYCODE_VOLUME_UP,
        KeyEvent.KEYCODE_VOLUME_DOWN,
        KeyEvent.KEYCODE_VOLUME_MUTE,
        KeyEvent.KEYCODE_APP_SWITCH,
    )

    fun setEnabled(context: Context?, on: Boolean) {
        Handler(Looper.getMainLooper()).post {
            enabled = on
            val manager = inputManager ?: context?.getSystemService(Context.INPUT_SERVICE) as? InputManager
            inputManager = manager
            if (on) manager?.registerInputDeviceListener(this, null) else manager?.unregisterInputDeviceListener(this)
            if (on) report()
        }
    }

    @JvmStatic
    fun handle(event: KeyEvent): Boolean {
        if (!enabled || event.keyCode in passThrough || !isPhysicalKeyboard(event.device)) return false
        if (event.action != KeyEvent.ACTION_DOWN && event.action != KeyEvent.ACTION_UP) return false
        emit?.invoke(
            "onKey",
            mapOf(
                "code" to event.keyCode,
                "down" to (event.action == KeyEvent.ACTION_DOWN),
                "unicode" to event.unicodeChar,
            ),
        )
        return true
    }

    private fun isPhysicalKeyboard(device: InputDevice?): Boolean =
        device != null && !device.isVirtual && device.keyboardType == InputDevice.KEYBOARD_TYPE_ALPHABETIC

    private fun report() {
        val connected = InputDevice.getDeviceIds().any { isPhysicalKeyboard(InputDevice.getDevice(it)) }
        emit?.invoke("onKeyboard", mapOf("connected" to connected))
    }

    override fun onInputDeviceAdded(deviceId: Int) = report()

    override fun onInputDeviceRemoved(deviceId: Int) = report()

    override fun onInputDeviceChanged(deviceId: Int) = report()
}
