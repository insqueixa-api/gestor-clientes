"use client";
import { useEffect, useRef, useState } from "react";
import {
  Loader2, RefreshCcw, Plug, Ban, CheckCircle2,
  Power, RotateCw, Wrench, X,
} from "lucide-react";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";
import { useConfirm } from "@/app/admin/HookuseConfirm";

// ── Ícone real do WhatsApp ────────────────────────────────────
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  );
}

// ── Helpers (lista branca) ────────────────────────────────────
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

// ── Card de uma sessão ───────────────────────────────────────
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

  const [rejectCalls, setRejectCalls] = useState(true);
  const [rejectMessage, setRejectMessage] = useState(
    "{saudacao}! 😊\nNo momento não estou recebendo ligações. Por favor, envie mensagem e aguarde retorno."
  );
  const [editingMessage, setEditingMessage] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
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

  useEffect(() => {
    if (isDormant) return;
    const t = setInterval(() => void refreshPanel(false, false), connected ? 300000 : 80000);
    return () => clearInterval(t);
  }, [isDormant, connected]);

  // ── Salvar config (toggle / mensagem / lista) ─────────────────
  async function saveConfig(overrides: Partial<{ rejectCalls: boolean; rejectMessage: string; allowedNumbers: string[] }> = {}) {
    setSavingConfig(true);
    try {
      const payload = {
        rejectCalls: overrides.rejectCalls ?? rejectCalls,
        rejectMessage: overrides.rejectMessage ?? rejectMessage,
        allowedNumbers: overrides.allowedNumbers ?? stringifyAllowed(allowedList),
      };
      const res = await fetch(route("config"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) addToast("success", "Configuração salva");
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleToggleRejectCalls() {
    const next = !rejectCalls;
    setRejectCalls(next);
    await saveConfig({ rejectCalls: next });
  }

  function startEditMessage() {
    setDraftMessage(rejectMessage);
    setEditingMessage(true);
  }
  async function confirmEditMessage() {
    setRejectMessage(draftMessage);
    setEditingMessage(false);
    await saveConfig({ rejectMessage: draftMessage });
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
      setAllowedList((p) => p.map((r) => (r.id === id ? { ...r, loading: false, exists: !!json.exists } : r)));
    } catch {
      setAllowedList((p) => p.map((r) => (r.id === id ? { ...r, loading: false, exists: false } : r)));
    }
  }

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

  return (
    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
      {/* Cabeçalho com badge de status ao lado */}
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
          WhatsApp — {label}
        </h3>
        {!isDormant && (
          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-medium border ${connected ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-rose-500/10 text-rose-500 border-rose-500/20"}`}>
            {connected ? "On-line" : "Off-line"}
          </span>
        )}
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
          {qrDataUrl && !connected && (
            <div className="flex flex-col items-center gap-2 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10">
              <img src={qrDataUrl} alt="QR Code" className="w-56 h-56 rounded-xl object-contain" />
              <p className="text-[11px] text-emerald-500 font-medium">📱 Escaneie com o WhatsApp</p>
            </div>
          )}

          {/* Duas colunas: foto | opções */}
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-5">
            {/* Coluna 1 — foto grande quadrada */}
            <div className="shrink-0 mx-auto sm:mx-0">
              <div className="w-44 h-44 sm:w-52 sm:h-52 rounded-2xl bg-muted border-2 border-border overflow-hidden flex items-center justify-center shadow-sm">
                {pictureUrl ? (
                  <img src={pictureUrl} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl font-medium text-muted-foreground/60">WA</span>
                )}
              </div>
              <div className="text-center sm:text-left mt-2 text-sm font-bold text-foreground truncate max-w-52">
                {pushName || "Aguardando"}
              </div>
            </div>

            {/* Coluna 2 — opções */}
            <div className="flex-1 min-w-0 space-y-3">
              {/* Toggle rejeitar chamadas */}
              <div className="flex items-center justify-between p-3 rounded-xl border border-border">
                <span className="text-sm font-medium text-foreground/90 flex items-center gap-1.5">
                  {rejectCalls ? <Ban className="w-3.5 h-3.5 text-rose-500" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                  Rejeitar Chamadas
                </span>
                <button
                  onClick={() => void handleToggleRejectCalls()}
                  disabled={savingConfig}
                  className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${rejectCalls ? "bg-emerald-500" : "bg-muted"}`}
                >
                  <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${rejectCalls ? "translate-x-5" : ""}`} />
                </button>
              </div>

              {rejectCalls && (
                <>
                  {/* Lista branca — 5 visíveis, scroll no resto */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[10px] font-medium text-muted-foreground uppercase">Números Permitidos</label>
                      <button
                        onClick={() =>
                          setAllowedList([{ id: Math.random().toString(36).slice(2), name: "", raw: "", loading: false, exists: null }, ...allowedList])
                        }
                        className="text-[10px] font-medium text-emerald-500 hover:underline"
                      >
                        + Adicionar
                      </button>
                    </div>
                    <div className="space-y-1.5 overflow-y-auto pr-1" style={{ maxHeight: "230px" }}>
                      {allowedList.length === 0 ? (
                        <div className="text-xs text-center text-muted-foreground py-3 bg-transparent rounded-xl border border-dashed border-border">
                          Nenhum número liberado.
                        </div>
                      ) : (
                        allowedList.map((row) => (
                          <div key={row.id} className="flex gap-2 items-center p-1.5 rounded-lg border border-border">
                            <input
                              value={row.name}
                              onChange={(e) => setAllowedList((p) => p.map((r) => (r.id === row.id ? { ...r, name: e.target.value } : r)))}
                              placeholder="Nome"
                              className="w-1/3 h-8 px-2 text-xs bg-card border border-border rounded-lg outline-none"
                            />
                            <input
                              value={row.raw}
                              onChange={(e) => setAllowedList((p) => p.map((r) => (r.id === row.id ? { ...r, raw: e.target.value } : r)))}
                              onBlur={() => validateRow(row.id, row.raw)}
                              placeholder="Número com DDI"
                              className="flex-1 h-8 px-2 text-xs font-mono bg-card border border-border rounded-lg outline-none"
                            />
                            <button onClick={() => setAllowedList((p) => p.filter((r) => r.id !== row.id))} className="text-rose-500 text-xs px-1.5 shrink-0">
                              ✕
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                    <button
                      onClick={() => void saveConfig()}
                      disabled={savingConfig}
                      className="w-full mt-2 py-1.5 rounded-lg bg-muted border border-border text-[10px] font-medium text-muted-foreground hover:bg-card"
                    >
                      {savingConfig ? "Salvando..." : "💾 Salvar Lista"}
                    </button>
                  </div>

                  {/* Mensagem de resposta — clique para editar */}
                  <div>
                    <label className="block text-[10px] font-medium text-muted-foreground uppercase mb-1.5">Mensagem de Resposta</label>
                    {!editingMessage ? (
                      <div
                        onClick={startEditMessage}
                        className="px-3 py-2 text-xs bg-transparent border border-dashed border-border rounded-xl text-foreground/80 cursor-pointer hover:border-emerald-500/50 whitespace-pre-wrap"
                        title="Clique para editar"
                      >
                        {rejectMessage || "Clique para definir a mensagem..."}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-1">
                          {["{saudacao}", "{hora}", "{data}"].map((tag) => (
                            <button
                              key={tag}
                              onClick={() => setDraftMessage((v) => v + tag)}
                              className="text-[10px] px-2 py-0.5 rounded border border-border bg-muted hover:bg-emerald-500/10 text-muted-foreground"
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                        <textarea
                          value={draftMessage}
                          onChange={(e) => setDraftMessage(e.target.value)}
                          rows={3}
                          autoFocus
                          className="w-full px-3 py-2 text-xs bg-card border border-emerald-500/50 rounded-xl outline-none resize-none"
                        />
                        <div className="flex gap-2">
                          <button onClick={() => setEditingMessage(false)} className="flex-1 py-1.5 rounded-lg border border-border text-[10px] font-medium text-muted-foreground">
                            Cancelar
                          </button>
                          <button onClick={() => void confirmEditMessage()} disabled={savingConfig} className="flex-1 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-bold">
                            {savingConfig ? "Salvando..." : "✓ Salvar"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 3 botões lado a lado */}
          <div className="grid grid-cols-3 gap-2 pt-2">
            <button
              onClick={() => void refreshPanel()}
              disabled={loading}
              className="py-2 rounded-xl bg-sky-500/10 text-sky-500 border border-sky-500/20 font-medium text-xs hover:bg-sky-500/20 flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
              Atualizar
            </button>
            <button
              onClick={() => void handleReconnect()}
              disabled={reconnecting}
              className="py-2 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20 font-medium text-xs hover:bg-amber-500/20 flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCcw className="w-3.5 h-3.5" /> Reconectar
            </button>
            <button
              onClick={() => void handleDisconnect()}
              disabled={!connected}
              className="py-2 rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20 font-medium text-xs hover:bg-rose-500/20 flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plug className="w-3.5 h-3.5" /> Desconectar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Modal de Manutenção da VM ────────────────────────────────
function VmMaintenanceModal({
  onClose,
  addToast,
}: {
  onClose: () => void;
  addToast: (t: "success" | "error", title: string, msg?: string) => void;
}) {
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card w-full max-w-md rounded-2xl border border-border p-6 shadow-2xl space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-medium text-foreground flex items-center gap-2">
              <Wrench className="w-4 h-4 text-muted-foreground" /> Manutenção VM
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Em caso de travamento, tente nesta ordem: serviço primeiro, VM só se não resolver.
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => void handleRestartService()}
            disabled={restartingService}
            className="w-full py-3 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20 font-medium text-xs hover:bg-amber-500/20 flex items-center justify-center gap-2"
          >
            {restartingService ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
            Reiniciar Serviço (~10s)
          </button>
          <button
            onClick={() => void handleRebootVm()}
            disabled={rebootingVm}
            className="w-full py-3 rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20 font-medium text-xs hover:bg-rose-500/20 flex items-center justify-center gap-2"
          >
            {rebootingVm ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
            Reiniciar VM Completa (~60s)
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────
export default function WhatsAppPage() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastSeq = useRef(1);
  const [showVmMenu, setShowVmMenu] = useState(false);

  const addToast = (type: "success" | "error", title: string, message?: string) => {
    const id = Date.now() * 1000 + (toastSeq.current++ % 1000);
    setToasts((prev) => [...prev, { id, type, title, message, durationMs: 5000 }]);
  };
  const removeToast = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-background text-foreground">
      <ToastNotifications toasts={toasts} removeToast={removeToast} />

      <div className="flex items-center justify-between px-3 sm:px-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <WhatsAppIcon className="w-5 h-5 text-emerald-500" /> WhatsApp
          </h1>
          <p className="text-xs text-muted-foreground mt-1">Gerencie suas sessões e a manutenção do serviço.</p>
        </div>
        <button
          onClick={() => setShowVmMenu(true)}
          title="Manutenção VM"
          className="h-9 px-3 shrink-0 rounded-xl border font-medium text-xs flex items-center gap-2 bg-card border-border text-muted-foreground hover:bg-muted transition-all shadow-sm"
        >
          <Wrench className="w-4 h-4" />
          <span className="hidden sm:inline">Manutenção VM</span>
        </button>
      </div>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <WhatsAppSessionCard label="Sessão 1" apiSuffix="" addToast={addToast} />
        <WhatsAppSessionCard label="Sessão 2" apiSuffix="2" addToast={addToast} />
      </div>

      <div className="bg-card border border-dashed border-border rounded-2xl p-6 text-center text-xs text-muted-foreground">
        🤖 Atendimento automatizado via WhatsApp — em breve aqui.
      </div>

      {showVmMenu && <VmMaintenanceModal onClose={() => setShowVmMenu(false)} addToast={addToast} />}
    </div>
  );
}