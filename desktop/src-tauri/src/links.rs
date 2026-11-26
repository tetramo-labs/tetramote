//! The pairing-links file the phone app exports and imports, so computers move between apps in one file.

use std::collections::BTreeMap;

use serde_json::{json, Value};
use tetra_core::link::{self, Link};

use crate::store::SavedHost;

const FORMAT: &str = "tetramote-links";

/// Only computers this one still has a link secret for can be paired again from a link.
pub fn links_json(hosts: &[SavedHost], now_secs: u64) -> (String, usize) {
    let computers: Vec<Value> = hosts
        .iter()
        .filter_map(|h| {
            let secret = h.secret.as_deref()?;
            Some(json!({"name": h.name, "link": link::make(&h.id, secret, &h.name)}))
        })
        .collect();
    let count = computers.len();
    let file = json!({
        "format": FORMAT,
        "version": 1,
        "exportedAt": iso_time(now_secs),
        "computers": computers,
    });
    (serde_json::to_string_pretty(&file).unwrap_or_default(), count)
}

/// Reads an export, or any JSON array of links or `{link}` objects, keeping each computer once.
pub fn parse_links_json(text: &str) -> Vec<Link> {
    let Ok(data) = serde_json::from_str::<Value>(text) else {
        return Vec::new();
    };
    let items = match &data {
        Value::Array(items) => items.as_slice(),
        Value::Object(o) => o.get("computers").and_then(Value::as_array).map_or(&[][..], Vec::as_slice),
        _ => &[],
    };
    let mut links = BTreeMap::new();
    for item in items {
        let text = item.as_str().or_else(|| item["link"].as_str());
        if let Some(parsed) = text.and_then(link::parse) {
            links.insert(parsed.endpoint_id.clone(), parsed);
        }
    }
    links.into_values().collect()
}

fn iso_time(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3_600,
        rem % 3_600 / 60,
        rem % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "485289a4584a8f7a3cfa343ecd789255c7b64ce695c7d03e380400f453c2f7f9";
    const SECRET: &str = "4dc215f39eb7132244151cb286cc4e0b";

    fn host(secret: Option<&str>) -> SavedHost {
        SavedHost {
            id: ID.into(),
            name: "bob".into(),
            ticket: String::new(),
            last_connected_at: None,
            secret: secret.map(String::from),
        }
    }

    #[test]
    fn exports_only_computers_with_a_secret_and_reads_them_back() {
        let (json, count) = links_json(&[host(Some(SECRET)), host(None)], 1_795_000_000);
        assert_eq!(count, 1);
        assert!(json.contains("\"format\": \"tetramote-links\""));
        assert!(json.contains("2026-11-18T"));
        let links = parse_links_json(&json);
        assert_eq!(links.len(), 1);
        assert_eq!((links[0].endpoint_id.as_str(), links[0].secret.as_str()), (ID, SECRET));
    }

    #[test]
    fn reads_plain_arrays_and_skips_junk() {
        let url = link::make(ID, SECRET, "bob");
        let text = serde_json::to_string(&json!([url, {"link": url}, "nope", 3])).unwrap();
        assert_eq!(parse_links_json(&text).len(), 1);
        assert!(parse_links_json("not json").is_empty());
    }

    #[test]
    fn formats_dates_in_utc() {
        assert_eq!(iso_time(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_time(951_782_400), "2000-02-29T00:00:00Z");
    }
}
