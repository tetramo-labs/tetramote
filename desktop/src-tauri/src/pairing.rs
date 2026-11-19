#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairingLink {
    pub ticket: String,
    pub secret: String,
    pub name: String,
}

const UNRESERVED: &[u8] = b"-_.~";

fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || UNRESERVED.contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

fn decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// The QR code and "Copy link" text: `tetratop://pair?ticket=…&secret=…&name=…`.
pub fn make(ticket: &str, secret: &str, name: &str) -> String {
    format!(
        "tetratop://pair?ticket={}&secret={}&name={}",
        encode(ticket),
        secret,
        encode(name)
    )
}

pub fn parse(link: &str) -> Option<PairingLink> {
    let query = link.trim().strip_prefix("tetratop://pair?")?;
    let mut ticket = None;
    let mut secret = None;
    let mut name = None;
    for part in query.split('&') {
        let (key, value) = part.split_once('=')?;
        let value = decode(value)?;
        match key {
            "ticket" => ticket = Some(value),
            "secret" => secret = Some(value.to_ascii_lowercase()),
            "name" => name = Some(value),
            _ => {}
        }
    }
    let secret = secret.filter(|s| s.len() == 32 && s.bytes().all(|b| b.is_ascii_hexdigit()))?;
    Some(PairingLink {
        ticket: ticket.filter(|t| !t.is_empty())?,
        secret,
        name: name
            .filter(|n| !n.trim().is_empty())
            .unwrap_or_else(|| "Computer".into()),
    })
}

/// 128 random bits as 32 hex characters; spent by the first device that pairs.
pub fn new_secret() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect("the OS random source failed");
    tetra_core::protocol::hex_encode(&bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn makes_and_parses_a_link() {
        let link = make(
            "endpointabc",
            "0123456789abcdef0123456789abcdef",
            "Fosse’s Mac",
        );
        assert_eq!(
            link,
            "tetratop://pair?ticket=endpointabc&secret=0123456789abcdef0123456789abcdef&name=Fosse%E2%80%99s%20Mac"
        );
        assert_eq!(
            parse(&link),
            Some(PairingLink {
                ticket: "endpointabc".into(),
                secret: "0123456789abcdef0123456789abcdef".into(),
                name: "Fosse’s Mac".into(),
            })
        );
    }

    #[test]
    fn rejects_other_links_and_bad_secrets() {
        assert_eq!(parse("https://example.com"), None);
        assert_eq!(parse("tetratop://pair?ticket=t&secret=xyz"), None);
        assert_eq!(
            parse("tetratop://pair?secret=0123456789abcdef0123456789abcdef"),
            None
        );
        assert_eq!(
            parse("tetratop://pair?ticket=%E0%A4%A&secret=0123456789abcdef0123456789abcdef"),
            None
        );
    }

    #[test]
    fn defaults_the_name_and_makes_fresh_secrets() {
        let parsed =
            parse("tetratop://pair?ticket=t&secret=0123456789ABCDEF0123456789ABCDEF").unwrap();
        assert_eq!(parsed.name, "Computer");
        assert_eq!(parsed.secret, "0123456789abcdef0123456789abcdef");
        let (a, b) = (new_secret(), new_secret());
        assert_eq!(a.len(), 32);
        assert_ne!(a, b);
    }
}
