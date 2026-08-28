use wasm_bindgen::prelude::*;

const API_VERSION: u32 = 1;
const FNV_OFFSET_BASIS: u32 = 0x811c_9dc5;
const FNV_PRIME: u32 = 0x0100_0193;

fn fnv1a32(value: &str) -> u32 {
    value
        .as_bytes()
        .iter()
        .fold(FNV_OFFSET_BASIS, |hash, byte| {
            (hash ^ u32::from(*byte)).wrapping_mul(FNV_PRIME)
        })
}

/// Versioned browser boundary for the experimental GitInspect WebAssembly runtime.
#[wasm_bindgen]
pub fn api_version() -> u32 {
    API_VERSION
}

/// Cross-language deterministic proof that the Rust/WASM module is executing.
#[wasm_bindgen]
pub fn runtime_fingerprint(value: &str) -> String {
    format!("{:08x}", fnv1a32(value))
}

/// Keep capability claims explicit: repository authority is still native-only.
#[wasm_bindgen]
pub fn capabilities_json() -> String {
    concat!(
        "{",
        "\"runtime\":\"rust-wasm\",",
        "\"repositoryMode\":\"synthetic\",",
        "\"nativeGit\":false,",
        "\"filesystemWatch\":false,",
        "\"mutationAuthority\":false",
        "}"
    )
    .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_is_stable_and_matches_browser_demo_path() {
        assert_eq!(runtime_fingerprint("/demo/gitinspect"), "00413b2e");
    }

    #[test]
    fn capability_contract_remains_fail_closed() {
        let capabilities = capabilities_json();
        assert!(capabilities.contains("\"nativeGit\":false"));
        assert!(capabilities.contains("\"mutationAuthority\":false"));
    }
}
