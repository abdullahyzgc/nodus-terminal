import { useEffect, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { errorText } from "./session";

export function SecuritySettings() {
  const [minutes, setMinutes] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    window
      .nodus!.autoLockMinutes()
      .then((value) => {
        if (active) {
          setEnabled(value !== 0);
          setMinutes(value || 15);
          setLoaded(true);
        }
      })
      .catch((failure) => {
        if (active) setError(errorText(failure));
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="settings-card" aria-label="Otomatik kilit ayarları">
      <div className="settings-title">
        <div className="feature-icon">
          <LockKeyhole size={22} />
        </div>
        <div>
          <h2>Otomatik kasa kilidi</h2>
          <p>Varsayılan: 15 dakika. Tercih yalnızca bu cihazda saklanır.</p>
        </div>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          setMessage("");
          try {
            const saved = await window.nodus!.setAutoLockMinutes(
              enabled ? Number(minutes) : 0,
            );
            setEnabled(saved !== 0);
            setMinutes(saved || 15);
            setMessage(
              saved
                ? "Kasa " +
                    saved +
                    " dakika hareketsizlikten sonra kilitlenecek."
                : "Otomatik kilit kapatıldı.",
            );
          } catch (failure) {
            setError(errorText(failure));
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy || !loaded}>
          <label className="check">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => {
                setEnabled(event.target.checked);
                setMessage("");
              }}
            />
            Hareketsizlikte kasayı otomatik kilitle
          </label>
          <label>
            Kilit süresi (dakika)
            <input
              type="number"
              min="1"
              max="1440"
              step="1"
              required
              disabled={!enabled}
              value={minutes ?? ""}
              onChange={(event) => {
                setMinutes(
                  event.target.value === "" ? null : Number(event.target.value),
                );
                setMessage("");
              }}
            />
          </label>

          {!enabled && (
            <p className="info-box">
              Otomatik kilit kapalıyken kasa, siz kilitleyene veya uygulamadan
              çıkana kadar açık kalır. Ortak cihazlarda önerilmez.
            </p>
          )}
          <div className="settings-actions">
            <button className="primary" type="submit">
              {busy ? "Kaydediliyor…" : "Kilit ayarını kaydet"}
            </button>
          </div>
        </fieldset>
      </form>

      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
