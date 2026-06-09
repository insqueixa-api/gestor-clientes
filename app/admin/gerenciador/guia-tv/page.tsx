"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Search, RefreshCw, ChevronDown, AlertTriangle, CheckCircle,
  X, Tv, Film, Clapperboard, Database, Play, Clock,
  Wifi, Server, LayoutGrid
} from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────
type Canal = {
  id: string; display_name: string; nome: string;
  categoria: string; icon: string; servidor: string;
};
type Programa = {
  channel_id: string; channel_nome: string; categoria: string;
  start: string; stop: string; duracao_min: number;
  title: string; desc: string; prog_icon?: string;
};
type EpgData = {
  gerado_em: string; servidores_ok: string[];
  total_canais: number; total_programas: number;
  canais: Canal[]; programas: Programa[];
};
type CatalogItem = {
  id: string; titulo_normalizado: string; tipo: "CANAL" | "FILME" | "SERIE";
  cover_url: string | null; ano: number | null;
  total_temporadas: number; total_episodios: number;
  elite_desde: string | null; natv_desde: string | null; fast_desde: string | null;
  elite_categoria: string | null; natv_categoria: string | null; fast_categoria: string | null;
  disponivel_elite: boolean; disponivel_natv: boolean; disponivel_fast: boolean;
  total_servidores: number;
};
type SyncStatus = "idle" | "waiting" | "running" | "ok" | "error";
type SyncState = {
  elite: SyncStatus; fast: SyncStatus; natv: SyncStatus;
  eliteStats: any; fastStats: any; natvStats: any;
};

// ─── Constantes ───────────────────────────────────────────────────────────────
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

// Cores por servidor
const SERVIDOR_COR: Record<string,string> = {
  ELITE: "#6366f1", NATV: "#f59e0b", FAST: "#10b981",
};
const SERVIDOR_LABEL: Record<string,string> = {
  ELITE: "Elite", NATV: "NaTV", FAST: "Fast",
};

const PX_POR_MIN  = 4;
const HORA_WIDTH  = 60 * PX_POR_MIN;
const CANAL_COL_W = 180;
const LINHA_H     = 60;
const REGUA_H     = 34;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function nowBRT(): Date {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}
function formatHora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR",
    { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}
function formatDataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR",
    { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit", timeZone:"America/Sao_Paulo" });
}
function iniciais(nome: string) {
  return nome.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}
function numFmt(n: number) {
  return n.toLocaleString("pt-BR");
}

// ─── Logo canal ───────────────────────────────────────────────────────────────
function Logo({ src, nome, categoria, size = 44 }: {
  src?: string; nome: string; categoria?: string; size?: number;
}) {
  const [err, setErr] = useState(false);
  const cor = CAT_COR[categoria || ""] || "#6b7280";
  if (!src || err) return (
    <div style={{
      width: size, height: size, flexShrink: 0,
      background: cor + "20", border: `1.5px solid ${cor}40`,
      borderRadius: 8, display: "flex", alignItems: "center",
      justifyContent: "center", fontSize: size * 0.28, fontWeight: 700,
      color: cor, letterSpacing: "-0.5px", userSelect: "none",
    }}>{iniciais(nome)}</div>
  );
  return (
    <img src={src} alt={nome} onError={() => setErr(true)} style={{
      width: size, height: size, flexShrink: 0, objectFit: "contain",
      borderRadius: 8, background: "#111", border: "1px solid #ffffff10",
    }} />
  );
}

// ─── Tooltip programa ─────────────────────────────────────────────────────────
function ProgramaTooltip({ prog, onClose }: { prog: Programa; onClose: () => void }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999, display: "flex",
      alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.75)", padding: 16,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#161616", border: "1px solid #2a2a2a", borderRadius: 14,
        overflow: "hidden", maxWidth: 460, width: "100%",
        boxShadow: "0 24px 64px rgba(0,0,0,0.9)",
      }}>
        {prog.prog_icon && (
          <div style={{ position: "relative", width: "100%", height: 200, background: "#111" }}>
            <img src={prog.prog_icon} alt={prog.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, #161616 0%, transparent 60%)" }} />
            <button onClick={onClose} style={{
              position: "absolute", top: 10, right: 10, background: "rgba(0,0,0,0.6)",
              border: "none", cursor: "pointer", color: "#fff", borderRadius: "50%",
              width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
            }}><X style={{ width: 14, height: 14 }} /></button>
          </div>
        )}
        <div style={{ padding: 18 }}>
          {!prog.prog_icon && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#888" }}>
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>
          )}
          <div style={{ fontSize: 11, color: "#666", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            {prog.channel_nome} · {prog.categoria}
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, color: "#fff", lineHeight: 1.3, marginBottom: 10 }}>
            {prog.title}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: prog.desc ? 12 : 0 }}>
            <span style={{ fontSize: 12, color: "#f59e0b", fontWeight: 600 }}>
              {formatHora(prog.start)} – {formatHora(prog.stop)}
            </span>
            <span style={{ fontSize: 12, color: "#555" }}>· {prog.duracao_min} min</span>
          </div>
          {prog.desc && <div style={{ fontSize: 13, color: "#999", lineHeight: 1.6 }}>{prog.desc}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Grade EPG ────────────────────────────────────────────────────────────────
function GradeEPG({ canais, progsPorCanal }: {
  canais: Canal[]; progsPorCanal: Map<string, Programa[]>;
}) {
  const reguaRef   = useRef<HTMLDivElement>(null);
  const gradeRef   = useRef<HTMLDivElement>(null);
  const [agora, setAgora]             = useState(nowBRT);
  const [progSel, setProgSel]         = useState<Programa | null>(null);

  useEffect(() => {
    const iv = setInterval(() => setAgora(nowBRT()), 60000);
    return () => clearInterval(iv);
  }, []);

  const totalHoras = 12;
  const gradeWidth = totalHoras * HORA_WIDTH;

  // Base: hora cheia 1h atrás (BRT em ms UTC-3)
  const baseMs = useMemo(() => {
    const brtMs = Date.now() - 3 * 3600000;
    return Math.floor(brtMs / 3600000) * 3600000 - 3600000;
  }, []);

  const agoraOffsetPx = useMemo(() => {
    const brtMs = agora.getTime() - 3 * 3600000;
    return ((brtMs - baseMs) / 60000) * PX_POR_MIN;
  }, [agora, baseMs]);

  const horaLabels = useMemo(() => {
    return Array.from({ length: totalHoras + 1 }, (_, i) => {
      const tMs = baseMs + 3 * 3600000 + i * 3600000;
      const label = new Date(tMs).toLocaleTimeString("pt-BR",
        { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
      return { x: i * HORA_WIDTH, label };
    });
  }, [baseMs]);

  function syncScroll(src: "regua" | "grade", val: number) {
    if (src === "regua" && gradeRef.current) gradeRef.current.scrollLeft = val;
    if (src === "grade" && reguaRef.current) reguaRef.current.scrollLeft = val;
  }

  useEffect(() => {
    if (reguaRef.current && agoraOffsetPx > 0) {
      reguaRef.current.scrollLeft = Math.max(0, agoraOffsetPx - 60);
    }
  }, [agoraOffsetPx]);

  const totalHeight = canais.length * LINHA_H;

  return (
    <>
      {progSel && <ProgramaTooltip prog={progSel} onClose={() => setProgSel(null)} />}
      <div style={{ display: "flex", background: "#080808" }}>
        {/* Coluna fixa — canais */}
        <div style={{
          width: CANAL_COL_W, flexShrink: 0, borderRight: "1px solid #1a1a1a",
          position: "sticky", left: 0, zIndex: 20, background: "#080808",
        }}>
          <div style={{
            height: REGUA_H, borderBottom: "1px solid #1a1a1a", background: "#0d0d0d",
            position: "sticky", top: 0, zIndex: 21,
          }} />
          {canais.map(c => (
            <div key={c.id} style={{
              height: LINHA_H, display: "flex", alignItems: "center",
              gap: 10, padding: "0 12px", borderBottom: "1px solid #111",
            }}>
              <Logo src={c.icon} nome={c.nome} categoria={c.categoria} size={32} />
              <span style={{
                fontSize: 11, color: "#bbb", fontWeight: 500,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{c.nome}</span>
            </div>
          ))}
        </div>

        {/* Área scroll */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          {/* Régua */}
          <div style={{
            position: "sticky", top: 0, zIndex: 15, height: REGUA_H,
            background: "#0d0d0d", borderBottom: "1px solid #1a1a1a", overflow: "hidden",
          }}>
            <div ref={reguaRef} style={{ overflowX: "scroll", overflowY: "hidden", height: REGUA_H + 20 }}
              onScroll={e => syncScroll("regua", (e.target as HTMLDivElement).scrollLeft)}>
              <div style={{ position: "relative", width: gradeWidth, height: REGUA_H }}>
                {horaLabels.map((h, i) => (
                  <div key={i} style={{
                    position: "absolute", left: h.x, top: 0, height: "100%",
                    display: "flex", alignItems: "center", paddingLeft: 8,
                    borderLeft: i > 0 ? "1px solid #1a1a1a" : "none",
                  }}>
                    <span style={{ fontSize: 11, color: "#444", whiteSpace: "nowrap" }}>{h.label}</span>
                  </div>
                ))}
                <div style={{ position: "absolute", left: agoraOffsetPx, top: 0, width: 2, height: "100%", background: "#ef4444" }} />
              </div>
            </div>
          </div>

          {/* Grade */}
          <div ref={gradeRef} style={{ overflowX: "scroll" }}
            onScroll={e => syncScroll("grade", (e.target as HTMLDivElement).scrollLeft)}>
            <div style={{ position: "relative", width: gradeWidth, height: totalHeight }}>
              <div style={{ position: "absolute", left: agoraOffsetPx, top: 0, width: 2, height: totalHeight, background: "#ef4444", zIndex: 5, pointerEvents: "none" }} />
              {horaLabels.map((h, i) => i > 0 && (
                <div key={i} style={{ position: "absolute", left: h.x, top: 0, width: 1, height: totalHeight, background: "#141414", pointerEvents: "none" }} />
              ))}
              {canais.map((canal, rowIdx) => {
                const progs = (progsPorCanal.get(canal.id) || [])
                  .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
                const cor = CAT_COR[canal.categoria] || "#6b7280";
                const top = rowIdx * LINHA_H;
                const agoraBrtMs = agora.getTime() - 3 * 3600000;
                return (
                  <div key={canal.id} style={{
                    position: "absolute", top, left: 0,
                    width: gradeWidth, height: LINHA_H, borderBottom: "1px solid #111",
                  }}>
                    {progs.map(prog => {
                      const sMs = new Date(prog.start).getTime() - 3 * 3600000;
                      const eMs = new Date(prog.stop).getTime()  - 3 * 3600000;
                      const lRaw = ((sMs - baseMs) / 60000) * PX_POR_MIN;
                      const wRaw = Math.max(((eMs - sMs) / 60000) * PX_POR_MIN - 2, 4);
                      const lPx  = Math.max(lRaw, 0);
                      const wPx  = Math.max(wRaw - (lPx - lRaw), 20);
                      const isAtual = agoraBrtMs >= sMs && agoraBrtMs <= eMs;
                      return (
                        <div key={prog.start} onClick={() => setProgSel(prog)}
                          style={{
                            position: "absolute", left: lPx + 1, width: wPx - 2,
                            top: 5, bottom: 5, borderRadius: 5, cursor: "pointer",
                            background: isAtual ? cor + "25" : "#141414",
                            border: `1px solid ${isAtual ? cor + "50" : "#1e1e1e"}`,
                            overflow: "hidden", display: "flex", alignItems: "center",
                            transition: "background 0.1s, border-color 0.1s",
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = isAtual ? cor + "40" : "#1e1e1e";
                            e.currentTarget.style.borderColor = cor + "60";
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = isAtual ? cor + "25" : "#141414";
                            e.currentTarget.style.borderColor = isAtual ? cor + "50" : "#1e1e1e";
                          }}
                        >
                          {prog.prog_icon && wPx > 90 && (
                            <img src={prog.prog_icon} alt="" style={{
                              height: "100%", width: "auto", maxWidth: Math.min(wPx * 0.28, 52),
                              objectFit: "cover", flexShrink: 0, opacity: 0.8,
                            }} />
                          )}
                          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 5, padding: "0 7px" }}>
                            {isAtual && (
                              <div style={{ width: 5, height: 5, borderRadius: "50%", background: cor, flexShrink: 0, boxShadow: `0 0 5px ${cor}80` }} />
                            )}
                            <span style={{
                              fontSize: 11, fontWeight: isAtual ? 500 : 400,
                              color: isAtual ? "#e5e5e5" : "#555",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                              {lRaw < 0 ? `◀ ${prog.title}` : wPx > 70 ? `${formatHora(prog.start)} ${prog.title}` : prog.title}
                            </span>
                          </div>
                        </div>
                      );
                    })}
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

// ─── Card catálogo (filme / série) ────────────────────────────────────────────
function CatalogCard({ item }: { item: CatalogItem }) {
  const [imgErr, setImgErr] = useState(false);
  const cor = item.tipo === "FILME" ? "#f59e0b" : "#6366f1";

  const servidores = [
    item.disponivel_elite && "ELITE",
    item.disponivel_natv  && "NATV",
    item.disponivel_fast  && "FAST",
  ].filter(Boolean) as string[];

  return (
    <div style={{
      background: "#111", border: "1px solid #1e1e1e", borderRadius: 10,
      overflow: "hidden", transition: "border-color 0.15s, transform 0.15s",
      cursor: "default",
    }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = cor + "50";
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "#1e1e1e";
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
      }}
    >
      {/* Capa */}
      <div style={{ position: "relative", paddingTop: "150%", background: "#0a0a0a" }}>
        {item.cover_url && !imgErr ? (
          <img src={item.cover_url} alt={item.titulo_normalizado} onError={() => setImgErr(true)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 8,
            background: cor + "10",
          }}>
            {item.tipo === "FILME"
              ? <Film style={{ width: 28, height: 28, color: cor, opacity: 0.5 }} />
              : <Clapperboard style={{ width: 28, height: 28, color: cor, opacity: 0.5 }} />}
          </div>
        )}
        {/* Badge tipo */}
        <div style={{
          position: "absolute", top: 6, left: 6,
          background: cor + "dd", borderRadius: 4,
          padding: "2px 6px", fontSize: 9, fontWeight: 700, color: "#fff",
          letterSpacing: "0.5px",
        }}>
          {item.tipo === "SERIE" ? `${item.total_temporadas}T · ${item.total_episodios}EP` : item.tipo}
        </div>
        {/* Servidores */}
        <div style={{
          position: "absolute", top: 6, right: 6,
          display: "flex", flexDirection: "column", gap: 3,
        }}>
          {servidores.map(s => (
            <div key={s} style={{
              width: 6, height: 6, borderRadius: "50%",
              background: SERVIDOR_COR[s],
              boxShadow: `0 0 4px ${SERVIDOR_COR[s]}`,
            }} />
          ))}
        </div>
      </div>
      {/* Info */}
      <div style={{ padding: "10px 10px 12px" }}>
        <div style={{
          fontSize: 12, fontWeight: 600, color: "#ddd", lineHeight: 1.3,
          overflow: "hidden", textOverflow: "ellipsis",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          marginBottom: 6,
        }}>
          {item.titulo_normalizado.charAt(0).toUpperCase() + item.titulo_normalizado.slice(1).toLowerCase()}
        </div>
        {item.ano && <div style={{ fontSize: 10, color: "#444" }}>{item.ano}</div>}
      </div>
    </div>
  );
}

// ─── Modal Sync Catálogo ──────────────────────────────────────────────────────
function ModalSync({ onClose }: { onClose: () => void }) {
  // Estado independente por servidor
  const [status, setStatus] = useState<Record<string, SyncStatus>>({ elite: "idle", fast: "idle", natv: "idle" });
  const [stats,  setStats]  = useState<Record<string, any>>({});
  const [logs,   setLogs]   = useState<Record<string, string[]>>({ elite: [], fast: [], natv: [] });
  const [ultima, setUltima] = useState<Record<string, string>>({}); // última sync por servidor

  const isRodando = (srv: string) => status[srv] === "running";
  const anyRodando = Object.values(status).some(s => s === "running");

  const addLog = (srv: string, msg: string) =>
    setLogs(prev => ({ ...prev, [srv]: [...(prev[srv] || []), msg] }));

  // Carrega datas da última sync dos logs do R2
  useEffect(() => {
    const R2 = process.env.NEXT_PUBLIC_R2_DEV_URL || "";
    const LOG_URLS: Record<string, string> = {
      elite: `${R2}/epg/catalog_elite_log.json`,
      fast:  `${R2}/epg/catalog_fast_log.json`,
      natv:  `${R2}/epg/catalog_natv_log.json`,
    };
    Object.entries(LOG_URLS).forEach(async ([srv, url]) => {
      try {
        const r = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (j.executado_em) setUltima(p => ({ ...p, [srv]: j.executado_em }));
      } catch {}
    });
  }, []);

  // ── Parser M3U client-side ─────────────────────────────────
  function parseM3U(texto: string, onProgress: (n: number) => void) {
    const linhas = texto.split(/\r?\n/);
    const canaisMap = new Map<string, any>();
    const filmesMap = new Map<string, any>();
    const seriesMap = new Map<string, any>();
    const episodios: any[] = [];
    let extinf = "", count = 0;
    const isAdulto = (g: string) => {
      const u = g.toUpperCase();
      return ["XXX","ADULTO","ADULT","18+","ONLYFAN","PLAYBOY","PRIVACY"].some(x => u.includes(x));
    };
    const normGrupo = (g: string) => g.includes(" | ") ? g.split(" | ").slice(1).join(" | ").trim() : g.trim();
    const normCanal = (n: string) => n.toUpperCase()
      .replace(/\s*\[?(4K|FHD|FHDR|H265|H\.265|HD|SD)\]?\s*/gi, " ")
      .replace(/\s*\*+\s*$/g, "").replace(/\s+/g, " ").trim();
    const qualPeso = (n: string) => {
      const u = n.toUpperCase();
      if (u.includes("4K")) return 5; if (u.includes("FHD")) return 4;
      if (u.includes("H265")) return 3; if (u.includes("HD")) return 2; return 1;
    };
    const normFilme = (n: string) => {
      const ano = n.match(/[\[(](\d{4})[\])]/)?.[1];
      const titulo = n.toUpperCase()
        .replace(/[\[(]\d{4}[\])]/g, "").replace(/\s*\[L\]\s*/gi, " ")
        .replace(/\s+LEG\b|\s+DUB\b|\s+DUBLADO\b|\s+LEGENDADO\b/gi, "")
        .replace(/\s+/g, " ").trim();
      return { titulo, ano: ano ? parseInt(ano) : null };
    };
    const normSerie = (n: string) => {
      const se = n.match(/S(\d+)\s*E(\d+)/i);
      const ano = n.match(/[\[(](\d{4})[\])]/)?.[1];
      const titulo = n.replace(/\s*S\d+\s*E\d+.*/i, "")
        .replace(/[\[(]\d{4}[\])]\s*/g, "").replace(/\s*\[L\]\s*/gi, " ")
        .replace(/\s+LEG\b|\s+DUB\b/gi, "").toUpperCase().replace(/\s+/g, " ").trim();
      return { titulo, ano: ano ? parseInt(ano) : null, temporada: se ? parseInt(se[1]) : null, episodio: se ? parseInt(se[2]) : null };
    };
    for (const linha of linhas) {
      const l = linha.trim();
      if (l.startsWith("#EXTINF")) { extinf = l; continue; }
      if (!l.startsWith("http") || !extinf) continue;
      count++;
      if (count % 20000 === 0) onProgress(count);
      const nome  = extinf.match(/tvg-name="([^"]*)"/)?.[1]?.trim() || "";
      const logo  = extinf.match(/tvg-logo="([^"]*)"/)?.[1]?.trim() || "";
      const grupo = extinf.match(/group-title="([^"]*)"/)?.[1]?.trim() || "";
      extinf = "";
      if (!nome || isAdulto(grupo)) continue;
      const cat = normGrupo(grupo);
      const tipo = l.includes("/movie/") ? "FILME" : l.includes("/series/") ? "SERIE" : "CANAL";
      if (tipo === "CANAL") {
        const t = normCanal(nome); if (!t) continue;
        const peso = qualPeso(nome);
        if (!canaisMap.has(t) || peso > canaisMap.get(t).peso)
          canaisMap.set(t, { titulo_normalizado: t, tipo: "CANAL", cover_url: logo, ano: null, categoria_origem: cat, peso });
      } else if (tipo === "FILME") {
        const { titulo, ano } = normFilme(nome); if (!titulo) continue;
        if (!filmesMap.has(titulo) || (!filmesMap.get(titulo).cover_url && logo))
          filmesMap.set(titulo, { titulo_normalizado: titulo, tipo: "FILME", cover_url: logo, ano, categoria_origem: cat });
      } else {
        const { titulo, ano, temporada, episodio } = normSerie(nome);
        if (!titulo || temporada === null || episodio === null) continue;
        if (!seriesMap.has(titulo) || (!seriesMap.get(titulo).cover_url && logo))
          seriesMap.set(titulo, { titulo_normalizado: titulo, tipo: "SERIE", cover_url: logo, ano, categoria_origem: cat });
        episodios.push({ titulo_normalizado: titulo, temporada, episodio, cover_url: logo });
      }
    }
    return { canais: [...canaisMap.values()], filmes: [...filmesMap.values()], series: [...seriesMap.values()], episodios };
  }

  // ── Supabase helpers ───────────────────────────────────────
  async function sbUpsert(table: string, rows: any[], ignoreDup: boolean) {
    const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const prefer = ignoreDup ? "resolution=ignore-duplicates" : "resolution=merge-duplicates";
    const r = await fetch(`${URL}/rest/v1/${table}`, {
      method: "POST",
      headers: { "apikey": KEY, "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json", "Prefer": `return=minimal,${prefer}` },
      body: JSON.stringify(rows),
    });
    if (!r.ok) throw new Error(`${table} HTTP ${r.status}: ${(await r.text()).slice(0, 100)}`);
  }
  async function sbSelectIds(titulos: string[]): Promise<Map<string, string>> {
    const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const map = new Map<string, string>();
    for (let i = 0; i < titulos.length; i += 400) {
      const enc = titulos.slice(i, i + 400).map(t => `"${t.replace(/"/g, '\\"')}"`).join(",");
      const r = await fetch(`${URL}/rest/v1/catalog_master?select=id,titulo_normalizado&titulo_normalizado=in.(${enc})`,
        { headers: { "apikey": KEY, "Authorization": `Bearer ${KEY}` } });
      if (!r.ok) continue;
      for (const row of await r.json() as any[]) map.set(row.titulo_normalizado, row.id);
    }
    return map;
  }
  async function sbRPC(fn: string, params: any) {
    const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    await fetch(`${URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { "apikey": KEY, "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  }

  // ── Core sync browser (Fast / NaTV) ───────────────────────
  async function execSyncBrowser(srvId: string, urls: string[]) {
    const inicio = Date.now();
    setStatus(p => ({ ...p, [srvId]: "running" }));
    setLogs(p => ({ ...p, [srvId]: [] }));
    const log = (msg: string) => addLog(srvId, msg);

    let texto = "";
    for (const url of urls) {
      log(`⬇ Baixando de ${new URL(url).hostname}...`);
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        texto = await r.text();
        log(`✓ ${(texto.length / 1024 / 1024).toFixed(1)} MB recebidos`);
        break;
      } catch (e: any) { log(`✗ ${e.message}`); }
    }
    if (!texto) throw new Error("Falha em todos os DNS");

    log("⚙ Parseando...");
    const { canais, filmes, series, episodios } = parseM3U(texto, n => log(`  ${n.toLocaleString("pt-BR")} entradas...`));
    log(`✓ ${canais.length} canais · ${filmes.length} filmes · ${series.length} séries · ${episodios.length} eps`);

    const SERVIDOR = srvId.toUpperCase();
    const todasMaster = [...canais, ...filmes, ...series];
    const BATCH = 500;

    log(`↑ Salvando ${todasMaster.length} títulos...`);
    for (let i = 0; i < todasMaster.length; i += BATCH) {
      await sbUpsert("catalog_master", todasMaster.slice(i, i + BATCH).map(e => ({
        titulo_normalizado: e.titulo_normalizado, tipo: e.tipo,
        ...(e.cover_url ? { cover_url: e.cover_url } : {}),
        ano: e.ano || null, atualizado_em: new Date().toISOString(),
      })), false);
    }
    const idMap = await sbSelectIds(todasMaster.map(e => e.titulo_normalizado));
    log(`✓ ${idMap.size} IDs mapeados`);

    const availRows = todasMaster.map(e => {
      const master_id = idMap.get(e.titulo_normalizado);
      return master_id ? { master_id, servidor: SERVIDOR, categoria_origem: e.categoria_origem } : null;
    }).filter(Boolean);
    for (let i = 0; i < availRows.length; i += BATCH)
      await sbUpsert("catalog_availability", availRows.slice(i, i + BATCH), true);

    const epRows = episodios.map(ep => {
      const master_id = idMap.get(ep.titulo_normalizado);
      return master_id ? { master_id, servidor: SERVIDOR, temporada: ep.temporada, episodio: ep.episodio, cover_url: ep.cover_url || null } : null;
    }).filter(Boolean);
    for (let i = 0; i < epRows.length; i += BATCH)
      await sbUpsert("catalog_episodes", epRows.slice(i, i + BATCH), true);

    await sbRPC("catalog_atualizar_contadores", { p_servidor: SERVIDOR });

    const dur = Math.round((Date.now() - inicio) / 1000);
    const agora = new Date().toISOString();
    log(`✅ Concluído em ${dur}s`);
    setStats(p => ({ ...p, [srvId]: { canais: canais.length, filmes: filmes.length, series_unicas: series.length, episodios: epRows.length, duracao_s: dur } }));
    setStatus(p => ({ ...p, [srvId]: "ok" }));
    setUltima(p => ({ ...p, [srvId]: agora }));
  }

  // ── Core sync Elite (via servidor) ────────────────────────
  async function execSyncElite() {
    setStatus(p => ({ ...p, elite: "running" }));
    setLogs(p => ({ ...p, elite: [] }));
    addLog("elite", "⬇ Chamando rota do servidor...");
    const r = await fetch("/api/epg/sync-catalog/elite", { method: "POST" });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || "Erro desconhecido");
    addLog("elite", `✅ Concluído em ${data.duracao_s}s`);
    setStats(p => ({ ...p, elite: data }));
    setStatus(p => ({ ...p, elite: "ok" }));
    setUltima(p => ({ ...p, elite: new Date().toISOString() }));
  }

  // ── Handlers individuais ───────────────────────────────────
  async function handleSync(srvId: string) {
    try {
      if (srvId === "elite") await execSyncElite();
      else if (srvId === "fast") await execSyncBrowser("fast", [
        "http://psbox.top/get.php?username=Insqueixa&password=uC8369&type=m3u_plus",
        "http://p1fast.com/get.php?username=Insqueixa&password=uC8369&type=m3u_plus",
      ]);
      else await execSyncBrowser("natv", [
        "http://rj98.eu/get.php?username=Insqueixa&password=62206935744&type=m3u_plus",
        "http://rw26.eu/get.php?username=Insqueixa&password=62206935744&type=m3u_plus",
        "http://nc18.org/get.php?username=Insqueixa&password=62206935744&type=m3u_plus",
      ]);
    } catch (e: any) {
      addLog(srvId, `❌ ${e.message}`);
      setStatus(p => ({ ...p, [srvId]: "error" }));
    }
  }

  const SERVERS = [
    { id: "elite", label: "EliteTV", sub: "via servidor · chinaz.asia", cor: "#6366f1" },
    { id: "fast",  label: "FastTV",  sub: "via browser · psbox.top",   cor: "#10b981" },
    { id: "natv",  label: "NaTV",    sub: "via browser · rj98.eu",     cor: "#f59e0b" },
  ];

  function statusLabel(s: SyncStatus) {
    return { idle: "Sincronizar", running: "Rodando...", ok: "Concluído", error: "Falhou", waiting: "Aguardando" }[s];
  }
  function statusCor(s: SyncStatus) {
    return { idle: "#6366f1", running: "#818cf8", ok: "#10b981", error: "#ef4444", waiting: "#374151" }[s];
  }
  function formatUltima(iso: string) {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    });
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.85)", display: "flex",
      alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={!anyRodando ? onClose : undefined}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#0f0f13", border: "1px solid #1e1e2e",
        borderRadius: 16, width: "100%", maxWidth: 560,
        maxHeight: "90vh", overflow: "auto",
        boxShadow: "0 32px 80px rgba(0,0,0,0.9)",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "18px 20px", borderBottom: "1px solid #1e1e2e",
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9" }}>Sincronizar Catálogo</div>
            <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>
              Rode cada servidor individualmente
            </div>
          </div>
          {!anyRodando && (
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#475569" }}>
              <X style={{ width: 18, height: 18 }} />
            </button>
          )}
        </div>

        {/* Cards por servidor */}
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {SERVERS.map(srv => {
            const s     = status[srv.id] as SyncStatus;
            const st    = stats[srv.id];
            const sLogs = logs[srv.id] || [];
            const ult   = ultima[srv.id];
            const rod   = s === "running";

            return (
              <div key={srv.id} style={{
                background: "#111", border: `1px solid ${rod ? srv.cor + "40" : "#1e1e2e"}`,
                borderRadius: 10, overflow: "hidden",
                transition: "border-color 0.2s",
              }}>
                {/* Cabeçalho */}
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "12px 14px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: s === "idle" ? "#1e293b" : srv.cor,
                      boxShadow: rod ? `0 0 8px ${srv.cor}` : "none",
                      animation: rod ? "pulse 1s infinite" : "none",
                      flexShrink: 0,
                    }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{srv.label}</div>
                      <div style={{ fontSize: 10, color: "#334155", marginTop: 1 }}>
                        {srv.sub}
                        {ult && (
                          <span style={{ color: "#1e3a2f", marginLeft: 6 }}>
                            · sync {formatUltima(ult)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Botão individual */}
                  <button
                    onClick={() => !rod && handleSync(srv.id)}
                    disabled={rod}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "6px 14px", borderRadius: 7,
                      background: rod ? "#1e1b4b" : s === "ok" ? "#052e16" : s === "error" ? "#1c0a0a" : srv.cor + "20",
                      color: rod ? "#818cf8" : s === "ok" ? "#4ade80" : s === "error" ? "#f87171" : srv.cor,
                      fontSize: 12, fontWeight: 600, cursor: rod ? "not-allowed" : "pointer",
                      border: "1px solid " + (rod ? "#312e81" : s === "ok" ? "#14532d" : s === "error" ? "#450a0a" : srv.cor + "40"),
                      transition: "all 0.15s", minWidth: 110,
                    }}
                  >
                    {rod
                      ? <><RefreshCw style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> Rodando...</>
                      : s === "ok"
                      ? <><CheckCircle style={{ width: 11, height: 11 }} /> Concluído</>
                      : s === "error"
                      ? <><AlertTriangle style={{ width: 11, height: 11 }} /> Tentar novamente</>
                      : <><Play style={{ width: 11, height: 11 }} /> Sincronizar</>
                    }
                  </button>
                </div>

                {/* Log */}
                {sLogs.length > 0 && (
                  <div style={{
                    padding: "6px 14px 10px", borderTop: "1px solid #1a1a2e",
                    fontFamily: "monospace", fontSize: 11, lineHeight: 1.7,
                    maxHeight: 110, overflowY: "auto",
                  }}>
                    {sLogs.map((l, i) => (
                      <div key={i} style={{
                        color: l.startsWith("✅") || l.startsWith("✓") ? (l.startsWith("✅") ? "#4ade80" : "#818cf8")
                          : l.startsWith("❌") || l.startsWith("✗") ? "#f87171" : "#374151"
                      }}>{l}</div>
                    ))}
                  </div>
                )}

                {/* Stats */}
                {st && (
                  <div style={{ display: "flex", borderTop: "1px solid #1a1a2e" }}>
                    {[
                      ["Canais",    st.canais],
                      ["Filmes",    st.filmes],
                      ["Séries",    st.series_unicas],
                      ["Episódios", st.episodios],
                      ["Tempo",     `${st.duracao_s}s`],
                    ].map(([label, val], i, arr) => (
                      <div key={label as string} style={{
                        flex: 1, padding: "8px 0", textAlign: "center",
                        borderRight: i < arr.length - 1 ? "1px solid #1a1a2e" : "none",
                      }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: srv.cor }}>
                          {typeof val === "number" ? numFmt(val) : val}
                        </div>
                        <div style={{ fontSize: 10, color: "#334155", marginTop: 1, textTransform: "uppercase", letterSpacing: "0.3px" }}>{label}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Aviso se algum estiver rodando */}
        {anyRodando && (
          <div style={{
            margin: "0 16px 16px", padding: "10px 14px",
            background: "#1e1b4b", border: "1px solid #312e81",
            borderRadius: 8, fontSize: 12, color: "#818cf8",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <RefreshCw style={{ width: 12, height: 12, animation: "spin 1s linear infinite", flexShrink: 0 }} />
            Não feche esta aba enquanto estiver sincronizando
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Filtro pill ──────────────────────────────────────────────────────────────
function Pill({ label, ativo, cor, onClick }: {
  label: string; ativo: boolean; cor?: string; onClick: () => void;
}) {
  const c = cor || "#6366f1";
  return (
    <button onClick={onClick} style={{
      padding: "5px 12px", borderRadius: 20, border: `1px solid ${ativo ? c : "#1e1e2e"}`,
      background: ativo ? c + "20" : "transparent", color: ativo ? c : "#475569",
      fontSize: 12, fontWeight: ativo ? 600 : 400, cursor: "pointer",
      whiteSpace: "nowrap", transition: "all 0.12s",
    }}>
      {label}
    </button>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function GuiaTVPage() {
  // EPG
  const [epg, setEpg]         = useState<EpgData | null>(null);
  const [epgLoad, setEpgLoad] = useState(true);
  const [epgErro, setEpgErro] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [epgMsg, setEpgMsg]   = useState<{ tipo: "ok" | "err"; texto: string } | null>(null);

  // Catálogo
  const [catalog, setCatalog]         = useState<CatalogItem[]>([]);
  const [catalogLoad, setCatalogLoad] = useState(false);
  const [catalogPage, setCatalogPage] = useState(0);
  const CATALOG_PAGE_SIZE = 60;

  // Filtros globais
  const [aba, setAba]               = useState<"canais" | "filmes" | "series">("canais");
  const [servidorFiltro, setServidorFiltro] = useState<"TODOS" | "ELITE" | "NATV" | "FAST">("TODOS");
  const [catAtiva, setCatAtiva]     = useState("Todos");
  const [busca, setBusca]           = useState("");

  // Modal sync
  const [modalSync, setModalSync]   = useState(false);

  // ── Carrega EPG ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setEpgLoad(true); setEpgErro(null);
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_R2_DEV_URL}/epg/epg_br.json?t=${Date.now()}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setEpg(await res.json());
      } catch { setEpgErro("Grade EPG não encontrada. Rode o sync."); }
      finally { setEpgLoad(false); }
    })();
  }, []);

  // ── Carrega catálogo (filmes/séries) ─────────────────────────
  useEffect(() => {
    if (aba === "canais") return;
    (async () => {
      setCatalogLoad(true);
      try {
        const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
        const tipo = aba === "filmes" ? "FILME" : "SERIE";
        const params = new URLSearchParams({
          select: "id,titulo_normalizado,tipo,cover_url,ano,total_temporadas,total_episodios,elite_desde,natv_desde,fast_desde,elite_categoria,natv_categoria,fast_categoria,disponivel_elite,disponivel_natv,disponivel_fast,total_servidores",
          tipo: `eq.${tipo}`,
          order: "titulo_normalizado.asc",
          limit: "500",
        });
        if (servidorFiltro === "ELITE") params.set("disponivel_elite", "eq.true");
        if (servidorFiltro === "NATV")  params.set("disponivel_natv",  "eq.true");
        if (servidorFiltro === "FAST")  params.set("disponivel_fast",  "eq.true");

        const res = await fetch(`${SUPA_URL}/rest/v1/vw_catalog_full?${params}`, {
          headers: { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setCatalog(await res.json());
        setCatalogPage(0);
      } catch (e: any) { console.error(e); }
      finally { setCatalogLoad(false); }
    })();
  }, [aba, servidorFiltro]);

  // ── Programas por canal (EPG) ─────────────────────────────────
  const progsPorCanal = useMemo(() => {
    if (!epg) return new Map<string, Programa[]>();
    const map = new Map<string, Programa[]>();
    const brtMs = Date.now() - 3 * 3600000;
    const ini = brtMs - 2 * 3600000, fim = brtMs + 10 * 3600000;
    for (const p of epg.programas) {
      const s = new Date(p.start).getTime(), e = new Date(p.stop).getTime();
      if (e < ini || s > fim) continue;
      const arr = map.get(p.channel_id) || []; arr.push(p);
      map.set(p.channel_id, arr);
    }
    return map;
  }, [epg]);

  // ── Canais filtrados (EPG) ────────────────────────────────────
  const canaisFiltrados = useMemo(() => {
    if (!epg) return [];
    let lista = epg.canais;
    if (catAtiva !== "Todos") lista = lista.filter(c => c.categoria === catAtiva);
    if (busca.trim()) {
      const q = busca.toLowerCase();
      const porNome = lista.filter(c => c.nome.toLowerCase().includes(q) || c.display_name.toLowerCase().includes(q));
      if (porNome.length) return porNome;
      const ids = new Set<string>();
      for (const p of epg.programas)
        if (p.title.toLowerCase().includes(q) || p.desc?.toLowerCase().includes(q)) ids.add(p.channel_id);
      return lista.filter(c => ids.has(c.id));
    }
    return lista;
  }, [epg, catAtiva, busca]);

  // ── Catálogo filtrado ─────────────────────────────────────────
  const catalogFiltrado = useMemo(() => {
    if (!catalog.length) return [];
    let lista = catalog;
    if (busca.trim()) {
      const q = busca.toLowerCase();
      lista = lista.filter(i => i.titulo_normalizado.toLowerCase().includes(q));
    }
    if (catAtiva !== "Todos") {
      lista = lista.filter(i => {
        const cats = [i.elite_categoria, i.natv_categoria, i.fast_categoria].filter(Boolean);
        return cats.some(c => c?.toLowerCase().includes(catAtiva.toLowerCase()));
      });
    }
    return lista;
  }, [catalog, busca, catAtiva]);

  const catalogPaginado = useMemo(() =>
    catalogFiltrado.slice(0, (catalogPage + 1) * CATALOG_PAGE_SIZE),
  [catalogFiltrado, catalogPage]);

  // ── Categorias disponíveis ────────────────────────────────────
  const catsDisponiveis = useMemo(() => {
    if (!epg) return [];
    const set = new Set(epg.canais.map(c => c.categoria));
    return CATS_ORDEM.filter(c => set.has(c));
  }, [epg]);

  // ── Sync EPG ──────────────────────────────────────────────────
  async function handleSyncEPG() {
    setSyncing(true); setEpgMsg(null);
    try {
      const d = await fetch("/api/epg/sync", { method: "POST" }).then(r => r.json());
      if (d.ok) {
        setEpgMsg({ tipo: "ok", texto: `EPG sincronizado em ${d.duracao_s}s` });
        setTimeout(() => window.location.reload(), 1800);
      } else setEpgMsg({ tipo: "err", texto: d.error || "Sync EPG falhou" });
    } catch (e: any) { setEpgMsg({ tipo: "err", texto: e.message }); }
    finally { setSyncing(false); }
  }

  const ABAS = [
    { id: "canais",  label: "Canais",  icon: <Tv style={{ width: 13, height: 13 }} /> },
    { id: "filmes",  label: "Filmes",  icon: <Film style={{ width: 13, height: 13 }} /> },
    { id: "series",  label: "Séries",  icon: <Clapperboard style={{ width: 13, height: 13 }} /> },
  ] as const;

  return (
    <div style={{ background: "#080808", minHeight: "100vh", color: "#ccc" }}>

      {/* ── Topo ────────────────────────────────────────────────── */}
      <div style={{
        position: "sticky", top: 0, zIndex: 40, background: "#0d0d0d",
        borderBottom: "1px solid #1a1a1a",
      }}>
        {/* Linha 1: título + ações */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "12px 20px", flexWrap: "wrap",
        }}>
          <Tv style={{ color: "#ef4444", width: 17, height: 17, flexShrink: 0 }} />
          <span style={{ fontSize: 15, fontWeight: 600, color: "#eee" }}>Guia TV</span>
          {epg && (
            <span style={{ fontSize: 11, color: "#334155" }}>
              · {epg.total_canais} canais · {formatDataHora(epg.gerado_em)}
            </span>
          )}
          <div style={{ flex: 1 }} />

          {/* Sync EPG */}
          <button onClick={handleSyncEPG} disabled={syncing} style={{
            display: "flex", alignItems: "center", gap: 5, padding: "5px 10px",
            background: "#111", border: `1px solid ${syncing ? "#1e1e1e" : "#10b98130"}`,
            borderRadius: 7, cursor: syncing ? "not-allowed" : "pointer",
            color: syncing ? "#374151" : "#10b981", fontSize: 12, fontWeight: 500,
          }}>
            <RefreshCw style={{ width: 11, height: 11, animation: syncing ? "spin 1s linear infinite" : "none" }} />
            {syncing ? "Sync EPG..." : "Sync EPG"}
          </button>

          {/* Sync Catálogo */}
          <button onClick={() => setModalSync(true)} style={{
            display: "flex", alignItems: "center", gap: 5, padding: "5px 10px",
            background: "#1e1b4b", border: "1px solid #312e81",
            borderRadius: 7, cursor: "pointer",
            color: "#818cf8", fontSize: 12, fontWeight: 500,
          }}>
            <Database style={{ width: 11, height: 11 }} />
            Sync Catálogo
          </button>
        </div>

        {/* Feedback EPG */}
        {epgMsg && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "8px 20px",
            background: epgMsg.tipo === "ok" ? "#10b98115" : "#ef444415",
            borderBottom: `1px solid ${epgMsg.tipo === "ok" ? "#10b98130" : "#ef444430"}`,
            fontSize: 12, color: epgMsg.tipo === "ok" ? "#10b981" : "#ef4444",
          }}>
            {epgMsg.tipo === "ok"
              ? <CheckCircle style={{ width: 13, height: 13 }} />
              : <AlertTriangle style={{ width: 13, height: 13 }} />}
            {epgMsg.texto}
            <button onClick={() => setEpgMsg(null)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "inherit" }}>
              <X style={{ width: 12, height: 12 }} />
            </button>
          </div>
        )}

        {/* Linha 2: abas + filtros */}
        <div style={{
          display: "flex", alignItems: "center", gap: 0,
          padding: "0 20px", borderBottom: "1px solid #111", overflowX: "auto",
        }}>
          {ABAS.map(a => (
            <button key={a.id} onClick={() => { setAba(a.id); setCatAtiva("Todos"); setBusca(""); }}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "10px 14px", background: "none", border: "none",
                borderBottom: `2px solid ${aba === a.id ? "#6366f1" : "transparent"}`,
                color: aba === a.id ? "#818cf8" : "#475569",
                fontSize: 13, fontWeight: aba === a.id ? 600 : 400,
                cursor: "pointer", whiteSpace: "nowrap", transition: "color 0.12s",
                marginBottom: -1,
              }}>
              {a.icon} {a.label}
            </button>
          ))}

          <div style={{ flex: 1 }} />

          {/* Busca inline */}
          <div style={{ position: "relative", marginLeft: 12 }}>
            <Search style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: "#374151" }} />
            <input value={busca} onChange={e => setBusca(e.target.value)}
              placeholder={aba === "canais" ? "Buscar canal ou programa..." : "Buscar título..."}
              style={{
                height: 32, paddingLeft: 30, paddingRight: 12, width: 220,
                background: "#111", border: "1px solid #1e1e2e",
                borderRadius: 7, fontSize: 12, color: "#ccc", outline: "none",
              }}
              onFocus={e => (e.target.style.borderColor = "#6366f1")}
              onBlur={e => (e.target.style.borderColor = "#1e1e2e")}
            />
          </div>
        </div>

        {/* Linha 3: filtros de categoria + servidor */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "10px 20px", overflowX: "auto",
          borderBottom: aba !== "canais" ? "1px solid #111" : "none",
        }}>
          {/* Filtro servidor (catálogo) */}
          {aba !== "canais" && (
            <>
              {(["TODOS","ELITE","NATV","FAST"] as const).map(s => (
                <Pill key={s} label={s === "TODOS" ? "Todos servidores" : SERVIDOR_LABEL[s]}
                  ativo={servidorFiltro === s}
                  cor={s === "TODOS" ? "#6366f1" : SERVIDOR_COR[s]}
                  onClick={() => setServidorFiltro(s)}
                />
              ))}
              <div style={{ width: 1, height: 20, background: "#1e1e2e", margin: "0 4px" }} />
            </>
          )}

          {/* Categorias (canais) */}
          {aba === "canais" && (
            <>
              <Pill label="Todos" ativo={catAtiva === "Todos"} onClick={() => setCatAtiva("Todos")} />
              {catsDisponiveis.map(c => (
                <Pill key={c} label={`${CAT_EMOJI[c]} ${c}`} ativo={catAtiva === c}
                  cor={CAT_COR[c]} onClick={() => setCatAtiva(c)} />
              ))}
            </>
          )}
        </div>
      </div>

      {/* ── Conteúdo: Canais (EPG) ──────────────────────────────── */}
      {aba === "canais" && (
        <>
          {epgLoad && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: 80, color: "#374151", fontSize: 13 }}>
              <RefreshCw style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} /> Carregando grade...
            </div>
          )}
          {epgErro && !epgLoad && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 80, textAlign: "center" }}>
              <AlertTriangle style={{ width: 26, height: 26, color: "#f59e0b" }} />
              <div style={{ fontSize: 14, color: "#bbb" }}>Grade não encontrada</div>
              <div style={{ fontSize: 12, color: "#374151" }}>{epgErro}</div>
              <button onClick={handleSyncEPG} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "7px 14px",
                background: "#10b98115", border: "1px solid #10b98130", borderRadius: 8,
                color: "#10b981", fontSize: 12, cursor: "pointer",
              }}>
                <RefreshCw style={{ width: 13, height: 13 }} /> Sync EPG agora
              </button>
            </div>
          )}
          {!epgLoad && !epgErro && epg && (
            canaisFiltrados.length === 0
              ? <div style={{ textAlign: "center", padding: 60, color: "#374151", fontSize: 13 }}>Nenhum canal encontrado.</div>
              : <GradeEPG canais={canaisFiltrados} progsPorCanal={progsPorCanal} />
          )}
        </>
      )}

      {/* ── Conteúdo: Filmes / Séries (Catálogo) ────────────────── */}
      {(aba === "filmes" || aba === "series") && (
        <div style={{ padding: "20px" }}>
          {catalogLoad && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: 60, color: "#374151", fontSize: 13 }}>
              <RefreshCw style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} /> Carregando catálogo...
            </div>
          )}
          {!catalogLoad && catalogFiltrado.length === 0 && (
            <div style={{ textAlign: "center", padding: 60 }}>
              <Database style={{ width: 28, height: 28, color: "#1e293b", margin: "0 auto 12px" }} />
              <div style={{ fontSize: 14, color: "#374151" }}>
                {catalog.length === 0 ? "Catálogo vazio. Rode o Sync Catálogo." : "Nenhum resultado encontrado."}
              </div>
              {catalog.length === 0 && (
                <button onClick={() => setModalSync(true)} style={{
                  marginTop: 14, display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "7px 14px", background: "#1e1b4b", border: "1px solid #312e81",
                  borderRadius: 8, color: "#818cf8", fontSize: 12, cursor: "pointer",
                }}>
                  <Database style={{ width: 12, height: 12 }} /> Sync Catálogo
                </button>
              )}
            </div>
          )}
          {!catalogLoad && catalogPaginado.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: "#334155", marginBottom: 16 }}>
                {numFmt(catalogFiltrado.length)} {aba} · {servidorFiltro !== "TODOS" ? SERVIDOR_LABEL[servidorFiltro] : "todos os servidores"}
              </div>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 12,
              }}>
                {catalogPaginado.map(item => <CatalogCard key={item.id} item={item} />)}
              </div>
              {catalogPaginado.length < catalogFiltrado.length && (
                <div style={{ textAlign: "center", marginTop: 24 }}>
                  <button onClick={() => setCatalogPage(p => p + 1)} style={{
                    padding: "9px 20px", background: "#111", border: "1px solid #1e1e2e",
                    borderRadius: 8, color: "#818cf8", fontSize: 13, cursor: "pointer",
                  }}>
                    Carregar mais ({numFmt(catalogFiltrado.length - catalogPaginado.length)} restantes)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Modal Sync Catálogo ──────────────────────────────────── */}
      {modalSync && <ModalSync onClose={() => setModalSync(false)} />}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.3 } }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: #0a0a0a; }
        ::-webkit-scrollbar-thumb { background: #1e1e2e; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #2a2a3a; }
      `}</style>
    </div>
  );
}
