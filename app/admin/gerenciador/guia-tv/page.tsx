"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, RefreshCw, AlertTriangle, CheckCircle, X, Tv, ChevronDown } from "lucide-react";

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
  gerado_em: string; total_canais: number; total_programas: number;
  canais: Canal[]; programas: Programa[];
};

// ─── Constantes ───────────────────────────────────────────────────────────────
const CATS_ORDEM = [
  "Aberta","Notícias","Esportes","Filmes","Variedades",
  "Documentários","Infantil","Música","Regional","Religioso","Outros",
];
const CAT_COR: Record<string, string> = {
  "Aberta":"#3b82f6","Notícias":"#ef4444","Esportes":"#10b981",
  "Filmes":"#f59e0b","Variedades":"#8b5cf6","Documentários":"#06b6d4",
  "Infantil":"#ec4899","Música":"#6366f1","Regional":"#84cc16",
  "Religioso":"#f97316","Outros":"#6b7280",
};
const CAT_EMOJI: Record<string, string> = {
  "Aberta":"📺","Notícias":"📰","Esportes":"⚽","Filmes":"🎬",
  "Variedades":"🎭","Documentários":"🌍","Infantil":"🧒","Música":"🎵",
  "Regional":"🗺️","Religioso":"✝️","Outros":"📡",
};
const SUBGRUPOS: Record<string, { label: string; match: string[] }[]> = {
  "Esportes": [
    { label: "SporTV",    match: ["SPORTV","SPORT TV"] },
    { label: "Premiere",  match: ["PREMIERE"] },
    { label: "ESPN",      match: ["ESPN"] },
    { label: "Combate",   match: ["COMBATE"] },
    { label: "BandSports",match: ["BANDSPORT","BAND SPORT"] },
    { label: "DAZN",      match: ["DAZN"] },
  ],
  "Filmes": [
    { label: "Telecine",  match: ["TELECINE"] },
    { label: "HBO",       match: ["HBO"] },
    { label: "TNT",       match: ["TNT"] },
    { label: "Universal", match: ["UNIVERSAL","STUDIO UNIVERSAL"] },
    { label: "Warner",    match: ["WARNER"] },
    { label: "Paramount", match: ["PARAMOUNT"] },
    { label: "Megapix",   match: ["MEGAPIX"] },
  ],
  "Infantil": [
    { label: "Cartoon",  match: ["CARTOON"] },
    { label: "Disney",   match: ["DISNEY"] },
    { label: "Nick",     match: ["NICK","NICKELODEON"] },
    { label: "Gloob",    match: ["GLOOB"] },
  ],
};

const PX_POR_MIN  = 4;
const HORA_WIDTH  = 60 * PX_POR_MIN;
const CANAL_COL_W = 180;
const LINHA_H     = 72;
const REGUA_H     = 34;
const TOTAL_HORAS = 26;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function nowBRT(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}
function formatHora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR",
    { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}
function formatDataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR",
    { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}
function iniciais(nome: string) {
  return nome.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

// ─── Logo ─────────────────────────────────────────────────────────────────────
function Logo({ src, nome, categoria, size = 32 }: {
  src?: string; nome: string; categoria?: string; size?: number;
}) {
  const [err, setErr] = useState(false);
  const cor = CAT_COR[categoria || ""] || "#6b7280";
  if (!src || err) return (
    <div style={{
      width: size, height: size, flexShrink: 0, borderRadius: 7,
      background: cor + "20", border: `1.5px solid ${cor}40`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.3, fontWeight: 700, color: cor, userSelect: "none",
    }}>{iniciais(nome)}</div>
  );
  return (
    <img src={src} alt={nome} onError={() => setErr(true)} style={{
      width: size, height: size, flexShrink: 0, objectFit: "contain",
      borderRadius: 7, background: "#111", border: "1px solid #ffffff10",
    }} />
  );
}

// ─── Tooltip programa ─────────────────────────────────────────────────────────
function ProgramaTooltip({ prog, onClose }: { prog: Programa; onClose: () => void }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.75)", display: "flex",
      alignItems: "center", justifyContent: "center", padding: 16,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#161616", border: "1px solid #2a2a2a",
        borderRadius: 14, overflow: "hidden", maxWidth: 460, width: "100%",
        boxShadow: "0 24px 64px rgba(0,0,0,0.9)",
      }}>
        {prog.prog_icon && (
          <div style={{ position: "relative", height: 200, background: "#111" }}>
            <img src={prog.prog_icon} alt={prog.title}
              style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
              <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#666" }}>
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>
          )}
          <div style={{ fontSize: 11, color: "#555", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            {prog.channel_nome} · {prog.categoria}
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, color: "#fff", lineHeight: 1.3, marginBottom: 10 }}>
            {prog.title}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: prog.desc ? 12 : 0 }}>
            <span style={{ fontSize: 12, color: "#f59e0b", fontWeight: 600 }}>
              {formatHora(prog.start)} – {formatHora(prog.stop)}
            </span>
            <span style={{ fontSize: 12, color: "#444" }}>· {prog.duracao_min} min</span>
          </div>
          {prog.desc && <div style={{ fontSize: 13, color: "#888", lineHeight: 1.6 }}>{prog.desc}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Resultado de busca por programa ─────────────────────────────────────────
// Quando o usuário busca "Fórmula 1", mostra lista de programações encontradas
// em vez da grade de canais
function ResultadoBusca({ resultados, busca, onClear }: {
  resultados: Array<{ canal: Canal; prog: Programa }>;
  busca: string;
  onClear: () => void;
}) {
  const [sel, setSel] = useState<Programa | null>(null);

  // Agrupa por título do programa
  const agrupado = useMemo(() => {
    const map = new Map<string, Array<{ canal: Canal; prog: Programa }>>();
    for (const r of resultados) {
      const key = r.prog.title.trim();
      const arr = map.get(key) || [];
      arr.push(r);
      map.set(key, arr);
    }
    // Ordena por mais ocorrências e depois por horário
    return [...map.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([titulo, items]) => ({
        titulo,
        items: items.sort((a, b) =>
          new Date(a.prog.start).getTime() - new Date(b.prog.start).getTime()
        ),
      }));
  }, [resultados]);

  const agora = nowBRT().getTime();

  return (
    <>
      {sel && <ProgramaTooltip prog={sel} onClose={() => setSel(null)} />}
      <div style={{ padding: "16px 20px" }}>
        {/* Header dos resultados */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          marginBottom: 20,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>
              {resultados.length} programação{resultados.length !== 1 ? "ões" : ""} encontrada{resultados.length !== 1 ? "s" : ""}
            </div>
            <div style={{ fontSize: 11, color: "#374151", marginTop: 2 }}>
              "{busca}" — {agrupado.length} título{agrupado.length !== 1 ? "s" : ""}
            </div>
          </div>
          <button onClick={onClear} style={{
            display: "flex", alignItems: "center", gap: 5, padding: "5px 10px",
            background: "#111", border: "1px solid #1e1e2e", borderRadius: 7,
            color: "#475569", fontSize: 12, cursor: "pointer",
          }}>
            <X style={{ width: 11, height: 11 }} /> Limpar busca
          </button>
        </div>

        {agrupado.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#374151" }}>
            <Search style={{ width: 28, height: 28, margin: "0 auto 12px", display: "block", opacity: 0.3 }} />
            <div style={{ fontSize: 14 }}>Nenhum programa encontrado para "{busca}"</div>
            <div style={{ fontSize: 12, marginTop: 6, color: "#1e293b" }}>
              Tente termos como: Globo, ESPN, Jornal Nacional, Big Brother...
            </div>
          </div>
        )}

        {/* Grupos por título */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {agrupado.map(({ titulo, items }) => {
            const cor = CAT_COR[items[0].canal.categoria] || "#6b7280";
            return (
              <div key={titulo}>
                {/* Título do programa */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  marginBottom: 8, paddingBottom: 8,
                  borderBottom: `1px solid ${cor}20`,
                }}>
                  <div style={{ width: 3, height: 16, background: cor, borderRadius: 2, flexShrink: 0 }} />
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{titulo}</div>
                  <div style={{
                    fontSize: 10, fontWeight: 600, padding: "2px 7px",
                    borderRadius: 20, background: cor + "20", color: cor,
                    border: `1px solid ${cor}30`,
                  }}>
                    {items.length}x
                  </div>
                </div>

                {/* Linhas de exibição */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {items.map((r, i) => {
                    const startMs  = new Date(r.prog.start).getTime();
                    const stopMs   = new Date(r.prog.stop).getTime();
                    const emAndamento = agora >= startMs && agora <= stopMs;
                    const passou   = agora > stopMs;

                    return (
                      <div key={i}
                        onClick={() => setSel(r.prog)}
                        style={{
                          display: "flex", alignItems: "center", gap: 12,
                          padding: "10px 14px", borderRadius: 9, cursor: "pointer",
                          background: emAndamento ? cor + "12" : "#0f0f0f",
                          border: `1px solid ${emAndamento ? cor + "40" : "#1a1a1a"}`,
                          opacity: passou ? 0.45 : 1,
                          transition: "background 0.12s, border-color 0.12s",
                        }}
                        onMouseEnter={e => {
                          if (!passou) {
                            (e.currentTarget as HTMLDivElement).style.background = emAndamento ? cor + "20" : "#161616";
                            (e.currentTarget as HTMLDivElement).style.borderColor = cor + "50";
                          }
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLDivElement).style.background = emAndamento ? cor + "12" : "#0f0f0f";
                          (e.currentTarget as HTMLDivElement).style.borderColor = emAndamento ? cor + "40" : "#1a1a1a";
                        }}
                      >
                        {/* Logo canal */}
                        <Logo src={r.canal.icon} nome={r.canal.nome} categoria={r.canal.categoria} size={36} />

                        {/* Info canal */}
                        <div style={{ minWidth: 120, flexShrink: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#bbb" }}>{r.canal.nome}</div>
                          <div style={{ fontSize: 10, color: "#374151", marginTop: 2 }}>{r.canal.categoria}</div>
                        </div>

                        {/* Horário */}
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {emAndamento && (
                              <div style={{
                                display: "flex", alignItems: "center", gap: 4,
                                fontSize: 10, fontWeight: 700, color: cor,
                                background: cor + "20", padding: "2px 7px",
                                borderRadius: 20, flexShrink: 0,
                              }}>
                                <div style={{
                                  width: 5, height: 5, borderRadius: "50%",
                                  background: cor, animation: "pulse 1s infinite",
                                }} />
                                AO VIVO
                              </div>
                            )}
                            <span style={{ fontSize: 13, fontWeight: 600, color: emAndamento ? "#fff" : "#888" }}>
                              {formatHora(r.prog.start)} – {formatHora(r.prog.stop)}
                            </span>
                            <span style={{ fontSize: 11, color: "#374151" }}>
                              · {r.prog.duracao_min} min
                            </span>
                          </div>
                          {r.prog.desc && (
                            <div style={{
                              fontSize: 11, color: "#374151", marginTop: 3,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              maxWidth: 340,
                            }}>
                              {r.prog.desc}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─── Grade EPG ──────────────────────────────────────────────────────────────
// Scroll único (um só div scroll em X e Y).
// Régua fica sticky no topo, coluna de canais sticky à esquerda.
// Funciona corretamente com o layout flex-column da página.
function GradeEPG({ canais, progsPorCanal }: {
  canais: Canal[]; progsPorCanal: Map<string, Programa[]>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [agora, setAgora]     = useState(nowBRT);
  const [progSel, setProgSel] = useState<Programa | null>(null);
  // Mobile inicia minimizado (só ícone), desktop sempre expandido
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const [showNomes, setShowNomes] = useState(!isMobile);
  const canalW = showNomes ? CANAL_COL_W : 44; // 44px = só ícone

  useEffect(() => {
    const iv = setInterval(() => setAgora(nowBRT()), 60000);
    return () => clearInterval(iv);
  }, []);

  const gradeWidth = TOTAL_HORAS * HORA_WIDTH;
  const linhaH = isMobile ? 80 : LINHA_H; // Mobile: linhas maiores

  const baseMs = useMemo(() => {
    const brtMs = Date.now() - 3 * 3600000;
    return Math.floor(brtMs / 3600000) * 3600000 - 3600000;
  }, []);

  const agoraOffsetPx = useMemo(() => {
    const brtMs = agora.getTime() - 3 * 3600000;
    return ((brtMs - baseMs) / 60000) * PX_POR_MIN;
  }, [agora, baseMs]);

  const horaLabels = useMemo(() =>
    Array.from({ length: TOTAL_HORAS + 1 }, (_, i) => ({
      x: i * HORA_WIDTH,
      label: new Date(baseMs + 3 * 3600000 + i * 3600000)
        .toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }),
    }))
  , [baseMs]);

  // Scroll inicial: "agora" com 1h de contexto à esquerda
  useEffect(() => {
    if (scrollRef.current && agoraOffsetPx > 0)
      scrollRef.current.scrollLeft = Math.max(0, agoraOffsetPx - HORA_WIDTH);
  }, [agoraOffsetPx]);

  return (
    <>
      {progSel && <ProgramaTooltip prog={progSel} onClose={() => setProgSel(null)} />}

      {/* Um único div com scroll em ambas as direções */}
      <div ref={scrollRef} style={{ overflowX: "auto", overflowY: "auto", background: "#0f1117", flex: 1, minHeight: 0 }}>
        <div style={{ display: "inline-block", minWidth: canalW + gradeWidth }}>

          {/* ── Régua de horas — sticky no topo ── */}
          <div style={{
            position: "sticky", top: 0, zIndex: 30,
            display: "flex", height: REGUA_H,
            background: "#13151f", borderBottom: "1px solid #1e2130",
          }}>
            {/* Canto fixo — só visual, sem botão no desktop */}
            <div style={{
              width: canalW, flexShrink: 0,
              position: "sticky", left: 0, zIndex: 31,
              background: "#13151f", borderRight: "1px solid #1e2130",
            }} />
            {/* Labels de hora */}
            <div style={{ position: "relative", width: gradeWidth, flexShrink: 0 }}>
              {horaLabels.map((h, i) => (
                <div key={i} style={{
                  position: "absolute", left: h.x, top: 0, height: "100%",
                  display: "flex", alignItems: "center", paddingLeft: 8,
                  borderLeft: i > 0 ? "1px solid #1e2130" : "none",
                }}>
                  <span style={{ fontSize: 11, color: "#4a5568", whiteSpace: "nowrap" }}>{h.label}</span>
                </div>
              ))}
              {/* Linha vermelha na régua */}
              <div style={{ position: "absolute", left: agoraOffsetPx, top: 0, width: 2, height: "100%", background: "#ef4444" }} />
            </div>
          </div>

          {/* ── Linhas de canal ── */}
          {canais.map((canal) => {
            const progs = (progsPorCanal.get(canal.id) || [])
              .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
            const cor = CAT_COR[canal.categoria] || "#6b7280";
            const agoraBrtMs = agora.getTime() - 3 * 3600000;

            return (
              <div key={canal.id} style={{ display: "flex", height: linhaH, borderBottom: "1px solid #1a1d2e" }}>

                {/* Nome do canal — sticky à esquerda; no mobile é clicável */}
                <div
                  style={{
                    width: canalW, flexShrink: 0,
                    position: "sticky", left: 0, zIndex: 20,
                    background: "#0f1117", borderRight: "1px solid #1e2130",
                    display: "flex", alignItems: "center",
                    gap: showNomes ? 10 : 0,
                    padding: showNomes ? "0 12px" : "0",
                    justifyContent: showNomes ? "flex-start" : "center",
                    cursor: isMobile ? "pointer" : "default",
                    userSelect: "none",
                  }}
                  onClick={() => isMobile && setShowNomes(v => !v)}
                >
                  <Logo src={canal.icon} nome={canal.nome} categoria={canal.categoria} size={showNomes ? (isMobile ? 38 : 32) : (isMobile ? 42 : 36)} />
                  {showNomes && (
                    <span style={{
                      fontSize: 11, color: "#94a3b8", fontWeight: 500,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{canal.nome}</span>
                  )}
                </div>

                {/* Área de programas */}
                <div style={{ position: "relative", width: gradeWidth, flexShrink: 0 }}>
                  {/* Linha vermelha do "agora" */}
                  <div style={{ position: "absolute", left: agoraOffsetPx, top: 0, width: 2, height: "100%", background: "#ef4444", zIndex: 5, pointerEvents: "none" }} />
                  {/* Divisórias de hora */}
                  {horaLabels.map((h, i) => i > 0 && (
                    <div key={i} style={{ position: "absolute", left: h.x, top: 0, width: 1, height: "100%", background: "#1e2130", pointerEvents: "none" }} />
                  ))}
                  {/* Programas */}
                  {/* Se não há programação, exibe placeholder a cada 2h */}
                  {progs.length === 0 && Array.from({ length: Math.ceil(TOTAL_HORAS / 2) }, (_, i) => {
                    const lPx = i * 2 * HORA_WIDTH + 1;
                    const wPx = 2 * HORA_WIDTH - 6;
                    return (
                      <div key={`placeholder-${i}`} style={{
                        position: "absolute", left: lPx, width: wPx,
                        top: 5, bottom: 5, borderRadius: 5,
                        background: "#141624", border: "1px solid #1e2130",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        opacity: 0.5,
                      }}>
                        <span style={{ fontSize: 11, color: "#374151" }}>Sem informação</span>
                      </div>
                    );
                  })}
                  {progs.map(prog => {
                    const sMs  = new Date(prog.start).getTime() - 3 * 3600000;
                    const eMs  = new Date(prog.stop).getTime()  - 3 * 3600000;
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
                          background: isAtual ? cor + "22" : "#1a1d2e",
                          border: `1px solid ${isAtual ? cor + "50" : "#252840"}`,
                          overflow: "hidden", display: "flex", alignItems: "center",
                          transition: "background 0.1s",
                        }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLDivElement).style.background = isAtual ? cor + "35" : "#1e2130";
                          (e.currentTarget as HTMLDivElement).style.borderColor = cor + "60";
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLDivElement).style.background = isAtual ? cor + "22" : "#1a1d2e";
                          (e.currentTarget as HTMLDivElement).style.borderColor = isAtual ? cor + "50" : "#252840";
                        }}
                      >
                        {/* Thumbnail */}
                        {prog.prog_icon && wPx > 90 && (
                          <img src={prog.prog_icon} alt="" style={{
                            height: "100%", width: "auto", maxWidth: Math.min(wPx * 0.28, 52),
                            objectFit: "cover", flexShrink: 0, opacity: 0.8,
                          }} />
                        )}
                        {/* Título */}
                        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: isAtual ? "flex-start" : "center", gap: 5, padding: "4px 7px" }}>
                          {isAtual && (
                            <div style={{ width: 5, height: 5, borderRadius: "50%", background: cor, flexShrink: 0, boxShadow: `0 0 5px ${cor}80`, marginTop: 3 }} />
                          )}
                          <span style={{
                            fontSize: 11, fontWeight: isAtual ? 500 : 400,
                            color: isAtual ? "#f1f5f9" : "#64748b",
                            overflow: "hidden", display: "-webkit-box",
                            WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                            whiteSpace: "normal", lineHeight: 1.3,
                          }}>
                            {lRaw < 0 ? `◀ ${prog.title}` : wPx > 70 ? `${formatHora(prog.start)} ${prog.title}` : prog.title}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

        </div>
      </div>
    </>
  );
}

// ─── Dropdown filtro ─────────────────────────────────────────────────────────
function DropdownFiltro({ label, ativo, cor, children }: {
  label: string; ativo: boolean; cor?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const c = cor || "#6366f1";

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: "flex", alignItems: "center", gap: 6,
        height: 36, padding: "0 12px",
        background: ativo ? c + "15" : "#1a1d2e",
        border: `1px solid ${ativo ? c + "50" : "#252840"}`,
        borderRadius: 8, cursor: "pointer",
        color: ativo ? c : "#94a3b8", fontSize: 13, fontWeight: ativo ? 600 : 400,
        transition: "all 0.12s", whiteSpace: "nowrap",
      }}>
        {label}
        <ChevronDown style={{ width: 13, height: 13, opacity: 0.6, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, minWidth: 200,
          background: "#13151f", border: "1px solid #1e2130", borderRadius: 10,
          zIndex: 200, overflow: "hidden", boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
          maxHeight: 320, overflowY: "auto",
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Pill filtro ──────────────────────────────────────────────────────────────
function Pill({ label, ativo, cor, onClick }: {
  label: string; ativo: boolean; cor?: string; onClick: () => void;
}) {
  const c = cor || "#6366f1";
  return (
    <button onClick={onClick} style={{
      padding: "5px 12px", borderRadius: 20, whiteSpace: "nowrap",
      border: `1px solid ${ativo ? c : "#1e1e1e"}`,
      background: ativo ? c + "20" : "transparent",
      color: ativo ? c : "#374151", fontSize: 12,
      fontWeight: ativo ? 600 : 400, cursor: "pointer",
      transition: "all 0.12s",
    }}>{label}</button>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function GuiaTVPage() {
  const [epg, setEpg]       = useState<EpgData | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro]     = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg]       = useState<{ tipo: "ok" | "err"; texto: string } | null>(null);

  const [catAtiva, setCatAtiva]   = useState("Todos");
  const [subAtiva, setSubAtiva]   = useState("Todos");
  const [busca, setBusca]         = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");

  // Carrega EPG
  useEffect(() => {
    (async () => {
      setLoading(true); setErro(null);
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_R2_DEV_URL}/epg/epg_br.json?t=${Date.now()}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setEpg(await res.json());
      } catch { setErro("Grade não encontrada. Rode o Sync EPG."); }
      finally { setLoading(false); }
    })();
  }, []);

  // Sync EPG
  async function handleSync() {
    setSyncing(true); setMsg(null);
    try {
      const d = await fetch("/api/epg/sync", { method: "POST" }).then(r => r.json());
      if (d.ok) {
        setMsg({ tipo: "ok", texto: `EPG sincronizado em ${d.duracao_s}s` });
        setTimeout(() => window.location.reload(), 1800);
      } else setMsg({ tipo: "err", texto: d.error || "Sync falhou" });
    } catch (e: any) { setMsg({ tipo: "err", texto: e.message }); }
    finally { setSyncing(false); }
  }

  // Programas filtrados por janela de tempo
  const progsPorCanal = useMemo(() => {
    if (!epg) return new Map<string, Programa[]>();
    const map = new Map<string, Programa[]>();
    const brtMs = Date.now() - 3 * 3600000;
    const ini = brtMs - 1 * 3600000, fim = brtMs + 24 * 3600000;
    for (const p of epg.programas) {
      const s = new Date(p.start).getTime(), e = new Date(p.stop).getTime();
      if (e < ini || s > fim) continue;
      const arr = map.get(p.channel_id) || []; arr.push(p);
      map.set(p.channel_id, arr);
    }
    return map;
  }, [epg]);

  // Canais filtrados por categoria/subcategoria
  const canaisFiltrados = useMemo(() => {
    if (!epg) return [];
    let lista = epg.canais;
    if (catAtiva !== "Todos") lista = lista.filter(c => c.categoria === catAtiva);
    if (subAtiva !== "Todos") {
      const subs = SUBGRUPOS[catAtiva] || [];
      const sg = subs.find(s => s.label === subAtiva);
      if (sg) lista = lista.filter(c => sg.match.some(m => c.display_name.toUpperCase().includes(m)));
    }
    return lista;
  }, [epg, catAtiva, subAtiva]);

  // Busca por programas — retorna pares {canal, prog}
  const resultadosBusca = useMemo(() => {
    if (!epg || !buscaAtiva.trim()) return [];
    const q = buscaAtiva.toLowerCase().trim();
    const resultados: Array<{ canal: Canal; prog: Programa }> = [];
    const canalMap = new Map(epg.canais.map(c => [c.id, c]));

    for (const prog of epg.programas) {
      const match =
        prog.title.toLowerCase().includes(q) ||
        prog.desc?.toLowerCase().includes(q);
      if (!match) continue;
      const canal = canalMap.get(prog.channel_id);
      if (!canal) continue;
      // Filtra por categoria/sub se ativas
      if (catAtiva !== "Todos" && canal.categoria !== catAtiva) continue;
      resultados.push({ canal, prog });
    }

    // Ordena: ao vivo primeiro, depois por horário
    const agora = Date.now();
    return resultados.sort((a, b) => {
      const aAtual = agora >= new Date(a.prog.start).getTime() && agora <= new Date(a.prog.stop).getTime();
      const bAtual = agora >= new Date(b.prog.start).getTime() && agora <= new Date(b.prog.stop).getTime();
      if (aAtual && !bAtual) return -1;
      if (!aAtual && bAtual) return 1;
      return new Date(a.prog.start).getTime() - new Date(b.prog.start).getTime();
    });
  }, [epg, buscaAtiva, catAtiva]);

  const catsDisponiveis = useMemo(() => {
    if (!epg) return [];
    const set = new Set(epg.canais.map(c => c.categoria));
    return CATS_ORDEM.filter(c => set.has(c));
  }, [epg]);

  const subgruposDisponiveis = SUBGRUPOS[catAtiva] || [];

  function handleBusca() {
    setBuscaAtiva(busca.trim());
  }

  function limparBusca() {
    setBusca("");
    setBuscaAtiva("");
  }

  function handleCatChange(cat: string) {
    setCatAtiva(cat);
    setSubAtiva("Todos");
    // Mantém a busca ativa mas reaplica com novo filtro de categoria
  }

  const emBusca = buscaAtiva.trim().length > 0;

  return (
    <div style={{ background: "#0f1117", display: "flex", flexDirection: "column", color: "#cbd5e1" }}>

      {/* ── Topo ────────────────────────────────────────────────── */}
      <div style={{
        zIndex: 40, flexShrink: 0,
        background: "#13151f", borderBottom: "1px solid #1e2130",
      }}>
        {/* Linha única: título · filtros · busca · sync */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 20px", flexWrap: "wrap",
        }}>
          {/* Título */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 4 }}>
            <Tv style={{ color: "#ef4444", width: 16, height: 16, flexShrink: 0 }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9", whiteSpace: "nowrap" }}>Guia TV</span>
            {epg && (
              <span style={{ fontSize: 10, color: "#475569", whiteSpace: "nowrap" }}>
                {epg.total_canais} canais · {formatDataHora(epg.gerado_em)}
              </span>
            )}
          </div>

          {/* Dropdown Categoria */}
          <DropdownFiltro
            label={catAtiva === "Todos" ? "Categoria" : `${CAT_EMOJI[catAtiva]} ${catAtiva}`}
            ativo={catAtiva !== "Todos"}
            cor={catAtiva !== "Todos" ? CAT_COR[catAtiva] : undefined}
          >
            {[{ value: "Todos", label: "📡 Todas as categorias" },
              ...catsDisponiveis.map(c => ({ value: c, label: `${CAT_EMOJI[c]} ${c}` }))
            ].map(opt => (
              <button key={opt.value} onClick={() => handleCatChange(opt.value)} style={{
                display: "block", width: "100%", padding: "8px 14px",
                background: catAtiva === opt.value ? "#1e2130" : "none",
                border: "none", textAlign: "left", cursor: "pointer",
                color: catAtiva === opt.value ? "#f1f5f9" : "#94a3b8",
                fontSize: 13, borderLeft: `3px solid ${catAtiva === opt.value ? (CAT_COR[opt.value] || "#6366f1") : "transparent"}`,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "#1e2130")}
              onMouseLeave={e => (e.currentTarget.style.background = catAtiva === opt.value ? "#1e2130" : "none")}
              >{opt.label}</button>
            ))}
          </DropdownFiltro>

          {/* Dropdown Subcategoria — só aparece quando há subgrupos */}
          {subgruposDisponiveis.length > 0 && (
            <DropdownFiltro
              label={subAtiva === "Todos" ? "Subcategoria" : subAtiva}
              ativo={subAtiva !== "Todos"}
              cor={catAtiva !== "Todos" ? CAT_COR[catAtiva] : undefined}
            >
              {[{ value: "Todos", label: `Todos em ${catAtiva}` },
                ...subgruposDisponiveis.map(s => ({ value: s.label, label: s.label }))
              ].map(opt => (
                <button key={opt.value} onClick={() => setSubAtiva(opt.value)} style={{
                  display: "block", width: "100%", padding: "8px 14px",
                  background: subAtiva === opt.value ? "#1e2130" : "none",
                  border: "none", textAlign: "left", cursor: "pointer",
                  color: subAtiva === opt.value ? "#f1f5f9" : "#94a3b8",
                  fontSize: 13, borderLeft: `3px solid ${subAtiva === opt.value ? (CAT_COR[catAtiva] || "#6366f1") : "transparent"}`,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "#1e2130")}
                onMouseLeave={e => (e.currentTarget.style.background = subAtiva === opt.value ? "#1e2130" : "none")}
                >{opt.label}</button>
              ))}
            </DropdownFiltro>
          )}

          {/* Busca */}
          <div style={{ position: "relative", flex: 1, minWidth: 180, maxWidth: 360 }}>
            <Search style={{
              position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
              width: 13, height: 13, color: "#475569", pointerEvents: "none",
            }} />
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleBusca()}
              placeholder="Buscar programas..."
              style={{
                width: "100%", height: 36, paddingLeft: 32, paddingRight: busca ? 30 : 10,
                background: "#1a1d2e", border: `1px solid ${emBusca ? "#6366f1" : "#252840"}`,
                borderRadius: 8, fontSize: 13, color: "#e2e8f0", outline: "none",
                boxSizing: "border-box",
              }}
              onFocus={e => (e.target.style.borderColor = "#6366f1")}
              onBlur={e => (e.target.style.borderColor = emBusca ? "#6366f1" : "#252840")}
            />
            {busca && (
              <button onClick={limparBusca} style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", cursor: "pointer", color: "#475569",
                display: "flex", padding: 0,
              }}>
                <X style={{ width: 13, height: 13 }} />
              </button>
            )}
          </div>

          <button onClick={handleBusca} style={{
            height: 36, padding: "0 14px", background: "#6366f1", border: "none",
            borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 600,
            cursor: "pointer", flexShrink: 0,
          }}>
            Buscar
          </button>

          <div style={{ flex: 1, minWidth: 8 }} />

          {/* Sync EPG */}
          <button onClick={handleSync} disabled={syncing} style={{
            display: "flex", alignItems: "center", gap: 5, height: 36, padding: "0 12px",
            background: "#0d2218", border: `1px solid ${syncing ? "#1a1a1a" : "#10b98150"}`,
            borderRadius: 8, cursor: syncing ? "not-allowed" : "pointer",
            color: syncing ? "#2d4a3e" : "#10b981", fontSize: 12, fontWeight: 500,
            flexShrink: 0,
          }}>
            <RefreshCw style={{ width: 11, height: 11, animation: syncing ? "spin 1s linear infinite" : "none" }} />
            {syncing ? "Sincronizando..." : "Sync EPG"}
          </button>
        </div>

        {/* Feedback */}
        {msg && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "7px 20px",
            background: msg.tipo === "ok" ? "#10b98115" : "#ef444415",
            borderBottom: `1px solid ${msg.tipo === "ok" ? "#10b98130" : "#ef444430"}`,
            fontSize: 12, color: msg.tipo === "ok" ? "#10b981" : "#ef4444",
          }}>
            {msg.tipo === "ok" ? <CheckCircle style={{ width: 13, height: 13 }} /> : <AlertTriangle style={{ width: 13, height: 13 }} />}
            {msg.texto}
            <button onClick={() => setMsg(null)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "inherit" }}>
              <X style={{ width: 12, height: 12 }} />
            </button>
          </div>
        )}
      </div>

      {/* ── Conteúdo scrollável ─────────────────────────────────── */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>

      {/* ── Loading ──────────────────────────────────────────────── */}
      {loading && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: 80, color: "#374151", fontSize: 13 }}>
          <RefreshCw style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} />
          Carregando grade de programação...
        </div>
      )}

      {/* ── Erro ─────────────────────────────────────────────────── */}
      {erro && !loading && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 80, textAlign: "center" }}>
          <AlertTriangle style={{ width: 28, height: 28, color: "#f59e0b" }} />
          <div style={{ fontSize: 14, color: "#bbb" }}>Grade não encontrada</div>
          <div style={{ fontSize: 12, color: "#374151" }}>{erro}</div>
          <button onClick={handleSync} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "7px 14px",
            background: "#10b98115", border: "1px solid #10b98130", borderRadius: 8,
            color: "#10b981", fontSize: 12, cursor: "pointer",
          }}>
            <RefreshCw style={{ width: 13, height: 13 }} /> Sync EPG agora
          </button>
        </div>
      )}

      {/* ── Conteúdo ─────────────────────────────────────────────── */}
      {!loading && !erro && epg && (
        emBusca ? (
          // Modo busca: lista de programas encontrados
          <div style={{ flex: 1, overflowY: "auto" }}><ResultadoBusca
            resultados={resultadosBusca}
            busca={buscaAtiva}
            onClear={limparBusca}
          /></div>
        ) : (
          // Modo normal: grade EPG
          canaisFiltrados.length === 0
            ? <div style={{ textAlign: "center", padding: 60, color: "#374151", fontSize: 13 }}>Nenhum canal encontrado.</div>
            : <div style={{ flex: 1, overflow: "hidden" }}><GradeEPG canais={canaisFiltrados} progsPorCanal={progsPorCanal} /></div>
        )
      )}

      </div>{/* fim conteúdo scrollável */}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #252840; border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: #2e3354; }
      `}</style>
    </div>
  );
}
