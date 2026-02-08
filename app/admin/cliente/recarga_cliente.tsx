"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getCurrentTenantId } from "@/lib/tenant";
import ToastNotifications, { ToastMessage } from "../ToastNotifications";
import { useConfirm } from "@/app/admin/HookuseConfirm";

// --- INTERFACES ---
interface ClientFromView {
  id: string;
  display_name: string | null;
  username: string | null;
  server_id: string | null;
  server_name: string | null;
  plan_name: string | null;
  vencimento: string | null; // timestamptz
  computed_status: string | null;
  screens: number | null;
  price_amount: number | null;
  price_currency: string | null;
  whatsapp?: string | null;
  notes?: string | null;
}

type Currency = "BRL" | "USD" | "EUR";

interface PlanTableItemPrice {
  screens_count: number;
  price_amount: number | null;
}

interface PlanTableItem {
  id: string;
  period: string;
  credits_base: number;
  prices: PlanTableItemPrice[];
}

interface PlanTable {
  id: string;
  name: string;
  currency: Currency;
  is_system_default?: boolean | null;
  items: PlanTableItem[];
}

interface Props {
  clientId: string;
  clientName: string;
  onClose: () => void;
  onSuccess: () => void;
  onError?: (msg: string) => void;
  allowConvertWithoutPayment?: boolean;
}

// --- CONSTANTES ---
const PLAN_LABELS: Record<string, string> = {
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
};

const PLAN_MONTHS: Record<string, number> = {
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

// Helpers
function getLocalISOString() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function fmtMoney(currency: string, n: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency || "BRL",
  }).format(n);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toBRDate(dateISO: string) {
  const [y, m, d] = dateISO.split("-");
  return `${d}/${m}/${y}`;
}

function safeNumberFromMoneyBR(s: string) {
  return Number(String(s || "0").replace(/\./g, "").replace(",", ".")) || 0;
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

function pickPriceFromTable(
  table: PlanTable | null,
  period: string,
  screens: number
) {
  if (!table) return null;
  const item = table.items?.find((i) => i.period === period);
  if (!item) return null;

  const exact = item.prices?.find((p) => p.screens_count === screens);
  if (exact && exact.price_amount != null) return Number(exact.price_amount);

  const one = item.prices?.find((p) => p.screens_count === 1);
  if (one && one.price_amount != null) return Number(one.price_amount) * screens;

  return 0;
}

function pickCreditsUsed(table: PlanTable | null, period: string, screens: number) {
  if (!table) return null;
  const item = table.items?.find((i) => i.period === period);
  if (!item) return null;

  const base = Number(item.credits_base || 0);
  const used = base * Math.max(1, Number(screens || 1));
  return { base, used };
}

function nowInSaoPauloParts() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = fmt.formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";

  return {
    dateISO: `${get("year")}-${get("month")}-${get("day")}`,
    timeHHmm: `${get("hour")}:${get("minute")}`,
  };
}

function hhmmFromTimestamptzInSaoPaulo(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "00:00";

  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return fmt.format(d);
}

function saoPauloDateTimeToIso(dateISO: string, timeHHmm: string) {
  if (!dateISO || !timeHHmm) throw new Error("Data/hora inválida.");
  const isoWithTZ = `${dateISO}T${timeHHmm}:00-03:00`;
  const d = new Date(isoWithTZ);
  if (Number.isNaN(d.getTime())) throw new Error("Data/hora inválida.");
  return d.toISOString();
}


export default function RecargaCliente({
  clientId,
  clientName,
  onClose,
  onSuccess,
  allowConvertWithoutPayment = false,
}: Props) {
  // Estados globais
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const addToast = (type: "success" | "error", title: string, message?: string) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message, durationMs: 900 }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 900);
  };

  // Dados
  const [clientData, setClientData] = useState<ClientFromView | null>(null);

  // tabelas
  const [tables, setTables] = useState<PlanTable[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string>("");

  const tableChangedByUserRef = useRef(false);

  const selectedTable = useMemo(() => {
    return tables.find((t) => t.id === selectedTableId) || null;
  }, [tables, selectedTableId]);

  // Form
  const [selectedPlanPeriod, setSelectedPlanPeriod] = useState("MONTHLY");
  const [screens, setScreens] = useState(1);

  const [currency, setCurrency] = useState<Currency>("BRL");
  const [planPrice, setPlanPrice] = useState("0,00");
  const [priceTouched, setPriceTouched] = useState(false);

  // ✅ NOVO: Estados de Tecnologia
  const [technology, setTechnology] = useState("IPTV");
  const [customTechnology, setCustomTechnology] = useState("");

  
  // Novo vencimento: data + hora separados (SEMPRE São Paulo)
  const [dueDate, setDueDate] = useState<string>(() => {
    return nowInSaoPauloParts().dateISO;
  });

  const [dueTime, setDueTime] = useState(() => {
    return nowInSaoPauloParts().timeHHmm;
  });



  // Aux
  const [fxRate, setFxRate] = useState<number>(1);
  const [totalBrl, setTotalBrl] = useState(0);

  const [obs, setObs] = useState("");
  const [registerPayment, setRegisterPayment] = useState(true);
  const [sendWhats, setSendWhats] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState("PIX");
  const [payDate, setPayDate] = useState(getLocalISOString());
  const { confirm, ConfirmUI } = useConfirm();


  // ========= LOAD =========
  useEffect(() => {
  let alive = true;

  async function load() {
    try {
      const tid = await getCurrentTenantId();

        // 1) Cliente
        const { data: client, error: cErr } = await supabaseBrowser
          .from("vw_clients_list")
          .select("*")
          .eq("id", clientId)
          .single();

        if (!alive) return;

        if (cErr || !client) {
          console.error("❌ Erro carregando cliente:", cErr);
          onClose();
          return;
        }

        const c = client as ClientFromView;
        setClientData(c);
        setScreens(c.screens || 1);

        // 2) Plano (detectar período pelo label)
        const pName = (c.plan_name || "").toUpperCase();
        let foundPeriod = "MONTHLY";
        if (pName.includes("ANUAL")) foundPeriod = "ANNUAL";
        else if (pName.includes("SEMESTRAL")) foundPeriod = "SEMIANNUAL";
        else if (pName.includes("TRIMESTRAL")) foundPeriod = "QUARTERLY";
        else if (pName.includes("BIMESTRAL")) foundPeriod = "BIMONTHLY";
        setSelectedPlanPeriod(foundPeriod);

        // 3) LÓGICA DE VENCIMENTO (ATIVO vs VENCIDO)
        {
          const monthsToAdd = PLAN_MONTHS[foundPeriod] || 1;
const isActive = c.computed_status === "ACTIVE";

let baseDate: Date;
let newTimeStr: string;

if (isActive && c.vencimento) {
  // ✅ ATIVO: baseia no vencimento do banco e mantém a hora (em São Paulo)
  baseDate = new Date(c.vencimento);
  newTimeStr = hhmmFromTimestamptzInSaoPaulo(c.vencimento);
} else {
  // ✅ NÃO ATIVO: base = agora, hora = agora (São Paulo)
  baseDate = new Date();
  newTimeStr = nowInSaoPauloParts().timeHHmm;
}

// soma meses (a parte de "dia" pode variar com setMonth, mantém teu comportamento)
const target = new Date(baseDate);
target.setMonth(target.getMonth() + monthsToAdd);

// ✅ grava a data em São Paulo (YYYY-MM-DD)
const fmtDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dISO = fmtDate.format(target);

setDueDate(dISO);
setDueTime(newTimeStr);

        }

        // 4) Tabelas
        const { data: tData, error: tErr } = await supabaseBrowser
          .from("plan_tables")
          .select(
            `id, name, currency, is_system_default,
             items:plan_table_items (id, period, credits_base, prices:plan_table_item_prices (screens_count, price_amount))`
          )
          .eq("tenant_id", tid)
          .eq("is_active", true);

        if (tErr) {
          console.error("❌ Erro carregando plan_tables:", tErr);
          addToast("error", "Falha ao carregar tabelas", tErr.message);
        }

        const allTables = (tData || []) as unknown as PlanTable[];
        setTables(allTables);

        // 5) Seleção inicial de tabela
        const desiredCurrency = (c.price_currency as Currency) || "BRL";
        const defaultOfCurrency =
          allTables.find((t) => t.currency === desiredCurrency && t.is_system_default) ||
          allTables.find((t) => t.currency === desiredCurrency) ||
          allTables[0];

        if (defaultOfCurrency) {
          setSelectedTableId(defaultOfCurrency.id);
          setCurrency(defaultOfCurrency.currency || "BRL");
        } else {
          setCurrency(desiredCurrency);
        }

        // 6) Valor inicial
        if (c.price_amount != null) {
          setPlanPrice(Number(c.price_amount).toFixed(2).replace(".", ","));
          setPriceTouched(true);
        } else {
          const initialPrice = pickPriceFromTable(defaultOfCurrency || null, foundPeriod, c.screens || 1);
          setPlanPrice(Number(initialPrice || 0).toFixed(2).replace(".", ","));
          setPriceTouched(false);
        }

        // 7) FX
        if (desiredCurrency !== "BRL") {
          const { data: fx, error: fxErr } = await supabaseBrowser
            .from("tenant_fx_rates")
            .select("usd_to_brl, eur_to_brl, as_of_date")
            .eq("tenant_id", tid)
            .order("as_of_date", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (fxErr) {
            console.error("❌ tenant_fx_rates error:", fxErr);
            addToast("error", "Falha ao carregar câmbio", fxErr.message);
            setFxRate(5);
          } else {
            const rate =
              desiredCurrency === "USD"
                ? Number(fx?.usd_to_brl || 5)
                : Number(fx?.eur_to_brl || 5);

            setFxRate(rate);
          }
        } else {
          setFxRate(1);
        }

        // ✅ PREFILL TECNOLOGIA
        // O campo 'technology' deve vir da view. Se não vier, assume padrão.
        // Se a view ainda não retorna 'technology', isso ficará como undefined e cairá no "IPTV".
        // Caso você já tenha atualizado a view vw_clients_list para trazer technology, adicione na interface ClientFromView lá em cima.
        // Por segurança, vou fazer um cast aqui para evitar erro de TS se a interface não tiver sido atualizada ainda.
        const tecRaw = (c as any).technology || "IPTV";
        const isStandard = ["IPTV", "P2P", "OTT"].some(t => t.toUpperCase() === tecRaw.toUpperCase());
        
        if (isStandard) {
           setTechnology(tecRaw.toUpperCase());
           setCustomTechnology("");
        } else {
           setTechnology("Personalizado");
           setCustomTechnology(tecRaw);
        }

      } catch (err: any) {
      console.error("❌ Crash load:", err);
    } finally {
      if (alive) setFetching(false);
    }
  }

    load();
  return () => {
    alive = false;
  };
  // ⚠️ IMPORTANTE: NÃO depende de onClose (evita re-fetch em loop)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [clientId]);


  // ========= REGRAS DE UI =========

  // Quando troca o período: recalcula vencimento seguindo a mesma lógica (Ativo vs Vencido)
    useEffect(() => {
  if (!clientData) return;

  const monthsToAdd = PLAN_MONTHS[selectedPlanPeriod] || 1;
  const isActive = clientData.computed_status === "ACTIVE";

  const base =
    isActive && clientData.vencimento ? new Date(clientData.vencimento) : new Date();

  const target = new Date(base);
  target.setMonth(target.getMonth() + monthsToAdd);

  const fmtDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const dISO = fmtDate.format(target);
  setDueDate(dISO);

  // preço: só auto se não está "tocado"
  if (!priceTouched) {
    const p = pickPriceFromTable(selectedTable, selectedPlanPeriod, screens);
    setPlanPrice(Number(p || 0).toFixed(2).replace(".", ","));
  }
}, [clientData, selectedPlanPeriod, priceTouched, selectedTable, screens]);



  // Quando troca telas
  useEffect(() => {
    if (!selectedTable) return;
    if (priceTouched) return;

    const p = pickPriceFromTable(selectedTable, selectedPlanPeriod, screens);
    setPlanPrice(Number(p || 0).toFixed(2).replace(".", ","));
  }, [screens, selectedTable, selectedPlanPeriod, priceTouched]);

  // Quando troca TABELA
  useEffect(() => {
    if (!selectedTable) return;

    setCurrency(selectedTable.currency || "BRL");

    const userChanged = tableChangedByUserRef.current === true;

    if (userChanged || !priceTouched) {
      const p = pickPriceFromTable(selectedTable, selectedPlanPeriod, screens);
      setPlanPrice(Number(p || 0).toFixed(2).replace(".", ","));
      if (userChanged) setPriceTouched(false);
    }

    tableChangedByUserRef.current = false;

    (async () => {
      try {
        const tid = await getCurrentTenantId();
        if (selectedTable.currency === "BRL") {
          setFxRate(1);
          return;
        }

        const { data: fx, error: fxErr } = await supabaseBrowser
          .from("tenant_fx_rates")
          .select("usd_to_brl, eur_to_brl, as_of_date")
          .eq("tenant_id", tid)
          .order("as_of_date", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fxErr) {
          console.error("❌ tenant_fx_rates error:", fxErr);
          addToast("error", "Falha ao carregar câmbio", fxErr.message);
          setFxRate(5);
          return;
        }

        const rate =
          selectedTable.currency === "USD"
            ? Number(fx?.usd_to_brl || 5)
            : Number(fx?.eur_to_brl || 5);

        setFxRate(rate);
      } catch (e: any) {
        console.error("❌ Crash FX:", e);
        setFxRate(5);
      }
    })();
  }, [selectedTableId]);

  // Total BRL
  useEffect(() => {
    const rawVal = safeNumberFromMoneyBR(planPrice);
    setTotalBrl(currency === "BRL" ? rawVal : rawVal * (Number(fxRate) || 0));
  }, [planPrice, fxRate, currency]);

  const creditsInfo = useMemo(() => {
    return pickCreditsUsed(selectedTable, selectedPlanPeriod, screens);
  }, [selectedTable, selectedPlanPeriod, screens]);

  const showFx = currency !== "BRL";

  // ========= LOGICA DE CONFIRMAÇÃO =========

  // 1. Valida e Abre o Popup
  const handlePreCheck = async () => {

    if (loading || !clientData) return;

    // Validação Tecnologia
    if (technology === "Personalizado" && !customTechnology.trim()) {
        addToast("error", "Tecnologia", "Para 'Personalizado', digite o nome.");
        return;
    }

    if (!clientData.server_id) {
      addToast("error", "Erro", "Cliente está sem servidor vinculado.");
      return;
    }

    const rawPlanPrice = safeNumberFromMoneyBR(planPrice);
    const creditsUsed = creditsInfo?.used ?? 0;
    const isFromTrial = Boolean(allowConvertWithoutPayment);
    const isPaymentFlow = Boolean(registerPayment);

    // Monta o resumo para o popup
    const details = [];
    details.push(`Plano: ${PLAN_LABELS[selectedPlanPeriod]}`);
    details.push(`Telas: ${screens}`);
    details.push(`Vencimento: ${toBRDate(dueDate)} às ${dueTime}`);
    
    if (isFromTrial && !isPaymentFlow) {
        details.push(`Tipo: Conversão (Sem pagamento)`);
    } else {
        details.push(`Valor: ${fmtMoney(currency, rawPlanPrice)}`);
        if (creditsUsed > 0) details.push(`Créditos a descontar: ${creditsUsed}`);
    }

    // Abre o Modal Bonito
const ok = await confirm({
  title: isFromTrial && !isPaymentFlow ? "Converter Cliente" : "Confirmar Renovação",
  subtitle: "Confira os dados antes de salvar.",
  tone: isFromTrial && !isPaymentFlow ? "sky" : "emerald",
  icon: isFromTrial && !isPaymentFlow ? "✨" : "💰",
  details,
  confirmText: "Confirmar",
  cancelText: "Voltar",
});

if (!ok) return;

await executeSave();

  };

  // 2. Executa a Gravação (Chamado pelo botão "Confirmar" do popup)
const executeSave = async () => {
  if (loading) return;
  setLoading(true);

    try {
      // Prepara dados finais
      let finalTechnology = technology;
      if (technology === "Personalizado") finalTechnology = customTechnology.trim();

      const rawPlanPrice = safeNumberFromMoneyBR(planPrice);
      const monthsToRenew = Number(PLAN_MONTHS[selectedPlanPeriod] ?? 1);
      const dueISO = saoPauloDateTimeToIso(dueDate, dueTime);

      const tid = await getCurrentTenantId();
      const nameToSend = clientData?.display_name || clientName;

      // --- 1. UPDATE CLIENT ---
      const { error: updateError } = await supabaseBrowser.rpc("update_client", {
        p_tenant_id: tid,
        p_client_id: clientId,
        p_display_name: nameToSend,
        p_name_prefix: null,
        p_notes: null,
        p_clear_notes: false,
        p_server_id: clientData?.server_id,
        p_server_username: clientData?.username,
        p_server_password: null,
        p_screens: Number(screens),
        p_plan_label: PLAN_LABELS[selectedPlanPeriod],
        p_price_amount: rawPlanPrice,
        p_price_currency: currency as any,
        p_vencimento: dueISO,
        p_is_trial: allowConvertWithoutPayment ? false : null,
        p_whatsapp_opt_in: Boolean(sendWhats),
        p_whatsapp_username: null,
        p_whatsapp_snooze_until: null,
        p_is_archived: false,
        p_technology: finalTechnology,
      });

      if (updateError) throw new Error(`Erro Update: ${updateError.message}`);

      // --- 2. RENEW / PAYMENT ---
      if (registerPayment) {
        const { error: renewError } = await supabaseBrowser.rpc("renew_client_and_log", {
          p_tenant_id: tid,
          p_client_id: clientId,
          p_months: monthsToRenew,
          p_status: "PAID",
          p_notes: `Renovado via Painel. Obs: ${obs || ""}`,
          p_new_vencimento: dueISO,
        });
        if (renewError) throw new Error(`Erro Renew: ${renewError.message}`);
      }

      setTimeout(() => { onSuccess(); onClose(); }, 500);

    } catch (err: any) {
      console.error("CRASH:", err);
      addToast("error", "Erro ao salvar", err.message || "Falha desconhecida");
    } finally {
      setLoading(false);
    }
  };

  if (fetching) return null;

  const isFromTrial = Boolean(allowConvertWithoutPayment);
  const headerTitle = isFromTrial ? "Converter em Assinante" : "Renovação de Assinatura";

  return (
    <>
      {/* --- MODAL PRINCIPAL --- */}
      <div
        className="fixed inset-0 z-[99990] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in zoom-in duration-200"
        onClick={onClose}
      >
        <div
          className="w-full max-w-xl bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col max-h-[95vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* HEADER */}
          <div className="px-5 py-4 border-b border-slate-100 dark:border-white/5 flex justify-between items-center bg-white dark:bg-[#161b22]">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isFromTrial ? 'bg-sky-100 text-sky-600' : 'bg-emerald-100 text-emerald-600'} dark:bg-white/5`}>
                 {isFromTrial ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                 ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                 )}
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-white leading-tight">
                  {headerTitle}
                </h2>
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-white/50">
                   <span className="font-medium text-slate-700 dark:text-white">{clientName}</span>
                   <span>•</span>
                   <span>{clientData?.server_name || "Sem servidor"}</span>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">✕</button>
          </div>

          {/* BODY */}
          <div className="p-5 space-y-6 overflow-y-auto custom-scrollbar">
            
            {/* 1. SEÇÃO VENCIMENTO (CARD) */}
            <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-xl p-4">
               <div className="flex items-center gap-2 mb-3 border-b border-slate-200 dark:border-white/10 pb-2">
                  <span className="text-emerald-500">📅</span>
                  <span className="text-xs font-bold uppercase text-slate-500 dark:text-white/60 tracking-wider">Novo Vencimento</span>
               </div>
               <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Data do Vencimento</Label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full h-10 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-slate-800 dark:text-white outline-none focus:border-emerald-500 transition-colors text-sm font-medium dark:[color-scheme:dark]"
                    />
                  </div>
                  <div>
                    <Label>Hora Limite</Label>
                    <div className="flex gap-2">
                      <input
                        type="time"
                        value={dueTime}
                        onChange={(e) => setDueTime(e.target.value)}
                        className="flex-1 h-10 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-slate-800 dark:text-white outline-none focus:border-emerald-500 transition-colors text-sm font-medium dark:[color-scheme:dark]"
                      />
                      <button
                        type="button"
                        onClick={() => setDueTime("23:59")}
                        className="px-3 h-10 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-500 hover:text-emerald-600 hover:border-emerald-500/50 transition-all"
                        title="Definir fim do dia"
                      >
                        23:59
                      </button>
                    </div>
                  </div>
               </div>
            </div>

            {/* 2. SEÇÃO PLANO */}
            <div>
                
                <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-1">
                        <Label>Período / Ciclo</Label>
                        <Select value={selectedPlanPeriod} onChange={(e) => setSelectedPlanPeriod(e.target.value)}>
                          {Object.entries(PLAN_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </Select>
                    </div>
                    <div>
                        <Label>Telas (Conexões)</Label>
                        <Input type="number" min={1} value={screens} onChange={(e) => setScreens(Math.max(1, Number(e.target.value || 1)))} />
                    </div>
                    <div>
                        <Label>Créditos a Descontar</Label>
                        <div className="h-10 w-full bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 rounded-lg flex items-center justify-center text-sm font-bold text-blue-700 dark:text-blue-300">
                          {creditsInfo ? creditsInfo.used : "-"}
                        </div>
                    </div>
                </div>
            </div>

            {/* 3. SEÇÃO FINANCEIRO (CARD DESTACADO) */}
            <div className="bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl p-4 shadow-sm">
                <div className="flex justify-between items-center mb-3 border-b border-slate-100 dark:border-white/5 pb-2">
                    <span className="text-xs font-bold uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        💰 Financeiro
                    </span>
                    <select
                      value={selectedTableId}
                      onChange={(e) => { tableChangedByUserRef.current = true; setSelectedTableId(e.target.value); }}
                      className="text-[10px] bg-transparent text-right text-slate-400 font-bold outline-none cursor-pointer hover:text-emerald-500"
                    >
                      {tables.map((t) => <option key={t.id} value={t.id}>Tab: {formatTableLabel(t)}</option>)}
                    </select>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-4">
                    <div>
                       <Label>Moeda</Label>
                       <div className="h-10 w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg flex items-center justify-center text-sm font-bold text-slate-600 dark:text-white">
                         {currency}
                       </div>
                    </div>
                    <div className="col-span-2">
                       <Label>Valor a Cobrar</Label>
                       <Input
                         value={planPrice}
                         onChange={(e) => { setPlanPrice(e.target.value); setPriceTouched(true); }}
                         className="text-right font-bold text-slate-800 dark:text-white text-lg"
                         placeholder="0,00"
                       />
                    </div>
                </div>

                {/* Opção de Registrar Pagamento */}
                {Boolean(allowConvertWithoutPayment) && (
                    <div className="mb-3">
                        <div onClick={() => setRegisterPayment(!registerPayment)} className={`cursor-pointer p-3 rounded-lg border transition-all flex items-center justify-between ${registerPayment ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/20" : "bg-slate-50 border-slate-200 dark:bg-white/5 dark:border-white/10"}`}>
                            <span className={`text-xs font-bold ${registerPayment ? "text-emerald-700 dark:text-emerald-400" : "text-slate-500"}`}>Registrar Pagamento Agora?</span>
                            <div className={`relative w-9 h-5 rounded-full transition-colors ${registerPayment ? "bg-emerald-500" : "bg-slate-300 dark:bg-white/20"}`}>
                                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${registerPayment ? "translate-x-4" : "translate-x-0"}`} />
                            </div>
                        </div>
                    </div>
                )}

                {/* DETALHES DO PAGAMENTO (SE ATIVO) */}
                {registerPayment && (
                    <div className="bg-slate-50 dark:bg-white/5 p-3 rounded-lg border border-slate-100 dark:border-white/5 animate-in slide-in-from-top-2">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <Label>Método de Pagamento</Label>
                                <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                                    <option value="PIX">PIX</option>
                                    <option value="Dinheiro">Dinheiro</option>
                                    <option value="Cartão">Cartão</option>
                                </Select>
                            </div>
                            <div>
                                <Label>Data do Pagamento</Label>
                                <Input
                                    type="datetime-local"
                                    value={payDate}
                                    onChange={(e) => setPayDate(e.target.value)}
                                    className="dark:[color-scheme:dark]"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {showFx && (
                    <div className="mt-3 flex gap-2 p-2 bg-amber-50 dark:bg-amber-500/10 rounded border border-amber-100 dark:border-amber-500/20 items-center justify-between text-xs">
                       <div className="flex items-center gap-1">
                          <span className="font-bold text-amber-700 dark:text-amber-400">Câmbio:</span>
                          <input type="number" value={Number(fxRate).toFixed(4)} onChange={(e) => setFxRate(Number(e.target.value))} className="w-16 bg-white dark:bg-black/20 border border-amber-200 rounded px-1 text-center outline-none" />
                       </div>
                       <div className="font-bold text-emerald-700 dark:text-emerald-400">Total: {fmtMoney("BRL", totalBrl)}</div>
                    </div>
                )}
            </div>

            {/* 4. SEÇÃO OUTROS */}
            <div>
                
                <div className="grid grid-cols-2 gap-4 mb-3">
                    <div>
                        <Label>Tecnologia</Label>
                        {technology === "Personalizado" ? (
                            <div className="flex gap-1">
                                <Input value={customTechnology} onChange={(e) => setCustomTechnology(e.target.value)} placeholder="Digite..." autoFocus />
                                <button onClick={() => setTechnology("IPTV")} className="p-2 text-slate-400 hover:text-rose-500 border rounded dark:border-white/10">✕</button>
                            </div>
                        ) : (
                            <Select value={technology} onChange={(e) => { const v = e.target.value; if(v==="Personalizado"){setTechnology("Personalizado");setCustomTechnology("");}else setTechnology(v); }}>
                                <option value="IPTV">IPTV</option>
                                <option value="P2P">P2P</option>
                                <option value="OTT">OTT</option>
                                {!["IPTV", "P2P", "OTT", "Personalizado"].includes(technology) && <option value={technology}>{technology}</option>}
                                <option value="Personalizado">Outro...</option>
                            </Select>
                        )}
                    </div>
                    <div>
                        <Label>Notificação WhatsApp</Label>
                        <div onClick={() => setSendWhats(!sendWhats)} className="h-10 px-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-600 dark:text-white/70">Enviar Comprovante?</span>
                            <div className={`relative w-8 h-4 rounded-full transition-colors ${sendWhats ? "bg-emerald-500" : "bg-slate-300 dark:bg-white/20"}`}>
                                <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${sendWhats ? "translate-x-4" : "translate-x-0"}`} />
                            </div>
                        </div>
                    </div>
                </div>

                <div>
                    <Label>Observações (Opcional)</Label>
                    <textarea
                        value={obs}
                        onChange={(e) => setObs(e.target.value)}
                        className="w-full h-16 px-3 py-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 resize-none dark:text-white transition-all"
                        placeholder="Adicione uma nota sobre esta renovação..."
                    />
                </div>
            </div>

          </div>

          {/* FOOTER */}
          <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 font-bold text-sm hover:bg-white dark:hover:bg-white/10 transition-all"
            >
              Cancelar
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handlePreCheck(); }}
              disabled={loading}
              className="px-8 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
            >
              {loading ? (
                 <>
                   <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                   Processando...
                 </>
              ) : (
                 <>
                   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                   {Boolean(allowConvertWithoutPayment) && !registerPayment ? "Converter sem Pagar" : "Confirmar Renovação"}
                 </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ✅ Confirm Dialog Global */}
      {ConfirmUI}

      <ToastNotifications
        toasts={toasts}
        removeToast={(id) => setToasts((p) => p.filter((t) => t.id !== id))}
      />
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">
      {children}
    </label>
  );
}

function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 transition-colors dark:[color-scheme:dark] ${className}`}
    />
  );
}

function Select({ className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}