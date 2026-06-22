"use client";
import { useEffect, useRef, useState } from "react";
import {
  Loader2, RefreshCcw, Plug, Ban, CheckCircle2,
  Power, RotateCw, Wrench, X, ChevronDown, ChevronRight,
} from "lucide-react";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";
import { useConfirm } from "@/app/admin/HookuseConfirm";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getCurrentTenantId } from "@/lib/tenant";

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
  const [showAllowedSection, setShowAllowedSection] = useState(false);
  const [showMessageSection, setShowMessageSection] = useState(false);
const [allowedList, setAllowedList] = useState<AllowedRow[]>([]);
  const [savedAllowedNumbers, setSavedAllowedNumbers] = useState<string[]>([]);
const [savingConfig, setSavingConfig] = useState(false);
  const [botEnabled, setBotEnabled] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);

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
        setSavedAllowedNumbers(json.allowedNumbers ?? []);
        setBotEnabled(json.botEnabled ?? false);
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
        setShowAllowedSection(false);
        setShowMessageSection(false);
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
    // Carrega tenantId uma vez — necessário pra o bot saber a qual tenant pertence
    import("@/lib/tenant").then(({ getCurrentTenantId }) => {
      getCurrentTenantId().then((tid) => { if (tid) setTenantId(tid); });
    });

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
  async function saveConfig(overrides: Partial<{ rejectCalls: boolean; rejectMessage: string; allowedNumbers: string[]; botEnabled: boolean }> = {}) {
    setSavingConfig(true);
    try {
const payload = {
        rejectCalls: overrides.rejectCalls ?? rejectCalls,
        rejectMessage: overrides.rejectMessage ?? rejectMessage,
        allowedNumbers: overrides.allowedNumbers ?? stringifyAllowed(allowedList),
        botEnabled: overrides.botEnabled ?? botEnabled,
        ...(tenantId ? { tenantId } : {}),
      };
      const res = await fetch(route("config"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
if (res.ok) {
        addToast("success", "Configuração salva");
        setSavedAllowedNumbers(payload.allowedNumbers);
      }
    } finally {
      setSavingConfig(false);
    }
  }

async function handleToggleRejectCalls() {
    const next = !rejectCalls;
    setRejectCalls(next);
    await saveConfig({ rejectCalls: next });
  }

  async function handleToggleBot() {
    const next = !botEnabled;
    setBotEnabled(next);
    await saveConfig({ botEnabled: next });
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

  const isListDirty = JSON.stringify(stringifyAllowed(allowedList)) !== JSON.stringify(savedAllowedNumbers);

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
            <div className="shrink-0 flex flex-col items-center mx-auto sm:mx-0">
              <div className="w-44 h-44 sm:w-52 sm:h-52 rounded-2xl bg-muted border-2 border-border overflow-hidden flex items-center justify-center shadow-sm">
                {pictureUrl ? (
                  <img src={pictureUrl} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl font-medium text-muted-foreground/60">WA</span>
                )}
              </div>
              <div className="text-center mt-3 text-base font-bold text-foreground tracking-tight truncate max-w-52">
                {pushName || "Aguardando"}
              </div>
            </div>

            {/* Coluna 2 — opções */}
            <div className="flex-1 min-w-0 space-y-3">
{/* Toggle bot de atendimento */}
              <div className="flex items-center justify-between p-3 rounded-xl border border-border">
                <span className="text-sm font-medium text-foreground/90 flex items-center gap-1.5">
                  {botEnabled ? (
                    <span className="text-base leading-none">🤖</span>
                  ) : (
                    <span className="text-base leading-none opacity-40">🤖</span>
                  )}
                  Bot de Atendimento
                  {botEnabled && (
                    <span className="text-[10px] font-medium text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-md">
                      ativo
                    </span>
                  )}
                </span>
                <button
                  onClick={() => void handleToggleBot()}
                  disabled={savingConfig}
                  className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${botEnabled ? "bg-emerald-500" : "bg-muted"}`}
                >
                  <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${botEnabled ? "translate-x-5" : ""}`} />
                </button>
              </div>

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
                  {/* Lista branca — colapsável, fecha de novo a cada refresh */}
                  <div>
                    <button
                      onClick={() => setShowAllowedSection((v) => !v)}
                      className="w-full flex items-center justify-between mb-1.5 group"
                    >
                      <span className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase group-hover:text-foreground transition-colors">
                        {showAllowedSection ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        Números Permitidos
                        <span className="text-muted-foreground/60 normal-case font-normal">({allowedList.length})</span>
                      </span>
                    </button>

                    {showAllowedSection && (
                      <>
                        <div className="flex justify-end mb-1.5">
                          <button
                            onClick={() =>
                              setAllowedList([{ id: Math.random().toString(36).slice(2), name: "", raw: "", loading: false, exists: null }, ...allowedList])
                            }
                            className="text-[10px] font-medium text-emerald-500 hover:underline"
                          >
                            + Adicionar
                          </button>
                        </div>

                        {allowedList.length === 0 ? (
                          <div className="text-xs text-center text-muted-foreground py-3 bg-transparent rounded-xl border border-dashed border-border">
                            Nenhum número liberado.
                          </div>
                        ) : (
                          <div className="border border-border rounded-xl divide-y divide-border overflow-y-auto" style={{ maxHeight: "230px" }}>
                            {allowedList.map((row) => (
                              <div key={row.id} className="flex items-center gap-2 px-3 py-2">
                                <input
                                  value={row.name}
                                  onChange={(e) => setAllowedList((p) => p.map((r) => (r.id === row.id ? { ...r, name: e.target.value } : r)))}
                                  placeholder="Nome"
                                  className="w-1/3 h-7 px-1 text-xs bg-transparent outline-none"
                                />
                                <input
                                  value={row.raw}
                                  onChange={(e) => setAllowedList((p) => p.map((r) => (r.id === row.id ? { ...r, raw: e.target.value } : r)))}
                                  onBlur={() => validateRow(row.id, row.raw)}
                                  placeholder="Número com DDI"
                                  className="flex-1 h-7 px-1 text-xs font-mono bg-transparent outline-none"
                                />
                                <button
                                  onClick={() => setAllowedList((p) => p.filter((r) => r.id !== row.id))}
                                  className="text-rose-500 text-[11px] font-medium shrink-0 hover:underline"
                                >
                                  ✕ Remover
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {isListDirty && (
                          <button
                            onClick={() => void saveConfig()}
                            disabled={savingConfig}
                            className="w-full mt-2 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold shadow-sm"
                          >
                            {savingConfig ? "Salvando..." : "💾 Salvar Lista"}
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {/* Mensagem de resposta — colapsável, clique para editar */}
                  <div>
                    <button
                      onClick={() => setShowMessageSection((v) => !v)}
                      className="w-full flex items-center justify-between mb-1.5 group"
                    >
                      <span className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase group-hover:text-foreground transition-colors">
                        {showMessageSection ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        Mensagem de Resposta
                      </span>
                    </button>

                    {showMessageSection &&
                      (!editingMessage ? (
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
                      ))}
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

// ── Chat de teste / aprendizado do bot ───────────────────────────

type ChatMessage = { role: "user" | "bot"; text: string };

function BotTestChat({ tenantId }: { tenantId: string | null }) {
  const [clients, setClients] = useState<{ id: string; display_name: string }[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    supabaseBrowser
      .from("clients")
      .select("id, display_name")
      .eq("is_archived", false)
      .order("display_name")
      .limit(200)
      .then(({ data }: any) => setClients(data || []));
  }, [isOpen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: userMsg }]);
    setLoading(true);
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/whatsapp/bot/chat-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: userMsg,
          client_id: selectedClientId || undefined,
          conversation_history: history,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.ok && json.response) {
        setMessages((prev) => [...prev, { role: "bot", text: json.response }]);
        setHistory(json.updated_history || []);
      } else {
        setMessages((prev) => [...prev, { role: "bot", text: `❌ Erro: ${json.error || "sem resposta"}` }]);
      }
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "bot", text: `❌ Erro: ${e?.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  async function saveAsTemplate(text: string) {
    const name = window.prompt("Nome do template:");
    if (!name?.trim()) return;
    const category = window.prompt("Categoria (ex: Manutenção, Pagamento):", "Geral");
    if (!category) return;
    setSavingTemplate(text);
    const tid = await getCurrentTenantId();
    await supabaseBrowser.from("message_templates").insert({
      tenant_id: tid, name: name.trim(), category: category.trim(), content: text, is_active: true,
    });
    setSavingTemplate(null);
    window.alert("Template salvo! O bot vai usar esse conhecimento nas próximas conversas.");
  }

  function clearChat() { setMessages([]); setHistory([]); }

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <div className="text-left">
            <p className="text-sm font-medium text-foreground">Chat de Treinamento do Bot</p>
            <p className="text-[11px] text-muted-foreground">Teste respostas e salve conhecimento novo como template</p>
          </div>
        </div>
        {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      </button>

      {isOpen && (
        <div className="border-t border-border">
          <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
            <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider shrink-0">Simular cliente:</span>
            <select
              value={selectedClientId}
              onChange={(e) => { setSelectedClientId(e.target.value); clearChat(); }}
              className="flex-1 min-w-0 h-8 px-2 text-xs bg-transparent border border-border rounded-lg outline-none focus:border-emerald-500/50"
            >
              <option value="">Genérico (sem dados reais)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.display_name}</option>
              ))}
            </select>
            {messages.length > 0 && (
              <button onClick={clearChat} className="text-[10px] text-muted-foreground hover:text-foreground shrink-0">
                Limpar chat
              </button>
            )}
          </div>

          <div className="h-80 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground text-center">
                Digite uma mensagem como se fosse um cliente.<br />
                O bot responderá exatamente como faria no WhatsApp real.
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className="max-w-[80%] space-y-1">
                  <div className={`px-3 py-2 rounded-xl text-xs whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-emerald-500 text-white rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm"
                  }`}>
                    {msg.text}
                  </div>
                  {msg.role === "bot" && (
                    <button
                      onClick={() => saveAsTemplate(msg.text)}
                      disabled={savingTemplate === msg.text}
                      className="text-[10px] text-muted-foreground hover:text-emerald-500 transition-colors pl-1"
                    >
                      {savingTemplate === msg.text ? "Salvando..." : "💾 Salvar como template"}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted px-3 py-2 rounded-xl rounded-bl-sm">
                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-border p-3 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }}
              placeholder="Digite como se fosse o cliente..."
              className="flex-1 h-9 px-3 text-xs bg-transparent border border-border rounded-lg outline-none focus:border-emerald-500/50"
            />
            <button
              onClick={() => void sendMessage()}
              disabled={loading || !input.trim()}
              className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50 transition-all"
            >
              Enviar
            </button>
          </div>
        </div>
      )}
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

<BotTestChat tenantId={null} />

      {showVmMenu && <VmMaintenanceModal onClose={() => setShowVmMenu(false)} addToast={addToast} />}
    </div>
  );
}