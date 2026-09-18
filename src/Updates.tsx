import { useEffect, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import type { UpdateStatus } from "./shared";
import { errorText } from "./session";

function useUpdates() {
  const [state, setState] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const api = window.nodus;
    if (!api) return;
    let active = true;
    let received = false;
    const unsubscribe = api.onUpdate((next) => {
      received = true;
      if (active) setState(next);
    });
    api
      .updateStatus()
      .then((next) => {
        if (active && !received) setState(next);
      })
      .catch((failure) => {
        if (active) setError(errorText(failure));
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  async function action(install: boolean) {
    setError("");
    try {
      if (install) await window.nodus!.installUpdate();
      else await window.nodus!.checkUpdates();
    } catch (failure) {
      setError(errorText(failure));
    }
  }
  return { state, error, action };
}

export function UpdateSettings() {
  const { state, error, action } = useUpdates();
  return (
    <section className="settings-card" aria-label="Uygulama güncellemeleri">
      <div className="settings-title">
        <div className="feature-icon">
          <Download size={22} />
        </div>
        <div>
          <h2>Uygulama güncellemeleri</h2>
          <p>
            {state
              ? "Kurulu sürüm: " + state.currentVersion
              : "Sürüm bilgisi alınıyor…"}
          </p>
        </div>
      </div>
      <p role="status">{state?.message}</p>
      {state?.nextVersion && (
        <p className="field-hint">Yeni sürüm: {state.nextVersion}</p>
      )}
      {state?.phase === "downloading" && (
        <progress
          aria-label="Güncelleme indirme ilerlemesi"
          max="100"
          value={state.progress}
        />
      )}
      <div className="settings-actions">
        <button
          className="secondary"
          disabled={!state || !["idle", "error"].includes(state.phase)}
          onClick={() => void action(false)}
        >
          <RefreshCw size={15} />
          Güncellemeleri kontrol et
        </button>
        {state?.phase === "ready" && (
          <button className="primary" onClick={() => void action(true)}>
            Yeniden başlat ve güncelle
          </button>
        )}
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function UpdateNotice() {
  const { state, error, action } = useUpdates();
  const [dismissed, setDismissed] = useState("");
  if (!state || state.phase !== "ready" || dismissed === state.nextVersion)
    return null;
  return (
    <aside className="update-notice" aria-label="Yeni sürüm bildirimi">
      <div>
        <strong>Nodus {state.nextVersion} hazır</strong>
        <p>{error || "İndirme tamamlandı. Uygun olduğunda yeniden başlat."}</p>
      </div>
      <button className="primary" onClick={() => void action(true)}>
        Yeniden başlat ve güncelle
      </button>
      <button
        className="icon-button"
        aria-label="Güncellemeyi sonraya bırak"
        onClick={() => setDismissed(state.nextVersion || "")}
      >
        <X size={16} />
      </button>
    </aside>
  );
}
