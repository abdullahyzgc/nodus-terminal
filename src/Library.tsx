import {
  ArrowRight,
  Folder,
  KeyRound,
  LockKeyhole,
  Pencil,
  Play,
  Plus,
  Search,
  Server,
  ShieldCheck,
  Star,
  TerminalSquare,
  Trash2,
  Zap,
} from "lucide-react";
import type { Host, Snippet, Vault } from "./shared";

type HostProps = {
  vault: Vault;
  group: string;
  query: string;
  search: (value: string) => void;
  connecting: string[];
  connections: number;
  add: () => void;
  quick: () => void;
  edit: (host: Host) => void;
  connect: (host: Host) => void;
  favorite: (host: Host) => void;
  remove: (host: Host) => void;
};
export function Hosts({
  vault,
  group,
  query,
  search,
  connecting,
  connections,
  add,
  quick,
  edit,
  connect,
  favorite,
  remove,
}: HostProps) {
  const hosts = vault.hosts.filter(
    (host) =>
      (group === "all" ||
        (group === "favorites" && host.favorite) ||
        group === "group:" + host.group) &&
      [host.name, host.hostname, host.username, host.group].some((text) =>
        text
          .toLocaleLowerCase("tr-TR")
          .includes(query.toLocaleLowerCase("tr-TR")),
      ),
  );
  return (
    <div className="page hosts-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">BAĞLAN. ÜRET. DEVAM ET.</span>
          <h1>
            Sunucuların, bir arada<span className="green">.</span>
          </h1>
          <p>İhtiyacın olan her şey. Gereksiz hiçbir şey.</p>
        </div>
        <div className="header-actions">
          <button className="secondary" onClick={quick}>
            <Zap size={16} />
            Hızlı Bağlantı
          </button>
          <button className="primary" onClick={add}>
            <Plus size={17} />
            Yeni sunucu
          </button>
        </div>
      </div>
      <div className="overview">
        <div>
          <span className="overview-icon">
            <Server size={19} />
          </span>
          <div>
            <strong>{vault.hosts.length}</strong>
            <span>Kayıtlı sunucu</span>
          </div>
        </div>
        <div>
          <span className="overview-icon">
            <TerminalSquare size={19} />
          </span>
          <div>
            <strong>
              {connections}
              <span className="status-dot" />
            </strong>
            <span>Açık oturum</span>
          </div>
        </div>
        <div>
          <span className="overview-icon">
            <Zap size={19} />
          </span>
          <div>
            <strong>{vault.snippets.length}</strong>
            <span>Hazır kestirme</span>
          </div>
        </div>
        <div className="overview-security">
          <ShieldCheck size={23} />
          <div>
            <strong>Yalnızca senin</strong>
            <span>Şifreli, özel, yerel.</span>
          </div>
        </div>
      </div>
      <div className="section-heading">
        <div>
          <h2>
            {group === "favorites"
              ? "Favoriler"
              : group.startsWith("group:")
                ? group.slice(6)
                : "Tüm sunucular"}
          </h2>
          <span className="count">{hosts.length}</span>
        </div>
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Sunucu ara"
            className="search-field"
            placeholder="Sunucu, adres veya grup ara…"
            value={query}
            onChange={(event) => search(event.target.value)}
          />
          <kbd>/</kbd>
        </label>
      </div>
      {hosts.length ? (
        <div className="host-grid">
          {hosts.map((host) => (
            <article className="host-card" key={host.id}>
              <div className="host-card-top">
                <div className="server-glyph">
                  <Server size={22} />
                </div>
                <span className="host-group">
                  <Folder size={12} />
                  {host.group}
                </span>
                <button
                  className={
                    "icon-button favorite " +
                    (host.favorite ? "is-favorite" : "")
                  }
                  aria-label={host.name + " favori değiştir"}
                  onClick={() => favorite(host)}
                >
                  <Star
                    size={16}
                    fill={host.favorite ? "currentColor" : "none"}
                  />
                </button>
              </div>
              <h3 title={host.name}>{host.name}</h3>
              <p
                className="host-address"
                title={host.username + "@" + host.hostname}
              >
                {host.username}@{host.hostname}
              </p>
              <div className="host-details">
                <span>
                  {host.authType === "key" ? (
                    <KeyRound size={13} />
                  ) : (
                    <LockKeyhole size={13} />
                  )}
                  {host.authType === "key" ? "SSH anahtarı" : "Parola"}
                </span>
                <span>Port {host.port}</span>
              </div>
              <div className="host-card-footer">
                <button
                  className="connect-button"
                  disabled={connecting.includes(host.id)}
                  onClick={() => connect(host)}
                >
                  {connecting.includes(host.id) ? "Bağlanıyor…" : "Bağlan"}
                  <ArrowRight size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label={host.name + " düzenle"}
                  onClick={() => edit(host)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="icon-button danger-hover"
                  aria-label={host.name + " sil"}
                  onClick={() => remove(host)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
          <button className="add-host-card" onClick={add}>
            <span>
              <Plus size={22} />
            </span>
            <strong>Yeni bir bağlantı</strong>
            <small>Bir sonraki sunucuna yer var.</small>
          </button>
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-illustration">
            <span className="orbit orbit-one" />
            <span className="orbit orbit-two" />
            <div>
              <Server size={35} />
            </div>
            <span className="empty-spark">
              <Plus size={14} />
            </span>
          </div>
          <h2>
            {vault.hosts.length
              ? "Eşleşen sunucu yok."
              : "İlk bağlantınla başla."}
          </h2>
          <p>
            {vault.hosts.length
              ? "Aramayı veya seçili grubu değiştir."
              : "Linux sunucunu ekle. Terminalin, dosyaların ve kestirmelerin aynı yerde buluşsun."}
          </p>
          <button className="primary" onClick={add}>
            <Plus size={16} />
            Sunucu ekle
          </button>
          <div className="empty-capabilities">
            <span>
              <KeyRound size={14} />
              SSH anahtarı
            </span>
            <span>
              <LockKeyhole size={14} />
              Kayıtlı parola
            </span>
            <span>
              <Folder size={14} />
              SFTP dosyaları
            </span>
          </div>
        </div>
      )}
      <div className="tip-bar">
        <div>
          <TerminalSquare size={19} />
          <span>
            <strong>Daha az yaz, daha çok yap.</strong> Komutların ve
            sunucuların hızlı erişimde.
          </span>
        </div>
        <kbd>Ctrl K</kbd>
      </div>
    </div>
  );
}

export { Snippets } from "./Snippets";
