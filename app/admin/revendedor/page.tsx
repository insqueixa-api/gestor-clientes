"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";

// --- COMPONENTES MODAIS ---
// Usamos o modal unificado (novo_revenda) para Criar e Editar
import ResellerFormModal from "./novo_revenda"; 
import QuickRechargeModal from "./recarga_revenda";
import ToastNotifications, { ToastMessage } from "../ToastNotifications";

// --- TIPOS ---
type ResellerStatus = "Ativo" | "Inativo" | "Arquivado";

type SortKey =
  | "name"
  | "servers"
  | "revenue"
  | "cost"
  | "profit"
  | "status"
  | "alerts";
type SortDir = "asc" | "desc";

// Financeiro por venda (server_credit_sales) - agregação no front
type VwResellerFinanceAgg = {
  reseller_id: string;
  revenue: number; // total BRL
  cost: number;    // total BRL
};



/**
 * Linha REAL da view vw_resellers_list_*
 */
type VwResellerRow = {
  id: string;
  tenant_id: string;

  display_name: string | null;
  email: string | null;
  notes: string | null;

  // whatsapp
  whatsapp_e164: string | null;        // vem como "5521...." (sem +)
  whatsapp_extra: string[] | null;
  whatsapp_username: string | null;
  whatsapp_opt_in: boolean | null;
  whatsapp_snooze_until: string | null;

  // flags
  is_archived: boolean | null;

  // servidores / vendas / financeiro (nomes exatos da view)
  servers_linked: number | null;
  sales_count: number | null;
  credits_sold_total: number | null;
  revenue_brl_total: number | null;

  created_at?: string;
  updated_at?: string;
};



// Dados processados para a Tabela
type ResellerRow = {
  id: string;
  name: string;
  primary_phone: string;
  email: string;

  // --- NOVOS CAMPOS PARA O FORMULÁRIO DE EDIÇÃO ---
  whatsapp_e164: string | null;
  whatsapp_extra: string[] | null;
  whatsapp_username: string | null;
  whatsapp_opt_in: boolean | null;
  whatsapp_snooze_until: string | null;
  // ------------------------------------------------

  linked_servers_count: number;
  
  revenueVal: number;
  revenueLabel: string;
  
  costVal: number;
  costLabel: string;
  
  profitVal: number;
  profitLabel: string;

  status: ResellerStatus;
  archived: boolean;
  alertsCount: number;

  notes: string;
};

// --- HELPERS ---
function compareText(a: string, b: string) {
  return a.localeCompare(b, "pt-BR", { sensitivity: "base" });
}
function compareNumber(a: number, b: number) {
  return a - b;
}
function statusRank(s: ResellerStatus) {
  if (s === "Ativo") return 2;
  if (s === "Inativo") return 1;
  return 0;
}
function brl(val: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val || 0);
}

function num(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mapStatus(isActive: boolean, statusStr: string): ResellerStatus {
    if (statusStr === 'archived') return "Arquivado";
    return isActive ? "Ativo" : "Inativo";
}

export default function RevendaPage() {
  // --- ESTADOS ---
  const [rows, setRows] = useState<ResellerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);

  // Modais (Estado Unificado)
  const [showFormModal, setShowFormModal] = useState(false);
  const [resellerToEdit, setResellerToEdit] = useState<ResellerRow | null>(null);
  
  // Ações
  const [msgMenuForId, setMsgMenuForId] = useState<string | null>(null);
  const [showRecharge, setShowRecharge] = useState<{ open: boolean; resellerId: string | null; resellerName?: string }>({
    open: false,
    resellerId: null,
    resellerName: undefined,
  });

  // Filtros
  const [search, setSearch] = useState("");
  const [showCount, setShowCount] = useState(100);
  const [statusFilter, setStatusFilter] = useState<"Todos" | ResellerStatus>("Todos");
  const [archivedFilter, setArchivedFilter] = useState<"Todos" | "Não" | "Sim">("Não");

  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Mensagem e Alertas (Mock visual para paridade)
  const [showSendNow, setShowSendNow] = useState<{ open: boolean; resellerId: string | null }>({ open: false, resellerId: null });
  const [messageText, setMessageText] = useState("");
  const [showScheduleMsg, setShowScheduleMsg] = useState<{ open: boolean; resellerId: string | null }>({ open: false, resellerId: null });
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleText, setScheduleText] = useState("");
  
  // Alertas
  const [showNewAlert, setShowNewAlert] = useState<{ open: boolean; resellerId: string | null; resellerName?: string }>({ open: false, resellerId: null, resellerName: undefined });
  const [newAlertText, setNewAlertText] = useState("");

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  function addToast(type: "success" | "error", title: string, message?: string) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => removeToast(id), 4000);
  }

  function removeToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  async function getToken() {
    const { data: { session } } = await supabaseBrowser.auth.getSession();
    if (!session?.access_token) throw new Error("Sem sessão");
    return session.access_token;
  }

  // --- CARREGAMENTO ---
  async function loadData() {
    setLoading(true);
    const tid = await getCurrentTenantId();
    setTenantId(tid);

    if (!tid) {
      setRows([]);
      setLoading(false);
      return;
    }

    // Seleciona a VIEW correta baseado no filtro de arquivados (Padrão do Contrato)


const viewName =
  archivedFilter === "Sim" ? "vw_resellers_list_archived" : "vw_resellers_list_active";

const [resellersRes, salesRes] = await Promise.all([
  supabaseBrowser
    .from(viewName)
    .select("*")
    .eq("tenant_id", tid)
    .order("display_name", { ascending: true }),

  // ✅ pluga o financeiro direto da tabela de vendas
  //    (ajusta os nomes das colunas se necessário)
  supabaseBrowser
    .from("server_credit_sales")
    .select("*")
    .eq("tenant_id", tid),
]);

const { data, error } = resellersRes;

if (error) {
  console.error(error);
  addToast("error", "Erro ao carregar revendas", error.message);
  setRows([]);
  setLoading(false);
  return;
}

// Finance: agrega por reseller_id
const financeMap = new Map<string, VwResellerFinanceAgg>();

if (salesRes.error) {
  console.warn("Falha ao carregar server_credit_sales:", salesRes.error.message);
} else {
  const sales = (salesRes.data || []) as any[];

  for (const s of sales) {
    const resellerId = String(
      s.reseller_id ?? s.p_reseller_id ?? s.reseller ?? ""
    );
    if (!resellerId) continue;

    // tenta pegar revenue/cost com nomes comuns
    const revenue =
      num(s.revenue_brl_total) ||
      num(s.revenue_brl) ||
      num(s.amount_brl) ||
      num(s.total_brl) ||
      0;

    const cost =
      num(s.cost_brl_total) ||
      num(s.cost_brl) ||
      num(s.cost_total_brl) ||
      num(s.total_cost_brl) ||
      0;

    const cur = financeMap.get(resellerId) || { reseller_id: resellerId, revenue: 0, cost: 0 };
    cur.revenue += revenue;
    cur.cost += cost;
    financeMap.set(resellerId, cur);
  }
}

const typed = (data || []) as VwResellerRow[];


    const mapped: ResellerRow[] = typed.map((r) => {
const revenue = Number(r.revenue_brl_total || 0);

// tenta puxar custo real do financeiro
const fin = financeMap.get(String(r.id));
const cost = fin ? fin.cost : 0;

const profit = revenue - cost;


  const archived = Boolean(r.is_archived);

  return {
    id: String(r.id),

    name: String(r.display_name ?? "Sem Nome"),
    primary_phone: formatPhoneE164BR(r.whatsapp_e164 ?? ""),
    email: String(r.email ?? ""),

    // --- REPASSANDO DADOS ---
    whatsapp_e164: r.whatsapp_e164, 
    whatsapp_extra: r.whatsapp_extra,
    whatsapp_username: r.whatsapp_username,
    whatsapp_opt_in: r.whatsapp_opt_in,
    whatsapp_snooze_until: r.whatsapp_snooze_until,
    // -----------------------

    linked_servers_count: Number(r.servers_linked || 0),

    revenueVal: revenue,
    revenueLabel: brl(revenue),

    costVal: cost,
    costLabel: brl(cost),

    profitVal: profit,
    profitLabel: brl(profit),

    status: archived ? "Arquivado" : "Ativo",
    archived,

    alertsCount: 0, // sua view hoje não traz alerts_open (quando tiver, pluga aqui)
    notes: r.notes || ""
  };
});




    setRows(mapped);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archivedFilter]);

  // Lógica de Toast persistente (reload/redirect)
  useEffect(() => {
    if (loading) return;
    try {
      const key = "resellers_list_toasts";
      const raw = window.sessionStorage.getItem(key);
      if (!raw) return;
      const arr = JSON.parse(raw) as { type: "success" | "error"; title: string; message?: string }[];
      window.sessionStorage.removeItem(key);
      for (const t of arr) { addToast(t.type, t.title, t.message); }
    } catch { /* ignora */ }
  }, [loading]);

  // --- FILTROS ---
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "Todos" && r.status !== statusFilter) return false;
      if (q) {
        const hay = [r.name, r.primary_phone, r.email, r.status].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter]);

  // --- ORDENAÇÃO ---
  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name": cmp = compareText(a.name, b.name); break;
        case "status": cmp = compareNumber(statusRank(a.status), statusRank(b.status)); break;
        case "servers": cmp = compareNumber(a.linked_servers_count, b.linked_servers_count); break;
        case "revenue": cmp = compareNumber(a.revenueVal, b.revenueVal); break;
        case "cost": cmp = compareNumber(a.costVal, b.costVal); break;
        case "profit": cmp = compareNumber(a.profitVal, b.profitVal); break;
        case "alerts": cmp = compareNumber(a.alertsCount, b.alertsCount); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const visible = useMemo(() => sorted.slice(0, showCount), [sorted, showCount]);

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(nextKey); setSortDir("asc"); }
  }

  // --- ACTIONS HANDLERS ---
  
  // Handler para abrir modal de edição
  const handleOpenEdit = (r: ResellerRow) => {
      setResellerToEdit(r);
      setShowFormModal(true);
  };

  // Handler para abrir modal de criação
  const handleOpenNew = () => {
      setResellerToEdit(null);
      setShowFormModal(true);
  };

  // Arquivar / Restaurar (RPC update_reseller)
  const handleArchiveToggle = async (r: ResellerRow) => {
    if (!tenantId) return;

    const goingToArchive = !r.archived;
    const confirmed = window.confirm(
      goingToArchive ? "Arquivar esta revenda? (Ela perderá acesso ao sistema)" : "Restaurar esta revenda da Lixeira?"
    );
    if (!confirmed) return;

    try {
      const { error } = await supabaseBrowser.rpc("update_reseller", {
        p_tenant_id: tenantId,
        p_reseller_id: r.id,

        // não altera dados (mantém como está)
        p_display_name: null,
        p_email: null,
        p_notes: null,
        p_clear_notes: false,

        p_whatsapp_opt_in: null,
        p_whatsapp_username: null,
        p_whatsapp_snooze_until: null,

        // ação
        p_is_archived: goingToArchive,
      });


      if (error) throw error;

      addToast("success", goingToArchive ? "Revenda arquivada" : "Revenda restaurada");
      loadData();
    } catch (e: any) {
      addToast("error", "Erro ao atualizar", e.message || "Erro desconhecido");
    }
  };

  // Mensagens (Mock / API)
  const handleSendMessage = async () => {
    if (!messageText.trim() || !showSendNow.resellerId || !tenantId) return;
    try {
      const token = await getToken();
      await fetch("/api/messages/send", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: tenantId, client_id: showSendNow.resellerId, message: messageText }),
      });
      addToast("success", "Mensagem enviada!");
      setShowSendNow({ open: false, resellerId: null });
      setMessageText("");
    } catch (error) {
      addToast("error", "Erro ao enviar", "Verifique o serviço de mensagem.");
    }
  };

  const handleScheduleMessage = async () => {
    // Mesma lógica do cliente
    addToast("success", "Agendamento salvo!");
    setShowScheduleMsg({ open: false, resellerId: null });
  };

  // Alertas (Mock visual para manter paridade com cliente)
  const handleSaveAlert = () => {
      addToast("success", "Alerta criado!");
      setShowNewAlert({ open: false, resellerId: null });
      setNewAlertText("");
  }

  function closeAllPopups() { setMsgMenuForId(null); }

  return (
    <div className="p-5 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors" onClick={closeAllPopups}>
      
      {/* Topo */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-4 pb-1 mb-6 animate-in fade-in duration-500">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white tracking-tight">Gestão de Revendas</h1>
          <p className="text-slate-500 dark:text-white/60 mt-0.5 text-sm font-medium">Gerencie parceiros, recargas e servidores.</p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          {/* BUSCA */}
          <div className="relative w-full md:w-64">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar..."
              className="w-full h-10 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-500 transition-colors"
              >
                <IconX />
              </button>
            )}
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              setArchivedFilter(archivedFilter === "Não" ? "Sim" : "Não");
            }}
            className={`h-10 px-3 rounded-lg text-xs font-bold border transition-colors whitespace-nowrap flex items-center ${
              archivedFilter === "Sim"
                ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
                : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60"
            }`}
          >
            {archivedFilter === "Sim" ? "Ocultar Lixeira" : "Ver Lixeira"}
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              handleOpenNew(); // ✅ CORRIGIDO: Usa o handler correto
            }}
            className="h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all whitespace-nowrap"
          >
            <span>+</span> Nova Revenda
          </button>
        </div>
      </div>

      {loading && (
        <div className="p-12 text-center text-slate-400 dark:text-white/40 animate-pulse bg-white dark:bg-[#161b22] rounded-xl border border-slate-200 dark:border-white/5 font-medium">
          Carregando revendas...
        </div>
      )}

      {!loading && (
        <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-sm overflow-hidden transition-colors" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
            <div className="text-sm font-bold text-slate-700 dark:text-white tracking-tight">
              Lista de Revendas{" "}
              <span className="ml-2 px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs">{filtered.length}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-white/50">
              <span>Mostrar</span>
              <select value={showCount} onChange={(e) => setShowCount(Number(e.target.value))} className="bg-transparent border border-slate-300 dark:border-white/10 rounded px-1 py-0.5 outline-none text-slate-700 dark:text-white cursor-pointer hover:text-emerald-500 transition-colors">
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10 text-[11px] font-bold uppercase text-slate-500 dark:text-white/30 bg-slate-50/50 dark:bg-black/20 tracking-widest">
                  <Th width={40}><input type="checkbox" className="rounded border-slate-300 dark:border-white/20 bg-slate-100 dark:bg-white/5" /></Th>
                  <ThSort label="Revenda / Contato" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} />
                  <ThSort label="Servidores" active={sortKey === "servers"} dir={sortDir} onClick={() => toggleSort("servers")} />
                  <ThSort label="Faturamento" active={sortKey === "revenue"} dir={sortDir} onClick={() => toggleSort("revenue")} />
                  <ThSort label="Custo" active={sortKey === "cost"} dir={sortDir} onClick={() => toggleSort("cost")} />
                  <ThSort label="Lucro" active={sortKey === "profit"} dir={sortDir} onClick={() => toggleSort("profit")} />
                  <ThSort label="Status" active={sortKey === "status"} dir={sortDir} onClick={() => toggleSort("status")} />
                  <ThSort label="Alertas" active={sortKey === "alerts"} dir={sortDir} onClick={() => toggleSort("alerts")} />
                  <Th align="right" className="pr-6">Ações</Th>
                </tr>
              </thead>

              <tbody className="text-sm divide-y divide-slate-100 dark:divide-white/5">
                {visible.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-all group">
                    <Td><input type="checkbox" className="rounded border-slate-300 dark:border-white/20 bg-white dark:bg-black/20 text-emerald-500 focus:ring-emerald-500/30" /></Td>

                    <Td>
                      <div className="flex flex-col">
                        <Link href={`/admin/revendedor/${r.id}`} className="font-bold text-slate-700 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors decoration-slate-200 dark:decoration-white/5">
                          {r.name}
                        </Link>
                        <span className="text-[11px] font-medium text-slate-400 dark:text-white/30">
                          {formatPhoneE164BR(r.primary_phone)}
                        </span>

                      </div>
                    </Td>

                    <Td>
                        <span className="inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-600 dark:text-white/70 shadow-sm">
                            {r.linked_servers_count}
                        </span>
                    </Td>

                    <Td><span className="font-mono font-bold text-slate-700 dark:text-white/80">{r.revenueLabel}</span></Td>
                    <Td><span className="font-mono font-bold text-slate-500 dark:text-white/40">{r.costLabel}</span></Td>
                    <Td><span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{r.profitLabel}</span></Td>
                    
                    <Td><StatusBadge status={r.status} /></Td>

                    <Td>
                      {r.alertsCount > 0 ? (
                        <button className="px-2 py-0.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/20 text-[10px] font-bold hover:bg-amber-500/20 transition-all shadow-sm">
                          {r.alertsCount} alerta(s)
                        </button>
                      ) : (
                        <span className="text-slate-300 dark:text-white/10">—</span>
                      )}
                    </Td>

                    <Td align="right" className="pr-6">
                      <div className="flex items-center justify-end gap-1.5 opacity-80 group-hover:opacity-100 relative transition-opacity">
                        <div className="relative">
                          <IconActionBtn title="Mensagem" tone="blue" onClick={(e) => { e.stopPropagation(); setMsgMenuForId((cur) => (cur === r.id ? null : r.id)); }}>
                            <IconChat />
                          </IconActionBtn>

                          {msgMenuForId === r.id && (
                            <div onClick={(e) => e.stopPropagation()} className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#161b22] z-50 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 p-1">
                              <MenuItem icon={<IconSend />} label="Enviar agora" onClick={() => { setMsgMenuForId(null); setMessageText(""); setShowSendNow({ open: true, resellerId: r.id }); }} />
                              <MenuItem icon={<IconClock />} label="Programar" onClick={() => { setMsgMenuForId(null); setScheduleText(""); setScheduleDate(""); setShowScheduleMsg({ open: true, resellerId: r.id }); }} />
                            </div>
                          )}
                        </div>

                        {/* Botão de Venda de Créditos / Recarga */}
                        <IconActionBtn title="Recarga / Venda" tone="green" onClick={(e) => { 
                            e.stopPropagation(); 
                            if (r.linked_servers_count <= 0) { addToast("error", "Sem servidores", "Vincule servidores antes de vender créditos."); return; }
                            setShowRecharge({ open: true, resellerId: r.id, resellerName: r.name }); 
                        }}>
                          <IconMoney />
                        </IconActionBtn>

                        <IconActionBtn title="Editar" tone="amber" onClick={(e) => { e.stopPropagation(); handleOpenEdit(r); }}>
                          <IconEdit />
                        </IconActionBtn>

                        <IconActionBtn title="Novo alerta" tone="purple" onClick={(e) => { e.stopPropagation(); setNewAlertText(""); setShowNewAlert({ open: true, resellerId: r.id, resellerName: r.name }); }}>
                           <IconBell />
                        </IconActionBtn>

                        <IconActionBtn title={r.archived ? "Restaurar" : "Arquivar"} tone={r.archived ? "green" : "red"} onClick={(e) => { e.stopPropagation(); handleArchiveToggle(r); }}>
                          {r.archived ? <IconRestore /> : <IconTrash />}
                        </IconActionBtn>

                      </div>
                    </Td>
                  </tr>
                ))}

                {visible.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-12 text-center text-slate-400 dark:text-white/30 italic font-medium bg-slate-50/30 dark:bg-white/5">Nenhuma revenda encontrada com os filtros atuais.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- MODAIS --- */}
      {showFormModal && (
        <ResellerFormModal
          key={resellerToEdit?.id ?? "new"}
          resellerToEdit={resellerToEdit}
          onClose={() => {
            setShowFormModal(false);
            setResellerToEdit(null);
          }}
          onSuccess={async () => {
            setShowFormModal(false);
            setResellerToEdit(null);
            addToast("success", resellerToEdit ? "Revenda atualizada!" : "Revenda criada!");
            await loadData();
          }}
          onError={(msg: string) => addToast("error", "Erro ao salvar", msg)}
        />
      )}

      {showRecharge.open && showRecharge.resellerId && (
        <QuickRechargeModal
            resellerId={showRecharge.resellerId}
            resellerName={showRecharge.resellerName || "Revenda"}
            onClose={() => setShowRecharge({ open: false, resellerId: null, resellerName: undefined })}
            onDone={async () => {
                setShowRecharge({ open: false, resellerId: null, resellerName: undefined });
                loadData();
                setTimeout(() => {
                    addToast("success", "Venda realizada", "Créditos adicionados com sucesso.");
                }, 150);
            }}
            // Note: Adicione o prop onError no seu QuickRechargeModal se ainda não tiver, 
            // ou trate o erro dentro dele. O seu código original não passava onError aqui.
        />
      )}

      {/* MODAL DE NOVO ALERTA */}
      {showNewAlert.open && (
        <Modal title={`Novo alerta: ${showNewAlert.resellerName}`} onClose={() => setShowNewAlert({ open: false, resellerId: null })}>
          <textarea
            value={newAlertText}
            onChange={(e) => setNewAlertText(e.target.value)}
            className="w-full bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-xl p-3 text-slate-800 dark:text-white outline-none min-h-25 transition-colors focus:border-emerald-500/50"
            placeholder="Digite o alerta..."
          />
          <div className="mt-4 flex justify-end gap-3">
            <button onClick={() => setShowNewAlert({ open: false, resellerId: null })} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/5 font-semibold text-sm transition-colors">
              Cancelar
            </button>
            <button className="px-6 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-500 shadow-lg shadow-emerald-900/20 transition-all text-sm" onClick={handleSaveAlert}>
              Salvar alerta
            </button>
          </div>
        </Modal>
      )}

      {/* MODAL DE ENVIO DE MENSAGEM */}
      {showSendNow.open && (
        <Modal title="Enviar mensagem agora" onClose={() => setShowSendNow({ open: false, resellerId: null })}>
          <div className="space-y-4">
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              className="w-full bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-xl p-3 text-slate-800 dark:text-white outline-none min-h-25 focus:border-emerald-500/50 transition-colors"
              placeholder="Digite a mensagem..."
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowSendNow({ open: false, resellerId: null })} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 font-semibold text-sm transition-colors">
                Cancelar
              </button>
              <button onClick={handleSendMessage} className="px-6 py-2 rounded-lg bg-sky-600 text-white font-bold hover:bg-sky-500 flex items-center gap-2 shadow-lg shadow-sky-900/20 transition-all text-sm">
                <IconSend /> Enviar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL DE AGENDAMENTO DE MENSAGEM */}
      {showScheduleMsg.open && (
        <Modal title="Agendar mensagem" onClose={() => setShowScheduleMsg({ open: false, resellerId: null })}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-white/40 mb-1.5 uppercase tracking-wider">Data e hora do envio</label>
              <input
                type="datetime-local"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-lg text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-white/40 mb-1.5 uppercase tracking-wider">Mensagem</label>
              <textarea
                value={scheduleText}
                onChange={(e) => setScheduleText(e.target.value)}
                className="w-full bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-xl p-3 text-slate-800 dark:text-white outline-none min-h-25 focus:border-emerald-500/50 transition-colors"
                placeholder="Mensagem agendada..."
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowScheduleMsg({ open: false, resellerId: null })} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 font-semibold text-sm transition-colors">
                Cancelar
              </button>
              <button onClick={handleScheduleMessage} className="px-6 py-2 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-500 flex items-center gap-2 shadow-lg shadow-purple-900/20 transition-all text-sm">
                <IconClock /> Agendar
              </button>
            </div>
          </div>
        </Modal>
      )}

      <ToastNotifications toasts={toasts} removeToast={removeToast} />
      <style jsx global>{`
        input[type="date"]::-webkit-calendar-picker-indicator,
        input[type="time"]::-webkit-calendar-picker-indicator { opacity: 0; display: none; }
      `}</style>
    </div>
  );
}

// --- SUB-COMPONENTES VISUAIS (CORRIGIDOS) ---

// Helper para classes de alinhamento
const ALIGN_CLASS: Record<string, string> = { left: "text-left", right: "text-right" };

function Th({ children, width, align = "left", className = "" }: { children: React.ReactNode, width?: number, align?: "left" | "right", className?: string }) {
  return <th className={`px-4 py-3 ${ALIGN_CLASS[align]} ${className}`} style={{ width }}>{children}</th>;
}

function Td({ children, align = "left", className = "" }: { children: React.ReactNode, align?: "left" | "right", className?: string }) {
  return <td className={`px-4 py-3 ${ALIGN_CLASS[align]} align-middle ${className}`}>{children}</td>;
}

function ThSort({ label, active, dir, onClick }: { label: string, active: boolean, dir: SortDir, onClick: () => void }) {
  return (
    <th onClick={onClick} className="px-4 py-3 cursor-pointer select-none group hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors text-left font-bold uppercase text-[11px] tracking-widest">
      <div className="flex items-center gap-1.5">
        {label}
        <span className={`transition-all duration-300 ${active ? "opacity-100 text-emerald-600 dark:text-emerald-500 scale-110" : "opacity-20 group-hover:opacity-50"}`}>
          {dir === "asc" ? <IconSortUp /> : <IconSortDown />}
        </span>
      </div>
    </th>
  );
}

function onlyDigits(s?: string | null) {
  return String(s ?? "").replace(/\D+/g, "");
}

function formatPhoneE164BR(raw?: string | null) {
  const d = onlyDigits(raw);
  if (!d) return "—";

  // BR: 55 + DDD (2) + número (9)
  if (d.length === 13 && d.startsWith("55")) {
    const ddd = d.slice(2, 4);
    const p1 = d.slice(4, 9);
    const p2 = d.slice(9);
    return `+55 (${ddd}) ${p1}-${p2}`;
  }

  // fallback genérico
  return d.startsWith("55") ? `+${d}` : `+${d}`;
}


function StatusBadge({ status }: { status: ResellerStatus }) {
  const tone = status === "Ativo" ? { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/20" }
               : status === "Arquivado" ? { bg: "bg-rose-500/10", text: "text-rose-600 dark:text-rose-400", border: "border-rose-500/20" }
               : { bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400", border: "border-amber-500/20" };
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-[10px] font-bold uppercase border shadow-sm ${tone.bg} ${tone.text} ${tone.border}`}>{status}</span>;
}

function IconActionBtn({ children, title, tone, onClick }: { children: React.ReactNode, title: string, tone: "blue" | "green" | "amber" | "purple" | "red", onClick: (e: React.MouseEvent) => void }) {
  const colors = {
    blue: "text-sky-500 dark:text-sky-400 bg-sky-500/10 border-sky-500/20 hover:bg-sky-500/20",
    green: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20",
    amber: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20",
    purple: "text-purple-600 dark:text-purple-400 bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20",
    red: "text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20",
  };
  return <button onClick={(e) => { e.stopPropagation(); onClick(e); }} title={title} className={`p-1.5 rounded-lg border border-transparent transition-all active:scale-95 shadow-sm ${colors[tone]} hover:bg-white/5`}>{children}</button>;
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode, label: string, onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full px-4 py-2.5 flex items-center gap-3 text-slate-600 dark:text-white/60 hover:bg-emerald-500/10 dark:hover:bg-white/5 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all text-left text-sm font-bold tracking-tight rounded-lg">
      <span className="opacity-70 group-hover:scale-110 transition-transform">{icon}</span>{label}
    </button>
  );
}

function Modal({ title, children, onClose }: { title: string, children: React.ReactNode, onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} className="fixed inset-0 bg-black/70 backdrop-blur-sm grid place-items-center z-[99999] p-4 animate-in fade-in duration-200">
      <div onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-lg bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5">
          <div className="font-bold text-slate-800 dark:text-white tracking-tight">{title}</div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-400 transition-colors"><IconX /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>, 
    document.body
  );
}

// --- ICONES ---
function IconX() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>; }
function IconSortUp() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 15l-6-6-6 6" /></svg>; }
function IconSortDown() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M6 9l6 6 6-6" /></svg>; }
function IconChat() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>; }
function IconSend() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7Z" /></svg>; }
function IconClock() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>; }
function IconMoney() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>; }
function IconPlus() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>; }
function IconEdit() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>; }
function IconBell() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" /><path d="M10 21a2 2 0 0 0 4 0" /></svg>; }
function IconTrash() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>; }

// ✅ Ícone de restaurar (setinha circular) — igual padrão do cliente
function IconRestore() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}
