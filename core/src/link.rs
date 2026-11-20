//! The link a computer shares, `https://remote.tetramote.com/#id=…&secret=…&name=…`. Everything after `#` stays
//! in the browser, so the secret never reaches the web server; changing the format breaks every shared link.

pub const ORIGIN: &str = "https://remote.tetramote.com/";
const HOST: &str = "remote.tetramote.com";
const DEFAULT_NAME: &str = "Computer";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Link {
    pub endpoint_id: String,
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

fn hex_of_len(s: &str, len: usize) -> Option<String> {
    (s.len() == len && s.bytes().all(|b| b.is_ascii_hexdigit())).then(|| s.to_ascii_lowercase())
}

pub fn make(endpoint_id: &str, secret: &str, name: &str) -> String {
    format!(
        "{ORIGIN}#id={endpoint_id}&secret={secret}&name={}",
        encode(name)
    )
}

/// Accepts the link with or without its scheme or trailing slash; anything else is `None`.
pub fn parse(text: &str) -> Option<Link> {
    let text = text.trim();
    let rest = text
        .strip_prefix("https://")
        .or_else(|| text.strip_prefix("http://"))
        .unwrap_or(text);
    let (location, fragment) = rest.split_once('#')?;
    if !location.trim_end_matches('/').eq_ignore_ascii_case(HOST) {
        return None;
    }
    let (mut id, mut secret, mut name) = (None, None, None);
    for part in fragment.split('&') {
        let (key, value) = part.split_once('=')?;
        let value = decode(value)?;
        match key {
            "id" => id = hex_of_len(&value, 64),
            "secret" => secret = hex_of_len(&value, 32),
            "name" => name = Some(value),
            _ => {}
        }
    }
    Some(Link {
        endpoint_id: id?,
        secret: secret?,
        name: name
            .map(|n| n.trim().to_string())
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| DEFAULT_NAME.into()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "20335dac186d6285c52b0dbe2f7b91a73dadbea6abe08d6e9aa777fe2bfe99e5";
    const SECRET: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn makes_and_parses_a_link() {
        let link = make(ID, SECRET, "Fosse’s Mac");
        assert_eq!(
            link,
            "https://remote.tetramote.com/#id=20335dac186d6285c52b0dbe2f7b91a73dadbea6abe08d6e9aa777fe2bfe99e5&secret=0123456789abcdef0123456789abcdef&name=Fosse%E2%80%99s%20Mac"
        );
        assert_eq!(
            parse(&link),
            Some(Link {
                endpoint_id: ID.into(),
                secret: SECRET.into(),
                name: "Fosse’s Mac".into(),
            })
        );
    }

    #[test]
    fn accepts_loose_forms_and_defaults_the_name() {
        let upper = format!(
            "  remote.tetramote.com#id={}&secret={}  ",
            ID.to_uppercase(),
            SECRET.to_uppercase()
        );
        let parsed = parse(&upper).unwrap();
        assert_eq!(parsed.endpoint_id, ID);
        assert_eq!(parsed.secret, SECRET);
        assert_eq!(parsed.name, "Computer");
    }

    #[test]
    fn rejects_other_hosts_and_malformed_values() {
        assert_eq!(
            parse(&format!("https://example.com/#id={ID}&secret={SECRET}")),
            None
        );
        assert_eq!(
            parse(&format!(
                "https://remote.tetramote.com/?id={ID}&secret={SECRET}"
            )),
            None
        );
        assert_eq!(
            parse(&format!("https://remote.tetramote.com/#id={ID}")),
            None
        );
        assert_eq!(
            parse(&format!(
                "https://remote.tetramote.com/#id=abc&secret={SECRET}"
            )),
            None
        );
        assert_eq!(
            parse(&format!("https://remote.tetramote.com/#id={ID}&secret=xyz")),
            None
        );
        assert_eq!(
            parse(&format!(
                "https://remote.tetramote.com/#id={ID}&secret={SECRET}&name=%E0%A4%A"
            )),
            None
        );
        assert_eq!(
            parse("tetramote://pair?ticket=t&secret=0123456789abcdef0123456789abcdef"),
            None
        );
    }
}
