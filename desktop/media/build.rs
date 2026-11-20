//! screencapturekit's Swift bridge links `@rpath/libswift_Concurrency.dylib`,
//! and a dependency's build script can't give rpaths to the binaries that link
//! it. This covers this package's tests and examples; the app's own build adds the same.

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
}
