use std::ffi::c_void;
use std::sync::Once;

use jni::objects::{JByteArray, JClass, JObject, JString};
use jni::sys::{jbyteArray, jint, jlong, jstring};
use jni::JNIEnv;

use crate::ffi;
use crate::net;

fn to_jstring(env: &mut JNIEnv, s: String) -> jstring {
    env.new_string(s)
        .map(JString::into_raw)
        .unwrap_or(std::ptr::null_mut())
}

fn from_jstring(env: &mut JNIEnv, s: &JString) -> String {
    env.get_string(s).map(Into::into).unwrap_or_default()
}

fn started(env: &mut JNIEnv, result: Result<u64, String>) -> jstring {
    let json = match result {
        Ok(handle) => serde_json::json!({"handle": handle}),
        Err(error) => serde_json::json!({"error": error}),
    };
    to_jstring(env, json.to_string())
}

/// iroh reads DNS servers and network interfaces through Android APIs, which
/// need the app context registered with ndk-context before the first bind.
#[no_mangle]
pub extern "system" fn Java_com_tetramote_remote_TetraNative_init(
    env: JNIEnv,
    _class: JClass,
    context: JObject,
) {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let (Ok(vm), Ok(context)) = (env.get_java_vm(), env.new_global_ref(context)) else {
            return;
        };
        unsafe {
            ndk_context::initialize_android_context(
                vm.get_java_vm_pointer() as *mut c_void,
                context.as_obj().as_raw() as *mut c_void,
            );
        }
        std::mem::forget(context);
    });
}

#[no_mangle]
pub extern "system" fn Java_com_tetramote_remote_TetraNative_generateSecretKey(
    mut env: JNIEnv,
    _class: JClass,
) -> jstring {
    to_jstring(&mut env, net::generate_secret_key())
}

#[no_mangle]
pub extern "system" fn Java_com_tetramote_remote_TetraNative_endpointId(
    mut env: JNIEnv,
    _class: JClass,
    secret: JString,
) -> jstring {
    let secret = from_jstring(&mut env, &secret);
    match net::endpoint_id_for(&secret) {
        Some(id) => to_jstring(&mut env, id),
        None => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub extern "system" fn Java_com_tetramote_remote_TetraNative_clientStart(
    mut env: JNIEnv,
    _class: JClass,
    config: JString,
) -> jstring {
    let config = from_jstring(&mut env, &config);
    let result = std::panic::catch_unwind(|| ffi::client_start(&config))
        .unwrap_or_else(|_| Err("tetra core panicked".into()));
    started(&mut env, result)
}

#[no_mangle]
pub extern "system" fn Java_com_tetramote_remote_TetraNative_clientConnect(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    request: JString,
) -> jint {
    let request = from_jstring(&mut env, &request);
    ffi::client_connect(handle as u64, &request)
}

#[no_mangle]
pub extern "system" fn Java_com_tetramote_remote_TetraNative_clientDisconnect(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    ffi::client_disconnect(handle as u64);
}

#[no_mangle]
pub extern "system" fn Java_com_tetramote_remote_TetraNative_clientSendControl(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    json: JString,
) -> jint {
    let json = from_jstring(&mut env, &json);
    ffi::client_send_control(handle as u64, json.as_bytes())
}

#[no_mangle]
pub extern "system" fn Java_com_tetramote_remote_TetraNative_clientSendInput(
    env: JNIEnv,
    _class: JClass,
    handle: jlong,
    data: JByteArray,
) -> jint {
    let Ok(bytes) = env.convert_byte_array(&data) else {
        return ffi::ERR_INVALID;
    };
    ffi::client_send_input(handle as u64, &bytes)
}

/// Returns null on timeout; the array's first byte is the event kind.
#[no_mangle]
pub extern "system" fn Java_com_tetramote_remote_TetraNative_nextEvent(
    env: JNIEnv,
    _class: JClass,
    handle: jlong,
    timeout_ms: jint,
) -> jbyteArray {
    let Some(event) = ffi::next_event(handle as u64, timeout_ms.max(0) as u32) else {
        return std::ptr::null_mut();
    };
    env.byte_array_from_slice(&event)
        .map(JByteArray::into_raw)
        .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "system" fn Java_com_tetramote_remote_TetraNative_stop(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    ffi::stop(handle as u64);
}
