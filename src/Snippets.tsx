import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  Zap,
} from "lucide-react";
import type { Snippet } from "./shared";

export function Snippets({
  snippets,
  add,
  edit,
  remove,
  run,
  activeName,
}: {
  snippets: Snippet[];
  add: () => void;
  edit: (snippet: Snippet) => void;
  remove: (snippet: Snippet) => void;
  run: (snippet: Snippet) => void;
  activeName?: string;
}) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [sort, setSort] = useState("group");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const groups = useMemo(
    () =>
      [...new Set(snippets.map((snippet) => snippet.group || "Genel"))].sort(
        (first, second) => first.localeCompare(second, "tr"),
      ),
    [snippets],
  );
  const filtered = useMemo(() => {
    const search = query.toLocaleLowerCase("tr");
    return snippets
      .filter(
        (snippet) =>
          (!group || (snippet.group || "Genel") === group) &&
          [snippet.name, snippet.command, snippet.group]
            .join(" ")
            .toLocaleLowerCase("tr")
            .includes(search),
      )
      .sort(
        (first, second) =>
          (sort === "group"
            ? (first.group || "Genel").localeCompare(
                second.group || "Genel",
                "tr",
              )
            : 0) ||
          first.name.localeCompare(second.name, "tr", { numeric: true }) ||
          first.id.localeCompare(second.id),
      );
  }, [snippets, query, group, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const start = currentPage * pageSize;
  return (
    <div className="page snippets-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">TEKRAR YAZMA</span>
          <h1>
            Komut kestirmeleri<span className="green">.</span>
          </h1>
          <p>
            {activeName
              ? "Hedef oturum: " + activeName
              : "Çalıştırmak için önce bir sunucuya bağlan."}
          </p>
        </div>
        <button className="primary" onClick={add}>
          <Plus size={16} />
          Yeni kestirme
        </button>
      </div>
      <div className="snippet-filters">
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Kestirme ara"
            className="search-field"
            placeholder="Ad, komut veya grup ara…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <select
          aria-label="Kestirme grubu"
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
        <select
          aria-label="Kestirme sıralaması"
          value={sort}
          onChange={(event) => {
            setSort(event.target.value);
            setPage(0);
          }}
        >
          <option value="group">Grup, sonra ad</option>
          <option value="name">Ada göre</option>
        </select>
        <span className="count">{filtered.length}</span>
      </div>
      {filtered.length ? (
        <>
          <div className="snippet-table-wrap">
            <table className="snippet-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Kestirme / Komut</th>
                  <th scope="col">Grup</th>
                  <th scope="col">Onay</th>
                  <th scope="col">İşlemler</th>
                </tr>
              </thead>
              <tbody>
                {filtered
                  .slice(start, start + pageSize)
                  .map((snippet, index) => (
                    <tr key={snippet.id}>
                      <td className="snippet-index">{start + index + 1}</td>
                      <td>
                        <h3 title={snippet.name}>{snippet.name}</h3>
                        <code title={snippet.command}>{snippet.command}</code>
                      </td>
                      <td>
                        <span
                          className="snippet-group-tag"
                          title={snippet.group || "Genel"}
                        >
                          {snippet.group || "Genel"}
                        </span>
                      </td>
                      <td>
                        <span
                          className={
                            "snippet-confirm " +
                            (snippet.confirm ? "enabled" : "")
                          }
                        >
                          {snippet.confirm ? "İstenir" : "Yok"}
                        </span>
                      </td>
                      <td>
                        <div className="snippet-actions">
                          <button
                            className="snippet-run"
                            disabled={!activeName}
                            aria-label={snippet.name + " çalıştır"}
                            title={
                              activeName
                                ? activeName + " üzerinde çalıştır"
                                : "Çalıştırmak için bağlan"
                            }
                            onClick={() => run(snippet)}
                          >
                            <Play size={14} />
                          </button>
                          <button
                            className="icon-button"
                            title="Düzenle"
                            aria-label={snippet.name + " düzenle"}
                            onClick={() => edit(snippet)}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="icon-button danger-hover"
                            title="Sil"
                            aria-label={snippet.name + " sil"}
                            onClick={() => remove(snippet)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="snippet-pagination">
            <span>
              {start + 1}–{Math.min(start + pageSize, filtered.length)} /{" "}
              {filtered.length} kestirme
            </span>
            <label>
              Sayfada
              <select
                aria-label="Sayfadaki kestirme sayısı"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(0);
                }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
            <button
              className="icon-button"
              aria-label="Önceki sayfa"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              {currentPage + 1} / {pages}
            </span>
            <button
              className="icon-button"
              aria-label="Sonraki sayfa"
              disabled={currentPage === pages - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </>
      ) : (
        <div className="empty-state">
          <Zap size={32} />
          <h2>Eşleşen kestirme yok.</h2>
          <p>Aramayı değiştir veya yeni kestirme ekle.</p>
        </div>
      )}
    </div>
  );
}
