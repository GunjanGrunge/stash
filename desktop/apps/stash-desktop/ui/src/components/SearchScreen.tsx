import { useEffect, useRef, useState } from "react";
import type { SearchHit, SearchResponse } from "../domain/types";
import type { DesktopGateway } from "../platform/contracts";
import { safeActionError } from "../platform/tauri/gateway";
import { formatBytes } from "./FilesScreen";

type Props = { gateway: DesktopGateway; initialQuery?: string };

type SearchState =
  | { status: "idle" }
  | { status: "loading"; query: string }
  | { status: "ready"; query: string; data: SearchResponse }
  | { status: "offline"; query: string; message: string };

/** PRD §6 examples, offered as starting points rather than fixed categories. */
export const SEARCH_EXAMPLES = ["kick G# 120-130 bpm", "KSHMR kick 128", "4k footage 60fps", "warm LUT", "logo svg"] as const;

const DEBOUNCE_MS = 250;

export function resolutionLabel(height?: number | null): string | null {
  if (!height) return null;
  if (height === 4320) return "8K";
  if (height === 2160) return "4K";
  return `${height}p`;
}

export function detailLabels(hit: SearchHit): string[] {
  const labels: string[] = [];
  if (hit.bpm) labels.push(`${hit.bpm} BPM`);
  if (hit.key) labels.push(hit.key);
  const resolution = resolutionLabel(hit.resolution);
  if (resolution) labels.push(resolution);
  if (hit.fps) labels.push(`${hit.fps} fps`);
  if (hit.extension) labels.push(hit.extension.toUpperCase());
  return labels;
}

/** The folder a hit lives in, from its preserved relative path. */
export function folderOf(hit: SearchHit): string {
  const cut = Math.max(hit.path.lastIndexOf("/"), hit.path.lastIndexOf("\\"));
  return cut > 0 ? hit.path.slice(0, cut) : "Top level";
}

export function SearchScreen({ gateway, initialQuery = "" }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const request = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const run = (text: string, refresh = false) => {
    const trimmed = text.trim();
    const id = ++request.current;
    if (!trimmed) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading", query: trimmed });
    void gateway.library
      .search(trimmed, refresh)
      .then((data) => { if (id === request.current) setState({ status: "ready", query: trimmed, data }); })
      .catch((error) => { if (id === request.current) setState({ status: "offline", query: trimmed, message: safeActionError(error, "Search couldn't reach your STASH. Try again.") }); });
  };

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => run(query), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const data = state.status === "ready" ? state.data : undefined;

  return (
    <section className="screen-container search-screen" aria-labelledby="search-heading">
      <header className="screen-header">
        <div>
          <h1 id="search-heading">Search</h1>
          <p className="screen-sub">Search runs on this device, across the names and folders you Stashed.</p>
        </div>
        <button type="button" className="button button-secondary button-sm" onClick={() => run(query, true)} disabled={!query.trim() || state.status === "loading"}>
          Refresh results
        </button>
      </header>

      <form className="search-bar" role="search" onSubmit={(e) => { e.preventDefault(); run(query); }}>
        <label htmlFor="search-input" className="visually-hidden">Search your STASH</label>
        <input
          id="search-input"
          ref={input}
          type="search"
          value={query}
          maxLength={200}
          placeholder="Search your STASH…  e.g. kick G# 120-130 bpm"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />
      </form>

      {state.status === "idle" && (
        <div className="search-examples" aria-label="Example searches">
          <p className="screen-sub">Try a keyword, or add BPM, key, resolution or frame rate:</p>
          <div className="filter-tab-bar">
            {SEARCH_EXAMPLES.map((example) => (
              <button key={example} type="button" className="tab-btn" onClick={() => setQuery(example)}>{example}</button>
            ))}
          </div>
        </div>
      )}

      {state.status === "loading" && <div className="empty-state-message" aria-live="polite">Searching your STASH…</div>}
      {state.status === "offline" && <div className="empty-state-message error-text" role="alert">{state.message}</div>}

      {data && (
        <>
          <p className="search-summary" aria-live="polite">
            {data.total === 0
              ? `No files match “${state.status === "ready" ? state.query : ""}”.`
              : `${data.total.toLocaleString()} ${data.total === 1 ? "file" : "files"} found${data.total > data.hits.length ? ` · showing the top ${data.hits.length}` : ""}`}
            {" · "}searched {data.indexedFiles.toLocaleString()} Stashed {data.indexedFiles === 1 ? "file" : "files"}
          </p>
          {data.unsupported.length > 0 && (
            <p className="search-note" role="note">
              STASH can't tell duration or orientation from file names yet, so “{data.unsupported.join("”, “")}” wasn't used.
            </p>
          )}
          {data.truncated && <p className="search-note" role="note">Your library is larger than this device indexes at once, so some files may be missing from results.</p>}
          {data.hits.length > 0 && (
            <div className="file-table-wrap">
              <table className="file-table search-results">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Folder</th>
                    <th scope="col">Details</th>
                    <th scope="col">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {data.hits.map((hit) => (
                    <tr key={hit.fileId}>
                      <td><strong>{hit.name}</strong></td>
                      <td className="search-folder" title={hit.path}>{folderOf(hit)}</td>
                      <td>
                        <span className="search-tags">
                          {detailLabels(hit).map((label) => <span key={label} className="search-tag">{label}</span>)}
                        </span>
                      </td>
                      <td>{formatBytes(hit.sizeBytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
