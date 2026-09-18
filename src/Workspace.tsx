import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  Cpu,
  Folder,
  HardDrive,
  MemoryStick,
  ArrowDown,
  ArrowUp,
  Zap,
  Settings2,
} from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import type { Connection, Host, ServerStats, Snippet } from "./shared";
import { errorText, sessionSnapshot, subscribeSession } from "./session";
import { usageBetween } from "./stats";
import { OperationsPanel } from "./OperationsPanel";
import { SessionControls } from "./SessionControls";
import { FilePanel } from "./FilePanel";
import { SnippetPanel } from "./SnippetPanel";
import { observeTerminalAppearance, terminalAppearance } from "./appearance";
import { installTerminalClipboard } from "./terminal-clipboard";

export function Workspace({
  connection,
  host,
  active,
  notify,
  close,
  snippets,
  run,
}: {
  connection: Connection;
  host: Host;
  snippets: Snippet[];
  run: (snippet: Snippet) => void;
  active: boolean;
  notify: (text: string) => void;
  close: () => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [closed, setClosed] = useState(sessionSnapshot(connection.id).closed);
  const [persistentSession, setPersistentSession] = useState(sessionSnapshot(connection.id).persistentSession ?? connection.persistentSession ?? false);
  const [operations, setOperations] = useState(false);
  const [terminalAllowed, setTerminalAllowed] = useState(!host.production);
  const [files, setFiles] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const toolsOpen = files || snippetsOpen;
  const [cwd, setCwd] = useState(sessionSnapshot(connection.id).cwd);
  const body = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [fileWidth, setFileWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("nodus-sftp-width"));
      return saved >= 280 && saved <= 1600 ? saved : 360;
    } catch {
      return 360;
    }
  });
  const [bodyWidth, setBodyWidth] = useState(1000);
  const maximumWidth = Math.max(240, bodyWidth - 220);
  const minimumWidth = Math.min(280, maximumWidth);
  const actualWidth = Math.max(minimumWidth, Math.min(fileWidth, maximumWidth));
  function changeWidth(width: number) {
    const next = Math.round(
      Math.max(minimumWidth, Math.min(width, maximumWidth)),
    );
    setFileWidth(next);
    try {
      localStorage.setItem("nodus-sftp-width", String(next));
    } catch {}
  }
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width) setBodyWidth(entry.contentRect.width);
    });
    observer.observe(body.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false,
      ...terminalAppearance(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element.current!);
    terminal.write(sessionSnapshot(connection.id).output);
    fitRef.current = fit;
    terminalRef.current = terminal;
    const resize = () => {
      if (
        element.current &&
        element.current.clientWidth > 0 &&
        element.current.clientHeight > 0
      ) {
        fit.fit();
        window.nodus!.resize(connection.id, terminal.cols, terminal.rows);
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element.current!);
    const input = terminal.onData((data) =>
      window.nodus!.input(connection.id, data),
    );
    const stopClipboard = installTerminalClipboard(terminal, window.nodus!, notify, () => !sessionSnapshot(connection.id).closed);
    const unsubscribe = subscribeSession(connection.id, (event) => {
      if (event.type === "data") terminal.write(event.data);
      if (event.type === "ready") {
        setPersistentSession(event.persistentSession ?? false);
        setClosed(false);
        setTerminalAllowed(!host.production);
        resize();
      }
      if (event.type === "authorized") setTerminalAllowed(true);
      if (event.type === "cwd") setCwd(event.data);
      if (event.type === "closed") {
        setClosed(true);
        terminal.write("\r\n\x1b[90mOturum kapand\u0131.\x1b[0m\r\n");
      }
      if (event.type === "error") notify(event.data);
    });
    const stopAppearance = observeTerminalAppearance(terminal, resize);
    return () => {
      stopClipboard();
      stopAppearance();
      unsubscribe();
      observer.disconnect();
      input.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [connection.id]);
  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => {
        fitRef.current?.fit();
        terminalRef.current?.focus();
      });
    }
  }, [active, files, snippetsOpen, operations, terminalAllowed]);
  return (
    <section
      className={
        "workspace " +
        (active ? "" : "inactive") +
        (host.production ? " production" : "")
      }
      aria-label={connection.name + " \u00e7al\u0131\u015fma alan\u0131"}
    >
      <div className="workspace-toolbar">
        <div className="connection-label">
          <span className={"status-dot " + (closed ? "offline" : "")} />
          <strong>
            {host.username}@{host.hostname}
          </strong>
          <span className="muted">:{host.port}</span>
        </div>
        <div className="toolbar-actions">
          <button
            className={"icon-button " + (operations ? "selected" : "")}
            title="Sunucu yönetimi panelini aç veya kapat"
            aria-label="Sunucu yönetimi panelini aç veya kapat"
            aria-pressed={operations}
            onClick={() => setOperations(!operations)}
          >
            <Settings2 size={17} />
          </button>
          <button
            className={"icon-button " + (files ? "selected" : "")}
            title="Dosya panelini aç veya kapat"
            aria-label="Dosya panelini aç veya kapat"
            aria-pressed={files}
            onClick={() => setFiles(!files)}
          >
            <Folder size={17} />
          </button>
          <button
            className={"icon-button " + (snippetsOpen ? "selected" : "")}
            title="Oturum kestirmelerini aç veya kapat"
            aria-label="Oturum kestirmelerini aç veya kapat"
            aria-pressed={snippetsOpen}
            onClick={() => setSnippetsOpen(!snippetsOpen)}
          >
            <Zap size={17} />
          </button>
        </div>
      </div>
      <SessionControls
        id={connection.id}
        host={host}
        persistentSession={persistentSession}
        closed={closed}
        close={close}
        allowed={terminalAllowed}
        allow={() => setTerminalAllowed(true)}
      />
      <div
        ref={body}
        style={{ "--file-panel-width": actualWidth + "px" } as CSSProperties}
        className={"workspace-body " + (toolsOpen ? "with-files" : "")}
      >
        {operations && (
          <OperationsPanel
            id={connection.id}
            host={host}
            snippets={snippets}
            disabled={closed}
            run={run}
            close={() => setOperations(false)}
          />
        )}
        <div className="terminal-column">
          <div
            ref={element}
            className="terminal-surface"
            data-testid="terminal"
          />
          {!closed && host.production && !terminalAllowed && (
            <div className="terminal-guard">
              Üretim sunucusu. Girdi için üstteki “Üretim terminalini aç”
              düğmesini kullan.
            </div>
          )}
          <StatsBar id={connection.id} disabled={closed} />
        </div>
        {toolsOpen && (
          <div
            role="separator"
            tabIndex={0}
            aria-label="SFTP panel genişliği"
            aria-orientation="vertical"
            aria-valuemin={minimumWidth}
            aria-valuemax={maximumWidth}
            aria-valuenow={actualWidth}
            className="file-resizer"
            title="SFTP alanını büyütmek için sola sürükle"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              dragging.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              event.preventDefault();
            }}
            onPointerMove={(event) => {
              if (dragging.current && body.current)
                changeWidth(
                  body.current.getBoundingClientRect().right - event.clientX,
                );
            }}
            onPointerUp={(event) => {
              dragging.current = false;
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onLostPointerCapture={() => {
              dragging.current = false;
            }}
            onPointerCancel={() => {
              dragging.current = false;
            }}
            onDoubleClick={() => changeWidth(360)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                changeWidth(
                  actualWidth + (event.key === "ArrowLeft" ? 30 : -30),
                );
              }
            }}
          />
        )}
        <div
          className={
            "file-panel-container workspace-tools " +
            (toolsOpen ? "" : "collapsed") +
            (snippetsOpen ? " snippets-expanded" : "")
          }
        >
          <div className={"sftp-slot " + (files ? "" : "collapsed")}>
            <FilePanel
              id={connection.id}
              cwd={cwd}
              followDefault={host.followDirectory}
              disabled={closed}
              notify={notify}
              close={() => setFiles(false)}
            />
          </div>
          <SnippetPanel
            snippets={snippets}
            open={snippetsOpen}
            toggle={() => setSnippetsOpen(!snippetsOpen)}
            run={run}
            disabled={closed}
            hostName={host.name}
          />
        </div>
      </div>
    </section>
  );
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "-";
  if (value < 1024) return Math.floor(value) + " B";
  if (value < 1048576) return (value / 1024).toFixed(1) + " KB";
  if (value < 1073741824) return (value / 1048576).toFixed(1) + " MB";
  return (value / 1073741824).toFixed(2) + " GB";
}

function StatsBar({ id, disabled }: { id: string; disabled: boolean }) {
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [rates, setRates] = useState<{
    cpu: number | null;
    rx: number;
    tx: number;
  }>({ cpu: null, rx: 0, tx: 0 });
  const [error, setError] = useState("");
  useEffect(() => {
    setStats(null);
    setError("");
    setRates({ cpu: null, rx: 0, tx: 0 });
    if (disabled) return;
    let alive = true;
    let previous: { stats: ServerStats; at: number } | null = null;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const next = await window.nodus!.stats(id);
        if (!alive) return;
        const now = performance.now();
        if (previous)
          setRates(
            usageBetween(previous.stats, next, (now - previous.at) / 1000),
          );
        previous = { stats: next, at: now };
        setStats(next);
        setError("");
      } catch (failure) {
        if (alive) {
          setStats(null);
          previous = null;
          setRates({ cpu: null, rx: 0, tx: 0 });
          setError(errorText(failure));
        }
      } finally {
        if (alive) timer = setTimeout(() => void tick(), 5000);
      }
    }
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id, disabled]);
  if (!stats)
    return (
      <div className="statsbar statsbar-empty" title={error}>
        <Cpu size={13} />
        <span>
          {disabled
            ? "Oturum kapalı"
            : error
              ? "Sistem bilgisi alınamadı. Linux /proc ve free/df desteği gerekir; yeniden denenecek."
              : "Sistem bilgisi bekleniyor…"}
        </span>
      </div>
    );
  const ramPct =
    stats.memTotal > 0
      ? Math.min(100, Math.round((stats.memUsed / stats.memTotal) * 100))
      : 0;
  const diskPct =
    stats.diskTotal > 0
      ? Math.min(100, Math.round((stats.diskUsed / stats.diskTotal) * 100))
      : 0;
  return (
    <div
      className="statsbar"
      title={"Sunucu durumu (5 sn de bir g\u00fcncellenir)"}
    >
      <span
        className="stat"
        title={
          "CPU kullanımı · 1 dakika yük ortalaması: " + stats.load1.toFixed(2)
        }
      >
        <Cpu size={13} />
        <span>CPU</span>
        <strong>{rates.cpu === null ? "Ölçülüyor…" : rates.cpu + "%"}</strong>
        <span className="meter">
          <span style={{ width: (rates.cpu ?? 0) + "%" }} />
        </span>
      </span>
      <span className="stat-sep" />
      <span className="stat">
        <MemoryStick size={13} />
        <span>RAM</span>
        <strong>
          {formatBytes(stats.memUsed) + " / " + formatBytes(stats.memTotal)}
        </strong>
        <span className="meter">
          <span style={{ width: ramPct + "%" }} />
        </span>
      </span>
      <span className="stat-sep" />
      <span className="stat">
        <HardDrive size={13} />
        <span>Disk</span>
        <strong>
          {formatBytes(stats.diskUsed) + " / " + formatBytes(stats.diskTotal)}
        </strong>
        <span className="meter">
          <span style={{ width: diskPct + "%" }} />
        </span>
      </span>
      <span className="stat-sep" />
      <span className="stat">
        <ArrowDown size={13} />
        <strong>{formatBytes(rates.rx) + "/s"}</strong>
        <ArrowUp size={13} />
        <strong>{formatBytes(rates.tx) + "/s"}</strong>
      </span>
    </div>
  );
}
