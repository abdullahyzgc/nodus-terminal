import { useEffect, useRef, useState } from "react";
import type { Host, LogSource, ManagedItem, Snippet } from "./shared";
import { errorText } from "./session";
import { Modal } from "./Forms";
import { renderWorkflow, workflowParameters } from "./workflows";
import "./operations.css";

export function WorkflowDialog({
  id,
  host,
  snippet,
  close,
}: {
  id: string;
  host: Host;
  snippet: Snippet;
  close: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const running = useRef(false);
  const parameters = workflowParameters(snippet.command);
  let preview = "";
  let validation = "";
  try {
    preview = renderWorkflow(snippet.command, values);
  } catch (failure) {
    validation = errorText(failure);
  }
  async function execute() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setOutput("");
    try {
      const result = await window.nodus!.runWorkflow(id, snippet.id, values);
      setOutput(result.stdout + (result.stderr ? "\n" + result.stderr : ""));
      if (result.code !== 0)
        setError("Akış başarısız. Çıkış kodu: " + result.code);
      else setOutput((current) => current + "\nAkış tamamlandı.");
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={"Komut akışı · " + snippet.name}
      close={() => {
        if (!busy) close();
      }}
    >
      <form
        className="modal-form workflow-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          void execute();
        }}
      >
        <p className={host.production ? "production-note" : "field-hint"}>
          {host.production ? "ÜRETİM · " : ""}
          {host.username}@{host.hostname}:{host.port}
        </p>
        <p className="field-hint">
          Ayrı kabukta, giriş dizininde çalışır. Gerekirse ilk adımda cd kullan.
          Her satır tek adım; hata durumunda sonraki adımlar durur. En fazla 3
          dakika. Kapanan bağlantıda uzaktaki işlem hemen durmayabilir; yeniden
          çalıştırmadan önce kontrol et.
        </p>
        <fieldset disabled={busy}>
          {parameters.map((name) => (
            <label key={name}>
              {name}
              <input
                required
                maxLength={4096}
                autoComplete="off"
                value={values[name] ?? ""}
                onChange={(event) =>
                  setValues({ ...values, [name]: event.target.value })
                }
              />
            </label>
          ))}
        </fieldset>
        <pre className="operation-output">{preview || snippet.command}</pre>
        {validation && <p className="field-hint">{validation}</p>}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {output && (
          <pre className="operation-output" aria-label="Akış sonucu">
            {output}
          </pre>
        )}
        <div className="modal-footer">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={close}
          >
            Kapat
          </button>
          <button className="primary" disabled={busy || !!validation}>
            {busy ? "Çalışıyor…" : "Önizlemeyi onayla ve çalıştır"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type LogTab = { token: string; source: LogSource; text: string; state: string };
export function OperationsPanel({
  id,
  host,
  snippets,
  disabled,
  run,
  close,
}: {
  id: string;
  host: Host;
  snippets: Snippet[];
  disabled: boolean;
  run: (snippet: Snippet) => void;
  close: () => void;
}) {
  const [tab, setTab] = useState<"docker" | "service" | "logs" | "flows">(
    "docker",
  );
  const [items, setItems] = useState<ManagedItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [logs, setLogs] = useState<LogTab[]>([]);
  const tokens = useRef(new Set<string>());
  const [activeLog, setActiveLog] = useState("");
  const [path, setPath] = useState("/var/log/syslog");
  const [filter, setFilter] = useState("");
  const [level, setLevel] = useState("all");
  const request = useRef(0);
  const alive = useRef(true);
  const locked = useRef(false);
  async function refresh(kind: "docker" | "service") {
    const version = ++request.current;
    setBusy(true);
    setError("");
    try {
      const result = await window.nodus!.managedList(id, kind);
      if (alive.current && version === request.current) setItems(result);
    } catch (failure) {
      if (alive.current && version === request.current) {
        setItems([]);
        setError(errorText(failure));
      }
    } finally {
      if (alive.current && version === request.current) setBusy(false);
    }
  }
  useEffect(() => {
    setItems([]);
    setQuery("");
    setBusy(false);
    if (!disabled && (tab === "docker" || tab === "service")) void refresh(tab);
    return () => {
      request.current++;
    };
  }, [id, tab, disabled]);
  useEffect(() => {
    alive.current = true;
    const unsubscribe = window.nodus!.onLog((event) => {
      if (event.id !== id || !tokens.current.has(event.token)) return;
      setLogs((current) =>
        current.map((item) =>
          item.token !== event.token
            ? item
            : {
                ...item,
                text:
                  event.type === "data"
                    ? (item.text + event.data).slice(-256 * 1024)
                    : item.text,
                state:
                  event.type === "error"
                    ? event.data
                    : event.type === "closed"
                      ? "Kapandı"
                      : item.state,
              },
        ),
      );
    });
    return () => {
      alive.current = false;
      unsubscribe();
      for (const token of tokens.current)
        void window.nodus!.stopLog(id, token).catch(() => {});
      tokens.current.clear();
    };
  }, [id]);
  useEffect(() => {
    if (disabled) {
      for (const token of tokens.current)
        void window.nodus!.stopLog(id, token).catch(() => {});
      setLogs((current) =>
        current.map((item) => ({ ...item, state: "Bağlantı kapalı" })),
      );
    }
  }, [disabled, id]);
  async function openLog(source: LogSource) {
    if (tokens.current.size >= 4 || disabled) {
      setError("En fazla dört günlük sekmesi açılabilir.");
      return;
    }
    const token = crypto.randomUUID();
    tokens.current.add(token);
    setTab("logs");
    setActiveLog(token);
    setError("");
    setLogs((current) => [
      ...current,
      { token, source, text: "", state: "Canlı" },
    ]);
    try {
      await window.nodus!.startLog(id, token, source);
    } catch (failure) {
      if (alive.current)
        setLogs((current) =>
          current.map((item) =>
            item.token === token
              ? { ...item, state: errorText(failure) }
              : item,
          ),
        );
    }
  }
  async function action(
    kind: "docker" | "service",
    item: ManagedItem,
    verb: "start" | "stop" | "restart",
  ) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await window.nodus!.managedAction(id, kind, item.id, verb);
      if (result.code !== 0)
        throw new Error(result.stderr || "İşlem başarısız: " + result.code);
      if (alive.current) await refresh(kind);
    } catch (failure) {
      if (alive.current) setError(errorText(failure));
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const selectedLog = logs.find((item) => item.token === activeLog);
  const logLevel = (line: string) =>
    /\b(error|fatal|panic|failed)\b/i.test(line)
      ? "error"
      : /\b(warn|warning)\b/i.test(line)
        ? "warning"
        : "info";
  return (
    <div className="operations-panel" aria-label="Sunucu yönetimi">
      <header>
        <div>
          <strong>Sunucu yönetimi</strong>
          <span>
            {host.name}
            {host.production ? " · ÜRETİM" : ""}
          </span>
        </div>
        <button className="secondary" onClick={close}>
          Terminale dön
        </button>
      </header>
      <nav aria-label="Yönetim bölümleri">
        {(
          [
            ["docker", "Docker"],
            ["service", "Servisler"],
            ["logs", "Canlı günlükler"],
            ["flows", "Komut akışları"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className={tab === value ? "active" : ""}
            disabled={busy && tab !== value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      {disabled && (
        <p className="inline-error">
          Bağlantı kapalı. Yeniden bağlandıktan sonra günlükleri tekrar aç.
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {(tab === "docker" || tab === "service") && (
        <>
          <div className="operations-tools">
            <input
              aria-label="Servis veya konteyner ara"
              placeholder="Ad veya durum ara…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button
              className="secondary"
              disabled={busy || disabled}
              onClick={() => void refresh(tab)}
            >
              Yenile
            </button>
          </div>
          <p className="field-hint">
            {tab === "docker"
              ? "Docker kurulu olmalı; SSH kullanıcısının Docker erişimi gerekir."
              : "Yüklü systemd servisleri. SSH kullanıcısının yetkileri kullanılır; otomatik sudo uygulanmaz."}
          </p>
          <div className="managed-list">
            {items
              .filter((item) =>
                [item.name, item.state, item.detail]
                  .join(" ")
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((item) => (
                <article key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.state}</span>
                    <small>{item.detail}</small>
                  </div>
                  <div className="managed-actions">
                    <button
                      disabled={disabled}
                      onClick={() =>
                        void openLog({ kind: tab, target: item.id })
                      }
                    >
                      Günlük
                    </button>
                    {(["start", "stop", "restart"] as const).map(
                      (verb, index) => (
                        <button
                          key={verb}
                          disabled={busy || disabled}
                          onClick={() => void action(tab, item, verb)}
                        >
                          {["Başlat", "Durdur", "Yeniden başlat"][index]}
                        </button>
                      ),
                    )}
                  </div>
                </article>
              ))}
            {!items.length && (
              <p>{busy ? "Liste yükleniyor…" : "Listelenecek öğe yok."}</p>
            )}
          </div>
        </>
      )}
      {tab === "flows" && (
        <div className="managed-list">
          <p className="field-hint">
            Kestirmeler bölümünde “Parametreli komut akışı” seçeneğiyle yeni
            akış oluştur.
          </p>
          {snippets
            .filter((snippet) => snippet.workflow)
            .map((snippet) => (
              <article key={snippet.id}>
                <div>
                  <strong>{snippet.name}</strong>
                  <small>{snippet.command}</small>
                </div>
                <button
                  className="secondary"
                  disabled={disabled}
                  onClick={() => run(snippet)}
                >
                  Parametreleri doldur
                </button>
              </article>
            ))}
          {!snippets.some((snippet) => snippet.workflow) && (
            <p>Henüz komut akışı yok.</p>
          )}
        </div>
      )}
      {tab === "logs" && (
        <div className="logs-view">
          <form
            className="operations-tools"
            onSubmit={(event) => {
              event.preventDefault();
              void openLog({ kind: "file", target: path });
            }}
          >
            <input
              aria-label="Günlük dosyası yolu"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="/var/log/nginx/error.log"
            />
            <button
              className="secondary"
              disabled={disabled || logs.length >= 4}
            >
              Dosyayı izle
            </button>
          </form>
          <div className="log-tabs">
            {logs.map((item) => (
              <div
                key={item.token}
                className={item.token === activeLog ? "active" : ""}
              >
                <button
                  title={item.source.target}
                  onClick={() => setActiveLog(item.token)}
                >
                  {item.source.target}
                </button>
                <button
                  aria-label={item.source.target + " günlüğünü kapat"}
                  onClick={() => {
                    tokens.current.delete(item.token);
                    void window.nodus!.stopLog(id, item.token).catch(() => {});
                    setLogs((current) =>
                      current.filter((entry) => entry.token !== item.token),
                    );
                    if (activeLog === item.token)
                      setActiveLog(
                        logs.find((entry) => entry.token !== item.token)
                          ?.token ?? "",
                      );
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="operations-tools">
            <input
              aria-label="Günlükte ara"
              placeholder="Günlükte ara…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <select
              aria-label="Günlük seviyesi"
              value={level}
              onChange={(event) => setLevel(event.target.value)}
            >
              <option value="all">Tüm seviyeler</option>
              <option value="error">Hatalar</option>
              <option value="warning">Uyarılar</option>
              <option value="info">Diğer</option>
            </select>
            <button
              className="secondary"
              disabled={!selectedLog}
              onClick={() => {
                if (selectedLog) {
                  void window
                    .nodus!.stopLog(id, selectedLog.token)
                    .catch(() => {});
                  setLogs((current) =>
                    current.map((item) =>
                      item.token === activeLog
                        ? { ...item, state: "Durduruldu" }
                        : item,
                    ),
                  );
                }
              }}
            >
              Durdur
            </button>
            <button
              className="secondary"
              onClick={() =>
                setLogs((current) =>
                  current.map((item) =>
                    item.token === activeLog ? { ...item, text: "" } : item,
                  ),
                )
              }
            >
              Ekranı temizle
            </button>
          </div>
          <p className="field-hint">
            {selectedLog?.state ?? "Dosya, Docker veya servis günlüğü aç."} ·
            Sekme başına son 256 KB bellekte tutulur; diske kaydedilmez.
          </p>
          <pre className="live-log" aria-label="Canlı günlük çıktısı">
            {selectedLog?.text
              .split("\n")
              .filter(
                (line) =>
                  line.toLowerCase().includes(filter.toLowerCase()) &&
                  (level === "all" || logLevel(line) === level),
              )
              .slice(-2000)
              .map((line, index) => (
                <span key={index} className={"log-" + logLevel(line)}>
                  {line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")}
                  {"\n"}
                </span>
              ))}
          </pre>
        </div>
      )}
    </div>
  );
}
