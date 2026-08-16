"use client";
// app/admin/settings/whatsapp/page.tsx
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Loader2,
  RefreshCcw,
  Plug,
  Ban,
  CheckCircle2,
  Wrench,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import { useConfirm } from "@/hooks/useConfirm";
import { usePrompt } from "@/hooks/usePrompt";
import { useTenantId } from "@/lib/tenant-context";

const VmMaintenanceModal = dynamic(() => import("./VmMaintenanceModal"), {
  ssr: false,
});

// ── Ícone WhatsApp ────────────────────────────────────────────
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  );
}

// ── Helpers lista branca ──────────────────────────────────────
function onlyDigits(raw: string) {
  return raw.replace(/\D+/g, "");
}
type AllowedRow = {
  id: string;
  name: string;
  raw: string;
  loading: boolean;
  exists: boolean | null;
};
function parseAllowed(arr: string[]): AllowedRow[] {
  return arr.map((entry) => {
    const [digits, ...rest] = entry.trim().split(" ");
    return {
      id: Math.random().toString(36).slice(2),
      name: rest.join(" "),
      raw: digits || "",
      loading: false,
      exists: true,
    };
  });
}
function stringifyAllowed(rows: AllowedRow[]): string[] {
  return rows
    .filter((r) => r.raw.trim())
    .map((r) => `${onlyDigits(r.raw)} ${r.name}`.trim());
}

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
    if (rest.length === 9)
      return `+${country} (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    if (rest.length === 8)
      return `+${country} (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
    return `+${country} (${ddd}) ${rest}`;
  }
  return `+${digits}`;
}

// ── Card de sessão WhatsApp (igual ao original) ───────────────
function WhatsAppSessionCard({
  label,
  apiSuffix,
  addToast,
}: {
  label: string;
  apiSuffix: "" | "2";
  addToast: (type: "success" | "error", title: string, msg?: string) => void;
}) {
  const resolvedTenantId = useTenantId();
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
  const [rejectMessage, setRejectMessage] = useState(
    "{saudacao}! 😊\nNo momento não estou recebendo ligações. Por favor, envie mensagem e aguarde retorno.",
  );
  const [editingMessage, setEditingMessage] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const [showAllowedSection, setShowAllowedSection] = useState(false);
  const [showMessageSection, setShowMessageSection] = useState(false);
  const [allowedList, setAllowedList] = useState<AllowedRow[]>([]);
  const [savedAllowedNumbers, setSavedAllowedNumbers] = useState<string[]>([]);
  // ✅ Sem isso, qualquer saveConfig() disparado antes do 1º fetchConfig()
  // bem-sucedido (ex: VM ainda reiniciando logo após um Hard Reset, ou
  // fetchConfig() que falhou em silêncio) mandava allowedNumbers vazio —
  // o `allowedList` inicial do useState — e APAGAVA a lista real gravada
  // no disco da VM, mesmo que o clique do admin fosse só "Rejeitar
  // Chamadas" ou editar a mensagem de rejeição, sem nunca tocar na lista.
  const [configLoaded, setConfigLoaded] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [backingUpAllowed, setBackingUpAllowed] = useState(false);
  const [importingAllowed, setImportingAllowed] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(resolvedTenantId);
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
      setPhoneNumber(
        formatBRPhoneFromDigits(extractWaNumberFromJid(json.jid)) || null,
      );
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
        setConfigLoaded(true);
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
        await Promise.all([fetchProfile(), fetchConfig()]);
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
    fetchStatus().then(({ connected: c, status }) => {
      if (c || status === "qr" || status === "connecting") {
        setIsDormant(false);
        void refreshPanel(false, false);
      }
    });
  }, []);
  useEffect(() => {
    if (isDormant) return;
    const t = setInterval(
      () => void refreshPanel(false, false),
      connected ? 300000 : 80000,
    );
    return () => clearInterval(t);
  }, [isDormant, connected]);

  async function saveConfig(
    overrides: Partial<{
      rejectCalls: boolean;
      rejectMessage: string;
      allowedNumbers: string[];
    }> = {},
  ) {
    setSavingConfig(true);
    try {
      const payload: {
        rejectCalls: boolean;
        rejectMessage: string;
        allowedNumbers?: string[];
        tenantId?: string;
      } = {
        rejectCalls: overrides.rejectCalls ?? rejectCalls,
        rejectMessage: overrides.rejectMessage ?? rejectMessage,
        ...(tenantId ? { tenantId } : {}),
      };
      // ✅ Só manda allowedNumbers se veio explícito (ex: botão "Salvar" da
      // lista) OU se já confirmamos ter carregado a lista real do servidor
      // pelo menos uma vez (configLoaded) — nunca a partir do estado inicial
      // vazio do React, senão uma ação sem relação nenhuma com a lista
      // (ex: toggle de Rejeitar Chamadas) apaga os números permitidos.
      if (overrides.allowedNumbers !== undefined) {
        payload.allowedNumbers = overrides.allowedNumbers;
      } else if (configLoaded) {
        payload.allowedNumbers = stringifyAllowed(allowedList);
      }
      const res = await fetch(route("config"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        addToast("success", "Configuração salva");
        if (payload.allowedNumbers !== undefined) {
          setSavedAllowedNumbers(payload.allowedNumbers);
        }
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

  // ✅ Backup/Import manual da lista de números permitidos (pedido do
  // Márcio, 10/08/2026) — segunda camada de segurança além do fix do bug
  // de sobrescrita: guarda uma cópia no Supabase, sobrevive a qualquer
  // acidente na VM (hard reset, rebuild, disco perdido).
  async function handleBackupAllowed() {
    setBackingUpAllowed(true);
    try {
      const res = await fetch("/api/whatsapp/allowed-backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session: apiSuffix === "2" ? "2" : "1",
          allowedNumbers: stringifyAllowed(allowedList),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        addToast(
          "success",
          "Backup salvo",
          `${json.count ?? allowedList.length} número(s) salvos no Supabase.`,
        );
      } else {
        addToast("error", "Falha ao salvar backup", json.error);
      }
    } catch {
      addToast("error", "Falha ao salvar backup");
    } finally {
      setBackingUpAllowed(false);
    }
  }
  async function handleImportAllowed() {
    setImportingAllowed(true);
    try {
      const res = await fetch(
        `/api/whatsapp/allowed-backup?session=${apiSuffix === "2" ? "2" : "1"}`,
        { cache: "no-store" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        addToast("error", "Falha ao importar backup", json.error);
        return;
      }
      if (!json.allowedNumbers) {
        addToast("error", "Nenhum backup encontrado", "Faça um backup primeiro.");
        return;
      }
      setAllowedList(parseAllowed(json.allowedNumbers));
      addToast(
        "success",
        "Backup importado",
        `${json.allowedNumbers.length} número(s) carregados — clique em "Salvar Lista" pra aplicar.`,
      );
    } catch {
      addToast("error", "Falha ao importar backup");
    } finally {
      setImportingAllowed(false);
    }
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
      setAllowedList((p) =>
        p.map((r) => (r.id === id ? { ...r, exists: false } : r)),
      );
      return;
    }
    setAllowedList((p) =>
      p.map((r) => (r.id === id ? { ...r, loading: true } : r)),
    );
    try {
      const res = await fetch("/api/whatsapp/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits }),
      });
      const json = await res.json().catch(() => ({}));
      setAllowedList((p) =>
        p.map((r) =>
          r.id === id ? { ...r, loading: false, exists: !!json.exists } : r,
        ),
      );
    } catch {
      setAllowedList((p) =>
        p.map((r) =>
          r.id === id ? { ...r, loading: false, exists: false } : r,
        ),
      );
    }
  }
  async function handleDisconnect() {
    const ok = await confirm({
      title: "Desconectar?",
      subtitle: "A sessão será encerrada.",
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
      subtitle: "A sessão será reiniciada.",
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
  const isListDirty =
    JSON.stringify(stringifyAllowed(allowedList)) !==
    JSON.stringify(savedAllowedNumbers);

  return (
    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
          WhatsApp — {label}
        </h3>
        {!isDormant && (
          <span
            className={`px-2 py-0.5 rounded-lg text-[10px] font-medium border ${connected ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-rose-500/10 text-rose-500 border-rose-500/20"}`}
          >
            {connected ? "On-line" : "Off-line"}
          </span>
        )}
      </div>
      {isDormant && !connected ? (
        <button
          onClick={() => {
            setIsDormant(false);
            void refreshPanel(true);
          }}
          className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-sm"
        >
          {loading ? "Gerando..." : "📲 Inicializar QR Code"}
        </button>
      ) : (
        <>
          {qrDataUrl && !connected && (
            <div className="flex flex-col items-center gap-2 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10">
              <img
                src={qrDataUrl}
                alt="QR Code"
                className="w-56 h-56 rounded-xl object-contain"
              />
              <p className="text-[11px] text-emerald-500 font-medium">
                📱 Escaneie com o WhatsApp
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-5">
            <div className="shrink-0 flex flex-col items-center mx-auto sm:mx-0">
              <div className="w-44 h-44 sm:w-52 sm:h-52 rounded-2xl bg-muted border-2 border-border overflow-hidden flex items-center justify-center shadow-sm">
                {pictureUrl ? (
                  <img
                    src={pictureUrl}
                    alt="Avatar"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-2xl font-medium text-muted-foreground/60">
                    WA
                  </span>
                )}
              </div>
              <div className="text-center mt-3 text-base font-bold text-foreground tracking-tight truncate max-w-52">
                {pushName || "Aguardando"}
              </div>
              {phoneNumber && (
                <div className="text-center text-xs text-muted-foreground font-mono">
                  {phoneNumber}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <div className="flex items-center justify-between p-3 rounded-xl border border-border">
                <span className="text-sm font-medium text-foreground/90 flex items-center gap-1.5">
                  {rejectCalls ? (
                    <Ban className="w-3.5 h-3.5 text-rose-500" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  )}
                  Rejeitar Chamadas
                </span>
                <button
                  onClick={() => void handleToggleRejectCalls()}
                  disabled={savingConfig}
                  className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${rejectCalls ? "bg-emerald-500" : "bg-muted"}`}
                >
                  <span
                    className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${rejectCalls ? "translate-x-5" : ""}`}
                  />
                </button>
              </div>
              {rejectCalls && (
                <>
                  <div>
                    <button
                      onClick={() => setShowAllowedSection((v) => !v)}
                      className="w-full flex items-center justify-between mb-1.5 group"
                    >
                      <span className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase group-hover:text-foreground transition-colors">
                        {showAllowedSection ? (
                          <ChevronDown className="w-3 h-3" />
                        ) : (
                          <ChevronRight className="w-3 h-3" />
                        )}
                        Números Permitidos{" "}
                        <span className="text-muted-foreground/60 normal-case font-normal">
                          ({allowedList.length})
                        </span>
                      </span>
                    </button>
                    {showAllowedSection && (
                      <>
                        <div className="flex items-center justify-end gap-3 mb-1.5">
                          <button
                            onClick={() => void handleImportAllowed()}
                            disabled={importingAllowed}
                            className="text-[10px] font-medium text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
                          >
                            {importingAllowed ? "Importando..." : "⇩ Importar backup"}
                          </button>
                          <button
                            onClick={() => void handleBackupAllowed()}
                            disabled={backingUpAllowed || allowedList.length === 0}
                            className="text-[10px] font-medium text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
                          >
                            {backingUpAllowed ? "Salvando..." : "☁ Backup"}
                          </button>
                          <button
                            onClick={() =>
                              setAllowedList([
                                {
                                  id: Math.random().toString(36).slice(2),
                                  name: "",
                                  raw: "",
                                  loading: false,
                                  exists: null,
                                },
                                ...allowedList,
                              ])
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
                          <div
                            className="border border-border rounded-xl divide-y divide-border overflow-y-auto"
                            style={{ maxHeight: "230px" }}
                          >
                            {allowedList.map((row) => (
                              <div
                                key={row.id}
                                className="flex items-center gap-2 px-3 py-2"
                              >
                                <input
                                  value={row.name}
                                  onChange={(e) =>
                                    setAllowedList((p) =>
                                      p.map((r) =>
                                        r.id === row.id
                                          ? { ...r, name: e.target.value }
                                          : r,
                                      ),
                                    )
                                  }
                                  placeholder="Nome"
                                  className="w-1/3 h-7 px-1 text-xs bg-transparent outline-none"
                                />
                                <input
                                  value={row.raw}
                                  onChange={(e) =>
                                    setAllowedList((p) =>
                                      p.map((r) =>
                                        r.id === row.id
                                          ? { ...r, raw: e.target.value }
                                          : r,
                                      ),
                                    )
                                  }
                                  onBlur={() => validateRow(row.id, row.raw)}
                                  placeholder="Número com DDI"
                                  className="flex-1 h-7 px-1 text-xs font-mono bg-transparent outline-none"
                                />
                                <button
                                  onClick={() =>
                                    setAllowedList((p) =>
                                      p.filter((r) => r.id !== row.id),
                                    )
                                  }
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
                  <div>
                    <button
                      onClick={() => setShowMessageSection((v) => !v)}
                      className="w-full flex items-center justify-between mb-1.5 group"
                    >
                      <span className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase group-hover:text-foreground transition-colors">
                        {showMessageSection ? (
                          <ChevronDown className="w-3 h-3" />
                        ) : (
                          <ChevronRight className="w-3 h-3" />
                        )}
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
                            <button
                              onClick={() => setEditingMessage(false)}
                              className="flex-1 py-1.5 rounded-lg border border-border text-[10px] font-medium text-muted-foreground"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={() => void confirmEditMessage()}
                              disabled={savingConfig}
                              className="flex-1 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-bold"
                            >
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
          <div className="grid grid-cols-3 gap-2 pt-2">
            <button
              onClick={() => void refreshPanel()}
              disabled={loading}
              className="py-2 rounded-xl bg-sky-500/10 text-sky-500 border border-sky-500/20 font-medium text-xs hover:bg-sky-500/20 flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="w-3.5 h-3.5" />
              )}{" "}
              Atualizar
            </button>
            <button
              onClick={() => void handleReconnect()}
              disabled={reconnecting}
              className="py-2 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20 font-medium text-xs hover:bg-amber-500/20 flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {reconnecting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="w-3.5 h-3.5" />
              )}{" "}
              Reconectar
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


// ── Página principal ──────────────────────────────────────────
export default function WhatsAppPage() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastSeq = useRef(1);
  const [showVmMenu, setShowVmMenu] = useState(false);

  const addToast = (
    type: "success" | "error",
    title: string,
    message?: string,
  ) => {
    const id = Date.now() * 1000 + (toastSeq.current++ % 1000);
    setToasts((prev) => [
      ...prev,
      { id, type, title, message, durationMs: 5000 },
    ]);
  };
  const removeToast = (id: number) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <div className="space-y-6 pt-0 pb-24 px-0 sm:px-6 min-h-screen bg-background text-foreground">
      <ToastNotifications toasts={toasts} removeToast={removeToast} />

      {/* Header */}
      <div className="flex items-center justify-between px-3 sm:px-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <WhatsAppIcon className="w-5 h-5 text-emerald-500" /> WhatsApp
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Sessões de envio (usadas pelas automações de cobrança).
          </p>
        </div>
        <button
          onClick={() => setShowVmMenu(true)}
          className="h-9 px-3 shrink-0 rounded-xl border font-medium text-xs flex items-center gap-2 bg-card border-border text-muted-foreground hover:bg-muted transition-all shadow-sm"
        >
          <Wrench className="w-4 h-4" />
          <span className="hidden sm:inline">Manutenção VM</span>
        </button>
      </div>

      {/* Sessões */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <WhatsAppSessionCard
          label="Principal"
          apiSuffix=""
          addToast={addToast}
        />
        <WhatsAppSessionCard
          label="Secundário"
          apiSuffix="2"
          addToast={addToast}
        />
      </div>

      {showVmMenu && (
        <VmMaintenanceModal
          onClose={() => setShowVmMenu(false)}
          addToast={addToast}
        />
      )}
    </div>
  );
}
