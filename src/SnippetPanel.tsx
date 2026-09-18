import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Play,
  Search,
  Zap,
} from "lucide-react";
import type { Snippet } from "./shared";

export function SnippetPanel({
  snippets,
  open,
  toggle,
  run,
  disabled,
  hostName,
}: {
  snippets: Snippet[];
  open: boolean;
  toggle: () => void;
  run: (snippet: Snippet) => void;
  disabled: boolean;
  hostName: string;
}) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [page, setPage] = useState(0);
  const groups = useMemo(
    () =>
      [...new Set(snippets.map((snippet) => snippet.group || "Genel"))].sort(
        (first, second) => first.localeCompare(second, "tr"),
      ),
    [snippets],
  );
  const filtered = useMemo(
    () =>
      snippets
        .filter(
          (snippet) =>
            (!group || (snippet.group || "Genel") === group) &&
            [snippet.name, snippet.command, snippet.group]
              .join(" ")
              .toLocaleLowerCase("tr")
              .includes(query.toLocaleLowerCase("tr")),
        )
        .sort((first, second) =>
          first.name.localeCompare(second.name, "tr", { numeric: true }),
        ),
    [snippets, query, group],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 30));
  const current = Math.min(page, pages - 1);
  return (
    <section
      className={"snippet-dock " + (open ? "open" : "")}
      aria-label="Oturum kestirmeleri"
    >
      <button
        className="snippet-dock-toggle"
        aria-expanded={open}
        onClick={toggle}
        title={open ? "Kestirmeleri daralt" : "Kestirmeleri aç"}
      >
        <Zap size={16} />
        <strong>Kestirmeler</strong>
        <span className="count">{snippets.length}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="snippet-dock-body">
          <p className="snippet-target" title={hostName}>
            {disabled ? "Oturum kapalı" : "Hedef: " + hostName}
          </p>
          <div className="dock-search">
            <label className="search-field">
              <Search size={14} />
              <input
                aria-label="Oturum kestirmesi ara"
                className="search-field"
                placeholder="Kestirme ara…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
              />
            </label>
            <select
              aria-label="Oturum kestirme grubu"
              value={group}
              onChange={(event) => {
                setGroup(event.target.value);
                setPage(0);
              }}
            >
              <option value="">Tüm gruplar</option>
              {groups.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </div>
          <div className="dock-snippet-list">
            {filtered.slice(current * 30, (current + 1) * 30).map((snippet) => (
              <button
                key={snippet.id}
                disabled={disabled}
                className="dock-snippet"
                title={snippet.command}
                aria-label={snippet.name + " çalıştır"}
                onClick={() => run(snippet)}
              >
                <span>
                  <strong>{snippet.name}</strong>
                  <code>{snippet.command}</code>
                  <small>
                    {snippet.group || "Genel"}
                    {snippet.confirm ? " · Onay istenir" : ""}
                  </small>
                </span>
                <Play size={15} />
              </button>
            ))}
            {!filtered.length && (
              <p className="dock-empty">
                {snippets.length
                  ? "Eşleşen kestirme yok."
                  : "Kestirmeler sayfasından komut ekle."}
              </p>
            )}
          </div>
          <div className="dock-pagination">
            <span>{filtered.length} kestirme</span>
            <button
              className="icon-button"
              title="Önceki kestirmeler"
              aria-label="Önceki kestirmeler"
              disabled={!current}
              onClick={() => setPage(current - 1)}
            >
              <ChevronLeft size={14} />
            </button>
            <span>
              {current + 1} / {pages}
            </span>
            <button
              className="icon-button"
              title="Sonraki kestirmeler"
              aria-label="Sonraki kestirmeler"
              disabled={current === pages - 1}
              onClick={() => setPage(current + 1)}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
