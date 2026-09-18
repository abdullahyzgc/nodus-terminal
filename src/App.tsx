import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Code2,
  Folder,
  LayoutGrid,
  LockKeyhole,
  Menu,
  Minus,
  Plus,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Square,
  Star,
  TerminalSquare,
  X,
  Zap,
} from "lucide-react";
import type { Connection, Host, Snippet, Status, Vault } from "./shared";
import { HostForm, Modal, QuickConnect, SnippetForm, VaultGate } from "./Forms";
import { Settings } from "./Settings";
import { UpdateNotice } from "./Updates";
import { Hosts, Snippets } from "./Library";
import { Workspace } from "./Workspace";
import { WorkflowDialog } from "./OperationsPanel";
import { ConnectionPrompt } from "./ConnectionPrompt";
import {
  clearSessions,
  errorText,
  forgetSession,
  sessionSnapshot,
  startSessions,
} from "./session";
import packageJson from "../package.json";

type Page = "hosts" | "snippets" | "settings" | "terminal";
type OpenConnection = Connection & {
  host: Host;
  phase: "connecting" | "password" | "failed" | "ready";
  message?: string;
};
type Question = {
  title: string;
  detail: string;
  action: string;
  resolve: (result: boolean) => void;
};

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [vault, writeVault] = useState<Vault | null>(null);
  const locked = useRef(true);
  const setVault = useCallback((next: Vault) => {
    if (!locked.current) writeVault(next);
  }, []);
  const acceptVault = useCallback((next: Vault) => {
    locked.current = false;
    writeVault(next);
  }, []);
  const [startupError, setStartupError] = useState("");
  const [page, setPage] = useState<Page>("hosts");
  const [group, setGroup] = useState("all");
  const [query, setQuery] = useState("");
  const [hostForm, setHostForm] = useState<Host | "new" | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [snippetForm, setSnippetForm] = useState<Snippet | "new" | null>(null);
  const [connections, setConnections] = useState<OpenConnection[]>([]);
  const [workflow, setWorkflow] = useState<{
    id: string;
    host: Host;
    snippet: Snippet;
  } | null>(null);
  const [active, setActive] = useState("");
  const [rdpBusy, setRdpBusy] = useState<string[]>([]);
  const connecting = [
    ...connections
      .filter((connection) => connection.phase === "connecting")
      .map((connection) => connection.hostId),
    ...rdpBusy,
  ];
  const [toast, setToast] = useState("");
  const [question, setQuestion] = useState<Question | null>(null);
  const questionRef = useRef(question);
  questionRef.current = question;
  const [palette, setPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [navigation, setNavigation] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const pending = useRef(new Set<string>());
  function isAuthError(error: unknown): boolean {
    return /authenticat|all configured|wrong password|permission denied/i.test(
      errorText(error),
    );
  }
  const generation = useRef(0);
  const notify = useCallback((text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 6500);
  }, []);
  const ask = (title: string, detail: string, action: string) =>
    new Promise<boolean>((resolve) =>
      setQuestion({ title, detail, action, resolve }),
    );
  function answer(result: boolean) {
    question?.resolve(result);
    setQuestion(null);
  }
  useEffect(() => {
    startSessions();
    if (!window.nodus) return;
    const initialGeneration = generation.current;
    window.nodus
      .status()
      .then(async (state) => {
        if (generation.current !== initialGeneration) return;
        setStatus(state);
        if (state.unlocked) {
          const next = await window.nodus!.read();
          if (generation.current === initialGeneration) acceptVault(next);
        }
      })
      .catch((error) => {
        if (generation.current === initialGeneration)
          setStartupError(errorText(error));
      });
    const unsubscribeLock = window.nodus.onLocked((state) => {
      locked.current = true;
      generation.current++;
      pending.current.clear();
      clearSessions();
      questionRef.current?.resolve(false);
      setQuestion(null);
      setWorkflow(null);
      setConnections([]);
      setActive("");
      writeVault(null);
      setStatus(state);
      setQuickOpen(false);
      setHostForm(null);
      setSnippetForm(null);
      setPalette(false);
      setPaletteQuery("");
      setQuery("");
      setPage("hosts");
      notify("Kasa kilitlendi. Devam etmek için kasa parolanı gir.");
    });
    const unsubscribe = window.nodus.onVault((next) => {
      if (locked.current) return;
      generation.current++;
      clearSessions();
      pending.current.clear();
      setWorkflow(null);
      setConnections([]);
      setQuickOpen(false);
      setActive("");
      setVault(next);
      setHostForm(null);
      setSnippetForm(null);
      setPage((current) => (current === "terminal" ? "hosts" : current));
      notify(
        "Drive değişiklikleri alındı. Güvenlik için açık SSH oturumları kapatıldı.",
      );
    });
    return () => {
      unsubscribe();
      unsubscribeLock();
      clearTimeout(toastTimer.current);
    };
  }, []);
  async function connect(host: Host, password?: string) {
    if (host.protocol === "rdp") {
      const requestId = "rdp-" + host.id;
      if (pending.current.has(requestId)) return;
      const currentGeneration = generation.current;
      pending.current.add(requestId);
      setRdpBusy((current) => current.includes(host.id) ? current : [...current, host.id]);
      setPalette(false);
      setNavigation(false);
      try {
        const opened = await window.nodus!.openRdp(host.id);
        if (opened && currentGeneration === generation.current) notify("Windows Uzak Masaüstü başlatıldı. Bağlantı durumunu açılan pencereden takip et.");
      } catch (error) {
        if (currentGeneration === generation.current) notify(errorText(error));
      } finally { pending.current.delete(requestId); setRdpBusy((current) => current.filter((id) => id !== host.id)); }
      return;
    }
    const waiting =
      host.authType === "password" && !(password ?? host.password);
    const connection: OpenConnection = {
      id: "pending-" + crypto.randomUUID(),
      hostId: host.id,
      name: host.name,
      host: { ...host, password: "", privateKey: "", passphrase: "" },
      phase: waiting ? "password" : "connecting",
    };
    setConnections((current) => [...current, connection]);
    setActive(connection.id);
    setPage("terminal");
    setNavigation(false);
    setPalette(false);
    if (!waiting) await attemptConnection(connection, password);
  }
  async function attemptConnection(slot: OpenConnection, password?: string) {
    if (pending.current.has(slot.id)) return;
    const currentGeneration = generation.current;
    pending.current.add(slot.id);
    setConnections((current) =>
      current.map((item) =>
        item.id === slot.id
          ? { ...item, phase: "connecting", message: "" }
          : item,
      ),
    );
    try {
      const connection = await window.nodus!.connect(slot.hostId, password);
      if (
        currentGeneration !== generation.current ||
        !pending.current.has(slot.id)
      ) {
        await window.nodus!.disconnect(connection.id);
        forgetSession(connection.id);
        return;
      }
      setConnections((current) =>
        current.map((item) =>
          item.id === slot.id
            ? { ...connection, host: slot.host, phase: "ready" }
            : item,
        ),
      );
      setActive((current) => (current === slot.id ? connection.id : current));
      try {
        const next = await window.nodus!.read();
        if (currentGeneration === generation.current) setVault(next);
      } catch (error) {
        if (currentGeneration === generation.current) notify(errorText(error));
      }
    } catch (error) {
      if (
        currentGeneration !== generation.current ||
        !pending.current.has(slot.id)
      )
        return;
      const authFailed =
        slot.host.authType === "password" && isAuthError(error);
      setConnections((current) =>
        current.map((item) =>
          item.id === slot.id
            ? {
                ...item,
                phase: authFailed ? "password" : "failed",
                message: authFailed
                  ? "Parola kabul edilmedi. Yeni parolayı girerek devam et."
                  : errorText(error),
              }
            : item,
        ),
      );
    } finally {
      pending.current.delete(slot.id);
    }
  }
  async function quickConnect(input: {
    hostname: string;
    port: number;
    username: string;
    password: string;
  }) {
    const host: Host = {
      id: crypto.randomUUID(),
      name: input.hostname,
      hostname: input.hostname,
      port: input.port,
      username: input.username,
      group: "Diğer",
      color: "#8aacf2",
      authType: "password",
      password: input.password,
      privateKey: "",
      passphrase: "",
      favorite: false,
      initialPath: "",
      followDirectory: true,
      persistentSession: true,
    };
    setVault(await window.nodus!.saveHost(host));
    setQuickOpen(false);
    await connect(host, input.password || undefined);
  }
  async function closeConnection(connection: Connection) {
    if (
      connections.find((item) => item.id === connection.id)?.phase ===
        "ready" &&
      !sessionSnapshot(connection.id).closed &&
      !(await ask(
        "Oturum kapatılsın mı?",
        connection.name +
          " bağlantısı kesilecek. Çalışan komutlar etkilenebilir.",
        "Bağlantıyı kapat",
      ))
    )
      return;
    try {
      pending.current.delete(connection.id);
      await window.nodus!.disconnect(connection.id);
      forgetSession(connection.id);
      setConnections((current) =>
        current.filter((item) => item.id !== connection.id),
      );
      if (active === connection.id) {
        const remaining = connections.filter(
          (item) => item.id !== connection.id,
        );
        setActive(remaining.at(-1)?.id ?? "");
        if (!remaining.length) setPage("hosts");
      }
    } catch (error) {
      notify(errorText(error));
    }
  }
  async function lock() {
    if (
      connections.length &&
      !(await ask(
        "Kasa kilitlensin mi?",
        "Açık SSH oturumları kapatılır. Bu cihazda otomatik açma kapatılır; tekrar girişte kasa parolan gerekir.",
        "Kasayı kilitle",
      ))
    )
      return;
    try {
      await window.nodus!.lock();
    } catch (error) {
      notify(errorText(error));
    }
  }
  async function run(snippet: Snippet, targetId = active) {
    const connection = connections.find((item) => item.id === targetId);
    if (
      !connection ||
      connection.phase !== "ready" ||
      sessionSnapshot(connection.id).closed
    ) {
      notify("Önce bir sunucuya bağlan.");
      return;
    }
    const currentGeneration = generation.current;
    setPalette(false);
    if (snippet.workflow) {
      setWorkflow({ id: connection.id, host: connection.host, snippet });
      return;
    }
    if (
      (snippet.confirm || connection.host.production) &&
      !(await ask(
        "Komut çalıştırılsın mı?",
        connection.name +
          "\n\n" +
          snippet.command +
          "\n\nDoğru dizinde ve kabuk isteminde olduğundan emin ol.",
        "Çalıştır",
      ))
    )
      return;
    if (
      currentGeneration !== generation.current ||
      sessionSnapshot(connection.id).closed
    ) {
      notify("Oturum kapandı. Komut gönderilmedi.");
      return;
    }
    if (connection.host.production) {
      try {
        if (!(await window.nodus!.authorizeTerminal(connection.id))) return;
      } catch (failure) {
        notify(errorText(failure));
        return;
      }
    }
    if (
      currentGeneration !== generation.current ||
      sessionSnapshot(connection.id).closed
    )
      return;
    setActive(connection.id);
    setPage("terminal");
    window.nodus!.input(
      connection.id,
      snippet.command.replace(/\r?\n/g, "\r") + "\r",
    );
  }
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!vault || document.querySelector("dialog[open]")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteQuery("");
        setPalette(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setHostForm("new");
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "l"
      ) {
        event.preventDefault();
        void lock();
      }
      if (
        event.key === "/" &&
        page === "hosts" &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        document
          .querySelector<HTMLInputElement>('[aria-label="Sunucu ara"]')
          ?.focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [vault, connections, page]);
  const groups = [
    ...new Set(vault?.hosts.map((host) => host.group) ?? []),
  ].sort();
  const go = (next: Page) => {
    setPage(next);
    setNavigation(false);
    setQuery("");
  };
  const closeNavigation = () => {
    setNavigation(false);
    const selector = window.matchMedia("(max-width: 950px)").matches
      ? ".compact-nav-toggle"
      : ".sidebar-edge";
    document.querySelector<HTMLButtonElement>(selector)?.focus();
  };
  useEffect(() => {
    if (!navigation) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
      const sidebar = document.querySelector("#workspace-sidebar");
      if (!sidebar || getComputedStyle(sidebar).visibility !== "visible") return;
      event.preventDefault();
      event.stopPropagation();
      closeNavigation();
    };
    document.addEventListener("keydown", dismiss, true);
    return () => document.removeEventListener("keydown", dismiss, true);
  }, [navigation]);
  async function removeHost(host: Host) {
    if (connections.some((connection) => connection.hostId === host.id)) {
      notify("Önce bu sunucunun açık sekmelerini kapat.");
      return;
    }
    if (
      await ask(
        "Sunucu silinsin mi?",
        host.name +
          " kaydı ve kayıtlı giriş bilgileri kasadan silinir. Sunucunun kendisi etkilenmez.",
        "Kaydı sil",
      )
    ) {
      try {
        setVault(await window.nodus!.deleteHost(host.id));
      } catch (error) {
        notify(errorText(error));
      }
    }
  }
  async function removeSnippet(snippet: Snippet) {
    if (
      await ask(
        "Kestirme silinsin mi?",
        snippet.name + " kasadan silinir.",
        "Sil",
      )
    ) {
      try {
        setVault(await window.nodus!.deleteSnippet(snippet.id));
      } catch (error) {
        notify(errorText(error));
      }
    }
  }
  const focusMode =
    page === "terminal" &&
    connections.some(
      (connection) => connection.id === active && connection.phase === "ready",
    );
  const versionNumber = packageJson?.version;
  return (
    <div className={"app " + (focusMode ? "focus-mode" : "")}>
      <header className="titlebar">
        <div className="wordmark">
          <div className="brand-mark">n</div>
          <span>nodus</span>
          <span className="title-divider" />
          <span className="title-caption">V{versionNumber}</span>
        </div>
        <div className="title-right">
          <span className="private-tag">
            <ShieldCheck size={12} />
            PRIVATE
          </span>
          <div className="window-controls">
            <button
              aria-label="Küçült"
              onClick={() => window.nodus?.window("minimize")}
            >
              <Minus size={15} />
            </button>
            <button
              aria-label="Büyüt veya geri yükle"
              onClick={() => window.nodus?.window("maximize")}
            >
              <Square size={11} />
            </button>
            <button
              aria-label="Uygulamayı kapat"
              onClick={() => window.nodus?.window("close")}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </header>
      {!window.nodus ? (
        <div className="browser-notice">
          <h1>Nodus masaüstünde çalışır.</h1>
          <p>SSH bağlantıları ve şifreli kasa için Nodus uygulamasını aç.</p>
        </div>
      ) : startupError ? (
        <div className="browser-notice">
          <h1>Nodus açılamadı.</h1>
          <p role="alert">{startupError}</p>
        </div>
      ) : !status ? (
        <div className="loading-screen">Kasa kontrol ediliyor…</div>
      ) : !vault ? (
        <VaultGate status={status} ready={acceptVault} imported={setStatus} />
      ) : (
        <div className="app-layout">
          <nav className="compact-navigation" aria-label="Hızlı gezinme">
            <button
              className="rail-button compact-nav-toggle"
              aria-label="Menüyü aç"
              title="Menüyü aç"
              aria-controls="workspace-sidebar"
              aria-expanded={navigation}
              onClick={() => {
                if (navigation) closeNavigation();
                else {
                  setNavigation(true);
                  requestAnimationFrame(() => document.querySelector<HTMLButtonElement>("#workspace-sidebar .sidebar-close")?.focus());
                }
              }}
            ><Menu size={20} /></button>
            <button className={"rail-button " + (page === "hosts" && group !== "favorites" ? "active" : "")} aria-label="Sunucular" title="Sunucular" aria-current={page === "hosts" && group !== "favorites" ? "page" : undefined} onClick={() => { setGroup("all"); go("hosts"); }}><Server size={20} /></button>
            <button className={"rail-button " + (page === "hosts" && group === "favorites" ? "active" : "")} aria-label="Favoriler" title="Favoriler" aria-current={page === "hosts" && group === "favorites" ? "page" : undefined} onClick={() => { setGroup("favorites"); go("hosts"); }}><Star size={20} /></button>
            <button className={"rail-button " + (page === "snippets" ? "active" : "")} aria-label="Kestirmeler" title="Kestirmeler" aria-current={page === "snippets" ? "page" : undefined} onClick={() => go("snippets")}><Zap size={20} /></button>
            <button className="rail-button" aria-label="Hızlı erişim" title="Hızlı erişim (Ctrl+K)" onClick={() => { setNavigation(false); setPaletteQuery(""); setPalette(true); }}><Search size={20} /></button>
            <div className="spacer" />
            <button className={"rail-button " + (page === "settings" ? "active" : "")} aria-label="Ayarlar" title="Ayarlar" aria-current={page === "settings" ? "page" : undefined} onClick={() => go("settings")}><Settings2 size={20} /></button>
            <button className="rail-button" aria-label="Kasayı kilitle" title="Kasayı kilitle" onClick={() => void lock()}><LockKeyhole size={20} /></button>
          </nav>
          {focusMode && (
            <button
              className="sidebar-edge"
              aria-label="Sol menüyü aç"
              aria-controls="workspace-sidebar"
              aria-expanded={navigation}
              title="Sol menüyü aç"
              onClick={() => setNavigation(!navigation)}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") setNavigation(true);
              }}
            >
              <ChevronRight size={12} />
            </button>
          )}
          <aside
            id="workspace-sidebar"
            onPointerLeave={(event) => {
              if (
                focusMode &&
                !window.matchMedia("(max-width: 950px)").matches &&
                event.pointerType === "mouse" &&
                !event.currentTarget.contains(document.activeElement)
              )
                setNavigation(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeNavigation();
              }
            }}
            className={"sidebar " + (navigation ? "mobile-open" : "")}
          >
            <div className="sidebar-heading">
              <div>
                <span className="eyebrow">WORKSPACE</span>
                <h2>
                  Benim alanım
                  <span className="status-dot" />
                </h2>
              </div>
              <button
                className="icon-button sidebar-close"
                aria-label="Menüyü kapat"
                onClick={closeNavigation}
              >
                <X size={16} />
              </button>
            </div>
            <button
              className="sidebar-search"
              onClick={() => {
                setPaletteQuery("");
                setPalette(true);
              }}
            >
              <Search size={15} />
              <span>Hızlı erişim</span>
              <kbd>Ctrl K</kbd>
            </button>
            <div className="nav-label">KÜTÜPHANE</div>
            <button
              className={
                "nav-item " +
                (group === "all" && page === "hosts" ? "active" : "")
              }
              onClick={() => {
                setGroup("all");
                go("hosts");
              }}
            >
              <Server size={17} />
              <span>Tüm sunucular</span>
              <span className="count">{vault.hosts.length}</span>
            </button>
            <button
              className={
                "nav-item " +
                (group === "favorites" && page === "hosts" ? "active" : "")
              }
              onClick={() => {
                setGroup("favorites");
                go("hosts");
              }}
            >
              <Star size={17} />
              <span>Favoriler</span>
              <span className="count">
                {vault.hosts.filter((host) => host.favorite).length}
              </span>
            </button>
            <button
              className={"nav-item " + (page === "snippets" ? "active" : "")}
              onClick={() => go("snippets")}
            >
              <Zap size={17} />
              <span>Komut kestirmeleri</span>
            </button>
            <div className="nav-label group-label">
              GRUPLAR
              <button
                className="icon-button"
                aria-label="Gruplu sunucu ekle"
                onClick={() => setHostForm("new")}
              >
                <Plus size={14} />
              </button>
            </div>

            <div className="group-list">
              {groups.length ? (
                groups.map((name) => (
                  <button
                    key={name}
                    className={
                      "nav-item " +
                      (page === "hosts" && group === "group:" + name
                        ? "active"
                        : "")
                    }
                    onClick={() => {
                      setGroup("group:" + name);
                      go("hosts");
                    }}
                  >
                    <Folder size={16} />
                    <span>{name}</span>
                    <span className="count">
                      {vault.hosts.filter((host) => host.group === name).length}
                    </span>
                  </button>
                ))
              ) : (
                <p className="sidebar-hint">
                  Sunucu eklerken gruplarını oluştur.
                </p>
              )}
            </div>
            <div className="spacer" />
            <div className="sidebar-footer">
              <button
                className={"nav-item " + (page === "settings" ? "active" : "")}
                onClick={() => {
                  go("settings");
                }}
              >
                <Settings2 size={21} />
                <span>Ayarlar</span>
              </button>
              <button
                className="nav-item"
                onClick={() => void lock()}
                title="Güvenli Çıkış"
                aria-label="Güvenli Çıkış"
              >
                <LockKeyhole size={21} />
                <span>Güvenli Çıkış</span>
              </button>
            </div>
          </aside>
          {navigation && (
            <button
              className="nav-scrim"
              aria-label="Menü dışına tıklayarak kapat"
              onClick={closeNavigation}
            />
          )}
          <main
            className="main-content"
            onPointerEnter={(event) => {
              if (
                focusMode &&
                !window.matchMedia("(max-width: 950px)").matches &&
                event.pointerType === "mouse" &&
                !document
                  .querySelector("#workspace-sidebar")
                  ?.contains(document.activeElement)
              )
                setNavigation(false);
            }}
          >
            {connections.length > 0 && (
              <div className="session-tabs">
                <button
                  className={
                    "session-tab " + (page !== "terminal" ? "active" : "")
                  }
                  onClick={() => go("hosts")}
                >
                  <LayoutGrid size={14} />
                  Kütüphane
                </button>
                {connections.map((connection) => (
                  <div
                    key={connection.id}
                    className={
                      "session-tab " +
                      (page === "terminal" && active === connection.id
                        ? "active"
                        : "")
                    }
                  >
                    <button
                      title={connection.name}
                      onClick={() => {
                        setActive(connection.id);
                        go("terminal");
                      }}
                    >
                      <TerminalSquare size={14} />
                      <span>{connection.name}</span>
                    </button>
                    <button
                      className="tab-close"
                      aria-label={connection.name + " sekmesini kapat"}
                      onClick={() => void closeConnection(connection)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {page === "hosts" && (
              <Hosts
                vault={vault}
                group={group}
                query={query}
                search={setQuery}
                connecting={connecting}
                connections={
                  connections.filter(
                    (connection) =>
                      connection.phase === "ready" &&
                      !sessionSnapshot(connection.id).closed,
                  ).length
                }
                add={() => setHostForm("new")}
                quick={() => setQuickOpen(true)}
                edit={setHostForm}
                connect={(host) => void connect(host)}
                favorite={async (host) => {
                  try {
                    setVault(
                      await window.nodus!.saveHost({
                        ...host,
                        favorite: !host.favorite,
                      }),
                    );
                  } catch (error) {
                    notify(errorText(error));
                  }
                }}
                remove={(host) => void removeHost(host)}
              />
            )}
            {page === "snippets" && (
              <Snippets
                snippets={vault.snippets}
                add={() => setSnippetForm("new")}
                edit={setSnippetForm}
                remove={(snippet) => void removeSnippet(snippet)}
                run={(snippet) => void run(snippet)}
                activeName={
                  connections.find(
                    (connection) =>
                      connection.id === active &&
                      connection.phase === "ready" &&
                      !sessionSnapshot(connection.id).closed,
                  )?.name
                }
              />
            )}
            {page === "settings" && (
              <Settings vault={vault} update={setVault} notify={notify} />
            )}
            {connections.map((connection) =>
              connection.phase === "ready" ? (
                <Workspace
                  key={connection.id}
                  snippets={vault.snippets}
                  run={(snippet) => void run(snippet, connection.id)}
                  connection={connection}
                  host={connection.host}
                  active={page === "terminal" && active === connection.id}
                  notify={notify}
                  close={() => void closeConnection(connection)}
                />
              ) : (
                <ConnectionPrompt
                  key={connection.id}
                  host={connection.host}
                  active={page === "terminal" && active === connection.id}
                  phase={connection.phase}
                  message={connection.message}
                  submit={(password) =>
                    void attemptConnection(connection, password)
                  }
                  close={() => void closeConnection(connection)}
                />
              ),
            )}
          </main>
        </div>
      )}
      {quickOpen && vault && (
        <QuickConnect
          connect={(input) => quickConnect(input)}
          close={() => setQuickOpen(false)}
        />
      )}
      {hostForm && vault && (
        <HostForm
          initial={hostForm === "new" ? undefined : hostForm}
          groups={groups}
          save={async (host, open, password) => {
            setVault(await window.nodus!.saveHost(host));
            setHostForm(null);
            if (open) await connect(host, password);
          }}
          close={() => setHostForm(null)}
        />
      )}
      {snippetForm && vault && (
        <SnippetForm
          initial={snippetForm === "new" ? undefined : snippetForm}
          save={async (snippet) => {
            setVault(await window.nodus!.saveSnippet(snippet));
          }}
          close={() => setSnippetForm(null)}
        />
      )}
      {question && (
        <Modal title={question.title} close={() => answer(false)}>
          <div className="modal-form">
            <p className="question-detail">{question.detail}</p>
            <div className="modal-footer">
              <button
                className="secondary"
                autoFocus
                onClick={() => answer(false)}
              >
                Vazgeç
              </button>
              <button className="primary" onClick={() => answer(true)}>
                {question.action}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {palette && vault && (
        <Modal title="Hızlı erişim" close={() => setPalette(false)}>
          <div className="palette">
            <label className="search-field">
              <Search size={17} />
              <input
                autoFocus
                aria-label="Hızlı erişim ara"
                className="search-field"
                placeholder="Sunucu veya kestirme ara…"
                value={paletteQuery}
                onChange={(event) => setPaletteQuery(event.target.value)}
              />
            </label>
            <div className="palette-results">
              {vault.hosts
                .filter((host) =>
                  (host.name + host.hostname)
                    .toLocaleLowerCase("tr")
                    .includes(paletteQuery.toLocaleLowerCase("tr")),
                )
                .map((host) => (
                  <button
                    key={host.id}
                    disabled={connecting.includes(host.id)}
                    onClick={() => void connect(host)}
                  >
                    <Server size={17} />
                    <span>
                      <strong>{host.name}</strong>
                      <small>
                        {host.username}@{host.hostname}
                      </small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
              {vault.snippets
                .filter((snippet) =>
                  (snippet.name + snippet.command)
                    .toLocaleLowerCase("tr")
                    .includes(paletteQuery.toLocaleLowerCase("tr")),
                )
                .map((snippet) => (
                  <button key={snippet.id} onClick={() => void run(snippet)}>
                    <Zap size={17} />
                    <span>
                      <strong>{snippet.name}</strong>
                      <small>{snippet.command}</small>
                    </span>
                    <kbd>Çalıştır</kbd>
                  </button>
                ))}
            </div>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Bildirimi kapat"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {workflow && vault && (
        <WorkflowDialog
          id={workflow.id}
          host={workflow.host}
          snippet={workflow.snippet}
          close={() => setWorkflow(null)}
        />
      )}
      <UpdateNotice />
    </div>
  );
}
