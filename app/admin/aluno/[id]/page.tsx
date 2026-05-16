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

function buildWhatsAppLink(e164: string | null | undefined, username?: string | null) {
  const raw = e164 || username || "";
  const digits = String(raw).replace(/\D+/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}`;
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

// --- ENGINE BIOMÉTRICA ---
function getBodyReference({ sexo, alturaCm, idade }: { sexo: "M" | "F"; alturaCm: number; idade: number; }) {
  const alturaM = alturaCm / 100;
  const imcIdeal = sexo === "M" ? (idade > 40 ? 24 : 22.5) : (idade > 40 ? 23 : 21.5);
  const pesoIdeal = imcIdeal * (alturaM * alturaM);

  return {
    pesoIdeal,
    pesoMin: 18.5 * (alturaM * alturaM),
    pesoMax: 24.9 * (alturaM * alturaM),
    aguaMin: pesoIdeal * (sexo === "M" ? 0.50 : 0.45),
    aguaMax: pesoIdeal * (sexo === "M" ? 0.65 : 0.60),
    gorduraPctMin: sexo === "M" ? (idade > 40 ? 11 : 8) : (idade > 40 ? 23 : 21),
    gorduraPctMax: sexo === "M" ? (idade > 40 ? 22 : 19) : (idade > 40 ? 33 : 32),
    gorduraMin: sexo === "M" ? pesoIdeal * 0.10 : pesoIdeal * 0.18,
    gorduraMax: sexo === "M" ? pesoIdeal * 0.20 : pesoIdeal * 0.28,
    massaMagraIdeal: sexo === "M" ? pesoIdeal * 0.82 : pesoIdeal * 0.72,
    massaMuscularIdeal: sexo === "M" ? pesoIdeal * 0.48 : pesoIdeal * 0.38,
    imcMin: 18.5,
    imcMax: 24.9,
    rcqMax: sexo === "M" ? 0.90 : 0.85,
  };
}

// Calcula score de saúde de 0 a 100, normalizado conforme dados disponíveis.
// Funciona mesmo com poucos dados (só peso): score pondera pelo que foi medido.
function calcularScoreInBody({ imc, gorduraPct, pesoKg, rcq, ref }: any) {
  let pontos = 0;
  let total = 0;

  // IMC (sempre presente se peso+altura) — peso 35
  if (imc > 0) {
    total += 35;
    if (imc >= ref.imcMin && imc <= ref.imcMax) pontos += 35;
    else if (imc >= 17 && imc <= 27) pontos += 26;
    else if (imc >= 16 && imc <= 30) pontos += 15;
    else pontos += 5;
  }

  // Peso vs Ideal — peso 25
  if (pesoKg > 0 && ref.pesoIdeal > 0) {
    total += 25;
    const desvio = Math.abs(pesoKg - ref.pesoIdeal) / ref.pesoIdeal;
    if (desvio <= 0.05) pontos += 25;
    else if (desvio <= 0.10) pontos += 19;
    else if (desvio <= 0.20) pontos += 10;
    else pontos += 3;
  }

  // % Gordura (opcional) — peso 25
  if (gorduraPct > 0) {
    total += 25;
    if (gorduraPct >= ref.gorduraPctMin && gorduraPct <= ref.gorduraPctMax) pontos += 25;
    else if (gorduraPct >= ref.gorduraPctMin - 3 && gorduraPct <= ref.gorduraPctMax + 5) pontos += 18;
    else if (gorduraPct <= ref.gorduraPctMax + 10) pontos += 10;
    else pontos += 4;
  }

  // RCQ (opcional, calculado de cintura/quadril) — peso 15
  if (rcq > 0) {
    total += 15;
    if (rcq <= ref.rcqMax) pontos += 15;
    else if (rcq <= ref.rcqMax + 0.05) pontos += 10;
    else if (rcq <= ref.rcqMax + 0.10) pontos += 6;
    else pontos += 2;
  }

  if (total === 0) return 0;
  return Math.round((pontos / total) * 100);
}

// TMB via Mifflin-St Jeor (mais aceita na literatura atual)
function calcularTMB({ sexo, pesoKg, alturaCm, idade }: any) {
  if (!pesoKg || !alturaCm || !idade) return 0;
  return sexo === "M"
    ? Math.round(10 * pesoKg + 6.25 * alturaCm - 5 * idade + 5)
    : Math.round(10 * pesoKg + 6.25 * alturaCm - 5 * idade - 161);
}

// Idade metabólica: TMB esperada vs TMB do indivíduo (estimada pelo peso magro real)
function calcularIdadeMetabolica({ sexo, pesoKg, alturaCm, idade, gorduraPct }: any) {
  if (!pesoKg || !alturaCm || !idade) return null;
  const tmbEsperada = calcularTMB({ sexo, pesoKg, alturaCm, idade });

  // Se temos %gordura, calculamos uma TMB "real" baseada em massa magra (Katch-McArdle)
  // Caso contrário, retornamos a idade real
  if (gorduraPct > 0) {
    const massaMagra = pesoKg * (1 - gorduraPct / 100);
    const tmbKatch = Math.round(370 + 21.6 * massaMagra);
    if (tmbKatch > 0 && tmbEsperada > 0) {
      const fator = tmbEsperada / tmbKatch;
      return Math.max(15, Math.min(80, Math.round(idade * fator)));
    }
  }

  // Sem %gordura: usa o IMC como proxy (IMC alto = idade metabólica acima)
  const imc = pesoKg / Math.pow(alturaCm / 100, 2);
  const fatorImc = imc > 24.9 ? 1 + (imc - 24.9) * 0.04 : imc < 18.5 ? 1 + (18.5 - imc) * 0.03 : 1;
  return Math.max(15, Math.min(80, Math.round(idade * fatorImc)));
}

// Classifica um valor em uma escala (Abaixo/Normal/Acima)
type Faixa = "abaixo" | "normal" | "acima";
function classify(value: number, min: number, max: number): Faixa {
  if (value < min) return "abaixo";
  if (value > max) return "acima";
  return "normal";
}

function generateInsights({ imc, gorduraPct, pesoKg, rcq, ref, sexo, idade }: any) {
  const insights: string[] = [];

  // IMC
  if (imc > 0) {
    if (imc < 18.5) insights.push("IMC abaixo do recomendado — considere aumentar a ingestão calórica balanceada com ganho de massa magra.");
    else if (imc > 29.9) insights.push("IMC indica obesidade — recomenda-se acompanhamento profissional para perda de peso saudável.");
    else if (imc > 24.9) insights.push("IMC ligeiramente acima do ideal — pequenos ajustes na rotina podem normalizar.");
    else insights.push("IMC dentro da faixa saudável.");
  }

  // % Gordura
  if (gorduraPct > 0) {
    if (gorduraPct > ref.gorduraPctMax) insights.push("Percentual de gordura acima do recomendado — foque em atividades aeróbicas e controle nutricional.");
    else if (gorduraPct < ref.gorduraPctMin) insights.push("Percentual de gordura abaixo do mínimo — atenção à reserva energética.");
    else insights.push("Percentual de gordura corporal em faixa adequada.");
  }

  // RCQ — indicador de risco cardiovascular
  if (rcq > 0) {
    if (rcq > ref.rcqMax + 0.05) insights.push("Relação cintura/quadril elevada — atenção ao acúmulo de gordura abdominal e risco cardiovascular.");
    else if (rcq > ref.rcqMax) insights.push("Relação cintura/quadril levemente acima — vale trabalhar a região abdominal.");
    else insights.push("Distribuição corporal saudável (cintura/quadril).");
  }

  // Idade
  if (idade > 40) insights.push("Após os 40, recomenda-se manter o trabalho de força para preservar massa magra e densidade óssea.");

  if (insights.length === 0) insights.push("Dados ainda insuficientes para análise — registre mais avaliações para acompanhar a evolução.");
  return insights;
}

// --- COMPONENTE BARRA INBODY (Abaixo / Normal / Acima) ---
function InBodyMetricBar({
  label,
  unit,
  value,
  min,
  max,
  absoluteMin,
  absoluteMax,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  absoluteMin: number;
  absoluteMax: number;
}) {
  const val = Number(value) || 0;
  const faixa: Faixa = val === 0 ? "normal" : classify(val, min, max);

  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const minPct = clamp(((min - absoluteMin) / (absoluteMax - absoluteMin)) * 100);
  const maxPct = clamp(((max - absoluteMin) / (absoluteMax - absoluteMin)) * 100);
  const valPct = clamp(((val - absoluteMin) / (absoluteMax - absoluteMin)) * 100);

  const colorClass = val === 0
    ? "text-slate-400"
    : faixa === "normal"
      ? "text-emerald-600"
      : faixa === "abaixo"
        ? "text-sky-600"
        : "text-rose-600";

  const labelStatus = val === 0 ? "Sem dado" : faixa === "normal" ? "Normal" : faixa === "abaixo" ? "Abaixo" : "Acima";

  return (
    <div>
      <div className="flex items-end justify-between mb-1.5">
        <div>
          <span className="text-[11px] font-bold text-slate-700 dark:text-white/80 uppercase tracking-wide">{label}</span>
          <span className="text-[10px] text-slate-400 ml-1">({unit})</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className={`text-[10px] font-bold uppercase tracking-widest ${colorClass}`}>{labelStatus}</span>
          <span className="font-mono font-black text-base text-slate-800 dark:text-white tabular-nums">
            {val > 0 ? val.toFixed(1) : "--"}
          </span>
        </div>
      </div>

      <div className="relative h-7 bg-slate-100 dark:bg-black/30 rounded-md overflow-hidden border border-slate-200 dark:border-white/5">
        {/* Faixa Abaixo (esquerda) */}
        <div className="absolute top-0 bottom-0 left-0 bg-sky-100/70 dark:bg-sky-500/15" style={{ width: `${minPct}%` }} />
        {/* Faixa Normal (centro) */}
        <div className="absolute top-0 bottom-0 bg-emerald-100/80 dark:bg-emerald-500/20" style={{ left: `${minPct}%`, width: `${maxPct - minPct}%` }} />
        {/* Faixa Acima (direita) */}
        <div className="absolute top-0 bottom-0 bg-rose-100/70 dark:bg-rose-500/15" style={{ left: `${maxPct}%`, right: 0 }} />

        {/* Linhas de separação */}
        <div className="absolute top-0 bottom-0 w-px bg-slate-300 dark:bg-white/10" style={{ left: `${minPct}%` }} />
        <div className="absolute top-0 bottom-0 w-px bg-slate-300 dark:bg-white/10" style={{ left: `${maxPct}%` }} />

        {/* Indicador (marcador do valor) */}
        {val > 0 && (
          <div
            className={`absolute top-1 bottom-1 w-1 rounded-full shadow-lg ${
              faixa === "normal" ? "bg-emerald-600" : faixa === "abaixo" ? "bg-sky-600" : "bg-rose-600"
            }`}
            style={{ left: `calc(${valPct}% - 2px)` }}
          />
        )}

        {/* Labels das faixas dentro da barra */}
        <div className="absolute inset-0 flex text-[9px] font-bold pointer-events-none">
          <div className="flex items-center justify-center text-sky-700/60 dark:text-sky-300/40" style={{ width: `${minPct}%` }}>{minPct > 12 && "ABAIXO"}</div>
          <div className="flex items-center justify-center text-emerald-700/70 dark:text-emerald-300/50" style={{ width: `${maxPct - minPct}%` }}>{(maxPct - minPct) > 15 && "NORMAL"}</div>
          <div className="flex items-center justify-center text-rose-700/60 dark:text-rose-300/40 flex-1">{(100 - maxPct) > 12 && "ACIMA"}</div>
        </div>
      </div>

      <div className="flex justify-between mt-1 text-[9px] font-mono text-slate-400">
        <span>{absoluteMin.toFixed(1)}</span>
        <span className="text-emerald-600 font-bold">{min.toFixed(1)} – {max.toFixed(1)}</span>
        <span>{absoluteMax.toFixed(1)}</span>
      </div>
    </div>
  );
}

// --- COMPONENTE GRÁFICO DE EVOLUÇÃO ---
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
  const [tenantLogo, setTenantLogo] = useState<string | null>(null);

  const [showEditModal, setShowEditModal] = useState(false);
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [editClientPayload, setEditClientPayload] = useState<any>(null);

  const [showRenewWarning, setShowRenewWarning] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState<string | null>(null);

  // Modal de Nova Avaliação
  const [showNovaAvModal, setShowNovaAvModal] = useState(false);
  const [savingAv, setSavingAv] = useState(false);

  // Filtros da Timeline
  const [timelineSearch, setTimelineSearch] = useState("");
  const [timelineDateFilter, setTimelineDateFilter] = useState("");
  const [showTimelineSearch, setShowTimelineSearch] = useState(false);

  const emptyAv = () => ({
    data: new Date().toISOString().slice(0, 10),
    peso_kg: "",
    gordura_pct: "",      // opcional (adipômetro/bioimpedância)
    pontuacao: "",        // calculado automaticamente
    // Perimetria
    cintura_cm: "", quadril_cm: "", abdomen_cm: "",
    braco_cm: "", coxa_cm: "", panturrilha_cm: "", ombro_cm: "",
    observacoes: "",
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

  // Última avaliação (para painel InBody no topo do card)
  const ultimaAv = avaliacoes[0] || null;

  // Dados base do aluno para cálculos
  const dadosCalc = useMemo(() => {
    const idade = dadosExtras.data_nascimento
      ? new Date().getFullYear() - new Date(dadosExtras.data_nascimento).getFullYear()
      : 30;
    const sexoStr: "M" | "F" = (client?.name_prefix === 'Sra.' || client?.name_prefix === 'Dra.' || client?.name_prefix === 'Srta.') ? 'F' : 'M';
    const alturaCm = Number(dadosExtras.saude?.altura_cm || 170);
    const ref = getBodyReference({ sexo: sexoStr, alturaCm, idade });
    return { idade, sexoStr, alturaCm, ref };
  }, [dadosExtras, client]);

  // Cálculos com a última avaliação — TODOS os derivados são automáticos
  const inbodyStats = useMemo(() => {
    if (!ultimaAv) return null;
    const { idade, sexoStr, alturaCm, ref } = dadosCalc;
    const alturaM = alturaCm / 100;
    const pesoKg = Number(ultimaAv.peso_kg || 0);
    const gorduraPct = Number(ultimaAv.gordura_pct || 0);
    const cintura = Number(ultimaAv.cintura_cm || 0);
    const quadril = Number(ultimaAv.quadril_cm || 0);

    // DERIVADOS automaticamente
    const imc = (pesoKg > 0 && alturaM > 0) ? (pesoKg / (alturaM * alturaM)) : 0;
    const massaGordura = (gorduraPct > 0 && pesoKg > 0) ? (gorduraPct / 100) * pesoKg : 0;
    const massaMagra = pesoKg > 0 && massaGordura > 0 ? pesoKg - massaGordura : 0;
    const rcq = (cintura > 0 && quadril > 0) ? cintura / quadril : 0;
    const tmb = calcularTMB({ sexo: sexoStr, pesoKg, alturaCm, idade });
    const idadeMet = calcularIdadeMetabolica({ sexo: sexoStr, pesoKg, alturaCm, idade, gorduraPct });

    const score = calcularScoreInBody({ imc, gorduraPct, pesoKg, rcq, ref });
    const insights = generateInsights({ imc, gorduraPct, pesoKg, rcq, ref, sexo: sexoStr, idade });
    const difPeso = pesoKg > 0 && ref.pesoIdeal > 0 ? (pesoKg - ref.pesoIdeal) : 0;

    return { idade, sexoStr, alturaCm, pesoKg, imc, gorduraPct, massaGordura, massaMagra, rcq, tmb, ref, score, idadeMet, insights, difPeso };
  }, [ultimaAv, dadosCalc]);

  // Timeline filtrada
  const timelineFiltered = useMemo(() => {
    let list = timeline;
    if (timelineDateFilter) {
      list = list.filter(t => t.created_at.startsWith(timelineDateFilter));
    }
    if (timelineSearch.trim()) {
      const q = timelineSearch.trim().toLowerCase();
      list = list.filter(t => {
        const msg = (t.message || "").toLowerCase();
        const type = (t.event_type || "").toLowerCase();
        const meta = t.meta ? JSON.stringify(t.meta).toLowerCase() : "";
        return msg.includes(q) || type.includes(q) || meta.includes(q);
      });
    }
    return list;
  }, [timeline, timelineSearch, timelineDateFilter]);

  async function handleDeleteEvent(item: TimelineItem) {
    const ok = await confirm({
      tone: "rose", title: "Apagar registro?", subtitle: "Este evento será removido da linha do tempo permanentemente.",
      details: [`Data: ${fmtDate(item.created_at)}`, item.message ? `Msg: ${item.message.slice(0, 60)}` : ""].filter(Boolean),
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

      const { data: tenantData } = await supabaseBrowser
        .from("tenants")
        .select("logo_url")
        .eq("id", tid)
        .maybeSingle();

      if (tenantData?.logo_url) {
        setTenantLogo(tenantData.logo_url);
      }

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
    if (!novaAv.peso_kg || Number(novaAv.peso_kg) <= 0) {
      addToast("error", "Peso obrigatório", "Informe ao menos o peso para registrar a avaliação.");
      return;
    }
    setSavingAv(true);
    try {
      const tid = await getCurrentTenantId();
      const currentSaude = dadosExtras.saude || {};
      const currentAvals = Array.isArray(currentSaude.avaliacoes) ? currentSaude.avaliacoes : [];

      // Calcula score automaticamente
      const { idade, sexoStr, alturaCm, ref } = dadosCalc;
      const alturaM = alturaCm / 100;
      const pesoKgN = Number(novaAv.peso_kg || 0);
      const imcN = (pesoKgN > 0 && alturaM > 0) ? (pesoKgN / (alturaM * alturaM)) : 0;
      const gPctN = Number(novaAv.gordura_pct || 0);
      const cN = Number(novaAv.cintura_cm || 0);
      const qN = Number(novaAv.quadril_cm || 0);
      const rcqN = (cN > 0 && qN > 0) ? cN / qN : 0;
      const scoreAuto = calcularScoreInBody({ imc: imcN, gorduraPct: gPctN, pesoKg: pesoKgN, rcq: rcqN, ref });

      const newAv = { ...novaAv, pontuacao: String(scoreAuto), id: crypto.randomUUID() };

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

  // --- GERAÇÃO DE PDF PROFISSIONAL DE 1 PÁGINA ---
  async function handleExportPdf(action: 'print' | 'save' | 'whatsapp' | 'email', av: any) {
    setExportMenuOpen(null);

    if (action === 'whatsapp') {
      try {
        if (!client?.whatsapp_username && !client?.whatsapp_e164) throw new Error("Aluno não possui WhatsApp cadastrado.");
        addToast("success", "Enviando PDF via WhatsApp...", "O arquivo está sendo processado.");
        const res = await fetch('/api/envio-agora', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: client.whatsapp_username || client.whatsapp_e164,
            client_id: client.id,
            avaliacao_id: av.id,
            type: 'avaliacao_pdf',
          })
        });
        if (!res.ok) throw new Error("Falha no envio.");
        addToast("success", "Enviado!", "PDF enviado por WhatsApp.");
      } catch (e: any) {
        addToast("error", "Erro no envio", e.message || "Não foi possível enviar o WhatsApp.");
      }
      return;
    }

    if (action === 'email') {
      try {
        const emailAlvo = dadosExtras.email || (client?.username && String(client.username).includes('@') ? client.username : null);
        if (!emailAlvo) throw new Error("Aluno não possui e-mail válido cadastrado.");
        addToast("success", "Enviando E-mail...", `Enviando relatório para ${emailAlvo}`);
        const res = await fetch('/api/envio-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: emailAlvo,
            client_id: client?.id,
            avaliacao_id: av.id,
            subject: 'Sua Avaliação Física - Relatório',
            type: 'avaliacao_pdf',
          })
        });
        if (!res.ok) throw new Error("Falha no envio.");
        addToast("success", "E-mail enviado!", "O relatório foi enviado em anexo.");
      } catch (e: any) {
        addToast("error", "Erro no envio", e.message || "Não foi possível enviar o E-mail.");
      }
      return;
    }

    // --- PDF Local (print/save) ---
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const { idade, sexoStr, alturaCm, ref } = dadosCalc;
    const alturaM = alturaCm / 100;
    const pesoKg = Number(av.peso_kg || 0);
    const gorduraPct = Number(av.gordura_pct || 0);
    const cintura = Number(av.cintura_cm || 0);
    const quadril = Number(av.quadril_cm || 0);

    // Derivados automaticamente
    const imc = (pesoKg > 0 && alturaM > 0) ? (pesoKg / (alturaM * alturaM)) : 0;
    const massaGordura = (gorduraPct > 0 && pesoKg > 0) ? (gorduraPct / 100) * pesoKg : 0;
    const massaMagraKg = pesoKg > 0 && massaGordura > 0 ? pesoKg - massaGordura : 0;
    const rcq = (cintura > 0 && quadril > 0) ? cintura / quadril : 0;
    const tmb = calcularTMB({ sexo: sexoStr, pesoKg, alturaCm, idade });

    const difPeso = pesoKg > 0 && ref.pesoIdeal > 0 ? (pesoKg - ref.pesoIdeal) : 0;
    const insights = generateInsights({ imc, gorduraPct, pesoKg, rcq, ref, sexo: sexoStr, idade });
    const scoreCalc = av.pontuacao ? Number(av.pontuacao) : calcularScoreInBody({ imc, gorduraPct, pesoKg, rcq, ref });
    const idadeMet = calcularIdadeMetabolica({ sexo: sexoStr, pesoKg, alturaCm, idade, gorduraPct });

    // Helper para renderizar barra Abaixo/Normal/Acima no PDF
    function renderPdfBar(value: number, min: number, max: number, absMin: number, absMax: number) {
      const val = Number(value) || 0;
      if (val === 0) return `<div style="height: 16px; background: #f1f5f9; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; color: #94a3b8;">Sem dado</div>`;
      const clamp = (v: number) => Math.max(0, Math.min(100, v));
      const minPct = clamp(((min - absMin) / (absMax - absMin)) * 100);
      const maxPct = clamp(((max - absMin) / (absMax - absMin)) * 100);
      const valPct = clamp(((val - absMin) / (absMax - absMin)) * 100);
      const faixa = classify(val, min, max);
      const markerColor = faixa === "normal" ? "#059669" : faixa === "abaixo" ? "#0284c7" : "#dc2626";

      return `
        <div style="position: relative; height: 16px; background: #f1f5f9; border-radius: 3px; overflow: hidden; border: 1px solid #e2e8f0;">
          <div style="position: absolute; top: 0; bottom: 0; left: 0; width: ${minPct}%; background: #e0f2fe;"></div>
          <div style="position: absolute; top: 0; bottom: 0; left: ${minPct}%; width: ${maxPct - minPct}%; background: #d1fae5;"></div>
          <div style="position: absolute; top: 0; bottom: 0; left: ${maxPct}%; right: 0; background: #fee2e2;"></div>
          <div style="position: absolute; top: 1px; bottom: 1px; left: calc(${valPct}% - 2px); width: 4px; background: ${markerColor}; border-radius: 1px; box-shadow: 0 0 0 1px rgba(255,255,255,0.5);"></div>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 7px; color: #94a3b8; margin-top: 2px; font-family: monospace;">
          <span>${absMin.toFixed(1)}</span>
          <span style="color: #059669; font-weight: bold;">${min.toFixed(1)} – ${max.toFixed(1)}</span>
          <span>${absMax.toFixed(1)}</span>
        </div>
      `;
    }

    const logoHtml = tenantLogo
      ? `<img src="${tenantLogo}" alt="Logo" style="max-height: 36px; max-width: 140px; object-fit: contain;" />`
      : `<div style="font-size: 18px; font-weight: 900; letter-spacing: -0.02em;">GESTOR</div>`;

    const scoreColor = scoreCalc >= 80 ? "#059669" : scoreCalc >= 60 ? "#d97706" : "#dc2626";
    const scoreLabel = scoreCalc >= 80 ? "EXCELENTE" : scoreCalc >= 60 ? "BOM" : scoreCalc >= 40 ? "REGULAR" : "ATENÇÃO";

    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
        <head>
          <meta charset="UTF-8">
          <title>Avaliação Física - ${client?.client_name || 'Aluno'}</title>
          <style>
            @media print {
              @page { margin: 8mm; size: A4 portrait; }
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 9px; color: #1e293b; background: white; line-height: 1.4; }
            .page { max-width: 794px; margin: 0 auto; padding: 16px 20px; }
            .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #0f172a; padding-bottom: 10px; margin-bottom: 14px; }
            .header-left { display: flex; flex-direction: column; gap: 4px; }
            .header-title { font-size: 13px; font-weight: 900; letter-spacing: -0.03em; color: #0f172a; }
            .header-sub { font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }
            .meta-bar { display: flex; gap: 0; border: 1px solid #cbd5e1; border-radius: 4px; overflow: hidden; margin-bottom: 14px; background: #f8fafc; }
            .meta-cell { flex: 1; padding: 7px 10px; border-right: 1px solid #cbd5e1; }
            .meta-cell:last-child { border-right: 0; }
            .meta-label { font-size: 7px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px; }
            .meta-value { font-size: 11px; font-weight: 800; color: #0f172a; }
            .section-title { font-size: 10px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 2px solid #0f172a; }
            .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
            .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 14px; }
            .stat-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px 10px; text-align: center; }
            .stat-label { font-size: 7px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 3px; }
            .stat-value { font-size: 16px; font-weight: 900; color: #0f172a; font-family: monospace; }
            .stat-unit { font-size: 8px; color: #64748b; font-weight: 600; }
            .bar-row { margin-bottom: 9px; }
            .bar-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 3px; }
            .bar-label { font-size: 9px; font-weight: 700; color: #334155; text-transform: uppercase; letter-spacing: 0.5px; }
            .bar-value { font-size: 11px; font-weight: 900; color: #0f172a; font-family: monospace; }
            .bar-status { font-size: 7px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; padding: 1px 5px; border-radius: 2px; margin-right: 4px; }
            .data-table { width: 100%; border-collapse: collapse; font-size: 8.5px; }
            .data-table th { background: #0f172a; color: white; padding: 5px 7px; text-align: left; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; font-size: 7px; }
            .data-table td { padding: 4px 7px; border-bottom: 1px solid #e2e8f0; }
            .data-table tr:last-child td { border-bottom: 0; }
            .insights { background: #f8fafc; border-left: 3px solid #0f172a; padding: 8px 10px; font-size: 8.5px; line-height: 1.5; }
            .insights ul { margin: 0; padding-left: 14px; }
            .insights li { margin-bottom: 3px; color: #334155; }
            .score-card { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: white; border-radius: 6px; padding: 14px; text-align: center; }
            .score-num { font-size: 36px; font-weight: 900; line-height: 1; letter-spacing: -0.03em; font-family: monospace; }
            .score-label { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; margin-top: 4px; opacity: 0.7; }
            .score-tag { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 8px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 6px; color: white; }
            .footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #cbd5e1; display: flex; justify-content: space-between; font-size: 7px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
          </style>
        </head>
        <body>
          <div class="page">

            <!-- HEADER -->
            <div class="header">
              <div class="header-left">
                ${logoHtml}
                <div class="header-title">Análise de Composição Corporal</div>
                <div class="header-sub">Laudo de Avaliação Física</div>
              </div>
              <div style="text-align: right; font-size: 8px; color: #64748b;">
                <div><strong style="color: #0f172a;">ID:</strong> ${client?.id.split('-')[0].toUpperCase()}</div>
                <div><strong style="color: #0f172a;">Data:</strong> ${new Date(av.data + "T12:00:00").toLocaleDateString("pt-BR")}</div>
                <div><strong style="color: #0f172a;">Emitido:</strong> ${new Date().toLocaleDateString("pt-BR")}</div>
              </div>
            </div>

            <!-- META BAR (Aluno + Dados) -->
            <div class="meta-bar">
              <div class="meta-cell" style="flex: 2;">
                <div class="meta-label">Nome</div>
                <div class="meta-value">${(client?.client_name || '').toUpperCase()}</div>
              </div>
              <div class="meta-cell">
                <div class="meta-label">Sexo</div>
                <div class="meta-value">${sexoStr === 'F' ? 'Feminino' : 'Masculino'}</div>
              </div>
              <div class="meta-cell">
                <div class="meta-label">Idade</div>
                <div class="meta-value">${idade} anos</div>
              </div>
              <div class="meta-cell">
                <div class="meta-label">Altura</div>
                <div class="meta-value">${alturaCm} cm</div>
              </div>
            </div>

            <!-- GRID PRINCIPAL: 2 COLUNAS -->
            <div class="grid-2" style="grid-template-columns: 1.4fr 1fr;">

              <!-- COLUNA ESQUERDA: Análise Composição -->
              <div>
                <div class="section-title">Análise da Composição</div>

                <div class="bar-row">
                  <div class="bar-header">
                    <span class="bar-label">Peso (kg)</span>
                    <span class="bar-value">${pesoKg > 0 ? pesoKg.toFixed(1) : '--'}</span>
                  </div>
                  ${renderPdfBar(pesoKg, ref.pesoMin, ref.pesoMax, ref.pesoMin * 0.6, ref.pesoMax * 1.5)}
                </div>

                <div class="bar-row">
                  <div class="bar-header">
                    <span class="bar-label">IMC (kg/m²)</span>
                    <span class="bar-value">${imc > 0 ? imc.toFixed(1) : '--'}</span>
                  </div>
                  ${renderPdfBar(imc, 18.5, 24.9, 14, 40)}
                </div>

                <div class="bar-row">
                  <div class="bar-header">
                    <span class="bar-label">% Gordura Corporal</span>
                    <span class="bar-value">${gorduraPct > 0 ? gorduraPct.toFixed(1) : '--'}</span>
                  </div>
                  ${renderPdfBar(gorduraPct, ref.gorduraPctMin, ref.gorduraPctMax, 3, 50)}
                </div>

                ${rcq > 0 ? `
                <div class="bar-row">
                  <div class="bar-header">
                    <span class="bar-label">Relação Cintura/Quadril</span>
                    <span class="bar-value">${rcq.toFixed(2)}</span>
                  </div>
                  ${renderPdfBar(rcq, 0.7, ref.rcqMax, 0.6, 1.2)}
                </div>
                ` : ''}

                ${massaGordura > 0 ? `
                <div class="bar-row">
                  <div class="bar-header">
                    <span class="bar-label">Massa de Gordura (kg)</span>
                    <span class="bar-value">${massaGordura.toFixed(1)}</span>
                  </div>
                  ${renderPdfBar(massaGordura, ref.gorduraMin, ref.gorduraMax, 0, ref.gorduraMax * 2.5)}
                </div>
                ` : ''}
              </div>

              <!-- COLUNA DIREITA: Score InBody + Resumo -->
              <div>
                <div class="score-card">
                  <div style="font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; opacity: 0.7; margin-bottom: 4px;">Pontuação Geral</div>
                  <div class="score-num">${scoreCalc}<span style="font-size: 14px; opacity: 0.5;">/100</span></div>
                  <div class="score-tag" style="background: ${scoreColor};">${scoreLabel}</div>
                </div>

                <div style="margin-top: 12px;">
                  <div class="section-title">Indicadores</div>
                  <table class="data-table">
                    <tr>
                      <td><strong>Idade Metabólica</strong></td>
                      <td style="text-align: right; font-weight: 900; font-size: 10px;">${idadeMet || '--'} anos</td>
                    </tr>
                    <tr>
                      <td><strong>Peso Ideal</strong></td>
                      <td style="text-align: right; font-weight: 700;">${ref.pesoIdeal.toFixed(1)} kg</td>
                    </tr>
                    <tr>
                      <td><strong>Controle de Peso</strong></td>
                      <td style="text-align: right; font-weight: 700; color: ${Math.abs(difPeso) > 5 ? '#dc2626' : '#059669'};">
                        ${difPeso > 0 ? '−' : '+'}${Math.abs(difPeso).toFixed(1)} kg
                      </td>
                    </tr>
                    <tr>
                      <td><strong>TMB</strong> <span style="font-size: 7px; color: #94a3b8;">(estimada)</span></td>
                      <td style="text-align: right; font-weight: 700;">${tmb || '--'} kcal</td>
                    </tr>
                    ${massaMagraKg > 0 ? `
                    <tr>
                      <td><strong>Massa Magra</strong></td>
                      <td style="text-align: right; font-weight: 700; color: #059669;">${massaMagraKg.toFixed(1)} kg</td>
                    </tr>
                    ` : ''}
                    ${rcq > 0 ? `
                    <tr>
                      <td><strong>RCQ</strong></td>
                      <td style="text-align: right; font-weight: 700;">${rcq.toFixed(2)}</td>
                    </tr>
                    ` : ''}
                  </table>
                </div>
              </div>
            </div>

            <!-- HISTÓRICO + PERIMETRIA -->
            <div class="grid-2" style="grid-template-columns: 1.4fr 1fr; margin-bottom: 14px;">
              <div>
                <div class="section-title">Histórico de Evolução</div>
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th style="text-align: right;">Peso</th>
                      <th style="text-align: right;">% Gord.</th>
                      <th style="text-align: right;">M. Magra</th>
                      <th style="text-align: right;">IMC</th>
                      <th style="text-align: right;">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${avaliacoes.slice(0, 5).reverse().map((h: any) => {
                      const hPeso = Number(h.peso_kg || 0);
                      const hImc = (hPeso > 0 && alturaM > 0) ? (hPeso / (alturaM * alturaM)) : 0;
                      const hGord = Number(h.gordura_pct || 0);
                      const hMagra = (hGord > 0 && hPeso > 0) ? hPeso - (hGord / 100) * hPeso : 0;
                      return `
                      <tr>
                        <td><strong>${new Date(h.data + "T12:00:00").toLocaleDateString("pt-BR")}</strong></td>
                        <td style="text-align: right;">${h.peso_kg || '--'}</td>
                        <td style="text-align: right;">${h.gordura_pct || '--'}</td>
                        <td style="text-align: right;">${hMagra > 0 ? hMagra.toFixed(1) : '--'}</td>
                        <td style="text-align: right;">${hImc > 0 ? hImc.toFixed(1) : '--'}</td>
                        <td style="text-align: right; font-weight: 800;">${h.pontuacao || '--'}</td>
                      </tr>`
                    }).join('')}
                  </tbody>
                </table>
              </div>

              <div>
                <div class="section-title">Perimetria (cm)</div>
                <table class="data-table">
                  <tr><td>Cintura</td><td style="text-align: right; font-weight: 700;">${av.cintura_cm || '--'}</td>
                      <td>Quadril</td><td style="text-align: right; font-weight: 700;">${av.quadril_cm || '--'}</td></tr>
                  <tr><td>Abdômen</td><td style="text-align: right; font-weight: 700;">${av.abdomen_cm || '--'}</td>
                      <td>Ombro</td><td style="text-align: right; font-weight: 700;">${av.ombro_cm || '--'}</td></tr>
                  <tr><td>Braço</td><td style="text-align: right; font-weight: 700;">${av.braco_cm || '--'}</td>
                      <td>Coxa</td><td style="text-align: right; font-weight: 700;">${av.coxa_cm || '--'}</td></tr>
                  <tr><td>Panturrilha</td><td style="text-align: right; font-weight: 700;" colspan="3">${av.panturrilha_cm || '--'}</td></tr>
                </table>
              </div>
            </div>

            <!-- INSIGHTS -->
            <div>
              <div class="section-title">Análise e Recomendações</div>
              <div class="insights">
                <ul>
                  ${insights.map(i => `<li>${i}</li>`).join('')}
                </ul>
                ${av.observacoes ? `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed #cbd5e1;"><strong>Obs. do Profissional:</strong> ${av.observacoes}</div>` : ''}
              </div>
            </div>

            <!-- FOOTER -->
            <div class="footer">
              <span>Avaliação Física • Não substitui diagnóstico médico</span>
              <span>Emitido em ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          </div>

          <script>
            window.onload = () => {
              if ('${action}' === 'print' || '${action}' === 'save') {
                setTimeout(() => { window.print(); }, 400);
              }
            }
          </script>
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

  // Pré-processados para o header
  const whatsappLink = buildWhatsAppLink(client.whatsapp_e164, client.whatsapp_username);
  const sosLink = buildWhatsAppLink(client.secondary_phone_e164, client.secondary_whatsapp_username);
  const emailDoAluno = dadosExtras.email || (client.username && String(client.username).includes('@') ? client.username : null);
  const tipoPlano = dadosExtras.tipo_plano || dadosExtras.plano_tipo || null; // ex: "individual" ou "familia"

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

            {/* Linha de contato: WhatsApp | Email */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
              {client.whatsapp_username && whatsappLink && (
                <a
                  href={whatsappLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:underline inline-flex items-center gap-1.5 transition-colors group"
                  title="Abrir WhatsApp"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="group-hover:scale-110 transition-transform"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884" /></svg>
                  @{client.whatsapp_username}
                </a>
              )}

              {/* Separador e Email - só mostra se tiver email */}
              {emailDoAluno && client.whatsapp_username && (
                <span className="text-slate-300 dark:text-white/20 font-light">|</span>
              )}

              {emailDoAluno && (
                <a
                  href={`mailto:${emailDoAluno}`}
                  className="text-sm font-bold text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 hover:underline inline-flex items-center gap-1.5 transition-colors group"
                  title="Enviar e-mail"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="group-hover:scale-110 transition-transform"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                  {emailDoAluno}
                </a>
              )}
            </div>

            {/* SOS - Contato de Emergência */}
            {client.secondary_display_name && (
              <div className="mt-2">
                {sosLink ? (
                  <a
                    href={sosLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-rose-500 hover:text-rose-600 hover:underline inline-flex items-center gap-1.5 transition-colors group"
                    title="Abrir WhatsApp do contato de emergência"
                  >
                    <span className="px-1.5 py-0.5 bg-rose-100 dark:bg-rose-500/20 rounded text-[10px] font-black uppercase tracking-widest border border-rose-200 dark:border-rose-500/30">SOS</span>
                    <strong>{client.secondary_display_name}</strong>
                    {client.secondary_whatsapp_username && (
                      <span className="opacity-80">@{client.secondary_whatsapp_username}</span>
                    )}
                    {!client.secondary_whatsapp_username && client.secondary_phone_e164 && (
                      <span className="opacity-80">{formatPhoneDisplay(client.secondary_phone_e164)}</span>
                    )}
                  </a>
                ) : (
                  <span className="text-sm font-medium text-rose-500 inline-flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 bg-rose-100 dark:bg-rose-500/20 rounded text-[10px] font-black uppercase tracking-widest border border-rose-200 dark:border-rose-500/30">SOS</span>
                    <strong>{client.secondary_display_name}</strong>
                  </span>
                )}
              </div>
            )}
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
              <div className="flex justify-between items-center pb-2 border-b border-slate-50 dark:border-white/5">
                <span className="text-slate-500 font-medium">Tabela</span>
                <span className="font-bold text-slate-800 dark:text-white text-right">{tableLabelFromClient(client)}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-slate-50 dark:border-white/5">
                <span className="text-slate-500 font-medium">Plano / Recorrência</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">{extractPeriod(client.plan_name)}</span>
              </div>

              {/* TIPO DE PLANO (Individual / Família) */}
              <div className="flex justify-between items-center pb-2 border-b border-slate-50 dark:border-white/5">
                <span className="text-slate-500 font-medium">Tipo</span>
                <span className={`font-bold text-xs px-2 py-1 rounded-md uppercase tracking-wide ${
                  tipoPlano === "familia"
                    ? "bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-200 dark:border-violet-500/20"
                    : "bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-500/20"
                }`}>
                  {tipoPlano === "familia" ? "👨‍👩‍👧 Família" : "👤 Individual"}
                </span>
              </div>

              <div className="flex justify-between items-center pb-2 border-b border-slate-50 dark:border-white/5">
                <span className="text-slate-500 font-medium">Mensalidade</span>
                <span className="font-mono font-bold text-slate-800 dark:text-white bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-md">{fmtMoney(client.price_amount, client.price_currency)}</span>
              </div>

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

          {/* CARD: AVALIAÇÕES FÍSICAS - REDESIGN COMPLETO */}
          <div className="bg-white dark:bg-[#161b22] border-y sm:border border-slate-200 dark:border-white/10 sm:rounded-xl p-5 shadow-sm transition-colors">
            <div className="flex justify-between items-start mb-6">
              <h3 className="text-[11px] font-bold text-slate-400 dark:text-white/20 uppercase tracking-widest flex items-center gap-2">
                <span className="text-base">📊</span> Análise de Composição Corporal
              </h3>
              <button
                onClick={() => setShowNovaAvModal(true)}
                className="text-[11px] px-3 py-1.5 bg-emerald-500/10 rounded-lg text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors inline-flex items-center gap-1.5"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
                Nova Avaliação
              </button>
            </div>

            {/* SEM AVALIAÇÕES */}
            {!ultimaAv && (
              <div className="py-12 text-center text-slate-400 dark:text-white/20 text-sm italic border-2 border-dashed border-slate-100 dark:border-white/5 rounded-xl">
                Nenhuma avaliação corporal registrada ainda.
              </div>
            )}

            {/* COM AVALIAÇÕES - PAINEL INBODY */}
            {ultimaAv && inbodyStats && (
              <>
                {/* SCORE + RESUMO TOP */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  {/* Score Card */}
                  <div className="md:col-span-1 bg-gradient-to-br from-slate-900 to-slate-800 dark:from-emerald-900 dark:to-slate-900 text-white rounded-xl p-5 shadow-lg relative overflow-hidden">
                    <div className="absolute -right-6 -top-6 w-24 h-24 bg-white/5 rounded-full"></div>
                    <div className="absolute -right-4 -bottom-4 w-16 h-16 bg-white/5 rounded-full"></div>
                    <div className="relative">
                      <span className="block text-[10px] font-bold uppercase tracking-widest opacity-60 mb-1">Pontuação Geral</span>
                      <div className="flex items-baseline gap-1">
                        <span className="text-5xl font-black tabular-nums tracking-tight">{inbodyStats.score}</span>
                        <span className="text-sm opacity-50 font-mono">/100</span>
                      </div>
                      <div className={`inline-block mt-2 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                        inbodyStats.score >= 80 ? "bg-emerald-500 text-white"
                          : inbodyStats.score >= 60 ? "bg-amber-500 text-white"
                            : "bg-rose-500 text-white"
                      }`}>
                        {inbodyStats.score >= 80 ? "Excelente" : inbodyStats.score >= 60 ? "Bom" : inbodyStats.score >= 40 ? "Regular" : "Atenção"}
                      </div>
                    </div>
                  </div>

                  {/* Idade Metabólica */}
                  <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-5 border border-slate-200 dark:border-white/10 flex flex-col justify-center">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Idade Metabólica</span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-black text-indigo-600 dark:text-indigo-400 tabular-nums">{inbodyStats.idadeMet || "--"}</span>
                      <span className="text-xs text-slate-400 font-medium">anos</span>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wide mt-1 ${
                      inbodyStats.idadeMet && inbodyStats.idadeMet < inbodyStats.idade ? "text-emerald-600"
                        : inbodyStats.idadeMet && inbodyStats.idadeMet > inbodyStats.idade ? "text-rose-500"
                          : "text-slate-400"
                    }`}>
                      {inbodyStats.idadeMet
                        ? inbodyStats.idadeMet < inbodyStats.idade
                          ? `↓ ${inbodyStats.idade - inbodyStats.idadeMet} anos mais jovem`
                          : inbodyStats.idadeMet > inbodyStats.idade
                            ? `↑ ${inbodyStats.idadeMet - inbodyStats.idade} anos acima`
                            : "Idade real"
                        : "—"}
                    </span>
                  </div>

                  {/* Peso Ideal */}
                  <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-5 border border-slate-200 dark:border-white/10 flex flex-col justify-center">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Controle de Peso</span>
                    <div className="flex items-baseline gap-2">
                      <span className={`text-4xl font-black tabular-nums ${
                        Math.abs(inbodyStats.difPeso) <= 2 ? "text-emerald-600" : "text-amber-600"
                      }`}>
                        {inbodyStats.difPeso > 0 ? "−" : "+"}{Math.abs(inbodyStats.difPeso).toFixed(1)}
                      </span>
                      <span className="text-xs text-slate-400 font-medium">kg</span>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mt-1">
                      Ideal: {inbodyStats.ref.pesoIdeal.toFixed(1)} kg
                    </span>
                  </div>
                </div>

                {/* BARRAS INBODY */}
                <div className="bg-slate-50/50 dark:bg-black/20 rounded-xl border border-slate-100 dark:border-white/5 p-5 mb-6 space-y-5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="block text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-widest">Análise por Métrica (última avaliação)</span>
                    <span className="text-[10px] text-slate-400 font-mono">{new Date(ultimaAv.data + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                  </div>

                  <InBodyMetricBar
                    label="Peso"
                    unit="kg"
                    value={inbodyStats.pesoKg}
                    min={inbodyStats.ref.pesoMin}
                    max={inbodyStats.ref.pesoMax}
                    absoluteMin={inbodyStats.ref.pesoMin * 0.6}
                    absoluteMax={inbodyStats.ref.pesoMax * 1.5}
                  />

                  <InBodyMetricBar
                    label="IMC"
                    unit="kg/m²"
                    value={inbodyStats.imc}
                    min={18.5}
                    max={24.9}
                    absoluteMin={14}
                    absoluteMax={40}
                  />

                  {/* % Gordura - só se medido */}
                  {inbodyStats.gorduraPct > 0 && (
                    <InBodyMetricBar
                      label="% Gordura Corporal"
                      unit="%"
                      value={inbodyStats.gorduraPct}
                      min={inbodyStats.ref.gorduraPctMin}
                      max={inbodyStats.ref.gorduraPctMax}
                      absoluteMin={3}
                      absoluteMax={50}
                    />
                  )}

                  {/* RCQ - só se mediu cintura e quadril */}
                  {inbodyStats.rcq > 0 && (
                    <InBodyMetricBar
                      label="Relação Cintura/Quadril"
                      unit="RCQ"
                      value={inbodyStats.rcq}
                      min={0.7}
                      max={inbodyStats.ref.rcqMax}
                      absoluteMin={0.6}
                      absoluteMax={1.2}
                    />
                  )}

                  {/* Aviso para coletar mais dados */}
                  {inbodyStats.gorduraPct === 0 && inbodyStats.rcq === 0 && (
                    <div className="text-[11px] text-slate-400 dark:text-white/30 italic text-center py-2 border-t border-slate-100 dark:border-white/5">
                      💡 Adicione <strong>% gordura</strong> ou <strong>perimetria (cintura + quadril)</strong> para uma análise mais completa
                    </div>
                  )}
                </div>

                {/* DERIVADOS - cards informativos */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                  <div className="bg-white dark:bg-white/5 rounded-lg p-3 border border-slate-200 dark:border-white/10">
                    <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">TMB (kcal/dia)</span>
                    <span className="font-mono font-black text-base text-slate-800 dark:text-white">{inbodyStats.tmb || "--"}</span>
                  </div>
                  {inbodyStats.massaGordura > 0 && (
                    <div className="bg-white dark:bg-white/5 rounded-lg p-3 border border-slate-200 dark:border-white/10">
                      <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Massa Gordura</span>
                      <span className="font-mono font-black text-base text-rose-500">{inbodyStats.massaGordura.toFixed(1)} kg</span>
                    </div>
                  )}
                  {inbodyStats.massaMagra > 0 && (
                    <div className="bg-white dark:bg-white/5 rounded-lg p-3 border border-slate-200 dark:border-white/10">
                      <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Massa Magra</span>
                      <span className="font-mono font-black text-base text-emerald-600">{inbodyStats.massaMagra.toFixed(1)} kg</span>
                    </div>
                  )}
                  {inbodyStats.rcq > 0 && (
                    <div className="bg-white dark:bg-white/5 rounded-lg p-3 border border-slate-200 dark:border-white/10">
                      <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">RCQ</span>
                      <span className="font-mono font-black text-base text-slate-800 dark:text-white">{inbodyStats.rcq.toFixed(2)}</span>
                    </div>
                  )}
                </div>

                {/* INSIGHTS / RECOMENDAÇÕES */}
                <div className="bg-amber-50/50 dark:bg-amber-500/5 border border-amber-200/50 dark:border-amber-500/20 rounded-xl p-4 mb-6">
                  <div className="flex items-center gap-2 mb-3">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-amber-600 dark:text-amber-400"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
                    <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-widest">Recomendações da Avaliação</span>
                  </div>
                  <ul className="space-y-1.5">
                    {inbodyStats.insights.map((i, idx) => (
                      <li key={idx} className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed flex gap-2">
                        <span className="text-amber-600 dark:text-amber-400 shrink-0 font-bold">▸</span>
                        <span>{i}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[9px] text-slate-400 dark:text-white/30 mt-3 pt-2 border-t border-amber-200/30 italic">
                    Esta análise reflete uma avaliação física e não substitui orientação médica especializada.
                  </p>
                </div>

                {/* GRÁFICO DE EVOLUÇÃO */}
                <div className="bg-white dark:bg-black/20 rounded-xl border border-slate-100 dark:border-white/5 p-4 mb-6">
                  <span className="block text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest mb-3">Curva de Peso (Evolução)</span>
                  <EvolucaoChart avaliacoes={avaliacoes} />
                </div>
              </>
            )}

            {/* LISTA DE AVALIAÇÕES */}
            {avaliacoes.length > 0 && (
              <div>
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Histórico de Relatórios</span>
                <div className="space-y-2">
                  {avaliacoes.map((av: any) => {
                    const alturaM = dadosCalc.alturaCm / 100;
                    const pesoN = Number(av.peso_kg || 0);
                    const imcN = (pesoN > 0 && alturaM > 0) ? (pesoN / (alturaM * alturaM)) : 0;
                    return (
                    <div key={av.id} className="flex items-center justify-between p-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl hover:border-emerald-300 transition-colors group relative">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                        <span className="font-bold text-slate-700 dark:text-white text-sm">{new Date(av.data + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                        <div className="flex gap-3 text-xs text-slate-500 font-medium flex-wrap">
                          <span>⚖️ {av.peso_kg || '--'} kg</span>
                          {imcN > 0 && <span>📐 IMC {imcN.toFixed(1)}</span>}
                          {av.gordura_pct && <span className="text-rose-500">🔥 {av.gordura_pct}%</span>}
                          {av.pontuacao && (
                            <span className={`font-bold ${
                              Number(av.pontuacao) >= 80 ? "text-emerald-600"
                                : Number(av.pontuacao) >= 60 ? "text-amber-600"
                                  : "text-rose-500"
                            }`}>★ {av.pontuacao}</span>
                          )}
                        </div>
                      </div>

                      <div className="relative">
                        <button
                          onClick={() => setExportMenuOpen(exportMenuOpen === av.id ? null : av.id)}
                          className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 rounded-lg font-bold text-[10px] uppercase tracking-wider transition-colors flex items-center gap-1.5 shadow-sm"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                          Exportar
                        </button>

                        {exportMenuOpen === av.id && (
                          <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-700 shadow-xl rounded-xl overflow-hidden z-50">
                            <button onClick={() => handleExportPdf('save', av)} className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2 border-b border-slate-100 dark:border-slate-700/50">
                              💾 Salvar PDF
                            </button>
                            <button onClick={() => handleExportPdf('print', av)} className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2 border-b border-slate-100 dark:border-slate-700/50">
                              🖨️ Imprimir
                            </button>
                            <button onClick={() => handleExportPdf('whatsapp', av)} className="w-full text-left px-4 py-2.5 text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors flex items-center gap-2 border-b border-slate-100 dark:border-slate-700/50">
                              💬 Enviar WhatsApp
                            </button>
                            <button onClick={() => handleExportPdf('email', av)} className="w-full text-left px-4 py-2.5 text-xs font-bold text-sky-700 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors flex items-center gap-2">
                              ✉️ Enviar por E-mail
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* CARD: TIMELINE COM FILTROS */}
          <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl p-5 shadow-sm h-fit transition-colors">
            <div className="flex justify-between items-center mb-6 gap-3 flex-wrap">
              <h3 className="text-[11px] font-bold text-slate-400 dark:text-white/20 uppercase tracking-widest flex items-center gap-2 shrink-0">
                <span className="text-base">⏳</span> Linha do tempo
                {(timelineSearch || timelineDateFilter) && (
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded-md normal-case tracking-normal">
                    {timelineFiltered.length} de {timeline.length}
                  </span>
                )}
              </h3>

              {/* FILTROS */}
              <div className="flex items-center gap-2 flex-1 sm:flex-initial justify-end">
                {/* Data */}
                <input
                  type="date"
                  value={timelineDateFilter}
                  onChange={e => setTimelineDateFilter(e.target.value)}
                  className="hidden sm:block h-8 px-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] outline-none focus:border-emerald-500 dark:[color-scheme:dark] text-slate-600 dark:text-white/70"
                  title="Filtrar por data"
                />

                {/* Search Desktop */}
                <div className="hidden sm:flex relative items-center">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="absolute left-2.5 text-slate-400 pointer-events-none"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
                  <input
                    type="text"
                    value={timelineSearch}
                    onChange={e => setTimelineSearch(e.target.value)}
                    placeholder="Buscar..."
                    className="h-8 pl-8 pr-2 w-40 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] outline-none focus:border-emerald-500 focus:w-52 transition-all text-slate-600 dark:text-white/70 placeholder:text-slate-400"
                  />
                </div>

                {/* Search Mobile (apenas lupa) */}
                <div className="sm:hidden flex items-center gap-1">
                  {showTimelineSearch ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        autoFocus
                        value={timelineSearch}
                        onChange={e => setTimelineSearch(e.target.value)}
                        placeholder="Buscar..."
                        className="h-8 px-2 w-32 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] outline-none focus:border-emerald-500 text-slate-600 dark:text-white/70"
                      />
                      <button onClick={() => { setShowTimelineSearch(false); setTimelineSearch(""); setTimelineDateFilter(""); }} className="h-8 w-8 flex items-center justify-center text-slate-400 hover:text-rose-500 transition-colors">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setShowTimelineSearch(true)} className="h-8 w-8 flex items-center justify-center bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-slate-500 hover:text-emerald-600 transition-colors">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
                    </button>
                  )}
                </div>

                {/* Limpar filtros */}
                {(timelineSearch || timelineDateFilter) && (
                  <button
                    onClick={() => { setTimelineSearch(""); setTimelineDateFilter(""); }}
                    className="hidden sm:flex h-8 w-8 items-center justify-center text-slate-400 hover:text-rose-500 transition-colors"
                    title="Limpar filtros"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-0 px-2">
              {timelineFiltered.length === 0 ? (
                <div className="py-12 text-center text-slate-400 dark:text-white/20 text-sm italic border-2 border-dashed border-slate-100 dark:border-white/5 rounded-xl">
                  {timeline.length === 0 ? "Nenhum evento registrado até o momento." : "Nenhum evento encontrado para os filtros aplicados."}
                </div>
              ) : (
                timelineFiltered.map((item, idx) => (
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
                            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></svg>
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
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              <div className="grid grid-cols-3 gap-3">
                <div onClick={() => setAnamneseForm(prev => ({ ...prev, fuma: !prev.fuma }))} className={`p-3 rounded-xl border cursor-pointer flex flex-col items-center gap-1 transition-colors ${anamneseForm.fuma ? "bg-rose-50 border-rose-200 text-rose-600" : "bg-slate-50 border-slate-200 text-slate-400"}`}>
                  <span className="text-xl">🚬</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider">Fuma?</span>
                  <span className="text-sm font-black">{anamneseForm.fuma ? "Sim" : "Não"}</span>
                </div>
                <div onClick={() => setAnamneseForm(prev => ({ ...prev, bebe: !prev.bebe }))} className={`p-3 rounded-xl border cursor-pointer flex flex-col items-center gap-1 transition-colors ${anamneseForm.bebe ? "bg-amber-50 border-amber-200 text-amber-600" : "bg-slate-50 border-slate-200 text-slate-400"}`}>
                  <span className="text-xl">🍺</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider">Bebe?</span>
                  <span className="text-sm font-black">{anamneseForm.bebe ? "Sim" : "Não"}</span>
                </div>
                <div onClick={() => setAnamneseForm(prev => ({ ...prev, drogas: !prev.drogas }))} className={`p-3 rounded-xl border cursor-pointer flex flex-col items-center gap-1 transition-colors ${anamneseForm.drogas ? "bg-rose-50 border-rose-200 text-rose-600" : "bg-slate-50 border-slate-200 text-slate-400"}`}>
                  <span className="text-xl">💊</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider">Drogas?</span>
                  <span className="text-sm font-black">{anamneseForm.drogas ? "Sim" : "Não"}</span>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Objetivo Principal</label>
                <select value={anamneseForm.objetivo} onChange={e => setAnamneseForm(v => ({ ...v, objetivo: e.target.value }))} className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500">
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

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Doenças Crônicas / Condições</label>
                <textarea value={anamneseForm.doencas_cronicas} onChange={e => setAnamneseForm(v => ({ ...v, doencas_cronicas: e.target.value }))} placeholder="Ex: Hipertensão, asma, diabetes..." className="w-full h-16 px-3 py-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500 resize-none" />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Lesões / Limitações Físicas</label>
                <textarea value={anamneseForm.lesoes} onChange={e => setAnamneseForm(v => ({ ...v, lesoes: e.target.value }))} placeholder="Ex: Hérnia de disco, lesão no joelho direito..." className="w-full h-16 px-3 py-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500 resize-none" />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Histórico Médico Geral</label>
                <textarea value={anamneseForm.historico_medico} onChange={e => setAnamneseForm(v => ({ ...v, historico_medico: e.target.value }))} placeholder="Cirurgias passadas, medicamentos de uso contínuo..." className="w-full h-16 px-3 py-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500 resize-none" />
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
        <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200 overflow-y-auto">
          <div className="w-full max-w-3xl bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col my-4">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex justify-between items-center shrink-0">
              <h2 className="text-base font-bold text-slate-800 dark:text-white flex items-center gap-2">
                <span>📏</span> Nova Avaliação Física
              </h2>
              <button onClick={() => setShowNovaAvModal(false)} className="text-slate-400 hover:text-rose-500 transition-colors">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">

              {/* MÉTRICAS PRINCIPAIS - bem reduzido */}
              <div>
                <span className="block text-sm font-bold text-slate-800 dark:text-white border-b border-slate-200 dark:border-white/10 pb-1 mb-4">Métricas Principais</span>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Data</label>
                    <input type="date" value={novaAv.data} onChange={e => setNovaAv(v => ({ ...v, data: e.target.value }))} className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500 dark:[color-scheme:dark]" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Peso (kg) <span className="text-rose-500 normal-case">*</span></label>
                    <input type="number" step="0.1" value={novaAv.peso_kg} onChange={e => setNovaAv(v => ({ ...v, peso_kg: e.target.value }))} placeholder="70.5" className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      % Gordura <span className="text-slate-400 normal-case font-normal">(opcional)</span>
                    </label>
                    <input type="number" step="0.1" value={novaAv.gordura_pct} onChange={e => setNovaAv(v => ({ ...v, gordura_pct: e.target.value }))} placeholder="15.0" className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500" />
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 mt-2 italic">
                  💡 IMC, Massa Magra, Massa Gordura, TMB e Pontuação são calculados automaticamente.
                </p>
              </div>

              {/* PERIMETRIA */}
              <div>
                <span className="block text-sm font-bold text-slate-800 dark:text-white border-b border-slate-200 dark:border-white/10 pb-1 mb-4">
                  Perimetria <span className="text-[10px] text-slate-400 font-normal normal-case">(em cm — preencha só o que mediu)</span>
                </span>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-3">
                  {([["cintura_cm", "Cintura"], ["quadril_cm", "Quadril"], ["abdomen_cm", "Abdômen"], ["ombro_cm", "Ombro"], ["braco_cm", "Braço"], ["coxa_cm", "Coxa"], ["panturrilha_cm", "Panturr."]] as const).map(([k, l]) => (
                    <div key={k}>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{l}</label>
                      <input type="number" value={novaAv[k]} onChange={e => setNovaAv(v => ({ ...v, [k]: e.target.value }))} placeholder="—" className="w-full h-9 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500" />
                    </div>
                  ))}
                </div>
                {novaAv.cintura_cm && novaAv.quadril_cm && (
                  <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-2 font-bold">
                    ✓ RCQ que será calculado: {(Number(novaAv.cintura_cm) / Number(novaAv.quadril_cm)).toFixed(2)}
                  </p>
                )}
              </div>

              {/* PREVIEW DOS CÁLCULOS - mostra em tempo real conforme preenche */}
              {Number(novaAv.peso_kg) > 0 && (
                <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl p-4">
                  <span className="block text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-widest mb-3">Pré-visualização dos Cálculos</span>
                  {(() => {
                    const { idade, sexoStr, alturaCm, ref } = dadosCalc;
                    const alturaM = alturaCm / 100;
                    const pesoN = Number(novaAv.peso_kg || 0);
                    const gN = Number(novaAv.gordura_pct || 0);
                    const cN = Number(novaAv.cintura_cm || 0);
                    const qN = Number(novaAv.quadril_cm || 0);
                    const imcN = pesoN > 0 && alturaM > 0 ? pesoN / (alturaM * alturaM) : 0;
                    const rcqN = cN > 0 && qN > 0 ? cN / qN : 0;
                    const mGordN = gN > 0 ? (gN / 100) * pesoN : 0;
                    const mMagraN = mGordN > 0 ? pesoN - mGordN : 0;
                    const tmbN = calcularTMB({ sexo: sexoStr, pesoKg: pesoN, alturaCm, idade });
                    const scoreN = calcularScoreInBody({ imc: imcN, gorduraPct: gN, pesoKg: pesoN, rcq: rcqN, ref });

                    return (
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                        <div className="bg-white dark:bg-black/20 rounded-lg p-2.5">
                          <div className="text-[9px] font-bold text-slate-400 uppercase">IMC</div>
                          <div className="font-mono font-black text-slate-800 dark:text-white">{imcN > 0 ? imcN.toFixed(1) : "—"}</div>
                        </div>
                        <div className="bg-white dark:bg-black/20 rounded-lg p-2.5">
                          <div className="text-[9px] font-bold text-slate-400 uppercase">TMB</div>
                          <div className="font-mono font-black text-slate-800 dark:text-white">{tmbN || "—"}</div>
                        </div>
                        {mGordN > 0 && (
                          <div className="bg-white dark:bg-black/20 rounded-lg p-2.5">
                            <div className="text-[9px] font-bold text-slate-400 uppercase">M. Gordura</div>
                            <div className="font-mono font-black text-rose-500">{mGordN.toFixed(1)} kg</div>
                          </div>
                        )}
                        {mMagraN > 0 && (
                          <div className="bg-white dark:bg-black/20 rounded-lg p-2.5">
                            <div className="text-[9px] font-bold text-slate-400 uppercase">M. Magra</div>
                            <div className="font-mono font-black text-emerald-600">{mMagraN.toFixed(1)} kg</div>
                          </div>
                        )}
                        <div className="bg-white dark:bg-black/20 rounded-lg p-2.5 col-span-2 md:col-span-1">
                          <div className="text-[9px] font-bold text-slate-400 uppercase">Pontuação</div>
                          <div className={`font-mono font-black ${scoreN >= 80 ? "text-emerald-600" : scoreN >= 60 ? "text-amber-600" : "text-rose-500"}`}>{scoreN || "—"}/100</div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* OBSERVAÇÕES */}
              <div>
                <label className="block text-sm font-bold text-slate-800 dark:text-white mb-2">Observações do Treinador</label>
                <textarea value={novaAv.observacoes} onChange={e => setNovaAv(v => ({ ...v, observacoes: e.target.value }))} placeholder="Diagnóstico, evolução, pontos de atenção..." className="w-full h-20 px-3 py-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500 resize-none" />
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
