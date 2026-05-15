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
  if (!e164) return null;
  const digits = String(e164).replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.startsWith("55")) {
    const local = digits.slice(2);
    if (local.length === 11) return `+55 (${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
    return `+55 ${local}`;
  }
  return `+${digits}`;
}

function getWhatsAppLink(phone: string | null | undefined) {
  if (!phone) return "#";
  const clean = String(phone).replace(/\D+/g, "");
  return `https://wa.me/${clean}`;
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

function tableLabelFromClient(c: any) {
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

// --- ENGINE BIOMÉTRICA (ESTILO INBODY) ---
function getBodyReference({ sexo, alturaCm, idade }: { sexo: "M" | "F"; alturaCm: number; idade: number; }) {
  const alturaM = alturaCm / 100;
  const imcIdeal = sexo === "M" ? 22.5 : 21.5;
  const pesoIdeal = imcIdeal * (alturaM * alturaM);

  return {
    pesoIdeal,
    aguaMin: pesoIdeal * (sexo === "M" ? 0.50 : 0.45),
    aguaMax: pesoIdeal * (sexo === "M" ? 0.65 : 0.60),
    gorduraMin: sexo === "M" ? pesoIdeal * 0.10 : pesoIdeal * 0.18,
    gorduraMax: sexo === "M" ? pesoIdeal * 0.20 : pesoIdeal * 0.28,
    massaMuscularIdeal: sexo === "M" ? pesoIdeal * 0.45 : pesoIdeal * 0.35,
  };
}

function calculateInBodyScore(peso: number, muscle: number, fatPct: number, ref: any) {
  let score = 80; // Base média
  // Penaliza se gordura estiver muito alta
  if (fatPct > 25) score -= (fatPct - 25) * 1.5;
  if (fatPct < 10) score -= (10 - fatPct);
  // Bonifica se massa muscular estiver boa
  if (muscle > ref.massaMuscularIdeal) score += (muscle - ref.massaMuscularIdeal) * 2;
  return Math.min(100, Math.max(0, Math.round(score)));
}

function EvolucaoChart({ avaliacoes }: { avaliacoes: any[] }) {
  if (!avaliacoes || avaliacoes.length < 2) {
    return <div className="text-xs text-slate-400 italic py-10 text-center">Gráfico disponível após a 2ª avaliação.</div>;
  }

  const sorted = [...avaliacoes].sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime()).slice(-6);
  const pesos = sorted.map(a => Number(a.peso_kg || 0));
  const minPeso = Math.min(...pesos) - 2;
  const maxPeso = Math.max(...pesos) + 2;

  const w = 400; const h = 100;
  const padX = 30; const padY = 20;

  const getPoints = (values: number[]) => {
    return values.map((val, i) => {
      const x = padX + (i * (w - 2 * padX)) / (values.length - 1);
      const y = h - padY - ((val - minPeso) / (maxPeso - minPeso)) * (h - 2 * padY);
      return `${x},${y}`;
    }).join(" ");
  };

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
        <polyline fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={getPoints(pesos)} />
        {pesos.map((val, i) => {
          const x = padX + (i * (w - 2 * padX)) / (pesos.length - 1);
          const y = h - padY - ((val - minPeso) / (maxPeso - minPeso)) * (h - 2 * padY);
          return (
            <g key={i}>
              <circle cx={x} cy={y} r="4" fill="#fff" stroke="#10b981" strokeWidth="2" />
              <text x={x} y={y - 8} fontSize="9" fill="#94a3b8" textAnchor="middle" fontWeight="bold">{val}kg</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function ClientDetailsPage() {
  const params = useParams();
  const { confirm, ConfirmUI } = useConfirm();
  const p = params as any;
  const clientId = (p?.id ?? p?.client_id ?? p?.clientId) as string;

  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [timelineSearch, setTimelineSearch] = useState("");
  const [tenantLogo, setTenantLogo] = useState<string | null>(null);

  const [showEditModal, setShowEditModal] = useState(false);
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [editClientPayload, setEditClientPayload] = useState<any>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState<string | null>(null);

  const [showNovaAvModal, setShowNovaAvModal] = useState(false);
  const [savingAv, setSavingAv] = useState(false);
  const [novaAv, setNovaAv] = useState({
    data: new Date().toISOString().slice(0, 10),
    peso_kg: "", gordura_pct: "", massa_magra_kg: "", agua_l: "", proteina_kg: "", minerais_kg: "",
    massa_muscular_esq_kg: "", cintura_cm: "", quadril_cm: "", observacoes: "",
    braco_dir_kg: "", braco_esq_kg: "", tronco_kg: "", perna_dir_kg: "", perna_esq_kg: ""
  });

  const [showAnamneseModal, setShowAnamneseModal] = useState(false);
  const [savingAnamnese, setSavingAnamnese] = useState(false);
  const [anamneseForm, setAnamneseForm] = useState({
    fuma: false, bebe: false, drogas: false, objetivo: "", doencas_cronicas: "", lesoes: "", historico_medico: ""
  });

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dadosExtras = useMemo(() => client?.dados_extras || {}, [client]);
  const avaliacoes = useMemo(() => {
    const list = Array.isArray(dadosExtras.saude?.avaliacoes) ? dadosExtras.saude.avaliacoes : [];
    return [...list].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
  }, [dadosExtras]);

  const filteredTimeline = useMemo(() => {
    if (!timelineSearch) return timeline;
    const s = timelineSearch.toLowerCase();
    return timeline.filter(t => t.message?.toLowerCase().includes(s) || t.event_type.toLowerCase().includes(s));
  }, [timeline, timelineSearch]);

  async function loadData() {
    if (!clientId) return;
    setLoading(true);
    try {
      const tid = await getCurrentTenantId();
      const { data: tenantData } = await supabaseBrowser.from("tenants").select("logo_url").eq("id", tid).maybeSingle();
      if (tenantData?.logo_url) setTenantLogo(tenantData.logo_url);

      const { data: row } = await supabaseBrowser.from("vw_clients_list_active").select("*").eq("tenant_id", tid).eq("id", clientId).maybeSingle();
      const { data: fullClient } = await supabaseBrowser.from("clients").select("*").eq("id", clientId).maybeSingle();

      if (!fullClient) throw new Error("Não encontrado");

      setClient({
        ...fullClient,
        computed_status: row?.computed_status || "ACTIVE",
        plan_table_name: row?.plan_table_name || "—"
      });

      const ev = await supabaseBrowser.from("client_events").select("*").eq("client_id", clientId).order("created_at", { ascending: false }).limit(100);
      if (ev.data) setTimeline(ev.data as any);
    } catch (e: any) {
      addToast("error", "Erro ao carregar", e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [clientId]);

  function addToast(type: "success" | "error", title: string, message?: string) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000);
  }

  async function handleSaveAnamnese() {
    if (!client) return;
    setSavingAnamnese(true);
    try {
      const tid = await getCurrentTenantId();
      const newExtras = { ...dadosExtras, saude: { ...(dadosExtras.saude || {}), ...anamneseForm } };
      await supabaseBrowser.from('clients').update({ dados_extras: newExtras }).eq('id', client.id);
      addToast("success", "Anamnese salva!");
      setShowAnamneseModal(false);
      loadData();
    } catch (e: any) { addToast("error", "Erro ao salvar", e.message); }
    finally { setSavingAnamnese(false); }
  }

  async function handleSaveAvaliacao() {
    if (!client) return;
    setSavingAv(true);
    try {
      const currentAvals = Array.isArray(dadosExtras.saude?.avaliacoes) ? dadosExtras.saude.avaliacoes : [];
      const newExtras = {
        ...dadosExtras,
        saude: {
          ...(dadosExtras.saude || {}),
          avaliacoes: [...currentAvals, { ...novaAv, id: crypto.randomUUID() }]
        }
      };
      await supabaseBrowser.from('clients').update({ dados_extras: newExtras }).eq('id', client.id);
      addToast("success", "Avaliação registrada!");
      setShowNovaAvModal(false);
      loadData();
    } catch (e: any) { addToast("error", "Erro ao salvar", e.message); }
    finally { setSavingAv(false); }
  }

  async function handleExportPdf(action: 'print' | 'whatsapp' | 'email', av: any) {
    setExportMenuOpen(null);
    const idade = dadosExtras.data_nascimento ? new Date().getFullYear() - new Date(dadosExtras.data_nascimento).getFullYear() : 30;
    const sexoStr = (client?.name_prefix === 'Sra.' || client?.name_prefix === 'Dra.') ? 'F' : 'M';
    const alturaCm = Number(dadosExtras.saude?.altura_cm || 170);
    const ref = getBodyReference({ sexo: sexoStr, alturaCm, idade });
    const score = calculateInBodyScore(Number(av.peso_kg), Number(av.massa_muscular_esq_kg), Number(av.gordura_pct), ref);

    if (action === 'whatsapp') {
      addToast("success", "Enviando via WhatsApp...");
      // Simulação da chamada de API do usuário
      return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const html = `
      <html>
        <head>
          <title>Laudo InBody - ${client?.client_name}</title>
          <style>
            body { font-family: sans-serif; color: #1e293b; padding: 40px; }
            .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 20px; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
            .section-title { background: #0f172a; color: white; padding: 5px 10px; font-size: 12px; font-weight: bold; text-transform: uppercase; margin: 15px 0 10px; }
            .data-row { display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding: 5px 0; font-size: 11px; }
            .score-box { background: #f8fafc; border: 1px solid #cbd5e1; padding: 20px; text-align: center; border-radius: 8px; }
            .score-value { font-size: 48px; font-weight: 900; color: #0f172a; }
            .bar-bg { background: #e2e8f0; height: 12px; width: 100%; position: relative; margin-top: 4px; }
            .bar-fill { background: #0f172a; height: 100%; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              ${tenantLogo ? `<img src="${tenantLogo}" height="40" />` : '<strong>UniGestor Saúde</strong>'}
              <div style="font-size: 18px; font-weight: 900; margin-top: 10px;">RELATÓRIO DE COMPOSIÇÃO CORPORAL</div>
            </div>
            <div style="text-align: right; font-size: 11px;">
              <strong>Aluno:</strong> ${client?.client_name}<br/>
              <strong>Data:</strong> ${new Date(av.data).toLocaleDateString("pt-BR")}<br/>
              <strong>ID:</strong> ${client?.id.slice(0,8)}
            </div>
          </div>

          <div class="grid">
            <div>
              <div class="section-title">Composição Corporal</div>
              <div class="data-row"><span>Peso Total</span> <strong>${av.peso_kg} kg</strong></div>
              <div class="data-row"><span>Massa Muscular Esquelética</span> <strong>${av.massa_muscular_esq_kg} kg</strong></div>
              <div class="data-row"><span>Massa de Gordura</span> <strong>${((Number(av.gordura_pct)/100) * Number(av.peso_kg)).toFixed(1)} kg</strong></div>
              <div class="data-row"><span>Água Corporal Total</span> <strong>${av.agua_l} L</strong></div>

              <div class="section-title">Análise de Gordura</div>
              <div class="data-row"><span>Percentual de Gordura (PGC)</span> <strong>${av.gordura_pct}%</strong></div>
              <div class="data-row"><span>IMC</span> <strong>${(Number(av.peso_kg) / ((alturaCm/100)**2)).toFixed(1)}</strong></div>
            </div>

            <div>
              <div class="score-box">
                <div style="font-size: 10px; font-weight: bold; color: #64748b; margin-bottom: 5px;">PONTUAÇÃO FITNESS</div>
                <div class="score-value">${score}</div>
                <div style="font-size: 11px; color: #64748b;">de 100 pontos</div>
              </div>
              
              <div class="section-title">Perimetria</div>
              <div class="data-row"><span>Cintura</span> <strong>${av.cintura_cm} cm</strong></div>
              <div class="data-row"><span>Quadril</span> <strong>${av.quadril_cm} cm</strong></div>
            </div>
          </div>

          <div style="margin-top: 30px; font-size: 10px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 10px;">
            Este laudo é uma ferramenta de acompanhamento físico e não substitui consulta médica.
          </div>
        </body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  }

  if (loading) return <div className="p-10 text-center animate-pulse">Carregando prontuário...</div>;
  if (!client) return <div className="p-10 text-center text-rose-500">Aluno não encontrado.</div>;

  return (
    <div className="space-y-6 pt-4 pb-10 px-4 sm:px-6 bg-slate-50 dark:bg-[#0f141a] min-h-screen transition-colors">
      
      {/* HEADER ACTIONS */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <Link href="/admin/aluno" className="text-slate-500 font-bold text-xs hover:underline inline-flex items-center gap-2">
          ← Voltar para listagem
        </Link>
        <div className="flex gap-2 w-full sm:w-auto">
          <button onClick={() => setShowEditModal(true)} className="flex-1 sm:flex-none h-9 px-4 rounded-lg border border-amber-500/30 text-amber-600 text-xs font-bold hover:bg-amber-50">Editar Cadastro</button>
          <button onClick={() => setShowRenewModal(true)} className="flex-1 sm:flex-none h-9 px-4 rounded-lg bg-emerald-600 text-white text-xs font-bold shadow-lg shadow-emerald-900/20">Receber Mensalidade</button>
        </div>
      </div>

      {/* BANNER PRINCIPAL */}
      <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row gap-8">
        <div className="w-full md:w-48 flex flex-col items-center gap-4">
          <div className="w-32 h-32 sm:w-40 sm:h-40 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden border-4 border-white shadow-md">
            {dadosExtras.foto_url ? <img src={dadosExtras.foto_url} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-4xl">👤</div>}
          </div>
          <StatusBadge status={client.computed_status} />
        </div>

        <div className="flex-1 space-y-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-800 dark:text-white">
              <a href={getWhatsAppLink(client.whatsapp_e164)} target="_blank" className="hover:text-emerald-500 transition-colors">
                {client.name_prefix ? `${client.name_prefix} ` : ""}{client.client_name}
              </a>
            </h1>
            <div className="flex items-center gap-2 mt-1 text-sm font-medium text-slate-500">
              <a href={getWhatsAppLink(client.whatsapp_e164)} target="_blank" className="text-emerald-600 hover:underline">
                @{client.whatsapp_username || "sem_whatsapp"}
              </a>
              {dadosExtras.email && (
                <>
                  <span className="text-slate-300">|</span>
                  <span className="text-slate-500 lowercase">{dadosExtras.email}</span>
                </>
              )}
            </div>
            
            {client.secondary_display_name && (
              <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 bg-rose-50 border border-rose-100 rounded-full text-[11px] font-bold text-rose-600">
                🚨 EMERGÊNCIA: 
                <a href={getWhatsAppLink(client.secondary_phone_e164)} target="_blank" className="hover:underline">
                  {client.secondary_display_name} ({formatPhoneDisplay(client.secondary_phone_e164)})
                </a>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/5">
              <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">CPF/RG</label>
              <div className="text-xs font-bold text-slate-700 dark:text-white">{dadosExtras.cpf_rg || "—"}</div>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/5">
              <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Nascimento</label>
              <div className="text-xs font-bold text-slate-700 dark:text-white">{dadosExtras.data_nascimento ? new Date(dadosExtras.data_nascimento).toLocaleDateString() : "—"}</div>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/5">
              <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Modalidade</label>
              <div className="text-xs font-bold text-emerald-600">{dadosExtras.modalidade || "Geral"}</div>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/5">
              <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Tipo Plano</label>
              <div className="text-xs font-bold text-indigo-500 uppercase">{client.plan_name?.toLowerCase().includes('fam') ? 'Família' : 'Individual'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* GRID DE CONTEÚDO */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* COLUNA ESQUERDA */}
        <div className="space-y-6">
          {/* FINANCEIRO */}
          <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl p-5 shadow-sm">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">💰 Financeiro</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-sm border-b border-slate-50 pb-2"><span className="text-slate-500">Valor</span> <span className="font-bold">{fmtMoney(client.price_amount, client.price_currency)}</span></div>
              <div className="flex justify-between text-sm border-b border-slate-50 pb-2"><span className="text-slate-500">Recorrência</span> <span className="font-bold">{extractPeriod(client.plan_name)}</span></div>
              <div className="mt-4 p-3 bg-slate-50 rounded-xl text-center">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Próximo Vencimento</div>
                <div className={`text-lg font-black ${client.computed_status === 'OVERDUE' ? 'text-rose-500' : 'text-emerald-600'}`}>
                  {client.vencimento ? new Date(client.vencimento).toLocaleDateString() : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* SAÚDE */}
          <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl p-5 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">🏥 Saúde</h3>
              <button onClick={() => {
                setAnamneseForm(dadosExtras.saude || {});
                setShowAnamneseModal(true);
              }} className="text-[10px] font-bold text-indigo-500 hover:underline">Editar</button>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className={`p-2 rounded-lg text-center border ${dadosExtras.saude?.fuma ? 'bg-rose-50 border-rose-100 text-rose-600' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
                <div className="text-[9px] font-bold uppercase">Fuma</div>
                <div className="text-xs font-black">{dadosExtras.saude?.fuma ? 'Sim' : 'Não'}</div>
              </div>
              <div className={`p-2 rounded-lg text-center border ${dadosExtras.saude?.bebe ? 'bg-amber-50 border-amber-100 text-amber-600' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
                <div className="text-[9px] font-bold uppercase">Bebe</div>
                <div className="text-xs font-black">{dadosExtras.saude?.bebe ? 'Sim' : 'Não'}</div>
              </div>
              <div className={`p-2 rounded-lg text-center border ${dadosExtras.saude?.objetivo ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
                <div className="text-[9px] font-bold uppercase">Objetivo</div>
                <div className="text-[10px] font-black truncate">{dadosExtras.saude?.objetivo || '—'}</div>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[9px] font-bold text-slate-400 uppercase">Limitações/Lesões</label>
                <p className="text-xs text-slate-600 italic leading-relaxed">{dadosExtras.saude?.lesoes || 'Nenhuma registrada.'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* COLUNA DIREITA */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* PERFORMANCE */}
          <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-sm">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">📊 Evolução Corporal</h3>
              <button onClick={() => setShowNovaAvModal(true)} className="h-8 px-3 rounded-lg bg-emerald-50 text-emerald-600 text-[10px] font-bold hover:bg-emerald-100 transition-colors">+ Nova Avaliação</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 bg-slate-50 dark:bg-white/5 rounded-2xl p-4 border border-slate-100 dark:border-white/5">
                <EvolucaoChart avaliacoes={avaliacoes} />
              </div>
              <div className="space-y-2">
                <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Últimos Relatórios</div>
                {avaliacoes.slice(0, 4).map(av => (
                  <div key={av.id} className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl hover:border-emerald-200 transition-all group">
                    <div className="text-xs font-bold text-slate-700">{new Date(av.data).toLocaleDateString()}</div>
                    <div className="flex gap-2 relative">
                       <button onClick={() => handleExportPdf('print', av)} className="p-1.5 hover:bg-slate-100 rounded text-slate-400" title="Imprimir PDF">🖨️</button>
                       <button onClick={() => handleExportPdf('whatsapp', av)} className="p-1.5 hover:bg-emerald-50 rounded text-emerald-500" title="Enviar WhatsApp">💬</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* TIMELINE */}
          <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">⏳ Histórico de Atividades</h3>
              <div className="relative w-full sm:w-64">
                <input 
                  type="text" 
                  placeholder="Filtrar eventos..." 
                  value={timelineSearch}
                  onChange={e => setTimelineSearch(e.target.value)}
                  className="w-full h-8 pl-8 pr-3 rounded-lg bg-slate-50 border-none text-xs outline-none focus:ring-1 ring-emerald-500"
                />
                <span className="absolute left-2.5 top-2 text-slate-400">🔍</span>
              </div>
            </div>

            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
              {filteredTimeline.map((item, idx) => (
                <div key={idx} className="flex gap-4 relative group">
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 rounded-full bg-slate-300 mt-1.5"></div>
                    <div className="flex-1 w-0.5 bg-slate-100 group-last:hidden"></div>
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-black uppercase text-indigo-500">{item.event_type}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{fmtDate(item.created_at)}</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300">{item.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* MODAL ANAMNESE */}
      {showAnamneseModal && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#161b22] w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h2 className="font-black text-slate-800">Ficha de Anamnese</h2>
              <button onClick={() => setShowAnamneseModal(false)}>✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <label className={`flex flex-col items-center p-3 border rounded-xl cursor-pointer ${anamneseForm.fuma ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-slate-50'}`}>
                  <input type="checkbox" className="hidden" checked={anamneseForm.fuma} onChange={e => setAnamneseForm({...anamneseForm, fuma: e.target.checked})} />
                  <span className="text-xl">🚬</span> <span className="text-[10px] font-bold">FUMA</span>
                </label>
                <label className={`flex flex-col items-center p-3 border rounded-xl cursor-pointer ${anamneseForm.bebe ? 'bg-amber-50 border-amber-200 text-amber-600' : 'bg-slate-50'}`}>
                  <input type="checkbox" className="hidden" checked={anamneseForm.bebe} onChange={e => setAnamneseForm({...anamneseForm, bebe: e.target.checked})} />
                  <span className="text-xl">🍺</span> <span className="text-[10px] font-bold">BEBE</span>
                </label>
                <label className={`flex flex-col items-center p-3 border rounded-xl cursor-pointer ${anamneseForm.drogas ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-slate-50'}`}>
                  <input type="checkbox" className="hidden" checked={anamneseForm.drogas} onChange={e => setAnamneseForm({...anamneseForm, drogas: e.target.checked})} />
                  <span className="text-xl">💊</span> <span className="text-[10px] font-bold">DROGAS</span>
                </label>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-slate-400">Objetivo</label>
                <input className="w-full h-10 px-3 rounded-lg border border-slate-200 mt-1" value={anamneseForm.objetivo} onChange={e => setAnamneseForm({...anamneseForm, objetivo: e.target.value})} />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-slate-400">Lesões / Observações</label>
                <textarea className="w-full h-24 p-3 rounded-lg border border-slate-200 mt-1 resize-none" value={anamneseForm.lesoes} onChange={e => setAnamneseForm({...anamneseForm, lesoes: e.target.value})} />
              </div>
            </div>
            <div className="p-6 bg-slate-50 flex justify-end gap-3">
              <button onClick={() => setShowAnamneseModal(false)} className="text-xs font-bold text-slate-500">Cancelar</button>
              <button onClick={handleSaveAnamnese} disabled={savingAnamnese} className="px-6 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold">{savingAnamnese ? 'Salvando...' : 'Salvar Alterações'}</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL NOVA AVALIAÇÃO */}
      {showNovaAvModal && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white dark:bg-[#161b22] w-full max-w-2xl rounded-2xl shadow-2xl my-10">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h2 className="font-black text-slate-800 uppercase text-sm">Nova Avaliação Corporal</h2>
              <button onClick={() => setShowNovaAvModal(false)}>✕</button>
            </div>
            <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Data</label>
                <input type="date" value={novaAv.data} onChange={e => setNovaAv({...novaAv, data: e.target.value})} className="w-full h-10 px-3 border border-slate-200 rounded-lg" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase">Peso (kg)</label>
                <input type="number" step="0.1" value={novaAv.peso_kg} onChange={e => setNovaAv({...novaAv, peso_kg: e.target.value})} className="w-full h-10 px-3 border border-slate-200 rounded-lg" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase">% Gordura</label>
                <input type="number" step="0.1" value={novaAv.gordura_pct} onChange={e => setNovaAv({...novaAv, gordura_pct: e.target.value})} className="w-full h-10 px-3 border border-slate-200 rounded-lg" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase">Muscular (kg)</label>
                <input type="number" step="0.1" value={novaAv.massa_muscular_esq_kg} onChange={e => setNovaAv({...novaAv, massa_muscular_esq_kg: e.target.value})} className="w-full h-10 px-3 border border-slate-200 rounded-lg" />
              </div>
              <div className="col-span-2 sm:col-span-4 border-t pt-4">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Observações do Treinador</label>
                <textarea value={novaAv.observacoes} onChange={e => setNovaAv({...novaAv, observacoes: e.target.value})} className="w-full h-20 p-3 border border-slate-200 rounded-lg mt-1 resize-none" placeholder="Evolução, ajustes de treino..." />
              </div>
            </div>
            <div className="p-6 bg-slate-50 flex justify-end gap-3">
              <button onClick={handleSaveAvaliacao} disabled={savingAv} className="px-10 py-3 bg-emerald-600 text-white rounded-xl text-xs font-black shadow-lg shadow-emerald-900/20">{savingAv ? 'Processando...' : 'FINALIZAR E SALVAR'}</button>
            </div>
          </div>
        </div>
      )}

      {showEditModal && editClientPayload && (
        <NovoAluno alunoToEdit={editClientPayload} onClose={() => setShowEditModal(false)} onSuccess={() => { setShowEditModal(false); loadData(); }} />
      )}

      {showRenewModal && client && (
        <RecargaAluno clientId={client.id} clientName={client.client_name} onClose={() => setShowRenewModal(false)} onSuccess={() => { setShowRenewModal(false); loadData(); }} />
      )}

      <div className="relative z-[999999]"><ToastNotifications toasts={toasts} removeToast={(id) => setToasts(p => p.filter(t => t.id !== id))} /></div>
    </div>
  );
}