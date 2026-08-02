"use client";
// app/admin/settings/whatsapp/page.tsx
import { useEffect, useRef, useState } from "react";
import {
  Loader2, RefreshCcw, Plug, Ban, CheckCircle2,
  Power, RotateCw, Wrench, X, ChevronDown, ChevronRight,
  Search, Plus, Trash2, Edit3, XCircle, Sparkles,
  BookOpen, Tag, MessageSquare,
} from "lucide-react";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import { useConfirm } from "@/hooks/useConfirm";
import { usePrompt } from "@/hooks/usePrompt";
import { supabaseBrowser } from "@/lib/supabase/browser";
import BotMenuTreeEditor from "@/components/whatsapp/BotMenuTreeEditor";
import { ALL_DEVICE_TYPES, DEVICE_TYPE_LABELS } from "@/lib/apps/device-types";



// ── Ícone WhatsApp ────────────────────────────────────────────
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  );
}

// ── Helpers lista branca ──────────────────────────────────────
function onlyDigits(raw: string) { return raw.replace(/\D+/g, ""); }
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

// ── Tipos ─────────────────────────────────────────────────────
type KnowledgeItem = {
  id: string;
  title: string;
  category: string;
  content: string;
  is_active: boolean;
  applies_to_servers: string[] | null;
  created_at: string;
  updated_at: string;
  portal_visible: boolean;
  portal_category: "faq" | "device_setup" | null;
  portal_content: string | null;
  portal_device_types: string[];
};

// ✅ Enum fechado do sistema — os únicos providers de servidor suportados.
const SERVER_OPTIONS = [
  { value: "NATV", label: "NaTV" },
  { value: "FAST", label: "Fast" },
  { value: "ELITE", label: "Elite" },
];

type ChatMessage = {
  role: "user" | "bot";
  text: string;
  // ✅ Metadados de depuração — só preenchidos em mensagens do bot, mostram
  // o que o motor de menu decidiu nessa resposta (útil pra validar cada
  // cenário no simulador, igual você pediu).
  meta?: {
    action?: string;
    next_state?: string;
    next_state_label?: string | null;
    escalate?: boolean;
    mark_read?: boolean;
  };
};

// ── Formatação do número conectado (mesmo padrão usado nas outras páginas
// que mostram "Contato Principal/Secundário • +55 (21) 9...") ────────────
function extractWaNumberFromJid(jid?: unknown): string {
  if (typeof jid !== "string") return "";
  const raw = jid.split("@")[0]?.split(":")[0] ?? "";
  return raw.replace(/\D/g, "");
}
function formatBRPhoneFromDigits(digits: string): string {
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) {
    const country = digits.slice(0, 2);
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    if (rest.length === 9) return `+${country} (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    if (rest.length === 8) return `+${country} (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
    return `+${country} (${ddd}) ${rest}`;
  }
  return `+${digits}`;
}

// ── Card de sessão WhatsApp (igual ao original) ───────────────
function WhatsAppSessionCard({
  label, apiSuffix, addToast,
}: {
  label: string; apiSuffix: "" | "2";
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
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [rejectCalls, setRejectCalls] = useState(true);
  const [rejectMessage, setRejectMessage] = useState("{saudacao}! 😊\nNo momento não estou recebendo ligações. Por favor, envie mensagem e aguarde retorno.");
  const [editingMessage, setEditingMessage] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  // ✅ Só faz sentido na Sessão 2 (apiSuffix "2"): número corporativo que não
  // atende — redireciona toda mensagem recebida pra Sessão 1.
  const [redirectEnabled, setRedirectEnabled] = useState(false);
  // ✅ Só relevante na Sessão 2: não faz sentido redirecionar mensagem pra
  // uma sessão cujo Bot de Atendimento está desligado — o cliente ficaria
  // sem resposta nenhuma lá. Começa em `true` (otimista) até a 1ª busca real
  // confirmar, pra não travar o toggle antes da resposta chegar.
  const [session1BotEnabled, setSession1BotEnabled] = useState(true);
  const [redirectMessage, setRedirectMessage] = useState(
    "Olá! 😊 Você enviou uma mensagem para um número que não é utilizado para atendimento — este telefone é de uso corporativo. Esta mensagem já está chegando pelo número correto: qualquer assunto sobre sua assinatura deve ser tratado por aqui a partir de agora, não pelo outro número."
  );
  const [editingRedirectMessage, setEditingRedirectMessage] = useState(false);
  const [draftRedirectMessage, setDraftRedirectMessage] = useState("");
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
    } catch { return { connected: false, status: "error" }; }
  }
  async function fetchProfile() {
    try {
      const res = await fetch(route("profile"), { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      setPushName(json.pushName ?? null);
      setPictureUrl(json.pictureUrl ?? null);
      setPhoneNumber(formatBRPhoneFromDigits(extractWaNumberFromJid(json.jid)) || null);
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

        let effectiveRedirectEnabled = json.redirectEnabled ?? false;
        if (apiSuffix === "2") {
          try {
            const s1Res = await fetch("/api/whatsapp/config", { cache: "no-store" });
            const s1Json = await s1Res.json().catch(() => ({}));
            const s1BotEnabled = !!s1Json.botEnabled;
            setSession1BotEnabled(s1BotEnabled);
            // ✅ Se o bot da Sessão 1 foi desligado enquanto o redirect estava
            // ativo aqui, desativa automaticamente — não deixa o cliente sem
            // resposta nenhuma numa sessão que não vai atendê-lo.
            if (effectiveRedirectEnabled && !s1BotEnabled) {
              effectiveRedirectEnabled = false;
              fetch(route("config"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ redirectEnabled: false, ...(tenantId ? { tenantId } : {}) }),
              }).catch(() => {});
              addToast("error", "Redirecionamento desativado", "O Bot de Atendimento da Sessão 1 está desligado — desativei o redirecionamento da Sessão 2 automaticamente.");
            }
          } catch {}
        }
        setRedirectEnabled(effectiveRedirectEnabled);
        if (json.redirectMessage) setRedirectMessage(json.redirectMessage);
      }
    } catch {}
  }
  async function refreshPanel(forceQr = false, showLoading = true) {
    if (showLoading) setLoading(true);
    try {
      const { connected: isConn, status } = await fetchStatus();
      if (isConn) {
        setIsDormant(false); setQrDataUrl(null);
        await Promise.all([fetchProfile(), fetchConfig()]);
        setShowAllowedSection(false); setShowMessageSection(false);
        if (showLoading) addToast("success", "Sincronizado");
        return;
      }
      if (forceQr || status === "qr" || status === "connecting") {
        const res = await fetch(route("qr"), { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        setQrDataUrl(json.qr || null);
      } else { setQrDataUrl(null); }
    } finally { if (showLoading) setLoading(false); }
  }
  useEffect(() => {
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

  async function saveConfig(overrides: Partial<{ rejectCalls: boolean; rejectMessage: string; allowedNumbers: string[]; botEnabled: boolean; redirectEnabled: boolean; redirectMessage: string }> = {}) {
    setSavingConfig(true);
    try {
      const payload = {
        rejectCalls: overrides.rejectCalls ?? rejectCalls,
        rejectMessage: overrides.rejectMessage ?? rejectMessage,
        allowedNumbers: overrides.allowedNumbers ?? stringifyAllowed(allowedList),
        botEnabled: overrides.botEnabled ?? botEnabled,
        redirectEnabled: overrides.redirectEnabled ?? redirectEnabled,
        redirectMessage: overrides.redirectMessage ?? redirectMessage,
        ...(tenantId ? { tenantId } : {}),
      };
      const res = await fetch(route("config"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (res.ok) { addToast("success", "Configuração salva"); setSavedAllowedNumbers(payload.allowedNumbers); }
    } finally { setSavingConfig(false); }
  }
  async function handleToggleRejectCalls() { const next = !rejectCalls; setRejectCalls(next); await saveConfig({ rejectCalls: next }); }
  async function handleToggleRedirect() {
    const next = !redirectEnabled;
    if (next && apiSuffix === "2" && !session1BotEnabled) {
      addToast("error", "Ative o Bot de Atendimento da Sessão 1 primeiro", "Não faz sentido redirecionar pra lá com o bot de lá desligado — o cliente ficaria sem resposta nenhuma.");
      return;
    }
    setRedirectEnabled(next);
    await saveConfig({ redirectEnabled: next });
  }
  function startEditRedirectMessage() { setDraftRedirectMessage(redirectMessage); setEditingRedirectMessage(true); }
  async function confirmEditRedirectMessage() { setRedirectMessage(draftRedirectMessage); setEditingRedirectMessage(false); await saveConfig({ redirectMessage: draftRedirectMessage }); }
  async function handleToggleBot() { const next = !botEnabled; setBotEnabled(next); await saveConfig({ botEnabled: next }); }
  function startEditMessage() { setDraftMessage(rejectMessage); setEditingMessage(true); }
  async function confirmEditMessage() { setRejectMessage(draftMessage); setEditingMessage(false); await saveConfig({ rejectMessage: draftMessage }); }
  async function validateRow(id: string, raw: string) {
    const digits = onlyDigits(raw);
    if (digits.length < 8) { setAllowedList((p) => p.map((r) => (r.id === id ? { ...r, exists: false } : r))); return; }
    setAllowedList((p) => p.map((r) => (r.id === id ? { ...r, loading: true } : r)));
    try {
      const res = await fetch("/api/whatsapp/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: digits }) });
      const json = await res.json().catch(() => ({}));
      setAllowedList((p) => p.map((r) => (r.id === id ? { ...r, loading: false, exists: !!json.exists } : r)));
    } catch { setAllowedList((p) => p.map((r) => (r.id === id ? { ...r, loading: false, exists: false } : r))); }
  }
  async function handleDisconnect() {
    const ok = await confirm({ title: "Desconectar?", subtitle: "A sessão será encerrada.", tone: "rose", confirmText: "Desconectar", cancelText: "Voltar" });
    if (!ok) return;
    setLoading(true);
    try { await fetch(route("disconnect"), { method: "POST" }); setConnected(false); setQrDataUrl(null); setPushName(null); setPictureUrl(null); setIsDormant(true); addToast("success", "Desconectado"); }
    finally { setLoading(false); }
  }
  async function handleReconnect() {
    const ok = await confirm({ title: "Reconectar?", subtitle: "A sessão será reiniciada.", tone: "amber", confirmText: "Reconectar", cancelText: "Voltar" });
    if (!ok) return;
    setReconnecting(true);
    try { await fetch(route("reconnect"), { method: "POST" }); setConnected(false); setQrDataUrl(null); setIsDormant(false); setTimeout(() => void refreshPanel(true, false), 4000); }
    finally { setReconnecting(false); }
  }
  const isListDirty = JSON.stringify(stringifyAllowed(allowedList)) !== JSON.stringify(savedAllowedNumbers);

  return (
    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-widest">WhatsApp — {label}</h3>
        {!isDormant && (
          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-medium border ${connected ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-rose-500/10 text-rose-500 border-rose-500/20"}`}>
            {connected ? "On-line" : "Off-line"}
          </span>
        )}
      </div>
      {isDormant && !connected ? (
        <button onClick={() => { setIsDormant(false); void refreshPanel(true); }} className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-sm">
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
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-5">
            <div className="shrink-0 flex flex-col items-center mx-auto sm:mx-0">
              <div className="w-44 h-44 sm:w-52 sm:h-52 rounded-2xl bg-muted border-2 border-border overflow-hidden flex items-center justify-center shadow-sm">
                {pictureUrl ? <img src={pictureUrl} alt="Avatar" className="w-full h-full object-cover" /> : <span className="text-2xl font-medium text-muted-foreground/60">WA</span>}
              </div>
              <div className="text-center mt-3 text-base font-bold text-foreground tracking-tight truncate max-w-52">{pushName || "Aguardando"}</div>
              {phoneNumber && <div className="text-center text-xs text-muted-foreground font-mono">{phoneNumber}</div>}
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <div className="flex items-center justify-between p-3 rounded-xl border border-border">
                <span className="text-sm font-medium text-foreground/90 flex items-center gap-1.5">
                  <span className={`text-base leading-none ${botEnabled ? "" : "opacity-40"}`}>🤖</span>
                  Bot de Atendimento
                  {botEnabled && <span className="text-[10px] font-medium text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-md">ativo</span>}
                </span>
                <button onClick={() => void handleToggleBot()} disabled={savingConfig} className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${botEnabled ? "bg-emerald-500" : "bg-muted"}`}>
                  <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${botEnabled ? "translate-x-5" : ""}`} />
                </button>
              </div>
              {apiSuffix === "2" && (
                <div className="p-3 rounded-xl border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground/90 flex items-center gap-1.5">
                      <span className={`text-base leading-none ${redirectEnabled ? "" : "opacity-40"}`}>↪️</span>
                      Número não atende — redireciona pra Sessão 1
                    </span>
                    <button
                      onClick={() => void handleToggleRedirect()}
                      disabled={savingConfig || (apiSuffix === "2" && !session1BotEnabled)}
                      title={apiSuffix === "2" && !session1BotEnabled ? "Ative o Bot de Atendimento da Sessão 1 primeiro" : undefined}
                      className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${redirectEnabled ? "bg-amber-500" : "bg-muted"} ${apiSuffix === "2" && !session1BotEnabled ? "opacity-40 cursor-not-allowed" : ""}`}
                    >
                      <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${redirectEnabled ? "translate-x-5" : ""}`} />
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Quando ativado, o bot não atende por aqui — só manda o aviso abaixo (pelo número da Sessão 1) e mais nada.
                  </p>
                  {!session1BotEnabled && (
                    <p className="text-[10px] text-rose-500">
                      ⚠️ O Bot de Atendimento da Sessão 1 está desligado — ative-o lá primeiro pra poder habilitar o redirecionamento aqui.
                    </p>
                  )}
                  {redirectEnabled && (!editingRedirectMessage ? (
                    <div onClick={startEditRedirectMessage} className="px-3 py-2 text-xs bg-transparent border border-dashed border-border rounded-xl text-foreground/80 cursor-pointer hover:border-amber-500/50 whitespace-pre-wrap" title="Clique para editar">
                      {redirectMessage || "Clique para definir a mensagem..."}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <textarea value={draftRedirectMessage} onChange={(e) => setDraftRedirectMessage(e.target.value)} rows={4} autoFocus className="w-full px-3 py-2 text-xs bg-card border border-amber-500/50 rounded-xl outline-none resize-none" />
                      <div className="flex gap-2">
                        <button onClick={() => setEditingRedirectMessage(false)} className="flex-1 py-1.5 rounded-lg border border-border text-[10px] font-medium text-muted-foreground">Cancelar</button>
                        <button onClick={() => void confirmEditRedirectMessage()} disabled={savingConfig} className="flex-1 py-1.5 rounded-lg bg-amber-600 text-white text-[10px] font-bold">{savingConfig ? "Salvando..." : "✓ Salvar"}</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between p-3 rounded-xl border border-border">
                <span className="text-sm font-medium text-foreground/90 flex items-center gap-1.5">
                  {rejectCalls ? <Ban className="w-3.5 h-3.5 text-rose-500" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                  Rejeitar Chamadas
                </span>
                <button onClick={() => void handleToggleRejectCalls()} disabled={savingConfig} className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${rejectCalls ? "bg-emerald-500" : "bg-muted"}`}>
                  <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${rejectCalls ? "translate-x-5" : ""}`} />
                </button>
              </div>
              {rejectCalls && (
                <>
                  <div>
                    <button onClick={() => setShowAllowedSection((v) => !v)} className="w-full flex items-center justify-between mb-1.5 group">
                      <span className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase group-hover:text-foreground transition-colors">
                        {showAllowedSection ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        Números Permitidos <span className="text-muted-foreground/60 normal-case font-normal">({allowedList.length})</span>
                      </span>
                    </button>
                    {showAllowedSection && (
                      <>
                        <div className="flex justify-end mb-1.5">
                          <button onClick={() => setAllowedList([{ id: Math.random().toString(36).slice(2), name: "", raw: "", loading: false, exists: null }, ...allowedList])} className="text-[10px] font-medium text-emerald-500 hover:underline">+ Adicionar</button>
                        </div>
                        {allowedList.length === 0 ? (
                          <div className="text-xs text-center text-muted-foreground py-3 bg-transparent rounded-xl border border-dashed border-border">Nenhum número liberado.</div>
                        ) : (
                          <div className="border border-border rounded-xl divide-y divide-border overflow-y-auto" style={{ maxHeight: "230px" }}>
                            {allowedList.map((row) => (
                              <div key={row.id} className="flex items-center gap-2 px-3 py-2">
                                <input value={row.name} onChange={(e) => setAllowedList((p) => p.map((r) => (r.id === row.id ? { ...r, name: e.target.value } : r)))} placeholder="Nome" className="w-1/3 h-7 px-1 text-xs bg-transparent outline-none" />
                                <input value={row.raw} onChange={(e) => setAllowedList((p) => p.map((r) => (r.id === row.id ? { ...r, raw: e.target.value } : r)))} onBlur={() => validateRow(row.id, row.raw)} placeholder="Número com DDI" className="flex-1 h-7 px-1 text-xs font-mono bg-transparent outline-none" />
                                <button onClick={() => setAllowedList((p) => p.filter((r) => r.id !== row.id))} className="text-rose-500 text-[11px] font-medium shrink-0 hover:underline">✕ Remover</button>
                              </div>
                            ))}
                          </div>
                        )}
                        {isListDirty && (
                          <button onClick={() => void saveConfig()} disabled={savingConfig} className="w-full mt-2 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold shadow-sm">
                            {savingConfig ? "Salvando..." : "💾 Salvar Lista"}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  <div>
                    <button onClick={() => setShowMessageSection((v) => !v)} className="w-full flex items-center justify-between mb-1.5 group">
                      <span className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase group-hover:text-foreground transition-colors">
                        {showMessageSection ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        Mensagem de Resposta
                      </span>
                    </button>
                    {showMessageSection && (!editingMessage ? (
                      <div onClick={startEditMessage} className="px-3 py-2 text-xs bg-transparent border border-dashed border-border rounded-xl text-foreground/80 cursor-pointer hover:border-emerald-500/50 whitespace-pre-wrap" title="Clique para editar">
                        {rejectMessage || "Clique para definir a mensagem..."}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-1">
                          {["{saudacao}", "{hora}", "{data}"].map((tag) => (
                            <button key={tag} onClick={() => setDraftMessage((v) => v + tag)} className="text-[10px] px-2 py-0.5 rounded border border-border bg-muted hover:bg-emerald-500/10 text-muted-foreground">{tag}</button>
                          ))}
                        </div>
                        <textarea value={draftMessage} onChange={(e) => setDraftMessage(e.target.value)} rows={3} autoFocus className="w-full px-3 py-2 text-xs bg-card border border-emerald-500/50 rounded-xl outline-none resize-none" />
                        <div className="flex gap-2">
                          <button onClick={() => setEditingMessage(false)} className="flex-1 py-1.5 rounded-lg border border-border text-[10px] font-medium text-muted-foreground">Cancelar</button>
                          <button onClick={() => void confirmEditMessage()} disabled={savingConfig} className="flex-1 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-bold">{savingConfig ? "Salvando..." : "✓ Salvar"}</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-2">
            <button onClick={() => void refreshPanel()} disabled={loading} className="py-2 rounded-xl bg-sky-500/10 text-sky-500 border border-sky-500/20 font-medium text-xs hover:bg-sky-500/20 flex items-center justify-center gap-1.5 disabled:opacity-50">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />} Atualizar
            </button>
            <button onClick={() => void handleReconnect()} disabled={reconnecting} className="py-2 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20 font-medium text-xs hover:bg-amber-500/20 flex items-center justify-center gap-1.5 disabled:opacity-50">
              {reconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />} Reconectar
            </button>
            <button onClick={() => void handleDisconnect()} disabled={!connected} className="py-2 rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20 font-medium text-xs hover:bg-rose-500/20 flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
              <Plug className="w-3.5 h-3.5" /> Desconectar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Modal de Manutenção da VM ─────────────────────────────────
function VmMaintenanceModal({ onClose, addToast }: { onClose: () => void; addToast: (t: "success" | "error", title: string, msg?: string) => void }) {
  const { confirm } = useConfirm();
  const [restartingService, setRestartingService] = useState(false);
  const [rebootingVm, setRebootingVm] = useState(false);
  const [hardResetting, setHardResetting] = useState(false);
  async function handleRestartService() {
    const ok = await confirm({ title: "Reiniciar serviço?", subtitle: "Reinicia o processo do WhatsApp (~10s).", tone: "amber", confirmText: "Reiniciar", cancelText: "Voltar" });
    if (!ok) return;
    setRestartingService(true);
    try { await fetch("/api/whatsapp/restart-service", { method: "POST" }); addToast("success", "Serviço reiniciado"); }
    catch (e: any) { addToast("error", "Erro", e?.message); }
    finally { setTimeout(() => setRestartingService(false), 10000); }
  }
  async function handleRebootVm() {
    const ok = await confirm({ title: "Reiniciar a VM inteira?", subtitle: "Reboot completo (~30-60s de indisponibilidade).", tone: "rose", confirmText: "Reiniciar VM", cancelText: "Voltar" });
    if (!ok) return;
    setRebootingVm(true);
    try {
      const res = await fetch("/api/whatsapp/vm-reboot", { method: "POST" });
      if (res.ok) addToast("success", "VM reiniciando", "Em ~1 minuto tudo volta sozinho.");
      else { const json = await res.json().catch(() => ({})); addToast("error", "Erro ao reiniciar VM", json?.error); }
    } finally { setTimeout(() => setRebootingVm(false), 60000); }
  }
  async function handleHardReset() {
    const ok = await confirm({
      title: "Hard reset — apagar as 2 sessões?",
      subtitle: "Apaga TODAS as credenciais salvas dos 2 números conectados (não preserva nada) e reinicia o serviço. Depois disso as duas sessões ficam desconectadas — você precisa escanear QR Code novo pra cada uma. Só use se reconectar com QR novo não resolveu.",
      tone: "rose",
      confirmText: "Apagar tudo e resetar",
      cancelText: "Voltar",
    });
    if (!ok) return;
    setHardResetting(true);
    try {
      const res = await fetch("/api/whatsapp/hard-reset", { method: "POST" });
      if (res.ok) addToast("success", "Sessões apagadas", "Serviço reiniciando. Gere um QR Code novo pra cada número quando voltar (~10-15s).");
      else { const json = await res.json().catch(() => ({})); addToast("error", "Erro no hard reset", json?.error); }
    } catch (e: any) {
      addToast("error", "Erro no hard reset", e?.message);
    } finally { setTimeout(() => setHardResetting(false), 15000); }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card w-full max-w-md rounded-2xl border border-border p-6 shadow-2xl space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-medium text-foreground flex items-center gap-2"><Wrench className="w-4 h-4 text-muted-foreground" /> Manutenção VM</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Tente nesta ordem: serviço primeiro, VM só se não resolver.</p>
          </div>
          <button onClick={onClose} className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
            <div className="flex items-start gap-2">
              <RotateCw className="w-4 h-4 mt-0.5 text-amber-500" />
              <div className="space-y-1">
                <p className="text-[11px] font-medium text-amber-600">Reiniciar serviço</p>
                <p className="text-[10px] text-muted-foreground">Útil para um restart leve do processo do WhatsApp sem impactar a VM inteira.</p>
              </div>
            </div>
            <button onClick={() => void handleRestartService()} disabled={restartingService} className="mt-3 w-full py-2.5 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20 font-medium text-xs hover:bg-amber-500/20 flex items-center justify-center gap-2">
              {restartingService ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />} Reiniciar Serviço (~10s)
            </button>
          </div>

          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3">
            <div className="flex items-start gap-2">
              <Power className="w-4 h-4 mt-0.5 text-rose-500" />
              <div className="space-y-1">
                <p className="text-[11px] font-medium text-rose-600">Reiniciar VM</p>
                <p className="text-[10px] text-muted-foreground">Use quando o container/host estiver travado e o restart leve não resolver.</p>
              </div>
            </div>
            <button onClick={() => void handleRebootVm()} disabled={rebootingVm} className="mt-3 w-full py-2.5 rounded-lg bg-rose-500/10 text-rose-500 border border-rose-500/20 font-medium text-xs hover:bg-rose-500/20 flex items-center justify-center gap-2">
              {rebootingVm ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />} Reiniciar VM Completa (~60s)
            </button>
          </div>

          <div className="rounded-xl border border-rose-600/20 bg-rose-600/10 p-3">
            <div className="flex items-start gap-2">
              <Trash2 className="w-4 h-4 mt-0.5 text-rose-600" />
              <div className="space-y-1">
                <p className="text-[11px] font-medium text-rose-700">Hard reset</p>
                <p className="text-[10px] text-muted-foreground">Último recurso. Apaga as sessões e força novo QR para as 2 contas.</p>
              </div>
            </div>
            <button onClick={() => void handleHardReset()} disabled={hardResetting} className="mt-3 w-full py-2.5 rounded-lg bg-rose-600 text-white font-bold text-xs hover:bg-rose-500 flex items-center justify-center gap-2">
              {hardResetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Hard Reset — Apagar as 2 sessões
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Tipos de eventos do monitor ───────────────────────────────
type BotEvent = {
  type: "bot_responded" | "human_takeover" | "ignored" | "timeout" | "error";
  phone: string;
  display_name: string | null;
  server_name: string | null;
  server_username: string | null;
  preview: string | null;
  full_response: string | null;
  timestamp: string;
  reason?: string;
};

// ── Monitor do Bot ────────────────────────────────────────────
function BotMonitor({ onClose }: { onClose: () => void }) {
  const [events, setEvents] = useState<BotEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<"feed" | "contacts">("feed");
  const [expandedEvent, setExpandedEvent] = useState<number | null>(null);
  const [selectedContact, setSelectedContact] = useState<string | null>(null);

  async function fetchEvents() {
    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/bot/events");
      const json = await res.json();
      if (json.ok) {
        setEvents(json.events || []);
        setLastFetch(new Date());
      }
    } catch {}
    finally { setLoading(false); }
  }

  useEffect(() => { void fetchEvents(); }, []);

  const contacts = Object.values(
    events.reduce((acc: Record<string, BotEvent>, ev) => {
      if (!acc[ev.phone] || ev.timestamp > acc[ev.phone].timestamp) {
        acc[ev.phone] = ev;
      }
      return acc;
    }, {})
  ).sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const contactEvents = selectedContact
    ? events.filter(e => e.phone === selectedContact)
    : [];

  function statusConfig(type: BotEvent["type"], reason?: string) {
    if (type === "bot_responded")  return { emoji: "🤖", label: "Bot respondeu",       color: "text-emerald-500", bg: "bg-emerald-500/10 border-emerald-500/20" };
    if (type === "human_takeover") return { emoji: "👤", label: "Atendimento humano",  color: "text-amber-500",   bg: "bg-amber-500/10 border-amber-500/20" };
    if (type === "ignored" && reason === "bot_disabled")
                                   return { emoji: "🔇", label: "Bot desligado",        color: "text-muted-foreground", bg: "bg-muted/50 border-border" };
    if (type === "ignored")        return { emoji: "⚫", label: "Ignorado",             color: "text-muted-foreground", bg: "bg-muted/50 border-border" };
    if (type === "timeout")        return { emoji: "⏳", label: "Timeout",              color: "text-orange-500",  bg: "bg-orange-500/10 border-orange-500/20" };
    if (type === "error")          return { emoji: "❌", label: "Erro",                 color: "text-rose-500",    bg: "bg-rose-500/10 border-rose-500/20" };
    return { emoji: "❓", label: type, color: "text-muted-foreground", bg: "bg-muted/50 border-border" };
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Sao_Paulo" });
  }

  function formatRelative(iso: string) {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return `${diff}s atrás`;
    if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
    return `${Math.floor(diff / 86400)}d atrás`;
  }

  function serverLabel(ev: BotEvent) {
    if (!ev.server_name) return null;
    return ev.server_username ? `${ev.server_username} · ${ev.server_name}` : ev.server_name;
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm sm:p-4">
      <div className="bg-card w-full h-full sm:h-[600px] sm:max-w-3xl border-0 sm:border border-border sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <MessageSquare className="w-4 h-4 text-emerald-500" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Monitor do Bot</h2>
              <p className="text-[11px] text-muted-foreground">
                {lastFetch ? `Atualizado às ${lastFetch.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : "Aguardando dados..."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void fetchEvents()} disabled={loading}
              className="h-8 px-3 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:bg-muted transition-all flex items-center gap-1.5 disabled:opacity-50">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />} Atualizar
            </button>
            <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          <button onClick={() => { setActiveTab("feed"); setSelectedContact(null); }}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${activeTab === "feed" ? "text-emerald-500 border-b-2 border-emerald-500" : "text-muted-foreground hover:text-foreground"}`}>
            Feed de Eventos ({events.length})
          </button>
          <button onClick={() => setActiveTab("contacts")}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${activeTab === "contacts" ? "text-emerald-500 border-b-2 border-emerald-500" : "text-muted-foreground hover:text-foreground"}`}>
            Contatos ({contacts.length})
          </button>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-hidden flex">

          {/* FEED */}
          {activeTab === "feed" && (
            <div className="flex-1 overflow-y-auto divide-y divide-border">
              {loading && events.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-xs text-muted-foreground animate-pulse">Carregando eventos...</div>
              ) : events.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-center text-muted-foreground">
                  <MessageSquare className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-xs">Nenhum evento registrado ainda.</p>
                </div>
              ) : events.map((ev, i) => {
                const s = statusConfig(ev.type, ev.reason);
                const isExpanded = expandedEvent === i;
                const label = serverLabel(ev);
                return (
                  <div key={i} className="px-5 py-3 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setExpandedEvent(isExpanded ? null : i)}>
                    <div className="flex items-start gap-3">
                      <span className="text-base shrink-0 mt-0.5">{s.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-[10px] font-semibold ${s.color}`}>{s.label}</span>
                          {label && <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">{label}</span>}
                          <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{formatTime(ev.timestamp)}</span>
                        </div>
                        <p className="text-xs font-medium text-foreground truncate">
                          {ev.display_name || ev.phone}
                          {ev.display_name && <span className="text-muted-foreground font-normal ml-1 font-mono">· {ev.phone}</span>}
                        </p>
                        {ev.preview && !isExpanded && (
                          <p className="text-[10px] text-muted-foreground truncate mt-0.5">{ev.preview}</p>
                        )}
                        {isExpanded && ev.full_response && (
                          <div className="mt-2 p-2.5 bg-muted/40 rounded-lg border border-border">
                            <p className="text-[11px] text-foreground whitespace-pre-wrap leading-relaxed">{ev.full_response}</p>
                          </div>
                        )}
                        {isExpanded && !ev.full_response && ev.preview && (
                          <p className="text-[10px] text-muted-foreground mt-1">{ev.preview}</p>
                        )}
                      </div>
                      <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground shrink-0 mt-1 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* CONTATOS — lista + detalhe lado a lado */}
          {activeTab === "contacts" && (
            <div className="flex-1 flex overflow-hidden">
              {/* Lista de contatos */}
              <div className="w-64 border-r border-border overflow-y-auto shrink-0">
                {contacts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 text-center text-muted-foreground p-4">
                    <p className="text-xs">Nenhum contato ainda.</p>
                  </div>
                ) : contacts.map((ev, i) => {
                  const s = statusConfig(ev.type, ev.reason);
                  const isSelected = selectedContact === ev.phone;
                  return (
                    <div key={i} onClick={() => setSelectedContact(isSelected ? null : ev.phone)}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors border-b border-border ${isSelected ? "bg-emerald-500/5 border-l-2 border-l-emerald-500" : ""}`}>
                      <div className={`w-8 h-8 rounded-xl border flex items-center justify-center text-sm shrink-0 ${s.bg}`}>
                        {s.emoji}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground truncate">{ev.display_name || ev.phone}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`text-[10px] font-medium ${s.color}`}>{s.label}</span>
                          <span className="text-[10px] text-muted-foreground">· {formatRelative(ev.timestamp)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Detalhe do contato selecionado */}
              <div className="flex-1 overflow-y-auto">
                {!selectedContact ? (
                  <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-6">
                    <MessageSquare className="w-8 h-8 mb-2 opacity-20" />
                    <p className="text-xs">Selecione um contato para ver o histórico</p>
                  </div>
                ) : (
                  <div className="p-4 space-y-1">
                    {/* Header do contato */}
                    <div className="pb-3 mb-3 border-b border-border">
                      <p className="text-sm font-semibold text-foreground">
                        {contacts.find(c => c.phone === selectedContact)?.display_name || selectedContact}
                      </p>
                      <p className="text-[11px] text-muted-foreground font-mono">{selectedContact}</p>
                      {contacts.find(c => c.phone === selectedContact)?.server_username && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {serverLabel(contacts.find(c => c.phone === selectedContact)!)}
                        </p>
                      )}
                    </div>
                    {/* Histórico de eventos do contato */}
                    {contactEvents.map((ev, i) => {
                      const s = statusConfig(ev.type, ev.reason);
                      return (
                        <div key={i} className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{s.emoji}</span>
                            <span className={`text-[10px] font-semibold ${s.color}`}>{s.label}</span>
                            <span className="text-[10px] text-muted-foreground ml-auto">{formatTime(ev.timestamp)}</span>
                          </div>
                          {ev.full_response && (
                            <div className="ml-6 p-2.5 bg-muted/40 rounded-lg border border-border">
                              <p className="text-[11px] text-foreground whitespace-pre-wrap leading-relaxed">{ev.full_response}</p>
                            </div>
                          )}
                          {!ev.full_response && ev.preview && (
                            <p className="ml-6 text-[10px] text-muted-foreground">{ev.preview}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Base de Conhecimento RAG ──────────────────────────────────
function KnowledgeBase({ addToast }: { addToast: (type: "success" | "error", title: string, msg?: string) => void }) {
  const { confirm } = useConfirm();
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [selected, setSelected] = useState<KnowledgeItem | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editContent, setEditContent] = useState("");
const [editActive, setEditActive] = useState(true);
  const [editAppliesTo, setEditAppliesTo] = useState<string[]>([]);
  const [showMonitor, setShowMonitor] = useState(false);

  // ── Curadoria pro portal do cliente (separado do content, que é
  // instrução pro bot) ──
  const [editPortalVisible, setEditPortalVisible] = useState(false);
  const [editPortalCategory, setEditPortalCategory] = useState<"faq" | "device_setup">("faq");
  const [editPortalContent, setEditPortalContent] = useState("");
  const [editPortalDeviceTypes, setEditPortalDeviceTypes] = useState<string[]>([]);

  function toggleEditServer(value: string) {
    setEditAppliesTo((prev) => prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]);
  }

  function toggleEditPortalDeviceType(value: string) {
    setEditPortalDeviceTypes((prev) => prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]);
  }

  const categories = [...new Set(items.map((i) => i.category))].sort();

  async function getToken() {
    const { data: { session } } = await supabaseBrowser.auth.getSession();
    return session?.access_token || "";
  }

  async function loadItems() {
    setLoading(true);
    try {
      const token = await getToken();
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (filterCategory) params.set("category", filterCategory);
      const res = await fetch(`/api/whatsapp/bot/knowledge?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (json.ok) setItems(json.data);
    } catch (e: any) { addToast("error", "Erro ao carregar", e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadItems(); }, [filterCategory]);

  function openNew() {
    setIsNew(true);
    setSelected(null);
    setEditTitle("");
    setEditCategory(filterCategory || "Geral");
    setEditContent("");
    setEditActive(true);
    // ✅ Novo item sempre começa com tudo marcado (universal) — o save
    // sempre envia o campo explicitamente, então não dá pra confiar em
    // "omitir = todos" do lado do servidor aqui.
    setEditAppliesTo(SERVER_OPTIONS.map((s) => s.value));
    setEditPortalVisible(false);
    setEditPortalCategory("faq");
    setEditPortalContent("");
    setEditPortalDeviceTypes([]);
  }

  function openEdit(item: KnowledgeItem) {
    setIsNew(false);
    setSelected(item);
    setEditTitle(item.title);
    setEditCategory(item.category);
    setEditContent(item.content);
    setEditActive(item.is_active);
    // ✅ null/undefined = universal (nunca restringido) → mostra tudo marcado
    setEditAppliesTo(
      item.applies_to_servers === null || item.applies_to_servers === undefined
        ? SERVER_OPTIONS.map((s) => s.value)
        : item.applies_to_servers
    );
    setEditPortalVisible(item.portal_visible || false);
    setEditPortalCategory(item.portal_category || "faq");
    setEditPortalContent(item.portal_content || "");
    setEditPortalDeviceTypes(item.portal_device_types || []);
  }

  function closeEditor() { setSelected(null); setIsNew(false); }

  async function handleSave() {
    if (!editTitle.trim() || !editContent.trim()) { addToast("error", "Campos obrigatórios", "Título e conteúdo são necessários."); return; }
    if (editPortalVisible && !editPortalContent.trim()) {
      addToast("error", "Texto pro cliente obrigatório", "Pra ficar visível no portal, preencha o texto client-facing.");
      return;
    }
    setSaving(true);
    try {
      const token = await getToken();
      const portalFields = {
        portal_visible: editPortalVisible,
        portal_category: editPortalCategory,
        portal_content: editPortalContent,
        portal_device_types: editPortalDeviceTypes,
      };
      if (isNew) {
        const res = await fetch("/api/whatsapp/bot/knowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ title: editTitle, category: editCategory, content: editContent, applies_to_servers: editAppliesTo, ...portalFields }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error);
        addToast("success", "Conhecimento salvo!", json.embedding_generated ? "Embedding gerado com sucesso." : "Salvo sem embedding — verifique a API key.");
      } else {
        const res = await fetch("/api/whatsapp/bot/knowledge", {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: selected!.id, title: editTitle, category: editCategory, content: editContent, is_active: editActive, applies_to_servers: editAppliesTo, ...portalFields }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error);
        addToast("success", "Atualizado!", "Embedding regenerado.");
      }
      closeEditor();
      await loadItems();
    } catch (e: any) { addToast("error", "Erro ao salvar", e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(item: KnowledgeItem) {
    const ok = await confirm({ title: "Remover conhecimento?", subtitle: `"${item.title}" será deletado permanentemente.`, tone: "rose", confirmText: "Remover", cancelText: "Cancelar" });
    if (!ok) return;
    try {
      const token = await getToken();
      const res = await fetch(`/api/whatsapp/bot/knowledge?id=${item.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      addToast("success", "Removido");
      if (selected?.id === item.id) closeEditor();
      await loadItems();
    } catch (e: any) { addToast("error", "Erro ao remover", e.message); }
  }

  async function handleToggleActive(item: KnowledgeItem) {
    try {
      const token = await getToken();
      const res = await fetch("/api/whatsapp/bot/knowledge", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: item.id, is_active: !item.is_active }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      await loadItems();
    } catch (e: any) { addToast("error", "Erro", e.message); }
  }

  const filteredItems = items.filter((item) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return item.title.toLowerCase().includes(q) || item.content.toLowerCase().includes(q) || item.category.toLowerCase().includes(q);
  });

  return (
    <>
    {showMonitor && <BotMonitor onClose={() => setShowMonitor(false)} />}
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-violet-500/10 flex items-center justify-center">
            <BookOpen className="w-4 h-4 text-violet-500" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Base de Conhecimento</h2>
            <p className="text-[11px] text-muted-foreground">{items.length} item{items.length !== 1 ? "s" : ""} · busca semântica ativa</p>
          </div>
        </div>
<div className="flex items-center gap-2">
          <button onClick={() => setShowMonitor(true)} className="h-9 px-3 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:bg-muted transition-all flex items-center gap-2">
            <MessageSquare className="w-3.5 h-3.5" /> Monitor
          </button>
          <button onClick={openNew} className="h-9 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center gap-2 shadow-sm transition-all">
            <Plus className="w-3.5 h-3.5" /> Novo
          </button>
        </div>
      </div>

        <div className="grid grid-cols-1 lg:grid-cols-[2fr_4fr] min-h-[600px]">
        {/* Lista */}
        <div className="border-r border-border flex flex-col">
          {/* Busca e filtro */}
          <div className="p-3 border-b border-border space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void loadItems()}
                placeholder="Buscar... (Enter)"
                className="w-full h-9 pl-9 pr-3 text-xs bg-muted/50 border border-border rounded-lg outline-none focus:border-violet-500/50"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setFilterCategory("")}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-medium border transition-colors ${filterCategory === "" ? "bg-violet-500 text-white border-violet-500" : "bg-muted/50 text-muted-foreground border-border hover:border-violet-500/50"}`}
              >
                Todas
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(filterCategory === cat ? "" : cat)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-medium border transition-colors ${filterCategory === cat ? "bg-violet-500 text-white border-violet-500" : "bg-muted/50 text-muted-foreground border-border hover:border-violet-500/50"}`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Itens */}
          <div className="overflow-y-auto divide-y divide-border" style={{ maxHeight: "600px" }}>
            {loading ? (
              <div className="p-6 text-center text-xs text-muted-foreground animate-pulse">Carregando...</div>
            ) : filteredItems.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                {search ? `Nenhum resultado para "${search}"` : "Nenhum item cadastrado ainda."}
                {!search && <p className="mt-2"><button onClick={openNew} className="text-violet-500 hover:underline">Adicionar o primeiro</button></p>}
              </div>
            ) : (
              filteredItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => openEdit(item)}
                  className={`p-3 cursor-pointer hover:bg-muted/50 transition-colors group ${selected?.id === item.id ? "bg-violet-500/5 border-l-2 border-l-violet-500" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.is_active ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                        <p className="text-xs font-medium text-foreground truncate">{item.title}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-violet-500 bg-violet-500/10 px-1.5 py-0.5 rounded font-medium whitespace-nowrap shrink-0">{item.category}</span>
                        {item.applies_to_servers !== null && item.applies_to_servers !== undefined && item.applies_to_servers.length < SERVER_OPTIONS.length && (
                          <span
                            title={item.applies_to_servers.length === 0 ? "Não aparece pra nenhum servidor — confira as marcações" : `Só aparece pra clientes de: ${item.applies_to_servers.join(", ")}`}
                            className={`text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap shrink-0 ${item.applies_to_servers.length === 0 ? "text-rose-500 bg-rose-500/10" : "text-sky-500 bg-sky-500/10"}`}
                          >
                            {item.applies_to_servers.length === 0 ? "nenhum servidor" : item.applies_to_servers.join("/")}
                          </span>
                        )}
                        <p className="text-[10px] text-muted-foreground truncate">{item.content.slice(0, 120)}...</p>
                      </div>
                    </div>
                    {/* botões removidos — ações ficam no editor */}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Editor */}
        <div className="flex flex-col">
          {!selected && !isNew ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
              <BookOpen className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm font-medium mb-1">Selecione um item para editar</p>
              <p className="text-xs">ou crie um novo conhecimento para o bot</p>
              <button onClick={openNew} className="mt-4 h-9 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center gap-2">
                <Plus className="w-3.5 h-3.5" /> Novo conhecimento
              </button>
            </div>
          ) : (
            <div className="flex-1 flex flex-col p-5 gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">{isNew ? "Novo conhecimento" : "Editar"}</h3>
                <button onClick={closeEditor} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"><XCircle className="w-4 h-4" /></button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5"><Edit3 className="w-3 h-3" /> Assunto / Título</label>
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="Ex: Como funciona o cancelamento"
                    className="w-full h-9 px-3 text-xs bg-muted/50 border border-border rounded-lg outline-none focus:border-violet-500/50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5"><Tag className="w-3 h-3" /> Categoria</label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="w-full h-9 px-3 text-xs bg-muted/50 border border-border rounded-lg outline-none focus:border-violet-500/50 text-foreground"
                  >
                    {[...new Set([...categories, "Aplicativos", "Manutenção", "Novos Clientes", "Suporte", "Treinamento", "Vendas", "Geral"])].sort().map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Aplica-se a (deixe tudo desmarcado = todos os servidores)</label>
                <p className="text-[10px] text-muted-foreground/70">
                  Marque só se esse conteúdo for específico de um servidor (ex: código de ativação
                  diferente por servidor) — o bot só mostra pra clientes desses servidores.
                </p>
                <div className="flex flex-wrap gap-3 pt-0.5">
                  {SERVER_OPTIONS.map((s) => (
                    <label key={s.value} className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                      <input type="checkbox" checked={editAppliesTo.includes(s.value)} onChange={() => toggleEditServer(s.value)} />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex-1 space-y-1.5 flex flex-col min-h-[200px]">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">O que o bot precisa saber?</label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  placeholder="Explique livremente. Ex: Para cancelar, o cliente não precisa fazer nada — o acesso para automaticamente no vencimento. Não existe multa."
                  className="flex-1 p-3 text-xs bg-muted/50 border border-border rounded-lg outline-none focus:border-violet-500/50 resize-none leading-relaxed"
                />
              </div>

              <div className="space-y-2 p-3 bg-violet-500/5 rounded-lg border border-violet-500/20">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-semibold text-foreground uppercase tracking-wider">
                    Visível no portal do cliente
                  </label>
                  <button
                    onClick={() => setEditPortalVisible((v) => !v)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${editPortalVisible ? "bg-violet-500" : "bg-muted border border-border"}`}
                  >
                    <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${editPortalVisible ? "translate-x-5" : ""}`} />
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground/70">
                  O texto acima ("O que o bot precisa saber?") é instrução pro
                  bot — nunca aparece pro cliente. Pra mostrar no portal,
                  escreva um texto separado abaixo.
                </p>

                {editPortalVisible && (
                  <div className="space-y-2 pt-1">
                    <div className="flex gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                        <input type="radio" checked={editPortalCategory === "faq"} onChange={() => setEditPortalCategory("faq")} />
                        Dúvidas e sugestões (FAQ)
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                        <input type="radio" checked={editPortalCategory === "device_setup"} onChange={() => setEditPortalCategory("device_setup")} />
                        Como configurar novo dispositivo
                      </label>
                    </div>

                    {editPortalCategory === "device_setup" && (
                      <div className="flex flex-wrap gap-3">
                        {ALL_DEVICE_TYPES.map((dt) => (
                          <label key={dt} className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                            <input type="checkbox" checked={editPortalDeviceTypes.includes(dt)} onChange={() => toggleEditPortalDeviceType(dt)} />
                            {DEVICE_TYPE_LABELS[dt]}
                          </label>
                        ))}
                      </div>
                    )}

                    <textarea
                      value={editPortalContent}
                      onChange={(e) => setEditPortalContent(e.target.value)}
                      placeholder="Texto pronto pro cliente ler, direto no portal. Ex: Instale o app X na loja do seu aparelho, abra e toque em 'Entrar com Xtream Codes'..."
                      className="w-full min-h-[100px] p-3 text-xs bg-muted/50 border border-border rounded-lg outline-none focus:border-violet-500/50 resize-none leading-relaxed"
                    />
                  </div>
                )}
              </div>

              {!isNew && (
  <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border">
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground">Status:</span>
      <span className={`text-xs font-medium ${editActive ? "text-emerald-500" : "text-muted-foreground"}`}>
        {editActive ? "Ativo — bot usa este conhecimento" : "Inativo — bot ignora este item"}
      </span>
      <button
        onClick={() => setEditActive((v) => !v)}
        className={`relative w-11 h-6 rounded-full transition-colors ${editActive ? "bg-emerald-500" : "bg-muted border border-border"}`}
      >
        <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${editActive ? "translate-x-5" : ""}`} />
      </button>
    </div>
    <button
      onClick={() => void handleDelete(selected!)}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-rose-500 bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 transition-colors"
    >
      <Trash2 className="w-3 h-3" /> Excluir
    </button>
  </div>
)}

              <div className="flex gap-3">
                <button onClick={closeEditor} className="flex-1 h-10 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:bg-muted transition-colors">Cancelar</button>
                <button onClick={() => void handleSave()} disabled={saving || !editTitle.trim() || !editContent.trim()} className="flex-1 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-all shadow-sm">
                  {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Gerando embedding...</> : <><Sparkles className="w-3.5 h-3.5" /> Salvar e Indexar</>}
                </button>
              </div>

              <p className="text-[10px] text-muted-foreground/60 text-center">
                O conteúdo é convertido em vetor semântico e indexado automaticamente para busca inteligente.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

// ── Chat flutuante Gemini ────────────────────────────────────
function FloatingChat({ addToast }: { addToast: (type: "success" | "error", title: string, msg?: string) => void }) {
  const { prompt } = usePrompt();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedPhone, setSelectedPhone] = useState("");
  const [selectedLabel, setSelectedLabel] = useState("");
  const [clients, setClients] = useState<{ id: string; display_name: string; whatsapp_username?: string | null }[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [savingItem, setSavingItem] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ✅ Estado do menu (Item 7) — o chat-admin agora tem o mesmo comportamento
  // completo do agent real. Sem rastrear isso aqui, cada mensagem seria
  // tratada como se fosse sempre a primeira (menu do zero toda vez).
  const [botState, setBotState] = useState<string | null>(null);
  const [awaitingPaymentType, setAwaitingPaymentType] = useState(false);
  const [paymentAttempts, setPaymentAttempts] = useState(0);

  // ✅ Mesmo mecanismo de buffer/debounce do bot real (sessionManager.js),
  // mas travado em 5s no total pro simulador — aqui a prioridade é testar
  // rápido, não replicar o tempo de produção (que fica em 15s+15s, sem
  // mudança nenhuma). "digitando..." aparece assim que o buffer abre e some
  // ao processar. Digitar de novo no campo durante a espera reseta o
  // cronômetro, igual detectar o cliente "digitando..." reseta o debounce
  // em produção.
  const ADMIN_STAGE1_MS = 0;
  const ADMIN_STAGE2_MS = 5_000;
  const bufferRef = useRef<string[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [waitingToSend, setWaitingToSend] = useState(false);
  const stage1TimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stage2TimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearAdminTimers() {
    if (stage1TimerRef.current) clearTimeout(stage1TimerRef.current);
    if (stage2TimerRef.current) clearTimeout(stage2TimerRef.current);
  }

  function resetAdminTimers() {
    clearAdminTimers();
    setWaitingToSend(false);
    stage1TimerRef.current = setTimeout(() => {
      setWaitingToSend(true);
      stage2TimerRef.current = setTimeout(() => { void flushAndSend(); }, ADMIN_STAGE2_MS);
    }, ADMIN_STAGE1_MS);
  }

  useEffect(() => {
    return () => clearAdminTimers();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    supabaseBrowser.from("clients").select("id, display_name, whatsapp_username").eq("is_archived", false).order("display_name").limit(200)
      .then(({ data }: any) => setClients(data || []));
  }, [isOpen]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function clearChat() {
    clearAdminTimers();
    bufferRef.current = [];
    setPendingCount(0);
    setWaitingToSend(false);
    setMessages([]);
    // ✅ Reseta o estado do menu — cada nova simulação começa do zero,
    // igual a um contato novo escrevendo pela primeira vez.
    setBotState(null);
    setAwaitingPaymentType(false);
    setPaymentAttempts(0);
  }

  // ✅ Só empilha no buffer e reseta o cronômetro — quem realmente dispara o
  // request é flushAndSend, chamado pelo estágio 2 do debounce (ou na hora,
  // pelo botão "Enviar agora").
  function queueMessage(text: string) {
    setMessages((prev) => [...prev, { role: "user", text }]);
    bufferRef.current = [...bufferRef.current, text];
    setPendingCount(bufferRef.current.length);
    resetAdminTimers();
  }

  function handleSubmit() {
    if (!input.trim()) return;
    const text = input.trim();
    setInput("");
    queueMessage(text);
  }

  async function flushAndSend() {
    clearAdminTimers();
    setWaitingToSend(false);
    // ✅ Junta o lote com quebra de linha — mesmo padrão de callBotAgentBatch
    // no sessionManager.js real, pra tratar várias mensagens seguidas como
    // um só pedido.
    const combined = bufferRef.current.join("\n");
    bufferRef.current = [];
    setPendingCount(0);
    if (!combined.trim() || loading) return;
    setLoading(true);
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/whatsapp/bot/chat-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: combined,
          phone: selectedPhone || undefined,
          bot_state: botState,
          awaiting_payment_type: awaitingPaymentType,
          payment_clarification_attempts: paymentAttempts,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.ok && json.response) {
        setMessages((prev) => [
          ...prev,
          {
            role: "bot",
            text: json.response,
            meta: {
              action: json.action,
              next_state: json.next_state,
              next_state_label: json.next_state_label,
              escalate: json.escalate,
              mark_read: json.mark_read,
            },
          },
        ]);

        // ✅ Atualiza o estado do menu com base na decisão do backend —
        // mesmo contrato do sessionManager.js real (__clear__ → reseta).
        if (typeof json.next_state === "string") {
          setBotState(json.next_state === "__clear__" ? null : json.next_state);
        }

        // ✅ Item 6: contador de tentativas de "Portal ou PIX?" — o
        // chat-admin não tem VM guardando isso, então o front assume esse
        // papel, incrementando a cada rodada em que a pergunta se repete.
        if (json.action === "awaiting_payment_type") {
          setAwaitingPaymentType(true);
          setPaymentAttempts((prev) => prev + 1);
        } else {
          setAwaitingPaymentType(false);
          setPaymentAttempts(0);
        }
      } else {
        setMessages((prev) => [...prev, { role: "bot", text: `❌ ${json.error || "sem resposta"}` }]);
      }
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "bot", text: `❌ ${e?.message}` }]);
    } finally { setLoading(false); }
  }

  async function saveToKnowledge(text: string) {
    const title = await prompt({
      title: "Salvar na base",
      subtitle: "Título para salvar na base de conhecimento",
      label: "Título",
      placeholder: "Ex: Como funciona o teste grátis",
    });
    if (!title?.trim()) return;
    const category = await prompt({
      title: "Categoria",
      subtitle: "Categoria para organizar este item na base de conhecimento",
      label: "Categoria",
      defaultValue: "Geral",
    });
    if (category === null) return;
    setSavingItem(text);
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/whatsapp/bot/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: title.trim(), category: category?.trim() || "Geral", content: text }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      addToast("success", "Salvo na base!", "Embedding gerado e indexado.");
    } catch (e: any) { addToast("error", "Erro ao salvar", e.message); }
    finally { setSavingItem(null); }
  }

  async function saveFeedback(userText: string, botText: string) {
    const ideal = await prompt({
      title: "Corrigir resposta",
      subtitle: "Como o bot deveria ter respondido?",
      label: "Resposta ideal",
    });
    if (!ideal?.trim()) return;
    setSavingItem(botText);
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      const token = session?.access_token;
      const content = `PERGUNTA DO CLIENTE: "${userText}"\n\nRESPOSTA CORRETA: "${ideal.trim()}"`;
      const res = await fetch("/api/whatsapp/bot/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: "Correção de comportamento", category: "Treinamento", content }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      addToast("success", "Correção salva!", "Bot aprenderá na próxima vez.");
    } catch (e: any) { addToast("error", "Erro ao salvar", e.message); }
    finally { setSavingItem(null); }
  }

  return (
    <>
      {/* Botão flutuante */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className={`fixed bottom-6 right-6 z-40 w-14 h-14 rounded-2xl shadow-2xl flex items-center justify-center transition-all duration-300 ${
          isOpen
            ? "bg-rose-500 hover:bg-rose-400 rotate-0 text-white"
            : "bg-card border border-border hover:scale-110"
        }`}
        title={isOpen ? "Fechar simulador" : "Abrir simulador do bot"}
      >
        {isOpen ? (
          <X className="w-6 h-6" />
        ) : (
          <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="gemini-gradient" x1="2.5" y1="2.5" x2="21.5" y2="21.5" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#1C7DFF" />
                <stop offset="33%" stopColor="#9E7DF6" />
                <stop offset="66%" stopColor="#F98980" />
                <stop offset="100%" stopColor="#FFC875" />
              </linearGradient>
            </defs>
            <path
              d="M23.554 11.026a1.18 1.18 0 0 0-.825-.826C18.257 9.043 14.957 5.743 13.8 1.272a1.18 1.18 0 0 0-2.274 0c-1.157 4.47-4.457 7.77-8.928 8.928a1.18 1.18 0 0 0 0 2.274c4.471 1.158 7.771 4.458 8.928 8.929a1.18 1.18 0 0 0 2.274 0c1.157-4.471 4.457-7.771 8.928-8.929a1.18 1.18 0 0 0 .826-.826Z"
              fill="url(#gemini-gradient)"
            />
          </svg>
        )}
      </button>

      {/* Drawer do chat */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-40 w-[380px] max-w-[calc(100vw-3rem)] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden" style={{ height: "560px" }}>
          {/* Header */}
          <div className="px-4 py-3 border-b border-border bg-gradient-to-r from-violet-600/10 to-indigo-600/10 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-white" />
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground">Simulador do Bot</p>
                <p className="text-[10px] text-muted-foreground">
                  {selectedLabel || "Modo genérico"}
                  {botState ? ` · estado: ${botState.split(":")[0]}` : " · estado: (novo contato)"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {messages.length > 0 && (
                <button onClick={clearChat} className="text-[10px] text-rose-500 hover:underline px-2 py-1">Limpar</button>
              )}
            </div>
          </div>

          {/* Seletor de cliente */}
          <div className="px-3 py-2 border-b border-border bg-muted/10 shrink-0">
            <div className="relative">
              <input
                value={clientSearch}
                onChange={(e) => { setClientSearch(e.target.value); setShowDropdown(true); }}
                onFocus={() => setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                placeholder="Simular como cliente... (opcional)"
                className="w-full h-7 px-3 text-[11px] bg-card border border-border rounded-lg outline-none focus:border-violet-500/50"
              />
              {showDropdown && (
                <div className="absolute z-20 top-8 left-0 right-0 bg-card border border-border rounded-xl shadow-xl max-h-40 overflow-y-auto">
                  <button onMouseDown={() => { setSelectedPhone(""); setSelectedLabel(""); setClientSearch(""); setShowDropdown(false); clearChat(); }} className="w-full text-left px-3 py-2 text-[11px] hover:bg-muted text-muted-foreground">Genérico (sem dados reais)</button>
                  {clients.filter((c) => c.whatsapp_username).filter((c, i, a) => a.findIndex(x => x.whatsapp_username === c.whatsapp_username) === i)
                    .filter((c) => { const q = clientSearch.toLowerCase(); return !q || c.display_name?.toLowerCase().includes(q) || c.whatsapp_username?.includes(q); })
                    .map((c, i) => (
                      <button key={i} onMouseDown={() => { setSelectedPhone(c.whatsapp_username || ""); setSelectedLabel(`${c.display_name} — ${c.whatsapp_username}`); setClientSearch(""); setShowDropdown(false); clearChat(); }} className="w-full text-left px-3 py-2 text-[11px] hover:bg-muted border-t border-border/50">
                        <span className="font-medium">{c.display_name}</span> <span className="text-muted-foreground">{c.whatsapp_username}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>

          {/* Mensagens */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full text-[11px] text-muted-foreground text-center px-4 leading-relaxed">
                Simule mensagens de clientes.<br />
                <span className="text-violet-500">Salve boas respostas</span> na base de conhecimento<br />
                ou <span className="text-rose-500">corrija erros</span> para treinar o bot.
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className="max-w-[85%] space-y-1">
                  <div className={`px-3 py-2 rounded-xl text-[11px] whitespace-pre-wrap leading-relaxed ${msg.role === "user" ? "bg-violet-600 text-white rounded-br-sm" : "bg-muted border border-border text-foreground rounded-bl-sm"}`}>
                    {msg.text}
                  </div>
                  {msg.role === "bot" && msg.meta && (
                    <p className="text-[9px] text-muted-foreground/70 pl-1 font-mono">
                      {msg.meta.action}
                      {msg.meta.next_state_label
                        ? ` → ${msg.meta.next_state_label}`
                        : msg.meta.next_state
                          ? ` → ${msg.meta.next_state}`
                          : ""}
                      {msg.meta.escalate ? " · 🚨 escalonado" : ""}
                      {msg.meta.mark_read === false ? " · 📌 não lido" : ""}
                    </p>
                  )}
                  {msg.role === "bot" && (
                    <div className="flex gap-2 pl-1">
                      <button onClick={() => saveToKnowledge(msg.text)} disabled={savingItem === msg.text} className="text-[10px] text-muted-foreground hover:text-violet-500 transition-colors">
                        {savingItem === msg.text ? "..." : "💾 Salvar"}
                      </button>
                      <button onClick={() => { const lastUser = [...messages].slice(0, i).reverse().find(m => m.role === "user")?.text || ""; saveFeedback(lastUser, msg.text); }} className="text-[10px] text-rose-500/70 hover:text-rose-500 transition-colors flex items-center gap-1">
                        <Wrench className="w-3 h-3" /> Corrigir
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {(waitingToSend || loading) && (
              <div className="flex justify-start">
                <div className="bg-muted border border-border px-3 py-2 rounded-xl rounded-bl-sm flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                  {waitingToSend && !loading && <span className="text-[10px] text-muted-foreground">digitando...</span>}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border p-2.5 flex flex-col gap-1.5 bg-muted/10 shrink-0">
            {pendingCount > 0 && (
              <div className="flex items-center justify-between px-0.5">
                <span className="text-[10px] text-muted-foreground">
                  {pendingCount} mensagem{pendingCount > 1 ? "ns" : ""} aguardando envio...
                </span>
                <button onClick={() => void flushAndSend()} className="text-[10px] text-violet-500 hover:underline font-medium">
                  Enviar agora
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  // ✅ Digitar de novo (com o lote ainda pendente) reseta o
                  // cronômetro — mesmo papel do "composing" real do cliente.
                  if (bufferRef.current.length > 0 && e.target.value.trim()) resetAdminTimers();
                }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                placeholder="Mensagem do cliente..."
                className="flex-1 h-9 px-3 text-[11px] bg-card border border-border rounded-xl outline-none focus:border-violet-500/50"
              />
              <button onClick={handleSubmit} disabled={!input.trim()} className="h-9 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-bold disabled:opacity-50 transition-all">
                Enviar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Página principal ──────────────────────────────────────────
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
    <div className="space-y-6 pt-0 pb-24 px-0 sm:px-6 min-h-screen bg-background text-foreground">
      <ToastNotifications toasts={toasts} removeToast={removeToast} />

      {/* Header */}
      <div className="flex items-center justify-between px-3 sm:px-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <WhatsAppIcon className="w-5 h-5 text-emerald-500" /> WhatsApp
          </h1>
          <p className="text-xs text-muted-foreground mt-1">Sessões, base de conhecimento e simulador do bot.</p>
        </div>
        <button onClick={() => setShowVmMenu(true)} className="h-9 px-3 shrink-0 rounded-xl border font-medium text-xs flex items-center gap-2 bg-card border-border text-muted-foreground hover:bg-muted transition-all shadow-sm">
          <Wrench className="w-4 h-4" /><span className="hidden sm:inline">Manutenção VM</span>
        </button>
      </div>

      {/* Sessões */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <WhatsAppSessionCard label="Principal" apiSuffix="" addToast={addToast} />
        <WhatsAppSessionCard label="Secundário" apiSuffix="2" addToast={addToast} />
      </div>

{/* Árvore de Atendimento — menu guiado, editável, sem depender do Gemini */}
      <div className="bg-card border border-border rounded-2xl p-4 sm:p-5">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-foreground">Árvore de Atendimento</h2>
          <p className="text-xs text-muted-foreground mt-1">Menus, submenus e respostas cadastradas — cobre a maior parte dos atendimentos sem gastar tokens do Gemini.</p>
        </div>
        <BotMenuTreeEditor />
      </div>

      {/* Base de Conhecimento RAG — fallback para perguntas fora da árvore */}
      <KnowledgeBase addToast={addToast} />

      {/* Chat flutuante */}
      <FloatingChat addToast={addToast} />

      {showVmMenu && <VmMaintenanceModal onClose={() => setShowVmMenu(false)} addToast={addToast} />}
    </div>
  );
}
