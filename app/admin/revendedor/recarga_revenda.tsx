"use client";
// app/admin/revendedor/recarga_revenda.tsx
import { Loader2 } from "lucide-react";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getCurrentTenantId } from "@/lib/tenant";

type Currency = "BRL" | "USD" | "EUR";

// ✅ Tipagem dos Templates de Mensagem
interface MessageTemplate {
  id: string;
  name: string;
  content: string;
  category?: string; // ✅ Adicionada a categoria
}

// ✅ Helper para Toast na Listagem Principal
function queueToast(
  type: "success" | "error",
  title: string,
  message?: string,
) {
  try {
    if (typeof window === "undefined") return;
    const key = "resellers_list_toasts"; // Chave separada para a tela de revendas
    const raw = window.sessionStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    arr.push({ type, title, message, ts: Date.now() });
    window.sessionStorage.setItem(key, JSON.stringify(arr));
  } catch {}
}

type ResellerServerRow = {
  reseller_server_id: string;
  tenant_id: string;

  reseller_id: string;
  reseller_name: string | null;
  reseller_is_archived: boolean | null;

  server_id: string;
  server_name: string | null;
  server_is_archived: boolean | null;

  // pode existir no seu view
  unit_price_override?: number | null;
};

interface Props {
  resellerId: string;
  resellerName: string;
  onClose: () => void;
  onDone: () => void;

  resellerServerId?: string | null;
  lockServer?: boolean;
  onError?: (msg: string) => void;
}

// --- HELPERS WHATSAPP ---
// ✅ Só o nome do contato (Principal/Secundário) — sem o número, que não
// cabia nos campos pequenos dos seletores de sessão.
function buildWhatsAppSessionLabel(profile: any, sessionName: string): string {
  return profile?.connected ? sessionName : `${sessionName} (não conectado)`;
}

// --- HELPERS (integrais) ---
function onlyDigits(s: string) {
  return (s || "").replace(/\D+/g, "");
}

function fmtMoney(currency: string, n: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency || "BRL",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

function toNumberLoose(v: string) {
  const raw = String(v || "").trim();
  if (!raw) return NaN;

  // aceita pt-BR "1.234,56"
  if (raw.includes(",")) {
    const normalized = raw.replace(/\./g, "").replace(",", ".");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : NaN;
  }

  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function toBRMoneyInput(n: number) {
  if (!Number.isFinite(n)) return "";
  return Number(n).toFixed(2).replace(".", ",");
}

// --- COMPONENTES VISUAIS PADRONIZADOS ---
function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-muted-foreground mb-1.5 tracking-tight">
      {children}
    </label>
  );
}

function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90 placeholder-muted-foreground/60 outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}

function Select({
  children,
  className = "",
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90 outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    >
      {children}
    </select>
  );
}

async function loadFxRate(tid: string, currency: Currency) {
  if (currency === "BRL") return { rate: 1, asOf: null as string | null };

  const { data: fx, error: fxErr } = await supabaseBrowser
    .from("tenant_fx_rates")
    .select("usd_to_brl, eur_to_brl, as_of_date")
    .eq("tenant_id", tid)
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fxErr) throw new Error(`Falha ao carregar câmbio: ${fxErr.message}`);

  const rate =
    currency === "USD"
      ? Number((fx as any)?.usd_to_brl ?? NaN)
      : Number((fx as any)?.eur_to_brl ?? NaN);

  if (!Number.isFinite(rate) || rate <= 0)
    throw new Error("Câmbio inválido no tenant_fx_rates");

  const asOf = (fx as any)?.as_of_date ? String((fx as any).as_of_date) : null;
  return { rate, asOf };
}

export default function QuickRechargeModal({
  resellerId,
  resellerName,
  onClose,
  onDone,
  resellerServerId = null,
  lockServer = false,
  onError,
}: Props) {
  const [tenantId, setTenantId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [servers, setServers] = useState<ResellerServerRow[]>([]);
  const [selectedResellerServerId, setSelectedResellerServerId] =
    useState<string>("");

  const [qtyCredits, setQtyCredits] = useState<string>("");
  const [currency, setCurrency] = useState<Currency>("BRL");
  const [unitPriceCurrency, setUnitPriceCurrency] = useState<string>("");

  const [fxRate, setFxRate] = useState<number>(1);
  const [fxAsOf, setFxAsOf] = useState<string | null>(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [fxError, setFxError] = useState<string | null>(null);

  const [notes, setNotes] = useState<string>("");

  const [saving, setSaving] = useState(false);
  const [loadingText, setLoadingText] = useState("Processando..."); // ✅ Texto dinâmico do botão

  // ✅ Estados do WhatsApp
  const [sendWhats, setSendWhats] = useState(true);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [messageContent, setMessageContent] = useState("");

  // ✅ NOVO: Controle de Sessão
  const [selectedSession, setSelectedSession] = useState("default");
  const [sessionOptions, setSessionOptions] = useState<
    { id: string; label: string }[]
  >([{ id: "default", label: "Carregando..." }]);

  async function loadWhatsAppSessions() {
    try {
      const [res1, res2] = await Promise.all([
        fetch("/api/whatsapp/profile", { cache: "no-store" }).catch(() => null),
        fetch("/api/whatsapp/profile2", { cache: "no-store" }).catch(
          () => null,
        ),
      ]);
      const prof1 = res1 && res1.ok ? await res1.json().catch(() => ({})) : {};
      const prof2 = res2 && res2.ok ? await res2.json().catch(() => ({})) : {};

      const name1 =
        typeof window !== "undefined"
          ? localStorage.getItem("wa_label_1") || "Contato Principal"
          : "Contato Principal";
      const name2 =
        typeof window !== "undefined"
          ? localStorage.getItem("wa_label_2") || "Contato Secundário"
          : "Contato Secundário";

      const options = [
        { id: "default", label: buildWhatsAppSessionLabel(prof1, name1) },
      ]; // ✅ TRAVA: Só exibe a opção de envio pela sessão 2 se ela estiver conectada

      if (prof2 && prof2.connected) {
        options.push({
          id: "session2",
          label: buildWhatsAppSessionLabel(prof2, name2),
        });
      }

      setSessionOptions(options);
    } catch {}
  }

  // --- Lógica derivada ---
  const qty = useMemo(() => {
    const n = Math.floor(Number(qtyCredits || 0));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [qtyCredits]);

  const unitCurrency = useMemo(
    () => toNumberLoose(unitPriceCurrency),
    [unitPriceCurrency],
  );

  const selectedLink = useMemo(() => {
    return (
      servers.find(
        (s) =>
          String(s.reseller_server_id) === String(selectedResellerServerId),
      ) || null
    );
  }, [servers, selectedResellerServerId]);

  const totalCurrency = useMemo(() => {
    if (!qty || !Number.isFinite(unitCurrency) || unitCurrency <= 0) return NaN;
    return qty * unitCurrency;
  }, [qty, unitCurrency]);

  const totalBRL = useMemo(() => {
    if (!Number.isFinite(totalCurrency) || totalCurrency <= 0) return NaN;
    if (currency === "BRL") return totalCurrency;

    if (!Number.isFinite(fxRate) || fxRate <= 0) return NaN;
    return totalCurrency * fxRate;
  }, [totalCurrency, currency, fxRate]);

  const canSave = useMemo(() => {
    if (!tenantId) return false;
    if (!selectedResellerServerId) return false;
    if (!selectedLink?.server_id) return false;

    if (!qty || qty <= 0) return false;
    if (!Number.isFinite(unitCurrency) || unitCurrency <= 0) return false;

    if (currency !== "BRL" && (!Number.isFinite(fxRate) || fxRate <= 0))
      return false;
    if (!Number.isFinite(totalBRL) || totalBRL <= 0) return false;

    return true;
  }, [
    tenantId,
    selectedResellerServerId,
    selectedLink,
    qty,
    unitCurrency,
    currency,
    fxRate,
    totalBRL,
  ]);

  // --- Busca Inteligente: Histórico ou Override ---
  // --- VERSÃO DE DEBUG ---
  // --- Busca Inteligente: Histórico ou Override ---
  async function fetchSmartSuggestion(rsId: string) {
    if (!tenantId || !rsId) return;

    // 1. Tenta buscar a última venda no histórico
    const { data } = await supabaseBrowser.rpc("get_last_reseller_sale", {
      p_tenant_id: tenantId,
      p_reseller_server_id: rsId,
    });

    // Se encontrou histórico
    if (data && data.length > 0) {
      const last = data[0];

      // Preenche Qtde (Check de null para aceitar 0 se necessário, embora improvável)
      if (last.last_qty != null) {
        setQtyCredits(String(last.last_qty));
      }

      // Preenche Preço
      if (last.last_unit_price != null) {
        setUnitPriceCurrency(toBRMoneyInput(Number(last.last_unit_price)));
      }

      // Preenche Moeda (Confia que vem certa: BRL, USD ou EUR)
      if (last.last_currency) {
        setCurrency(last.last_currency as Currency);
      }

      return; // Histórico venceu
    }

    // 2. Se NÃO tem histórico, tenta o Override
    const link = servers.find(
      (s) => String(s.reseller_server_id) === String(rsId),
    );

    // Só aplica override se preço estiver vazio
    if (link && link.unit_price_override != null && !unitPriceCurrency) {
      setUnitPriceCurrency(toBRMoneyInput(Number(link.unit_price_override)));
    }
  }

  // --- Load tenant + servers (VIEW) ---
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setLoadErr(null);

        const tid = await getCurrentTenantId();
        if (!alive) return;
        setTenantId(tid);

        if (tid) {
          await loadWhatsAppSessions(); // ✅ Carrega sessões para o Select
        }

        const { data, error } = await supabaseBrowser
          .from("vw_reseller_servers")
          .select("*")
          .eq("tenant_id", tid)
          .eq("reseller_id", resellerId)
          .eq("reseller_is_archived", false)
          .eq("server_is_archived", false)
          .order("server_name", { ascending: true });

        if (error) throw new Error(error.message);

        const list = (data || []) as any[];
        const mapped: ResellerServerRow[] = list.map((r) => ({
          reseller_server_id: String(r.reseller_server_id ?? r.id ?? ""),
          tenant_id: String(r.tenant_id ?? tid),

          reseller_id: String(r.reseller_id ?? resellerId),
          reseller_name: r.reseller_name ?? null,
          reseller_is_archived: r.reseller_is_archived ?? false,

          server_id: String(r.server_id ?? ""),
          server_name: r.server_name ?? null,
          server_is_archived: r.server_is_archived ?? false,

          unit_price_override:
            r.unit_price_override != null
              ? Number(r.unit_price_override)
              : null,
        }));

        if (!alive) return;
        setServers(mapped);

        // ✅ BUSCAR TEMPLATES E PRÉ-SELECIONAR "RECARGA REVENDA"
        const { data: tmplData } = await supabaseBrowser
          .from("message_templates")
          .select("id, name, content, category") // ✅ Buscando a categoria
          .eq("tenant_id", tid)
          .order("name", { ascending: true });

        if (tmplData && alive) {
          setTemplates(tmplData);
          const defaultTpl = tmplData.find((t) =>
            t.name.toLowerCase().includes("recarga revenda"),
          );
          if (defaultTpl) {
            setSelectedTemplateId(defaultTpl.id);
            setMessageContent(defaultTpl.content);
          }
        }

        // seleção inicial
        const preselect =
          resellerServerId &&
          mapped.some(
            (x) => String(x.reseller_server_id) === String(resellerServerId),
          )
            ? String(resellerServerId)
            : mapped.length === 1
              ? String(mapped[0].reseller_server_id)
              : "";

        setSelectedResellerServerId(preselect);

        // preço default do vínculo (se existir)
        if (preselect) {
          const chosen = mapped.find(
            (x) => String(x.reseller_server_id) === String(preselect),
          );
          if (
            chosen?.unit_price_override != null &&
            Number.isFinite(chosen.unit_price_override)
          ) {
            setUnitPriceCurrency(
              toBRMoneyInput(Number(chosen.unit_price_override)),
            );
          }
        }
      } catch (e: any) {
        if (!alive) return;
        setLoadErr(e?.message || "Erro ao carregar servidores vinculados");
        setServers([]);
        setSelectedResellerServerId("");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [resellerId, resellerServerId]);

  // Quando troca servidor (ou quando o tenant termina de carregar): Dispara a sugestão
  useEffect(() => {
    // 1. Só roda se tiver servidor selecionado E se já tivermos o ID do tenant
    // Isso impede que rode antes da hora e falhe silenciosamente
    if (!selectedResellerServerId || !tenantId) return;

    // 2. Limpa os campos (opcional, mas bom pra UX)
    setQtyCredits("");
    setUnitPriceCurrency("");

    // 3. Chama a busca no banco
    fetchSmartSuggestion(selectedResellerServerId);
  }, [selectedResellerServerId, tenantId]); // <--- AGORA SIM: tenantId adicionado

  // --- FX (do banco) ---
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        if (!tenantId) return;

        if (currency === "BRL") {
          setFxRate(1);
          setFxAsOf(null);
          setFxError(null);
          setFxLoading(false);
          return;
        }

        setFxLoading(true);
        setFxError(null);

        const { rate, asOf } = await loadFxRate(tenantId, currency);
        if (!alive) return;
        setFxRate(rate);
        setFxAsOf(asOf);
      } catch (e: any) {
        if (!alive) return;
        setFxError(e?.message || "Erro ao buscar câmbio");
      } finally {
        if (!alive) return;
        setFxLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [tenantId, currency]);

  async function onSave() {
    if (!canSave || saving) return;

    setSaving(true);
    setLoadingText("Processando recarga..."); // ✅ Adicionado
    try {
      if (!tenantId) throw new Error("Tenant inválido");
      if (!selectedLink?.server_id)
        throw new Error("Servidor inválido no vínculo");

      // 1) Busca dados do servidor para saber se tem integração
      const { data: serverData, error: serverErr } = await supabaseBrowser
        .from("servers")
        .select("panel_integration")
        .eq("id", selectedLink.server_id)
        .single();

      if (serverErr) throw new Error(serverErr.message);

      const hasIntegration = Boolean(serverData?.panel_integration);

      // 2) Prepara payload base
      const autoNote = [
        `Venda revenda · ${resellerName}`,
        `${qty} créditos`,
        `Unit: ${fmtMoney(currency, unitCurrency)}`,
        currency !== "BRL" ? `Câmbio: ${Number(fxRate).toFixed(4)}` : null,
        `Total: ${fmtMoney("BRL", totalBRL)}`,
        notes.trim() ? `Obs: ${notes.trim()}` : null,
      ]
        .filter(Boolean)
        .join(" · ");

      const payload = {
        p_tenant_id: tenantId,
        p_server_id: selectedLink.server_id,
        p_reseller_server_id: selectedResellerServerId,
        p_credits_sold: qty,
        p_unit_price: unitCurrency,
        p_sale_currency: currency as any,
        p_total_amount_brl: totalBRL,
        p_notes: autoNote,
      };

      if (hasIntegration) {
        // 3A) Servidor COM integração → salva log + sync
        const { error: saleErr } = await supabaseBrowser.rpc(
          "sell_credits_to_reseller_without_balance",
          payload as any,
        );

        if (saleErr) throw new Error(saleErr.message);

        // 3B) Busca provider da integração
        const { data: integData, error: integErr } = await supabaseBrowser
          .from("server_integrations")
          .select("id, provider")
          .eq("id", serverData.panel_integration)
          .single();

        if (integErr) throw new Error(integErr.message);

        const provider = String(integData?.provider || "").toUpperCase();
        const syncUrl =
          provider === "FAST"
            ? "/api/integrations/fast/sync"
            : "/api/integrations/natv/sync";

        // 3C) Chama sync
        // ✅ INJEÇÃO DO TOKEN DE SEGURANÇA
        const { data: sess } = await supabaseBrowser.auth.getSession();
        const token = sess?.session?.access_token;

        const syncRes = await fetch(syncUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}), // 🔒 Envio obrigatório
          },
          body: JSON.stringify({
            integration_id: serverData.panel_integration,
          }),
        });

        const syncJson = await syncRes.json().catch(() => ({}));
        if (!syncRes.ok || !syncJson?.ok) {
          throw new Error(
            "Venda registrada, mas falhou ao sincronizar saldo: " +
              (syncJson?.error || ""),
          );
        }
      } else {
        // 4) Servidor SEM integração → venda normal (desconta saldo)
        const { error } = await supabaseBrowser.rpc(
          "sell_credits_to_reseller_and_log",
          payload as any,
        );

        if (error) throw new Error(error.message);
      }

      // ✅ 5) ENVIAR WHATSAPP SE ESTIVER ATIVO
      if (sendWhats && messageContent && messageContent.trim()) {
        setLoadingText("Enviando WhatsApp...");
        try {
          const { data: session } = await supabaseBrowser.auth.getSession();
          const token = session.session?.access_token;

          const res = await fetch("/api/whatsapp/envio_agora", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              tenant_id: tenantId,
              reseller_id: resellerId,
              reseller_server_id: selectedResellerServerId, // ✅ Mandamos a chave exata do vínculo
              credits_recharged: qty, // ✅ Mandamos a quantidade exata feita AGORA
              message: messageContent,
              whatsapp_session: selectedSession, // ✅ Usando a Sessão Escolhida
            }),
          });

          if (!res.ok) throw new Error("API retornou erro");
          queueToast(
            "success",
            "Mensagem Enviada",
            "A recarga foi feita e o comprovante entregue no WhatsApp.",
          );
        } catch {
          queueToast(
            "error",
            "Recarga Feita",
            "A recarga funcionou, mas o envio do WhatsApp falhou.",
          );
        }
      } else {
        queueToast(
          "success",
          "Recarga Concluída",
          "Créditos adicionados com sucesso.",
        );
      }

      setLoadingText("Concluído!");
      setTimeout(async () => {
        await onDone();
        onClose();
      }, 500);
    } catch (err: any) {
      const msg = err?.message || String(err);
      onError?.(msg);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl max-h-[90vh] bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden transition-colors">
        {/* HEADER */}
        <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-transparent">
          <div>
            <h2 className="text-lg font-medium text-foreground tracking-tight">
              Recarga rápida
            </h2>
            <div className="text-xs text-muted-foreground mt-0.5 font-medium">
              {resellerName}
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Fechar"
            type="button"
          >
            ✕
          </button>
        </div>

        {/* BODY */}
        <div className="p-6 space-y-6 overflow-y-auto bg-card">
          {loadErr && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-500 text-sm font-medium animate-in slide-in-from-top-2">
              <span className="font-medium">Erro:</span> {loadErr}
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-muted-foreground animate-pulse font-medium">
              Carregando servidores...
            </div>
          ) : (
            <div className="space-y-6">
              {/* Servidor Selecionado */}
              <div className="animate-in slide-in-from-bottom-2 duration-300">
                <Label>Servidor vinculado</Label>
                <Select
                  value={selectedResellerServerId}
                  disabled={!!lockServer}
                  onChange={(e) => {
                    if (lockServer) return;
                    // Apenas atualiza o ID. O useEffect lá em cima fará toda a mágica (buscar histórico ou aplicar override).
                    setSelectedResellerServerId(e.target.value);
                    setNotes("");
                  }}
                >
                  <option value="">Selecione o servidor...</option>
                  {servers.map((s) => (
                    <option
                      key={s.reseller_server_id}
                      value={s.reseller_server_id}
                    >
                      {s.server_name || "Servidor"}
                    </option>
                  ))}
                </Select>
                {lockServer && (
                  <p className="text-[10px] text-muted-foreground/60 mt-1 italic">
                    * Servidor travado para este contexto.
                  </p>
                )}
              </div>

              {/* Grid Principal */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="animate-in slide-in-from-bottom-3 duration-400">
                  <Label>Quantidade de créditos</Label>
                  <Input
                    value={qtyCredits}
                    onChange={(e) => setQtyCredits(onlyDigits(e.target.value))}
                    placeholder="Ex: 10"
                    className="font-medium text-center text-lg"
                    inputMode="numeric"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 animate-in slide-in-from-bottom-3 duration-400">
                  <div>
                    <Label>Moeda</Label>
                    <Select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value as Currency)}
                    >
                      <option value="BRL">BRL</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </Select>
                  </div>
                  <div>
                    <Label>Preço unit.</Label>
                    <Input
                      value={unitPriceCurrency}
                      onChange={(e) => setUnitPriceCurrency(e.target.value)}
                      placeholder="0,00"
                      inputMode="decimal"
                    />
                  </div>
                </div>
              </div>

              {/* FX automático (do banco) */}
              {currency !== "BRL" && (
                <div className="p-4 bg-sky-500/10 rounded-xl border border-sky-500/20 grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                  <div className="space-y-1">
                    <Label>
                      <span className="flex justify-between">
                        Câmbio {currency} → BRL{" "}
                        {fxLoading && (
                          <span className="animate-pulse">...</span>
                        )}
                      </span>
                    </Label>

                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="number"
                        step="0.0001"
                        value={
                          Number.isFinite(fxRate)
                            ? Number(fxRate).toFixed(4)
                            : ""
                        }
                        onChange={(e) => setFxRate(Number(e.target.value))}
                        className="col-span-2 h-10 px-3 bg-card border border-sky-500/30 rounded-lg text-foreground/90 font-medium outline-none"
                      />
                      <div className="h-10 flex items-center justify-center px-2 bg-card border border-sky-500/30 rounded-lg text-[10px] text-muted-foreground font-semibold">
                        {fxError ? "Erro" : fxAsOf ? "AUTO" : "—"}
                      </div>
                    </div>

                    {fxError && (
                      <div className="text-[11px] text-rose-500 font-semibold">
                        {fxError}
                      </div>
                    )}

                    {fxAsOf && !fxError && (
                      <div className="text-[10px] text-muted-foreground/60">
                        Última taxa registrada: {fxAsOf}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label>Subtotal ({currency})</Label>
                    <div className="h-10 flex items-center px-3 bg-card border border-sky-500/30 rounded-lg text-foreground/90 font-medium">
                      {Number.isFinite(totalCurrency)
                        ? fmtMoney(currency, totalCurrency)
                        : "—"}
                    </div>
                  </div>
                </div>
              )}

              {/* Totais Finais */}
              <div className="bg-transparent p-4 rounded-xl border border-border flex justify-between items-center animate-in zoom-in-95 duration-500">
                <div className="space-y-0.5">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                    Valor contábil final
                  </span>
                  <div className="text-2xl font-medium text-emerald-500 tracking-tight">
                    {Number.isFinite(totalBRL)
                      ? fmtMoney("BRL", totalBRL)
                      : "—"}
                  </div>
                </div>
                <div className="text-[10px] text-muted-foreground/60 italic text-right max-w-[160px]">
                  Contabilidade processada em Reais (BRL).
                </div>
              </div>

              {/* ✅ BLOCO DO WHATSAPP (Agora com 2 selects) */}
              <div className="bg-transparent p-3 rounded-xl border border-border flex flex-col gap-3 animate-in zoom-in-95 duration-500">
                {/* Toggle */}
                <div
                  onClick={() => setSendWhats(!sendWhats)}
                  className="cursor-pointer flex items-center gap-3 shrink-0"
                >
                  <Switch
                    checked={sendWhats}
                    onChange={setSendWhats}
                    label=""
                  />
                  <span className="text-xs font-medium text-muted-foreground">
                    Enviar comprovante?
                  </span>
                </div>

                {/* Seletores (Lado a Lado) */}
                {sendWhats && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
                    {/* Select de Sessão */}
                    <div>
                      <Label>Sessão de envio</Label>
                      <Select
                        value={selectedSession}
                        onChange={(e) => setSelectedSession(e.target.value)}
                        className="h-9 w-full text-xs font-semibold text-muted-foreground"
                      >
                        {sessionOptions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </Select>
                    </div>

                    {/* Select de Template */}
                    <div>
                      <Label>Mensagem pronta</Label>
                      <Select
                        value={selectedTemplateId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setSelectedTemplateId(id);
                          const tpl = templates.find((t) => t.id === id);
                          if (tpl) setMessageContent(tpl.content);
                        }}
                        className="h-9 w-full text-xs font-semibold text-muted-foreground"
                      >
                        <option value="">-- Personalizado --</option>
                        {templates
                          .filter(
                            (t) =>
                              t.category === "Revenda IPTV" ||
                              t.name === "Recarga Revenda",
                          ) // ✅ FILTRA SÓ REVENDA IPTV
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                      </Select>
                    </div>
                  </div>
                )}
              </div>

              <div className="animate-in slide-in-from-bottom-4 duration-500">
                <Label>Observações internas (opcional)</Label>
                <textarea
                  className="w-full h-24 px-3 py-2 bg-transparent border border-border rounded-lg text-sm text-foreground/90 outline-none focus:border-emerald-500/50 resize-none transition-colors"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  onClick={() =>
                    onSave().catch((err) => {
                      const msg = err?.message || String(err);
                      onError?.(msg);
                      setSaving(false);
                    })
                  }
                  disabled={!canSave || saving}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:hover:bg-emerald-600 disabled:opacity-50 text-white font-bold transition-colors flex items-center justify-center gap-2"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {saving ? loadingText : "Confirmar recarga"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    typeof document !== "undefined" ? document.body : null,
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      {label && (
        <span className="text-xs text-foreground/90">
          {label}
        </span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onChange(!checked);
        }}
        className={`relative w-12 h-7 rounded-full transition-colors border ${checked ? "bg-emerald-600 border-emerald-600" : "bg-transparent border-border"}`}
        aria-pressed={checked}
      >
        <span
          className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-card transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`}
        />
      </button>
    </div>
  );
}
