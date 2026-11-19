use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
pub struct Paragraph {
    pub text: String,
    pub start_char: usize,
    pub end_char: usize,
    pub heading: Option<String>,
}

pub fn sha256_hex(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

pub fn truncate_chars(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let mut out: String = text.chars().take(limit).collect();
    out.push('…');
    out
}

pub fn split_paragraphs(text: &str) -> Vec<Paragraph> {
    let mut paragraphs: Vec<Paragraph> = Vec::new();
    let mut heading: Option<String> = None;
    let mut current_start: Option<usize> = None;
    let mut current_end = 0usize;
    let mut char_pos = 0usize;

    let mut flush = |start: usize, end: usize, heading: &Option<String>| {
        if end <= start {
            return;
        }
        let raw: String = text.chars().skip(start).take(end - start).collect();
        let trimmed_start = raw.chars().take_while(|c| c.is_whitespace()).count();
        let trimmed_end_ws = raw.chars().rev().take_while(|c| c.is_whitespace()).count();
        if raw.chars().count() <= trimmed_start + trimmed_end_ws {
            return;
        }
        let clean: String = raw
            .chars()
            .skip(trimmed_start)
            .take(raw.chars().count() - trimmed_start - trimmed_end_ws)
            .collect();
        paragraphs.push(Paragraph {
            text: clean,
            start_char: start + trimmed_start,
            end_char: end - trimmed_end_ws,
            heading: heading.clone(),
        });
    };

    for line in text.split_inclusive('\n') {
        let line_len = line.chars().count();
        let bare = line.trim_end_matches(['\r', '\n']);
        if bare.trim().is_empty() {
            if let Some(start) = current_start.take() {
                flush(start, current_end, &heading);
            }
            char_pos += line_len;
            continue;
        }
        if let Some(stripped) = bare.trim_start().strip_prefix('#') {
            let title = stripped.trim_start_matches('#').trim().to_string();
            if !title.is_empty() {
                if let Some(start) = current_start.take() {
                    flush(start, current_end, &heading);
                }
                heading = Some(title);
                char_pos += line_len;
                continue;
            }
        }
        if current_start.is_none() {
            current_start = Some(char_pos);
        }
        current_end = char_pos + bare.chars().count();
        char_pos += line_len;
    }
    if let Some(start) = current_start.take() {
        flush(start, current_end, &heading);
    }

    // Long blocks are split at sentence boundaries so one citation never swallows a whole page.
    let mut out = Vec::new();
    for p in paragraphs {
        if p.text.chars().count() <= 1400 {
            out.push(p);
            continue;
        }
        let mut buf = String::new();
        let mut buf_start = p.start_char;
        let mut cursor = p.start_char;
        for ch in p.text.chars() {
            buf.push(ch);
            cursor += 1;
            let boundary = matches!(ch, '。' | '！' | '？' | '.' | '!' | '?' | '\n');
            if boundary && buf.chars().count() >= 450 {
                let trimmed = buf.trim();
                if !trimmed.is_empty() {
                    let lead = buf.chars().take_while(|c| c.is_whitespace()).count();
                    let trail = buf.chars().rev().take_while(|c| c.is_whitespace()).count();
                    out.push(Paragraph {
                        text: trimmed.to_string(),
                        start_char: buf_start + lead,
                        end_char: cursor - trail,
                        heading: p.heading.clone(),
                    });
                }
                buf_start = cursor;
                buf.clear();
            }
        }
        let trimmed = buf.trim();
        if !trimmed.is_empty() {
            let lead = buf.chars().take_while(|c| c.is_whitespace()).count();
            let trail = buf.chars().rev().take_while(|c| c.is_whitespace()).count();
            out.push(Paragraph {
                text: trimmed.to_string(),
                start_char: buf_start + lead,
                end_char: cursor - trail,
                heading: p.heading.clone(),
            });
        }
    }
    out
}

pub fn char_index_to_utf16(text: &str, char_index: usize) -> usize {
    text.chars().take(char_index).map(|c| c.len_utf16()).sum()
}

pub fn slice_utf16(text: &str, start: usize, end: usize) -> Option<String> {
    if end < start {
        return None;
    }
    let mut pos = 0usize;
    let mut out = String::new();
    let mut start_ok = start == 0;
    let mut end_ok = end == 0;
    for ch in text.chars() {
        let next = pos + ch.len_utf16();
        if pos == start {
            start_ok = true;
        }
        if next == end {
            end_ok = true;
        }
        if pos >= start && next <= end {
            out.push(ch);
        }
        pos = next;
        if pos >= end {
            break;
        }
    }
    if !start_ok || !end_ok {
        return None;
    }
    Some(out)
}

pub fn context_around(text: &str, start_utf16: usize, end_utf16: usize, context: usize) -> (String, String) {
    let total = utf16_len(text);
    let left_start = start_utf16.saturating_sub(context);
    let right_end = (end_utf16 + context).min(total);
    let prefix = slice_utf16(text, left_start, start_utf16).unwrap_or_default();
    let suffix = slice_utf16(text, end_utf16, right_end).unwrap_or_default();
    (prefix, suffix)
}

pub fn resolve_quote(
    haystack: &str,
    exact: &str,
    prefix: &str,
    suffix: &str,
    hint_start: i64,
) -> Option<(usize, usize)> {
    if exact.trim().is_empty() {
        return None;
    }
    let hay: Vec<u16> = haystack.encode_utf16().collect();
    let needle: Vec<u16> = exact.encode_utf16().collect();
    if needle.len() > hay.len() {
        return None;
    }
    let pre: Vec<u16> = prefix.encode_utf16().collect();
    let suf: Vec<u16> = suffix.encode_utf16().collect();
    let mut best: Option<(i64, usize, usize)> = None;

    for start in 0..=(hay.len() - needle.len()) {
        if hay[start..start + needle.len()] != needle[..] {
            continue;
        }
        let mut score = 0i64;
        if !pre.is_empty() {
            let avail = start.min(pre.len());
            if avail > 0 && hay[start - avail..start] == pre[pre.len() - avail..] {
                score += 40 + avail as i64;
            } else {
                score -= 20;
            }
        }
        if !suf.is_empty() {
            let after = start + needle.len();
            let avail = (hay.len() - after).min(suf.len());
            if avail > 0 && hay[after..after + avail] == suf[..avail] {
                score += 40 + avail as i64;
            } else {
                score -= 20;
            }
        }
        if hint_start >= 0 {
            let distance = (start as i64 - hint_start).abs();
            score += (120 - distance.min(120)).max(0);
        }
        if best.map(|(s, _, _)| score > s).unwrap_or(true) {
            best = Some((score, start, start + needle.len()));
        }
    }
    best.map(|(_, start, end)| (start, end))
}

/// Anki's text importer treats tabs and newlines as field separators. Keep one
/// card per row by escaping them into HTML-safe equivalents.
pub fn anki_field(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('\t', "    ")
        .replace("\r\n", "<br>")
        .replace('\n', "<br>")
        .replace('\r', "<br>")
}

pub fn first_sentence(text: &str, limit: usize) -> String {
    let trimmed = text.trim();
    let mut out = String::new();
    for ch in trimmed.chars() {
        out.push(ch);
        if matches!(ch, '。' | '！' | '？' | '.' | '!' | '?') && out.chars().count() >= 12 {
            break;
        }
        if out.chars().count() >= limit {
            break;
        }
    }
    if out.chars().count() < trimmed.chars().count() {
        out.push('…');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_paragraphs_with_offsets() {
        let text = "# 标题\n\n第一段。\n\n第二段。";
        let parts = split_paragraphs(text);
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0].text, "第一段。");
        assert_eq!(parts[0].heading.as_deref(), Some("标题"));
        assert_eq!(parts[1].text, "第二段。");
    }

    #[test]
    fn resolves_duplicate_quotes_with_context() {
        let text = "甲。重复句子。乙。重复句子。丙。";
        let (start, end) = resolve_quote(text, "重复句子。", "乙。", "丙。", 0).unwrap();
        assert_eq!(slice_utf16(text, start, end).unwrap(), "重复句子。");
        assert_eq!(start, utf16_len("甲。重复句子。乙。"));
    }

    #[test]
    fn handles_utf16_offsets() {
        let text = "a😀b";
        assert_eq!(utf16_len(text), 4);
        assert_eq!(slice_utf16(text, 1, 3), Some("😀".to_string()));
        assert_eq!(slice_utf16(text, 1, 2), None);
    }

    #[test]
    fn anki_field_keeps_rows_intact() {
        assert_eq!(anki_field("a\tb\nc<d>"), "a    b<br>c&lt;d&gt;");
    }
}
