"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getCurrentTenantId } from "@/lib/tenant";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";




// --- TIPOS ---
type Automation = {
  id: string;
  name: string;
  is_active: boolean;
  is_automatic: boolean;
  type: string;
  schedule_time: string;
  schedule_days: number[];
  
  // Regras
  target_status: string[];
  target_servers: string[];
  target_plans: string[];
  target_apps: string[];
  rule_date_field: string;
  rule_days_diff: number;

  message_template?: { name: string };
  last_run_at: string | null;
  

  // ✅ NOVOS CAMPOS (Para Edição e Controle)
  execution_status?: 'IDLE' | 'RUNNING' | 'PAUSED';
  message_template_id: string; // Obrigatório para o formulário saber qual ID selecionar na edição
  whatsapp_session?: string;
  delay_min?: number;
  delay_max?: number;
};

// Tipo simplificado de cliente para cálculo de impacto
type ClientLight = {
  id: string;
  display_name: string;
  whatsapp_username: string;
  server_id: string;
  plan_label: string;
  vencimento: string | null;
  created_at: string;
  computed_status: string;
  server_name?: string;
  apps_names?: string[]; // ✅ Adicionado para o filtro de aplicativos
};


// ✅ NOVO TIPO: Log de Envio
type LogEntry = {
    id: string;
    client_name: string;
    client_whatsapp: string;
    status: string;
    sent_at: string | null;
    error_message?: string;
};

type SelectOption = { id: string; label: string };

const TYPES = ["Vencimento", "Pós-Venda", "Manutenção", "Divulgação", "Boas Vindas", "Outros"];
const CLIENT_STATUS = [
    { id: "ACTIVE", label: "Ativo" },
    { id: "OVERDUE", label: "Vencido" },
    { id: "TRIAL", label: "Teste" },
    { id: "ARCHIVED", label: "Arquivado" }
];
const DAYS_OF_WEEK = [
  { id: 1, label: "Seg" }, { id: 2, label: "Ter" }, { id: 3, label: "Qua" }, 
  { id: 4, label: "Qui" }, { id: 5, label: "Sex" }, { id: 6, label: "Sáb" }, { id: 0, label: "Dom" }
];

// =====================
// TIMEZONE (SP) + HELPERS (GLOBAL)
// =====================
const BILLING_TZ = "America/Sao_Paulo";

function formatDateTimeSP(input?: string | null): string {
  if (!input) return "Nunca";
  const d = new Date(input);
  if (isNaN(d.getTime())) return "Nunca";
  return d.toLocaleString("pt-BR", { timeZone: BILLING_TZ });
}

function formatDateSP(input?: string | null): string {
  if (!input) return "--";
  let d = new Date(input);
  if (isNaN(d.getTime())) return "--";
  
  // ✅ Blindagem contra shift de timezone em datas YYYY-MM-DD
  if (input.length === 10 && input.includes("-")) {
      d = new Date(`${input}T12:00:00-03:00`);
  }
  return d.toLocaleDateString("pt-BR", { timeZone: BILLING_TZ });
}

function isoDateInSaoPaulo(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: BILLING_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d); // YYYY-MM-DD
}

function getExpectedRunDateSP(baseDateStr: string, daysDiff: number) {
  const dBase = new Date(baseDateStr);
  if (isNaN(dBase.getTime())) return null;

  // Descobre que dia foi em SP a data base
  const baseDateSP = isoDateInSaoPaulo(dBase);
  
  // Força meio dia para somar/subtrair sem bugar por fuso
  const dTarget = new Date(`${baseDateSP}T12:00:00-03:00`);
  dTarget.setDate(dTarget.getDate() + daysDiff);
  
  return isoDateInSaoPaulo(dTarget);
}

// ============================================================================
// PÁGINA PRINCIPAL
// ============================================================================

// =====================
// HELPERS WHATSAPP (UI)
// =====================

function extractWaNumberFromJid(jid?: unknown): string {
  if (typeof jid !== "string") return "";

  // Ex: "5521992347771:9@s.whatsapp.net"
  // 1) remove domínio -> "5521992347771:9"
  // 2) remove device id -> "5521992347771"
  const raw = jid.split("@")[0]?.split(":")[0] ?? "";
  return raw.replace(/\D/g, "");
}

function formatBRPhoneFromDigits(digits: string): string {
  // Esperado BR: 55 + DDD(2) + número(8/9)
  if (!digits) return "";

  if (digits.startsWith("55") && digits.length >= 12) {
    const country = digits.slice(0, 2);
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4); // 8 ou 9 dígitos

    // 9 dígitos: 99999-9999 | 8 dígitos: 9999-9999
    if (rest.length === 9) {
      return `+${country} (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    }
    if (rest.length === 8) {
      return `+${country} (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
    }

    // fallback se vier estranho
    return `+${country} (${ddd}) ${rest}`;
  }

  // fallback internacional
  return `+${digits}`;
}

function buildWhatsAppSessionLabel(profile: any): string {
  if (!profile?.connected) return "Principal (não conectado)";

  const digits = extractWaNumberFromJid(profile?.jid);
  const pretty = formatBRPhoneFromDigits(digits);

  return `Principal • ${pretty || "Conectado"}`;
}


export default function BillingPage() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [clients, setClients] = useState<ClientLight[]>([]); // Todos os clientes para calculo local
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  
  // ✅ MODAIS (Atualizado para suportar Edição e Logs)
  const [wizardState, setWizardState] = useState<{show: boolean, editingRule: Automation | null}>({ show: false, editingRule: null });
  const [impactModalData, setImpactModalData] = useState<{ruleName: string, clients: ClientLight[]} | null>(null);
  const [logsModalData, setLogsModalData] = useState<{ruleId: string, ruleName: string} | null>(null);
  
  const [toasts, setToasts] = useState<ToastMessage[]>([]);




  // Dados auxiliares
const [auxData, setAuxData] = useState<{
  templates: SelectOption[];
  servers: SelectOption[];
  plans: SelectOption[];
  apps: SelectOption[];
  sessions: SelectOption[]; // ✅
}>({ templates: [], servers: [], plans: [], apps: [], sessions: [] });


const addToast = (
  type: "success" | "error",
  title: string,
  msg?: string,
  durationMs = 5000
) => {
  const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  setToasts((p) => [...p, { id, type, title, message: msg, durationMs }]);
};

  const removeToast = (id: number) => setToasts(p => p.filter(t => t.id !== id));

  async function loadData() {
    setLoading(true);
    const tid = await getCurrentTenantId();
    if (!tid) { setLoading(false); return; }


    try {
        const [
  autoRes,
  clientRes,
  msgRes,
  srvRes,
  appRes,
  waProfRes,
] = await Promise.all([
  supabaseBrowser
    .from("billing_automations")
    .select(`*, message_template:message_templates(id, name)`)
    .eq("tenant_id", tid)
    .order("created_at", { ascending: false }),

  
supabaseBrowser
    .from("vw_clients_list_active") // ✅ View oficial corrigida
    .select(`
      id,
      display_name:client_name,
      whatsapp_username,
      server_id,
      server_name,
      plan_label:plan_name,
      vencimento,
      created_at,
      computed_status,
      apps_names
    `) // ✅ apps_names adicionado
    .eq("tenant_id", tid),

  supabaseBrowser.from("message_templates").select("id, name").eq("tenant_id", tid),
  supabaseBrowser.from("servers").select("id, name").eq("tenant_id", tid),
  supabaseBrowser.from("apps").select("id, name").eq("tenant_id", tid),

  fetch("/api/whatsapp/profile", { cache: "no-store" }).then(async (r) => {
    const j = await r.json().catch(() => ({} as any));
    return { ok: r.ok, json: j };
  }),
]);

const autoData = autoRes.data;
const clientData = clientRes.data;


const sessions: SelectOption[] = (() => {
  // se a API falhar, assume desconectado
  if (!waProfRes?.ok) {
    return [{ id: "default", label: "Principal (não conectado)" }];
  }

  const profile = waProfRes.json || {};
  const label = buildWhatsAppSessionLabel(profile);

  return [{ id: "default", label }];
})();




        // Extrai planos únicos dos clientes carregados
        const uniquePlans = Array.from(new Set((clientData || []).map((c: any) => c.plan_label).filter(Boolean)));

        setAuxData({
  templates: msgRes.data?.map((m: any) => ({ id: m.id, label: m.name })) || [],
  servers: srvRes.data?.map((s: any) => ({ id: s.id, label: s.name })) || [],
  plans: uniquePlans.map((p) => ({ id: String(p), label: String(p) })) || [],
  apps: appRes.data?.map((a: any) => ({ id: a.id, label: a.name })) || [],
  sessions, // ✅
});


        // Casting seguro para incluir os novos campos opcionais se vierem do banco
        setAutomations((autoData as any[]) || []);
        setClients(clientData as ClientLight[] || []);

    } catch (error: any) {
        console.error("Erro LoadData:", error);
        addToast("error", "Erro ao carregar", error.message);
    } finally {
        setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  // --- ACTIONS ---
    async function toggleActive(rule: Automation) {
  const tid = await getCurrentTenantId();
  if (!tid) return;

  const nextActive = !rule.is_active;

  // ✅ Se estiver DESATIVANDO e estiver executando algo, para antes
  if (!nextActive) {
    const status = rule.execution_status || "IDLE";
    if (status === "RUNNING" || status === "PAUSED") {
      await handleControl(rule, "STOP");
    }
  }

  const { error } = await supabaseBrowser
    .from("billing_automations")
    .update({ is_active: nextActive })
    .eq("id", rule.id)
    .eq("tenant_id", tid);

  if (!error) {
    setAutomations(prev =>
      prev.map(a => a.id === rule.id ? { ...a, is_active: nextActive } : a)
    );
    addToast("success", nextActive ? "Ativado" : "Desativado", "Status atualizado.");
  } else {
    addToast("error", "Erro", error.message);
  }
}



  async function handleDelete(id: string) {
    if (!confirm("Tem certeza? Essa ação remove a regra e o histórico.")) return;
    const tid = await getCurrentTenantId();
if (!tid) return;

const { error } = await supabaseBrowser
  .from("billing_automations")
  .delete()
  .eq("id", id)
  .eq("tenant_id", tid);


    if (!error) {
        setAutomations(prev => prev.filter(a => a.id !== id));
        addToast("success", "Excluído", "Regra removida.");
    }
  }

// --- CONTROLE DE EXECUÇÃO ---
    async function handleControl(rule: Automation, action: "PLAY" | "PAUSE" | "STOP") {
  const tid = await getCurrentTenantId();
  if (!tid) return;

  // ✅ Segurança: não deixa dar PLAY se a regra estiver desativada
  if (!rule.is_active && action === "PLAY") {
    addToast("error", "Regra desativada", "Ative o toggle para iniciar o envio automático.");
    return;
  }

  // ✅ Segurança: confirmação forte no STOP
  if (action === "STOP") {
    const ok = confirm("PARAR AGORA? Isso deve interromper os envios e cancelar a fila pendente desta regra.");
    if (!ok) return;
  }

  const { error } = await supabaseBrowser.rpc("billing_control_automation", {
    p_tenant_id: tid,
    p_automation_id: rule.id,
    p_action: action,
  });

  if (error) {
    addToast("error", "Erro", error.message);
    return;
  }

  addToast("success", "Status", "Atualizado.");
  await loadData(); // fonte da verdade
}


  // --- LÓGICA DE FILTRO (IMPACTO) ---

  /** Normaliza o status vindo da view para o padrão do sistema */
  function normalizeClientStatus(
    raw: any
  ): "ACTIVE" | "OVERDUE" | "TRIAL" | "ARCHIVED" | string {
    const s = String(raw ?? "").trim().toUpperCase();

    if (["ACTIVE", "OVERDUE", "TRIAL", "ARCHIVED"].includes(s)) return s;

    if (s === "ATIVO") return "ACTIVE";
    if (s === "VENCIDO" || s === "ATRASADO" || s === "INADIMPLENTE") return "OVERDUE";
    if (s === "TESTE") return "TRIAL";
    if (s === "ARQUIVADO") return "ARCHIVED";

    return s;
  }

  function dayOfWeekInTZ(d: Date = new Date(), tz = BILLING_TZ): number {
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
    const map: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    return map[wd] ?? d.getDay();
  }

  function shouldRunToday(rule: Automation): boolean {
    if (!rule.is_automatic) return true;

    const todayDow = dayOfWeekInTZ(new Date(), BILLING_TZ);
    const days = Array.isArray(rule.schedule_days) ? rule.schedule_days : [];
    if (days.length === 0) return true; 
    return days.includes(todayDow);
  }

  function normalizeRuleDateField(raw: any): "vencimento" | "created_at" {
    const s = String(raw ?? "").trim().toLowerCase();
    if (s === "vencimento") return "vencimento";
    if (s === "cadastro") return "created_at";
    if (s === "created_at") return "created_at";
    return "created_at";
  }

  const getImpactedClients = (rule: Automation): ClientLight[] => {
    if (!shouldRunToday(rule)) return [];

    // ✅ Hoje exato em São Paulo
    const todaySP = isoDateInSaoPaulo(new Date());

    const ruleStatuses = rule.target_status?.length
      ? rule.target_status.map(normalizeClientStatus)
      : null;

    return clients.filter((client) => {
      // 1) STATUS
      const clientStatus = normalizeClientStatus(client.computed_status);
      if (ruleStatuses?.length) {
        if (!ruleStatuses.includes(clientStatus)) return false;
      }

      // 2) SERVIDOR
      if (rule.target_servers?.length) {
        if (!rule.target_servers.includes(client.server_id)) return false;
      }

      // 3) PLANO
      if (rule.target_plans?.length) {
        const plan = String(client.plan_label ?? "");
        if (!rule.target_plans.includes(plan)) return false;
      }
      
      // 4) APLICATIVOS
      if (rule.target_apps?.length) {
        const clientApps = client.apps_names || [];
        const hasApp = clientApps.some(app => rule.target_apps.includes(app));
        if (!hasApp) return false;
      }

      // 5) DATA (Fuso horário garantido SP)
      const field = normalizeRuleDateField(rule.rule_date_field);
      const targetDateStr = field === "vencimento" ? client.vencimento : client.created_at;
      if (!targetDateStr) return false;

      // Usando a nova função SP
      const expectedRunDate = getExpectedRunDateSP(targetDateStr, Number(rule.rule_days_diff));
      
      return expectedRunDate === todaySP;
    });
  };

  const impactedByRule = useMemo(() => {
    const map = new Map<string, ClientLight[]>();
    for (const r of automations) {
      map.set(r.id, getImpactedClients(r));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automations, clients]);


  const handleManualRun = async (rule: Automation) => {
  // ✅ Segurança: não deixa disparar manual se a regra estiver desativada
  if (!rule.is_active) {
    addToast("error", "Regra desativada", "Ative o toggle para usar o envio manual.");
    return;
  }

  const affected = getImpactedClients(rule);
  if (affected.length === 0) {
    addToast("error", "Sem alvos", "Nenhum cliente atende a regra hoje.");
    return;
  }

  if (!confirm(`Deseja ENFILEIRAR AGORA para ${affected.length} clientes?`)) return;

  const tid = await getCurrentTenantId();
  if (!tid) return;

  const { data, error } = await supabaseBrowser.rpc("billing_enqueue_now", {
    p_tenant_id: tid,
    p_automation_id: rule.id,
  });

  if (error) {
    addToast("error", "Erro ao enfileirar", error.message);
    return;
  }

  addToast("success", "Envio Manual", `${data || 0} mensagens enfileiradas.`);

  // ✅ Recarrega do banco pra refletir "RUNNING" caso o backend marque
  await loadData();
};



  const filtered = automations.filter(a => a.name.toLowerCase().includes(search.toLowerCase()));

return (
  <div className="space-y-6 pt-3 pb-6 px-3 sm:px-6 bg-slate-50 dark:bg-[#0f141a] transition-colors">

      {/* HEADER */}
<div className="flex flex-col md:flex-row justify-between items-start gap-3">

  {/* Título esquerda */}
  <div className="text-left">
    <h1 className="text-2xl font-bold text-slate-800 dark:text-white">
      Automação de Cobranças
    </h1>

    <p className="text-slate-500 dark:text-white/60 text-sm mt-1">
      Gerencie suas regras de envio automático.
    </p>
  </div>

  {/* Ações direita */}
  <div className="flex gap-3 w-full md:w-auto justify-end">

    <div className="relative flex-1 min-w-[180px] md:w-72">
      <input 
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar regra..."
        className="w-full h-11 pl-4 pr-10 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#161b22] text-sm outline-none focus:border-emerald-500 transition-colors dark:text-white"
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
        🔍
      </span>
    </div>

    <button
      onClick={() => setWizardState({ show: true, editingRule: null })}
      className="h-11 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2"
    >
      <span className="text-xl leading-none">+</span>
      Nova Regra
    </button>

  </div>
</div>


      {/* LISTA (GRID 3 COLUNAS) */}
      {loading ? (
         <div className="text-center py-10 text-slate-400 animate-pulse">Carregando automações...</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-[#161b22] border border-dashed border-slate-300 dark:border-white/10 rounded-2xl">
           <div className="w-16 h-16 bg-slate-100 dark:bg-white/5 rounded-full flex items-center justify-center mb-4 text-3xl">🤖</div>
           <h3 className="text-lg font-bold text-slate-700 dark:text-white">Nenhuma regra ativa</h3>
           <p className="text-sm text-slate-500 dark:text-white/50 mt-1">Crie sua primeira automação de cobrança.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">

           {filtered.map((auto) => {
  const impacted = impactedByRule.get(auto.id) ?? [];
  return (
    <AutomationCard 
      key={auto.id} 
      data={auto}
      impactCount={impacted.length}
      onToggle={() => toggleActive(auto)}
      onDelete={() => handleDelete(auto.id)}
      onEdit={() => setWizardState({ show: true, editingRule: auto })}
      onShowImpact={() => setImpactModalData({ ruleName: auto.name, clients: impacted })}
      onControl={(action) => handleControl(auto, action)}
      onShowLogs={() => setLogsModalData({ ruleId: auto.id, ruleName: auto.name })}
      onRun={() => handleManualRun(auto)}
    />
  );
})}

        </div>
      )}

      {/* WIZARD COM EDIÇÃO */}
      {wizardState.show && (
        <AutomationWizard 
            auxData={auxData}
            editingRule={wizardState.editingRule} // ✅ Passa a regra
            onClose={() => setWizardState({ show: false, editingRule: null })}
            onSuccess={() => { setWizardState({ show: false, editingRule: null }); loadData(); addToast("success", "Salvo", "Regra atualizada."); }}
            onError={(msg) => addToast("error", "Erro", msg)}
        />
      )}

      {/* MODAL DE IMPACTO (LISTA DE CLIENTES) */}
      {impactModalData && (
          <ImpactListModal 
            data={impactModalData} 
            onClose={() => setImpactModalData(null)} 
          />
      )}

      {logsModalData && (
        <LogsModal
            ruleId={logsModalData.ruleId}
            ruleName={logsModalData.ruleName}
            onClose={() => setLogsModalData(null)}
        />
        )}

      <div className="relative z-[999999]">
        <ToastNotifications toasts={toasts} removeToast={removeToast} />
      </div>
    </div>
  );
}


// ============================================================================
// CARD COMPACTO (3 POR LINHA) - CORRIGIDO
// ============================================================================
function AutomationCard({ 
    data, 
    impactCount, 
    onToggle, 
    onDelete, 
    onShowImpact, 
    onRun, 
    // ✅ Adicionadas as props que faltavam na chamada do componente pai
    onEdit, 
    onControl, 
    onShowLogs 
}: any) {
    
    const getRuleText = () => {
        if (data.rule_days_diff === 0) return "No dia do vencimento";
        const dayText = Math.abs(data.rule_days_diff) === 1 ? 'dia' : 'dias';
        if (data.rule_days_diff > 0) return `${data.rule_days_diff} ${dayText} APÓS vencimento`;
        return `${Math.abs(data.rule_days_diff)} ${dayText} ANTES vencimento`;
    };

    // ✅ Pega o status real do banco (ou assume IDLE se nulo)
    const status = data.execution_status || 'IDLE';

    return (
        <div className={`bg-white dark:bg-[#161b22] border rounded-xl p-4 sm:p-5 shadow-sm hover:shadow-lg transition-all flex flex-col justify-between h-full relative overflow-hidden group ${data.is_active ? 'border-t-4 border-t-emerald-500 border-x-slate-200 border-b-slate-200 dark:border-white/10' : 'border-slate-200 dark:border-white/10 opacity-75 grayscale-[0.8] hover:grayscale-0'}`}>
            
            {/* Header: Nome e Toggle */}
            <div className="flex justify-between items-start mb-3">
                <div className="flex-1 pr-2">
                    <h3 className="font-bold text-slate-800 dark:text-white text-base line-clamp-1" title={data.name}>{data.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-500 uppercase border border-slate-200 dark:border-white/10 tracking-wider">{data.type}</span>
                        <span className={`text-[10px] font-bold ${data.is_automatic ? 'text-purple-500' : 'text-amber-500'}`}>
                            {data.is_automatic ? 'AUTO' : 'MANUAL'}
                        </span>
                        {/* ✅ VISUAL DO STATUS (Se estiver rodando, mostra aqui) */}
                        {status === "RUNNING" && (
                        <span className="text-[10px] font-bold text-white bg-emerald-500 px-1.5 py-0.5 rounded animate-pulse">
                            EXECUTANDO {data.is_automatic ? "AUTO" : "MANUAL"}
                        </span>
                        )}

                        {status === "PAUSED" && (
                        <span className="text-[10px] font-bold text-white bg-amber-500 px-1.5 py-0.5 rounded">
                            PAUSADO {data.is_automatic ? "AUTO" : "MANUAL"}
                        </span>
                        )}


                    </div>
                </div>
                <button 
                    onClick={onToggle}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${data.is_active ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-white/20'}`}
                >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${data.is_active ? 'translate-x-4.5' : 'translate-x-1'}`} />
                </button>
            </div>

            {/* Info do Disparo */}
            <div className="space-y-2 mb-4 bg-slate-50 dark:bg-black/20 p-3 rounded-lg border border-slate-100 dark:border-white/5">
                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-white/70">
                    <span className="text-base">📅</span>
                    <span className="font-medium">{getRuleText()}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-white/70">
                    <span className="text-base">💬</span>
                    <span className="truncate max-w-[200px]" title={data.message_template?.name}>{data.message_template?.name || "Sem mensagem"}</span>
                </div>
                {data.is_automatic && (
                    <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-white/70">
                        <span className="text-base">⏰</span>
                        <span>Envio às <strong>{data.schedule_time?.slice(0, 5)}</strong></span>
                    </div>
                )}
            </div>

            {/* Métricas e Botões */}
            <div className="mt-auto">
                <div className="flex justify-between items-end border-t border-slate-100 dark:border-white/5 pt-3">
                    
                    {/* Botão de Impacto (Clicável) */}
                    <div 
                        onClick={onShowImpact}
                        className="cursor-pointer group/impact"
                        title="Clique para ver os clientes"
                    >
                        <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Afetados Hoje</div>
                        <div className="text-xl font-bold text-slate-800 dark:text-white group-hover/impact:text-emerald-500 transition-colors flex items-center gap-1">
                            {impactCount} 
                            <span className="text-xs text-slate-400 font-normal group-hover/impact:text-emerald-400">clientes</span>
                        </div>
                    </div>

                    <div className="text-right">
                    <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">Ações</div>

                    <div className="flex flex-wrap gap-2 justify-end">
                    {/* =========================
                        1) AUTO: botão vira "Ativar automático" / "Cancelar automático"
                        ========================= */}
                    {data.is_automatic && (
                        <>
                        {status !== "RUNNING" ? (
                            <button
                            onClick={() => onControl("PLAY")}
                            disabled={!data.is_active}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors
                                ${data.is_active
                                ? "bg-emerald-600 text-white hover:bg-emerald-500"
                                : "bg-slate-200 text-slate-400 cursor-not-allowed dark:bg-white/10 dark:text-white/30"
                                }`}
                            title="Ativa a execução automática (dias/horário configurados)"
                            >
                            Ativar automático
                            </button>
                        ) : (
                            <button
                            onClick={() => onControl("STOP")}
                            disabled={!data.is_active}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors
                                ${data.is_active
                                ? "bg-rose-600 text-white hover:bg-rose-500"
                                : "bg-slate-200 text-slate-400 cursor-not-allowed dark:bg-white/10 dark:text-white/30"
                                }`}
                            title="Cancela a execução automática (mantém a regra ativa no toggle)"
                            >
                            Cancelar automático
                            </button>
                        )}
                        </>
                    )}

                    {/* =========================
                        2) MANUAL: sempre disponível (se toggle ON)
                            (mesmo se AUTO estiver RUNNING)
                        ========================= */}
                    <button
                        onClick={onRun}
                        disabled={!data.is_active}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors
                        ${data.is_active
                            ? "bg-sky-600 text-white hover:bg-sky-500"
                            : "bg-slate-200 text-slate-400 cursor-not-allowed dark:bg-white/10 dark:text-white/30"
                        }`}
                        title="Dispara agora (enfileira imediatamente)"
                    >
                        Envio Manual
                    </button>

                    {/* =========================
                        3) CONTROLES DE PAUSA/STOP: só para MANUAL (não para AUTO)
                        ========================= */}
                    {!data.is_automatic && status === "RUNNING" && (
                        <>
                        <button
                            onClick={() => onControl("PAUSE")}
                            className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold hover:brightness-110 transition"
                            title="Pausar envios imediatamente"
                        >
                            Pausar
                        </button>

                        <button
                            onClick={() => onControl("STOP")}
                            className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-500 transition"
                            title="Parar agora e cancelar fila pendente"
                        >
                            Parar agora
                        </button>
                        </>
                    )}

                    {!data.is_automatic && status === "PAUSED" && (
                        <>
                        <button
                            onClick={() => onControl("PLAY")}
                            disabled={!data.is_active}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors
                            ${data.is_active
                                ? "bg-emerald-600 text-white hover:bg-emerald-500"
                                : "bg-slate-200 text-slate-400 cursor-not-allowed dark:bg-white/10 dark:text-white/30"
                            }`}
                            title="Retomar envios"
                        >
                            Retomar
                        </button>

                        <button
                            onClick={() => onControl("STOP")}
                            className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-500 transition"
                            title="Cancelar pendências e parar"
                        >
                            Parar agora
                        </button>
                        </>
                    )}

                    {/* Secundários */}
                    <button
                        onClick={onEdit}
                        className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-xs font-bold hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 transition"
                        title="Editar"
                    >
                        Editar
                    </button>

                    <button
                        onClick={onShowLogs}
                        className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200 dark:bg-white/10 dark:text-white/70 transition"
                        title="Logs"
                    >
                        Logs
                    </button>

                    <button
                        onClick={onDelete}
                        className="px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 text-xs font-bold hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-300 transition"
                        title="Excluir"
                    >
                        Excluir
                    </button>
                    </div>

                    </div>

                </div>
                
                {/* Data Ultimo Envio */}
                    <div className="mt-2 text-[9px] text-center text-slate-400">
                    Último envio: {formatDateTimeSP(data.last_run_at)}
                    </div>

            </div>
        </div>
    );
}

// ============================================================================
// MODAL DE IMPACTO (LISTA DE CLIENTES)
// ============================================================================
function ImpactListModal({ data, onClose }: { data: {ruleName: string, clients: ClientLight[]}, onClose: () => void }) {
    // ✅ PROTEÇÃO SSR: Evita erro "document is not defined"
    if (typeof document === "undefined") return null;

    return createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-2xl bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[80vh]">
                <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 flex justify-between items-center bg-slate-50 dark:bg-white/5">
                    <div>
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white">Clientes Afetados Hoje</h3>
                        <p className="text-xs text-slate-500">Regra: <strong>{data.ruleName}</strong> • Total: <strong>{data.clients.length}</strong></p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-800 dark:hover:text-white">✕</button>
                </div>

                <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                    {data.clients.length === 0 ? (
                        <div className="p-10 text-center text-slate-400 italic">Nenhum cliente atende a esta regra hoje.</div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-50 dark:bg-white/5 sticky top-0 z-10 text-xs uppercase text-slate-500 dark:text-white/40 font-bold">
                                <tr>
                                    <th className="p-3">Cliente</th>
                                    <th className="p-3">WhatsApp</th>
                                    <th className="p-3">Vencimento</th>
                                    <th className="p-3">Plano</th>
                                </tr>
                            </thead>
                            <tbody className="text-sm text-slate-700 dark:text-white/80 divide-y divide-slate-100 dark:divide-white/5">
                                {data.clients.map(c => (
                                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                                        <td className="p-3 font-bold">{c.display_name}</td>
                                        <td className="p-3 font-mono text-xs">{c.whatsapp_username}</td>
                                        <td className="p-3">{formatDateSP(c.vencimento)}</td>

                                        <td className="p-3"><span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-white/10 text-xs">{c.plan_label}</span></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 flex justify-end">
                    <button onClick={onClose} className="px-5 py-2 rounded-lg bg-slate-800 text-white font-bold text-xs uppercase hover:bg-slate-700 transition-colors">Fechar</button>
                </div>
            </div>
        </div>,
        document.body
    );
}

// ============================================================================
// WIZARD DE CRIAÇÃO (MANTIDO E OTIMIZADO)
// ============================================================================
function AutomationWizard({ auxData, editingRule, onClose, onSuccess, onError }: { auxData: any, editingRule?: any, onClose: () => void, onSuccess: () => void, onError: (m:string) => void }) {
    // ✅ PROTEÇÃO SSR
    if (typeof document === "undefined") return null;

    const [step, setStep] = useState(1);
    const [saving, setSaving] = useState(false);
    
    const [form, setForm] = useState({
        name: "",
        type: "Vencimento",
        message_template_id: "",
        whatsapp_session: "default",
        delay_min: 15,
        delay_max: 60,
        
        is_active: true,
        
        status: ["ACTIVE"],
        servers: [] as string[],
        plans: [] as string[],
        apps: [] as string[],
        
        rule_date_field: "vencimento",
        rule_days_diff: -3,

        is_automatic: true,
        schedule_time: "10:00",
        schedule_days: [1,2,3,4,5]
    });

    // ✅ EFEITO PARA PREENCHER DADOS NA EDIÇÃO
    useEffect(() => {
        if (editingRule) {
            setForm({
                name: editingRule.name,
                type: editingRule.type,
                // Tenta pegar o ID direto ou do objeto aninhado se vier do join
                message_template_id: editingRule.message_template_id || editingRule.message_template?.id || "",
                whatsapp_session: editingRule.whatsapp_session || "default",
                delay_min: editingRule.delay_min || 15,
                delay_max: editingRule.delay_max || 60,
                is_active: editingRule.is_active,
                is_automatic: editingRule.is_automatic,
                status: editingRule.target_status || [],
                servers: editingRule.target_servers || [],
                plans: editingRule.target_plans || [],
                apps: editingRule.target_apps || [],
                rule_date_field:
  (editingRule.rule_date_field === "cadastro"
    ? "created_at"
    : editingRule.rule_date_field) || "vencimento",

                rule_days_diff: editingRule.rule_days_diff,
                schedule_time: editingRule.schedule_time || "10:00",
                schedule_days: editingRule.schedule_days || [1,2,3,4,5]
            });
        }
    }, [editingRule]);

    const handleSave = async () => {
        if (!form.name || !form.message_template_id) {
            setStep(1);
            setTimeout(() => onError("Preencha o Nome e escolha uma Mensagem."), 200);
            return;
        }

        setSaving(true);
        try {
            const tid = await getCurrentTenantId();
if (!tid) throw new Error("Sessão inválida.");

const payload = {
  tenant_id: tid,
  name: form.name,
  type: form.type,
  is_active: form.is_active,
  is_automatic: form.is_automatic,

  message_template_id: form.message_template_id,
  whatsapp_session: form.whatsapp_session,
  delay_min: form.delay_min,
  delay_max: form.delay_max,

  target_status: form.status,
  target_servers: form.servers,
  target_plans: form.plans,
  target_apps: form.apps,

  rule_date_field: form.rule_date_field === "cadastro" ? "created_at" : form.rule_date_field,

  rule_days_diff: form.rule_days_diff,

  schedule_time: form.schedule_time,
  schedule_days: form.schedule_days,
};


let error;
if (editingRule?.id) {
  const { error: updErr } = await supabaseBrowser
    .from("billing_automations")
    .update(payload)
    .eq("id", editingRule.id)
    .eq("tenant_id", tid);
  error = updErr;
} else {
  const { error: insErr } = await supabaseBrowser
    .from("billing_automations")
    .insert(payload);
  error = insErr;
}

if (error) throw error;


            if (error) throw error;
            onSuccess();
        } catch (e: any) {
            console.error(e);
            onError(e.message || "Erro ao salvar no banco.");
        } finally {
            setSaving(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-2xl bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
                <div className="px-6 py-5 border-b border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold text-slate-800 dark:text-white">
                            {editingRule ? `Editar: ${editingRule.name}` : (step === 1 ? "1. Configuração Básica" : step === 2 ? "2. Quem vai receber?" : "3. Quando enviar?")}
                        </h2>
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-800 transition-colors">✕</button>
                    </div>
                    <div className="h-1.5 w-full bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden flex">
                        <div className={`h-full bg-emerald-500 transition-all duration-300 ${step === 1 ? 'w-1/3' : step === 2 ? 'w-2/3' : 'w-full'}`} />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                    {step === 1 && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2 md:col-span-1">
                                    <Label>Nome da Cobrança</Label>
                                    <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Ex: Aviso Vencimento" autoFocus />
                                </div>
                                <div className="col-span-2 md:col-span-1">
                                    <Label>Tipo</Label>
                                    <Select value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
                                        {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                    </Select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2 md:col-span-1">
                                    <Label>Mensagem</Label>
                                    <Select value={form.message_template_id} onChange={e => setForm({...form, message_template_id: e.target.value})}>
                                        <option value="">Selecione...</option>
                                        {auxData.templates.map((t:any) => <option key={t.id} value={t.id}>{t.label}</option>)}
                                    </Select>
                                </div>
                                <div className="col-span-2 md:col-span-1">
                                    <Label>Sessão WhatsApp</Label>
<Select
  value={form.whatsapp_session}
  onChange={(e) => setForm({ ...form, whatsapp_session: e.target.value })}
>
  {(auxData.sessions?.length ? auxData.sessions : [{ id: "default", label: "Principal" }]).map((s: any) => (
    <option key={s.id} value={s.id}>
      {s.label}
    </option>
  ))}
</Select>

                                </div>
                            </div>

                            <div>
                                <Label>Segurança (Intervalo entre envios)</Label>
                                <div className="flex items-center gap-3 bg-slate-50 dark:bg-white/5 p-3 rounded-lg border border-slate-100 dark:border-white/5 mt-1">
                                    <span className="text-xs text-slate-500">Entre</span>
                                    <input type="number" className="w-16 h-8 text-center rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-sm" value={form.delay_min} onChange={e => setForm({...form, delay_min: Number(e.target.value)})} />
                                    <span className="text-xs text-slate-500">e</span>
                                    <input type="number" className="w-16 h-8 text-center rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-sm" value={form.delay_max} onChange={e => setForm({...form, delay_max: Number(e.target.value)})} />
                                    <span className="text-xs text-slate-500">segundos</span>
                                </div>
                            </div>

                            <div className="pt-2 border-t border-slate-100 dark:border-white/5">
                                <Label>Regra de Disparo</Label>
                                <div className="flex items-center gap-2 mt-2 bg-emerald-50/50 dark:bg-emerald-500/5 p-3 rounded-lg border border-emerald-100 dark:border-emerald-500/20">
                                    <span className="text-sm text-slate-600 dark:text-white">Enviar</span>
                                    <div className="flex items-center">
                                        <button onClick={() => setForm({...form, rule_days_diff: -Math.abs(form.rule_days_diff || 1)})} className={`px-2 py-1 rounded-l border text-xs font-bold ${form.rule_days_diff < 0 ? 'bg-rose-500 text-white border-rose-500' : 'bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-500'}`}>Antes</button>
                                        <button onClick={() => setForm({...form, rule_days_diff: 0})} className={`px-2 py-1 border-t border-b text-xs font-bold ${form.rule_days_diff === 0 ? 'bg-sky-500 text-white border-sky-500' : 'bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-500'}`}>No Dia</button>
                                        <button onClick={() => setForm({...form, rule_days_diff: Math.abs(form.rule_days_diff || 1)})} className={`px-2 py-1 rounded-r border text-xs font-bold ${form.rule_days_diff > 0 ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-500'}`}>Depois</button>
                                    </div>
                                    {form.rule_days_diff !== 0 && (
                                        <input type="number" className="w-14 h-8 text-center rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-sm font-bold" value={Math.abs(form.rule_days_diff)} onChange={e => setForm({...form, rule_days_diff: Number(e.target.value) * (form.rule_days_diff < 0 ? -1 : 1)})} />
                                    )}
                                    <span className="text-sm text-slate-600 dark:text-white">{form.rule_days_diff !== 0 ? 'dias do' : 'do'}</span>
                                    <select
  className="h-8 rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-sm px-2 outline-none"
  value={form.rule_date_field}
  onChange={(e) => setForm({ ...form, rule_date_field: e.target.value })}
>
  <option value="vencimento">Vencimento</option>
  <option value="created_at">Cadastro</option>
</select>

                                </div>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-6">
                            <p className="text-sm text-slate-500 dark:text-white/60 mb-4">Selecione quem receberá esta mensagem. Deixe vazio para "Todos".</p>
                            <MultiSelectDropdown label="Status do Cliente" options={CLIENT_STATUS} selected={form.status} onChange={(v:any) => setForm({...form, status: v})} />
                            <MultiSelectDropdown label="Servidores" options={auxData.servers} selected={form.servers} onChange={(v:any) => setForm({...form, servers: v})} />
                            <MultiSelectDropdown label="Planos" options={auxData.plans} selected={form.plans} onChange={(v:any) => setForm({...form, plans: v})} />
                            <MultiSelectDropdown label="Aplicativos" options={auxData.apps} selected={form.apps} onChange={(v:any) => setForm({...form, apps: v})} />
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-8 py-4">
                            <div className="flex flex-col items-center gap-4">
                                <span className="text-sm font-bold text-slate-500 dark:text-white/60 uppercase tracking-widest">Modo de Operação</span>
                                <div className="flex items-center gap-4 bg-slate-100 dark:bg-white/5 p-1 rounded-xl">
                                    <button onClick={() => setForm({...form, is_automatic: false})} className={`px-6 py-3 rounded-lg text-sm font-bold transition-all ${!form.is_automatic ? 'bg-white dark:bg-slate-700 shadow-md text-slate-800 dark:text-white' : 'text-slate-400 hover:text-slate-600'}`}>Manual</button>
                                    <button onClick={() => setForm({...form, is_automatic: true})} className={`px-6 py-3 rounded-lg text-sm font-bold transition-all ${form.is_automatic ? 'bg-white dark:bg-slate-700 shadow-md text-emerald-600 dark:text-emerald-400' : 'text-slate-400 hover:text-slate-600'}`}>Automático</button>
                                </div>
                            </div>
                            {form.is_automatic && (
                                <div className="bg-slate-50 dark:bg-white/5 p-6 rounded-2xl border border-slate-100 dark:border-white/5 space-y-6 animate-in fade-in slide-in-from-bottom-4">
                                    <div>
                                        <Label>Horário do Disparo (Brasília)</Label>
                                        <div className="flex justify-center mt-2">
                                            <input type="time" value={form.schedule_time} onChange={e => setForm({...form, schedule_time: e.target.value})} className="text-3xl font-bold bg-transparent border-b-2 border-emerald-500 text-center w-32 outline-none text-slate-800 dark:text-white" />
                                        </div>
                                    </div>
                                    <div>
                                        <Label>Dias da Semana</Label>
                                        <div className="flex justify-center gap-2 mt-3">
                                            {DAYS_OF_WEEK.map((d) => {
                                                const selected = form.schedule_days.includes(d.id);
                                                return (
                                                    <button key={d.id} onClick={() => { const current = form.schedule_days; setForm({...form, schedule_days: current.includes(d.id) ? current.filter(x => x !== d.id) : [...current, d.id]}); }} className={`w-10 h-10 rounded-full font-bold text-xs transition-all border ${selected ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-500/30' : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-400'}`}>{d.label}</button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 flex justify-between items-center">
                    {step === 1 && (<><button onClick={onClose} className="text-slate-500 font-bold text-xs uppercase hover:text-slate-800 dark:hover:text-white">Cancelar</button><button onClick={() => setStep(2)} className="px-6 py-2.5 bg-slate-800 dark:bg-white dark:text-slate-900 text-white font-bold rounded-xl shadow-lg hover:brightness-110 transition-all text-xs uppercase">Próximo: Filtros →</button></>)}
                    {step === 2 && (<><button onClick={() => setStep(1)} className="text-slate-500 font-bold text-xs uppercase hover:text-slate-800 dark:hover:text-white">← Voltar</button><button onClick={() => setStep(3)} className="px-6 py-2.5 bg-slate-800 dark:bg-white dark:text-slate-900 text-white font-bold rounded-xl shadow-lg hover:brightness-110 transition-all text-xs uppercase">Próximo: Automação →</button></>)}
                    {step === 3 && (<><button onClick={() => setStep(2)} className="text-slate-500 font-bold text-xs uppercase hover:text-slate-800 dark:hover:text-white">← Voltar</button><button onClick={handleSave} disabled={saving} className="px-8 py-2.5 bg-emerald-600 text-white font-bold rounded-xl shadow-lg shadow-emerald-900/20 hover:bg-emerald-500 transition-all text-xs uppercase disabled:opacity-50">{saving ? "Salvando..." : "Confirmar e Criar"}</button></>)}
                </div>
            </div>
        </div>,
        document.body
    );
}

function Label({ children }: { children: React.ReactNode }) { return <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">{children}</label>; }
function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`h-10 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500 transition-colors ${className}`} />; }
function Select({ className = "", children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={`h-10 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500 transition-colors ${className}`}>{children}</select>; }

// ✅ MULTI-SELECT DROPDOWN SIMPLIFICADO E BLINDADO
function MultiSelectDropdown({ label, options, selected, onChange }: any) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<any>(null); // ✅ any para evitar erro de tipo

    useEffect(() => {
        // ✅ Proteção SSR para não quebrar no servidor
        if (typeof document === "undefined") return;

        function handleClickOutside(event: any) {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const toggleOption = (id: string) => {
        if (selected.includes(id)) onChange(selected.filter((x: any) => x !== id));
        else onChange([...selected, id]);
    };

    const getLabel = () => {
        if (selected.length === 0) return "Todos (Sem filtro)";
        if (selected.length === 1) return options.find((o: any) => o.id === selected[0])?.label || selected[0];
        return `${selected.length} selecionados`;
    };

    return (
        <div className="relative" ref={containerRef}>
            <Label>{label}</Label>
            <button 
                onClick={() => setOpen(!open)}
                className={`w-full h-10 px-3 text-left rounded-lg border text-sm flex justify-between items-center transition-all ${open ? 'border-emerald-500 ring-1 ring-emerald-500/20' : 'border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-slate-700 dark:text-white'}`}
            >
                <span className={selected.length === 0 ? "text-slate-400 italic" : "font-medium"}>{getLabel()}</span>
                <span className="text-xs text-slate-400">▼</span>
            </button>

            {open && (
                <div className="absolute z-50 mt-1 w-full bg-white dark:bg-[#1c2128] border border-slate-200 dark:border-white/10 rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 flex flex-col">
                    <div className="max-h-48 overflow-y-auto custom-scrollbar p-1">
                        {options.map((opt: any) => (
                            <div 
                                key={opt.id} 
                                onClick={() => toggleOption(opt.id)}
                                className="px-3 py-2 hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer flex items-center gap-3 transition-colors rounded-lg"
                            >
                                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${selected.includes(opt.id) ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 dark:border-white/20'}`}>
                                    {selected.includes(opt.id) && <span className="text-[10px] text-white">✓</span>}
                                </div>
                                <span className="text-sm text-slate-700 dark:text-white">{opt.label}</span>
                            </div>
                        ))}
                    </div>
                    {/* ✅ BOTÃO CONCLUIR */}
                    <div className="p-2 border-t border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5">
                        <button 
                            onClick={() => setOpen(false)}
                            className="w-full py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase transition-colors"
                        >
                            Concluir
                        </button>
                    </div>
                </div>
            )}

            {selected.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                    {selected.map((id: string) => {
                        const label = options.find((o: any) => o.id === id)?.label || id;
                        return (
                            <span key={id} className="inline-flex items-center px-2 py-1 rounded bg-slate-100 dark:bg-white/10 text-xs font-bold text-slate-600 dark:text-white border border-slate-200 dark:border-white/5">
                                {label}
                                <button onClick={() => toggleOption(id)} className="ml-1.5 text-slate-400 hover:text-rose-500 text-[10px]">✕</button>
                            </span>
                        );
                    })}
                    <button onClick={() => onChange([])} className="text-[10px] text-rose-500 hover:underline underline-offset-2 ml-1">Limpar</button>
                </div>
            )}
        </div>
    );
}
// ============================================================================
// MODAL DE LOGS (HISTÓRICO)
// ============================================================================


function LogsModal({ ruleId, ruleName, onClose }: { ruleId: string, ruleName: string, onClose: () => void }) {
    if (typeof document === "undefined") return null;
    
    
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchLogs = async () => {
        const tid = await getCurrentTenantId();
        if (!tid) return;

        const { data, error } = await supabaseBrowser
        .from("billing_logs")
        .select("id, client_name, client_whatsapp, status, sent_at, error_message")
        .eq("tenant_id", tid)
        .eq("automation_id", ruleId)
        .order("sent_at", { ascending: false })
        .limit(50);

        if (error) {
        console.error("Erro ao carregar logs:", error);
        setLogs([]);
        } else {
        setLogs((data as LogEntry[]) || []);
        }

        setLoading(false);

        };
        fetchLogs();
    }, [ruleId]);

    return createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-3xl bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[80vh]">
                <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 flex justify-between items-center bg-slate-50 dark:bg-white/5">
                    <div><h3 className="text-lg font-bold text-slate-800 dark:text-white">Logs de Envio</h3><p className="text-xs text-slate-500">Regra: <strong>{ruleName}</strong></p></div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-800 dark:hover:text-white">✕</button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                    {loading ? <div className="text-center py-10 text-slate-400">Carregando...</div> : logs.length === 0 ? <div className="text-center py-10 text-slate-400">Nenhum registro encontrado.</div> : (
                        <table className="w-full text-left text-sm">
                            <thead className="text-xs uppercase text-slate-500 border-b border-slate-100 dark:border-white/5"><tr><th className="p-2">Data/Hora</th><th className="p-2">Cliente</th><th className="p-2">WhatsApp</th><th className="p-2">Status</th></tr></thead>
                            <tbody>
                                {logs.map(log => (
                                    <tr key={log.id} className="border-b border-slate-50 dark:border-white/5 last:border-0 hover:bg-slate-50 dark:hover:bg-white/5">
                                        <td className="p-2 text-slate-500 font-mono text-xs">
                                        {formatDateTimeSP(log.sent_at)}
                                        </td>

                                        <td className="p-2 font-bold text-slate-700 dark:text-white">{log.client_name}</td>
                                        <td className="p-2 text-slate-500">{log.client_whatsapp}</td>
                                        <td className="p-2">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${log.status === 'SENT' ? 'bg-emerald-100 text-emerald-700' : log.status === 'FAILED' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                                                {log.status}
                                            </span>
                                            {log.error_message && <div className="text-[10px] text-rose-500 mt-1">{log.error_message}</div>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
                <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 flex justify-end"><button onClick={onClose} className="px-5 py-2 rounded-lg bg-slate-800 text-white font-bold text-xs uppercase">Fechar</button></div>
            </div>
        </div>, document.body
    );
}