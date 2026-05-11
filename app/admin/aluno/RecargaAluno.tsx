"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getCurrentTenantId } from "@/lib/tenant";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";
import { useConfirm } from "@/app/admin/HookuseConfirm";

// ─── TIPOS ────────────────────────────────────────────────────────────────────

interface AlunoData {
  id: string;
  display_name: string | null;
  server_username: string | null;
  server_id: string | null;
  server_name?: string | null;
  plan_label: string | null;
  plan_table_id?: string | null;
  price_amount: number | null;
  price_currency: string | null;
  vencimento: string | null;
  screens: number | null;
  notes?: string | null;
  technology?: string | null;
}

type Currency = "BRL" | "USD" | "EUR";

interface PlanTableItemPrice { screens_count: number; price_amount: number | null; }
interface PlanTableItem      { id: string; period: string; credits_base: number; prices: PlanTableItemPrice[]; }
interface PlanTable          { id: string; name: string; currency: Currency; is_system_default?: boolean; items: PlanTableItem[]; }
interface MessageTemplate    { id: string; name: string; content: string; image_url?: string | null; category?: string | null; }

interface Props {
  clientId:  string;
  clientName: string;
  paymentLogId?: string;
  onClose:   () => void;
  onSuccess: (logId?: string) => void | Promise<void>;
  toastKey?: "clients_list_toasts" | "trials_list_toasts" | "alunos_list_toasts" | "auditoria_list_toasts";
  allowConvertWithoutPayment?: boolean;
}

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const PLAN_LABELS: Record<string, string> = {
  MONTHLY:    "Mensal",
  BIMONTHLY:  "Bimestral",
  QUARTERLY:  "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL:     "Anual",
};

const PLAN_MONTHS: Record<string, number> = {
  MONTHLY: 1, BIMONTHLY: 2, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12,
};

// Mapeia screens -> tipo de plano de academia
const PLAN_TYPES = [
  { screens: 1, label: "Individual"     },
  { screens: 2, label: "Família"        },
  { screens: 3, label: "Família Total"  },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function nowSP(): { dateISO: string; timeHHmm: string } {
  const fmt  = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
  const tfmt = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false });
  const now = new Date();
  return { dateISO: fmt.format(now), timeHHmm: tfmt.format(now) };
}

function hhmmSP(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "00:00";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

function addMonthsSP(from: Date, months: number): string {
  const target = new Date(from);
  target.setMonth(target.getMonth() + months);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(target);
}

function saoPauloToIso(dateISO: string, timeHHmm: string): string {
  const d = new Date(`${dateISO}T${timeHHmm}:00-03:00`);
  if (isNaN(d.getTime())) throw new Error("Data/hora inválida.");
  return d.toISOString();
}

function fmtMoney(currency: string, n: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(n);
}

function safeNum(s: string) {
  return Number(String(s || "0").replace(/\./g, "").replace(",", ".")) || 0;
}

function pickPrice(table: PlanTable | null, period: string, screens: number): number {
  if (!table) return 0;
  const item = table.items?.find(i => i.period === period);
  if (!item) return 0;
  const exact = item.prices?.find(p => p.screens_count === screens);
  if (exact?.price_amount != null) return Number(exact.price_amount);
  const one = item.prices?.find(p => p.screens_count === 1);
  if (one?.price_amount != null) return Number(one.price_amount) * screens;
  return 0;
}

function pickCredits(table: PlanTable | null, period: string, screens: number): number {
  if (!table) return 0;
  const item = table.items?.find(i => i.period === period);
  if (!item) return 0;
  return (item.credits_base || 0) * Math.max(1, screens);
}

function formatTableLabel(t: PlanTable) {
  const currency = t.currency || "BRL";
  const raw = (t.name || "").trim();
  const isDefaultByName =
    raw.toLowerCase().startsWith("padr") ||
    raw.toLowerCase().startsWith("default");
  const isDefault = Boolean(t.is_system_default) || isDefaultByName;
  if (isDefault) {
    const firstWord = raw.split(/\s+/)[0] || "Padrão";
    return `${firstWord} ${currency}`;
  }
  return `${raw} ${currency}`;
}

// ─── HELPERS WHATSAPP ─────────────────────────────────────────────────────────

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

function buildWhatsAppSessionLabel(profile: any, sessionName: string): string {
  if (!profile?.connected) return `${sessionName} (não conectado)`;
  const digits = extractWaNumberFromJid(profile?.jid);
  const pretty = formatBRPhoneFromDigits(digits);
  return `${sessionName} • ${pretty || "Conectado"}`;
}

// ─── COMPONENTE ───────────────────────────────────────────────────────────────

export default function RecargaAluno({
  clientId,
  clientName,
  paymentLogId,
  onClose,
  onSuccess,
  toastKey = "alunos_list_toasts",
  allowConvertWithoutPayment = false,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const scrollYRef = useRef(0);

  function queueToast(
    type: "success" | "error" | "warning",
    title: string,
    message?: string,
    key: string = toastKey
  ) {
    try {
      const arr = JSON.parse(window.sessionStorage.getItem(key) || "[]");
      arr.push({ type, title, message, ts: Date.now() });
      window.sessionStorage.setItem(key, JSON.stringify(arr));
    } catch {}
  }

  useEffect(() => {
    setMounted(true);
    if (typeof window === "undefined") return;
    const y = window.scrollY;
    scrollYRef.current = y;
    const b = document.body;
    b.style.overflow = "hidden"; b.style.position = "fixed";
    b.style.top = `-${y}px`; b.style.width = "100%";
    return () => {
      b.style.overflow = ""; b.style.position = "";
      b.style.top = ""; b.style.width = "";
      window.scrollTo(0, scrollYRef.current);
    };
  }, []);

  // ─── ESTADO ─────────────────────────────────────────────────────────────────

  const [fetching, setFetching]           = useState(true);
  const [loading, setLoading]             = useState(false);
  const [loadingText, setLoadingText]     = useState("Processando...");
  const isSavingRef                       = useRef(false);
  const isCheckingRef                     = useRef(false);
  const isFirstLoad                       = useRef(true);

  // Tecnologia detectada do tenant (ACADEMIA ou PERSONAL)
  const [tenantTech, setTenantTech]       = useState("ACADEMIA");

  const [toasts, setToasts]               = useState<ToastMessage[]>([]);
  const { confirm, ConfirmUI }            = useConfirm();

  // Dados do aluno
  const [alunoData, setAlunoData]         = useState<AlunoData | null>(null);
  const [tables, setTables]               = useState<PlanTable[]>([]);
  const [selectedTableId, setSelectedTableId] = useState("");
  const tableChangedRef                   = useRef(false);

  // Plano
  const [period, setPeriod]               = useState("MONTHLY");
  const [screens, setScreens]             = useState(1);
  const [planPrice, setPlanPrice]         = useState("0,00");
  const [priceTouched, setPriceTouched]   = useState(false);
  const [currency, setCurrency]           = useState<Currency>("BRL");
  const [fxRate, setFxRate]               = useState(1);
  const [totalBrl, setTotalBrl]           = useState(0);

  // Vencimento
  const [dueDate, setDueDate]             = useState(() => nowSP().dateISO);

  // Financeiro
  const [registerPayment, setRegisterPayment] = useState(true);
  const [obs, setObs]                     = useState("");
  const [paymentMethod, setPaymentMethod] = useState("PIX");
  const [payDate, setPayDate]             = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  });

  // WhatsApp
  const [sendWhats, setSendWhats]         = useState(true);
  const [templates, setTemplates]         = useState<MessageTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [msgContent, setMsgContent]       = useState("");
  const [selectedSession, setSelectedSession] = useState("default");
  const [sessionOptions, setSessionOptions] = useState([
    { id: "default", label: "Carregando..." },
  ]);

  const selectedTable = useMemo(
    () => tables.find(t => t.id === selectedTableId) || null,
    [tables, selectedTableId]
  );

  const creditsInfo = useMemo(
    () => pickCredits(selectedTable, period, screens),
    [selectedTable, period, screens]
  );

  const showFx = currency !== "BRL";

  const addToast = (type: "success" | "error" | "warning", title: string, message?: string) => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, type, title, message, durationMs: 5000 }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 5000);
  };

  // ─── LOAD ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const tid = await getCurrentTenantId();

        // Tecnologia do tenant (ACADEMIA ou PERSONAL)
        try {
          const { data: tInfo } = await supabaseBrowser
            .from("tenants").select("active_modules").eq("id", tid).maybeSingle();
          const mods = tInfo?.active_modules || [];
          if (mods.includes("academia")) setTenantTech("ACADEMIA");
          else if (mods.includes("personal")) setTenantTech("PERSONAL");
        } catch (e) {}

        // Sessões WhatsApp
        try {
          const [r1, r2] = await Promise.all([
            fetch("/api/whatsapp/profile",  { cache: "no-store" }).then(r => r.json()).catch(() => ({})),
            fetch("/api/whatsapp/profile2", { cache: "no-store" }).then(r => r.json()).catch(() => ({})),
          ]);
          const n1 = localStorage.getItem("wa_label_1") || "Contato Principal";
          const n2 = localStorage.getItem("wa_label_2") || "Contato Secundário";
          if (alive) setSessionOptions([
            { id: "default",  label: buildWhatsAppSessionLabel(r1, n1) },
            { id: "session2", label: buildWhatsAppSessionLabel(r2, n2) },
          ]);
        } catch {}

        // Dados do aluno
        const { data: raw, error: cErr } = await supabaseBrowser
          .from("clients")
          .select("*, servers(name)")
          .eq("id", clientId)
          .single();

        if (!alive || cErr || !raw) { onClose(); return; }

        const aluno: AlunoData = {
          id:              raw.id,
          display_name:    raw.display_name,
          server_username: raw.server_username,
          server_id:       raw.server_id,
          server_name:     (raw.servers as any)?.name || null,
          plan_label:      raw.plan_label,
          plan_table_id:   raw.plan_table_id,
          price_amount:    raw.price_amount,
          price_currency:  raw.price_currency,
          vencimento:      raw.vencimento,
          screens:         raw.screens,
          notes:           raw.notes,
          technology:      raw.technology,
        };
        setAlunoData(aluno);
        setObs(aluno.notes || "");

        // Plano inicial (detecta período pelo label)
        const pName = (aluno.plan_label || "").toUpperCase();
        let fp = "MONTHLY";
        if (pName.includes("ANUAL")) fp = "ANNUAL";
        else if (pName.includes("SEMESTRAL")) fp = "SEMIANNUAL";
        else if (pName.includes("TRIMESTRAL")) fp = "QUARTERLY";
        else if (pName.includes("BIMESTRAL")) fp = "BIMONTHLY";
        setPeriod(fp);
        setScreens(aluno.screens || 1);

        // Vencimento inicial (ATIVO mantém hora; VENCIDO usa agora)
        const vencDate = aluno.vencimento ? new Date(aluno.vencimento) : null;
        const isActive = vencDate != null && vencDate > new Date();
        const base = (isActive && aluno.vencimento) ? new Date(aluno.vencimento) : new Date();
        setDueDate(addMonthsSP(base, PLAN_MONTHS[fp] || 1));

        // Tabelas — academia/personal compartilham as plan_tables do IPTV
        const { data: tRes } = await supabaseBrowser
          .from("plan_tables")
          .select(`id, name, currency, is_system_default, table_type,
            items:plan_table_items(id, period, credits_base,
              prices:plan_table_item_prices(screens_count, price_amount))`)
          .eq("tenant_id", tid)
          .eq("is_active", true)
          .eq("table_type", "iptv");

        // Puxa apenas tabelas em BRL para o Brasil
        const allTables = ((tRes || []) as unknown as PlanTable[]).filter(t => t.currency === "BRL");
        setTables(allTables);

        // Seleção: tabela do aluno > padrão BRL > primeira disponível
        const fromClient = aluno.plan_table_id
          ? allTables.find(t => t.id === aluno.plan_table_id)
          : null;
        const defBRL = allTables.find(t => t.currency === "BRL" && t.is_system_default)
          || allTables.find(t => t.currency === "BRL")
          || allTables[0];
        const initialTable = fromClient || defBRL || null;

        if (initialTable) {
          setSelectedTableId(initialTable.id);
          setCurrency(initialTable.currency || "BRL");
        }

        // Preço inicial
        if (aluno.price_amount != null) {
          setPlanPrice(Number(aluno.price_amount).toFixed(2).replace(".", ","));
          setPriceTouched(true);
        } else {
          const p = pickPrice(initialTable, fp, aluno.screens || 1);
          setPlanPrice(Number(p || 0).toFixed(2).replace(".", ","));
          setPriceTouched(false);
        }

        // FX (câmbio) inicial se moeda estrangeira
        if (initialTable?.currency && initialTable.currency !== "BRL") {
          const { data: fx } = await supabaseBrowser
            .from("tenant_fx_rates")
            .select("usd_to_brl, eur_to_brl")
            .eq("tenant_id", tid)
            .order("as_of_date", { ascending: false })
            .limit(1)
            .maybeSingle();
          const rate = initialTable.currency === "USD"
            ? Number(fx?.usd_to_brl || 5)
            : Number(fx?.eur_to_brl || 5);
          setFxRate(rate);
        }

        // Templates
        const { data: tmpl } = await supabaseBrowser
          .from("message_templates")
          .select("id, name, content, image_url, category")
          .eq("tenant_id", tid)
          .order("name");
        if (tmpl) {
          setTemplates(tmpl as MessageTemplate[]);
          const def = (tmpl as MessageTemplate[]).find(t =>
            t.name.toLowerCase().includes("pagamento")
          );
          if (def) { setSelectedTemplateId(def.id); setMsgContent(def.content || ""); }
        }

        setTimeout(() => { isFirstLoad.current = false; }, 500);
      } catch (err) {
        console.error("[RecargaAluno] load:", err);
      } finally {
        if (alive) setFetching(false);
      }
    }
    load();
    return () => { alive = false; };
  }, [clientId]); // eslint-disable-line

  // ─── EFEITOS ────────────────────────────────────────────────────────────────

  // Recalcula vencimento ao mudar plano
  useEffect(() => {
    if (!alunoData) return;
    const vencDate = alunoData.vencimento ? new Date(alunoData.vencimento) : null;
    const isActive = vencDate != null && vencDate > new Date();
    const base = (isActive && alunoData.vencimento) ? new Date(alunoData.vencimento) : new Date();
    setDueDate(addMonthsSP(base, PLAN_MONTHS[period] || 1));
  }, [alunoData, period]);

  // Reset override ao mudar estrutura (mas não na primeira carga)
  useEffect(() => {
    if (isFirstLoad.current) return;
    setPriceTouched(false);
  }, [screens, period, selectedTableId]);

  // Calcular preço automaticamente (se não tocado pelo usuário)
  useEffect(() => {
    if (priceTouched || !selectedTable) return;
    const p = pickPrice(selectedTable, period, screens);
    setPlanPrice(Number(p || 0).toFixed(2).replace(".", ","));
  }, [selectedTable, period, screens, priceTouched]);

  // Moeda + câmbio ao trocar tabela
  useEffect(() => {
    if (!selectedTable) return;
    setCurrency(selectedTable.currency || "BRL");
    if (tableChangedRef.current) setPriceTouched(false);
    tableChangedRef.current = false;

    (async () => {
      try {
        const tid = await getCurrentTenantId();
        if (selectedTable.currency === "BRL") {
          setFxRate(1);
          return;
        }
        const { data: fx } = await supabaseBrowser
          .from("tenant_fx_rates").select("*").eq("tenant_id", tid)
          .order("as_of_date", { ascending: false }).limit(1).maybeSingle();
        if (fx) {
          const rate = selectedTable.currency === "USD" ? Number(fx.usd_to_brl) : Number(fx.eur_to_brl);
          setFxRate(rate || 5);
        } else { setFxRate(5); }
      } catch (e) { setFxRate(5); }
    })();
  }, [selectedTableId, selectedTable]);

  // Total BRL
  useEffect(() => {
    const raw = safeNum(planPrice);
    setTotalBrl(currency === "BRL" ? raw : raw * (fxRate || 1));
  }, [planPrice, fxRate, currency]);

  // Conversão de trial sem pagamento: desliga WhatsApp automaticamente
  useEffect(() => {
    if (!Boolean(allowConvertWithoutPayment)) return;
    if (!registerPayment) setSendWhats(false);
  }, [allowConvertWithoutPayment, registerPayment]);

  // ─── PRE-CHECK ──────────────────────────────────────────────────────────────

  const handlePreCheck = async () => {
    if (loading || isSavingRef.current || isCheckingRef.current || !alunoData) return;
    isCheckingRef.current = true;

    const rawPrice = safeNum(planPrice);
    const planType = PLAN_TYPES.find(p => p.screens === screens)?.label || `${screens} alunos`;
    const isFromTrial = Boolean(allowConvertWithoutPayment);
    const isPaymentFlow = Boolean(registerPayment);

    const details: string[] = [
      `Aluno: ${alunoData.display_name || clientName}`,
      `Username: ${alunoData.server_username || "—"}`,
      `Servidor: ${alunoData.server_name || "—"}`,
      `---`,
      `Plano: ${PLAN_LABELS[period]} · ${planType}`,
      `Novo vencimento: ${dueDate.split("-").reverse().join("/")} às 23:59`,
    ];

    if (isFromTrial && !isPaymentFlow) {
      details.push(`Tipo: Conversão (Sem pagamento)`);
    } else {
      const formattedVal = rawPrice.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      details.push(`Valor: ${currency} ${formattedVal}`);
    }

    const ok = await confirm({
      title: isFromTrial && !isPaymentFlow ? "Converter Aluno" : "Confirmar Renovação",
      subtitle: "Confira os dados antes de salvar.",
      tone: isFromTrial && !isPaymentFlow ? "sky" : "emerald",
      icon: isFromTrial && !isPaymentFlow ? "✨" : "🎓",
      details,
      confirmText: "Confirmar",
      cancelText: "Voltar",
    });

    if (!ok) { isCheckingRef.current = false; return; }
    await executeSave();
    isCheckingRef.current = false;
  };

  // ─── EXECUTE SAVE ───────────────────────────────────────────────────────────

  const executeSave = async () => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;

    setLoading(true);
    setLoadingText("Salvando dados...");

    try {
      const rawPrice = safeNum(planPrice);
      const months = PLAN_MONTHS[period] || 1;
      const tid = await getCurrentTenantId();
      const nameToSend = alunoData?.display_name || clientName;
      const planType = PLAN_TYPES.find(p => p.screens === screens)?.label || `${screens}x`;
      const finalVencimento = saoPauloToIso(dueDate, "23:59"); // Cumbina hora final padrão

      // PASSO 1: Atualizar cadastro
      setLoadingText("Atualizando cadastro...");

      // Conversão sem pagamento → update_client carrega o novo vencimento
      // (porque renew_client_and_log não será chamado). Renovação normal → mantém o atual.
      const dateForUpdate = registerPayment
        ? alunoData?.vencimento || null
        : finalVencimento;

      const { error: updateErr } = await supabaseBrowser.rpc("update_client", {
        p_tenant_id:                  tid,
        p_client_id:                  clientId,
        p_display_name:               nameToSend,
        p_name_prefix:                null,
        p_notes:                      obs || null,
        p_clear_notes:                !obs && !!alunoData?.notes,
        p_server_id:                  alunoData?.server_id,
        p_server_username:            alunoData?.server_username,
        p_server_password:            null,
        p_screens:                    screens,
        p_plan_label:                 PLAN_LABELS[period],
        p_plan_table_id:              selectedTableId || null,
        p_price_amount:               rawPrice,
        p_price_currency:             currency as any,
        p_vencimento:                 dateForUpdate,
        p_is_trial:                   Boolean(allowConvertWithoutPayment) ? false : null,
        p_whatsapp_opt_in:            true,
        p_whatsapp_username:          null,
        p_whatsapp_snooze_until:      null,
        p_is_archived:                false,
        p_technology:                 tenantTech, // ACADEMIA ou PERSONAL
        p_clear_whatsapp_snooze_until: false,
        p_clear_secondary:            false,
      });
      if (updateErr) throw new Error(`Erro Update: ${updateErr.message}`);

      // PASSO 2: Registrar pagamento + renovar (p_is_automatic=false → RPC debita créditos do servidor)
      if (registerPayment) {
        setLoadingText("Registrando pagamento...");

        // Mensagem para o CLIENTE (timeline, sem nome próprio)
        const clientMessage = `Renovação manual via painel · ${months} mês(es) · ${planType} · ${fmtMoney(currency, rawPrice)}`;

        // Notes para o SERVIDOR (com nome, login e detalhes)
        const serverNotes = `Renovação manual via painel · ${nameToSend} (${alunoData?.server_username || "-"}) · ${months} mês(es) · ${planType} · ${fmtMoney(currency, rawPrice)}${obs ? ` · Obs: ${obs}` : ""}`;

        const { error: renewErr } = await supabaseBrowser.rpc("renew_client_and_log", {
          p_tenant_id:      tid,
          p_client_id:      clientId,
          p_months:         months,
          p_status:         "PAID",
          p_notes:          serverNotes,
          p_new_vencimento: finalVencimento,
          p_is_automatic:   true, // TRUE ignora a dedução de créditos no banco de dados
          p_message:        clientMessage,
          p_unit_price:     Number((totalBrl / months).toFixed(2)),
          p_total_amount:   totalBrl,
        });
        if (renewErr) throw new Error(`Erro Renew: ${renewErr.message}`);
      }

      // PASSO 3: WhatsApp
      if (sendWhats && msgContent?.trim()) {
        setLoadingText("Enviando WhatsApp...");
        try {
          const { data: sess } = await supabaseBrowser.auth.getSession();
          const token = sess?.session?.access_token;
          const tpl = templates.find(t => t.id === selectedTemplateId);

          const res = await fetch("/api/whatsapp/envio_agora", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              tenant_id:           tid,
              client_id:           clientId,
              message:             msgContent,
              message_template_id: selectedTemplateId || null,
              image_url:           tpl?.image_url || null,
              whatsapp_session:    selectedSession,
            }),
          });

          if (!res.ok) throw new Error("API retornou erro");

          // ✅ Atualiza via RPC (RLS bloqueia UPDATE direto no client_portal_payments pelo browser)
          if (paymentLogId) {
            const { error: waUpErr } = await supabaseBrowser.rpc("update_whatsapp_status", {
              p_log_id: paymentLogId,
              p_tenant_id: tid,
              p_status: "sent",
            });
            if (waUpErr) console.error("Falha ao gravar whatsapp_status=sent:", waUpErr);
          }

          queueToast("success", "Mensagem enviada", "Comprovante entregue no WhatsApp.", toastKey);
        } catch {
          // ✅ Atualiza via RPC (RLS bloqueia UPDATE direto no client_portal_payments pelo browser)
          if (paymentLogId) {
            const { error: waUpErr } = await supabaseBrowser.rpc("update_whatsapp_status", {
              p_log_id: paymentLogId,
              p_tenant_id: tid,
              p_status: "error",
            });
            if (waUpErr) console.error("Falha ao gravar whatsapp_status=error:", waUpErr);
          }
          queueToast("error", "Erro no envio", "Renovado, mas WhatsApp falhou.", toastKey);
        }
      }

      // FIM
      setLoadingText("Concluído!");
      queueToast("success", "Aluno renovado manualmente", "Renovação manual registrada com sucesso.", toastKey);

      setTimeout(async () => {
        await onSuccess(paymentLogId);
        onClose();
      }, 500);

    } catch (err: any) {
      console.error("[RecargaAluno] save:", err);
      addToast("error", "Erro ao salvar", err.message || "Falha desconhecida.");
      setLoading(false);
      isSavingRef.current = false;
    }
  };

  if (fetching || !mounted) return null;

  const isFromTrial = Boolean(allowConvertWithoutPayment);
  const headerTitle = isFromTrial ? "Converter em Aluno" : "Renovação de Aluno";

  // ─── RENDER ─────────────────────────────────────────────────────────────────

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[99990] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
        onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div
          className="w-full max-w-lg sm:max-w-xl bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[90dvh] animate-in zoom-in-95 duration-200"
          onPointerDown={e => e.stopPropagation()}
        >
          {/* HEADER */}
          <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-slate-50 dark:bg-white/5 rounded-t-xl shrink-0">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isFromTrial ? 'bg-sky-100 text-sky-600' : 'bg-emerald-100 text-emerald-600'} dark:bg-white/5`}>
                {isFromTrial
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>}
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-800 dark:text-white leading-tight">{headerTitle}</h2>
                <p className="text-xs text-slate-500 dark:text-white/50">
                  {alunoData?.server_username || "—"} · {alunoData?.server_name || "—"}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
              <IconX />
            </button>
          </div>

          {/* BODY */}
          <div className="p-3 sm:p-4 space-y-3 overflow-y-auto flex-1 min-h-0" style={{ WebkitOverflowScrolling: "touch" }}>

            {/* Vencimento */}
            <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-3 space-y-3">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">📅 Novo Vencimento</span>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <FL>Data (Vencimento às 23:59)</FL>
                  <DateInputBR value={dueDate} onChange={setDueDate} />
                </div>
              </div>
            </div>

            {/* Plano */}
            <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">💰 Plano</span>
                {tables.length > 1 && (
                  <select
                    value={selectedTableId}
                    onChange={e => { tableChangedRef.current = true; setSelectedTableId(e.target.value); }}
                    className="h-7 px-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded text-xs text-slate-700 dark:text-white outline-none"
                  >
                    {tables.map(t => <option key={t.id} value={t.id}>{formatTableLabel(t)}</option>)}
                  </select>
                )}
              </div>

              {/* Recorrência */}
              <div>
                <FL>Recorrência</FL>
                <FS value={period} onChange={e => setPeriod(e.target.value)}>
                  {Object.entries(PLAN_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </FS>
              </div>

              {/* Tipo de plano (botões Individual/Família/Família Total) */}
              <div>
                <FL>Tipo de Plano</FL>
                <div className="flex gap-2">
                  {PLAN_TYPES.map(pt => (
                    <button
                      key={pt.screens}
                      type="button"
                      onClick={() => setScreens(pt.screens)}
                      className={`flex-1 h-10 rounded-lg border text-xs font-bold transition-all ${
                        screens === pt.screens
                          ? "bg-emerald-600 border-emerald-600 text-white shadow-sm"
                          : "border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/40 hover:border-emerald-500/50 hover:text-emerald-600 bg-white dark:bg-black/20"
                      }`}
                    >
                      {pt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Moeda + Valor */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FL>Moeda</FL>
                  <div className="h-10 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-black/30 flex items-center justify-center text-sm font-bold text-slate-700 dark:text-white">
                    {currency}
                  </div>
                </div>
                <div>
                  <FL>Valor</FL>
                  <FI
                    value={planPrice}
                    onChange={e => { setPlanPrice(e.target.value); setPriceTouched(true); }}
                    className="text-right font-bold text-base"
                    placeholder="0,00"
                  />
                </div>
              </div>

              {/* Câmbio (se moeda estrangeira) */}
              {showFx && (
                <div className="p-3 bg-sky-50 dark:bg-sky-500/10 rounded-lg border border-sky-100 dark:border-sky-500/20 grid grid-cols-2 gap-3">
                  <div>
                    <FL>Câmbio</FL>
                    <input
                      type="number"
                      step="0.0001"
                      value={Number(fxRate || 0).toFixed(4)}
                      onChange={e => setFxRate(Number(e.target.value))}
                      className="w-full h-9 px-3 bg-white dark:bg-black/30 border border-sky-200 dark:border-sky-500/20 rounded text-sm outline-none dark:text-white"
                    />
                  </div>
                  <div>
                    <FL>Total BRL</FL>
                    <div className="w-full h-9 flex items-center justify-center bg-emerald-100 dark:bg-emerald-500/20 border border-emerald-200 dark:border-emerald-500/20 rounded text-emerald-800 dark:text-emerald-200 font-bold">
                      {fmtMoney("BRL", totalBrl)}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Registrar Pagamento (toggle só aparece na conversão de trial) */}
            {Boolean(allowConvertWithoutPayment) && (
              <div onClick={() => setRegisterPayment(!registerPayment)} className={`cursor-pointer p-2.5 rounded-lg border transition-all flex items-center justify-between ${registerPayment ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/20" : "bg-slate-50 border-slate-200 dark:bg-white/5 dark:border-white/10"}`}>
                <span className={`text-xs font-bold ${registerPayment ? "text-emerald-700 dark:text-emerald-400" : "text-slate-500"}`}>Registrar Pagamento?</span>
                <SW checked={registerPayment} onChange={setRegisterPayment} />
              </div>
            )}

            {registerPayment && (
              <div className="bg-slate-50 dark:bg-black/20 p-3 rounded-lg border border-slate-100 dark:border-white/5 animate-in slide-in-from-top-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FL>Método</FL>
                    <FS value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                      <option value="PIX">PIX</option>
                      <option value="Dinheiro">Dinheiro</option>
                      <option value="Cartão">Cartão</option>
                    </FS>
                  </div>
                  <div>
                    <FL>Data Pagto</FL>
                    <FI type="datetime-local" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="dark:[color-scheme:dark]" />
                  </div>
                </div>
              </div>
            )}

            {/* WhatsApp */}
            <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between gap-3 cursor-pointer" onClick={() => setSendWhats(v => !v)}>
                <span className="text-xs font-bold text-slate-600 dark:text-white/70">Enviar mensagem de pagamento?</span>
                <SW checked={sendWhats} onChange={setSendWhats} />
              </div>
              {sendWhats && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 animate-in fade-in duration-200">
                  <FS
                    value={selectedTemplateId}
                    onChange={e => {
                      const id = e.target.value;
                      setSelectedTemplateId(id);
                      const tpl = templates.find(t => t.id === id);
                      setMsgContent(tpl?.content || "");
                    }}
                  >
                    <option value="">-- Selecione modelo --</option>
                    {templates
                      .filter(t => t.category !== "Revenda IPTV" && t.category !== "Revenda SaaS" && !t.name.toLowerCase().startsWith("teste"))
                      .map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </FS>
                  <FS value={selectedSession} onChange={e => setSelectedSession(e.target.value)}>
                    {sessionOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </FS>
                </div>
              )}
              {/* Preview imagem do template */}
              {(() => {
                const tpl = templates.find(t => t.id === selectedTemplateId);
                if (!sendWhats || !tpl?.image_url) return null;
                return (
                  <div className="mt-2 animate-in fade-in zoom-in-95 duration-200">
                    <span className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">
                      Imagem Anexada
                    </span>
                    <div className="w-24 h-24 rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 shadow-sm bg-slate-100 dark:bg-black/40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={tpl.image_url} alt="Anexo do template" className="w-full h-full object-cover" />
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Observações */}
            <div>
              <FL>Observações Internas</FL>
              <textarea
                value={obs}
                onChange={e => setObs(e.target.value)}
                placeholder="Nota sobre esta renovação..."
                className="w-full h-16 px-3 py-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 resize-none"
              />
            </div>
          </div>

          {/* FOOTER */}
          <div className="px-6 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex justify-end gap-3 rounded-b-xl shrink-0">
            <button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 font-bold text-sm hover:bg-white dark:hover:bg-white/10 transition-all">
              Cancelar
            </button>
            <button
              onClick={e => { e.stopPropagation(); handlePreCheck(); }}
              disabled={loading}
              className="px-6 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg disabled:opacity-75 disabled:cursor-not-allowed flex items-center gap-2 min-w-[150px] justify-center transition-all"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  {loadingText}
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                  {isFromTrial && !registerPayment ? "Converter" : "Confirmar"}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {ConfirmUI}

      <div className="fixed inset-x-0 top-2 z-[999999] px-3 pointer-events-none">
        <div className="pointer-events-auto">
          <ToastNotifications toasts={toasts} removeToast={id => setToasts(p => p.filter(t => t.id !== id))} />
        </div>
      </div>
    </>,
    document.body
  );
}

// ─── UI ATOMS ─────────────────────────────────────────────────────────────────

function FL({ children }: { children: React.ReactNode }) {
  return <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">{children}</label>;
}
function FI({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors dark:[color-scheme:dark] ${className}`} />;
}
function FS({ className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors ${className}`} />;
}
function SW({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onChange(!checked); }}
      className={`relative w-11 h-6 rounded-full transition-colors ${checked ? "bg-emerald-600" : "bg-slate-200 dark:bg-white/20"}`}
    >
      <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? "left-6" : "left-1"}`} />
    </button>
  );
}

function DateInputBR({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const toDisplay = (iso: string) => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };
  const toISO = (br: string) => {
    const c = br.replace(/\D/g, "");
    const d = c.slice(0, 2), m = c.slice(2, 4), y = c.slice(4, 8);
    return y.length === 4 ? `${y}-${m}-${d}` : "";
  };
  const [display, setDisplay] = useState(toDisplay(value));
  useEffect(() => { setDisplay(toDisplay(value)); }, [value]);

  return (
    <input
      type="text"
      value={display}
      maxLength={10}
      placeholder="DD/MM/AAAA"
      onChange={e => {
        let v = e.target.value.replace(/\D/g, "");
        if (v.length > 2) v = v.slice(0, 2) + "/" + v.slice(2);
        if (v.length > 5) v = v.slice(0, 5) + "/" + v.slice(5);
        setDisplay(v);
        const iso = toISO(v);
        if (iso) onChange(iso);
      }}
      className="w-full h-10 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500 transition-colors"
    />
  );
}

function IconX() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>;
}
