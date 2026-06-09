"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
Search, RefreshCw, ChevronDown,
  AlertTriangle, CheckCircle, X, Tv
} from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────
type Canal = {
  id: string; display_name: string; nome: string;
  categoria: string; icon: string; servidor: string;
};
type Programa = {
  channel_id: string; channel_nome: string; categoria: string;
  start: string; stop: string; duracao_min: number;
  title: string; desc: string;
  prog_icon?: string;
};
type EpgData = {
  gerado_em: string; fast_gerado_em: string | null; fast_valido: boolean;
  servidores_ok: string[]; total_canais: number; total_programas: number;
  canais: Canal[]; programas: Programa[];
};

// ─── Constantes ───────────────────────────────────────────────
const CATS_ORDEM = [
  "Aberta","Notícias","Esportes","Filmes","Variedades",
  "Documentários","Infantil","Música","Regional","Religioso","Outros"
];
const CAT_COR: Record<string,string> = {
  "Aberta":"#3b82f6","Notícias":"#ef4444","Esportes":"#10b981",
  "Filmes":"#f59e0b","Variedades":"#8b5cf6","Documentários":"#06b6d4",
  "Infantil":"#ec4899","Música":"#6366f1","Regional":"#84cc16",
  "Religioso":"#f97316","Outros":"#6b7280",
};
const CAT_EMOJI: Record<string,string> = {
  "Aberta":"📺","Notícias":"📰","Esportes":"⚽","Filmes":"🎬",
  "Variedades":"🎭","Documentários":"🌍","Infantil":"🧒","Música":"🎵",
  "Regional":"🗺️","Religioso":"✝️","Outros":"📡",
};
const SUBGRUPOS: Record<string,{label:string;match:string[]}[]> = {
  "Esportes":[
    {label:"SporTV",   match:["SPORTV","SPORT TV"]},
    {label:"Premiere", match:["PREMIERE"]},
    {label:"ESPN",     match:["ESPN"]},
    {label:"Combate",  match:["COMBATE"]},
    {label:"BandSports",match:["BANDSPORT","BAND SPORT"]},
    {label:"CONMEBOL", match:["CONMEBOL"]},
    {label:"DAZN",     match:["DAZN"]},
  ],
  "Filmes":[
    {label:"Telecine", match:["TELECINE"]},
    {label:"HBO",      match:["HBO"]},
    {label:"Cinemax",  match:["CINEMAX"]},
    {label:"TNT",      match:["TNT"]},
    {label:"Star",     match:["STAR ","STAR C","STAR H","STAR L","STAR A"]},
    {label:"Universal",match:["UNIVERSAL","STUDIO UNIVERSAL"]},
    {label:"Warner",   match:["WARNER"]},
    {label:"Paramount",match:["PARAMOUNT"]},
    {label:"Megapix",  match:["MEGAPIX"]},
    {label:"AXN",      match:["AXN"]},
  ],
  "Variedades":[
    {label:"Multishow",match:["MULTISHOW"]},
    {label:"GNT",      match:["GNT"]},
    {label:"TLC",      match:["TLC"]},
    {label:"E!",       match:["E!"]},
    {label:"Lifetime", match:["LIFETIME"]},
  ],
  "Documentários":[
    {label:"Discovery",match:["DISCOVERY"]},
    {label:"History",  match:["HISTORY"]},
    {label:"Nat Geo",  match:["NAT GEO","NATIONAL GEO","NATGEO"]},
    {label:"Animal Planet",match:["ANIMAL PLANET"]},
    {label:"A&E",      match:["A&E"]},
  ],
  "Infantil":[
    {label:"Cartoon",  match:["CARTOON"]},
    {label:"Disney",   match:["DISNEY"]},
    {label:"Nick",     match:["NICK","NICKELODEON"]},
    {label:"Gloob",    match:["GLOOB"]},
    {label:"Discovery Kids",match:["DISCOVERY KIDS"]},
  ],
  "Aberta":[
    {label:"Globo",    match:["GLOBO"]},
    {label:"SBT",      match:["SBT"]},
    {label:"Record",   match:["RECORD","RECORDTV"]},
    {label:"Band",     match:["BAND ","BANDNEWS"]},
    {label:"RedeTV",   match:["REDETV"]},
  ],
};

// EPG grid: quantas horas mostrar
const HORAS_VISIVEIS = 4;
const MIN_POR_PX = 0.25; // 1px = 0.25 min → 240px por hora
const PX_POR_MIN = 1 / MIN_POR_PX; // 4px por minuto
const HORA_WIDTH = 60 * PX_POR_MIN; // 240px por hora
const CANAL_COL_W = 180; // largura da coluna de canal

// ─── Helpers ─────────────────────────────────────────────────
function nowBRT(): Date {
  // Cria um Date que representa o horário atual de São Paulo
  // usando Intl para garantir o offset correto independente do servidor
  const now = new Date();
  const brtStr = now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" });
  return new Date(brtStr);
}

function nowBRTMs(): number {
  return nowBRT().getTime();
}

function formatHora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR",
    { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}
function formatDataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR",
    { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit", timeZone:"America/Sao_Paulo" });
}
function diasDecorridos(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
function iniciais(nome: string) {
  return nome.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}
function minutosDesdeInicio(iso: string, baseMs: number): number {
  // new Date(iso) já converte corretamente strings ISO com offset
  const t = new Date(iso).getTime();
  return (t - baseMs) / 60000;
}

// ─── Logo do canal ────────────────────────────────────────────
function Logo({ canal, size = 44 }: { canal: Canal; size?: number }) {
  const [err, setErr] = useState(false);
  const cor = CAT_COR[canal.categoria] || "#6b7280";
  if (!canal.icon || err) return (
    <div style={{
      width: size, height: size, flexShrink: 0,
      background: cor + "20", border: `1.5px solid ${cor}40`,
      borderRadius: 8, display: "flex", alignItems: "center",
      justifyContent: "center", fontSize: size * 0.3, fontWeight: 700,
      color: cor, letterSpacing: "-0.5px",
    }}>{iniciais(canal.nome)}</div>
  );
  return (
    <img src={canal.icon} alt={canal.nome} onError={() => setErr(true)}
      style={{
        width: size, height: size, flexShrink: 0,
        objectFit: "contain", borderRadius: 8,
        background: "#111", border: "1px solid #ffffff12",
      }}
    />
  );
}

// ─── Tooltip do programa ──────────────────────────────────────
function ProgramaTooltip({ prog, onClose }: { prog: Programa; onClose: () => void }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.7)", padding: 16,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#1a1a1a", border: "1px solid #333",
        borderRadius: 14, padding: 20, maxWidth: 420, width: "100%",
        boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {prog.channel_nome} · {prog.categoria}
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#fff", lineHeight: 1.3 }}>
              {prog.title}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#888", padding: "0 0 0 12px", flexShrink: 0 }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: "#f59e0b", fontWeight: 600 }}>
            {formatHora(prog.start)} – {formatHora(prog.stop)}
          </span>
          <span style={{ fontSize: 12, color: "#666" }}>
            · {prog.duracao_min} min
          </span>
        </div>
        {prog.desc && (
          <div style={{ fontSize: 13, color: "#aaa", lineHeight: 1.6 }}>
            {prog.desc}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Grade EPG ────────────────────────────────────────────────
function GradeEPG({ canais, progsPorCanal }: {
  canais: Canal[];
  progsPorCanal: Map<string, Programa[]>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [agora, setAgora] = useState(nowBRT());
  const [progSelecionado, setProgSelecionado] = useState<Programa | null>(null);
  const [scrollX, setScrollX] = useState(0);

  // Atualiza agora a cada minuto
  useEffect(() => {
    const iv = setInterval(() => setAgora(nowBRT()), 60000);
    return () => clearInterval(iv);
  }, []);

  // Base = 1h atrás do horário UTC-3 atual (hora cheia)
  const baseMs = useMemo(() => {
    // Data/hora atual em UTC-3 (BRT): subtrai 3h do UTC
    const agoraBRTMs = Date.now() - 3 * 3600000;
    // Arredonda para a hora cheia anterior, depois subtrai 1h
    const horaCheia = Math.floor(agoraBRTMs / 3600000) * 3600000;
    return horaCheia - 3600000; // 1h antes da hora cheia atual
  }, []);

  const totalHoras = HORAS_VISIVEIS + 2; // +2 para buffer
  const gradeWidth = totalHoras * HORA_WIDTH;

  // Posição do cursor "agora" — diferença em minutos desde baseMs
  const agoraOffsetPx = useMemo(() => {
    const diffMs = agora.getTime() - baseMs;
    const diffMin = diffMs / 60000;
    return diffMin * PX_POR_MIN;
  }, [agora, baseMs]);

  // Labels de hora na régua
  const horaLabels = useMemo(() => {
    const labels = [];
    for (let i = 0; i <= totalHoras; i++) {
      const t = new Date(baseMs + i * 3600000);
      const h = t.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
      labels.push({ x: i * HORA_WIDTH, label: h });
    }
    return labels;
  }, [baseMs, totalHoras]);

  // Scroll para "agora" no carregamento
  useEffect(() => {
    if (containerRef.current) {
      const target = Math.max(0, agoraOffsetPx - 80);
      containerRef.current.scrollLeft = target;
    }
  }, [agoraOffsetPx]);

  const LINHA_H = 64; // altura de cada linha de canal
  const REGUA_H = 36; // altura da régua de horas

  return (
    <>
      {progSelecionado && (
        <ProgramaTooltip prog={progSelecionado} onClose={() => setProgSelecionado(null)} />
      )}

      <div style={{ display: "flex", flexDirection: "column", background: "#0a0a0a" }}>
        {/* Cabeçalho com régua */}
        <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 10, background: "#0a0a0a", borderBottom: "1px solid #1e1e1e" }}>
          {/* Canto vazio */}
          <div style={{ width: CANAL_COL_W, flexShrink: 0, height: REGUA_H, background: "#0f0f0f", borderRight: "1px solid #1e1e1e" }} />
          {/* Régua de horas */}
          <div style={{ overflow: "hidden", flex: 1 }}>
            <div style={{ position: "relative", width: gradeWidth, height: REGUA_H }}>
              {horaLabels.map((h, i) => (
                <div key={i} style={{
                  position: "absolute", left: h.x, top: 0,
                  height: "100%", display: "flex", alignItems: "center",
                  paddingLeft: 8, borderLeft: i > 0 ? "1px solid #1e1e1e" : "none",
                }}>
                  <span style={{ fontSize: 11, color: "#555", fontWeight: 500, whiteSpace: "nowrap" }}>
                    {h.label}
                  </span>
                </div>
              ))}
              {/* Linha vermelha "agora" na régua */}
              <div style={{
                position: "absolute", left: agoraOffsetPx, top: 0,
                width: 2, height: "100%",
                background: "#ef4444", zIndex: 5,
              }} />
            </div>
          </div>
        </div>

        {/* Linhas de canais */}
        <div style={{ display: "flex", overflow: "hidden" }}>
          {/* Coluna fixa de canais */}
          <div style={{ width: CANAL_COL_W, flexShrink: 0 }}>
            {canais.map(canal => (
              <div key={canal.id} style={{
                height: LINHA_H, display: "flex", alignItems: "center",
                gap: 10, padding: "0 12px",
                borderBottom: "1px solid #141414",
                borderRight: "1px solid #1e1e1e",
                background: "#0f0f0f",
              }}>
                <Logo canal={canal} size={36} />
                <span style={{
                  fontSize: 11, color: "#bbb", fontWeight: 500,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {canal.nome}
                </span>
              </div>
            ))}
          </div>

          {/* Grade de programas — scroll horizontal */}
          <div
            ref={containerRef}
            style={{ overflow: "auto", flex: 1 }}
            onScroll={e => setScrollX((e.target as HTMLDivElement).scrollLeft)}
          >
            <div style={{ position: "relative", width: gradeWidth }}>
              {/* Linha vermelha "agora" sobre os programas */}
              <div style={{
                position: "absolute", left: agoraOffsetPx, top: 0,
                width: 2, height: canais.length * LINHA_H,
                background: "#ef4444", zIndex: 5, pointerEvents: "none",
              }} />

              {/* Grades verticais de hora */}
              {horaLabels.map((h, i) => i > 0 && (
                <div key={i} style={{
                  position: "absolute", left: h.x, top: 0,
                  width: 1, height: canais.length * LINHA_H,
                  background: "#1e1e1e", pointerEvents: "none",
                }} />
              ))}

              {/* Linhas de programas */}
              {canais.map((canal, rowIdx) => {
                const progs = (progsPorCanal.get(canal.id) || [])
                  .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
                const cor = CAT_COR[canal.categoria] || "#6b7280";

                return (
                  <div key={canal.id} style={{
                    position: "absolute", top: rowIdx * LINHA_H,
                    left: 0, width: gradeWidth, height: LINHA_H,
                    borderBottom: "1px solid #141414",
                    display: "flex", alignItems: "center",
                  }}>
                    {progs.map(prog => {
                      const startMin = minutosDesdeInicio(prog.start, baseMs);
                      const durMin = prog.duracao_min || 30;
                      const leftPx = startMin * PX_POR_MIN;
                      const widthPx = Math.max(durMin * PX_POR_MIN - 2, 4);
                      const isAtual = new Date(prog.start).getTime() <= agora.getTime() &&
                        new Date(prog.stop).getTime() >= agora.getTime();

                      return (
                        <div
                          key={prog.start}
                          onClick={() => setProgSelecionado(prog)}
                          style={{
                            position: "absolute",
                            left: leftPx + 1, width: widthPx - 1,
                            top: 4, bottom: 4, borderRadius: 6,
                            background: isAtual ? cor + "28" : "#161616",
                            border: isAtual ? `1px solid ${cor}55` : "1px solid #222",
                            overflow: "hidden", cursor: "pointer",
                            display: "flex", alignItems: "center",
                            padding: "0 0 0 0", gap: 0,
                            transition: "background 0.15s, border-color 0.15s",
                          }}
                          onMouseEnter={e => {
                            (e.currentTarget as HTMLDivElement).style.background = isAtual ? cor + "40" : "#222";
                            (e.currentTarget as HTMLDivElement).style.borderColor = cor + "55";
                          }}
                          onMouseLeave={e => {
                            (e.currentTarget as HTMLDivElement).style.background = isAtual ? cor + "28" : "#161616";
                            (e.currentTarget as HTMLDivElement).style.borderColor = isAtual ? cor + "55" : "#222";
                          }}
                        >
                          {/* Imagem do programa — só se tiver espaço */}
                          {prog.prog_icon && widthPx > 80 && (
                            <img
                              src={prog.prog_icon}
                              alt=""
                              style={{
                                height: "100%", width: "auto",
                                maxWidth: Math.min(widthPx * 0.3, 56),
                                objectFit: "cover",
                                flexShrink: 0,
                                opacity: 0.9,
                              }}
                            />
                          )}
                          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 5, padding: "0 8px" }}>
                            {isAtual && (
                              <div style={{
                                width: 5, height: 5, borderRadius: "50%",
                                background: cor, flexShrink: 0,
                                boxShadow: `0 0 5px ${cor}`,
                              }} />
                            )}
                            <span style={{
                              fontSize: 11, color: isAtual ? "#fff" : "#777",
                              fontWeight: isAtual ? 500 : 400,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                              {widthPx > 70 ? `${formatHora(prog.start)} ${prog.title}` : prog.title}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {/* Faixa "sem programação" onde não há programas */}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Dropdown customizado ─────────────────────────────────────
function Dropdown({
  label, icon, options, value, onChange, disabled = false,
}: {
  label: string; icon?: string;
  options: { value: string; label: string }[];
  value: string; onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", minWidth: 260, flex: 1 }}>
      {/* Label acima */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        marginBottom: 8, fontSize: 11, color: "#f97316",
        fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px",
      }}>
        {icon && <span>{icon}</span>}
        {label}
      </div>
      {/* Trigger */}
      <button
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        style={{
          width: "100%", height: 44, padding: "0 14px",
          background: "#111", border: "1px solid #2a2a2a",
          borderRadius: 8, display: "flex", alignItems: "center",
          justifyContent: "space-between", cursor: disabled ? "not-allowed" : "pointer",
          color: disabled ? "#444" : "#ccc", fontSize: 14,
          transition: "border-color 0.15s",
        }}
        onMouseEnter={e => !disabled && ((e.currentTarget as HTMLButtonElement).style.borderColor = "#444")}
        onMouseLeave={e => !disabled && ((e.currentTarget as HTMLButtonElement).style.borderColor = "#2a2a2a")}
      >
        <span>{selected ? selected.label : "Escolha uma categoria"}</span>
        <ChevronDown style={{ width: 16, height: 16, opacity: 0.5, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "#111", border: "1px solid #2a2a2a", borderRadius: 8,
          zIndex: 100, overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.8)",
          maxHeight: 320, overflowY: "auto",
        }}>
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                width: "100%", padding: "10px 14px", background: "none",
                border: "none", textAlign: "left", cursor: "pointer",
                color: opt.value === value ? "#f97316" : "#aaa",
                fontSize: 13, transition: "all 0.1s",
                borderLeft: opt.value === value ? "2px solid #f97316" : "2px solid transparent",
              }}
              onMouseEnter={e => {
                if (opt.value !== value) (e.currentTarget as HTMLButtonElement).style.background = "#1a1a1a";
                (e.currentTarget as HTMLButtonElement).style.color = opt.value === value ? "#f97316" : "#fff";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "none";
                (e.currentTarget as HTMLButtonElement).style.color = opt.value === value ? "#f97316" : "#aaa";
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────
export default function GuiaTVPage() {
  const [epg, setEpg]             = useState<EpgData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [erro, setErro]           = useState<string | null>(null);
  const [catAtiva, setCatAtiva]   = useState("Todos");
  const [subAtiva, setSubAtiva]   = useState("Todos");
  const [busca, setBusca]         = useState("");
const [syncing, setSyncing]     = useState(false);
  const [msg, setMsg]             = useState<{tipo:"ok"|"err";texto:string}|null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true); setErro(null);
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_R2_DEV_URL}/epg/epg_br.json?t=${Date.now()}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setEpg(await res.json());
      } catch { setErro("Grade não encontrada. Rode o sync para carregar."); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  // Programas: 2h atrás até 10h à frente, horário BRT
  const progsPorCanal = useMemo(() => {
    if (!epg) return new Map<string, Programa[]>();
    const map = new Map<string, Programa[]>();
    // Usa Date.now() + offset BRT (-3h = -10800000ms)
    const agoraMs = Date.now() - 3 * 3600000; // UTC-3
    const inicio  = agoraMs - 2 * 3600000;
    const fim     = agoraMs + 10 * 3600000;
    for (const p of epg.programas) {
      // new Date(iso) com offset -03:00 converte para UTC internamente
      const s = new Date(p.start).getTime();
      const e = new Date(p.stop).getTime();
      if (e < inicio || s > fim) continue;
      const arr = map.get(p.channel_id) || [];
      arr.push(p);
      map.set(p.channel_id, arr);
    }
    return map;
  }, [epg]);

  // Categorias disponíveis
  const catsDisponiveis = useMemo(() => {
    if (!epg) return [];
    const set = new Set(epg.canais.map(c => c.categoria));
    return CATS_ORDEM.filter(c => set.has(c));
  }, [epg]);

  // Subgrupos da categoria ativa
  const subgruposDisponiveis = useMemo(() => {
    if (catAtiva === "Todos") return [];
    return SUBGRUPOS[catAtiva] || [];
  }, [catAtiva]);

  // Canais filtrados
  const canaisFiltrados = useMemo(() => {
    if (!epg) return [];
    let lista = epg.canais;
    if (catAtiva !== "Todos") lista = lista.filter(c => c.categoria === catAtiva);
    if (subAtiva !== "Todos") {
      const sg = subgruposDisponiveis.find(s => s.label === subAtiva);
      if (sg) lista = lista.filter(c => sg.match.some(m => c.display_name.toUpperCase().includes(m)));
    }
    if (busca.trim()) {
      const q = busca.trim().toLowerCase();
      lista = lista.filter(c => c.nome.toLowerCase().includes(q) || c.display_name.toLowerCase().includes(q));
    }
    return lista;
  }, [epg, catAtiva, subAtiva, subgruposDisponiveis, busca]);

  // Quando muda categoria, reseta subcategoria
  function handleCatChange(v: string) {
    setCatAtiva(v);
    setSubAtiva("Todos");
  }

  

  async function handleSync() {
    setSyncing(true); setMsg(null);
    try {
      const d = await fetch("/api/epg/sync", { method: "POST" }).then(r => r.json());
      if (d.ok) {
        const srvs = d.log?.resultado?.servidores_ok?.join(" + ");
        setMsg({ tipo: "ok", texto: `Sync OK — ${srvs} em ${d.duracao_s}s` });
        setTimeout(() => window.location.reload(), 1800);
      } else setMsg({ tipo: "err", texto: d.error || "Sync falhou" });
    } catch (e: any) { setMsg({ tipo: "err", texto: e.message }); }
    finally { setSyncing(false); }
  }

  // Opções dos dropdowns
  const catOptions = [
    { value: "Todos", label: "📡 Todos os canais" },
    ...catsDisponiveis.map(c => ({
      value: c,
      label: `${CAT_EMOJI[c]} ${c} (${epg?.canais.filter(ch => ch.categoria === c).length || 0})`,
    })),
  ];
  const subOptions = [
    { value: "Todos", label: `Todos em ${catAtiva}` },
    ...subgruposDisponiveis.map(s => ({
      value: s.label,
      label: `${s.label} (${epg?.canais.filter(c => c.categoria === catAtiva && s.match.some(m => c.display_name.toUpperCase().includes(m))).length || 0})`,
    })),
  ];

  return (
    // Força dark nessa página
    <div style={{
      background: "#080808", minHeight: "100vh",
      color: "#ccc", fontFamily: "inherit",
    }}>
      {/* Topo */}
      <div style={{
        padding: "14px 20px", borderBottom: "1px solid #1a1a1a",
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        background: "#0d0d0d",
      }}>
        <Tv style={{ color: "#ef4444", width: 18, height: 18, flexShrink: 0 }} />
        <span style={{ fontSize: 16, fontWeight: 500, color: "#eee" }}>Guia TV</span>
        {epg && (
          <span style={{ fontSize: 12, color: "#555" }}>
            · {epg.total_canais} canais · {formatDataHora(epg.gerado_em)}
          </span>
        )}
        <div style={{ flex: 1 }} />

        
        <button onClick={handleSync} disabled={syncing}
          style={{
            display: "flex", alignItems: "center", gap: 5, fontSize: 12,
            color: syncing ? "#555" : "#10b981",
            background: "#111", border: `1px solid ${syncing ? "#222" : "#10b98130"}`,
            borderRadius: 7, padding: "5px 10px", cursor: syncing ? "not-allowed" : "pointer",
          }}>
          <RefreshCw style={{ width: 12, height: 12, animation: syncing ? "spin 1s linear infinite" : "none" }} />
          {syncing ? "Sync..." : "Sync"}
        </button>
      </div>

      {/* Feedback */}
      {msg && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "10px 20px",
          background: msg.tipo === "ok" ? "#10b98115" : "#ef444415",
          borderBottom: `1px solid ${msg.tipo === "ok" ? "#10b98130" : "#ef444430"}`,
          fontSize: 13, color: msg.tipo === "ok" ? "#10b981" : "#ef4444",
        }}>
          {msg.tipo === "ok" ? <CheckCircle style={{ width: 14, height: 14 }} /> : <AlertTriangle style={{ width: 14, height: 14 }} />}
          {msg.texto}
          <button onClick={() => setMsg(null)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "inherit" }}>
            <X style={{ width: 13, height: 13 }} />
          </button>
        </div>
      )}

      {/* Filtros */}
      <div style={{
        padding: "20px 20px 16px",
        background: "#0d0d0d", borderBottom: "1px solid #1a1a1a",
        display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end",
      }}>
        {/* Dropdown Categoria */}
        <Dropdown
          label="Selecione a Categoria"
          icon="📺"
          options={catOptions}
          value={catAtiva}
          onChange={handleCatChange}
        />

        {/* Dropdown Subcategoria (só aparece quando tem subgrupos) */}
        {subgruposDisponiveis.length > 0 && (
          <Dropdown
            label="Subcategoria"
            icon="🔍"
            options={subOptions}
            value={subAtiva}
            onChange={setSubAtiva}
          />
        )}

        {/* Busca */}
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            marginBottom: 8, fontSize: 11, color: "#f97316",
            fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px",
          }}>
            <Search style={{ width: 11, height: 11 }} /> Pesquisar Canais
          </div>
          <div style={{ position: "relative" }}>
            <input
              value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Digite o nome do canal..."
              style={{
                width: "100%", height: 44, paddingLeft: 14, paddingRight: 44,
                background: "#111", border: "1px solid #2a2a2a",
                borderRadius: 8, fontSize: 14, color: "#ccc",
                outline: "none", boxSizing: "border-box",
              }}
              onFocus={e => (e.target.style.borderColor = "#f97316")}
              onBlur={e => (e.target.style.borderColor = "#2a2a2a")}
            />
            <div style={{
              position: "absolute", right: 0, top: 0, height: 44, width: 44,
              background: "#f97316", borderRadius: "0 8px 8px 0",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}>
              <Search style={{ width: 16, height: 16, color: "#fff" }} />
            </div>
          </div>
        </div>
      </div>

      {/* Contador */}
      {!loading && !erro && epg && (
        <div style={{ padding: "8px 20px", fontSize: 12, color: "#444", background: "#080808" }}>
          {canaisFiltrados.length} canal{canaisFiltrados.length !== 1 ? "is" : ""}
          {busca ? ` para "${busca}"` : ""}
          {catAtiva !== "Todos" ? ` · ${catAtiva}` : ""}
          {subAtiva !== "Todos" ? ` · ${subAtiva}` : ""}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: 80, color: "#555", fontSize: 14 }}>
          <RefreshCw style={{ width: 18, height: 18, animation: "spin 1s linear infinite" }} />
          Carregando grade de programação...
        </div>
      )}

      {/* Erro */}
      {erro && !loading && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 80, textAlign: "center" }}>
          <AlertTriangle style={{ width: 28, height: 28, color: "#f59e0b" }} />
          <div style={{ fontSize: 15, fontWeight: 500, color: "#eee" }}>Grade não encontrada</div>
          <div style={{ fontSize: 13, color: "#555" }}>{erro}</div>
          <button onClick={handleSync} disabled={syncing}
            style={{
              display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500,
              color: "#10b981", background: "#10b98115", border: "1px solid #10b98130",
              borderRadius: 9, padding: "8px 16px", cursor: "pointer",
            }}>
            <RefreshCw style={{ width: 14, height: 14 }} />
            {syncing ? "Sincronizando..." : "Sincronizar agora"}
          </button>
        </div>
      )}

      {/* Grade EPG */}
      {!loading && !erro && epg && (
        <div style={{ overflowX: "hidden" }}>
          {canaisFiltrados.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: "#555", fontSize: 14 }}>
              Nenhum canal encontrado.
            </div>
          ) : (
            <GradeEPG canais={canaisFiltrados} progsPorCanal={progsPorCanal} />
          )}
        </div>
      )}

      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #111; }
        ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #333; }
      `}</style>
    </div>
  );
}
