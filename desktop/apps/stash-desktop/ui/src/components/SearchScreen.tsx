import { useEffect, useMemo, useRef, useState } from "react";
import sparklesIcon from "../assets/figma/common/sparkles.svg";
import searchIcon from "../assets/figma/shell/search.svg";
import type { SearchHit, SearchResponse } from "../domain/types";
import type { DesktopGateway } from "../platform/contracts";
import { safeActionError } from "../platform/tauri/gateway";
import { formatBytes } from "./FilesScreen";
import { AssetDetailsScreen } from "./AssetDetailsScreen";
import { MaskIcon } from "./NavigationRail";
import { AssetRow, EmptyRow, InfoBar, Screen } from "./ui";

type Props = { gateway: DesktopGateway; initialQuery?: string; mounted?: boolean };

type SearchState =
  | { status: "idle" }
  | { status: "loading"; query: string }
  | { status: "ready"; query: string; data: SearchResponse; tookMs: number }
  | { status: "offline"; query: string; message: string };

/** PRD §6 examples, offered as starting points rather than fixed categories. */
export const SEARCH_EXAMPLES = ["kick G# 120-130 bpm", "KSHMR kick 128", "4k footage 60fps", "warm LUT", "logo svg"] as const;

const DEBOUNCE_MS = 250;
/** Values shown per filter group; the rest are reachable by refining the query. */
const FACET_LIMIT = 5;

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
  return labels;
}

/** The folder a hit lives in, from its preserved relative path. */
export function folderOf(hit: SearchHit): string {
  const cut = Math.max(hit.path.lastIndexOf("/"), hit.path.lastIndexOf("\\"));
  return cut > 0 ? hit.path.slice(0, cut).split(/[\\/]/).join(" / ") : "Top level";
}

const typeLabel = (hit: SearchHit) => (hit.extension ?? hit.kind).toUpperCase();

/** Figma "Filters" groups, built only from the files this search returned. */
type FacetGroup = { id: string; title: string; values: { label: string; count: number }[] };
type FacetId = "type" | "key" | "tempo" | "resolution" | "fps";

const FACETS: { id: FacetId; title: string; value: (hit: SearchHit) => string | null }[] = [
  { id: "type", title: "File type", value: typeLabel },
  { id: "key", title: "Key", value: (hit) => hit.key ?? null },
  { id: "tempo", title: "Tempo", value: (hit) => (hit.bpm ? `${hit.bpm} BPM` : null) },
  { id: "resolution", title: "Resolution", value: (hit) => resolutionLabel(hit.resolution) },
  { id: "fps", title: "Frame rate", value: (hit) => (hit.fps ? `${hit.fps} fps` : null) },
];

export function facetGroups(hits: SearchHit[]): FacetGroup[] {
  return FACETS.flatMap(({ id, title, value }) => {
    const counts = new Map<string, number>();
    for (const hit of hits) {
      const label = value(hit);
      if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const values = [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, FACET_LIMIT);
    return values.length > 0 ? [{ id, title, values }] : [];
  });
}

export function applyFacets(hits: SearchHit[], chosen: Partial<Record<FacetId, string>>): SearchHit[] {
  return hits.filter((hit) => FACETS.every(({ id, value }) => !chosen[id] || value(hit) === chosen[id]));
}

export function SearchScreen({ gateway, initialQuery = "", mounted = false }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const [chosen, setChosen] = useState<Partial<Record<FacetId, string>>>({});
  const [previewing, setPreviewing] = useState<SearchHit | null>(null);
  const request = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const run = (text: string, refresh = false) => {
    const trimmed = text.trim();
    const id = ++request.current;
    setChosen({});
    if (!trimmed) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading", query: trimmed });
    const started = performance.now();
    void gateway.library
      .search(trimmed, refresh)
      .then((data) => { if (id === request.current) setState({ status: "ready", query: trimmed, data, tookMs: Math.round(performance.now() - started) }); })
      .catch((error) => { if (id === request.current) setState({ status: "offline", query: trimmed, message: safeActionError(error, "Search couldn't reach your STASH. Try again.") }); });
  };

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => run(query), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const data = state.status === "ready" ? state.data : undefined;
  const facets = useMemo(() => facetGroups(data?.hits ?? []), [data]);
  const shown = useMemo(() => applyFacets(data?.hits ?? [], chosen), [data, chosen]);
  const filtering = Object.values(chosen).some(Boolean);

  if (previewing) {
    const folders = previewing.path.split(/[\\/]/).filter(Boolean).slice(0, -1);
    return <AssetDetailsScreen gateway={gateway} asset={{ fileId: previewing.fileId, name: previewing.name, sizeBytes: previewing.sizeBytes, folders }} mounted={mounted} onBack={() => setPreviewing(null)} />;
  }

  return (
    <Screen label="Search">
      <form className="search-bar" role="search" onSubmit={(e) => { e.preventDefault(); run(query); }}>
        <span className="search-bar-icon"><MaskIcon src={searchIcon} size={20} /></span>
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
          onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
        />
        <kbd className="search-esc">ESC</kbd>
      </form>

      {state.status === "idle" && (
        <div className="search-examples" aria-label="Example searches">
          <span className="search-for-label">Try</span>
          {SEARCH_EXAMPLES.map((example) => (
            <button key={example} type="button" className="search-chip is-example" onClick={() => setQuery(example)}>{example}</button>
          ))}
        </div>
      )}

      {state.status !== "idle" && (
        <div className="search-for" aria-live="polite">
          <span className="search-for-label">Searching for</span>
          {(data?.understood.length ? data.understood : [state.query]).map((label) => <span key={label} className="search-chip">{label}</span>)}
          <span className="search-for-count">
            {state.status === "ready" && `${state.data.total.toLocaleString()} ${state.data.total === 1 ? "result" : "results"} in ${state.tookMs} ms`}
            {state.status === "loading" && "Searching…"}
          </span>
          <button type="button" className="search-refresh" onClick={() => run(query, true)} disabled={!query.trim() || state.status === "loading"}>Refresh results</button>
        </div>
      )}

      {data && data.unsupported.length > 0 && (
        <p className="search-note" role="note">
          STASH can't tell duration or orientation from file names yet, so “{data.unsupported.join("”, “")}” wasn't used.
        </p>
      )}
      {data?.truncated && <p className="search-note" role="note">Your library is larger than this device indexes at once, so some files may be missing from results.</p>}

      {state.status === "offline" && <EmptyRow title="Search is unavailable" copy={state.message} />}

      {data && (
        <div className="search-layout">
          <aside className="search-filters" aria-label="Filters">
            <h2>Filters</h2>
            {facets.length === 0 && <p className="search-filters-empty">Nothing to narrow yet.</p>}
            {facets.map((group) => (
              <div key={group.id} className="search-facet" role="group" aria-label={group.title}>
                <span className="search-facet-title">{group.title}</span>
                {group.values.map(({ label, count }) => {
                  const active = chosen[group.id as FacetId] === label;
                  return (
                    <button key={label} type="button" className={`search-facet-value${active ? " is-active" : ""}`} aria-pressed={active} onClick={() => setChosen((current) => ({ ...current, [group.id]: active ? undefined : label }))}>
                      <span>{label}</span>
                      <span className="search-facet-count">{count}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            <button type="button" className="search-clear" disabled={!filtering} onClick={() => setChosen({})}>Clear filters</button>
          </aside>

          <div className="search-results" aria-label="Results">
            {shown.length === 0 ? (
              <EmptyRow title={data.total === 0 ? `No files match “${state.status === "ready" ? state.query : ""}”` : "No results with these filters"} copy={data.total === 0 ? "Try fewer words, or a different key or tempo." : "Clear a filter to see more of this search."} />
            ) : (
              shown.map((hit) => (
                <AssetRow
                  key={hit.fileId}
                  kind={hit.kind}
                  name={hit.name}
                  meta={[folderOf(hit), ...detailLabels(hit)].join(" · ")}
                  type={`${typeLabel(hit)} · ${formatBytes(hit.sizeBytes)}`}
                  waveform={hit.kind === "audio"}
                  onOpen={() => setPreviewing(hit)}
                />
              ))
            )}
            {data.total > data.hits.length && <p className="search-more">Showing the top {data.hits.length.toLocaleString()} of {data.total.toLocaleString()}. Add a key, tempo or folder name to narrow it down.</p>}
          </div>
        </div>
      )}

      <InfoBar icon={sparklesIcon}>
        Search runs on this device and reads names, folders, BPM, key, resolution and frame rate{data ? ` across ${data.indexedFiles.toLocaleString()} Stashed ${data.indexedFiles === 1 ? "file" : "files"}` : ""} — your files stay where they are.
      </InfoBar>
    </Screen>
  );
}
