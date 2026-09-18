import { useEffect, useRef, useState, type ReactNode } from "react";
import { KeyRound, LockKeyhole, Upload, X, ShieldCheck } from "lucide-react";
import type { Host, Snippet, Status, Vault } from "./shared";
import { errorText } from "./session";
import { DrivePanel } from "./DrivePanel";

export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="modal-head">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Pencereyi kapat"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function VaultGate({
  status,
  ready,
  imported,
}: {
  status: Status;
  ready: (vault: Vault) => void;
  imported: (status: Status) => void;
}) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const create = !status.exists;
  async function submit() {
    setError("");
    if (create && password !== repeat) {
      setError("Parolalar eşleşmiyor.");
      return;
    }
    setBusy(true);
    try {
      ready(await window.nodus!.unlock(password, remember, create));
      setPassword("");
      setRepeat("");
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="gate">
      <div className="gate-story">
        <span className="eyebrow">KİŞİSEL SUNUCU ALANIN</span>
        <h1>
          Her sunucu.
          <br />
          Tek bir <em>yer.</em>
        </h1>
        <p>
          Terminal, dosyalar ve sık kullandığın komutlar.
          <br />
          Sadece sana ait, sakin bir çalışma alanı.
        </p>
        <div className="gate-terminal" aria-hidden="true">
          <div className="window-dots">
            <i />
            <i />
            <i />
            <span>nodus / workspace</span>
          </div>
          <div>
            <span className="green">~</span> ssh benim-sunucum
            <br />
            <span className="muted">
              Güvenli bağlantı. Her şey yerli yerinde.
            </span>
            <br />
            <br />
            <span className="green">❯</span> php artisan optimize:clear
            <br />
            <span className="muted">INFO</span> Clearing cached bootstrap files.
            <br />
            <br />
            <span className="green">❯</span> <span className="cursor-block" />
          </div>
        </div>
        <div className="gate-features">
          <span>
            <ShieldCheck size={16} />
            Şifreli kasa
          </span>
          <span>
            <KeyRound size={16} />
            Parola + SSH anahtarı
          </span>
        </div>
      </div>
      <section className="gate-card">
        <div className="large-icon">
          <LockKeyhole size={26} />
        </div>
        <span className="eyebrow">NODUS'A HOŞ GELDİN</span>
        <h2>{create ? "Kendi alanını oluştur." : "Kasanı aç."}</h2>
        <p>
          {create
            ? "Sunucu bilgilerin ve özel anahtarların bu parola ile şifrelenir."
            : "Sunucuların, anahtarların ve kestirmelerin seni bekliyor."}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={busy}>
            <label>
              Kasa parolası
              <input
                autoFocus
                type="password"
                autoComplete={create ? "new-password" : "current-password"}
                minLength={create ? 12 : 1}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={create ? "En az 12 karakter" : "Kasa parolan"}
              />
            </label>
            {create && (
              <label>
                Parolayı doğrula
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={repeat}
                  onChange={(event) => setRepeat(event.target.value)}
                  placeholder="Parolanı tekrar gir"
                />
              </label>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              Bu cihazda hatırla
            </label>
            <p className="field-hint">
              İşletim sisteminin güvenli saklama hizmeti kullanılır. Bu
              cihazdaki hesabın açıkken kasaya erişilebilir.
            </p>
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <button className="primary full">
              {busy
                ? "Kasa açılıyor…"
                : create
                  ? "Şifreli kasamı oluştur"
                  : "Kasanın kilidini aç"}
            </button>
          </fieldset>
        </form>
        {create && (
          <>
            <div className="or">
              <span>zaten başka cihazda kullanıyorsan</span>
            </div>
            <details className="drive-restore">
              <summary>Google Drive üzerinden aç</summary>
              <DrivePanel ready={ready} disabled={busy} />
            </details>
            <button
              className="secondary full"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  imported(await window.nodus!.importVault());
                } catch (failure) {
                  setError(errorText(failure));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Upload size={16} />
              Kasa yedeğini içe aktar
            </button>
            <p className="warning-note">
              Parolanı güvenli yerde sakla. Parola unutulursa şifreli kasa
              kurtarılamaz.
            </p>
          </>
        )}
      </section>
    </main>
  );
}

export function HostForm({
  initial,
  groups,
  save,
  close,
}: {
  initial?: Host;
  groups: string[];
  save: (host: Host, open: boolean, password?: string) => Promise<void>;
  close: () => void;
}) {
  const [host, setHost] = useState<Host>(() =>
    initial
      ? { ...initial }
      : {
          id: crypto.randomUUID(),
          name: "",
          hostname: "",
          port: 22,
          username: "root",
          group: "Kişisel",
          color: "#8aacf2",
          authType: "password",
          password: "",
          privateKey: "",
          passphrase: "",
          favorite: false,
          initialPath: "",
          followDirectory: true,
        },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savePassword, setSavePassword] = useState(Boolean(initial?.password));
  function field<Key extends keyof Host>(key: Key, value: Host[Key]) {
    setHost((current) => ({ ...current, [key]: value }));
  }
  async function submit(open = false) {
    setBusy(true);
    setError("");
    try {
      await save(
        {
          ...host,
          password:
            host.authType === "password" && savePassword ? host.password : "",
          name: host.name.trim(),
          hostname: host.hostname.trim(),
          username: host.username.trim(),
          group: host.group.trim() || "Kişisel",
        },
        open,
        host.authType === "password" ? host.password || undefined : undefined,
      );
      close();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={initial ? "Sunucuyu düzenle" : "Yeni sunucu"}
      close={() => {
        if (!busy) close();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(
            (event.nativeEvent as SubmitEvent).submitter?.getAttribute(
              "value",
            ) === "connect",
          );
        }}
        className="modal-form"
      >
        <p className="modal-description">
          Bir kez ekle. Her bağlantıda kaldığın yerden devam et.
        </p>
        <fieldset disabled={busy}>
          <label>
            Sunucu adı
            <input
              autoFocus
              required
              maxLength={120}
              value={host.name}
              onChange={(event) => field("name", event.target.value)}
              placeholder="Örn. Laravel Production"
            />
          </label>
          <div className="form-grid address-grid">
            <label>
              Adres
              <input
                required
                value={host.hostname}
                onChange={(event) => field("hostname", event.target.value)}
                placeholder="IP adresi veya sunucu.example.com"
              />
            </label>
            <label>
              Port
              <input
                required
                type="number"
                min="1"
                max="65535"
                value={host.port || ""}
                onChange={(event) => field("port", Number(event.target.value))}
              />
            </label>
          </div>
          <div className="form-grid">
            <label>
              Kullanıcı
              <input
                required
                value={host.username}
                onChange={(event) => field("username", event.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              Grup
              <input
                list="host-groups"
                value={host.group}
                onChange={(event) => field("group", event.target.value)}
              />
              <datalist id="host-groups">
                {groups.map((group) => (
                  <option key={group} value={group} />
                ))}
              </datalist>
            </label>
          </div>
          <div className="segmented">
            <button
              type="button"
              className={host.authType === "password" ? "active" : ""}
              onClick={() => field("authType", "password")}
            >
              <LockKeyhole size={15} />
              Parola
            </button>
            <button
              type="button"
              className={host.authType === "key" ? "active" : ""}
              onClick={() => field("authType", "key")}
            >
              <KeyRound size={15} />
              SSH anahtarı
            </button>
          </div>
          {host.authType === "password" ? (
            <>
              <label>
                Sunucu parolası
                <input
                  type="password"
                  autoComplete="new-password"
                  value={host.password}
                  onChange={(event) => field("password", event.target.value)}
                  placeholder="Boş bırakılırsa terminalde sorulur"
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={savePassword}
                  onChange={(event) => setSavePassword(event.target.checked)}
                />
                Parolayı kasaya kaydet
              </label>
            </>
          ) : (
            <>
              <label>
                Özel SSH anahtarı
                <textarea
                  rows={4}
                  required
                  spellCheck={false}
                  value={host.privateKey}
                  onChange={(event) => field("privateKey", event.target.value)}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                />
              </label>
              <button
                className="secondary"
                type="button"
                onClick={async () => {
                  try {
                    const key = await window.nodus!.readKey();
                    if (key) field("privateKey", key);
                  } catch (failure) {
                    setError(errorText(failure));
                  }
                }}
              >
                <Upload size={14} />
                Anahtar dosyası seç
              </button>
              <label>
                Anahtar parolası (varsa)
                <input
                  type="password"
                  autoComplete="new-password"
                  value={host.passphrase}
                  onChange={(event) => field("passphrase", event.target.value)}
                />
              </label>
            </>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={!!host.production}
              onChange={(event) => field("production", event.target.checked)}
            />
            Üretim sunucusu: belirgin uyarı ve ek işlem onayı
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={!!host.persistentSession}
              onChange={(event) =>
                field("persistentSession", event.target.checked)
              }
            />
            Kesintiye dayanıklı oturum (tmux)
          </label>
          <p className="field-hint">
            Sunucuda tmux kurulu olmalı. Aynı sunucu kaydında bir kalıcı oturum
            açılır. Kasa kilitlense veya uygulama kapansa da uzaktaki işler
            sürebilir. tmux içinde otomatik dizin takibi kapalıdır.
          </p>
          <label>
            Başlangıç dizini (isteğe bağlı)
            <input
              value={host.initialPath}
              onChange={(event) => field("initialPath", event.target.value)}
              placeholder="/var/www"
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={host.followDirectory}
              onChange={(event) =>
                field("followDirectory", event.target.checked)
              }
            />
            Dosya paneli terminal dizinini izlesin
          </label>
          <p className="field-hint">
            Bash/Zsh oturumuna geçici dizin bildirme işlevi eklenir. Sunucuda
            dosya değiştirilmez.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={host.favorite}
              onChange={(event) => field("favorite", event.target.checked)}
            />
            Favorilere ekle
          </label>
        </fieldset>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <span>
            <ShieldCheck size={14} />
            Şifreli kayıt
          </span>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={close}
          >
            Vazgeç
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Kaydediliyor…" : "Sunucuyu kaydet"}
          </button>
          <button
            className="primary"
            type="submit"
            value="connect"
            disabled={busy}
          >
            Kaydet ve bağlan
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function SnippetForm({
  initial,
  save,
  close,
}: {
  initial?: Snippet;
  save: (snippet: Snippet) => Promise<void>;
  close: () => void;
}) {
  const [snippet, setSnippet] = useState<Snippet>(
    initial ?? {
      id: crypto.randomUUID(),
      name: "",
      command: "",
      group: "Genel",
      confirm: true,
    },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title={initial ? "Kestirmeyi düzenle" : "Yeni kestirme"}
      close={() => {
        if (!busy) close();
      }}
    >
      <form
        className="modal-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await save(snippet);
            close();
          } catch (failure) {
            setError(errorText(failure));
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <label>
            Ad
            <input
              autoFocus
              required
              maxLength={200}
              value={snippet.name}
              onChange={(event) =>
                setSnippet({ ...snippet, name: event.target.value })
              }
              placeholder="Laravel önbellek temizle"
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={!!snippet.workflow}
              onChange={(event) =>
                setSnippet({ ...snippet, workflow: event.target.checked })
              }
            />
            Parametreli komut akışı
          </label>
          {snippet.workflow && (
            <p className="field-hint">
              Her satır tek komut. Parametreyi ayrı, tırnaksız argüman olarak
              yaz: {"git checkout -- {{dal}}"}. Değer otomatik tırnaklanır;
              gerektiğinde -- kullan. Akış ayrı kabukta çalışır ve her zaman
              onay ister.
            </p>
          )}
          <label>
            Komut
            <textarea
              required
              rows={5}
              maxLength={16384}
              value={snippet.command}
              onChange={(event) =>
                setSnippet({ ...snippet, command: event.target.value })
              }
              placeholder="php artisan optimize:clear"
              spellCheck={false}
            />
          </label>
          <label>
            Grup
            <input
              maxLength={200}
              value={snippet.group}
              onChange={(event) =>
                setSnippet({ ...snippet, group: event.target.value })
              }
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={snippet.confirm}
              onChange={(event) =>
                setSnippet({ ...snippet, confirm: event.target.checked })
              }
            />
            Çalıştırmadan önce onay iste
          </label>
          <p className="field-hint">
            Komut etkin terminale gönderilir. Doğru sunucuda ve kabuk isteminde
            olduğunu kontrol et.
          </p>
        </fieldset>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={close}
          >
            Vazgeç
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Kaydediliyor…" : "Kestirmeyi kaydet"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function QuickConnect({
  connect,
  close,
}: {
  connect: (input: {
    hostname: string;
    port: number;
    username: string;
    password: string;
    savePassword: boolean;
  }) => Promise<void>;
  close: () => void;
}) {
  const [hostname, setHostname] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("root");
  const [password, setPassword] = useState("");
  const [savePassword, setSavePassword] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title="Hızlı sunucu"
      close={() => {
        if (!busy) close();
      }}
    >
      <form
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!hostname.trim() || !username.trim()) {
            setError("Adres ve kullanıcı zorunlu.");
            return;
          }
          setBusy(true);
          setError("");
          connect({
            hostname: hostname.trim(),
            port: Number(port) || 22,
            username: username.trim(),
            password,
            savePassword,
          })
            .then(close)
            .catch((failure) => setError(errorText(failure)))
            .finally(() => setBusy(false));
        }}
      >
        <fieldset disabled={busy}>
          <label>
            Sunucu adresi
            <input
              autoFocus
              required
              value={hostname}
              onChange={(event) => setHostname(event.target.value)}
              placeholder="IP adresi veya alan adı"
            />
          </label>
          <div className="form-grid">
            <label>
              Kullanıcı
              <input
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              Port
              <input
                required
                type="number"
                min="1"
                max="65535"
                value={port || ""}
                onChange={(event) => setPort(Number(event.target.value))}
              />
            </label>
          </div>
          <label>
            Parola (isteğe bağlı)
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Boş bırakılırsa terminalde sorulur"
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={savePassword}
              onChange={(event) => setSavePassword(event.target.checked)}
            />
            Parolayı kasaya kaydet
          </label>
        </fieldset>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={close}
          >
            Vazgeç
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Bağlanıyor..." : "Bağlan"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
