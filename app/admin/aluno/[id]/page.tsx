"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "../../ToastNotifications";
import { useConfirm } from "@/app/admin/HookuseConfirm";

// Componentes
import NovoAluno from "../NovoAluno";
import RecargaAluno from "../RecargaAluno";

// --- HELPERS ---
function formatPhoneDisplay(e164: string | null | undefined) {
  if (!e164) return "Não informado";
  const digits = String(e164).replace(/\D+/g, "");
  if (!digits) return "Não informado";
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

function tableLabelFromClient(c: { plan_table_name?: string | null } | null | undefined) {
  const raw = String(c?.plan_table_name ?? "").trim();
  if (!raw || raw === "—") return "—";
  return raw;
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
  const formatted = new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur || "BRL" }).format(n);
  return formatted.replace(/^US(\$)/, "$1");
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

function calcIMC(altura_cm: number, peso_kg: number): number {
  if (!altura_cm || !peso_kg) return 0;
  const h = altura_cm / 100;
  return peso_kg / (h * h);
}

// --- TIPOS ---
type ClientDetail = {
  id: string;
  client_name: string;
  username: string;
  server_id: string;
  server_name: string;
  technology: string | null;
  plan_name: string;
  price_amount: number | null;
  price_currency: string | null;
  plan_table_id?: string | null;
  plan_table_name?: string | null;
  vencimento: string | null;
  computed_status: string;
  client_is_archived: boolean;
  screens: number;
  whatsapp_e164: string | null;
  whatsapp_username: string | null;
  whatsapp_opt_in: boolean | null;
  dont_message_until: string | null;
  name_prefix?: string | null;
  secondary_display_name?: string | null;
  secondary_name_prefix?: string | null;
  secondary_phone_e164?: string | null;
  secondary_whatsapp_username?: string | null;
  apps_names: string[] | null;
  alerts_open: number;
  notes: string | null;
  m3u_url: string | null;
  server_password?: string | null;
  created_at: string | null;
  dados_extras?: any; // Adicionado para carregar os dados de saúde e foto
};

type TimelineItem = {
  id: string;
  created_at: string;
  event_type: string;
  message: string | null;
  meta: any;
};

// --- COMPONENTE GRÁFICO ---
function EvolucaoChart({ avaliacoes }: { avaliacoes: any[] }) {
  if (!avaliacoes || avaliacoes.length < 2) {
    return <div className="text-xs text-slate-400 italic py-6 text-center">Gráfico disponível a partir da segunda avaliação.</div>;
  }

  const sorted = [...avaliacoes].sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime()).slice(-6);
  
  const pesos = sorted.map(a => Number(a.peso_kg || 0));
  const minPeso = Math.min(...pesos) - 2;
  const maxPeso = Math.max(...pesos) + 2;

  const w = 400; const h = 120;
  const padX = 20; const padY = 20;

  const getPoints = (values: number[], min: number, max: number) => {
    return values.map((val, i) => {
      const x = padX + (i * (w - 2 * padX)) / (values.length - 1);
      const y = h - padY - ((val - min) / (max - min)) * (h - 2 * padY);
      return `${x},${y}`;
    }).join(" ");
  };

  return (
    <div className="w-full overflow-x-auto">
      <div className="min-w-[400px]">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto drop-shadow-sm">
          {/* Linha de Peso */}
          <polyline fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={getPoints(pesos, minPeso, maxPeso)} />
          {/* Pontos de Peso */}
          {pesos.map((val, i) => {
            const x = padX + (i * (w - 2 * padX)) / (pesos.length - 1);
            const y = h - padY - ((val - minPeso) / (maxPeso - minPeso)) * (h - 2 * padY);
            return (
              <g key={`w-${i}`}>
                <circle cx={x} cy={y} r="4" fill="#fff" stroke="#10b981" strokeWidth="2" />
                <text x={x} y={y - 10} fontSize="10" fill="#64748b" textAnchor="middle" fontWeight="bold">{val}kg</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export default function ClientDetailsPage() {
  const params = useParams();
  const { confirm, ConfirmUI } = useConfirm();
  const p = params as any;
  const clientIdRaw = (p?.id ?? p?.client_id ?? p?.clientId ?? p?.clienteId) as string | string[] | undefined;
  const clientId = Array.isArray(clientIdRaw) ? clientIdRaw[0] : clientIdRaw;
  const clientIdSafe = (clientId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);

  const [showEditModal, setShowEditModal] = useState(false);
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [editClientPayload, setEditClientPayload] = useState<any>(null);

  const [isEditingLoading, setIsEditingLoading] = useState(false);
  const [isRenewLoading, setIsRenewLoading] = useState(false);
  const [showRenewWarning, setShowRenewWarning] = useState(false);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);

  const dadosExtras = useMemo(() => client?.dados_extras || {}, [client]);
  const avaliacoes = useMemo(() => {
    return Array.isArray(dadosExtras.saude?.avaliacoes) 
      ? [...dadosExtras.saude.avaliacoes].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()) 
      : [];
  }, [dadosExtras]);

  async function handleDeleteEvent(item: TimelineItem) {
    const ok = await confirm({
      tone: "rose", title: "Apagar registro?", subtitle: "Este evento será removido da linha do tempo permanentemente.",
      details: [ `Data: ${fmtDate(item.created_at)}`, item.message ? `Msg: ${item.message.slice(0, 60)}` : "" ].filter(Boolean),
      confirmText: "Apagar", cancelText: "Voltar",
    });
    if (!ok) return;

    setDeletingEventId(item.id);
    try {
      const tid = await getCurrentTenantId();
      const { error } = await supabaseBrowser.from("client_events").delete().eq("id", item.id).eq("tenant_id", tid);
      if (error) throw error;
      setTimeline(prev => prev.filter(e => e.id !== item.id));
      addToast("success", "Registro apagado", "Evento removido da linha do tempo.");
    } catch (e: any) {
      addToast("error", "Erro ao apagar", e?.message || "Falha ao deletar evento.");
    } finally {
      setDeletingEventId(null);
    }
  }

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
      if (!tid) throw new Error("Tenant não encontrado");

      let localAppsById: Record<string, any> = {};
      const { data: rawAppsData } = await supabaseBrowser.rpc("get_my_visible_apps");
      if (rawAppsData) for (const a of rawAppsData) if (a?.id) localAppsById[String(a.id)] = a;

      const r1 = await supabaseBrowser.from("vw_clients_list_active").select("*").eq("tenant_id", tid).eq("id", clientIdSafe).maybeSingle();
      const r2 = r1.data ? { data: null as any } : await supabaseBrowser.from("vw_clients_list_archived").select("*").eq("tenant_id", tid).eq("id", clientIdSafe).maybeSingle();
      const row = ((r1.data || r2.data) as any) ?? null;

      if (!row) throw new Error("Cliente não encontrado");

      let dbPlanTableId = null, dbNotes = null, dbPriceCurrency = null, finalTableName = null, dbM3uUrl = null, dbCreatedAt = null, dbSecName = null, dbSecPhone = null, dbSecUsername = null, dbNamePrefix = null, dbDadosExtras = null;

      const c = await supabaseBrowser.from("clients")
        .select("plan_table_id, notes, price_currency, m3u_url, created_at, secondary_display_name, secondary_phone_e164, secondary_whatsapp_username, name_prefix, dados_extras") 
        .eq("tenant_id", tid).eq("id", clientIdSafe).maybeSingle();

      if (c.data) {
        dbCreatedAt = c.data.created_at; dbPlanTableId = c.data.plan_table_id; dbNotes = c.data.notes;
        dbPriceCurrency = c.data.price_currency; dbM3uUrl = c.data.m3u_url; dbSecName = c.data.secondary_display_name;
        dbSecPhone = c.data.secondary_phone_e164; dbSecUsername = c.data.secondary_whatsapp_username; dbNamePrefix = c.data.name_prefix;
        dbDadosExtras = c.data.dados_extras;
      }

      const viewNameRaw = String(row.plan_table_name ?? "").trim();
      if (viewNameRaw && viewNameRaw !== "—") finalTableName = viewNameRaw;
      if (dbPlanTableId) {
        const t = await supabaseBrowser.from("plan_tables").select("name").eq("id", dbPlanTableId).maybeSingle();
        if (t.data?.name) finalTableName = String(t.data.name);
      }

      const mapped: ClientDetail = {
        id: String(row.id), client_name: String(row.client_name ?? "Sem Nome"), username: String(row.username ?? "—"),
        server_id: String(row.server_id ?? ""), server_name: String(row.server_name ?? row.server_id ?? "—"), technology: row.technology ?? "—",
        plan_name: String(row.plan_name ?? "—"), price_amount: row.price_amount ?? null, price_currency: dbPriceCurrency ?? row.price_currency ?? "BRL",
        plan_table_id: dbPlanTableId ?? row.plan_table_id ?? null, plan_table_name: finalTableName ?? null,
        vencimento: row.vencimento ?? null, computed_status: String(row.computed_status ?? "ACTIVE"), client_is_archived: Boolean(row.client_is_archived),
        screens: Number(row.screens || 1), whatsapp_e164: row.whatsapp_e164 ?? null, whatsapp_username: row.whatsapp_username ?? null,
        whatsapp_opt_in: typeof row.whatsapp_opt_in === "boolean" ? row.whatsapp_opt_in : true, dont_message_until: row.dont_message_until ?? null,
        name_prefix: dbNamePrefix ?? row.name_prefix ?? null, secondary_display_name: dbSecName ?? row.secondary_display_name ?? null,
        secondary_phone_e164: dbSecPhone ?? row.secondary_phone_e164 ?? null, secondary_whatsapp_username: dbSecUsername ?? row.secondary_whatsapp_username ?? null,
        apps_names: row.apps_names ?? null, alerts_open: Number(row.alerts_open || 0), notes: dbNotes ?? row.notes ?? "",
        m3u_url: dbM3uUrl ?? null, server_password: row.server_password ?? null, created_at: dbCreatedAt ?? row.created_at ?? null,
        dados_extras: dbDadosExtras ?? {}
      };

      const { data: appsData } = await supabaseBrowser.from("client_apps").select("id, app_id, field_values").eq("client_id", mapped.id);
      if (appsData) {
        (mapped as any).apps_details = appsData.map((item: any) => {
           const catalogApp = localAppsById[String(item.app_id)];
           const vals = item.field_values || {};
           const config = Array.isArray(catalogApp?.fields_config) ? catalogApp.fields_config : [];
           let expiration = vals["Vencimento"] || vals["vencimento"] || vals["VENCIMENTO"] || null;
           if (!expiration) {
              const dateField = config.find((f: any) => f.type === 'date' || /vencimento/i.test(f.label));
              if (dateField) expiration = vals[dateField.id] || vals[dateField.label] || null;
           }
           return { id: item.id, name: catalogApp?.name || "App", expiration, integration_type: catalogApp?.integration_type };
        });
      }

      setClient(mapped);

      const ev = await supabaseBrowser.from("client_events").select("id, created_at, event_type, message, meta")
        .eq("tenant_id", tid).eq("client_id", mapped.id).order("created_at", { ascending: false }).limit(200);
      if (ev.data) setTimeline(ev.data as any);

    } catch (e: any) {
      addToast("error", "Falha ao carregar aluno", e.message);
      setClient(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [clientId]);

  async function handleArchiveToggle() {
    if (!client) return;
    const goingToArchive = !client.client_is_archived;
    const ok = await confirm({
      tone: goingToArchive ? "rose" : "emerald",
      title: goingToArchive ? "Arquivar aluno?" : "Restaurar aluno?",
      subtitle: goingToArchive ? "Ele irá para a Lixeira e não aparecerá na lista principal." : "Ele voltará para a lista principal.",
      details: [ `Aluno: ${client.client_name}` ],
      confirmText: goingToArchive ? "Arquivar" : "Restaurar", cancelText: "Voltar",
    });
    if (!ok) return;

    try {
      const tid = await getCurrentTenantId();
      const { error } = await supabaseBrowser.rpc("update_client", { p_tenant_id: tid, p_client_id: client.id, p_is_archived: goingToArchive });
      if (error) throw error;
      addToast("success", goingToArchive ? "Aluno arquivado" : "Aluno restaurado");
      loadData();
    } catch (e: any) { addToast("error", "Falha ao atualizar", e.message); }
  }

  const handleDeleteForever = async () => {
    if (!client || !client.client_is_archived) return;
    const ok = await confirm({
      title: "Excluir definitivamente?", subtitle: "Isso vai remover o aluno e TODOS os seus registros permanentemente.",
      tone: "rose", confirmText: "Excluir definitivo", cancelText: "Voltar",
    });
    if (!ok) return;

    try {
      const tid = await getCurrentTenantId();
      const { error } = await supabaseBrowser.rpc("delete_client_forever", { p_tenant_id: tid, p_client_id: client.id });
      if (error) throw error;
      window.location.href = "/admin/aluno"; 
    } catch (e: any) { addToast("error", "Erro ao excluir", e.message); }
  };

  const handleRenewClick = () => {
    if (client && client.alerts_open > 0) setShowRenewWarning(true);
    else setShowRenewModal(true);
  };

  // Gerador de PDF Profissional estilo InBody
  function gerarPDFAvaliacao(av: any) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    
    const alturaCm = Number(dadosExtras.saude?.altura_cm || 0);
    const alturaM = alturaCm / 100;
    const pesoKg = Number(av.peso_kg || 0);
    const imc = (pesoKg > 0 && alturaM > 0) ? (pesoKg / (alturaM * alturaM)) : 0;
    const pesoIdeal = alturaM > 0 ? (22 * alturaM * alturaM) : 0;
    const difPeso = pesoKg > 0 && pesoIdeal > 0 ? (pesoKg - pesoIdeal) : 0;

    // Barras de progresso visual (Escala InBody aproximada)
    const renderBar = (val: number, normalMin: number, normalMax: number) => {
      const pct = Math.min(Math.max((val / (normalMax * 1.5)) * 100, 5), 100);
      return `<div class="w-full bg-slate-100 h-4 rounded-full overflow-hidden flex relative"><div class="h-full bg-emerald-500 absolute left-0 top-0" style="width: ${pct}%"></div><div class="absolute left-1/3 w-1/3 h-full border-x-2 border-slate-400/30 bg-black/5"></div></div>`;
    };

    const html = `
      <html>
        <head>
          <title>Avaliação Física - ${client?.client_name || 'Aluno'}</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <style>
            @media print { @page { margin: 10mm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
            .inbody-table th, .inbody-table td { border-bottom: 1px solid #e2e8f0; padding: 8px 4px; text-align: left; }
            .inbody-table th { color: #64748b; font-size: 11px; text-transform: uppercase; font-weight: bold; }
            .section-title { font-size: 14px; font-weight: 900; color: #1e293b; background: #f8fafc; padding: 6px 12px; border-left: 4px solid #10b981; margin: 24px 0 12px 0; }
          </style>
        </head>
        <body class="p-6 text-slate-800 font-sans bg-white text-sm">
          <div class="max-w-4xl mx-auto border-2 border-slate-800 p-8">
            
            <div class="flex justify-between items-end border-b-2 border-slate-800 pb-4 mb-4">
              <div>
                <h1 class="text-3xl font-black text-slate-900 tracking-tighter">UniGestor<span class="text-emerald-500">Body</span></h1>
                <p class="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">Análise de Composição Corporal</p>
              </div>
              <div class="text-right text-xs">
                <p><strong>ID:</strong> ${client?.id.split('-')[0].toUpperCase()}</p>
                <p><strong>Data / Hora:</strong> ${new Date(av.data + "T12:00:00").toLocaleDateString("pt-BR")} 12:00</p>
              </div>
            </div>

            <div class="grid grid-cols-4 gap-4 mb-6 text-xs border border-slate-200 p-3 bg-slate-50">
              <div><span class="block text-slate-500 font-bold">Nome</span><span class="font-black text-base">${client?.client_name}</span></div>
              <div><span class="block text-slate-500 font-bold">Altura</span><span class="font-black text-base">${alturaCm || '--'} cm</span></div>
              <div><span class="block text-slate-500 font-bold">Idade</span><span class="font-black text-base">${dadosExtras.data_nascimento ? new Date().getFullYear() - new Date(dadosExtras.data_nascimento).getFullYear() : '--'}</span></div>
              <div><span class="block text-slate-500 font-bold">Gênero</span><span class="font-black text-base">${client?.name_prefix === 'Sra.' || client?.name_prefix === 'Dra.' ? 'Feminino' : 'Masculino'}</span></div>
            </div>

            <div class="section-title">Análise da Composição Corporal</div>
            <table class="w-full inbody-table mb-2">
              <tr>
                <th class="w-1/2">Componente</th>
                <th class="w-1/4">Valores Obtidos</th>
                <th class="w-1/4">Faixa Normal</th>
              </tr>
              <tr>
                <td><strong>Água Corporal Total</strong> <span class="text-xs text-slate-400">(L)</span></td>
                <td class="font-bold text-lg">${pesoKg > 0 ? (pesoKg * 0.6).toFixed(1) : '--'}</td>
                <td class="text-slate-500">${pesoIdeal > 0 ? (pesoIdeal * 0.55).toFixed(1) + '~' + (pesoIdeal * 0.65).toFixed(1) : '--'}</td>
              </tr>
              <tr>
                <td><strong>Massa Livre de Gordura (Massa Magra)</strong> <span class="text-xs text-slate-400">(kg)</span></td>
                <td class="font-bold text-lg text-emerald-600">${av.massa_magra_kg || '--'}</td>
                <td class="text-slate-500">${pesoIdeal > 0 ? (pesoIdeal * 0.75).toFixed(1) + '~' + (pesoIdeal * 0.85).toFixed(1) : '--'}</td>
              </tr>
              <tr>
                <td><strong>Massa de Gordura</strong> <span class="text-xs text-slate-400">(kg)</span></td>
                <td class="font-bold text-lg text-rose-500">${av.gordura_pct && pesoKg ? ((av.gordura_pct / 100) * pesoKg).toFixed(1) : '--'}</td>
                <td class="text-slate-500">${pesoIdeal > 0 ? (pesoIdeal * 0.10).toFixed(1) + '~' + (pesoIdeal * 0.20).toFixed(1) : '--'}</td>
              </tr>
              <tr class="bg-slate-50">
                <td><strong>Peso Total</strong> <span class="text-xs text-slate-400">(kg)</span></td>
                <td class="font-black text-xl">${av.peso_kg || '--'}</td>
                <td class="text-slate-500">${pesoIdeal > 0 ? (pesoIdeal * 0.9).toFixed(1) + '~' + (pesoIdeal * 1.1).toFixed(1) : '--'}</td>
              </tr>
            </table>

            <div class="section-title">Análise Músculo-Gordura</div>
            <div class="space-y-4 px-2">
              <div class="grid grid-cols-[120px_1fr_60px] items-center gap-4">
                <span class="font-bold text-xs">Peso (kg)</span>
                ${renderBar(pesoKg, pesoIdeal * 0.9, pesoIdeal * 1.1)}
                <span class="font-black text-right">${av.peso_kg || '--'}</span>
              </div>
              <div class="grid grid-cols-[120px_1fr_60px] items-center gap-4">
                <span class="font-bold text-xs">Massa Magra (kg)</span>
                ${renderBar(Number(av.massa_magra_kg || 0), pesoIdeal * 0.75, pesoIdeal * 0.85)}
                <span class="font-black text-right">${av.massa_magra_kg || '--'}</span>
              </div>
              <div class="grid grid-cols-[120px_1fr_60px] items-center gap-4">
                <span class="font-bold text-xs">Massa Gorda (kg)</span>
                ${renderBar(av.gordura_pct && pesoKg ? (av.gordura_pct / 100) * pesoKg : 0, pesoIdeal * 0.10, pesoIdeal * 0.20)}
                <span class="font-black text-right">${av.gordura_pct && pesoKg ? ((av.gordura_pct / 100) * pesoKg).toFixed(1) : '--'}</span>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-8 mt-6">
              <div>
                <div class="section-title !mt-0">Análise de Obesidade</div>
                <table class="w-full inbody-table">
                  <tr><td><strong>IMC</strong> <span class="text-xs text-slate-400">(kg/m²)</span></td><td class="font-black text-lg text-indigo-600">${imc > 0 ? imc.toFixed(1) : '--'}</td></tr>
                  <tr><td><strong>PGC</strong> <span class="text-xs text-slate-400">(% Gordura)</span></td><td class="font-black text-lg text-rose-500">${av.gordura_pct || '--'}</td></tr>
                </table>
              </div>
              <div>
                <div class="section-title !mt-0">Controle de Peso</div>
                <table class="w-full inbody-table">
                  <tr><td><strong>Peso Ideal</strong></td><td class="font-bold">${pesoIdeal > 0 ? pesoIdeal.toFixed(1) + ' kg' : '--'}</td></tr>
                  <tr><td><strong>Controle de Peso</strong></td><td class="font-bold ${difPeso > 0 ? 'text-rose-500' : 'text-emerald-500'}">${difPeso !== 0 ? (difPeso > 0 ? '-' : '+') + Math.abs(difPeso).toFixed(1) + ' kg' : '0.0 kg'}</td></tr>
                </table>
              </div>
            </div>

            <div class="section-title">Perimetria Corporal (cm)</div>
            <div class="grid grid-cols-4 gap-4 text-center">
              <div class="p-2 border border-slate-200 rounded bg-slate-50"><span class="block text-[10px] uppercase font-bold text-slate-400">Cintura</span><span class="font-black text-lg">${av.cintura_cm || '--'}</span></div>
              <div class="p-2 border border-slate-200 rounded bg-slate-50"><span class="block text-[10px] uppercase font-bold text-slate-400">Quadril</span><span class="font-black text-lg">${av.quadril_cm || '--'}</span></div>
              <div class="p-2 border border-slate-200 rounded bg-slate-50"><span class="block text-[10px] uppercase font-bold text-slate-400">Abdômen</span><span class="font-black text-lg">${av.abdomen_cm || '--'}</span></div>
              <div class="p-2 border border-slate-200 rounded bg-slate-50"><span class="block text-[10px] uppercase font-bold text-slate-400">Ombro</span><span class="font-black text-lg">${av.ombro_cm || '--'}</span></div>
              <div class="p-2 border border-slate-200 rounded bg-slate-50"><span class="block text-[10px] uppercase font-bold text-slate-400">Braço</span><span class="font-black text-lg">${av.braco_cm || '--'}</span></div>
              <div class="p-2 border border-slate-200 rounded bg-slate-50"><span class="block text-[10px] uppercase font-bold text-slate-400">Coxa</span><span class="font-black text-lg">${av.coxa_cm || '--'}</span></div>
              <div class="p-2 border border-slate-200 rounded bg-slate-50"><span class="block text-[10px] uppercase font-bold text-slate-400">Panturrilha</span><span class="font-black text-lg">${av.panturrilha_cm || '--'}</span></div>
            </div>

            ${av.observacoes ? `
            <div class="section-title">Observações do Treinador</div>
            <p class="text-sm bg-slate-50 p-4 border border-slate-200 italic">${av.observacoes.replace(/\n/g, '<br/>')}</p>
            ` : ''}

            <div class="mt-8 text-center text-[10px] text-slate-400 uppercase tracking-widest border-t-2 border-slate-800 pt-4">
              Documento gerado digitalmente • UniGestor Health & Performance
            </div>
          </div>
          <script>window.onload = () => { setTimeout(() => { window.print(); window.close(); }, 500); }</script>
        </body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
  }

  const EVENT_LABELS: Record<string, any> = {
    RENEWAL: "💰 Pagamento/Renovação", CLIENT_CREATED: "🆕 Matrícula criada", TRIAL_CREATED: "⏱️ Aula Experimental",
    CLIENT_ARCHIVED: "📦 Arquivado", CLIENT_RESTORED: "♻️ Restaurado", TRIAL_CONVERTED: "✨ Matrícula confirmada",
  };

  if (loading) return <div className="p-10 text-center text-slate-400 dark:text-white/20 animate-pulse font-medium">Carregando prontuário...</div>;
  if (!client) return <div className="p-10 text-center text-rose-500 font-bold">Aluno não encontrado.</div>;

  return (
    <div className="space-y-4 sm:space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors">
      
      {/* HEADER ACTIONS (Apenas botões de ação e voltar no topo) */}
      <div className="flex items-center justify-between gap-3 pb-0 px-4 sm:px-0 pt-4 sm:pt-0">
        <Link href="/admin/aluno" className="h-9 px-3 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 font-bold text-xs hover:bg-slate-200 dark:hover:bg-white/5 transition-all inline-flex items-center justify-center">
          ← Voltar aos Alunos
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => {
              setEditClientPayload({
                id: client.id, client_name: client.client_name, name_prefix: client.name_prefix ?? undefined,
                username: client.username, server_password: client.server_password ?? undefined,
                whatsapp_e164: client.whatsapp_e164 ?? undefined, whatsapp_username: client.whatsapp_username ?? undefined,
                whatsapp_opt_in: client.whatsapp_opt_in ?? true, secondary_display_name: client.secondary_display_name ?? undefined,
                secondary_name_prefix: client.secondary_name_prefix ?? undefined, secondary_phone_e164: client.secondary_phone_e164 ?? undefined,
                secondary_whatsapp_username: client.secondary_whatsapp_username ?? undefined, dont_message_until: client.dont_message_until ?? undefined,
                server_id: client.server_id, screens: client.screens, technology: client.technology ?? undefined,
                plan_name: client.plan_name ?? undefined, price_amount: client.price_amount ?? undefined, price_currency: client.price_currency ?? undefined,
                plan_table_id: (client as any).plan_table_id ?? null, plan_table_name: (client as any).plan_table_name ?? null,
                m3u_url: client.m3u_url ?? undefined, vencimento: client.vencimento ?? undefined, notes: client.notes ?? undefined, apps_names: client.apps_names ?? undefined,
                dados: client.dados_extras // Passa os dados extras de volta pro modal editar
              });
              setShowEditModal(true);
            }}
            className="h-9 px-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 font-bold text-xs hover:bg-amber-500/20 transition-all shadow-sm inline-flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            Editar Cadastro
          </button>
          <button
            onClick={handleRenewClick}
            className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-900/20 transition-all inline-flex items-center gap-2"
          >
            💰 Receber Mensalidade
          </button>
        </div>
      </div>

      {/* TOP BANNER: FOTO E INFORMAÇÕES PESSOAIS */}
      <div className="bg-white dark:bg-[#161b22] border-y sm:border border-slate-200 dark:border-white/10 sm:rounded-2xl p-6 shadow-sm flex flex-col md:flex-row gap-8 items-start">
        {/* Foto Ampliada */}
        <div className="w-full md:w-64 shrink-0 flex flex-col gap-2">
          {dadosExtras.foto_url ? (
            <img src={dadosExtras.foto_url} alt="Foto do Aluno" className="w-full h-64 object-cover rounded-2xl shadow-inner border-4 border-slate-50 dark:border-black/20" />
          ) : (
            <div className="w-full h-64 bg-slate-100 dark:bg-white/5 rounded-2xl flex items-center justify-center border-2 border-dashed border-slate-300 dark:border-white/10 text-slate-400 text-4xl">
              👤
            </div>
          )}
          <StatusBadge status={client.computed_status} />
        </div>

        {/* Informações Principais */}
        <div className="flex-1 w-full space-y-6">
          <div>
            <h1 className="text-3xl font-black text-slate-800 dark:text-white tracking-tight leading-tight">
              {client.name_prefix ? `${client.name_prefix} ` : ""}{client.client_name}
            </h1>
            <p className="text-sm font-mono text-slate-500 dark:text-white/50 mt-1">@{client.username}</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-50 dark:bg-white/5 p-3 rounded-xl border border-slate-100 dark:border-white/5">
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Nascimento</span>
              <span className="font-bold text-slate-700 dark:text-white">{dadosExtras.data_nascimento ? new Date(dadosExtras.data_nascimento + "T12:00:00").toLocaleDateString("pt-BR") : "Não informado"}</span>
            </div>
            <div className="bg-slate-50 dark:bg-white/5 p-3 rounded-xl border border-slate-100 dark:border-white/5">
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">CPF / RG</span>
              <span className="font-bold font-mono text-slate-700 dark:text-white">{dadosExtras.cpf_rg || "Não informado"}</span>
            </div>
            <div className="bg-slate-50 dark:bg-white/5 p-3 rounded-xl border border-slate-100 dark:border-white/5">
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Modalidade</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">{dadosExtras.modalidade || "Geral"}</span>
            </div>
            <div className="bg-slate-50 dark:bg-white/5 p-3 rounded-xl border border-slate-100 dark:border-white/5">
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Cadastro</span>
              <span className="font-bold text-slate-700 dark:text-white">{client.created_at ? new Date(client.created_at).toLocaleDateString("pt-BR") : "—"}</span>
            </div>
          </div>

          {/* Campos Personalizados (Faixa, Nível, etc) */}
          {dadosExtras.campos_detalhamento && dadosExtras.campos_detalhamento.length > 0 && (
            <div>
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 border-b border-slate-100 dark:border-white/10 pb-1">Detalhamento da Modalidade</span>
              <div className="flex flex-wrap gap-2">
                {dadosExtras.campos_detalhamento.map((c: any) => (
                  <div key={c.id} className="inline-flex items-center gap-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 px-3 py-1.5 rounded-lg text-xs">
                    <span className="text-slate-500 font-medium">{c.label}:</span>
                    <span className="font-bold text-slate-800 dark:text-white">{c.tipo === 'date' && c.value ? new Date(c.value + "T12:00:00").toLocaleDateString("pt-BR") : c.value || "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MAIN GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 px-0 sm:px-0">
        
        {/* COLUNA ESQUERDA (Info Admin e Saúde) */}
        <div className="space-y-4 sm:space-y-6">
          
          {/* CARD: ASSINATURA E FINANCEIRO */}
          <div className="bg-white dark:bg-[#161b22] border-y sm:border border-slate-200 dark:border-white/10 sm:rounded-xl p-5 shadow-sm transition-colors">
            <h3 className="text-[11px] font-bold text-slate-400 dark:text-white/20 uppercase mb-4 tracking-widest flex items-center gap-2">
              <span className="text-base">💳</span> Plano e Financeiro
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center pb-2 border-b border-slate-50 dark:border-white/5"><span className="text-slate-500 font-medium">Tabela</span><span className="font-bold text-slate-800 dark:text-white text-right">{tableLabelFromClient(client)}</span></div>
              <div className="flex justify-between items-center pb-2 border-b border-slate-50 dark:border-white/5"><span className="text-slate-500 font-medium">Plano / Recorrência</span><span className="font-bold text-emerald-600 dark:text-emerald-400">{extractPeriod(client.plan_name)}</span></div>
              <div className="flex justify-between items-center pb-2 border-b border-slate-50 dark:border-white/5"><span className="text-slate-500 font-medium">Mensalidade</span><span className="font-mono font-bold text-slate-800 dark:text-white bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-md">{fmtMoney(client.price_amount, client.price_currency)}</span></div>
              
              <div className="pt-2">
                <div className="flex justify-between items-center bg-slate-50 dark:bg-white/5 p-3 rounded-lg border border-slate-100 dark:border-white/5 mt-1">
                  <span className="text-slate-500 dark:text-white/40 font-bold text-[11px] uppercase tracking-tight">Próximo Vencimento</span>
                  <div className={`text-right font-mono font-black text-base ${client.computed_status === "OVERDUE" ? "text-rose-500" : client.computed_status === "ACTIVE" ? "text-emerald-600" : "text-slate-500"}`}>
                    {client.vencimento ? fmtDateTime(client.vencimento) : "—"}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* CARD: CONTATOS */}
          <div className="bg-white dark:bg-[#161b22] border-y sm:border border-slate-200 dark:border-white/10 sm:rounded-xl p-5 shadow-sm transition-colors">
            <h3 className="text-[11px] font-bold text-slate-400 dark:text-white/20 uppercase mb-4 tracking-widest flex items-center gap-2">
              <span className="text-base">📱</span> Contatos
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center pb-2 border-b border-slate-50 dark:border-white/5">
                <span className="text-slate-500 font-medium">WhatsApp</span>
                {client.whatsapp_username ? (
                  <a href={`https://wa.me/${client.whatsapp_e164?.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold hover:underline">
                    @{client.whatsapp_username}
                  </a>
                ) : <span className="font-mono font-bold">{formatPhoneDisplay(client.whatsapp_e164)}</span>}
              </div>
              
              {client.secondary_display_name && (
                <div className="bg-rose-50 dark:bg-rose-500/5 p-3 rounded-lg border border-rose-100 dark:border-rose-500/10 mt-2">
                  <div className="text-[10px] font-bold text-rose-500 uppercase mb-1 tracking-widest flex items-center gap-1">🆘 Emergência</div>
                  <div className="flex justify-between items-center"><span className="text-xs text-rose-700 dark:text-rose-400 font-bold">{client.secondary_display_name}</span></div>
                  {client.secondary_phone_e164 && <div className="text-xs font-mono text-rose-600 dark:text-rose-400 mt-1">{formatPhoneDisplay(client.secondary_phone_e164)}</div>}
                </div>
              )}

              <div className="pt-2">
                <div className="text-[11px] font-bold text-slate-500 dark:text-white/30 mb-1.5">Observações da Secretaria</div>
                <div className="text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-black/20 p-3 rounded-xl text-xs leading-relaxed border border-slate-200 dark:border-white/5 min-h-[60px] whitespace-pre-wrap">
                  {client.notes ? client.notes : <span className="italic text-slate-400">Sem observações.</span>}
                </div>
              </div>
            </div>
          </div>

          {/* CARD: DADOS DE SAÚDE (ANAMNESE) */}
          <div className="bg-white dark:bg-[#161b22] border-y sm:border border-slate-200 dark:border-white/10 sm:rounded-xl p-5 shadow-sm transition-colors">
            <h3 className="text-[11px] font-bold text-slate-400 dark:text-white/20 uppercase mb-4 tracking-widest flex items-center gap-2">
              <span className="text-base">🏥</span> Dados de Saúde (Anamnese)
            </h3>
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 dark:bg-white/5 p-2.5 rounded-lg border border-slate-100 dark:border-white/5 flex items-center gap-2">
                  <span className="text-lg">{dadosExtras.saude?.fuma ? "🚬" : "✅"}</span>
                  <div><span className="block text-[9px] font-bold text-slate-400 uppercase">Tabagista</span><span className={`text-xs font-bold ${dadosExtras.saude?.fuma ? 'text-rose-500' : 'text-emerald-600'}`}>{dadosExtras.saude?.fuma ? "Sim" : "Não"}</span></div>
                </div>
                <div className="bg-slate-50 dark:bg-white/5 p-2.5 rounded-lg border border-slate-100 dark:border-white/5 flex items-center gap-2">
                  <span className="text-lg">{dadosExtras.saude?.bebe ? "🍺" : "✅"}</span>
                  <div><span className="block text-[9px] font-bold text-slate-400 uppercase">Etilista</span><span className={`text-xs font-bold ${dadosExtras.saude?.bebe ? 'text-amber-500' : 'text-emerald-600'}`}>{dadosExtras.saude?.bebe ? "Sim" : "Não"}</span></div>
                </div>
              </div>
              
              <div>
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Objetivo Principal</span>
                <span className="font-bold text-slate-700 dark:text-white">{dadosExtras.saude?.objetivo ? dadosExtras.saude.objetivo.replace(/_/g, ' ').toUpperCase() : "Não informado"}</span>
              </div>
              <div className="border-t border-slate-100 dark:border-white/5 pt-3">
                <span className="block text-[10px] font-bold text-rose-400 uppercase tracking-widest mb-1">Doenças Crônicas / Condições</span>
                <p className="text-xs text-slate-600 dark:text-white/70">{dadosExtras.saude?.doencas_cronicas || "Nenhuma registrada."}</p>
              </div>
              <div className="border-t border-slate-100 dark:border-white/5 pt-3">
                <span className="block text-[10px] font-bold text-orange-400 uppercase tracking-widest mb-1">Lesões / Limitações</span>
                <p className="text-xs text-slate-600 dark:text-white/70">{dadosExtras.saude?.lesoes || "Nenhuma registrada."}</p>
              </div>
              <div className="border-t border-slate-100 dark:border-white/5 pt-3">
                <span className="block text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-1">Histórico Médico Geral</span>
                <p className="text-xs text-slate-600 dark:text-white/70">{dadosExtras.saude?.historico_medico || "Nenhum registrado."}</p>
              </div>

              {dadosExtras.saude?.atestado_url && (
                <div className="border-t border-slate-100 dark:border-white/5 pt-4">
                  <a href={dadosExtras.saude.atestado_url} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 w-full p-3 rounded-xl bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/20 text-sky-700 dark:text-sky-400 text-xs font-bold hover:bg-sky-100 transition-colors">
                    📎 Visualizar Atestado Médico Anexo
                  </a>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* COLUNA DIREITA (Performance e Timeline) */}
        <div className="lg:col-span-2 space-y-4 sm:space-y-6 h-fit">
          
          {/* CARD: AVALIAÇÕES FÍSICAS E GRÁFICO */}
          <div className="bg-white dark:bg-[#161b22] border-y sm:border border-slate-200 dark:border-white/10 sm:rounded-xl p-5 shadow-sm transition-colors">
            <div className="flex justify-between items-end mb-6">
              <h3 className="text-[11px] font-bold text-slate-400 dark:text-white/20 uppercase tracking-widest flex items-center gap-2">
                <span className="text-base">📊</span> Avaliações e Performance
              </h3>
              <div className="text-right">
                <span className="block text-[10px] font-bold text-slate-400 uppercase">IMC Atual</span>
                <span className="font-black text-xl text-indigo-600">{dadosExtras.saude?.imc || "--"}</span>
              </div>
            </div>

            {/* GRÁFICO DE EVOLUÇÃO (SVG Puro) */}
            <div className="bg-slate-50 dark:bg-black/20 rounded-xl border border-slate-100 dark:border-white/5 p-4 mb-6">
              <span className="block text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest mb-4">Curva de Peso (Últimas Medições)</span>
              <EvolucaoChart avaliacoes={avaliacoes} />
            </div>

            {/* LISTA DE AVALIAÇÕES */}
            <div>
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Histórico de Relatórios</span>
              {avaliacoes.length === 0 ? (
                <div className="py-6 text-center text-slate-400 dark:text-white/20 text-sm italic border-2 border-dashed border-slate-100 dark:border-white/5 rounded-xl">
                  Nenhuma avaliação corporal registrada.
                </div>
              ) : (
                <div className="space-y-2">
                  {avaliacoes.map((av: any) => (
                    <div key={av.id} className="flex items-center justify-between p-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl hover:border-emerald-300 transition-colors group">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                        <span className="font-bold text-slate-700 dark:text-white text-sm">{new Date(av.data + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                        <div className="flex gap-3 text-xs text-slate-500 font-medium">
                          <span>⚖️ {av.peso_kg || '--'} kg</span>
                          <span>🔥 {av.gordura_pct || '--'} %</span>
                          <span className="text-emerald-600">💪 {av.massa_magra_kg || '--'} kg</span>
                        </div>
                      </div>
                      <button
                        onClick={() => gerarPDFAvaliacao(av)}
                        className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 rounded-lg font-bold text-[10px] uppercase tracking-wider transition-colors flex items-center gap-1.5 shadow-sm"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>
                        PDF InBody
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* CARD: TIMELINE */}
          <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl p-5 shadow-sm h-fit transition-colors">
            <h3 className="text-[11px] font-bold text-slate-400 dark:text-white/20 uppercase mb-6 tracking-widest flex items-center gap-2">
              <span className="text-base">⏳</span> Linha do tempo (Histórico de Ações)
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
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-slate-800 dark:text-white tracking-tight">
                          {EVENT_LABELS[item.event_type] ?? item.event_type}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-white/50 mt-1.5 leading-relaxed">
                          {item.message || (item.meta ? JSON.stringify(item.meta) : "")}
                        </div>
                      </div>
                      <div className="flex items-start gap-2 shrink-0">
                        <div className="text-[10px] font-bold text-slate-400 dark:text-white/20 font-mono bg-white dark:bg-black/20 px-2 py-1 rounded-md shadow-sm">
                          {fmtDate(item.created_at)}
                        </div>
                        <button
                          onClick={() => handleDeleteEvent(item)}
                          disabled={deletingEventId === item.id}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-400 hover:text-rose-500 disabled:opacity-30"
                          title="Apagar evento"
                        >
                          {deletingEventId === item.id ? (
                            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* --- MODAIS E ALERTAS --- */}
      {ConfirmUI}

      {showRenewWarning && client && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-200">
             <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-4 rounded-lg flex gap-3">
                <span className="text-2xl">📢</span>
                <div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-white mb-1">Aluno com Alertas</h3>
                  <p className="text-sm text-slate-700 dark:text-white/90">O aluno <strong className="text-amber-700 dark:text-amber-400">{client.client_name}</strong> possui pendências em aberto.</p>
                  <p className="text-xs text-slate-500 dark:text-white/60 mt-1">Verifique os alertas antes de renovar.</p>
                </div>
             </div>
             <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowRenewWarning(false)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-white/10 text-slate-700 dark:text-white font-bold hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-xs uppercase">Voltar</button>
                <button onClick={() => { setShowRenewWarning(false); setShowRenewModal(true); }} className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-500 transition-colors text-xs uppercase shadow-lg shadow-emerald-900/20">Ignorar e Receber</button>
             </div>
          </div>
        </div>
      )}

      {showEditModal && editClientPayload && (
        <NovoAluno
          alunoToEdit={editClientPayload}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => { setShowEditModal(false); loadData(); addToast("success", "Aluno atualizado", "Dados atualizados com sucesso."); }}
        />
      )}

      {showRenewModal && client && (
        <RecargaAluno
          clientId={client.id}
          clientName={client.client_name}
          onClose={() => setShowRenewModal(false)}
          onSuccess={() => { setShowEditModal(false); loadData(); addToast("success", "Renovação confirmada", "Mensalidade recebida."); }}
        />
      )}

      <div className="relative z-[999999]"><ToastNotifications toasts={toasts} removeToast={removeToast} /></div>
    </div>
  );
}