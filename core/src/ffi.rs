use std::collections::HashMap;
use std::ffi::{c_char, CStr, CString};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::Duration;

use crate::client::{self, Client, ConnectRequest};
use crate::host::{Host, HostConfig};
use crate::net::{self, runtime, EndpointConfig, Events};
use crate::protocol::EVENT_CLOSED;

pub(crate) const ERR_UNKNOWN_HANDLE: i32 = -1;
pub(crate) const ERR_INVALID: i32 = -3;

enum Role {
    Host(Host),
    Client(Client),
}

struct Entry {
    role: Role,
    events: Mutex<mpsc::Receiver<Vec<u8>>>,
}

fn registry() -> &'static Mutex<HashMap<u64, Arc<Entry>>> {
    static REG: OnceLock<Mutex<HashMap<u64, Arc<Entry>>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

fn insert(role: Role, rx: mpsc::Receiver<Vec<u8>>) -> u64 {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let entry = Arc::new(Entry {
        role,
        events: Mutex::new(rx),
    });
    registry().lock().unwrap().insert(id, entry);
    id
}

fn entry(id: u64) -> Option<Arc<Entry>> {
    registry().lock().unwrap().get(&id).cloned()
}

fn with_host<T>(id: u64, fallback: T, f: impl FnOnce(&Host) -> T) -> T {
    match entry(id).as_deref() {
        Some(Entry {
            role: Role::Host(h),
            ..
        }) => f(h),
        _ => fallback,
    }
}

fn with_client<T>(id: u64, fallback: T, f: impl FnOnce(&Client) -> T) -> T {
    match entry(id).as_deref() {
        Some(Entry {
            role: Role::Client(c),
            ..
        }) => f(c),
        _ => fallback,
    }
}

fn guard<T>(fallback: T, f: impl FnOnce() -> T) -> T {
    catch_unwind(AssertUnwindSafe(f)).unwrap_or(fallback)
}

pub(crate) fn host_start(config_json: &str) -> Result<u64, String> {
    let config: HostConfig =
        serde_json::from_str(config_json).map_err(|e| format!("host config is invalid: {e}"))?;
    let (events, rx) = Events::channel();
    let host = runtime().block_on(Host::start(config, events))?;
    Ok(insert(Role::Host(host), rx))
}

pub(crate) fn client_start(config_json: &str) -> Result<u64, String> {
    let config: EndpointConfig =
        serde_json::from_str(config_json).map_err(|e| format!("client config is invalid: {e}"))?;
    let (events, rx) = Events::channel();
    let client = runtime().block_on(Client::start(config, events))?;
    Ok(insert(Role::Client(client), rx))
}

pub(crate) fn client_connect(id: u64, request_json: &str) -> i32 {
    let Ok(request) = serde_json::from_str::<ConnectRequest>(request_json) else {
        return ERR_INVALID;
    };
    with_client(id, ERR_UNKNOWN_HANDLE, |c| {
        let _guard = runtime().enter();
        c.connect(request);
        client::SEND_OK
    })
}

pub(crate) fn client_disconnect(id: u64) {
    with_client(id, (), |c| c.disconnect());
}

pub(crate) fn client_send_control(id: u64, json: &[u8]) -> i32 {
    with_client(id, ERR_UNKNOWN_HANDLE, |c| c.send_control(json))
}

pub(crate) fn client_send_input(id: u64, data: &[u8]) -> i32 {
    with_client(id, ERR_UNKNOWN_HANDLE, |c| c.send_input(data))
}

/// `None` on timeout; a lone `EVENT_CLOSED` byte once the handle is stopped.
pub(crate) fn next_event(id: u64, timeout_ms: u32) -> Option<Vec<u8>> {
    let Some(entry) = entry(id) else {
        return Some(vec![EVENT_CLOSED]);
    };
    let rx = entry.events.lock().unwrap();
    match rx.recv_timeout(Duration::from_millis(u64::from(timeout_ms))) {
        Ok(event) => Some(event),
        Err(mpsc::RecvTimeoutError::Timeout) => None,
        Err(mpsc::RecvTimeoutError::Disconnected) => Some(vec![EVENT_CLOSED]),
    }
}

pub(crate) fn stop(id: u64) {
    let Some(entry) = registry().lock().unwrap().remove(&id) else {
        return;
    };
    runtime().block_on(async {
        match &entry.role {
            Role::Host(h) => h.close().await,
            Role::Client(c) => c.close().await,
        }
    });
}

unsafe fn read(ptr: *const c_char) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    Some(CStr::from_ptr(ptr).to_string_lossy().into_owned())
}

unsafe fn slice<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if ptr.is_null() || len == 0 {
        return &[];
    }
    std::slice::from_raw_parts(ptr, len)
}

fn into_raw(s: String) -> *mut c_char {
    CString::new(s)
        .map(CString::into_raw)
        .unwrap_or(std::ptr::null_mut())
}

unsafe fn start_with(
    config: *const c_char,
    error_out: *mut *mut c_char,
    f: fn(&str) -> Result<u64, String>,
) -> u64 {
    let result = guard(Err("tetra core panicked".into()), || {
        f(&read(config).unwrap_or_default())
    });
    match result {
        Ok(id) => id,
        Err(e) => {
            if !error_out.is_null() {
                *error_out = into_raw(e);
            }
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn tetra_generate_secret_key() -> *mut c_char {
    into_raw(net::generate_secret_key())
}

/// # Safety
/// `secret_key_hex` must be null or a valid NUL-terminated string.
#[no_mangle]
pub unsafe extern "C" fn tetra_endpoint_id(secret_key_hex: *const c_char) -> *mut c_char {
    match read(secret_key_hex)
        .as_deref()
        .and_then(net::endpoint_id_for)
    {
        Some(id) => into_raw(id),
        None => std::ptr::null_mut(),
    }
}

/// The endpoint id an iroh ticket dials, or null when it isn't a ticket or id.
///
/// # Safety
/// `ticket` must be null or a valid NUL-terminated string.
#[no_mangle]
pub unsafe extern "C" fn tetra_ticket_endpoint_id(ticket: *const c_char) -> *mut c_char {
    let ticket = read(ticket).unwrap_or_default();
    match net::parse_addr(Some(&ticket), &ticket) {
        Ok(addr) => into_raw(addr.id.to_string()),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Blocks until the endpoint is bound. Returns 0 and sets `error_out` on failure.
///
/// # Safety
/// `config_json` must be null or a valid NUL-terminated string; `error_out`
/// must be null or point to writable storage.
#[no_mangle]
pub unsafe extern "C" fn tetra_host_start(
    config_json: *const c_char,
    error_out: *mut *mut c_char,
) -> u64 {
    start_with(config_json, error_out, host_start)
}

#[no_mangle]
pub extern "C" fn tetra_host_ticket(id: u64) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        with_host(id, std::ptr::null_mut(), |h| into_raw(h.ticket()))
    })
}

/// # Safety
/// `ids_json` must be null or a valid NUL-terminated JSON array of strings.
#[no_mangle]
pub unsafe extern "C" fn tetra_host_set_trusted(id: u64, ids_json: *const c_char) {
    let ids: Vec<String> = read(ids_json)
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    guard((), || with_host(id, (), |h| h.set_trusted(ids)));
}

/// # Safety
/// `secret` must be null or a valid NUL-terminated string.
#[no_mangle]
pub unsafe extern "C" fn tetra_host_set_pairing_secret(id: u64, secret: *const c_char) {
    let secret = read(secret);
    guard((), || with_host(id, (), |h| h.set_pairing_secret(secret)));
}

/// # Safety
/// `json` must be null or a valid NUL-terminated string.
#[no_mangle]
pub unsafe extern "C" fn tetra_host_send_control(id: u64, json: *const c_char) -> i32 {
    let Some(json) = read(json) else {
        return ERR_INVALID;
    };
    guard(ERR_INVALID, || {
        with_host(id, ERR_UNKNOWN_HANDLE, |h| h.send_control(json.as_bytes()))
    })
}

/// Returns 0 when queued, 1 when dropped (force a keyframe next), -2 with no peer.
///
/// # Safety
/// `data` must be null or point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn tetra_host_send_video(
    id: u64,
    pts_us: u64,
    flags: u8,
    data: *const u8,
    len: usize,
) -> i32 {
    let data = slice(data, len);
    guard(ERR_INVALID, || {
        with_host(id, ERR_UNKNOWN_HANDLE, |h| {
            h.send_video(pts_us, flags, data)
        })
    })
}

/// # Safety
/// `data` must be null or point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn tetra_host_send_audio(
    id: u64,
    pts_us: u64,
    data: *const u8,
    len: usize,
) -> i32 {
    let data = slice(data, len);
    guard(ERR_INVALID, || {
        with_host(id, ERR_UNKNOWN_HANDLE, |h| h.send_audio(pts_us, data))
    })
}

#[no_mangle]
pub extern "C" fn tetra_host_video_backlog(id: u64) -> u32 {
    guard(0, || with_host(id, 0, |h| h.backlog()))
}

#[no_mangle]
pub extern "C" fn tetra_host_disconnect_peer(id: u64) {
    guard((), || with_host(id, (), |h| h.disconnect_peer()));
}

/// # Safety
/// Same contract as `tetra_host_start`.
#[no_mangle]
pub unsafe extern "C" fn tetra_client_start(
    config_json: *const c_char,
    error_out: *mut *mut c_char,
) -> u64 {
    start_with(config_json, error_out, client_start)
}

/// # Safety
/// `request_json` must be null or a valid NUL-terminated string.
#[no_mangle]
pub unsafe extern "C" fn tetra_client_connect(id: u64, request_json: *const c_char) -> i32 {
    let Some(request) = read(request_json) else {
        return ERR_INVALID;
    };
    guard(ERR_INVALID, || client_connect(id, &request))
}

#[no_mangle]
pub extern "C" fn tetra_client_disconnect(id: u64) {
    guard((), || client_disconnect(id));
}

/// # Safety
/// `json` must be null or a valid NUL-terminated string.
#[no_mangle]
pub unsafe extern "C" fn tetra_client_send_control(id: u64, json: *const c_char) -> i32 {
    let Some(json) = read(json) else {
        return ERR_INVALID;
    };
    guard(ERR_INVALID, || client_send_control(id, json.as_bytes()))
}

/// # Safety
/// `data` must be null or point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn tetra_client_send_input(id: u64, data: *const u8, len: usize) -> i32 {
    let data = slice(data, len);
    guard(ERR_INVALID, || client_send_input(id, data))
}

/// Returns null on timeout. The buffer's first byte is the event kind.
///
/// # Safety
/// `len_out` must point to writable storage.
#[no_mangle]
pub unsafe extern "C" fn tetra_next_event(
    id: u64,
    timeout_ms: u32,
    len_out: *mut usize,
) -> *mut u8 {
    let event = guard(Some(vec![EVENT_CLOSED]), || next_event(id, timeout_ms));
    let Some(event) = event else {
        return std::ptr::null_mut();
    };
    let boxed = event.into_boxed_slice();
    if !len_out.is_null() {
        *len_out = boxed.len();
    }
    Box::into_raw(boxed) as *mut u8
}

#[no_mangle]
pub extern "C" fn tetra_stop(id: u64) {
    guard((), || stop(id));
}

/// # Safety
/// `ptr`/`len` must come from `tetra_next_event` and be freed once.
#[no_mangle]
pub unsafe extern "C" fn tetra_bytes_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
    }
}

/// # Safety
/// `s` must come from this library and be freed once.
#[no_mangle]
pub unsafe extern "C" fn tetra_string_free(s: *mut c_char) {
    if !s.is_null() {
        drop(CString::from_raw(s));
    }
}
