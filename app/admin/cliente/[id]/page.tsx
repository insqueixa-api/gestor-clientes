"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "../../ToastNotifications";

// Componentes (CORRIGIDO: PascalCase)
import NovoCliente, { ClientData } from "../novo_cliente";
import RecargaCliente from "../recarga_cliente";

// --- HELPERS ---
function formatPhoneDisplay(e164: string | null | undefined) {
  if (!e164) return "Não informado";
  const digits = String(e164).replace(/\D+/g, "");
  if (!digits) return "Não informado";

  // Formatação BR simples se começar com 55
  if (digits.startsWith("55")) {
    const local = digits.slice(2);
    if (local.length === 11) return `+55 (${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
    if (local.length === 10) return `+55 (${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return `+${digits}`;
}

function extractPeriod(planName: string) {
  const p = (planName || "").trim();
  if (!p || p === "—") return "—";
  if (p.toLowerCase().includes("personalizado")) return "Mensal";
  if (p.includes("-")) {
    const parts = p.split("-");
    return parts[parts.length - 1].trim();
  }
  return p;
}

function extractTable(planName: string) {
  const p = (planName || "").trim();
  if (!p || p === "—") return "Tabela Padrão";
  if (p.includes("-")) {
    const parts = p.split("-");
    return parts.slice(0, -1).join("-").trim();
  }
  return "Tabela Geral";
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    OVERDUE: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
    TRIAL: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
    ARCHIVED: "bg-slate-500/10 text-slate-500 dark:text-white/40 border-slate-500/20",
  };
  const labelMap: Record<string, string> = {
    ACTIVE: "Ativo",
    OVERDUE: "Vencido",
    TRIAL: "Teste",
    ARCHIVED: "Arquivado",
  };
  return (
    <span className={`px-2.5 py-0.5 rounded-lg text-[11px] font-bold border shadow-sm ${map[status] || map.ACTIVE}`}>
      {labelMap[status] || status}
    </span>
  );
}

function fmtMoney(val: number | null | undefined, cur: string | null | undefined) {
  const n = Number(val || 0);
  if (!n || n <= 0) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur || "BRL" }).format(n);
}

function fmtDate(d: string) {
  if (!d) return "--";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "--";
  return dt.toLocaleDateString("pt-BR") + " " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function fmtDateTime(d: string) {
  if (!d) return "--";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "--";
  return `${dt.toLocaleDateString("pt-BR")} às ${dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

// --- TIPOS (ALINHADO COM AS VIEWS vw_clients_list_*) ---
type VwClientRow = {
  id: string;

  client_name: string | null;
  username: string | null;
  server_password?: string | null;

  vencimento: string | null; // timestamptz
  computed_status: "ACTIVE" | "OVERDUE" | "TRIAL" | "ARCHIVED" | string;
  client_is_archived: boolean | null;

  screens: number | null;

  plan_name: string | null;
  price_amount: number | null;
  price_currency: string | null;

  server_id: string | null;
  server_name: string | null;
  technology: string | null; // ✅ NOVO

  whatsapp_e164: string | null;
  whatsapp_username: string | null;
  whatsapp_extra: string[] | null;
  whatsapp_opt_in: boolean | null;
  dont_message_until: string | null;

  apps_names: string[] | null;
  apps_details?: { name: string; expiration?: string | null }[]; // ✅ Adicionado
  alerts_open: number;

  notes: string | null;
};

type ClientDetail = {
  id: string;
  client_name: string;
  username: string;

  server_id: string;
  server_name: string;
  technology: string | null; // ✅ NOVO

  plan_name: string;
  price_amount: number | null;
  price_currency: string | null;

  vencimento: string | null;
  computed_status: string;
  client_is_archived: boolean;

  screens: number;

  whatsapp_e164: string | null;
  whatsapp_username: string | null;
  whatsapp_extra: string[] | null;
  whatsapp_opt_in: boolean | null;
  dont_message_until: string | null;

  apps_names: string[] | null;
  alerts_open: number;

  notes: string | null;

  // extras úteis para o modal editar
  server_password?: string | null;
};

type TimelineItem = {
  id: string;
  created_at: string;
  event_type: string;
  message: string | null;
  meta: any;
};


export default function ClientDetailsPage() {
const params = useParams();

// ✅ aceita /[id] ou /[client_id] ou /[clientId] ou /[clienteId]
const p = params as any;
const clientIdRaw =
  (p?.id ?? p?.client_id ?? p?.clientId ?? p?.clienteId) as string | string[] | undefined;

const clientId = Array.isArray(clientIdRaw) ? clientIdRaw[0] : clientIdRaw;
const clientIdSafe = (clientId ?? "").trim();


  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);

  const [showEditModal, setShowEditModal] = useState(false);
  const [showRenewModal, setShowRenewModal] = useState(false);

  // --- TOASTS (5s) ---
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  function addToast(type: "success" | "error", title: string, message?: string) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => removeToast(id), 5000);
  }
  function removeToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  const isMessageBlocked = useMemo(() => {
    if (!client?.dont_message_until) return false;
    return new Date(client.dont_message_until).getTime() > Date.now();
  }, [client?.dont_message_until]);

  async function loadData() {
    if (!clientIdSafe) return;

    setLoading(true);
    try {
      const tid = await getCurrentTenantId();
      if (!tid) {
        setClient(null);
        setTimeline([]);
        setLoading(false);
        return;
      }


      // 1) tenta na view ACTIVE
      const r1 = await supabaseBrowser
        .from("vw_clients_list_active")
        .select("*")
        .eq("tenant_id", tid)
        .eq("id", clientIdSafe)
        .maybeSingle();

      // 2) se não achou, tenta na view ARCHIVED
      const r2 =
        r1.data
          ? { data: null as any, error: null as any }
          : await supabaseBrowser
              .from("vw_clients_list_archived")
              .select("*")
              .eq("tenant_id", tid)
              .eq("id", clientIdSafe)
              .maybeSingle();

      const row = ((r1.data || r2.data) as VwClientRow | null) ?? null;

      if (!row) {
        setClient(null);
        setTimeline([]);
        setLoading(false);
        return;
      }

      const mapped: ClientDetail = {
        id: String(row.id),
        client_name: String(row.client_name ?? "Sem Nome"),
        username: String(row.username ?? "—"),

        server_id: String(row.server_id ?? ""),
        server_name: String(row.server_name ?? row.server_id ?? "—"),
        technology: row.technology ?? "—", // ✅ Mapeia

        plan_name: String(row.plan_name ?? "—"),
        price_amount: row.price_amount ?? null,
        price_currency: row.price_currency ?? "BRL",

        vencimento: row.vencimento ?? null,
        computed_status: String(row.computed_status ?? "ACTIVE"),
        client_is_archived: Boolean(row.client_is_archived),

        screens: Number(row.screens || 1),

        whatsapp_e164: row.whatsapp_e164 ?? null,
        whatsapp_username: row.whatsapp_username ?? null,
        whatsapp_extra: row.whatsapp_extra ?? null,
        whatsapp_opt_in: typeof row.whatsapp_opt_in === "boolean" ? row.whatsapp_opt_in : true,
        dont_message_until: row.dont_message_until ?? null,

        apps_names: row.apps_names ?? null,
        alerts_open: Number(row.alerts_open || 0),

        notes: row.notes ?? null,

        server_password: row.server_password ?? null,
      };

      // ✅ BUSCA REAL: Vencimento dos Apps (Chave: "Vencimento")
      const { data: appsData } = await supabaseBrowser
        .from("client_apps")
        .select("field_values, apps (name)")
        .eq("client_id", mapped.id);

      if (appsData) {
        (mapped as any).apps_details = appsData.map((item: any) => {
           const vals = item.field_values || {};
           // A chave exata no seu banco é "Vencimento"
           const expiration = vals["Vencimento"] || vals["vencimento"] || null;
           
           return {
             name: item.apps?.name || "App",
             expiration: expiration
           };
        });
      }

      setClient(mapped);

      // ✅ Timeline real: client_events
        const ev = await supabaseBrowser
          .from("client_events")
          .select("id, created_at, event_type, message, meta")
          .eq("tenant_id", tid)
          .eq("client_id", mapped.id) // ou String(clientId)
          .order("created_at", { ascending: false })
          .limit(200);

        if (ev.error) {
          console.error(ev.error);
          addToast("error", "Falha ao carregar timeline", ev.error.message);
          setTimeline([]);
        } else {
          setTimeline((ev.data || []) as any);
        }

        setLoading(false);

    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message || "Erro ao carregar";
      console.error(e);
      addToast("error", "Falha ao carregar cliente", msg);
      setClient(null);
      setTimeline([]);
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function handleArchiveToggle() {
    if (!client) return;

    const goingToArchive = !client.client_is_archived;
    const confirmed = window.confirm(goingToArchive ? "Arquivar este cliente? (Ele irá para a Lixeira)" : "Restaurar este cliente da Lixeira?");
    if (!confirmed) return;

    try {
      const tid = await getCurrentTenantId();
      if (!tid) throw new Error("Tenant não encontrado");

      const { error } = await supabaseBrowser.rpc("update_client", {
        p_tenant_id: tid,
        p_client_id: client.id,
        p_is_archived: goingToArchive,
      });

      if (error) throw error;

      addToast("success", goingToArchive ? "Cliente arquivado" : "Cliente restaurado");
      loadData();
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message || "Erro desconhecido";
      console.error(e);
      addToast("error", "Falha ao atualizar cliente", msg);
    }
  }

  if (!clientIdSafe) {

    return (
      <div className="p-10 text-center text-rose-500 font-bold">
        Rota inválida: não encontrei o <span className="font-mono">id</span> do cliente nos params.
      </div>
    );
  }

  if (loading) return <div className="p-10 text-center text-slate-400 dark:text-white/20 animate-pulse font-medium">Carregando...</div>;
  if (!client) return <div className="p-10 text-center text-rose-500 font-bold">Cliente não encontrado.</div>;

  return (
  <div className="space-y-6 pt-3 pb-6 px-3 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors">

      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-3 pb-1 mb-6 border-b border-slate-200 dark:border-white/10">

<div className="w-full md:w-auto text-right">
  <div className="flex items-center justify-end gap-3">

            <h1 className="text-2xl md:text-3xl font-bold text-slate-800 dark:text-white tracking-tight">{client.client_name}</h1>
            <StatusBadge status={client.computed_status} />
          </div>
          {/* Linha de usuário/servidor removida conforme solicitado */}
        </div>

        <div className="flex flex-wrap gap-2 w-full md:w-auto justify-end">
          <Link
            href="/admin/cliente"
            className="h-10 px-4 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 font-bold text-sm hover:bg-slate-200 dark:hover:bg-white/5 transition-all inline-flex items-center justify-center"

          >
            Voltar
          </Link>

          <button
            onClick={handleArchiveToggle}
            className={`h-10 px-4 rounded-lg border font-bold text-sm transition-all shadow-sm inline-flex items-center justify-center ${
  client.client_is_archived
    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
    : "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20"
}`}

          >
            {client.client_is_archived ? "Restaurar" : "Arquivar"}
          </button>

          <button
            onClick={() => setShowEditModal(true)}
            className="h-10 px-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 font-bold text-sm hover:bg-amber-500/20 transition-all shadow-sm inline-flex items-center justify-center"

          >
            Editar
          </button>

          <button
            onClick={() => setShowRenewModal(true)}
            disabled={client.client_is_archived}
            className="h-10 px-6 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2 justify-center"

          >
            <span className="text-lg leading-none">$</span> Renovar
          </button>
        </div>
      </div>

      {/* GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* COLUNA ESQUERDA */}
        <div className="space-y-6">
          {/* 1. CARD ASSINATURA ATUAL */}
          <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl p-5 shadow-sm transition-colors">
            <h3 className="text-[11px] font-bold text-slate-400 dark:text-white/20 uppercase mb-4 tracking-widest">Assinatura atual</h3>

            <div className="space-y-3 text-sm">
              
              {/* BLOCO DE ACESSO (Sem bordas internas) */}
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-white/40 font-medium">Servidor</span>
                <span className="font-bold text-slate-800 dark:text-white text-right">{client.server_name}</span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-white/40 font-medium">Tecnologia</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 border border-slate-200 dark:border-white/10 uppercase">
                  {client.technology || "—"}
                </span>
              </div>

              {/* LISTA DE APPS (Com Vencimento Real do Banco) */}
              {(client as any).apps_details && (client as any).apps_details.length > 0 && (
                 <div className="space-y-3 pt-1">
                    {(client as any).apps_details.map((app: any, idx: number) => (
                       <div key={idx} className="flex justify-between items-center">
                          <span className="text-slate-500 dark:text-white/40 font-medium">{app.name}</span>
                          <span className={`text-xs ${app.expiration ? "text-slate-600 dark:text-white/70 font-medium" : "text-slate-400 dark:text-white/30 italic"}`}>
                             {app.expiration 
                                ? `Vence: ${new Date(app.expiration).toLocaleDateString("pt-BR")}` 
                                : "Vencimento: Não definido"}
                          </span>
                       </div>
                    ))}
                 </div>
              )}

              {/* DIVISOR FINANCEIRO (Com margem ajustada) */}
              <div className="pt-3 pb-1">
                 <div className="border-t border-slate-100 dark:border-white/5 mb-3"></div>
                 <div className="text-[10px] font-bold text-slate-400 dark:text-white/20 uppercase tracking-widest">Financeiro</div>
              </div>

              {/* BLOCO FINANCEIRO (Sem bordas internas) */}
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-white/40 font-medium">Tabela</span>
                <span className="font-bold text-slate-700 dark:text-white/90 tracking-tight text-right">{extractTable(client.plan_name)}</span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-white/40 font-medium">Plano</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400 tracking-tight">{extractPeriod(client.plan_name)}</span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-white/40 font-medium">Telas</span>
                <span className="font-bold text-slate-800 dark:text-white">{client.screens}</span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-white/40 font-medium">Valor</span>
                <span className="font-mono font-bold text-slate-800 dark:text-white bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-md">
                  {fmtMoney(client.price_amount, client.price_currency)}
                </span>
              </div>

              {/* VENCIMENTO GERAL DESTACADO */}
              <div className="pt-2">
                  <div className="flex justify-between items-center bg-slate-50 dark:bg-white/5 p-3 rounded-lg border border-slate-100 dark:border-white/5 mt-1">
                    <span className="text-slate-500 dark:text-white/40 font-bold text-[11px] uppercase tracking-tight">Vencimento</span>
                    <div
                      className={`text-right font-mono font-bold text-base ${
                        client.computed_status === "OVERDUE"
                          ? "text-rose-500"
                          : client.computed_status === "ACTIVE"
                          ? "text-emerald-500"
                          : "text-slate-500"
                      }`}
                    >
                      {client.vencimento ? fmtDateTime(client.vencimento) : "—"}
                    </div>
                  </div>
              </div>
            </div>
          </div>

          {/* 2. CARD CONTATOS E OBSERVAÇÕES */}
          <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl p-5 shadow-sm transition-colors">
            <h3 className="text-[11px] font-bold text-slate-400 dark:text-white/20 uppercase mb-4 tracking-widest">Contatos e observações</h3>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-500 dark:text-white/40 font-medium">Nome do Cliente</span>
                <span className="font-bold text-slate-800 dark:text-white text-right">{client.client_name}</span>
              </div>

              <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-500 dark:text-white/40 font-medium">Telefone Principal</span>
                <span className="font-mono font-bold text-slate-800 dark:text-white text-right">{formatPhoneDisplay(client.whatsapp_e164)}</span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-white/40 font-medium">WhatsApp Username</span>

                {client.whatsapp_username ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold">
                    @{client.whatsapp_username}
                  </span>
                ) : (
                  <span className="text-slate-400 italic text-sm">Não informado</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 py-2 border-t border-b border-slate-100 dark:border-white/5">
                <div>
                  <div className="text-[10px] font-bold text-slate-400 dark:text-white/30 uppercase mb-1">Receber Msg?</div>
                  {client.whatsapp_opt_in ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Sim
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-600 dark:text-rose-400">
                      <span className="w-2 h-2 rounded-full bg-rose-500"></span> Não
                    </span>
                  )}
                </div>

                {isMessageBlocked && (
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 dark:text-white/30 uppercase mb-1">Bloqueado até</div>
                    <span className="text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-500/10 px-1.5 py-0.5 rounded">
                      {fmtDateTime(client.dont_message_until!)}
                    </span>
                  </div>
                )}
              </div>

              <div>
                <div className="text-[11px] font-bold text-slate-500 dark:text-white/30 mb-1.5">Observações</div>
                <div className="text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-black/20 p-3 rounded-xl text-xs leading-relaxed border border-slate-200 dark:border-white/5 min-h-[80px] whitespace-pre-wrap">
                  {client.notes || "Sem observações registradas para este cliente."}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* COLUNA DIREITA (TIMELINE) */}
        <div className="lg:col-span-2 bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl p-5 shadow-sm h-fit transition-colors">
          <h3 className="text-[11px] font-bold text-slate-400 dark:text-white/20 uppercase mb-6 tracking-widest flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Linha do tempo
          </h3>

          <div className="space-y-0 px-2">
            {timeline.length === 0 ? (
              <div className="py-12 text-center text-slate-400 dark:text-white/20 text-sm italic border-2 border-dashed border-slate-100 dark:border-white/5 rounded-xl">
                Nenhum evento registrado até o momento.
              </div>
            ) : (
              timeline.map((item, idx) => (
                <div key={idx} className="relative pl-8 pb-1.5 last:pb-0 border-l-2 border-slate-100 dark:border-white/5 last:border-0 group">
                  <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full border-4 border-white dark:border-[#161b22] bg-slate-300 dark:bg-white/20"></div>

                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 bg-slate-50/50 dark:bg-white/5 p-2 rounded-xl border border-transparent hover:border-slate-200 dark:hover:border-white/10 transition-all">
                    <div>
                      <div className="text-sm font-bold text-slate-800 dark:text-white tracking-tight">Evento</div>
                      <div className="text-xs text-slate-500 dark:text-white/50 mt-1.5 leading-relaxed">
                        {item.message || (item.meta ? JSON.stringify(item.meta) : "")}

                      </div>
                    </div>
                    <div className="text-[10px] font-bold text-slate-400 dark:text-white/20 font-mono bg-white dark:bg-black/20 px-2 py-1 rounded-md shadow-sm self-start">
                      {fmtDate(item.created_at)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* --- MODAIS --- */}
      {showEditModal && client && (
        <NovoCliente
          clientToEdit={{
            id: client.id,
            client_name: client.client_name,
            username: client.username,

            server_password: client.server_password ?? undefined,

            whatsapp_e164: client.whatsapp_e164 ?? undefined,
            whatsapp_username: client.whatsapp_username ?? undefined,
            whatsapp_extra: client.whatsapp_extra ?? undefined,
            whatsapp_opt_in: client.whatsapp_opt_in ?? true,
            dont_message_until: client.dont_message_until ?? undefined,

            server_id: client.server_id,
            screens: client.screens,
            technology: client.technology ?? undefined, // ✅ Passa pro modal

            plan_name: client.plan_name ?? undefined,
            price_amount: client.price_amount ?? undefined,
            price_currency: client.price_currency ?? "BRL",

            vencimento: client.vencimento ?? undefined,
            notes: client.notes ?? undefined,

            apps_names: client.apps_names ?? undefined,
          }}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => {
            setShowEditModal(false);
            loadData();

            // ✅ CORREÇÃO: Captura o toast da sessão e exibe aqui mesmo
            setTimeout(() => {
                const key = "clients_list_toasts"; 
                const raw = window.sessionStorage.getItem(key);
                if (raw) {
                    try {
                        const arr = JSON.parse(raw);
                        // Exibe a notificação na tela atual
                        arr.forEach((t: any) => addToast(t.type, t.title, t.message));
                        // Limpa para não aparecer duplicado depois
                        window.sessionStorage.removeItem(key);
                    } catch (e) {
                        console.error("Erro toast:", e);
                    }
                }
            }, 150);
          }}
        />
      )}

{showRenewModal && client && (
  <RecargaCliente
    clientId={client.id}
    clientName={client.client_name}
    onClose={() => setShowRenewModal(false)}
    onSuccess={() => {
      setShowRenewModal(false);
      loadData();
      setTimeout(() => {
        addToast("success", "Cliente atualizado", "Cadastro atualizado com sucesso.");
        addToast("success", "Renovação confirmada", "Pagamento salvo e data atualizada.");
      }, 150);
    }}
  />
)}


      <div className="relative z-[999999]">
  <ToastNotifications toasts={toasts} removeToast={removeToast} />
</div>

    </div>
  );
}
