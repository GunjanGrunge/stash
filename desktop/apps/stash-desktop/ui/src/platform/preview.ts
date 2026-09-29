import type { PreviewKind } from "../domain/types";

/** Mirrors `mime_for` in src-tauri/src/preview.rs: only these types stream. */
const PREVIEW_KINDS: Record<string, PreviewKind> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", avif: "image", bmp: "image", svg: "image",
  wav: "audio", mp3: "audio", flac: "audio", ogg: "audio", oga: "audio", m4a: "audio", aac: "audio",
  mp4: "video", m4v: "video", webm: "video", mov: "video",
  pdf: "pdf",
  txt: "text", md: "text", csv: "text", log: "text", json: "text", xml: "text", srt: "text", cue: "text", nfo: "text",
};

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function previewKindOf(name: string): PreviewKind | null {
  return PREVIEW_KINDS[extensionOf(name)] ?? null;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** `http://stash.localhost/<fileId>/<size>/<ext>`: Tauri's form of `stash://` on Windows. */
export function previewUrl(fileId: string, name: string, sizeBytes: number): string | null {
  const ext = extensionOf(name);
  if (!SAFE_ID.test(fileId) || !previewKindOf(name) || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) return null;
  return `http://stash.localhost/${fileId}/${sizeBytes}/${ext}`;
}
