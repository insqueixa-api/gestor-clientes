"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "../../ToastNotifications";
import { useConfirm } from "@/app/admin/HookuseConfirm";

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
    ACTIVE: "bg-emerald-50 text-emerald-600 border-emerald-200",
    OVERDUE: "bg-rose-50 text-rose-600 border-rose-200",
    TRIAL: "bg-sky-50 text-sky-600 border-sky-200",
    ARCHIVED: "bg-slate-50 text-slate-500 border-slate-200",
  };
  const labelMap: Record<string, string> = {
    ACTIVE: "Ativo",
    OVERDUE: "Vencido",
    TRIAL: "Teste",
    ARCHIVED: "Arquivado",
  };
  return (
    <div className={`w-full py-2 text-center rounded-xl text-sm font-black uppercase tracking-widest border-2 shadow-sm ${map[status] || map.ACTIVE}`}>
      {labelMap[status] || status}
    </div>
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
  dados_extras?: any;
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
          <polyline fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={getPoints(pesos, minPeso, maxPeso)} />
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

  const [showRenewWarning, setShowRenewWarning] = useState(false);

  // Modal de Nova Avaliação
  const [showNovaAvModal, setShowNovaAvModal] = useState(false);
  const [savingAv, setSavingAv] = useState(false);
  const emptyAv = () => ({
    data: new Date().toISOString().slice(0, 10),
    peso_kg: "", gordura_pct: "", massa_magra_kg: "",
    cintura_cm: "", quadril_cm: "", braco_cm: "", coxa_cm: "",
    panturrilha_cm: "", abdomen_cm: "", ombro_cm: "", observacoes: "",
  });
  const [novaAv, setNovaAv] = useState(emptyAv());

  // Modal de Anamnese
  const [showAnamneseModal, setShowAnamneseModal] = useState(false);
  const [savingAnamnese, setSavingAnamnese] = useState(false);
  const [anamneseForm, setAnamneseForm] = useState({
    fuma: false, bebe: false, drogas: false,
    objetivo: "", doencas_cronicas: "", lesoes: "", historico_medico: ""
  });

  function openAnamneseModal() {
    const s = dadosExtras.saude || {};
    setAnamneseForm({
      fuma: !!s.fuma, bebe: !!s.bebe, drogas: !!s.drogas,
      objetivo: s.objetivo || "", doencas_cronicas: s.doencas_cronicas || "",
      lesoes: s.lesoes || "", historico_medico: s.historico_medico || ""
    });
    setShowAnamneseModal(true);
  }

  async function handleSaveAnamnese() {
    if (!client) return;
    setSavingAnamnese(true);
    try {
      const tid = await getCurrentTenantId();
      const newDadosExtras = {
        ...dadosExtras,
        saude: { ...(dadosExtras.saude || {}), ...anamneseForm }
      };
      
      const { error } = await supabaseBrowser
        .from('clients')
        .update({ dados_extras: newDadosExtras })
        .eq('id', client.id)
        .eq('tenant_id', tid);
        
      if (error) throw error;
      addToast("success", "Anamnese atualizada!");
      setShowAnamneseModal(false);
      loadData();
    } catch (e: any) {
      addToast("error", "Erro ao salvar", e.message);
    } finally {
      setSavingAnamnese(false);
    }
  }

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

  async function handleSaveAvaliacao() {
    if (!client) return;
    setSavingAv(true);
    try {
      const tid = await getCurrentTenantId();
      const currentSaude = dadosExtras.saude || {};
      const currentAvals = Array.isArray(currentSaude.avaliacoes) ? currentSaude.avaliacoes : [];
      const newAv = { ...novaAv, id: crypto.randomUUID() };
      
      const newDadosExtras = {
        ...dadosExtras,
        saude: {
          ...currentSaude,
          avaliacoes: [...currentAvals, newAv]
        }
      };

      const { error } = await supabaseBrowser
        .from('clients')
        .update({ dados_extras: newDadosExtras })
        .eq('id', client.id)
        .eq('tenant_id', tid);
        
      if (error) throw error;
      addToast("success", "Avaliação salva com sucesso!");
      setShowNovaAvModal(false);
      setNovaAv(emptyAv());
      loadData();
    } catch (e: any) {
      addToast("error", "Erro ao salvar", e.message);
    } finally {
      setSavingAv(false);
    }
  }

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
              <tr><th class="w-1/2">Componente</th><th class="w-1/4">Valores Obtidos</th><th class="w-1/4">Faixa Normal</th></tr>
              <tr><td><strong>Água Corporal Total</strong> <span class="text-xs text-slate-400">(L)</span></td><td class="font-bold text-lg">${pesoKg > 0 ? (pesoKg * 0.6).toFixed(1) : '--'}</td><td class="text-slate-500">${pesoIdeal > 0 ? (pesoIdeal * 0.55).toFixed(1) + '~' + (pesoIdeal * 0.65).toFixed(1) : '--'}</td></tr>
              <tr><td><strong>Massa Livre de Gordura (Massa Magra)</strong> <span class="text-xs text-slate-400">(kg)</span></td><td class="font-bold text-lg text-emerald-600">${av.massa_magra_kg || '--'}</td><td class="text-slate-500">${pesoIdeal > 0 ? (pesoIdeal * 0.75).toFixed(1) + '~' + (pesoIdeal * 0.85).toFixed(1) : '--'}</td></tr>
              <tr><td><strong>Massa de Gordura</strong> <span class="text-xs text-slate-400">(kg)</span></td><td class="font-bold text-lg text-rose-500">${av.gordura_pct && pesoKg ? ((av.gordura_pct / 100) * pesoKg).toFixed(1) : '--'}</td><td class="text-slate-500">${pesoIdeal > 0 ? (pesoIdeal * 0.10).toFixed(1) + '~' + (pesoIdeal * 0.20).toFixed(1) : '--'}</td></tr>
              <tr class="bg-slate-50"><td><strong>Peso Total</strong> <span class="text-xs text-slate-400">(kg)</span></td><td class="font-black text-xl">${av.peso_kg || '--'}</td><td class="text-slate-500">${pesoIdeal > 0 ? (pesoIdeal * 0.9).toFixed(1) + '~' + (pesoIdeal * 1.1).toFixed(1) : '--'}</td></tr>
            </table>

            <div class="section-title">Análise Músculo-Gordura</div>
            <div class="space-y-4 px-2">
              <div class="grid grid-cols-[120px_1fr_60px] items-center gap-4"><span class="font-bold text-xs">Peso (kg)</span>${renderBar(pesoKg, pesoIdeal * 0.9, pesoIdeal * 1.1)}<span class="font-black text-right">${av.peso_kg || '--'}</span></div>
              <div class="grid grid-cols-[120px_1fr_60px] items-center gap-4"><span class="font-bold text-xs">Massa Magra (kg)</span>${renderBar(Number(av.massa_magra_kg || 0), pesoIdeal * 0.75, pesoIdeal * 0.85)}<span class="font-black text-right">${av.massa_magra_kg || '--'}</span></div>
              <div class="grid grid-cols-[120px_1fr_60px] items-center gap-4"><span class="font-bold text-xs">Massa Gorda (kg)</span>${renderBar(av.gordura_pct && pesoKg ? (av.gordura_pct / 100) * pesoKg : 0, pesoIdeal * 0.10, pesoIdeal * 0.20)}<span class="font-black text-right">${av.gordura_pct && pesoKg ? ((av.gordura_pct / 100) * pesoKg).toFixed(1) : '--'}</span></div>
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
      
      {/* HEADER ACTIONS */}
      <div className="flex items-center justify-between gap-3 pb-0 px-4 sm:px-0 pt-4 sm:pt-0">
        <Link href="/admin/aluno" className="h-9 px-3 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 font-bold text-xs hover:bg-slate-200 dark:hover:bg-white/5 transition-all inline-flex items-center justify-center">
          ← Voltar aos Alunos
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => {
              setEditClientPayload({
                id: client.id, name: client.client_name, client_name: client.client_name, name_prefix: client.name_prefix ?? undefined,
                username: client.username, server_password: client.server_password ?? undefined,
                whatsapp_e164: client.whatsapp_e164 ?? undefined, whatsapp_username: client.whatsapp_username ?? undefined,
                whatsapp_opt_in: client.whatsapp_opt_in ?? true, secondary_display_name: client.secondary_display_name ?? undefined,
                secondary_name_prefix: client.secondary_name_prefix ?? undefined, secondary_phone_e164: client.secondary_phone_e164 ?? undefined,
                secondary_whatsapp_username: client.secondary_whatsapp_username ?? undefined, dont_message_until: client.dont_message_until ?? undefined,
                server_id: client.server_id, screens: client.screens, technology: client.technology ?? undefined,
                plan_name: client.plan_name ?? undefined, price_amount: client.price_amount ?? undefined, price_currency: client.price_currency ?? undefined,
                plan_table_id: (client as any).plan_table_id ?? null, plan_table_name: (client as any).plan_table_name ?? null,
                m3u_url: client.m3u_url ?? undefined, vencimento: client.vencimento ?? undefined, notes: client.notes ?? undefined, apps_names: client.apps_names ?? undefined,
                dados: client.dados_extras
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
        <div className="w-full md:w-64 shrink-0 flex flex-col items-center gap-3">
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
            <div className="flex flex-col gap-1 mt-2">
              {client.whatsapp_username && (
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884"/></svg>
                  @{client.whatsapp_username}
                </span>
              )}
              {client.secondary_display_name && (
                <span className="text-sm font-medium text-rose-500 flex items-center gap-1.5 mt-1">
                  <span className="px-1.5 py-0.5 bg-rose-100 dark:bg-rose-500/20 rounded text-[10px] font-black uppercase tracking-widest border border-rose-200 dark:border-rose-500/30">SOS</span>
                  {client.secondary_display_name} {client.secondary_phone_e164 && `(${formatPhoneDisplay(client.secondary_phone_e164)})`}
                </span>
              )}
            </div>
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

          {/* Campos Personalizados */}
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
                <div className="flex justify-between items-center bg-slate-50 dark:bg-white/5 p-3 rounded-lg border border-slate-100 dark:border-white/5 mt-1 mb-3">
                  <span className="text-slate-500 dark:text-white/40 font-bold text-[11px] uppercase tracking-tight">Próximo Vencimento</span>
                  <div className={`text-right font-mono font-black text-base ${client.computed_status === "OVERDUE" ? "text-rose-500" : client.computed_status === "ACTIVE" ? "text-emerald-600" : "text-slate-500"}`}>
                    {client.vencimento ? fmtDateTime(client.vencimento) : "—"}
                  </div>
                </div>
              </div>

              <div className="pt-1 border-t border-slate-100 dark:border-white/5">
                <div className="text-[11px] font-bold text-slate-400 dark:text-white/30 mb-2 mt-2 uppercase tracking-widest">Observações da Secretaria</div>
                <div className="text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-black/20 p-3 rounded-xl text-xs leading-relaxed border border-slate-200 dark:border-white/5 min-h-[60px] whitespace-pre-wrap">
                  {client.notes ? client.notes : <span className="italic text-slate-400">Sem observações registradas.</span>}
                </div>
              </div>
            </div>
          </div>

          {/* CARD: DADOS DE SAÚDE (ANAMNESE) */}
          <div className="bg-white dark:bg-[#161b22] border-y sm:border border-slate-200 dark:border-white/10 sm:rounded-xl p-5 shadow-sm transition-colors">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-[11px] font-bold text-slate-400 dark:text-white/20 uppercase tracking-widest flex items-center gap-2">
                <span className="text-base">🏥</span> Dados de Saúde (Anamnese)
              </h3>
              <button 
                onClick={openAnamneseModal}
                className="text-[10px] px-2 py-1 bg-slate-100 dark:bg-white/5 rounded-lg text-slate-500 font-bold border border-slate-200 dark:border-white/10 hover:bg-slate-200 transition-colors"
              >
                Editar Anamnese
              </button>
            </div>
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-50 dark:bg-white/5 p-2.5 rounded-lg border border-slate-100 dark:border-white/5 flex items-center gap-2">
                  <span className="text-lg">{dadosExtras.saude?.fuma ? "🚬" : "✅"}</span>
                  <div><span className="block text-[9px] font-bold text-slate-400 uppercase">Fuma?</span><span className={`text-xs font-bold ${dadosExtras.saude?.fuma ? 'text-rose-500' : 'text-emerald-600'}`}>{dadosExtras.saude?.fuma ? "Sim" : "Não"}</span></div>
                </div>
                <div className="bg-slate-50 dark:bg-white/5 p-2.5 rounded-lg border border-slate-100 dark:border-white/5 flex items-center gap-2">
                  <span className="text-lg">{dadosExtras.saude?.bebe ? "🍺" : "✅"}</span>
                  <div><span className="block text-[9px] font-bold text-slate-400 uppercase">Bebe?</span><span className={`text-xs font-bold ${dadosExtras.saude?.bebe ? 'text-amber-500' : 'text-emerald-600'}`}>{dadosExtras.saude?.bebe ? "Sim" : "Não"}</span></div>
                </div>
                <div className="bg-slate-50 dark:bg-white/5 p-2.5 rounded-lg border border-slate-100 dark:border-white/5 flex items-center gap-2">
                  <span className="text-lg">{dadosExtras.saude?.drogas ? "💊" : "✅"}</span>
                  <div><span className="block text-[9px] font-bold text-slate-400 uppercase">Drogas?</span><span className={`text-xs font-bold ${dadosExtras.saude?.drogas ? 'text-rose-500' : 'text-emerald-600'}`}>{dadosExtras.saude?.drogas ? "Sim" : "Não"}</span></div>
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
              <div className="flex justify-between items-center mb-3">
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Histórico de Relatórios</span>
                <button
                  onClick={() => setShowNovaAvModal(true)}
                  className="text-[10px] px-2 py-0.5 bg-emerald-500/10 rounded text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                >
                  + Nova Avaliação
                </button>
              </div>

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

      {/* MODAL DE ANAMNESE (DADOS DE SAÚDE) */}
      {showAnamneseModal && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex justify-between items-center">
              <h2 className="text-base font-bold text-slate-800 dark:text-white flex items-center gap-2">
                <span>🏥</span> Ficha de Anamnese
              </h2>
              <button onClick={() => setShowAnamneseModal(false)} className="text-slate-400 hover:text-rose-500 transition-colors">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6">
              {/* Opções Booleanas */}
              <div className="grid grid-cols-3 gap-3">
                <div onClick={() => setAnamneseForm(prev => ({...prev, fuma: !prev.fuma}))} className={`p-3 rounded-xl border cursor-pointer flex flex-col items-center gap-1 transition-colors ${anamneseForm.fuma ? "bg-rose-50 border-rose-200 text-rose-600" : "bg-slate-50 border-slate-200 text-slate-400"}`}>
                  <span className="text-xl">🚬</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider">Fuma?</span>
                  <span className="text-sm font-black">{anamneseForm.fuma ? "Sim" : "Não"}</span>
                </div>
                <div onClick={() => setAnamneseForm(prev => ({...prev, bebe: !prev.bebe}))} className={`p-3 rounded-xl border cursor-pointer flex flex-col items-center gap-1 transition-colors ${anamneseForm.bebe ? "bg-amber-50 border-amber-200 text-amber-600" : "bg-slate-50 border-slate-200 text-slate-400"}`}>
                  <span className="text-xl">🍺</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider">Bebe?</span>
                  <span className="text-sm font-black">{anamneseForm.bebe ? "Sim" : "Não"}</span>
                </div>
                <div onClick={() => setAnamneseForm(prev => ({...prev, drogas: !prev.drogas}))} className={`p-3 rounded-xl border cursor-pointer flex flex-col items-center gap-1 transition-colors ${anamneseForm.drogas ? "bg-rose-50 border-rose-200 text-rose-600" : "bg-slate-50 border-slate-200 text-slate-400"}`}>
                  <span className="text-xl">💊</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider">Drogas?</span>
                  <span className="text-sm font-black">{anamneseForm.drogas ? "Sim" : "Não"}</span>
                </div>
              </div>

              {/* Objetivo */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Objetivo Principal</label>
                <select value={anamneseForm.objetivo} onChange={e => setAnamneseForm(v => ({...v, objetivo: e.target.value}))} className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500">
                  <option value="">Selecione o objetivo principal...</option>
                  <option value="ganhar_massa">Ganhar Massa Muscular</option>
                  <option value="perder_peso">Perder Peso / Gordura</option>
                  <option value="manter">Manter o Peso</option>
                  <option value="condicionamento">Condicionamento Físico</option>
                  <option value="reabilitacao">Reabilitação</option>
                  <option value="competicao">Competição</option>
                  <option value="saude">Saúde e Qualidade de Vida</option>
                </select>
              </div>

              {/* Textos Livres */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Doenças Crônicas / Condições</label>
                <textarea value={anamneseForm.doencas_cronicas} onChange={e => setAnamneseForm(v => ({...v, doencas_cronicas: e.target.value}))} placeholder="Ex: Hipertensão, asma, diabetes..." className="w-full h-16 px-3 py-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500 resize-none" />
              </div>
              
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Lesões / Limitações Físicas</label>
                <textarea value={anamneseForm.lesoes} onChange={e => setAnamneseForm(v => ({...v, lesoes: e.target.value}))} placeholder="Ex: Hérnia de disco, lesão no joelho direito..." className="w-full h-16 px-3 py-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500 resize-none" />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Histórico Médico Geral</label>
                <textarea value={anamneseForm.historico_medico} onChange={e => setAnamneseForm(v => ({...v, historico_medico: e.target.value}))} placeholder="Cirurgias passadas, medicamentos de uso contínuo..." className="w-full h-16 px-3 py-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500 resize-none" />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex justify-end gap-3 shrink-0">
              <button onClick={() => setShowAnamneseModal(false)} className="px-4 py-2 rounded-lg font-bold text-xs text-slate-500 hover:bg-slate-200 transition-colors">Cancelar</button>
              <button onClick={handleSaveAnamnese} disabled={savingAnamnese} className="px-6 py-2 rounded-lg font-bold text-xs bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg transition-colors flex items-center gap-2 disabled:opacity-50">
                {savingAnamnese ? "Salvando..." : "Salvar Anamnese"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE NOVA AVALIAÇÃO FÍSICA */}
      {showNovaAvModal && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex justify-between items-center">
              <h2 className="text-base font-bold text-slate-800 dark:text-white flex items-center gap-2">
                <span>📏</span> Nova Avaliação Física
              </h2>
              <button onClick={() => setShowNovaAvModal(false)} className="text-slate-400 hover:text-rose-500 transition-colors">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Data</label><input type="date" value={novaAv.data} onChange={e => setNovaAv(v => ({...v, data: e.target.value}))} className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500 dark:[color-scheme:dark]" /></div>
                <div><label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Peso (kg)</label><input type="number" step="0.1" value={novaAv.peso_kg} onChange={e => setNovaAv(v => ({...v, peso_kg: e.target.value}))} placeholder="70.5" className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500" /></div>
                <div><label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">% Gordura Corporal</label><input type="number" step="0.1" value={novaAv.gordura_pct} onChange={e => setNovaAv(v => ({...v, gordura_pct: e.target.value}))} placeholder="15.0" className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500" /></div>
                <div><label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Massa Magra (kg)</label><input type="number" step="0.1" value={novaAv.massa_magra_kg} onChange={e => setNovaAv(v => ({...v, massa_magra_kg: e.target.value}))} placeholder="59.5" className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500" /></div>
              </div>

              <div>
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-200 dark:border-white/10 pb-1 mb-3">Perimetria (cm)</span>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {([["cintura_cm", "Cintura"], ["quadril_cm", "Quadril"], ["abdomen_cm", "Abdômen"], ["ombro_cm", "Ombro"], ["braco_cm", "Braço"], ["coxa_cm", "Coxa"], ["panturrilha_cm", "Panturrilha"]] as const).map(([k, l]) => (
                    <div key={k}>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{l}</label>
                      <input type="number" value={novaAv[k]} onChange={e => setNovaAv(v => ({...v, [k]: e.target.value}))} placeholder="—" className="w-full h-9 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500" />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Observações do Treinador</label>
                <textarea value={novaAv.observacoes} onChange={e => setNovaAv(v => ({...v, observacoes: e.target.value}))} placeholder="Diagnóstico, evolução, pontos de atenção..." className="w-full h-20 px-3 py-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500 resize-none" />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex justify-end gap-3 shrink-0">
              <button onClick={() => setShowNovaAvModal(false)} className="px-4 py-2 rounded-lg font-bold text-xs text-slate-500 hover:bg-slate-200 transition-colors">Cancelar</button>
              <button onClick={handleSaveAvaliacao} disabled={savingAv} className="px-6 py-2 rounded-lg font-bold text-xs bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg transition-colors flex items-center gap-2 disabled:opacity-50">
                {savingAv ? "Salvando..." : "Salvar Avaliação"}
              </button>
            </div>
          </div>
        </div>
      )}

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