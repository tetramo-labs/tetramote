/* tslint:disable */
/* eslint-disable */
/**
 * The `ReadableStreamType` enum.
 *
 * *This API requires the following crate features to be activated: `ReadableStreamType`*
 */

export type ReadableStreamType = "bytes";

export class IntoUnderlyingByteSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableByteStreamController): Promise<any>;
    start(controller: ReadableByteStreamController): void;
    readonly autoAllocateChunkSize: number;
    readonly type: ReadableStreamType;
}

export class IntoUnderlyingSink {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    abort(reason: any): Promise<any>;
    close(): Promise<any>;
    write(chunk: any): Promise<any>;
}

export class IntoUnderlyingSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableStreamDefaultController): Promise<any>;
}

export class Session {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Ends any session and shuts the endpoint down, closing its relay connections.
     */
    close(): void;
    /**
     * Replaces any current session. Progress arrives as `connecting`, `connected`, `path`, `rejected` and
     * `disconnected` state events.
     */
    connect(endpoint_id: string, secret: string, device_name: string): void;
    disconnect(): void;
    send_control(json: Uint8Array | number[]): boolean;
    send_input(records: Uint8Array | number[]): boolean;
    /**
     * Binds an endpoint with a fresh key for this page; `on_event` receives one `Uint8Array` per event.
     */
    static start(on_event: Function): Promise<Session>;
}

/**
 * Sends iroh's logs at `level` (`error` to `trace`) to the browser console, for diagnosing a connection.
 */
export function enable_logs(level: string): void;

/**
 * The macOS virtual key code the wire carries for a DOM `KeyboardEvent.code`, from the desktop app's key table.
 */
export function mac_key_code(dom_code: string): number | undefined;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_intounderlyingbytesource_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingsink_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingsource_free: (a: number, b: number) => void;
    readonly __wbg_session_free: (a: number, b: number) => void;
    readonly enable_logs: (a: number, b: number) => void;
    readonly intounderlyingbytesource_autoAllocateChunkSize: (a: number) => number;
    readonly intounderlyingbytesource_cancel: (a: number) => void;
    readonly intounderlyingbytesource_pull: (a: number, b: any) => any;
    readonly intounderlyingbytesource_start: (a: number, b: any) => void;
    readonly ring_core_0_17_14__bn_mul_mont: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly intounderlyingbytesource_type: (a: number) => number;
    readonly intounderlyingsink_abort: (a: number, b: any) => any;
    readonly intounderlyingsink_close: (a: number) => any;
    readonly intounderlyingsink_write: (a: number, b: any) => any;
    readonly intounderlyingsource_cancel: (a: number) => void;
    readonly intounderlyingsource_pull: (a: number, b: any) => any;
    readonly mac_key_code: (a: number, b: number) => number;
    readonly session_close: (a: number) => void;
    readonly session_connect: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly session_disconnect: (a: number) => void;
    readonly session_send_control: (a: number, b: number, c: number) => number;
    readonly session_send_input: (a: number, b: number, c: number) => number;
    readonly session_start: (a: any) => any;
    readonly wasm_bindgen__convert__closures_____invoke__h65bed247143c9091: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__hb8c07f1ccfa22477: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h9ac4399d5492a1d4: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h9ac4399d5492a1d4_21: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h9ac4399d5492a1d4_22: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h55e88be20c327abd: (a: number, b: number) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h77eadcd93fd2f5ce: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
