/// 128 random bits as 32 hex characters: the secret in this computer's shared link.
pub fn new_secret() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect("the OS random source failed");
    tetra_core::protocol::hex_encode(&bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn makes_fresh_hex_secrets() {
        let (a, b) = (new_secret(), new_secret());
        assert_eq!(a.len(), 32);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }
}
