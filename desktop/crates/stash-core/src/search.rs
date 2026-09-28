//! On-device creator search (PRD §6). Deterministic: tokenization, aliases,
//! structured filters and BM25 ranking — no model calls (AGENT.md Rule 5).
//!
//! Everything here is derived from the file's name and original relative
//! path. Metadata that needs the payload itself (duration, orientation) is
//! not guessed: queries that ask for it report the phrase as unsupported.

use std::collections::{HashMap, HashSet};

/// One searchable file, as listed by the control plane.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchDoc {
    pub file_id: String,
    pub name: String,
    /// `originalRelativePath`, preserved verbatim (PRD §4.1).
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MediaKind {
    Audio,
    Midi,
    Video,
    Image,
    Document,
    Other,
}

/// A musical key: pitch class 0 (C) … 11 (B), and the mode when known.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MusicalKey {
    pub pitch: u8,
    pub minor: Option<bool>,
}

/// Metadata read from the file name and path only.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FileMetadata {
    pub kind: Option<MediaKind>,
    pub extension: Option<String>,
    pub bpm: Option<u32>,
    pub key: Option<MusicalKey>,
    /// Vertical resolution: 2160 for 4k, 1080 for 1080p, …
    pub resolution: Option<u32>,
    pub fps: Option<u32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedQuery {
    pub terms: Vec<String>,
    pub bpm: Option<(u32, u32)>,
    pub key: Option<MusicalKey>,
    pub resolution: Option<u32>,
    pub fps: Option<u32>,
    /// Phrases that ask for metadata STASH cannot read from names alone.
    pub unsupported: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SearchHit {
    pub file_id: String,
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub score: f64,
    pub metadata: FileMetadata,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SearchResults {
    pub hits: Vec<SearchHit>,
    pub total: usize,
    pub unsupported: Vec<String>,
}

const NOTE_NAMES: [(&str, u8); 7] = [("c", 0), ("d", 2), ("e", 4), ("f", 5), ("g", 7), ("a", 9), ("b", 11)];

fn extension_kind(ext: &str) -> MediaKind {
    match ext {
        "wav" | "aif" | "aiff" | "mp3" | "flac" | "ogg" | "m4a" | "aac" | "rex" | "rx2" => MediaKind::Audio,
        "mid" | "midi" => MediaKind::Midi,
        "mp4" | "mov" | "mkv" | "avi" | "webm" | "m4v" | "mxf" | "braw" | "r3d" => MediaKind::Video,
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "psd" | "ai" | "tif" | "tiff" | "heic" | "exr" => MediaKind::Image,
        "pdf" | "doc" | "docx" | "txt" | "md" | "rtf" | "xls" | "xlsx" | "ppt" | "pptx" => MediaKind::Document,
        _ => MediaKind::Other,
    }
}

/// Words a document of this kind can be found by, so `footage` or `sample`
/// matches files whose names never say so.
fn kind_words(kind: MediaKind) -> &'static [&'static str] {
    match kind {
        MediaKind::Audio => &["audio", "sample"],
        MediaKind::Midi => &["midi"],
        MediaKind::Video => &["video", "footage"],
        MediaKind::Image => &["image", "graphic"],
        MediaKind::Document => &["document"],
        MediaKind::Other => &[],
    }
}

/// Alias normalization (PRD §6.2). Returns the canonical form of a token.
fn canonical(token: &str) -> String {
    let mapped = match token {
        "kicks" => "kick",
        "snares" => "snare",
        "claps" => "clap",
        "hats" | "hihat" | "hihats" | "hh" => "hat",
        "loops" => "loop",
        "vox" | "vocals" | "vocal" => "vocal",
        "fx" | "sfx" | "effects" => "sfx",
        "percs" | "percussion" => "perc",
        "stems" => "stem",
        "oneshot" | "oneshots" | "one-shot" | "one-shots" => "oneshot",
        "luts" => "lut",
        "transitions" => "transition",
        "overlays" => "overlay",
        "logos" => "logo",
        "templates" => "template",
        "videos" => "video",
        "images" | "img" => "image",
        "graphics" => "graphic",
        "samples" => "sample",
        "jpeg" => "jpg",
        "aiff" => "aif",
        "midi" | "mid" => "midi",
        other => other,
    };
    mapped.to_string()
}

fn note_pitch(letter: &str) -> Option<u8> {
    NOTE_NAMES.iter().find(|(n, _)| *n == letter).map(|(_, p)| *p)
}

/// Parses a single token as a key, e.g. `g#`, `gsharp`, `ab`, `f#m`, `aminor`.
/// `strict` rejects a bare letter or a bare `Xm`, which are too ambiguous to
/// read as a key without an accidental (a file called `a.wav` is not in A).
fn parse_key_token(raw: &str, strict: bool) -> Option<MusicalKey> {
    let t = raw.to_lowercase().replace('♯', "#").replace('♭', "b");
    let mut chars = t.char_indices();
    let (_, letter) = chars.next()?;
    let mut pitch = note_pitch(&letter.to_string())? as i8;
    let mut rest = &t[letter.len_utf8()..];
    let mut accidental = false;
    for (word, delta) in [("#", 1i8), ("sharp", 1), ("flat", -1), ("b", -1)] {
        if let Some(r) = rest.strip_prefix(word) {
            pitch += delta;
            rest = r;
            accidental = true;
            break;
        }
    }
    let minor = match rest {
        "" => None,
        "m" | "min" | "minor" => Some(true),
        "maj" | "major" => Some(false),
        _ => return None,
    };
    if strict && !accidental {
        return None;
    }
    Some(MusicalKey { pitch: pitch.rem_euclid(12) as u8, minor })
}

/// Splits on separators and at letter/digit boundaries: `Kick_G#_128BPM` →
/// `kick`, `g#`, `128`, `bpm`. `#` and `♯` stay attached to a note letter.
pub fn raw_tokens(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for word in text.split(|c: char| !(c.is_alphanumeric() || c == '#' || c == '♯' || c == '♭')) {
        if word.is_empty() {
            continue;
        }
        let mut current = String::new();
        let mut prev_digit: Option<bool> = None;
        for c in word.chars() {
            let is_digit = c.is_ascii_digit();
            if let Some(p) = prev_digit {
                if p != is_digit && !matches!(c, '#' | '♯' | '♭') {
                    out.push(std::mem::take(&mut current));
                }
            }
            current.push(c);
            prev_digit = Some(is_digit);
        }
        if !current.is_empty() {
            out.push(current);
        }
    }
    out
}

fn resolution_of(token: &str) -> Option<u32> {
    match token {
        "8k" => Some(4320),
        "6k" => Some(3160),
        "5k" => Some(2880),
        "4k" | "uhd" | "2160p" => Some(2160),
        "2k" | "1440p" | "qhd" => Some(1440),
        "fhd" | "1080p" => Some(1080),
        "720p" => Some(720),
        _ => None,
    }
}

/// Reads creator metadata from a file's relative path (PRD §6.2–6.4).
pub fn extract_metadata(path: &str) -> FileMetadata {
    let file_name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    let (stem, ext) = match file_name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s, Some(e.to_lowercase())),
        _ => (file_name, None),
    };
    let kind = ext.as_deref().map(extension_kind);
    let mut meta = FileMetadata { kind, extension: ext, ..Default::default() };

    // Keys and resolutions are read from the file name; BPM too, since a
    // folder called `128` says little about the files inside it.
    let original: Vec<String> = raw_tokens(stem);
    let lower: Vec<String> = original.iter().map(|t| t.to_lowercase()).collect();
    for res in ["8k", "6k", "5k", "4k", "2k", "uhd", "qhd", "fhd"] {
        if lower.iter().any(|t| t == res) || lower.windows(2).any(|w| format!("{}{}", w[0], w[1]) == res) {
            meta.resolution = meta.resolution.or(resolution_of(res));
        }
    }

    let mut bare_numbers = Vec::new();
    let mut i = 0;
    while i < lower.len() {
        let t = &lower[i];
        let next = lower.get(i + 1).map(String::as_str);
        let prev = if i > 0 { Some(lower[i - 1].as_str()) } else { None };
        if let Ok(n) = t.parse::<u32>() {
            match next {
                Some("bpm") => meta.bpm = Some(n),
                Some("fps") => meta.fps = Some(n),
                Some("p") if matches!(n, 480 | 720 | 1080 | 1440 | 2160) => meta.resolution = meta.resolution.or(Some(n)),
                Some("k") => meta.resolution = meta.resolution.or(resolution_of(&format!("{n}k"))),
                _ if prev == Some("bpm") => meta.bpm = Some(n),
                _ => bare_numbers.push(n),
            }
        } else if let Some(key) = key_at(&original, i) {
            meta.key = meta.key.or(Some(key.0));
            i += key.1;
            continue;
        }
        i += 1;
    }

    // A bare tempo-range number in an audio or MIDI file name is read as BPM
    // (`Kick_G#_128.wav`, PRD §4.3). Video and images keep numbers as text.
    if meta.bpm.is_none() && matches!(meta.kind, Some(MediaKind::Audio | MediaKind::Midi)) {
        meta.bpm = bare_numbers.into_iter().find(|n| (60..=200).contains(n));
    }
    meta
}

/// Recognises a key starting at token `i` of the original-case tokens.
/// Returns the key and how many tokens it consumed (`G Sharp Minor` = 3).
fn key_at(original: &[String], i: usize) -> Option<(MusicalKey, usize)> {
    let t = &original[i];
    let first = t.chars().next()?;
    // In file names a key starts with a capital letter; lowercase words such
    // as `bass` or `am` are ordinary words.
    if !first.is_ascii_uppercase() {
        return None;
    }
    let mut spelled = t.clone();
    let mut used = 1;
    for extra in original.iter().skip(i + 1).take(2) {
        let lower = extra.to_lowercase();
        if matches!(lower.as_str(), "sharp" | "flat" | "minor" | "major" | "min" | "maj" | "m") {
            spelled.push_str(&lower);
            used += 1;
        } else {
            break;
        }
    }
    if let Some(k) = parse_key_token(&spelled, true) {
        return Some((k, used));
    }
    // Capital letter plus explicit mode, e.g. `Am`, `C minor`: a key.
    let lower = spelled.to_lowercase();
    if lower.len() > 1 {
        if let Some(k) = parse_key_token(&lower, false) {
            if k.minor.is_some() {
                return Some((k, used));
            }
        }
    }
    // A lone capital note letter only counts when a mode word follows it.
    None
}

/// Tokens used for text matching: canonical words from the path and name,
/// plus words for the file's kind and its extension.
pub fn document_tokens(doc: &SearchDoc, meta: &FileMetadata) -> Vec<String> {
    let mut tokens: Vec<String> = raw_tokens(&doc.path)
        .into_iter()
        .map(|t| canonical(&t.to_lowercase().replace('♯', "#")))
        .filter(|t| !t.is_empty())
        .collect();
    if let Some(kind) = meta.kind {
        tokens.extend(kind_words(kind).iter().map(|w| w.to_string()));
    }
    tokens
}

const STOPWORDS: [&str; 8] = ["the", "a", "an", "of", "for", "in", "and", "with"];

/// Parses a creator query: `kick G# 120-130 bpm`, `4k footage 60fps`, …
pub fn parse_query(query: &str) -> ParsedQuery {
    let mut parsed = ParsedQuery::default();
    let tokens: Vec<String> = raw_tokens(query).into_iter().map(|t| t.to_lowercase()).collect();
    let mut i = 0;
    while i < tokens.len() {
        let t = tokens[i].as_str();
        let next = tokens.get(i + 1).map(String::as_str);
        let after = tokens.get(i + 2).map(String::as_str);
        if let Ok(n) = t.parse::<u32>() {
            // `120-130 bpm` tokenizes as 120, 130, bpm (the dash is a separator).
            if let (Some(m), Some("bpm")) = (next.and_then(|s| s.parse::<u32>().ok()), after) {
                parsed.bpm = Some((n.min(m), n.max(m)));
                i += 3;
                continue;
            }
            match next {
                Some("bpm") => {
                    parsed.bpm = Some((n, n));
                    i += 2;
                    continue;
                }
                Some("fps") => {
                    parsed.fps = Some(n);
                    i += 2;
                    continue;
                }
                Some("k") | Some("p") => {
                    if let Some(r) = resolution_of(&format!("{n}{}", next.unwrap())) {
                        parsed.resolution = Some(r);
                        i += 2;
                        continue;
                    }
                }
                Some("sec" | "secs" | "second" | "seconds" | "s" | "min" | "mins" | "minute" | "minutes") => {
                    parsed.unsupported.push(format!("{n} {}", next.unwrap()));
                    i += 2;
                    continue;
                }
                _ => {}
            }
            parsed.terms.push(t.to_string());
            i += 1;
            continue;
        }
        if t == "bpm" {
            if let Some(n) = next.and_then(|s| s.parse::<u32>().ok()) {
                parsed.bpm = Some((n, n));
                i += 2;
                continue;
            }
        }
        if let Some(r) = resolution_of(t) {
            parsed.resolution = Some(r);
            i += 1;
            continue;
        }
        if matches!(t, "vertical" | "horizontal" | "portrait" | "landscape" | "square") {
            parsed.unsupported.push(t.to_string());
            i += 1;
            continue;
        }
        if matches!(t, "under" | "over" | "longer" | "shorter" | "than") {
            i += 1;
            continue;
        }
        // Keys: `g#`, `gsharp`, `g sharp`, `g sharp minor`, `f#m`, `a minor`.
        let mut spelled = t.to_string();
        let mut used = 1;
        for extra in tokens.iter().skip(i + 1).take(2) {
            if matches!(extra.as_str(), "sharp" | "flat" | "minor" | "major" | "min" | "maj") {
                spelled.push_str(extra);
                used += 1;
            } else {
                break;
            }
        }
        let key = parse_key_token(&spelled, true).or_else(|| {
            // `a minor` / `c major`: a bare letter with an explicit mode word.
            if used > 1 { parse_key_token(&spelled, false).filter(|k| k.minor.is_some()) } else { None }
        });
        if let Some(k) = key {
            parsed.key = Some(k);
            i += used;
            continue;
        }
        if !STOPWORDS.contains(&t) {
            parsed.terms.push(canonical(t));
        }
        i += 1;
    }
    parsed
}

struct Indexed {
    doc: SearchDoc,
    meta: FileMetadata,
    tf: HashMap<String, u32>,
    len: u32,
}

/// An in-memory index over a user's committed files.
pub struct SearchIndex {
    docs: Vec<Indexed>,
    df: HashMap<String, u32>,
    avg_len: f64,
}

const K1: f64 = 1.2;
const B: f64 = 0.75;

impl SearchIndex {
    pub fn build(docs: impl IntoIterator<Item = SearchDoc>) -> Self {
        let mut indexed = Vec::new();
        let mut df: HashMap<String, u32> = HashMap::new();
        for doc in docs {
            let meta = extract_metadata(&doc.path);
            let tokens = document_tokens(&doc, &meta);
            let mut tf: HashMap<String, u32> = HashMap::new();
            for t in &tokens {
                *tf.entry(t.clone()).or_default() += 1;
            }
            for t in tf.keys() {
                *df.entry(t.clone()).or_default() += 1;
            }
            indexed.push(Indexed { len: tokens.len() as u32, doc, meta, tf });
        }
        let avg_len = if indexed.is_empty() {
            1.0
        } else {
            indexed.iter().map(|d| d.len as f64).sum::<f64>() / indexed.len() as f64
        };
        Self { docs: indexed, df, avg_len: avg_len.max(1.0) }
    }

    pub fn len(&self) -> usize {
        self.docs.len()
    }

    /// Bytes and file counts per media kind across every indexed file.
    pub fn kind_totals(&self) -> Vec<(MediaKind, u64, usize)> {
        let mut totals: Vec<(MediaKind, u64, usize)> = Vec::new();
        for doc in &self.docs {
            let kind = doc.meta.kind.unwrap_or(MediaKind::Other);
            match totals.iter_mut().find(|(k, _, _)| *k == kind) {
                Some(entry) => {
                    entry.1 = entry.1.saturating_add(doc.doc.size_bytes);
                    entry.2 += 1;
                }
                None => totals.push((kind, doc.doc.size_bytes, 1)),
            }
        }
        totals
    }

    pub fn is_empty(&self) -> bool {
        self.docs.is_empty()
    }

    fn idf(&self, term: &str) -> f64 {
        let n = self.docs.len() as f64;
        let df = *self.df.get(term).unwrap_or(&0) as f64;
        ((n - df + 0.5) / (df + 0.5) + 1.0).ln()
    }

    /// Index vocabulary words a query term may stand for: itself, words it
    /// is a prefix of (3+ chars), and one-edit typos (5+ chars). Each carries
    /// a weight so exact matches outrank fuzzy ones.
    fn expand(&self, term: &str) -> Vec<(String, f64)> {
        let mut out = Vec::new();
        if self.df.contains_key(term) {
            out.push((term.to_string(), 1.0));
        }
        let chars = term.chars().count();
        for word in self.df.keys() {
            if word == term {
                continue;
            }
            if chars >= 3 && word.starts_with(term) {
                out.push((word.clone(), 0.6));
            } else if chars >= 5 && within_one_edit(term, word) {
                out.push((word.clone(), 0.4));
            }
        }
        out
    }

    fn passes_filters(meta: &FileMetadata, q: &ParsedQuery) -> bool {
        if let Some((lo, hi)) = q.bpm {
            match meta.bpm {
                Some(b) if b >= lo && b <= hi => {}
                _ => return false,
            }
        }
        if let Some(k) = q.key {
            match meta.key {
                Some(m) if m.pitch == k.pitch && (k.minor.is_none() || m.minor.is_none() || m.minor == k.minor) => {}
                _ => return false,
            }
        }
        if let Some(r) = q.resolution {
            if meta.resolution != Some(r) {
                return false;
            }
        }
        if let Some(f) = q.fps {
            if meta.fps != Some(f) {
                return false;
            }
        }
        true
    }

    /// Runs a query. Every text term must match (exactly or fuzzily); if that
    /// finds nothing, files matching any term are ranked instead so a long
    /// query still returns its best partial matches.
    pub fn search(&self, query: &str, limit: usize) -> SearchResults {
        let q = parse_query(query);
        let expansions: Vec<Vec<(String, f64)>> = q.terms.iter().map(|t| self.expand(t)).collect();
        let has_filters = q.bpm.is_some() || q.key.is_some() || q.resolution.is_some() || q.fps.is_some();
        if q.terms.is_empty() && !has_filters {
            return SearchResults { hits: vec![], total: 0, unsupported: q.unsupported };
        }

        let score_all = |require_all: bool| -> Vec<(usize, f64)> {
            let mut scored = Vec::new();
            for (idx, d) in self.docs.iter().enumerate() {
                if !Self::passes_filters(&d.meta, &q) {
                    continue;
                }
                let mut total = 0.0;
                let mut matched_terms = 0;
                for options in &expansions {
                    let mut best: f64 = 0.0;
                    for (word, weight) in options {
                        if let Some(&tf) = d.tf.get(word) {
                            let tf = tf as f64;
                            let norm = tf * (K1 + 1.0) / (tf + K1 * (1.0 - B + B * d.len as f64 / self.avg_len));
                            best = best.max(self.idf(word) * norm * weight);
                        }
                    }
                    if best > 0.0 {
                        matched_terms += 1;
                        total += best;
                    }
                }
                let ok = if expansions.is_empty() {
                    true
                } else if require_all {
                    matched_terms == expansions.len()
                } else {
                    matched_terms > 0
                };
                if ok {
                    // Filters alone still rank: a small constant keeps order stable.
                    scored.push((idx, total + if has_filters { 1.0 } else { 0.0 }));
                }
            }
            scored
        };

        let mut scored = score_all(true);
        if scored.is_empty() && expansions.len() > 1 {
            scored = score_all(false);
        }
        scored.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| self.docs[a.0].doc.path.cmp(&self.docs[b.0].doc.path))
        });
        let total = scored.len();
        let hits = scored
            .into_iter()
            .take(limit)
            .map(|(idx, score)| {
                let d = &self.docs[idx];
                SearchHit {
                    file_id: d.doc.file_id.clone(),
                    name: d.doc.name.clone(),
                    path: d.doc.path.clone(),
                    size_bytes: d.doc.size_bytes,
                    score,
                    metadata: d.meta.clone(),
                }
            })
            .collect();
        SearchResults { hits, total, unsupported: q.unsupported }
    }
}

fn within_one_edit(a: &str, b: &str) -> bool {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let (la, lb) = (a.len(), b.len());
    if la.abs_diff(lb) > 1 {
        return false;
    }
    let (mut i, mut j, mut edits) = (0, 0, 0);
    while i < la && j < lb {
        if a[i] == b[j] {
            i += 1;
            j += 1;
            continue;
        }
        edits += 1;
        if edits > 1 {
            return false;
        }
        match la.cmp(&lb) {
            std::cmp::Ordering::Greater => i += 1,
            std::cmp::Ordering::Less => j += 1,
            std::cmp::Ordering::Equal => {
                i += 1;
                j += 1;
            }
        }
    }
    edits + (la - i) + (lb - j) <= 1
}

/// Deduplicates hits by file id; the crawler can meet a file only once, but
/// callers merging several listings use this to stay safe.
pub fn unique_docs(docs: Vec<SearchDoc>) -> Vec<SearchDoc> {
    let mut seen = HashSet::new();
    docs.into_iter().filter(|d| seen.insert(d.file_id.clone())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(id: &str, path: &str) -> SearchDoc {
        SearchDoc {
            file_id: id.into(),
            name: path.rsplit('/').next().unwrap().into(),
            path: path.into(),
            size_bytes: 1,
        }
    }

    fn ids(r: &SearchResults) -> Vec<&str> {
        r.hits.iter().map(|h| h.file_id.as_str()).collect()
    }

    const G_SHARP: MusicalKey = MusicalKey { pitch: 8, minor: None };

    #[test]
    fn tokenizer_splits_separators_and_digit_boundaries() {
        assert_eq!(raw_tokens("Kick_G#_128BPM.wav"), vec!["Kick", "G#", "128", "BPM", "wav"]);
        assert_eq!(raw_tokens("KSHMR Vol 5/Kicks"), vec!["KSHMR", "Vol", "5", "Kicks"]);
    }

    #[test]
    fn extracts_bpm_key_and_kind_from_sample_names() {
        let m = extract_metadata("KSHMR Vol 5/Kicks/Kick_G#_128.wav");
        assert_eq!(m.kind, Some(MediaKind::Audio));
        assert_eq!(m.bpm, Some(128));
        assert_eq!(m.key, Some(G_SHARP));
        let m = extract_metadata("Loops/Pad Loop 124BPM F#min.aif");
        assert_eq!(m.bpm, Some(124));
        assert_eq!(m.key, Some(MusicalKey { pitch: 6, minor: Some(true) }));
    }

    #[test]
    fn key_aliases_are_equivalent() {
        for spelled in ["Kick G#.wav", "Kick G♯.wav", "Kick GSharp.wav", "Kick G Sharp.wav", "Kick Ab.wav"] {
            assert_eq!(extract_metadata(spelled).key.map(|k| k.pitch), Some(8), "{spelled}");
        }
    }

    #[test]
    fn ordinary_words_are_not_keys() {
        assert_eq!(extract_metadata("bass/a day.wav").key, None);
        assert_eq!(extract_metadata("Big Bass.wav").key, None);
        assert_eq!(extract_metadata("A.wav").key, None);
        assert_eq!(extract_metadata("Am Bass 90.wav").key, Some(MusicalKey { pitch: 9, minor: Some(true) }));
    }

    #[test]
    fn video_resolution_and_fps_but_numbers_are_not_bpm() {
        let m = extract_metadata("Footage/Drone_4K_60fps_120.mov");
        assert_eq!(m.kind, Some(MediaKind::Video));
        assert_eq!(m.resolution, Some(2160));
        assert_eq!(m.fps, Some(60));
        assert_eq!(m.bpm, None);
        assert_eq!(extract_metadata("City 1080p 24fps.mp4").resolution, Some(1080));
    }

    #[test]
    fn parses_structured_queries() {
        let q = parse_query("kick G# 120-130 bpm");
        assert_eq!(q.terms, vec!["kick"]);
        assert_eq!(q.bpm, Some((120, 130)));
        assert_eq!(q.key, Some(G_SHARP));
        let q = parse_query("4k footage 60fps");
        assert_eq!((q.resolution, q.fps, q.terms.clone()), (Some(2160), Some(60), vec!["footage".to_string()]));
        let q = parse_query("vertical video under 30 sec");
        assert_eq!(q.terms, vec!["video"]);
        assert_eq!(q.unsupported, vec!["vertical", "30 sec"]);
        assert_eq!(parse_query("g sharp minor").key, Some(MusicalKey { pitch: 8, minor: Some(true) }));
        assert_eq!(parse_query("a minor pad").key, Some(MusicalKey { pitch: 9, minor: Some(true) }));
        assert_eq!(parse_query("a pad").key, None);
    }

    fn library() -> SearchIndex {
        SearchIndex::build(vec![
            doc("k4", "KSHMR Vol 4/Kicks/Kick_G#_128.wav"),
            doc("k5", "KSHMR Vol 5/Kicks/Kick_G#_128.wav"),
            doc("k6", "KSHMR Vol 5/Kicks/Kick_C_140.wav"),
            doc("s1", "KSHMR Vol 5/Snares/Snare_Tight_128.wav"),
            doc("v1", "Footage/Drone_4K_60fps.mov"),
            doc("v2", "Footage/Street_1080p_24fps.mp4"),
            doc("l1", "Grading/Warm Film.cube"),
            doc("g1", "Brand/logo.svg"),
            doc("p1", "Uni/Database Assignment Week 9.pdf"),
            doc("x1", "Vocals/Vox Chop Am 90.wav"),
        ])
    }

    #[test]
    fn identical_names_in_two_packs_stay_two_results() {
        let r = library().search("kick G# 120-130 bpm", 10);
        let mut got = ids(&r);
        got.sort();
        assert_eq!(got, vec!["k4", "k5"]);
    }

    #[test]
    fn prd_example_queries() {
        let idx = library();
        assert_eq!(ids(&idx.search("KSHMR kick 128", 10))[..2].len(), 2);
        assert!(ids(&idx.search("KSHMR kick 128", 10)).iter().all(|id| id.starts_with('k')));
        assert_eq!(ids(&idx.search("4k footage 60fps", 10)), vec!["v1"]);
        assert_eq!(ids(&idx.search("logo svg", 10)), vec!["g1"]);
        assert_eq!(ids(&idx.search("database assignment week 9 pdf", 10)), vec!["p1"]);
        assert_eq!(ids(&idx.search("warm", 10)), vec!["l1"]);
    }

    #[test]
    fn aliases_prefixes_and_typos_match() {
        let idx = library();
        assert_eq!(ids(&idx.search("vocals", 10)), vec!["x1"]);
        assert_eq!(ids(&idx.search("snar", 10)), vec!["s1"]);
        assert_eq!(ids(&idx.search("snate", 10)), vec!["s1"]);
    }

    #[test]
    fn unsupported_phrases_are_reported_not_hidden() {
        let r = library().search("vertical video under 30 sec", 10);
        assert_eq!(r.unsupported, vec!["vertical", "30 sec"]);
        assert_eq!(r.total, 2);
    }

    #[test]
    fn empty_query_returns_nothing() {
        assert_eq!(library().search("  ", 10).total, 0);
    }

    #[test]
    fn kind_totals_sum_bytes_and_counts_per_media_kind() {
        let totals = library().kind_totals();
        let find = |kind| totals.iter().find(|(k, _, _)| *k == kind).map(|(_, b, n)| (*b, *n));
        // Five WAVs, two videos, one SVG, one PDF and one .cube (Other), 1 byte each.
        assert_eq!(find(MediaKind::Audio), Some((5, 5)));
        assert_eq!(find(MediaKind::Video), Some((2, 2)));
        assert_eq!(find(MediaKind::Image), Some((1, 1)));
        assert_eq!(find(MediaKind::Document), Some((1, 1)));
        assert_eq!(find(MediaKind::Other), Some((1, 1)));
    }

    #[test]
    fn falls_back_to_partial_matches_when_no_file_has_every_term() {
        let r = library().search("kick banana", 10);
        assert!(r.total >= 3);
    }
}
