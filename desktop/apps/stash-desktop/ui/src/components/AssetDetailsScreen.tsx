import { useEffect, useRef, useState } from "react";
import type { FileDetails, SearchKind } from "../domain/types";
import type { DesktopGateway } from "../platform/contracts";
import { extensionOf, previewKindOf } from "../platform/preview";
import { safeActionError } from "../platform/tauri/gateway";
import { formatBytes } from "./FilesScreen";
import { resolutionLabel } from "./SearchScreen";
import { EmptyRow, Screen } from "./ui";

/** The file being looked at, as the screen that opened it knows it. */
export type AssetRef = {
  fileId: string;
  name: string;
  sizeBytes: number;
  /** Folder names from the top of STASH down to the file's folder. */
  folders: string[];
};

type Props = { gateway: DesktopGateway; asset: AssetRef; mounted: boolean; onBack: () => void };

/** Audio up to this size gets a waveform drawn from its real samples. */
const WAVEFORM_MAX_BYTES = 25 * 1024 * 1024;
const WAVEFORM_BARS = 96;
/** Text previews show the start of the file. */
const TEXT_PREVIEW_BYTES = 256 * 1024;

const KIND_LABEL: Record<SearchKind, string> = { audio: "Audio", midi: "MIDI", video: "Video", image: "Image", document: "Document", other: "File" };

/** Figma "00:02.46": minutes, seconds, hundredths. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00.00";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}

/** Peak level per bar, 0–1, from decoded samples (all channels). */
export function peaks(channels: Float32Array[], bars: number): number[] {
  const length = channels[0]?.length ?? 0;
  if (length === 0 || bars <= 0) return [];
  const step = Math.max(1, Math.floor(length / bars));
  const result: number[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    let peak = 0;
    const end = Math.min(length, (bar + 1) * step);
    for (const channel of channels) for (let i = bar * step; i < end; i += 16) peak = Math.max(peak, Math.abs(channel[i] ?? 0));
    result.push(peak);
  }
  const loudest = Math.max(...result, 0.0001);
  return result.map((value) => value / loudest);
}

function shortChecksum(checksum: string): string {
  const hex = checksum.replace(/^sha256:/, "");
  return hex.length > 12 ? `${hex.slice(0, 4)}…${hex.slice(-4)}` : hex;
}

/** Figma "Asset details" (Kick_G#_128.wav frame), with real data only. */
export function AssetDetailsScreen({ gateway, asset, mounted, onBack }: Props) {
  const [details, setDetails] = useState<FileDetails | null>(null);
  const [detailsError, setDetailsError] = useState("");
  const [duration, setDuration] = useState<number | null>(null);
  const [openError, setOpenError] = useState("");
  const kind = previewKindOf(asset.name);
  const url = gateway.library.previewUrl(asset.fileId, asset.name, asset.sizeBytes);
  const drivePath = [...asset.folders, asset.name].join("/");

  useEffect(() => {
    let active = true;
    void gateway.library.describeFile(asset.fileId).then((value) => { if (active) setDetails(value); }).catch((error) => { if (active) setDetailsError(safeActionError(error, "Details are unavailable right now.")); });
    return () => { active = false; };
  }, [gateway, asset.fileId]);

  const open = () => {
    setOpenError("");
    void gateway.library.openOnDrive(drivePath).catch((error) => setOpenError(safeActionError(error, "Windows couldn't open that file.")));
  };

  const rows: [string, string][] = [];
  if (details) rows.push(["Kind", KIND_LABEL[details.kind]]);
  if (details?.bpm) rows.push(["Tempo", `${details.bpm} BPM`]);
  if (details?.key) rows.push(["Musical key", details.key]);
  const resolution = resolutionLabel(details?.resolution);
  if (resolution) rows.push(["Resolution", resolution]);
  if (details?.fps) rows.push(["Frame rate", `${details.fps} fps`]);
  if (duration !== null) rows.push(["Duration", clock(duration)]);
  rows.push(["Size", formatBytes(details?.sizeBytes ?? asset.sizeBytes)]);
  if (details?.checksum) rows.push(["Checksum", shortChecksum(details.checksum)]);

  return (
    <Screen label={`${asset.name} details`}>
      <nav className="asset-crumbs" aria-label="File location">
        <button type="button" onClick={onBack}>{["STASH", ...asset.folders].join(" / ")}</button>
        <span aria-hidden="true">›</span>
        <span aria-current="page">{asset.name}</span>
      </nav>
      <div className="asset-layout">
        <div className="asset-main">
          <div className={`asset-preview is-${kind ?? "none"}`}>
            <span className="asset-preview-tech">{[extensionOf(asset.name).toUpperCase(), formatBytes(asset.sizeBytes)].filter(Boolean).join(" · ")}</span>
            {url && kind === "image" && <img className="asset-image" src={url} alt={asset.name} />}
            {url && kind === "audio" && <AudioPreview url={url} sizeBytes={asset.sizeBytes} onDuration={setDuration} />}
            {url && kind === "video" && <video className="asset-video" src={url} controls preload="metadata" onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} />}
            {url && kind === "pdf" && <iframe className="asset-frame" src={url} title={`${asset.name} preview`} />}
            {url && kind === "text" && <TextPreview url={url} />}
            {!url && <EmptyRow title="No preview for this type yet" copy={`STASH previews images, audio, video, PDFs and text. Open ${asset.name} in its usual app instead.`} />}
          </div>
          <div className="asset-title-row">
            <div className="asset-title">
              <h1>{asset.name}</h1>
              <p>{drivePath.split("/").join(" / ")}</p>
            </div>
            <button type="button" className="button button-primary" disabled={!mounted} title={mounted ? "Open in its usual Windows app" : "Mount S: to open files in your apps"} onClick={open}>▷&nbsp;&nbsp;Open</button>
          </div>
          {openError && <p className="asset-error" role="alert">{openError}</p>}
        </div>
        <aside className="asset-details" aria-label="Details">
          <h2>Details</h2>
          <dl>
            {rows.map(([label, value]) => (
              <div key={label} className="asset-detail-row"><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
          {detailsError && <p className="asset-error" role="alert">{detailsError}</p>}
        </aside>
      </div>
    </Screen>
  );
}

/** Figma player: waveform from the real samples, lime play button, time, scrubber. */
function AudioPreview({ url, sizeBytes, onDuration }: { url: string; sizeBytes: number; onDuration: (seconds: number) => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [bars, setBars] = useState<number[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (sizeBytes > WAVEFORM_MAX_BYTES) return;
    let active = true;
    const context = new AudioContext();
    void fetch(url)
      .then((response) => { if (!response.ok) throw new Error(String(response.status)); return response.arrayBuffer(); })
      .then((bytes) => context.decodeAudioData(bytes))
      .then((buffer) => { if (active) setBars(peaks(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)), WAVEFORM_BARS)); })
      .catch(() => undefined)
      .finally(() => { void context.close(); });
    return () => { active = false; };
  }, [url, sizeBytes]);

  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => setError("This audio couldn't be played here."));
    else element.pause();
  };
  const seek = (fraction: number) => {
    const element = audio.current;
    if (element && Number.isFinite(element.duration)) element.currentTime = fraction * element.duration;
  };
  const progress = duration > 0 ? time / duration : 0;

  return (
    <div className="asset-audio">
      <audio
        ref={audio}
        src={url}
        preload="metadata"
        muted={muted}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => { setDuration(e.currentTarget.duration); onDuration(e.currentTarget.duration); }}
        onError={() => setError("This audio couldn't be loaded. Check your connection and try again.")}
      />
      <div className="asset-wave" aria-hidden="true">
        {bars?.map((level, i) => <span key={i} className={i / bars.length <= progress ? "is-played" : ""} style={{ height: `${Math.max(6, level * 100)}%` }} />)}
      </div>
      {error && <p className="asset-error" role="alert">{error}</p>}
      <div className="asset-player">
        <button type="button" className="asset-play" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            {playing ? <path d="M6 4h3v12H6zM11 4h3v12h-3z" fill="currentColor" /> : <path d="M6 3.5v13l11-6.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />}
          </svg>
        </button>
        <span className="asset-time">{clock(time)}</span>
        <input className="asset-scrub" type="range" min={0} max={1000} value={Math.round(progress * 1000)} aria-label="Position" onChange={(e) => seek(Number(e.target.value) / 1000)} />
        <span className="asset-time">{clock(duration)}</span>
        <button type="button" className="asset-mute" aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted} onClick={() => setMuted((value) => !value)}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 3.5 4.5 6.5H2v5h2.5L8 14.5z" />
            {muted ? <path d="m11.5 7 4 4m0-4-4 4" /> : <path d="M11.5 6.5a3.5 3.5 0 0 1 0 5M13.5 4.5a6.5 6.5 0 0 1 0 9" />}
          </svg>
        </button>
      </div>
    </div>
  );
}

/** The start of a text file, in the app's own type. */
function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void fetch(url, { headers: { Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` } })
      .then((response) => { if (!response.ok) throw new Error(String(response.status)); return response.text(); })
      .then((value) => { if (active) setText(value); })
      .catch(() => { if (active) setError("This file couldn't be loaded. Check your connection and try again."); });
    return () => { active = false; };
  }, [url]);
  if (error) return <p className="asset-error" role="alert">{error}</p>;
  return <pre className="asset-text">{text ?? "Loading…"}</pre>;
}
