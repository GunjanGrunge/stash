//! On-device search over the signed-in user's STASH (PRD §6).
//!
//! The index is built from the control plane's folder listings and held in
//! process memory only. Nothing is sent anywhere to search: queries run
//! against `stash_core::search` locally.

use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde::Serialize;
use serde_json::Value;
use stash_core::search::{parse_query, FileMetadata, MediaKind, MusicalKey, ParsedQuery, SearchDoc, SearchIndex};

/// A rebuilt index is reused for this long before the next query refreshes it.
const INDEX_TTL: Duration = Duration::from_secs(120);
/// Bounds that keep a crawl finite even against a malformed listing.
const MAX_FOLDERS: usize = 20_000;
const MAX_FILES: usize = 1_000_000;
const MAX_QUERY_CHARS: usize = 200;
const RESULT_LIMIT: usize = 200;

struct Built {
    at: Instant,
    index: Arc<SearchIndex>,
    truncated: bool,
}

#[derive(Default)]
pub struct SearchController {
    built: Mutex<Option<Built>>,
}

impl SearchController {
    fn fresh(&self, force: bool) -> Option<(Arc<SearchIndex>, bool)> {
        let built = self.built.lock().unwrap();
        built
            .as_ref()
            .filter(|b| !force && b.at.elapsed() < INDEX_TTL)
            .map(|b| (b.index.clone(), b.truncated))
    }

    fn store(&self, index: SearchIndex, truncated: bool) -> Arc<SearchIndex> {
        let index = Arc::new(index);
        *self.built.lock().unwrap() = Some(Built { at: Instant::now(), index: index.clone(), truncated });
        index
    }

    /// Drops the index, e.g. on sign-out, so one user's file list is never
    /// searched in another user's session.
    pub fn clear(&self) {
        *self.built.lock().unwrap() = None;
    }
}

/// Splits one `GET /folders/{id}/children` body into searchable committed
/// files and the active subfolders still to visit.
pub(crate) fn read_listing(listing: &Value) -> (Vec<SearchDoc>, Vec<String>) {
    let mut docs = Vec::new();
    let mut folders = Vec::new();
    let items = listing.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
    for item in items {
        let text = |k: &str| item.get(k).and_then(Value::as_str).map(str::to_string);
        match text("entity").as_deref() {
            Some("FILE") if text("state").as_deref() == Some("committed") => {
                let (Some(file_id), Some(name)) = (text("fileId"), text("name")) else { continue };
                let path = text("originalRelativePath").unwrap_or_else(|| name.clone());
                let size_bytes = item.get("sizeBytes").and_then(Value::as_u64).unwrap_or(0);
                docs.push(SearchDoc { file_id, name, path, size_bytes });
            }
            Some("FOLDER") if matches!(text("state").as_deref(), None | Some("active")) => {
                if let Some(id) = text("folderId") {
                    folders.push(id);
                }
            }
            _ => {}
        }
    }
    (docs, folders)
}

fn safe_folder_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}

/// Walks the user's folder tree breadth-first from ROOT.
async fn crawl() -> Result<(Vec<SearchDoc>, bool), String> {
    let mut queue = std::collections::VecDeque::from([String::from("ROOT")]);
    let mut seen = std::collections::HashSet::new();
    let mut docs = Vec::new();
    let mut truncated = false;
    while let Some(folder) = queue.pop_front() {
        if !seen.insert(folder.clone()) {
            continue;
        }
        if seen.len() > MAX_FOLDERS || docs.len() >= MAX_FILES {
            truncated = true;
            break;
        }
        let listing = crate::api::get_json(&format!("/folders/{folder}/children")).await?;
        let (found, subfolders) = read_listing(&listing);
        docs.extend(found);
        queue.extend(subfolders.into_iter().filter(|id| safe_folder_id(id)));
    }
    Ok((stash_core::search::unique_docs(docs), truncated))
}

const PITCHES: [&str; 12] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

pub(crate) fn key_label(key: MusicalKey) -> String {
    let mode = match key.minor {
        Some(true) => "m",
        _ => "",
    };
    format!("{}{mode}", PITCHES[key.pitch as usize % 12])
}

pub(crate) fn kind_label(kind: Option<MediaKind>) -> &'static str {
    match kind {
        Some(MediaKind::Audio) => "audio",
        Some(MediaKind::Midi) => "midi",
        Some(MediaKind::Video) => "video",
        Some(MediaKind::Image) => "image",
        Some(MediaKind::Document) => "document",
        _ => "other",
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchHitView {
    pub file_id: String,
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub kind: &'static str,
    pub extension: Option<String>,
    pub bpm: Option<u32>,
    pub key: Option<String>,
    pub resolution: Option<u32>,
    pub fps: Option<u32>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub hits: Vec<SearchHitView>,
    pub total: usize,
    pub unsupported: Vec<String>,
    /// How the query was read, e.g. "Name: kick", "Key: G#", "Tempo: 120–130 BPM".
    pub understood: Vec<String>,
    pub indexed_files: usize,
    pub truncated: bool,
}

fn view(meta: &FileMetadata) -> (&'static str, Option<String>) {
    (kind_label(meta.kind), meta.key.map(key_label))
}

/// Plain labels for what the search engine took from the query.
pub(crate) fn understood_labels(query: &ParsedQuery) -> Vec<String> {
    let mut labels: Vec<String> = query.terms.iter().map(|term| format!("Name: {term}")).collect();
    if let Some(key) = query.key {
        labels.push(format!("Key: {}", key_label(key)));
    }
    match query.bpm {
        Some((low, high)) if low == high => labels.push(format!("Tempo: {low} BPM")),
        Some((low, high)) => labels.push(format!("Tempo: {low}–{high} BPM")),
        None => {}
    }
    if let Some(resolution) = query.resolution {
        labels.push(match resolution {
            4320 => "Resolution: 8K".to_string(),
            2160 => "Resolution: 4K".to_string(),
            other => format!("Resolution: {other}p"),
        });
    }
    if let Some(fps) = query.fps {
        labels.push(format!("Frame rate: {fps} fps"));
    }
    labels
}

pub(crate) fn run_query(index: &SearchIndex, query: &str, truncated: bool) -> SearchResponse {
    let results = index.search(query, RESULT_LIMIT);
    SearchResponse {
        hits: results
            .hits
            .into_iter()
            .map(|h| {
                let (kind, key) = view(&h.metadata);
                SearchHitView {
                    file_id: h.file_id,
                    name: h.name,
                    path: h.path,
                    size_bytes: h.size_bytes,
                    kind,
                    extension: h.metadata.extension,
                    bpm: h.metadata.bpm,
                    key,
                    resolution: h.metadata.resolution,
                    fps: h.metadata.fps,
                }
            })
            .collect(),
        total: results.total,
        unsupported: results.unsupported,
        understood: understood_labels(&parse_query(query)),
        indexed_files: index.len(),
        truncated,
    }
}

/// Searches the signed-in user's STASH. `refresh` forces a re-crawl, e.g.
/// right after a Stash completes.
#[tauri::command]
pub async fn search_stash(
    query: String,
    refresh: Option<bool>,
    state: tauri::State<'_, SearchController>,
) -> Result<SearchResponse, String> {
    if query.chars().count() > MAX_QUERY_CHARS {
        return Err("That search is too long. Try fewer words.".to_string());
    }
    let (index, truncated) = match state.fresh(refresh.unwrap_or(false)) {
        Some(found) => found,
        None => {
            let (docs, truncated) = crawl().await?;
            (state.store(SearchIndex::build(docs), truncated), truncated)
        }
    };
    Ok(run_query(&index, &query, truncated))
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KindTotal {
    pub kind: &'static str,
    pub bytes: u64,
    pub files: usize,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StorageBreakdown {
    pub kinds: Vec<KindTotal>,
    pub indexed_files: usize,
    pub truncated: bool,
}

pub(crate) fn breakdown(index: &SearchIndex, truncated: bool) -> StorageBreakdown {
    let mut kinds: Vec<KindTotal> = index
        .kind_totals()
        .into_iter()
        .map(|(kind, bytes, files)| KindTotal { kind: kind_label(Some(kind)), bytes, files })
        .collect();
    kinds.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    StorageBreakdown { kinds, indexed_files: index.len(), truncated }
}

/// Bytes per media kind across the user's committed files, from the same
/// on-device index search uses (so it costs no extra requests while fresh).
#[tauri::command]
pub async fn storage_breakdown(
    refresh: Option<bool>,
    state: tauri::State<'_, SearchController>,
) -> Result<StorageBreakdown, String> {
    let (index, truncated) = match state.fresh(refresh.unwrap_or(false)) {
        Some(found) => found,
        None => {
            let (docs, truncated) = crawl().await?;
            (state.store(SearchIndex::build(docs), truncated), truncated)
        }
    };
    Ok(breakdown(&index, truncated))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn breakdown_groups_by_kind_largest_first() {
        let doc = |id: &str, path: &str, size| SearchDoc { file_id: id.into(), name: path.into(), path: path.into(), size_bytes: size };
        let index = SearchIndex::build(vec![doc("a", "a.wav", 10), doc("b", "b.mov", 30), doc("c", "c.wav", 5)]);
        let b = breakdown(&index, false);
        assert_eq!(b.indexed_files, 3);
        assert_eq!(b.kinds, vec![KindTotal { kind: "video", bytes: 30, files: 1 }, KindTotal { kind: "audio", bytes: 15, files: 2 }]);
    }

    #[test]
    fn listing_keeps_only_committed_files_and_active_folders() {
        let listing = json!({ "items": [
            { "entity": "FOLDER", "folderId": "f1", "name": "Kicks", "state": "active" },
            { "entity": "FOLDER", "folderId": "f2", "name": "Old", "state": "trashed" },
            { "entity": "FOLDER", "folderId": "f3", "name": "Legacy" },
            { "entity": "FILE", "fileId": "a", "name": "Kick.wav", "state": "committed",
              "sizeBytes": 10, "originalRelativePath": "Pack/Kicks/Kick.wav" },
            { "entity": "FILE", "fileId": "b", "name": "Half.wav", "state": "uploading" },
            { "entity": "FILE", "fileId": "c", "name": "Gone.wav", "state": "trashed" }
        ]});
        let (docs, folders) = read_listing(&listing);
        assert_eq!(folders, vec!["f1", "f3"]);
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].path, "Pack/Kicks/Kick.wav");
        assert_eq!(docs[0].size_bytes, 10);
    }

    #[test]
    fn a_file_without_a_relative_path_is_searched_by_name() {
        let listing = json!({ "items": [
            { "entity": "FILE", "fileId": "a", "name": "logo.svg", "state": "committed" }
        ]});
        assert_eq!(read_listing(&listing).0[0].path, "logo.svg");
    }

    #[test]
    fn unsafe_folder_ids_are_never_requested() {
        assert!(safe_folder_id("f-1_A"));
        assert!(!safe_folder_id("../me/usage"));
        assert!(!safe_folder_id(""));
    }

    #[test]
    fn keys_render_with_sharps_and_mode() {
        assert_eq!(key_label(MusicalKey { pitch: 8, minor: None }), "G#");
        assert_eq!(key_label(MusicalKey { pitch: 9, minor: Some(true) }), "Am");
    }

    #[test]
    fn query_view_carries_metadata_and_counts() {
        let index = SearchIndex::build(vec![SearchDoc {
            file_id: "a".into(),
            name: "Kick_G#_128.wav".into(),
            path: "KSHMR Vol 5/Kicks/Kick_G#_128.wav".into(),
            size_bytes: 5,
        }]);
        let r = run_query(&index, "kick 128 bpm", false);
        assert_eq!(r.total, 1);
        assert_eq!(r.indexed_files, 1);
        assert_eq!(r.hits[0].key.as_deref(), Some("G#"));
        assert_eq!(r.hits[0].bpm, Some(128));
        assert_eq!(r.hits[0].kind, "audio");
        assert_eq!(r.understood, ["Name: kick", "Tempo: 128 BPM"]);
    }

    #[test]
    fn the_response_says_how_the_query_was_read() {
        let labels = |query: &str| understood_labels(&parse_query(query));
        assert_eq!(labels("kick G# 120-130 bpm"), ["Name: kick", "Key: G#", "Tempo: 120–130 BPM"]);
        assert_eq!(labels("4k footage 60fps"), ["Name: footage", "Resolution: 4K", "Frame rate: 60 fps"]);
        assert!(labels("").is_empty());
    }

    #[test]
    fn controller_clear_forgets_the_index() {
        let c = SearchController::default();
        c.store(SearchIndex::build(vec![]), false);
        assert!(c.fresh(false).is_some());
        assert!(c.fresh(true).is_none());
        c.clear();
        assert!(c.fresh(false).is_none());
    }
}
