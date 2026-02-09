"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getCurrentTenantId } from "@/lib/tenant";
import Link from "next/link";

// ✅ 1. Importar o Hook
import { useConfirm } from "@/app/admin/HookuseConfirm";

// Modais
import VincularServidor from "./vincular_servidor";
import QuickRechargeModal from "../recarga_revenda";

// Componentes Visuais
import ToastNotifications, { ToastMessage } from "../../ToastNotifications";

/* =========================
   HELPERS DE TELEFONE (Mesma lógica do Cliente)
========================= */
const COUNTRIES = [
  { name: "Brasil", code: "55" },
  { name: "Estados Unidos", code: "1" },
  { name: "Portugal", code: "351" },
  // ... outros se necessário
];

function formatPhoneDisplay(e164: string | null | undefined) {
  if (!e164) return "Não informado";
  const digits = e164.replace(/\D+/g, "");

  const country = COUNTRIES.find((c) => digits.startsWith(c.code));
  if (!country) return `+${digits}`;

  const local = digits.slice(country.code.length);

  if (country.code === "55") {
    if (local.length === 11) return `+55 (${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
    if (local.length === 10) return `+55 (${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }

  return `+${country.code} ${local}`;
}

function fmtBRL(v: number | null | undefined) {
  if (!Number.isFinite(Number(v))) return "—";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtMoney(currency: string, value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}


function fmtDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("pt-BR");
}

/* =========================
   TIPOS
========================= */
type VwReseller = {
  id: string;
  tenant_id: string;

  display_name: string | null;
  email: string | null;
  notes: string | null;

  whatsapp_e164: string | null;
  whatsapp_extra: string[] | null;
  whatsapp_username: string | null;
  whatsapp_opt_in: boolean | null;
  whatsapp_snooze_until: string | null;

  is_archived: boolean | null;

  servers_linked: number | null;
  sales_count: number | null;
  credits_sold_total: number | null;
  revenue_brl_total: number | null;

  created_at: string | null;
  updated_at: string | null;
};

type Reseller = {
  id: string;
  name: string;
  email: string | null;
  notes: string | null;

  whatsapp_e164: string | null;
  whatsapp_username: string | null;
  whatsapp_opt_in: boolean;

  is_archived: boolean;
  created_at: string | null;
};

type ServerLink = {
  reseller_server_id: string;
  tenant_id: string;
  reseller_id: string;
  reseller_name: string;
  reseller_is_archived: boolean;

  server_id: string;
  server_name: string;
  server_is_archived: boolean;

  server_username: string | null;
  server_password: string | null;

  unit_price_override: number | null;
  created_at: string | null;
};

type HistoryRow = {
  id: string;
  reseller_server_id: string;
  server_id: string;

  qty_credits: number;
  unit_price: number;
  total_amount: number;

  currency: string | null;
  payment_method: string | null;

  notes: string | null;
  status: string;

  created_at: string;

  // auxiliar pro render
  server_name?: string | null;
};

type EditLinkState = {
  resellerServerId: string | null;
  initial?: {
    server_id: string | null;
    server_username: string | null;
    server_password: string | null;
  };
};

/* =========================
   PÁGINA PRINCIPAL
========================= */
export default function ResellerDetailPage() {
const params = useParams();
const router = useRouter();

// ✅ aceita /[id] ou /[reseller_id] ou /[resellerId]
const p = params as any;
const resellerIdRaw =
  (p?.id ?? p?.reseller_id ?? p?.resellerId) as string | string[] | undefined;

const resellerId = Array.isArray(resellerIdRaw) ? resellerIdRaw[0] : resellerIdRaw;
const resellerIdSafe = (resellerId ?? "").trim();

// ✅ 2. Inicializar o Hook de Confirmação
  const { confirm, ConfirmUI } = useConfirm();

  // Estados de Dados
  const [loading, setLoading] = useState(true);
  const [reseller, setReseller] = useState<Reseller | null>(null);
  const [servers, setServers] = useState<ServerLink[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  // Estados de Modais
  const [showServerModal, setShowServerModal] = useState(false);
  const [editLink, setEditLink] = useState<EditLinkState>({ resellerServerId: null, initial: undefined });

  const [qrOpen, setQrOpen] = useState(false);
  const [qrResellerServerId, setQrResellerServerId] = useState<string | null>(null);

  // Notificações
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  function addToast(type: "success" | "error", title: string, message?: string) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => removeToast(id), 4000);
  }

  function removeToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  function num(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const serverNameById = useMemo(() => {
  const m = new Map<string, string>();
  for (const s of servers) {
    if (s?.server_id) m.set(String(s.server_id), String(s.server_name || ""));
  }
  return m;
}, [servers]);

  // --- CARREGAMENTO ---
  async function loadData() {
    if (!resellerId) return;
    setLoading(true);

    try {
      const tid = await getCurrentTenantId();
      if (!tid) throw new Error("Tenant não encontrado");

      // 1) Revenda (view)
      const resellerRes = await supabaseBrowser
        .from("vw_resellers_list")
        .select("*")
        .eq("tenant_id", tid)
        .eq("id", resellerId)
        .maybeSingle();

      if (resellerRes.error) throw resellerRes.error;
      if (!resellerRes.data) throw new Error("Revenda não encontrada");

      const vr = resellerRes.data as VwReseller;

      setReseller({
        id: vr.id,
        name: vr.display_name ?? "Sem nome",
        email: vr.email,
        notes: vr.notes,
        whatsapp_e164: vr.whatsapp_e164,
        whatsapp_username: vr.whatsapp_username,
        whatsapp_opt_in: Boolean(vr.whatsapp_opt_in),
        is_archived: Boolean(vr.is_archived),
        created_at: vr.created_at,
      });

      // 2) Vínculos (view)
      const serversRes = await supabaseBrowser
        .from("vw_reseller_servers")
        .select("*")
        .eq("tenant_id", tid)
        .eq("reseller_id", resellerId)
        .order("created_at", { ascending: false });

      if (serversRes.error) throw serversRes.error;

      const links = (serversRes.data || []) as ServerLink[];
      setServers(links);

      // 3) Histórico (tabela server_credit_sales)
      // ✅ server_credit_sales NÃO tem reseller_id; tem reseller_server_id
      const resellerServerIds = links.map((l) => l.reseller_server_id).filter(Boolean);

      if (resellerServerIds.length === 0) {
        setHistory([]);
      } else {
const historyRes = await supabaseBrowser
  .from("server_credit_sales")
  .select("id,tenant_id,server_id,reseller_server_id,credits_sold,unit_price,total_amount_brl,notes,created_at,payment_method,sale_currency")
  .eq("tenant_id", tid)
  .in("reseller_server_id", resellerServerIds)
  .order("created_at", { ascending: false });



        if (historyRes.error) throw historyRes.error;

        const serverNameMap = new Map<string, string>();
        for (const l of links) serverNameMap.set(l.server_id, l.server_name);

        const mappedHistory: HistoryRow[] = (historyRes.data || []).map((h: any) => ({
          id: String(h.id),
          reseller_server_id: String(h.reseller_server_id),
          server_id: String(h.server_id),

          qty_credits: num(h.credits_sold),


          unit_price: num(h.unit_price),
          total_amount: num(h.total_amount_brl) || num(h.total_brl) || num(h.total_amount),

          currency: h.sale_currency ?? h.currency ?? null,
          payment_method: h.payment_method ?? null,

          notes: h.notes ?? null,
          status: "OK",
          created_at: String(h.created_at),

          server_name: serverNameMap.get(String(h.server_id)) ?? null,
        }));


        setHistory(mappedHistory);
      }
    } catch (e: any) {
      addToast("error", "Erro", e?.message ?? "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resellerId]);

  // --- AÇÕES ---
  async function handleDeleteLink(resellerServerId: string, serverName?: string | null) {
    // ✅ 3. Agora o 'confirm' existe e aceita o objeto
    const ok = await confirm({
      title: "Remover vínculo?",
      subtitle: "Esta ação impede que a revenda continue usando este servidor.",
      tone: "rose",
      icon: "💔", // Pode usar string ou componente <Icon />
      details: [
        serverName ? `Servidor: ${serverName}` : "Servidor desconhecido",
        "O histórico financeiro SERÁ MANTIDO.",
        "A revenda perderá acesso a criar novos testes/clientes neste servidor."
      ],
      confirmText: "Remover Vínculo",
      cancelText: "Voltar",
    });

    if (!ok) return;

    try {
      const tid = await getCurrentTenantId();
      if (!tid) throw new Error("Tenant não encontrado");

      const { error } = await supabaseBrowser.rpc("unlink_reseller_from_server", {
        p_tenant_id: tid,
        p_reseller_server_id: resellerServerId,
      });

      if (error) throw error;

      addToast("success", "Vínculo removido");
      loadData();
    } catch (e: any) {
      addToast("error", "Erro ao remover", e?.message ?? "Erro desconhecido");
    }
  }


  // --- CÁLCULOS TOTAIS ---
const totalInvested = useMemo(() => {
  return history.reduce((acc, curr) => {
    const anyCurr: any = curr as any;
    const total =
      num(anyCurr.total_amount) ||
      num(anyCurr.total_amount_brl) ||
      num(anyCurr.total_brl) ||
      0;
    return acc + total;
  }, 0);
}, [history]);


  if (loading)
    return (
      <div className="p-10 text-center text-slate-400 dark:text-white/20 animate-pulse font-medium">
        Carregando revenda...
      </div>
    );

  if (!reseller)
    return <div className="p-10 text-center text-rose-500 font-bold">Revenda não encontrada.</div>;

  return (
// ✅ Ajuste: pt-0 px-0 no mobile (full width), sm:px-6 no desktop
<div className="space-y-4 sm:space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors">

  {/* HEADER CLEAN */}
  <div className="flex items-center justify-between gap-3 pb-0 mb-4 px-4 sm:px-0 pt-4 sm:pt-0">
    
    {/* Título + Badge */}
    <div className="min-w-0 text-left flex flex-col">
      <div className="flex items-center gap-2">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight truncate">
          {reseller.name}
        </h1>
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
            reseller.is_archived
              ? "bg-slate-500/10 text-slate-500 dark:text-white/40 border-slate-500/20"
              : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
          }`}
        >
          {reseller.is_archived ? "Arquivado" : "Ativo"}
        </span>
      </div>
      {/* Subtítulo opcional (email ou telefone) */}
      <span className="text-xs text-slate-500 dark:text-white/50 font-medium truncate">
         {reseller.email || "Sem email"}
      </span>
    </div>

    {/* Ações */}
    <div className="flex items-center gap-2 shrink-0">
      {/* Voltar (Só Desktop) */}
      <Link
        href="/admin/revendedor"
        className="hidden sm:inline-flex h-9 px-3 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 font-bold text-xs hover:bg-slate-200 dark:hover:bg-white/5 transition-all items-center justify-center"
      >
        Voltar
      </Link>

      {/* Vincular Servidor (Visível Mobile e Desktop) */}
      <button
        onClick={() => {
          setEditLink({ resellerServerId: null, initial: undefined });
          setShowServerModal(true);
        }}
        className="h-9 sm:h-10 px-4 sm:px-5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs sm:text-sm shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2"
      >
        <span>+</span> Vincular Servidor
      </button>
    </div>
  </div>


      {/* GRID PRINCIPAL (3 COLUNAS) */}
<div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 px-0 sm:px-0">

  {/* COLUNA ESQUERDA */}
  <div className="space-y-4">
    {/* 1. CARD RESUMO */}
    <div className="bg-white dark:bg-[#161b22] border-y sm:border border-slate-200 dark:border-white/10 sm:rounded-xl p-4 shadow-sm transition-colors">
            <h3 className="text-[11px] font-bold text-slate-400 dark:text-white/20 uppercase mb-4 tracking-widest">
              Resumo da Conta
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-500 dark:text-white/40 font-medium">Desde</span>
                <span className="font-bold text-slate-700 dark:text-white/90 text-right">
                  {fmtDate(reseller.created_at)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-white/40 font-medium">Servidores</span>
                <span className="font-bold text-slate-800 dark:text-white">{servers.length}</span>
              </div>

              {/* TOTAL INVESTIDO */}
              <div className="pt-4 mt-2 border-t border-slate-100 dark:border-white/5 flex justify-between items-center bg-slate-50 dark:bg-white/5 p-3 rounded-lg">
                <span className="text-slate-500 dark:text-white/40 font-bold text-[11px] uppercase tracking-tight">
                  Total Investido
                </span>
                <div className="text-right font-mono font-bold text-base text-emerald-600 dark:text-emerald-400">
                  {fmtBRL(totalInvested)}
                </div>
              </div>
            </div>
          </div>

          {/* 2. CARD CONTATOS */}
          <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl p-5 shadow-sm transition-colors">
            <h3 className="text-[11px] font-bold text-slate-400 dark:text-white/20 uppercase mb-4 tracking-widest">
              Contatos e Observações
            </h3>
            <div className="space-y-3 text-sm">
              {/* Email */}
              <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-500 dark:text-white/40 font-medium">Email</span>
                <span
                  className="font-bold text-slate-800 dark:text-white text-right truncate max-w-[150px]"
                  title={reseller.email ?? ""}
                >
                  {reseller.email || "—"}
                </span>
              </div>

              {/* WhatsApp Display */}
              <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-500 dark:text-white/40 font-medium">Telefone</span>
                <span className="font-mono font-bold text-slate-800 dark:text-white text-right">
                  {formatPhoneDisplay(reseller.whatsapp_e164)}
                </span>
              </div>

              {/* WhatsApp Link */}
<div className="flex justify-between items-center">
  <span className="text-slate-500 dark:text-white/40 font-medium">WhatsApp</span>
  {reseller.whatsapp_username ? (
    <a
      href={`https://wa.me/${reseller.whatsapp_e164?.replace(/\D/g, "")}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 font-bold hover:underline"
    >
      <IconWhatsapp />
      @{reseller.whatsapp_username}
    </a>
  ) : reseller.whatsapp_e164 ? (
     <a
      href={`https://wa.me/${reseller.whatsapp_e164?.replace(/\D/g, "")}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 font-bold hover:underline"
    >
      <IconWhatsapp />
      {formatPhoneDisplay(reseller.whatsapp_e164)}
    </a>
  ) : (
    <span className="text-slate-400 italic text-sm">—</span>
  )}
</div>

              {/* Opt-in */}
              <div className="py-2 border-t border-b border-slate-100 dark:border-white/5">
                <div className="text-[10px] font-bold text-slate-400 dark:text-white/30 uppercase mb-1">
                  Receber mensagem?
                </div>
                {reseller.whatsapp_opt_in ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Sim
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-600 dark:text-rose-400">
                    <span className="w-2 h-2 rounded-full bg-rose-500"></span> Não
                  </span>
                )}
              </div>

              {/* Notas */}
              <div>
                <div className="text-[11px] font-bold text-slate-500 dark:text-white/30 mb-1.5">Observações</div>
                <div className="text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-black/20 p-3 rounded-xl text-xs leading-relaxed border border-slate-200 dark:border-white/5 min-h-[80px] whitespace-pre-wrap">
                  {reseller.notes || "Sem observações registradas."}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ================= COLUNA DIREITA (2 SPANS: SERVIDORES + TIMELINE) ================= */}
        <div className="lg:col-span-2 space-y-6">
          {/* BLOCO 1: SERVIDORES VINCULADOS */}
          <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl p-5 shadow-sm transition-colors">
            <h3 className="text-[11px] font-bold text-slate-400 dark:text-white/20 uppercase mb-4 tracking-widest flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
              Servidores Vinculados
            </h3>

            {servers.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 dark:bg-white/5 border border-dashed border-slate-200 dark:border-white/10 rounded-xl text-slate-400 dark:text-white/30 italic">
                Nenhum servidor vinculado.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {servers.map((s) => (
                  <div
                    key={s.reseller_server_id}
                    className="group relative flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-xl hover:border-emerald-500/30 transition-all"
                  >
                    {/* Info do Servidor */}
                    <div className="flex items-center gap-4 mb-3 sm:mb-0">
                      <div className="w-10 h-10 rounded-lg bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 flex items-center justify-center font-bold text-slate-600 dark:text-white">
                        {String(s.server_name || "?").charAt(0)}
                      </div>
                      <div>
                        <div className="font-bold text-slate-800 dark:text-white text-sm">{s.server_name}</div>
                        <div className="text-xs text-slate-500 dark:text-white/50 flex items-center gap-2">
                          <span>User: {s.server_username || "—"}</span>
                          {s.server_password && (
                            <span className="text-[10px] px-1.5 rounded bg-slate-200 dark:bg-white/10 opacity-70">
                              Senha salva
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Ações */}
                      <div className="flex items-center gap-2 self-end sm:self-auto">
                        {/* Botão de Recarga mantido em destaque textual, mas alinhado */}
                        <button
                          onClick={() => {
                            setQrResellerServerId(s.reseller_server_id);
                            setQrOpen(true);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold border border-emerald-500/20 hover:bg-emerald-500/20 transition-all mr-1"
                        >
                          + Recarga
                        </button>

                        <IconActionBtn
                          title="Editar Vínculo"
                          tone="amber"
                          onClick={() => {
                            setEditLink({
                              resellerServerId: s.reseller_server_id,
                              initial: {
                                server_id: s.server_id ?? null,
                                server_username: s.server_username ?? null,
                                server_password: s.server_password ?? null,
                              },
                            });
                            setShowServerModal(true);
                          }}
                        >
                          <IconEdit />
                        </IconActionBtn>

                        <IconActionBtn
                          title="Remover Vínculo"
                          tone="red"
                          onClick={() => handleDeleteLink(s.reseller_server_id, s.server_name)}
                        >
                          <IconTrash />
                        </IconActionBtn>
                      </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* BLOCO 2: HISTÓRICO */}
          <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl p-5 shadow-sm h-fit transition-colors">
            <h3 className="text-[11px] font-bold text-slate-400 dark:text-white/20 uppercase mb-6 tracking-widest flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              Histórico de Compras
            </h3>

            <div className="space-y-0 px-2">
              {history.length === 0 ? (
                <div className="py-12 text-center text-slate-400 dark:text-white/20 text-sm italic border-2 border-dashed border-slate-100 dark:border-white/5 rounded-xl">
                  Nenhuma movimentação registrada.
                </div>
              ) : (
                history.map((h) => {
                  const serverName =
                    (h.server_id ? serverNameById.get(String(h.server_id)) : null) || "Desconhecido";

                  const total =
                    num((h as any).total_brl) ||
                    num((h as any).total_amount_brl) ||
                    num((h as any).total_amount) ||
                    0;

                  return (
                    <div
                      key={String(h.id)}
                      className="relative pl-8 pb-1.5 last:pb-0 border-l-2 border-slate-100 dark:border-white/5 last:border-0 group"
                    >
                      <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full border-4 border-white dark:border-[#161b22] bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)] transition-transform group-hover:scale-125" />

                      <div className="flex justify-between items-start gap-2 bg-slate-50/50 dark:bg-white/5 p-2 rounded-xl border border-transparent hover:border-slate-200 dark:hover:border-white/10 transition-all">
                        <div className="min-w-0">
                          {/* LINHA 1 — TÍTULO */}
                          <div className="text-sm font-bold text-slate-800 dark:text-white tracking-tight">
                            Compra de Créditos 
                          </div>

                          {/* LINHA 2 — TEXTO COMPLETO (UMA LINHA) */}
                          <div className="mt-1 text-xs font-medium text-slate-400 dark:text-white tracking-tight">
                            Servidor: {serverName}  (
                            {num(h.qty_credits)} Créditos | 
                            Unit: {fmtMoney(String(h.currency || "BRL"), Number(h.unit_price || 0))}  | 
                            Total: {fmtBRL(total)})
                          </div>
                        </div>

                        <div className="text-[10px] font-bold text-slate-400 dark:text-white/20 font-mono bg-white dark:bg-black/20 px-2 py-1 rounded-md shadow-sm whitespace-nowrap">
                          {fmtDate(h.created_at ?? null)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* MODAIS */}
      {qrOpen && (
        <QuickRechargeModal
          resellerId={String(resellerId || "")}
          resellerName={reseller?.name ?? ""}
          resellerServerId={qrResellerServerId}
          lockServer={true}
          onClose={() => setQrOpen(false)}
          onDone={async () => {
            setQrOpen(false);
            addToast("success", "Recarga realizada!");
            await loadData();
          }}
          onError={(msg) => addToast("error", "Erro na recarga", msg)}
        />
      )}

      {showServerModal && (
        <VincularServidor
          resellerId={String(resellerId || "")}
          resellerServerId={editLink.resellerServerId}
          initial={editLink.initial}
          onClose={() => setShowServerModal(false)}
          onSaved={async () => {
            setShowServerModal(false);
            addToast("success", editLink.resellerServerId ? "Vínculo atualizado" : "Servidor vinculado");
            await loadData();
          }}
          onError={(msg) => addToast("error", "Erro", msg)}
        />
      )}

{/* ✅ OBRIGATÓRIO: O componente do popup precisa estar aqui */}
      {ConfirmUI}

{/* ✅ Spacer do Rodapé (Contrato UI) */}
      <div className="h-24 md:h-20" />
      <div className="relative z-[999999]">
  <ToastNotifications toasts={toasts} removeToast={removeToast} />
</div>

    </div>
  );
}

// Ícones Auxiliares
function IconEdit() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
function IconActionBtn({
  children,
  title,
  tone,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  tone: "blue" | "green" | "amber" | "purple" | "red";
  onClick: (e: React.MouseEvent) => void;
}) {
  const colors = {
    blue: "text-sky-500 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/20 hover:bg-sky-100 dark:hover:bg-sky-500/20",
    green: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100 dark:hover:bg-emerald-500/20",
    amber: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 hover:bg-amber-100 dark:hover:bg-amber-500/20",
    purple: "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/20 hover:bg-purple-100 dark:hover:bg-purple-500/20",
    red: "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 hover:bg-rose-100 dark:hover:bg-rose-500/20",
  };

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      title={title}
      className={`p-1.5 rounded-lg border transition-all ${colors[tone]}`}
    >
      {children}
    </button>
  );
}

function IconRestore() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><polyline points="21 3 21 9 15 9" /></svg>; }
function IconWhatsapp() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>; }
