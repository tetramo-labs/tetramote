//! Text-only clipboard sync. What the other side sent is never echoed back.

const MAX_BYTES: usize = 512 * 1024;

pub fn read() -> Option<String> {
    let text = arboard::Clipboard::new().ok()?.get_text().ok()?;
    if text.is_empty() {
        return None;
    }
    let mut end = text.len().min(MAX_BYTES);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    Some(text[..end].to_string())
}

#[derive(Default)]
pub struct Watcher {
    seen: Option<String>,
    written: Option<String>,
}

impl Watcher {
    pub fn new() -> Self {
        Self::default()
    }

    /// Forgets earlier text so only copies made from now on are sent.
    pub fn reset(&mut self) {
        self.seen = read();
    }

    pub fn write(&mut self, text: &str) {
        if let Ok(mut clipboard) = arboard::Clipboard::new() {
            if clipboard.set_text(text.to_string()).is_ok() {
                self.written = Some(text.to_string());
                self.seen = Some(text.to_string());
            }
        }
    }

    /// The clipboard's text when it changed since the last call and didn't come from the other side.
    pub fn changed(&mut self) -> Option<String> {
        let current = read()?;
        if self.seen.as_deref() == Some(current.as_str()) {
            return None;
        }
        self.seen = Some(current.clone());
        (self.written.as_deref() != Some(current.as_str())).then_some(current)
    }
}
