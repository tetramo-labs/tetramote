//! Ogg Opus demuxing (RFC 3533 pages, RFC 7845 headers) for `--opus`. Expects
//! a single logical stream, as ffmpeg writes it, and does not check page CRCs.

const PAGE_HEADER_LEN: usize = 27;

/// Returns the file's audio packets in order, without its OpusHead and
/// OpusTags header packets.
pub fn opus_packets(data: &[u8]) -> Result<Vec<Vec<u8>>, String> {
    let mut packets = Vec::new();
    let mut current = Vec::new();
    let mut at = 0;
    while at < data.len() {
        let header = data
            .get(at..at + PAGE_HEADER_LEN)
            .filter(|h| h.starts_with(b"OggS"))
            .ok_or_else(|| {
                format!("no Ogg page starts at byte {at}; pass an .ogg file encoded with libopus")
            })?;
        let lacing_end = at + PAGE_HEADER_LEN + header[26] as usize;
        let lacing = data
            .get(at + PAGE_HEADER_LEN..lacing_end)
            .ok_or("the last Ogg page is cut short; encode the file again")?;
        let mut body = lacing_end;
        for &len in lacing {
            let segment = data
                .get(body..body + len as usize)
                .ok_or("the last Ogg page is cut short; encode the file again")?;
            current.extend_from_slice(segment);
            body += len as usize;
            if len < 255 {
                packets.push(std::mem::take(&mut current));
            }
        }
        at = body;
    }
    let headers_ok = packets.len() > 2
        && packets[0].starts_with(b"OpusHead")
        && packets[1].starts_with(b"OpusTags");
    if !headers_ok {
        return Err("the file is not Ogg Opus with audio; make one with the ffmpeg command in fakehost's header".into());
    }
    Ok(packets.split_off(2))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(flags: u8, lacing: &[u8], body: &[u8]) -> Vec<u8> {
        let mut out = b"OggS".to_vec();
        out.extend_from_slice(&[0, flags]);
        out.extend_from_slice(&[0; 20]);
        out.push(lacing.len() as u8);
        out.extend_from_slice(lacing);
        out.extend_from_slice(body);
        out
    }

    fn headers() -> Vec<u8> {
        [
            page(0x02, &[9], b"OpusHead\x01"),
            page(0x00, &[8], b"OpusTags"),
        ]
        .concat()
    }

    #[test]
    fn skips_headers_and_joins_packets_across_pages() {
        let mut first = vec![0xfc, 0xaa];
        first.extend_from_slice(&[0x11; 255]);
        let file = [
            headers(),
            page(0x00, &[2, 255], &first),
            page(0x01, &[1, 3], &[0x22, 0xfc, 0x01, 0x02]),
        ]
        .concat();
        let mut joined = vec![0x11; 255];
        joined.push(0x22);
        assert_eq!(
            opus_packets(&file),
            Ok(vec![vec![0xfc, 0xaa], joined, vec![0xfc, 0x01, 0x02]])
        );
    }

    #[test]
    fn a_packet_of_exactly_255_bytes_ends_on_a_zero_lacing_value() {
        let file = [headers(), page(0x04, &[255, 0], &[0x33; 255])].concat();
        assert_eq!(opus_packets(&file), Ok(vec![vec![0x33; 255]]));
    }

    #[test]
    fn rejects_files_that_are_not_ogg_opus() {
        assert!(opus_packets(b"ID3\x04 not an ogg file at all").is_err());
        assert!(opus_packets(&headers()).is_err());
        let vorbis = [
            page(0x02, &[7], b"\x01vorbis"),
            page(0x00, &[7], b"\x03vorbis"),
            page(0x00, &[1], &[0]),
        ]
        .concat();
        assert!(opus_packets(&vorbis).is_err());
        let mut cut = [headers(), page(0x00, &[4], &[1, 2, 3, 4])].concat();
        cut.truncate(cut.len() - 1);
        assert!(opus_packets(&cut).is_err());
    }
}
