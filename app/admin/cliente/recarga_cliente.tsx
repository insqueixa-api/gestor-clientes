  "use client";

  import { useState, useEffect, useMemo, useRef } from "react";
  import { createPortal } from "react-dom"; // ✅ Importação necessária
  import { supabaseBrowser } from "@/lib/supabase/browser";
  import { getCurrentTenantId } from "@/lib/tenant";
  import ToastNotifications, { ToastMessage } from "../ToastNotifications";
  import { useConfirm } from "@/app/admin/HookuseConfirm";
  import { Suspense } from "react";

  // --- INTERFACES ---
  interface ClientFromView {
    id: string;
    display_name: string | null;
    username: string | null;
    external_user_id?: string | null; // ✅ ADICIONADO PARA A ELITE
    server_id: string | null;
    server_name: string | null;

    plan_name: string | null;

    // ✅ NOVO (fonte da verdade da tabela)
    plan_table_id?: string | null;
    plan_table_name?: string | null;

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

  interface MessageTemplate {
    id: string;
    name: string;
    content: string;
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

    // ✅ NOVO: define em qual lista a tela vai ler o toast depois
    toastKey?: "clients_list_toasts" | "trials_list_toasts";
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


  // ✅ Função auxiliar para mandar toasts para a tela de listagem (Session Storage)
  function queueToast(
    type: "success" | "error",
    title: string,
    message?: string,
    key: "clients_list_toasts" | "trials_list_toasts" = "clients_list_toasts"
  ) {
    try {
      const raw = window.sessionStorage.getItem(key);
      const arr = raw ? JSON.parse(raw) : [];
      arr.push({ type, title, message, ts: Date.now() });
      window.sessionStorage.setItem(key, JSON.stringify(arr));
    } catch (e) {
      console.error("Erro ao salvar toast", e);
    }
  }


  export default function RecargaCliente({
    clientId,
    clientName,
    onClose,
    onSuccess,
    allowConvertWithoutPayment = false,
    toastKey = "clients_list_toasts",
  }: Props) {

    // ✅ 1. Estado para garantir renderização no client (evita erro de hidratação no Portal)
    const [mounted, setMounted] = useState(false);

    // ✅ 2. Efeito para TRAVAR O SCROLL da página de fundo
const modalScrollYRef = useRef(0);

useEffect(() => {
  setMounted(true);

  if (typeof window === "undefined") return;

  const body = document.body;
  const html = document.documentElement;

  const scrollY = window.scrollY || window.pageYOffset || 0;
  modalScrollYRef.current = scrollY;

  const prevBodyOverflow = body.style.overflow;
  const prevBodyPosition = body.style.position;
  const prevBodyTop = body.style.top;
  const prevBodyWidth = body.style.width;
  const prevHtmlOverflow = html.style.overflow;

  html.style.overflow = "hidden";
  body.style.overflow = "hidden";
  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.width = "100%";

  return () => {
    html.style.overflow = prevHtmlOverflow;
    body.style.overflow = prevBodyOverflow;
    body.style.position = prevBodyPosition;
    body.style.top = prevBodyTop;
    body.style.width = prevBodyWidth;

    window.scrollTo(0, modalScrollYRef.current || 0);
  };
}, []);

// Estados globais
    const [loading, setLoading] = useState(false);
    // ✅ NOVO: Texto dinâmico para feedback sequencial no botão
    const [loadingText, setLoadingText] = useState("Processando..."); 
    const [fetching, setFetching] = useState(true);
    
    // ✅ TRANCA SÍNCRONA ANTI-DUPLO CLIQUE
    const isSavingRef = useRef(false);
    const isCheckingRef = useRef(false);

    // Toast Local
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const addToast = (type: "success" | "error", title: string, message?: string) => {
      const id = Date.now();
      setToasts((prev) => [...prev, { id, type, title, message, durationMs: 5000 }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
    };

  // Dados do Cliente e Tabelas
    const [clientData, setClientData] = useState<ClientFromView | null>(null);
    const [tables, setTables] = useState<PlanTable[]>([]);
    const [selectedTableId, setSelectedTableId] = useState<string>("");
    
    // ✅ Adicionado isFirstLoad para evitar reset de preço ao abrir
    const tableChangedByUserRef = useRef(false);
    const isFirstLoad = useRef(true);

    const selectedTable = useMemo(() => {
      return tables.find((t) => t.id === selectedTableId) || null;
    }, [tables, selectedTableId]);

    // Formulário
    const [selectedPlanPeriod, setSelectedPlanPeriod] = useState("MONTHLY");
    const [screens, setScreens] = useState(1);
    const [currency, setCurrency] = useState<Currency>("BRL");
    const [planPrice, setPlanPrice] = useState("0,00");
    const [priceTouched, setPriceTouched] = useState(false);

    // Tecnologia
    const [technology, setTechnology] = useState("IPTV");
    const [customTechnology, setCustomTechnology] = useState("");

    // Vencimento (Inicia com Data de Hoje e Hora Atual de SP)
    const [dueDate, setDueDate] = useState<string>(() => nowInSaoPauloParts().dateISO);
    const [dueTime, setDueTime] = useState(() => nowInSaoPauloParts().timeHHmm);

    // Auxiliares e Pagamento
    const [fxRate, setFxRate] = useState<number>(1);
    const [totalBrl, setTotalBrl] = useState(0);
    const [obs, setObs] = useState("");
    const [registerPayment, setRegisterPayment] = useState(true);
    const [paymentMethod, setPaymentMethod] = useState("PIX");
    const [payDate, setPayDate] = useState(getLocalISOString());

    // ✅ MENSAGENS E WHATSAPP (Estados que faltavam)
    const [sendWhats, setSendWhats] = useState(true);
    const [templates, setTemplates] = useState<MessageTemplate[]>([]);
    const [selectedTemplateId, setSelectedTemplateId] = useState("");
    const [messageContent, setMessageContent] = useState("");

// ✅ NOVO: Renovação Automática
const [hasIntegration, setHasIntegration] = useState(false);
const [isEliteProvider, setIsEliteProvider] = useState(false);
const [integrationProvider, setIntegrationProvider] = useState("NONE"); // ✅ NOVO
const [renewAutomatic, setRenewAutomatic] = useState(false);

    // Hook de Confirmação
    const { confirm, ConfirmUI } = useConfirm();

    // ========= LOAD =========
    useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const tid = await getCurrentTenantId();

          // 1) Cliente (Busca direta na tabela para contornar a view excluída)
          const { data: rawClient, error: cErr } = await supabaseBrowser
            .from("clients")
            .select("*, servers(name)")
            .eq("id", clientId)
            .single();

          if (!alive) return;

          if (cErr || !rawClient) {
            console.error("❌ Erro carregando cliente:", cErr);
            onClose();
            return;
          }

  // Simula o formato da view antiga para não quebrar nada no seu código
  const client = {
    ...rawClient,
    display_name: rawClient.display_name,
    username: rawClient.server_username,
    server_name: rawClient.servers?.name || null,
    plan_name: rawClient.plan_label,
    whatsapp: rawClient.phone_e164,
    computed_status: rawClient.is_archived ? "ARCHIVED" : (rawClient.is_trial ? "TRIAL" : "ACTIVE")
  };

  const c = client as unknown as ClientFromView;

  // ✅ Fonte da verdade: clients (notes + tabela + moeda)
  let dbNotes: string | null = null;
  let dbPlanTableId: string | null = null;
  let dbPriceCurrency: string | null = null;

  try {
    const { data: cDb, error: cDbErr } = await supabaseBrowser
      .from("clients")
      .select("notes, plan_table_id, price_currency")
      .eq("tenant_id", tid)
      .eq("id", clientId)
      .maybeSingle();

    if (!cDbErr && cDb) {
      const n = (cDb as any).notes;
      dbNotes = typeof n === "string" ? n : null;

      const pt = (cDb as any).plan_table_id;
      dbPlanTableId = typeof pt === "string" ? pt : null;

      const pc = (cDb as any).price_currency;
      dbPriceCurrency = typeof pc === "string" ? pc : null;
    }
  } catch (e) {
    console.error("Falha ao buscar fonte da verdade do cliente (clients):", e);
  }

  // ✅ Ajusta o clientData do modal com a verdade do banco
  const cFixed: ClientFromView = {
    ...c,
    notes: dbNotes ?? c.notes ?? null,
    plan_table_id: dbPlanTableId ?? c.plan_table_id ?? null,
    price_currency: dbPriceCurrency ?? c.price_currency ?? null,
  };

  setClientData(cFixed);
  setScreens(cFixed.screens || 1);

  // ✅ Prefill Observações (agora certo)
  setObs(cFixed.notes || "");

  // ✅ NOVO: Detectar se servidor tem integração e QUAL O PROVEDOR
if (c.server_id) {
  try {
    const { data: srv } = await supabaseBrowser
      .from("servers")
      .select("panel_integration")
      .eq("id", c.server_id)
      .single();

    const hasInteg = Boolean(srv?.panel_integration);
    setHasIntegration(hasInteg);
    setRenewAutomatic(hasInteg);

    if (hasInteg) {
      const { data: integ } = await supabaseBrowser
        .from("server_integrations")
        .select("provider")
        .eq("id", srv.panel_integration)
        .single();
      
      const prov = String(integ?.provider || "").toUpperCase();
      setIntegrationProvider(prov);
      setIsEliteProvider(prov === "ELITE");
    } else {
      setIntegrationProvider("NONE");
      setIsEliteProvider(false);
    }
  } catch (e) {
    console.error("Erro ao verificar integração:", e);
    setHasIntegration(false);
    setRenewAutomatic(false);
    setIntegrationProvider("NONE");
    setIsEliteProvider(false);
  }
}


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

          // 5) Seleção inicial de tabela (✅ respeita a tabela real do cliente)
            const desiredCurrency = ((cFixed.price_currency as Currency) || "BRL");

  // 5.1) tenta usar a tabela REAL salva no cliente
  const fromClient =
    cFixed.plan_table_id
      ? allTables.find((t) => t.id === cFixed.plan_table_id)
      : null;


            // 5.2) fallback: mesma lógica antiga (default por moeda)
            const fallbackByCurrency =
              allTables.find((t) => t.currency === desiredCurrency && t.is_system_default) ||
              allTables.find((t) => t.currency === desiredCurrency) ||
              allTables[0];

            const initialTable = fromClient || fallbackByCurrency || null;

            if (initialTable) {
              setSelectedTableId(initialTable.id);
              setCurrency((initialTable.currency as Currency) || "BRL");
            } else {
              setCurrency(desiredCurrency);
            }


          // 6) Valor inicial (✅ usa cFixed)
  if (cFixed.price_amount != null) {
    setPlanPrice(Number(cFixed.price_amount).toFixed(2).replace(".", ","));
    setPriceTouched(true);
  } else {
    const initialPrice = pickPriceFromTable(
      initialTable || null,
      foundPeriod,
      cFixed.screens || 1
    );
    setPlanPrice(Number(initialPrice || 0).toFixed(2).replace(".", ","));
    setPriceTouched(false);
  }


  // 7) FX (✅ usa desiredCurrency que já veio de cFixed lá no Patch 2)
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

          // ✅ CORREÇÃO: Carregar templates e pré-selecionar
          const { data: tmplData } = await supabaseBrowser
            .from("message_templates")
            .select("id, name, content")
            .eq("tenant_id", tid)
            .order("name", { ascending: true });

  if (tmplData) {
            setTemplates(tmplData);
            const defaultTpl = tmplData.find(t => t.name.toLowerCase().includes("pagamento realizado"));
            if (defaultTpl) {
              setSelectedTemplateId(defaultTpl.id);
              setMessageContent(defaultTpl.content);
            }
          }

          // ✅ Libera a trava de "Primeira Carga" após carregar tudo
          setTimeout(() => { isFirstLoad.current = false; }, 500);

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

    // 1. Vencimento ao mudar plano
    useEffect(() => {
      if (!clientData) return;
      const monthsToAdd = PLAN_MONTHS[selectedPlanPeriod] || 1;
      const isActive = clientData.computed_status === "ACTIVE";
      const base = isActive && clientData.vencimento ? new Date(clientData.vencimento) : new Date();
      const target = new Date(base);
      target.setMonth(target.getMonth() + monthsToAdd);
      const fmtDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
      setDueDate(fmtDate.format(target));
    }, [clientData, selectedPlanPeriod]);


    // ✅ Regra: se converter SEM pagamento, por padrão não faz sentido enviar mensagem.
  // MAS o usuário pode ligar manualmente depois.
  useEffect(() => {
    const isFromTrial = Boolean(allowConvertWithoutPayment);

    if (!isFromTrial) return;

    // quando desliga "Registrar pagamento", auto-desliga Whats
    if (!registerPayment) {
      setSendWhats(false);
    }
  }, [allowConvertWithoutPayment, registerPayment]);


    // 2. Resetar Override (priceTouched) se mudar estrutura, MAS IGNORA NO LOAD
    useEffect(() => {
      if (isFirstLoad.current) return; // ✅ Não reseta se acabou de carregar
      setPriceTouched(false);
    }, [screens, selectedPlanPeriod, selectedTableId]);

    // 3. Calcular Preço (Respeita Tabela se !priceTouched)
    useEffect(() => {
      if (!selectedTable) return;
      if (priceTouched) return;

      const p = pickPriceFromTable(selectedTable, selectedPlanPeriod, Number(screens) || 1);
      setPlanPrice(Number(p || 0).toFixed(2).replace(".", ","));
    }, [screens, selectedTable, selectedPlanPeriod, priceTouched]);

    // 4. Troca de Tabela (Atualiza Moeda e Taxa)
    useEffect(() => {
      if (!selectedTable) return;
      setCurrency(selectedTable.currency || "BRL");

      const userChanged = tableChangedByUserRef.current === true;
      if (userChanged) setPriceTouched(false);

      (async () => {
        try {
          const tid = await getCurrentTenantId();
          if (selectedTable.currency === "BRL") {
            setFxRate(1);
            return;
          }
          const { data: fx } = await supabaseBrowser.from("tenant_fx_rates").select("*").eq("tenant_id", tid).order("as_of_date", { ascending: false }).limit(1).maybeSingle();
          if (fx) {
              const rate = selectedTable.currency === "USD" ? Number(fx.usd_to_brl) : Number(fx.eur_to_brl);
              setFxRate(rate || 5);
          } else { setFxRate(5); }
        } catch (e) { console.error(e); setFxRate(5); }
      })();
      tableChangedByUserRef.current = false;
    }, [selectedTableId]);

// Total BRL
    useEffect(() => {
      const rawVal = safeNumberFromMoneyBR(planPrice);
      setTotalBrl(currency === "BRL" ? rawVal : rawVal * (Number(fxRate) || 0));
    }, [planPrice, fxRate, currency]);

    // ✅ TRAVA DE TECNOLOGIA POR PROVEDOR (Evita envios errados para API)
    useEffect(() => {
      if (integrationProvider === "FAST" || integrationProvider === "NATV") {
        if (technology !== "IPTV") {
          setTechnology("IPTV");
          setCustomTechnology("");
        }
      } else if (integrationProvider === "ELITE") {
        if (technology !== "IPTV" && technology !== "P2P") {
          setTechnology("IPTV");
          setCustomTechnology("");
        }
      }
    }, [integrationProvider, technology]);

    // ✅ TRAVA DO PLANO ANUAL APENAS PARA ELITE
    useEffect(() => {
      if (isEliteProvider && selectedPlanPeriod === "ANNUAL") {
        setSelectedPlanPeriod("SEMIANNUAL");
        addToast("success", "Plano ajustado", "A integração Elite permite no máximo 6 meses.");
      }
    }, [isEliteProvider, selectedPlanPeriod]);

    const creditsInfo = useMemo(() => {
      return pickCreditsUsed(selectedTable, selectedPlanPeriod, screens);
    }, [selectedTable, selectedPlanPeriod, screens]);

    const showFx = currency !== "BRL";

    // ========= LOGICA DE CONFIRMAÇÃO =========

    // 1. Valida e Abre o Popup
    const handlePreCheck = async () => {

      // ✅ TRANCA 1: Aborta se já estiver a abrir o popup ou a salvar
      if (loading || isCheckingRef.current || isSavingRef.current || !clientData) return;
      isCheckingRef.current = true;

      // Validação Tecnologia
      if (technology === "Personalizado" && !customTechnology.trim()) {
          addToast("error", "Tecnologia", "Para 'Personalizado', digite o nome.");
          isCheckingRef.current = false; // destranca
          return;
      }

      if (!clientData.server_id) {
        addToast("error", "Erro", "Cliente está sem servidor vinculado.");
        isCheckingRef.current = false; // destranca
        return;
      }

      const rawPlanPrice = safeNumberFromMoneyBR(planPrice);
      const creditsUsed = creditsInfo?.used ?? 0;
      const isFromTrial = Boolean(allowConvertWithoutPayment);
      const isPaymentFlow = Boolean(registerPayment);

      // Monta o resumo para o popup
      const details: string[] = [];

      const nameToShow = clientData?.display_name || clientName || "—";

      // ✅ NOVO: cliente primeiro (igual você quer no popup)
      details.push(`Cliente: ${nameToShow}`);

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
        // ✅ NOVO: deixa o título com o nome também (fica bem claro)
        title:
          isFromTrial && !isPaymentFlow
            ? `Converter Cliente — ${nameToShow}`
            : `Confirmar Renovação — ${nameToShow}`,
        subtitle: "Confira os dados antes de salvar.",
        tone: isFromTrial && !isPaymentFlow ? "sky" : "emerald",
        icon: isFromTrial && !isPaymentFlow ? "✨" : "💰",
        details,
        confirmText: "Confirmar",
        cancelText: "Voltar",
      });

      if (!ok) {
        isCheckingRef.current = false; // destranca ao cancelar
        return;
      }

      await executeSave();
      isCheckingRef.current = false; // destranca ao terminar
    };

    // 2. Executa a Gravação (Chamado pelo botão "Confirmar" do popup)
  const executeSave = async () => {
    // ✅ TRANCA 2: Aborta imediatamente se já iniciou a gravação
    if (isSavingRef.current) return;
    isSavingRef.current = true;

    setLoading(true);
    setLoadingText("Salvando dados...");

    try {
      let finalTechnology = technology;
      if (technology === "Personalizado") finalTechnology = customTechnology.trim();

      const rawPlanPrice = safeNumberFromMoneyBR(planPrice);
      const monthsToRenew = Number(PLAN_MONTHS[selectedPlanPeriod] ?? 1);
      const tid = await getCurrentTenantId();
      const nameToSend = clientData?.display_name || clientName;

      // ✅ VARIÁVEIS para dados da API
      let apiVencimento = saoPauloDateTimeToIso(dueDate, dueTime); // inicial
      let apiPassword: string | null = null;
      let serverName = "Servidor"; // ✅ DECLARAR AQUI

      // --- PASSO 1: RENOVAÇÃO AUTOMÁTICA (SE MARCADA) ---
if (renewAutomatic && clientData?.server_id) {
  try {
    setLoadingText("Renovando no servidor...");

    // 1.1. Buscar integração
    const { data: srv, error: srvErr } = await supabaseBrowser
      .from("servers")
      .select("panel_integration")
      .eq("id", clientData.server_id)
      .single();

    console.log("🔵 Servidor:", srv, srvErr);

    if (srvErr) {
      throw new Error("Erro ao buscar servidor: " + srvErr.message);
    }

          if (srv?.panel_integration) {
            // 1.2. Buscar provider
            const { data: integ } = await supabaseBrowser
              .from("server_integrations")
              .select("provider")
              .eq("id", srv.panel_integration)
              .single();

            const provider = String(integ?.provider || "").toUpperCase();

            // 1.3. Montar URL da API
            let apiUrl = "";
            if (provider === "FAST") apiUrl = "/api/integrations/fast/renew-client";
            else if (provider === "NATV") apiUrl = "/api/integrations/natv/renew-client";
            else if (provider === "ELITE") apiUrl = "/api/integrations/elite/renew"; // ✅ NOVA ROTA ELITE
            
            if (!apiUrl) throw new Error(`Provedor de integração não suportado: ${provider}`);

            // 1.4. Chamar API
            // ✅ Pegamos o Token da sua sessão logada para não dar 401 Unauthorized
            const { data: userSess } = await supabaseBrowser.auth.getSession();
            const token = userSess?.session?.access_token;

            const apiRes = await fetch(apiUrl, {
              method: "POST",
              headers: { 
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}) // ✅ Envia o crachá
              },
              body: JSON.stringify({
                tenant_id: tid, // ✅ Envia o Tenant
                integration_id: srv.panel_integration,
                username: clientData.username,
                // Manda o ID se tiver, senão manda o nome pro backend caçar!
                external_user_id: clientData.external_user_id || clientData.username, 
                technology: finalTechnology,
                months: monthsToRenew,
              }),
            });

const apiJson = await apiRes.json();

if (!apiRes.ok || !apiJson.ok) {
  const errorMsg = apiJson.error || "A API do Servidor recusou a renovação.";
  throw new Error(errorMsg);
}

            // 1.5. Atualizar com dados da API
            let expDateISO = apiJson.data?.exp_date_iso;
            
            // ✅ SEGUNDA CHANCE ELITE: O painel renovou, mas não deu a data. Vamos pescar!
            if (!expDateISO && provider === "ELITE") {
              setLoadingText("Resgatando data real (Elite)...");
              
              // Delay respiratório de 1.5s
              await new Promise(resolve => setTimeout(resolve, 1500));

              try {
                const syncRes = await fetch("/api/integrations/elite/renew/sync", {
                  method: "POST",
                  headers: { 
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}) 
                  },
                  body: JSON.stringify({
                    integration_id: srv.panel_integration,
                    external_user_id: clientData.external_user_id || clientData.username,
                    username: clientData.username,
                    technology: finalTechnology,
                    tenant_id: tid
                  }),
                });

                const syncJson = await syncRes.json().catch(() => null);
                if (syncRes.ok && syncJson?.ok) {
                  expDateISO = syncJson.expires_at_iso || syncJson.exp_date;
                  
                  // Se o P2P da Elite girou uma senha nova, a gente captura!
                  if (syncJson.password) {
                    apiPassword = syncJson.password;
                  }
                }
              } catch (e) {
                console.warn("⚠️ Falha não crítica no Sync pós-renovação Elite:", e);
              }
            }

            // Define a data final
            if (expDateISO) {
                apiVencimento = expDateISO; // Data absoluta do painel
            } 
            // Se falhar o resgate, cai no fallback seguro: a data que estava na tela do modal.

            // NATV: atualiza senha / FAST: mantém intacta
            if (provider === "NATV" && apiJson.data?.password) {
              apiPassword = apiJson.data.password;
            }

            // 1.6. Sync créditos globais do servidor
            let syncUrl = "";
            if (provider === "FAST") syncUrl = "/api/integrations/fast/sync";
            else if (provider === "NATV") syncUrl = "/api/integrations/natv/sync";
            else if (provider === "ELITE") syncUrl = "/api/integrations/elite/sync";
            
            if (syncUrl) {
              await fetch(syncUrl, {
                method: "POST",
                headers: { 
                  "Content-Type": "application/json",
                  ...(token ? { Authorization: `Bearer ${token}` } : {}) // ✅ Crachá aqui também!
                },
                body: JSON.stringify({ integration_id: srv.panel_integration, tenant_id: tid }),
              });
            }
            // ✅ Buscar nome do servidor
try {
  const { data: srvData } = await supabaseBrowser
    .from("servers")
    .select("name")
    .eq("id", clientData.server_id)
    .single();
  
  serverName = srvData?.name || "Servidor";
} catch {
  serverName = "Servidor";
}

console.log("✅ Renovação automática concluída:", {
  vencimento: apiVencimento,
  senha_atualizada: !!apiPassword,
  servidor: serverName,
});
          }
} catch (apiErr: any) {
  
  // ✅ Toast LOCAL (aparece no modal)
  addToast(
    "error",
    "Falha na Renovação Automática",
    apiErr.message || "Não foi possível renovar no servidor."
  );

  // ✅ Toast na LISTA (aparece depois)
  queueToast(
    "error",
    "Falha na Renovação Automática",
    apiErr.message || "Não foi possível renovar no servidor. Verifique e tente novamente.",
    toastKey
  );

  // Para a execução (não salva nada se API falhar)
  setLoading(false);
  setLoadingText("Processando..."); // ✅ Reseta texto
  return;
}
      }

      // --- PASSO 2: ATUALIZAR CLIENTE ---
      setLoadingText("Atualizando cadastro...");

// ✅ DECISÃO DA DATA: Se for QUALQUER tipo de renovação (manual ou automática)
      // o update_client NUNCA pode alterar a data. O update_client é apenas para notas, planos e tecnologia.
      // A data deve ser alterada APENAS pela RPC renew_client_and_log.
      const dateForUpdate = registerPayment 
          ? clientData?.vencimento // Mantém a data antiga para o banco não dar "choque"
          : apiVencimento;         // Se não for registar pagamento (só converter o trial), aí sim envia a nova.

      const updatePayload: any = {
        p_tenant_id: tid,
        p_client_id: clientId,
        p_display_name: nameToSend,
        p_name_prefix: null,
        p_notes: obs || null,
        p_clear_notes: (!!clientData?.notes && !obs),
        p_server_id: clientData?.server_id,
        p_server_username: clientData?.username,
        p_server_password: apiPassword, // ✅ NATV: atualiza / FAST: null (mantém)
        p_screens: Number(screens),
        p_plan_label: PLAN_LABELS[selectedPlanPeriod],
        p_plan_table_id: selectedTableId || null,
        p_price_amount: rawPlanPrice,
        p_price_currency: currency as any,
        p_vencimento: dateForUpdate, // ✅ Usa a regra definida acima
        p_is_trial: allowConvertWithoutPayment ? false : null,
        p_whatsapp_opt_in: true,
        p_whatsapp_username: null,
        p_whatsapp_snooze_until: null,
        p_is_archived: false,
        p_technology: finalTechnology,
      };

      const { error: updateError } = await supabaseBrowser.rpc("update_client", updatePayload);

      if (updateError) throw new Error(`Erro Update: ${updateError.message}`);

      // --- PASSO 3: RENOVAR (REGISTRAR PAGAMENTO) ---
// ⚠️ SÓ chama renew_client_and_log se MANUAL (não automática)
if (registerPayment && !renewAutomatic) {
  setLoadingText("Registrando pagamento...");

  // ✅ Monta DE / PARA para o log
  const oldVenc = clientData?.vencimento
    ? new Date(clientData.vencimento).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : "—";

  const newVencISO = saoPauloDateTimeToIso(dueDate, dueTime);
  const newVenc = new Date(newVencISO).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

// ✅ MENSAGENS SEPARADAS: Uma limpa para o cliente, outra detalhada para o servidor
  const clientMessageManual = `Renovação manual via painel · ${monthsToRenew} mês(es) · ${screens} tela(s) · ${fmtMoney(currency, rawPlanPrice)}`;
  const serverNotesManual = `Renovação manual via painel · ${nameToSend} (${clientData?.username || "-"}) · ${monthsToRenew} mês(es) · ${screens} tela(s) · ${fmtMoney(currency, rawPlanPrice)}${obs ? ` · Obs: ${obs}` : ""}`;

  const { error: renewError } = await supabaseBrowser.rpc("renew_client_and_log", {
    p_tenant_id: tid,
    p_client_id: clientId,
    p_months: monthsToRenew,
    p_status: "PAID",
    p_notes: serverNotesManual, // ✅ Vai para a view do SERVIDOR (Com nome e obs)
    p_new_vencimento: null,
    p_message: clientMessageManual, // ✅ Vai para a linha do tempo do CLIENTE (Sem nome)
    p_unit_price: Number((totalBrl / monthsToRenew).toFixed(2)),
    p_total_amount: totalBrl,
  });
  if (renewError) throw new Error(`Erro Renew: ${renewError.message}`);
}

// ✅ Se automático, registra LOG + client_renewals
if (registerPayment && renewAutomatic) {
  setLoadingText("Registrando renovação...");

  const oldVenc = clientData?.vencimento
    ? new Date(clientData.vencimento).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : "—";

  const newVenc = new Date(apiVencimento).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

// ✅ MENSAGENS SEPARADAS: Uma limpa para o cliente, outra detalhada para o servidor
  const clientMessageAuto = `Renovação automática via painel · ${monthsToRenew} mês(es) · ${screens} tela(s) · ${fmtMoney(currency, rawPlanPrice)}`;
  const serverNotesAuto = `Renovação automática via painel · ${nameToSend} (${clientData?.username || "-"}) · ${monthsToRenew} mês(es) · ${screens} tela(s) · ${fmtMoney(currency, rawPlanPrice)}${obs ? ` · Obs: ${obs}` : ""}`;

  // ✅ NOVO: registra em client_renewals igual ao manual
  const { error: renewError } = await supabaseBrowser.rpc("renew_client_and_log", {
    p_tenant_id: tid,
    p_client_id: clientId,
    p_months: monthsToRenew,
    p_status: "PAID",
    p_notes: serverNotesAuto, // ✅ Vai para a view do SERVIDOR (Com nome e obs)
    p_new_vencimento: apiVencimento,
    p_message: clientMessageAuto, // ✅ Vai para a linha do tempo do CLIENTE (Sem nome)
    p_unit_price: Number((totalBrl / monthsToRenew).toFixed(2)),
    p_total_amount: totalBrl,
  });
  if (renewError) throw new Error(`Erro Renew: ${renewError.message}`);
}

      // --- PASSO 4: ENVIAR WHATSAPP ---
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
              tenant_id: tid,
              client_id: clientId,
              message: messageContent,
              whatsapp_session: "default",
            }),
          });

          if (!res.ok) throw new Error("API retornou erro");

          queueToast("success", "Mensagem enviada", "Comprovante entregue no WhatsApp.", toastKey);
        } catch (e) {
          console.error("Falha envio Whats:", e);
          queueToast("error", "Erro no envio", "Renovado, mas o WhatsApp falhou.", toastKey);
        }
      }

      // --- FIM ---
setLoadingText("Concluído!");

// ✅ Toast final baseado no tipo de operação
if (renewAutomatic) {
  const isConversion = Boolean(allowConvertWithoutPayment);
  const title = isConversion
    ? `Cliente convertido e renovado no ${serverName}`
    : `Cliente renovado no ${serverName}`;
  const description = isConversion
    ? "Conversão e renovação automática registrada com sucesso."
    : "Renovação automática registrada com sucesso.";

  queueToast("success", title, description, toastKey);
} else {
  queueToast("success", `Cliente renovado manualmente`, "Renovação manual registrada com sucesso.", toastKey);
}

setTimeout(() => {
  onSuccess();
  onClose();
}, 500);

    } catch (err: any) {
      console.error("CRASH:", err);
      addToast("error", "Erro ao salvar", err.message || "Falha desconhecida");
      setLoading(false);
      isSavingRef.current = false; // ✅ Destranca se der erro para permitir tentar novamente
    }
  };

  if (fetching || !mounted) return null; // ✅ Aguarda montagem

    const isFromTrial = Boolean(allowConvertWithoutPayment);
    const headerTitle = isFromTrial ? "Converter em Assinante" : "Renovação de Assinatura";

    // ✅ Wrap com createPortal para renderizar no document.body
    return createPortal(
      <>
        {/* --- MODAL PRINCIPAL --- */}
        <div
          // ✅ LAYOUT: Items-end no mobile (sheet), center no desktop. Sem padding no mobile.
          className="fixed inset-0 z-[99990] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200 overflow-hidden overscroll-contain"
          onClick={onClose}
        >
          <div
            // ✅ Ajuste Max Width e Altura
            className="w-full max-w-lg sm:max-w-2xl bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden min-h-0 max-h-[90vh] transition-all animate-in fade-in zoom-in-95 duration-200"
style={{ maxHeight: "90dvh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* HEADER (MANTÉM IGUAL) */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-slate-50 dark:bg-white/5 rounded-t-xl shrink-0">
              {/* ... conteúdo do header ... */}
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isFromTrial ? 'bg-sky-100 text-sky-600' : 'bg-emerald-100 text-emerald-600'} dark:bg-white/5`}>
                  {isFromTrial ? 
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg> 
                      : 
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                  }
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-800 dark:text-white leading-tight">
                    {headerTitle}
                  </h2>
                  <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-white/50">
                      <span className="font-medium">{clientName}</span>
                  </div>
                </div>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
                <IconX />
              </button>
            </div>

            {/* BODY - ✅ Espaçamento Reduzido (p-3 sm:p-4) */}
            <div
  className="p-3 sm:p-4 space-y-3 sm:space-y-4 overflow-y-auto overscroll-contain custom-scrollbar flex-1 min-h-0"
  style={{ WebkitOverflowScrolling: "touch" }}
>
              
              {/* 1. SEÇÃO VENCIMENTO */}
              <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-xl p-3">
                {/* ... (Conteúdo igual, inputs já estão bons) ... */}
                <div className="flex items-center gap-2 mb-3 border-b border-slate-200 dark:border-white/10 pb-2">
                  <span className="text-emerald-500">📅</span>
                  <span className="text-xs font-bold uppercase text-slate-500 dark:text-white/60 tracking-wider">Novo Vencimento</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label>Data do Vencimento</Label>
                      <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full h-10 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-slate-800 dark:text-white outline-none focus:border-emerald-500 transition-colors text-sm font-medium dark:[color-scheme:dark]" />
                    </div>
                    <div>
                      <Label>Hora Limite</Label>
                      <div className="flex gap-2">
                        <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className="flex-1 h-10 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-slate-800 dark:text-white outline-none focus:border-emerald-500 transition-colors text-sm font-medium dark:[color-scheme:dark]" />
                        <button type="button" onClick={() => setDueTime("23:59")} className="px-3 h-10 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-500 hover:text-emerald-600 hover:border-emerald-500/50 transition-all">23:59</button>
                      </div>
                    </div>
                </div>
              </div>

              {/* 2. SEÇÃO PLANO & FINANCEIRO (Unificado Visualmente ou Estilo Card NovoCliente) */}
              <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-3 sm:p-4 space-y-4">
                  
                  {/* 3. SEÇÃO FINANCEIRO */}
              <div className="bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl p-3 sm:p-4 shadow-sm">
                  
                  {/* HEADER FINANCEIRO - ✅ IGUAL NOVO CLIENTE */}
                  <div className="flex justify-between items-center gap-3 border-b border-slate-100 dark:border-white/5 pb-3 mb-3">
                      <span className="text-xs font-bold uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          💰 Financeiro
                      </span>
                      <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-400 dark:text-white/40 font-bold hidden sm:inline">Tabela:</span>
                          <select 
                              value={selectedTableId} 
                              onChange={(e) => { tableChangedByUserRef.current = true; setSelectedTableId(e.target.value); }} 
                              className="h-6 w-[160px] px-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded text-xs font-bold text-slate-700 dark:text-white outline-none cursor-pointer hover:border-emerald-500/50 transition-all truncate"
                          >
                              {tables.map((t) => <option key={t.id} value={t.id}>{formatTableLabel(t)}</option>)}
                          </select>
                      </div>
                  </div>
                  </div>

                  {/* GRID DE PLANOS */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
<div className="col-span-2 sm:col-span-1">
                          <Label>Período</Label>
                          <Select value={selectedPlanPeriod} onChange={(e) => setSelectedPlanPeriod(e.target.value)}>
                            {Object.entries(PLAN_LABELS)
                              .filter(([k]) => {
                                // ✅ TRAVA NA UI: Se for Elite, esconde a opção Anual
                                if (isEliteProvider && k === "ANNUAL") return false;
                                return true;
                              })
                              .map(([k, v]) => <option key={k} value={k}>{v}</option>)
                            }
                          </Select>
                      </div>
                      <div>
                          <Label>Telas</Label>
                          <Input 
                              type="number" 
                              min={1} 
                              value={screens} 
                              onChange={(e) => {
                                  const val = e.target.value;
                                  setScreens(val === "" ? ("" as any) : Math.max(1, Number(val)));
                              }} 
                              onBlur={() => { if (!screens || Number(screens) < 1) setScreens(1); }}
                          />
                      </div>
                      <div>
                          <Label>Créditos</Label>
                          <div className="h-10 w-full bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 rounded-lg flex items-center justify-center text-sm font-bold text-blue-700 dark:text-blue-300">
                            {creditsInfo ? creditsInfo.used : "-"}
                          </div>
                      </div>
                  </div>

                  {/* GRID DE VALORES */}
                  <div className="grid grid-cols-3 gap-3">
                      <div>
                          <Label>Moeda</Label>
                          <div className="h-10 w-full bg-slate-100 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg flex items-center justify-center text-sm font-bold text-slate-700 dark:text-white">
                              {currency}
                          </div>
                      </div>
                      <div className="col-span-2">
                          <Label>Valor a Cobrar</Label>
                          <Input 
                              value={planPrice} 
                              onChange={(e) => { setPlanPrice(e.target.value); setPriceTouched(true); }} 
                              className="text-right font-bold text-slate-800 dark:text-white text-lg tracking-tight" 
                              placeholder="0,00" 
                          />
                      </div>
                  </div>

                  {/* CÂMBIO (Se houver) */}
                  {showFx && (
                      <div className="p-3 bg-sky-50 dark:bg-sky-500/10 rounded-lg border border-sky-100 dark:border-sky-500/20 grid grid-cols-2 gap-3">
                          <div><Label>Câmbio</Label><input type="number" step="0.0001" value={Number(fxRate || 0).toFixed(4)} onChange={(e) => setFxRate(Number(e.target.value))} className="w-full h-9 px-3 bg-white dark:bg-black/30 border border-sky-200 dark:border-sky-500/20 rounded text-sm outline-none dark:text-white" /></div>
                          <div><Label>Total BRL</Label><div className="w-full h-9 flex items-center justify-center bg-emerald-100 dark:bg-emerald-500/20 border border-emerald-200 dark:border-emerald-500/20 rounded text-emerald-800 dark:text-emerald-200 font-bold">{fmtMoney("BRL", totalBrl)}</div></div>
                      </div>
                  )}

                  {/* BOTÃO REGISTRAR PAGAMENTO */}
                  {Boolean(allowConvertWithoutPayment) && (
                      <div onClick={() => setRegisterPayment(!registerPayment)} className={`cursor-pointer p-2.5 rounded-lg border transition-all flex items-center justify-between ${registerPayment ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/20" : "bg-slate-50 border-slate-200 dark:bg-white/5 dark:border-white/10"}`}>
                          <span className={`text-xs font-bold ${registerPayment ? "text-emerald-700 dark:text-emerald-400" : "text-slate-500"}`}>Registrar Pagamento?</span>
                          <Switch checked={registerPayment} onChange={setRegisterPayment} label="" />
                      </div>
                  )}

                  {registerPayment && (
                      <div className="bg-slate-50 dark:bg-black/20 p-3 rounded-lg border border-slate-100 dark:border-white/5 animate-in slide-in-from-top-2">
                          <div className="grid grid-cols-2 gap-3">
                              <div>
                                  <Label>Método</Label>
                                  <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                                      <option value="PIX">PIX</option>
                                      <option value="Dinheiro">Dinheiro</option>
                                      <option value="Cartão">Cartão</option>
                                  </Select>
                              </div>
                              <div>
                                  <Label>Data Pagto</Label>
                                  <Input type="datetime-local" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="dark:[color-scheme:dark]" />
                              </div>
                          </div>
                      </div>
                  )}
              </div>

              {/* 4. OUTROS + OBS */}
              <div className="space-y-3">
                {/* ... (Bloco de Tecnologia e Notificação mantém, mas com gap-3 e labels ajustados) ... */}
                  {/* ✅ TOGGLE RENOVAÇÃO AUTOMÁTICA (Cliente + Teste) */}
<div 
  onClick={() => hasIntegration && setRenewAutomatic(!renewAutomatic)}
  className={`p-3 rounded-xl border transition-all cursor-pointer ${
    renewAutomatic 
      ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/20" 
      : "bg-slate-50 border-slate-200 dark:bg-white/5 dark:border-white/10"
  } ${!hasIntegration ? "opacity-50 cursor-not-allowed" : ""}`}
>
  <div className="flex items-center justify-between gap-3">
    <div className="flex items-center gap-2">
      <span className="text-lg">{renewAutomatic ? "🔄" : "📝"}</span>
      <div>
        <span className={`text-xs font-bold block ${renewAutomatic ? "text-emerald-700 dark:text-emerald-400" : "text-slate-500"}`}>
          Renovação Automática
        </span>
        <span className="text-[9px] text-slate-400 dark:text-white/40">
          {hasIntegration ? "Sincronizar com servidor" : "Servidor sem integração"}
        </span>
      </div>
    </div>
    <Switch 
      checked={renewAutomatic} 
      onChange={(v) => hasIntegration && setRenewAutomatic(v)} 
      label="" 
    />
  </div>
</div>

<div className={`grid grid-cols-1 ${sendWhats ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-3 items-end`}></div>

                  <div className={`grid grid-cols-1 ${sendWhats ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-3 items-end`}>
                      {/* ... (Inputs de Tecnologia e Toggle Notification igual ao código original, apenas mantenha dentro desse padding reduzido) ... */}
<div>
                          <Label>Tecnologia</Label>
                          {technology === "Personalizado" ? (
                              <div className="flex gap-1">
                                <Input value={customTechnology} onChange={(e) => setCustomTechnology(e.target.value)} placeholder="Digite..." autoFocus />
                                <button onClick={() => { setTechnology("IPTV"); setCustomTechnology(""); }} className="px-3 text-slate-400 hover:text-rose-500 border rounded-lg dark:border-white/10 transition-colors">✕</button>
                              </div>
                          ) : (
                              <Select 
                                value={technology} 
                                onChange={(e) => { const v = e.target.value; if(v==="Personalizado"){setTechnology("Personalizado");setCustomTechnology("");}else setTechnology(v); }}
                                disabled={integrationProvider === "FAST" || integrationProvider === "NATV"}
                                className={integrationProvider === "FAST" || integrationProvider === "NATV" ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}
                              >
                                {integrationProvider === "FAST" || integrationProvider === "NATV" ? (
                                    <option value="IPTV">IPTV</option>
                                ) : integrationProvider === "ELITE" ? (
                                    <>
                                      <option value="IPTV">IPTV</option>
                                      <option value="P2P">P2P</option>
                                    </>
                                ) : (
                                    <>
                                      <option value="IPTV">IPTV</option>
                                      <option value="P2P">P2P</option>
                                      <option value="OTT">OTT</option>
                                      {!["IPTV", "P2P", "OTT", "Personalizado"].includes(technology) && <option value={technology}>{technology}</option>}
                                      <option value="Personalizado">Outro...</option>
                                    </>
                                )}
                              </Select>
                          )}
                      </div>
                      
                      
                      <div onClick={() => setSendWhats(!sendWhats)} className="h-10 px-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-600 dark:text-white/70">Enviar Whats?</span>
                          <Switch checked={sendWhats} onChange={setSendWhats} label="" />
                      </div>

                      {sendWhats && (
                          <div className="animate-in fade-in zoom-in duration-200">
                              <Label>Modelo</Label>
                              <Select value={selectedTemplateId} onChange={(e) => { const id = e.target.value; setSelectedTemplateId(id); const tpl = templates.find(t => t.id === id); if(tpl) setMessageContent(tpl.content); }}>
                                  <option value="">-- Personalizado --</option>
                                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                              </Select>
                          </div>
                      )}
                  </div>

                  {/* OBSERVAÇÕES */}
                  <div>
                      <Label>Observações (Internas)</Label>
                      <textarea value={obs} onChange={(e) => setObs(e.target.value)} className="w-full h-16 px-2.5 py-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 resize-none transition-all" placeholder="Nota interna sobre esta renovação..." />
                  </div>
              </div>

            </div>

            {/* FOOTER */}
            <div className="px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5 flex justify-end gap-3 rounded-b-xl shrink-0">
              <button
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 font-bold text-sm hover:bg-white dark:hover:bg-white/10 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handlePreCheck(); }}
                disabled={loading}
                className="px-8 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 disabled:opacity-80 disabled:cursor-not-allowed transition-all flex items-center gap-2 min-w-[160px] justify-center"
              >
                {loading ? (
                  
  <>
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    {/* ✅ Texto Dinâmico */}
                    {loadingText}
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    {Boolean(allowConvertWithoutPayment) && !registerPayment ? "Converter" : "Confirmar"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ✅ Confirm Dialog Global */}
        {ConfirmUI}

<div className="fixed inset-x-0 top-2 z-[999999] px-3 sm:px-6 pointer-events-none">
  <div className="pointer-events-auto">
    <ToastNotifications
      toasts={toasts}
      removeToast={(id) => setToasts((p) => p.filter((t) => t.id !== id))}
    />
  </div>
</div>
      </>,
      document.body // ✅ Alvo do Portal
    );
  }

  function Label({ children }: { children: React.ReactNode }) {
    return (
      <label className="block text-[9px] font-bold text-slate-400 dark:text-white/40 mb-0.5 uppercase tracking-wider">
        {children}
      </label>
    );
  }

  function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
    return (
      <input
        {...props}
        className={`w-full h-9 px-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 transition-colors dark:[color-scheme:dark] ${className}`}
      />
    );
  }

  function Select({ className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
    return (
      <select
        {...props}
        className={`w-full h-9 px-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 transition-colors ${className}`}
      />
    );
  }

  function IconX() {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
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
        <span className="text-xs text-slate-700 dark:text-white/70">{label}</span>
        <button
          type="button"
          // ✅ CORREÇÃO: Adicionado stopPropagation para evitar conflito com a div pai
          onClick={(e) => {
            e.stopPropagation();
            onChange(!checked);
          }}
          className={`relative w-12 h-7 rounded-full transition-colors border ${
            checked
              ? "bg-emerald-600 border-emerald-600"
              : "bg-slate-200 dark:bg-white/10 border-slate-300 dark:border-white/10"
          }`}
          aria-pressed={checked}
        >
          <span
            className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${
              checked ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
    );
  }
