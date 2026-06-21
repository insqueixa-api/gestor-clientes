"use client";
import { useEffect, useRef, useState } from "react";
import {
  Loader2, RefreshCcw, Plug, Settings, Ban, CheckCircle2,
  Power, RotateCw, Wrench,
} from "lucide-react";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";
import { useConfirm } from "@/app/admin/HookuseConfirm";

// ── Helpers mínimos (números da lista branca) ───────────────────
function onlyDigits(raw: string) {
  return raw.replace(/\D+/g, "");
}

type AllowedRow = { id: string; name: string; raw: string; loading: boolean; exists: boolean | null };

function parseAllowed(arr: string[]): AllowedRow[] {
  return arr.map((entry) => {
    const [digits, ...rest] = entry.trim().split(" ");
    return { id: Math.random().toString(36).slice(2), name: rest.join(" "), raw: digits || "", loading: false, exists: true };
  });
}
function stringifyAllowed(rows: AllowedRow[]): string[] {
  return rows.filter((r) => r.raw.trim()).map((r) => `${onlyDigits(r.raw)} ${r.name}`.trim());
}

// ── Card de uma sessão (usado 2x: principal e secundária) ───────
function WhatsAppSessionCard({
  label,
  apiSuffix,
  addToast,
}: {
  label: string;
  apiSuffix: "" | "2";
  addToast: (type: "success" | "error", title: string, msg?: string) => void;
}) {
  const { confirm } = useConfirm();
  const [loading, setLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [isDormant, setIsDormant] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [pushName, setPushName] = useState<string | null>(null);
  const [pictureUrl, setPictureUrl] = useState<string | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [rejectCalls, setRejectCalls] = useState(true);
  const [rejectMessage, setRejectMessage] = useState(
    "{saudacao}! 😊\nNo momento não estou recebendo ligações. Por favor, envie mensagem e aguarde retorno."
  );
  const [allowedList, setAllowedList] = useState<AllowedRow[]>([]);
  const [savingConfig, setSavingConfig] = useState(false);

  const route = (path: string) => `/api/whatsapp/${path}${apiSuffix}`;

  async function fetchStatus() {
    try {
      const res = await fetch(route("status"), { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      setConnected(!!json.connected);
      return { connected: !!json.connected, status: json.status };
    } catch {
      return { connected: false, status: "error" };
    }
  }

  async function fetchProfile() {
    try {
      const res = await fetch(route("profile"), { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      setPushName(json.pushName ?? null);
      setPictureUrl(json.pictureUrl ?? null);
    } catch {}
  }

  async function fetchConfig() {
    try {
      const res = await fetch(route("config"), { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setRejectCalls(json.rejectCalls ?? true);
        setRejectMessage(json.rejectMessage ?? "");
        setAllowedList(parseAllowed(json.allowedNumbers ?? []));
      }
    } catch {}
  }

  async function refreshPanel(forceQr = false, showLoading = true) {
    if (showLoading) setLoading(true);
    try {
      const { connected: isConn, status } = await fetchStatus();
      if (isConn) {
        setIsDormant(false);
        setQrDataUrl(null);
        await fetchProfile();
        await fetchConfig();
        if (showLoading) addToast("success", "Sincronizado");
        return;
      }
      if (forceQr || status === "qr" || status === "connecting") {
        const res = await fetch(route("qr"), { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        setQrDataUrl(json.qr || null);
      } else {
        setQrDataUrl(null);
      }
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus().then(({ connected: c, status }) => {
      if (c || status === "qr" || status === "connecting") {
        setIsDormant(false);
        void refreshPanel(false, false);
      }
    });
  }, []);

  // Polling leve
  useEffect(() => {
    if (isDormant) return;
    const t = setInterval(() => void refreshPanel(false, false), connected ? 300000 : 80000);
    return () => clearInterval(t);
  }, [isDormant, connected]);

  async function handleDisconnect() {
    const ok = await confirm({
      title: "Desconectar?",
      subtitle: "A sessão será encerrada. Seus números salvos e mensagem personalizada continuam guardados.",
      tone: "rose",
      confirmText: "Desconectar",
      cancelText: "Voltar",
    });
    if (!ok) return;
    setLoading(true);
    try {
      await fetch(route("disconnect"), { method: "POST" });
      setConnected(false);
      setQrDataUrl(null);
      setPushName(null);
      setPictureUrl(null);
      setIsDormant(true);
      addToast("success", "Desconectado");
    } finally {
      setLoading(false);
    }
  }

  async function handleReconnect() {
    const ok = await confirm({
      title: "Reconectar?",
      subtitle: "A sessão será reiniciada usando os dados já salvos.",
      tone: "amber",
      confirmText: "Reconectar",
      cancelText: "Voltar",
    });
    if (!ok) return;
    setReconnecting(true);
    try {
      await fetch(route("reconnect"), { method: "POST" });
      setConnected(false);
      setQrDataUrl(null);
      setIsDormant(false);
      setTimeout(() => void refreshPanel(true, false), 4000);
    } finally {
      setReconnecting(false);
    }
  }

  async function saveConfig() {
    setSavingConfig(true);
    try {
      const res = await fetch(route("config"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rejectCalls,
          rejectMessage,
          allowedNumbers: stringifyAllowed(allowedList),
        }),
      });
      if (res.ok) {
        addToast("success", "Configuração salva");
        setShowSettings(false);
      }
    } finally {
      setSavingConfig(false);
    }
  }

  async function validateRow(id: string, raw: string) {
    const digits = onlyDigits(raw);
    if (digits.length < 8) {
      setAllowedList((p) => p.map((r) => (r.id === id ? { ...r, exists: false } : r)));
      return;
    }
    setAllowedList((p) => p.map((r) => (r.id === id ? { ...r, loading: true } : r)));
    try {
      const res = await fetch("/api/whatsapp/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits }),
      });
      const json = await res.json().catch(() => ({}));
      setAllowedList((p) =>
        p.map((r) => (r.id === id ? { ...r, loading: false, exists: !!json.exists } : r))
      );
    } catch {
      setAllowedList((p) => p.map((r) => (r.id === id ? { ...r, loading: false, exists: false } : r)));
    }
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
          WhatsApp — {label}
        </h3>
      </div>

      {isDormant && !connected ? (
        <button
          onClick={() => { setIsDormant(false); void refreshPanel(true); }}
          className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-sm"
        >
          {loading ? "Gerando..." : "📲 Inicializar QR Code"}
        </button>
      ) : (
        <>
          <div className="relative p-4 rounded-xl border border-border flex flex-col items-center gap-3 text-center">
            <div className="absolute top-3 right-3 flex gap-1.5">
              <button
                onClick={() => void refreshPanel()}
                disabled={loading}
                className="w-8 h-8 rounded-lg bg-muted border border-border flex items-center justify-center text-muted-foreground hover:text-emerald-500"
                title="Atualizar (refresh da sessão)"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
              </button>
              {connected && (
                <button
                  onClick={() => setShowSettings(true)}
                  className="w-8 h-8 rounded-lg bg-muted border border-border flex items-center justify-center text-muted-foreground hover:text-foreground"
                  title="Configurações"
                >
                  <Settings className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Foto grande */}
            <div className="w-36 h-36 rounded-full bg-card border-4 border-border overflow-hidden flex items-center justify-center shadow-sm mt-4">
              {pictureUrl ? (
                <img src={pictureUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl font-medium text-muted-foreground/60">WA</span>
              )}
            </div>

            <div className="text-base font-bold text-foreground">{pushName || "Aguardando conexão"}</div>

            <div className="flex items-center gap-2 text-xs">
              <span className={`px-2 py-1 rounded-lg font-medium border ${connected ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-rose-500/10 text-rose-500 border-rose-500/20"}`}>
                {connected ? "On-line" : "Off-line"}
              </span>
              <span className="text-muted-foreground">
                {rejectCalls ? <>Chamadas rejeitadas <Ban className="w-3 h-3 inline text-rose-500" /></> : <>Chamadas permitidas <CheckCircle2 className="w-3 h-3 inline text-emerald-500" /></>}
              </span>
            </div>
          </div>

          {qrDataUrl && !connected && (
            <div className="flex flex-col items-center gap-2 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10">
              <img src={qrDataUrl} alt="QR Code" className="w-56 h-56 rounded-xl object-contain" />
              <p className="text-[11px] text-emerald-500 font-medium">📱 Escaneie com o WhatsApp</p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => void handleReconnect()}
              disabled={reconnecting}
              className="flex-1 py-2 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20 font-medium text-xs hover:bg-amber-500/20"
            >
              <RefreshCcw className="w-4 h-4 mr-1.5 inline-block" /> Reconectar
            </button>
            {connected && (
              <button
                onClick={() => void handleDisconnect()}
                className="flex-1 py-2 rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20 font-medium text-xs hover:bg-rose-500/20"
              >
                <Plug className="w-4 h-4 mr-1.5 inline-block" /> Desconectar
              </button>
            )}
          </div>
        </>
      )}

      {/* Modal config (lista branca + mensagem) */}
      {showSettings && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card w-full max-w-md rounded-2xl border border-border p-6 shadow-2xl max-h-[92vh] overflow-y-auto space-y-5">
            <div className="flex items-start justify-between">
              <h3 className="text-base font-medium text-foreground">⚙️ {label} — Configurações</h3>
              <button onClick={() => setShowSettings(false)} className="text-muted-foreground hover:text-foreground text-lg">×</button>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl border border-border">
              <span className="text-sm font-medium">📵 Rejeitar Chamadas</span>
              <button
                onClick={() => setRejectCalls((v) => !v)}
                className={`relative w-11 h-6 rounded-full ${rejectCalls ? "bg-emerald-500" : "bg-muted"}`}
              >
                <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-card transition-transform ${rejectCalls ? "translate-x-5" : ""}`} />
              </button>
            </div>

            {rejectCalls && (
              <>
                <div>
                  <label className="block text-[10px] font-medium text-muted-foreground uppercase mb-1.5">Mensagem de Resposta</label>
                  <textarea
                    value={rejectMessage}
                    onChange={(e) => setRejectMessage(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 text-xs bg-card border border-border rounded-xl outline-none focus:border-emerald-500/50 resize-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase">Lista Branca</label>
                    <button
                      onClick={() => setAllowedList([{ id: Math.random().toString(36).slice(2), name: "", raw: "", loading: false, exists: null }, ...allowedList])}
                      className="text-[10px] font-medium text-emerald-500 hover:underline"
                    >
                      + Adicionar
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-2">
                    {allowedList.map((row) => (
                      <div key={row.id} className="flex gap-2 items-center p-2 rounded-xl border border-border">
                        <input
                          value={row.name}
                          onChange={(e) => setAllowedList((p) => p.map((r) => r.id === row.id ? { ...r, name: e.target.value } : r))}
                          placeholder="Nome"
                          className="w-1/3 h-8 px-2 text-xs bg-card border border-border rounded-lg outline-none"
                        />
                        <input
                          value={row.raw}
                          onChange={(e) => setAllowedList((p) => p.map((r) => r.id === row.id ? { ...r, raw: e.target.value } : r))}
                          onBlur={() => validateRow(row.id, row.raw)}
                          placeholder="Número com DDI"
                          className="flex-1 h-8 px-2 text-xs font-mono bg-card border border-border rounded-lg outline-none"
                        />
                        <button onClick={() => setAllowedList((p) => p.filter((r) => r.id !== row.id))} className="text-rose-500 text-xs px-2">✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="flex gap-3 pt-2 border-t border-border">
              <button onClick={() => setShowSettings(false)} className="flex-1 py-2.5 rounded-xl border border-border text-xs font-medium">Cancelar</button>
              <button onClick={() => void saveConfig()} disabled={savingConfig} className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-xs">
                {savingConfig ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Menu de manutenção da VM ─────────────────────────────────────
function VmMaintenancePanel({ addToast }: { addToast: (t: "success" | "error", title: string, msg?: string) => void }) {
  const { confirm } = useConfirm();
  const [restartingService, setRestartingService] = useState(false);
  const [rebootingVm, setRebootingVm] = useState(false);

  async function handleRestartService() {
    const ok = await confirm({
      title: "Reiniciar serviço?",
      subtitle: "Reinicia o processo do WhatsApp (~10s). Resolve a maioria das travas, sem afetar a VM.",
      tone: "amber",
      confirmText: "Reiniciar",
      cancelText: "Voltar",
    });
    if (!ok) return;
    setRestartingService(true);
    try {
      await fetch("/api/whatsapp/restart-service", { method: "POST" });
      addToast("success", "Serviço reiniciado", "As sessões reconectam automaticamente em instantes.");
    } catch (e: any) {
      addToast("error", "Erro", e?.message);
    } finally {
      setTimeout(() => setRestartingService(false), 10000);
    }
  }

  async function handleRebootVm() {
    const ok = await confirm({
      title: "Reiniciar a VM inteira?",
      subtitle: "Reboot completo do servidor (~30-60s de indisponibilidade). Use só se reiniciar o serviço não resolver.",
      tone: "rose",
      confirmText: "Reiniciar VM",
      cancelText: "Voltar",
    });
    if (!ok) return;
    setRebootingVm(true);
    try {
      const res = await fetch("/api/whatsapp/vm-reboot", { method: "POST" });
      if (res.ok) {
        addToast("success", "VM reiniciando", "Em ~1 minuto tudo volta sozinho, incluindo as sessões.");
      } else {
        const json = await res.json().catch(() => ({}));
        addToast("error", "Erro ao reiniciar VM", json?.error);
      }
    } finally {
      setTimeout(() => setRebootingVm(false), 60000);
    }
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <Wrench className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
          Manutenção da VM
        </h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Em caso de travamento ou comportamento estranho, tente nesta ordem: primeiro reiniciar o serviço, e só se não resolver, reiniciar a VM inteira.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => void handleRestartService()}
          disabled={restartingService}
          className="py-3 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20 font-medium text-xs hover:bg-amber-500/20 flex items-center justify-center gap-2"
        >
          {restartingService ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
          Reiniciar Serviço (~10s)
        </button>
        <button
          onClick={() => void handleRebootVm()}
          disabled={rebootingVm}
          className="py-3 rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20 font-medium text-xs hover:bg-rose-500/20 flex items-center justify-center gap-2"
        >
          {rebootingVm ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
          Reiniciar VM Completa (~60s)
        </button>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────
export default function WhatsAppPage() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastSeq = useRef(1);

  const addToast = (type: "success" | "error", title: string, message?: string) => {
    const id = Date.now() * 1000 + (toastSeq.current++ % 1000);
    setToasts((prev) => [...prev, { id, type, title, message, durationMs: 5000 }]);
  };
  const removeToast = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-background text-foreground">
      <ToastNotifications toasts={toasts} removeToast={removeToast} />

      <div className="px-3 sm:px-0">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">WhatsApp</h1>
        <p className="text-xs text-muted-foreground mt-1">Gerencie suas sessões e a manutenção do serviço.</p>
      </div>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <WhatsAppSessionCard label="Sessão 1" apiSuffix="" addToast={addToast} />
        <WhatsAppSessionCard label="Sessão 2" apiSuffix="2" addToast={addToast} />
      </div>

      <VmMaintenancePanel addToast={addToast} />

      {/* Reservado para o futuro fluxo de atendimento automatizado */}
      <div className="bg-card border border-dashed border-border rounded-2xl p-6 text-center text-xs text-muted-foreground">
        🤖 Atendimento automatizado via WhatsApp — em breve aqui.
      </div>
    </div>
  );
}