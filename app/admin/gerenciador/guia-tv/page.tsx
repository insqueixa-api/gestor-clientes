"use client";

import React, {
  useEffect, useMemo, useRef, useState, useCallback,
} from "react";
import {
  Search, RefreshCw, AlertTriangle, CheckCircle,
  X, Tv, ChevronDown, Database, Film, Clapperboard,
  Star, ChevronLeft, ChevronRight, Menu, Bell,
} from "lucide-react";
import Image from "next/image";

// ─── Tipos EPG ────────────────────────────────────────────────────────────────
type Canal = { id: string; display_name: string; nome: string; categoria: string; icon: string; servidor: string; };
type Programa = { channel_id: string; channel_nome: string; categoria: string; start: string; stop: string; duracao_min: number; title: string; desc: string; prog_icon?: string; };
type EpgData = { gerado_em: string; total_canais: number; total_programas: number; canais: Canal[]; programas: Programa[]; };

// ─── Tipos Catálogo ───────────────────────────────────────────────────────────
type TipoConteudo = "FILME" | "SERIE";
type ServidorId   = "ELITE" | "NATV" | "FAST";

type TituloCard = {
  id: string;
  titulo_normalizado: string;
  tipo: TipoConteudo;
  cover_url: string | null;
  poster_tmdb_url: string | null;
  ano: number | null;
  sinopse: string | null;
  avaliacao: number | null;
  generos: string[] | null;
  total_temporadas: number;
  total_episodios: number;
  tmdb_confirmado: boolean;
  categoria_origem?: string;
  adicionado_em?: string;
};

type TituloBusca = TituloCard & {
  rotas: { servidor: string; categoria: string }[];
};

type Categoria = {
  categoria_origem: string;
  label: string;
  emoji: string;
  total: number;
};

type Detalhe = TituloCard & {
  tmdb_id: number | null;
  disponibilidade: { servidor: string; categoria_origem: string; adicionado_em: string }[];
  temporadas: { temporada: number; total_episodios: number; servidores: string[] }[];
};

// ─── Constantes EPG ───────────────────────────────────────────────────────────
const CATS_ORDEM = ["Aberta","Notícias","Esportes","Filmes","Variedades","Documentários","Infantil","Música","Regional","Religioso","Outros"];
const CAT_COR: Record<string,string> = { "Aberta":"#3b82f6","Notícias":"#ef4444","Esportes":"#10b981","Filmes":"#f59e0b","Variedades":"#8b5cf6","Documentários":"#06b6d4","Infantil":"#ec4899","Música":"#6366f1","Regional":"#84cc16","Religioso":"#f97316","Outros":"#6b7280" };
const CAT_EMOJI: Record<string,string> = { "Aberta":"📺","Notícias":"📰","Esportes":"⚽","Filmes":"🎬","Variedades":"🎭","Documentários":"🌍","Infantil":"🧒","Música":"🎵","Regional":"🗺️","Religioso":"✝️","Outros":"📡" };
const SUBGRUPOS: Record<string,{label:string;match:string[]}[]> = {
  "Esportes":[{label:"SporTV",match:["SPORTV","SPORT TV"]},{label:"Premiere",match:["PREMIERE"]},{label:"ESPN",match:["ESPN"]},{label:"Combate",match:["COMBATE"]},{label:"BandSports",match:["BANDSPORT","BAND SPORT"]},{label:"DAZN",match:["DAZN"]}],
  "Filmes":[{label:"Telecine",match:["TELECINE"]},{label:"HBO",match:["HBO"]},{label:"TNT",match:["TNT"]},{label:"Universal",match:["UNIVERSAL","STUDIO UNIVERSAL"]},{label:"Warner",match:["WARNER"]},{label:"Paramount",match:["PARAMOUNT"]},{label:"Megapix",match:["MEGAPIX"]}],
  "Infantil":[{label:"Cartoon",match:["CARTOON"]},{label:"Disney",match:["DISNEY"]},{label:"Nick",match:["NICK","NICKELODEON"]},{label:"Gloob",match:["GLOOB"]}],
};

const PX_POR_MIN = 4;
const HORA_WIDTH = 60 * PX_POR_MIN;
const CANAL_COL_W = 180;
const LINHA_H = 72;
const REGUA_H = 34;
const TOTAL_HORAS = 48;

const COR_SERVIDOR: Record<string, string> = {
  ELITE: "#6366f1",
  NATV:  "#10b981",
  FAST:  "#f59e0b",
};

// ─── Helpers gerais ───────────────────────────────────────────────────────────
function nowBRT(): Date { return new Date(); }
function formatHora(iso: string) { return new Date(iso).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}); }
function formatDataHora(iso: string) { return new Date(iso).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}); }
function iniciais(nome: string) { return nome.split(" ").filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase(); }

// Normaliza para busca: remove acentos, pontuação, lowercase
function normalizar(s: string): string {
  return s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

// ─── Componentes EPG ─────────────────────────────────────────────────────────
function Logo({src,nome,categoria,size=32}:{src?:string;nome:string;categoria?:string;size?:number}) {
  const [err,setErr]=useState(false);
  const cor=CAT_COR[categoria||""]||"#6b7280";
  if(!src||err) return <div style={{width:size,height:size,flexShrink:0,borderRadius:7,background:cor+"20",border:`1.5px solid ${cor}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.3,fontWeight:700,color:cor,userSelect:"none"}}>{iniciais(nome)}</div>;
  return <img src={src} alt={nome} onError={()=>setErr(true)} style={{width:size,height:size,flexShrink:0,objectFit:"contain",borderRadius:7,background:"#111",border:"1px solid #ffffff10"}} />;
}

function ProgramaTooltip({prog,onClose}:{prog:Programa;onClose:()=>void}) {
  return (
    <div style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#161616",border:"1px solid #2a2a2a",borderRadius:14,overflow:"hidden",maxWidth:460,width:"100%",boxShadow:"0 24px 64px rgba(0,0,0,0.9)"}}>
        {prog.prog_icon&&<div style={{position:"relative",height:200,background:"#111"}}><img src={prog.prog_icon} alt={prog.title} style={{width:"100%",height:"100%",objectFit:"cover"}}/><div style={{position:"absolute",inset:0,background:"linear-gradient(to top,#161616 0%,transparent 60%)"}}/><button onClick={onClose} style={{position:"absolute",top:10,right:10,background:"rgba(0,0,0,0.6)",border:"none",cursor:"pointer",color:"#fff",borderRadius:"50%",width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center"}}><X size={14}/></button></div>}
        <div style={{padding:18}}>
          {!prog.prog_icon&&<div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}><button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:"#666"}}><X size={16}/></button></div>}
          <div style={{fontSize:13,color:"#777",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.5px"}}>{prog.channel_nome} · {prog.categoria}</div>
          <div style={{fontSize:19,fontWeight:600,color:"#fff",lineHeight:1.3,marginBottom:10}}>{prog.title}</div>
          <div style={{display:"flex",gap:8,marginBottom:prog.desc?12:0}}><span style={{fontSize:14,color:"#f59e0b",fontWeight:600}}>{formatHora(prog.start)} – {formatHora(prog.stop)}</span><span style={{fontSize:14,color:"#555"}}>· {prog.duracao_min} min</span></div>
          {prog.desc&&<div style={{fontSize:15,color:"#aaa",lineHeight:1.6}}>{prog.desc}</div>}
        </div>
      </div>
    </div>
  );
}

function GradeEPG({canais,progsPorCanal}:{canais:Canal[];progsPorCanal:Map<string,Programa[]>}) {
  const scrollRef=useRef<HTMLDivElement>(null);
  const [agora,setAgora]=useState(nowBRT);
  const [progSel,setProgSel]=useState<Programa|null>(null);
  const [showNomes,setShowNomes]=useState(true);
  useEffect(()=>{const iv=setInterval(()=>setAgora(nowBRT()),60000);return()=>clearInterval(iv);},[]);
  const gradeWidth=TOTAL_HORAS*HORA_WIDTH;
  const baseMs=useMemo(()=>{ const a=new Date(); const m=new Date(a); m.setUTCHours(3,0,0,0); if(m.getTime()>a.getTime()) m.setUTCDate(m.getUTCDate()-1); return m.getTime(); },[]);
  const agoraOffsetPx=useMemo(()=>((agora.getTime()-baseMs)/60000)*PX_POR_MIN,[agora,baseMs]);
  const horaLabels=useMemo(()=>Array.from({length:TOTAL_HORAS+1},(_,i)=>({x:i*HORA_WIDTH,label:new Date(baseMs+i*3600000).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})})),[baseMs]);
  const canalW=showNomes?CANAL_COL_W:60;
  useEffect(()=>{ if(scrollRef.current&&agoraOffsetPx>0) scrollRef.current.scrollLeft=Math.max(0,agoraOffsetPx-2*HORA_WIDTH); },[agoraOffsetPx]);
  return (
    <>
      {progSel&&<ProgramaTooltip prog={progSel} onClose={()=>setProgSel(null)}/>}
      <div ref={scrollRef} style={{overflowX:"auto",overflowY:"auto",background:"#0f1117",flex:1,minHeight:0}}>
        <div style={{display:"inline-block",width:canalW+gradeWidth}}>
          <div style={{position:"sticky",top:0,zIndex:30,display:"flex",height:REGUA_H,background:"#13151f",borderBottom:"1px solid #1e2130"}}>
            <div style={{width:canalW,flexShrink:0,position:"sticky",left:0,zIndex:31,background:"#13151f",borderRight:"1px solid #1e2130",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <button onClick={()=>setShowNomes(v=>!v)} style={{background:"none",border:"none",cursor:"pointer",color:"#475569",fontSize:10,padding:"2px 6px"}}>
                {showNomes?"◀":"▶"}
              </button>
            </div>
            <div style={{position:"relative",width:gradeWidth,flexShrink:0}}>
              {horaLabels.map((h,i)=>(
                <div key={i} style={{position:"absolute",left:h.x,top:0,height:"100%",display:"flex",alignItems:"center",paddingLeft:8,borderLeft:i>0?"1px solid #1e2130":"none"}}>
                  <span style={{fontSize:11,color:"#4a5568",whiteSpace:"nowrap"}}>{h.label}</span>
                </div>
              ))}
              <div style={{position:"absolute",left:agoraOffsetPx,top:0,width:2,height:"100%",background:"#ef4444"}}/>
            </div>
          </div>
          {canais.map(canal=>{
            const progs=(progsPorCanal.get(canal.id)||[]).sort((a,b)=>new Date(a.start).getTime()-new Date(b.start).getTime());
            const cor=CAT_COR[canal.categoria]||"#6b7280";
            const agoraBrtMs=agora.getTime()-3*3600000;
            return (
              <div key={canal.id} style={{display:"flex",height:LINHA_H,borderBottom:"1px solid #1a1d2e"}}>
                <div style={{width:canalW,flexShrink:0,position:"sticky",left:0,zIndex:20,background:"#0f1117",borderRight:"1px solid #1e2130",display:"flex",alignItems:"center",gap:showNomes?10:0,padding:showNomes?"0 12px":"0",justifyContent:showNomes?"flex-start":"center",cursor:"pointer",userSelect:"none"}} onClick={()=>setShowNomes(v=>!v)}>
                  <Logo src={canal.icon} nome={canal.nome} categoria={canal.categoria} size={showNomes?34:44}/>
                  {showNomes&&<span style={{fontSize:13,color:"#94a3b8",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{canal.nome}</span>}
                </div>
                <div style={{position:"relative",width:gradeWidth,flexShrink:0}}>
                  <div style={{position:"absolute",left:agoraOffsetPx,top:0,width:2,height:"100%",background:"#ef4444",zIndex:5,pointerEvents:"none"}}/>
                  {horaLabels.map((h,i)=>i>0&&<div key={i} style={{position:"absolute",left:h.x,top:0,width:1,height:"100%",background:"#1e2130",pointerEvents:"none"}}/>)}
                  {progs.length===0&&Array.from({length:Math.ceil(TOTAL_HORAS/2)},(_,i)=>(
                    <div key={i} style={{position:"absolute",left:i*2*HORA_WIDTH+1,width:2*HORA_WIDTH-6,top:5,bottom:5,borderRadius:5,background:"#141624",border:"1px solid #1e2130",display:"flex",alignItems:"center",justifyContent:"center",opacity:0.8}}>
                      <span style={{fontSize:13,color:"#64748b",fontWeight:500}}>Sem informação</span>
                    </div>
                  ))}
                  {progs.map(prog=>{
                    const sMs=new Date(prog.start).getTime(),eMs=new Date(prog.stop).getTime();
                    const lRaw=((sMs-baseMs)/60000)*PX_POR_MIN;
                    const wRaw=Math.max(((eMs-sMs)/60000)*PX_POR_MIN-2,4);
                    const lPx=Math.max(lRaw,0);
                    const wPx=Math.max(wRaw-(lPx-lRaw),20);
                    const isAtual=agoraBrtMs>=sMs&&agoraBrtMs<=eMs;
                    return (
                      <div key={prog.start} onClick={()=>setProgSel(prog)}
                        style={{position:"absolute",left:lPx+1,width:wPx-2,top:5,bottom:5,borderRadius:5,cursor:"pointer",background:isAtual?cor+"22":"#1a1d2e",border:`1px solid ${isAtual?cor+"50":"#252840"}`,clipPath:"inset(0 round 5px)",display:"flex",alignItems:"center",transition:"background 0.1s"}}
                        onMouseEnter={e=>{(e.currentTarget as HTMLDivElement).style.background=isAtual?cor+"35":"#1e2130";}}
                        onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.background=isAtual?cor+"22":"#1a1d2e";}}>
                        <div style={{position:"sticky",left:canalW,display:"flex",alignItems:"center",height:"100%",minWidth:0,maxWidth:"100%"}}>
                          {prog.prog_icon&&wPx>90&&<img src={prog.prog_icon} alt="" style={{height:"100%",width:"auto",maxWidth:Math.min(wPx*0.28,52),objectFit:"cover",flexShrink:0,opacity:0.8}}/>}
                          <div style={{flex:1,minWidth:0,display:"flex",alignItems:isAtual?"flex-start":"center",gap:5,padding:"4px 7px"}}>
                            {isAtual&&<div style={{width:5,height:5,borderRadius:"50%",background:cor,flexShrink:0,boxShadow:`0 0 5px ${cor}80`,marginTop:3}}/>}
                            <span style={{fontSize:13,fontWeight:isAtual?500:400,color:isAtual?"#f1f5f9":"#8492a6",overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",whiteSpace:"normal",lineHeight:1.3}}>
                              {lRaw<0?`◀ ${prog.title}`:wPx>70?`${formatHora(prog.start)} ${prog.title}`:prog.title}
                            </span>
                          </div>
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

// ─── Poster com fallback ──────────────────────────────────────────────────────
function Poster({ titulo, posterUrl, coverUrl, size = "md" }: {
  titulo: string; posterUrl: string | null; coverUrl: string | null; size?: "sm" | "md" | "lg";
}) {
  const [err, setErr] = useState(false);
  const src = (!err && (posterUrl || coverUrl)) || null;
  const dims = size === "sm" ? { w: 80, h: 120 } : size === "md" ? { w: 120, h: 180 } : { w: 200, h: 300 };
  if (!src) {
    return (
      <div style={{ width: dims.w, height: dims.h, background: "linear-gradient(135deg,#1e2130,#252840)", borderRadius: 8, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, flexShrink: 0 }}>
        <Film size={dims.w * 0.3} color="#374151" />
        <span style={{ fontSize: 10, color: "#374151", textAlign: "center", padding: "0 8px", lineHeight: 1.3 }}>{titulo.slice(0, 20)}</span>
      </div>
    );
  }
  return (
    <img src={src} alt={titulo} onError={() => setErr(true)}
      style={{ width: dims.w, height: dims.h, objectFit: "cover", borderRadius: 8, flexShrink: 0, background: "#1a1d2e" }} />
  );
}

// ─── Carrossel de novidades ───────────────────────────────────────────────────
function Carrossel({ itens, onSelect }: { itens: TituloCard[]; onSelect: (t: TituloCard) => void }) {
  const [idx, setIdx] = useState(0);
  const [pausado, setPausado] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (pausado || itens.length <= 1) return;
    timer.current = setTimeout(() => setIdx(i => (i + 1) % itens.length), 4000);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [idx, pausado, itens.length]);

  if (itens.length === 0) return null;

  const item = itens[idx];
  const bg = item.poster_tmdb_url || item.cover_url || "";

  return (
    <div
      style={{ position: "relative", width: "100%", height: 220, borderRadius: 12, overflow: "hidden", cursor: "pointer", flexShrink: 0 }}
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      onClick={() => onSelect(item)}
    >
      {/* Fundo blur */}
      {bg && <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${bg})`, backgroundSize: "cover", backgroundPosition: "center", filter: "blur(20px) brightness(0.3)", transform: "scale(1.1)" }} />}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, rgba(0,0,0,0.85) 40%, transparent 100%)" }} />

      {/* Conteúdo */}
      <div style={{ position: "relative", display: "flex", gap: 16, padding: 16, height: "100%", alignItems: "center" }}>
        <Poster titulo={item.titulo_normalizado} posterUrl={item.poster_tmdb_url} coverUrl={item.cover_url} size="md" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#6366f1", background: "#6366f120", padding: "2px 8px", borderRadius: 20, textTransform: "uppercase", letterSpacing: 1 }}>
              {item.tipo === "FILME" ? "🎬 Filme" : "📺 Série"}
            </span>
            {item.ano && <span style={{ fontSize: 11, color: "#64748b" }}>{item.ano}</span>}
            {item.avaliacao && (
              <span style={{ fontSize: 11, color: "#f59e0b", display: "flex", alignItems: "center", gap: 3 }}>
                <Star size={10} fill="#f59e0b" /> {item.avaliacao.toFixed(1)}
              </span>
            )}
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#f1f5f9", lineHeight: 1.3, marginBottom: 8, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
            {item.titulo_normalizado}
          </div>
          {item.generos && item.generos.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {item.generos.slice(0, 3).map(g => (
                <span key={g} style={{ fontSize: 10, color: "#94a3b8", background: "#1e2130", padding: "2px 8px", borderRadius: 20 }}>{g}</span>
              ))}
            </div>
          )}
          {item.sinopse && (
            <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
              {item.sinopse}
            </div>
          )}
        </div>
      </div>

      {/* Navegação */}
      {itens.length > 1 && (
        <>
          <button onClick={e => { e.stopPropagation(); setIdx(i => (i - 1 + itens.length) % itens.length); }}
            style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.6)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff" }}>
            <ChevronLeft size={16} />
          </button>
          <button onClick={e => { e.stopPropagation(); setIdx(i => (i + 1) % itens.length); }}
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.6)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff" }}>
            <ChevronRight size={16} />
          </button>
          {/* Dots */}
          <div style={{ position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 5 }}>
            {itens.map((_, i) => (
              <button key={i} onClick={e => { e.stopPropagation(); setIdx(i); }}
                style={{ width: i === idx ? 18 : 6, height: 6, borderRadius: 3, background: i === idx ? "#6366f1" : "#374151", border: "none", cursor: "pointer", transition: "all 0.3s", padding: 0 }} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Grade de categorias ──────────────────────────────────────────────────────
function GradeCategorias({ categorias, onSelect }: { categorias: Categoria[]; onSelect: (c: Categoria) => void }) {
  if (categorias.length === 0) {
    return <div style={{ textAlign: "center", padding: "40px 0", color: "#374151", fontSize: 13 }}>Nenhuma categoria encontrada.</div>;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
      {categorias.map(cat => (
        <button key={cat.categoria_origem} onClick={() => onSelect(cat)}
          style={{ background: "#13151f", border: "1px solid #1e2130", borderRadius: 10, padding: "14px 12px", cursor: "pointer", textAlign: "left", transition: "all 0.15s", display: "flex", flexDirection: "column", gap: 6 }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#6366f150"; (e.currentTarget as HTMLButtonElement).style.background = "#1a1d2e"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#1e2130"; (e.currentTarget as HTMLButtonElement).style.background = "#13151f"; }}>
          <span style={{ fontSize: 22 }}>{cat.emoji}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", lineHeight: 1.3 }}>{cat.label}</span>
          <span style={{ fontSize: 10, color: "#475569" }}>{cat.total.toLocaleString()} títulos</span>
        </button>
      ))}
    </div>
  );
}

// ─── Grade de miniaturas (25 por página) ─────────────────────────────────────
function GradeMiniaturas({ titulos, total, page, onSelect, onPage }: {
  titulos: TituloCard[]; total: number; page: number;
  onSelect: (t: TituloCard) => void; onPage: (p: number) => void;
}) {
  const totalPags = Math.ceil(total / 25);
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 10 }}>
        {titulos.map(t => (
          <button key={t.id} onClick={() => onSelect(t)}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
            <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", marginBottom: 6 }}>
              <Poster titulo={t.titulo_normalizado} posterUrl={t.poster_tmdb_url} coverUrl={t.cover_url} size="sm" />
              {t.avaliacao && (
                <div style={{ position: "absolute", top: 5, left: 5, background: "rgba(0,0,0,0.8)", borderRadius: 4, padding: "2px 5px", display: "flex", alignItems: "center", gap: 3 }}>
                  <Star size={9} fill="#f59e0b" color="#f59e0b" />
                  <span style={{ fontSize: 10, color: "#f59e0b", fontWeight: 600 }}>{t.avaliacao.toFixed(1)}</span>
                </div>
              )}
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
              {t.titulo_normalizado}
            </div>
            {t.ano && <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>{t.ano}</div>}
          </button>
        ))}
      </div>
      {totalPags > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 20 }}>
          <button disabled={page <= 1} onClick={() => onPage(page - 1)}
            style={{ padding: "6px 12px", background: page <= 1 ? "#0f1117" : "#1a1d2e", border: "1px solid #252840", borderRadius: 7, color: page <= 1 ? "#374151" : "#94a3b8", cursor: page <= 1 ? "not-allowed" : "pointer", fontSize: 12 }}>
            ← Anterior
          </button>
          <span style={{ fontSize: 12, color: "#475569" }}>{page} / {totalPags}</span>
          <button disabled={page >= totalPags} onClick={() => onPage(page + 1)}
            style={{ padding: "6px 12px", background: page >= totalPags ? "#0f1117" : "#1a1d2e", border: "1px solid #252840", borderRadius: 7, color: page >= totalPags ? "#374151" : "#94a3b8", cursor: page >= totalPags ? "not-allowed" : "pointer", fontSize: 12 }}>
            Próxima →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Modal de detalhe estilo TMDB ─────────────────────────────────────────────
function ModalDetalhe({ id, onClose }: { id: string; onClose: () => void }) {
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/catalogo/detalhe?id=${id}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setDetalhe(d.data); })
      .finally(() => setLoading(false));
  }, [id]);

  const backdrop = detalhe?.poster_tmdb_url || detalhe?.cover_url || "";

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
      onClick={onClose}
    >
      <div onClick={e => e.stopPropagation()}
        style={{ background: "#0f1117", width: "100%", maxWidth: 640, maxHeight: "90vh", borderRadius: "16px 16px 0 0", overflow: "hidden", display: "flex", flexDirection: "column" }}>

        {/* Header com backdrop */}
        <div style={{ position: "relative", height: 200, background: "#13151f", flexShrink: 0 }}>
          {backdrop && (
            <>
              <img src={backdrop} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.4 }} />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, #0f1117 0%, transparent 60%)" }} />
            </>
          )}
          <button onClick={onClose}
            style={{ position: "absolute", top: 12, right: 12, background: "rgba(0,0,0,0.7)", border: "none", borderRadius: "50%", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#94a3b8" }}>
            <X size={16} />
          </button>
          {!loading && detalhe && (
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "0 16px 16px", display: "flex", gap: 14, alignItems: "flex-end" }}>
              <Poster titulo={detalhe.titulo_normalizado} posterUrl={detalhe.poster_tmdb_url} coverUrl={detalhe.cover_url} size="md" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#6366f1", background: "#6366f120", padding: "2px 8px", borderRadius: 20, textTransform: "uppercase" }}>
                    {detalhe.tipo === "FILME" ? "🎬 Filme" : "📺 Série"}
                  </span>
                  {detalhe.ano && <span style={{ fontSize: 11, color: "#64748b" }}>{detalhe.ano}</span>}
                  {detalhe.avaliacao && (
                    <span style={{ fontSize: 12, color: "#f59e0b", display: "flex", alignItems: "center", gap: 3, fontWeight: 600 }}>
                      <Star size={12} fill="#f59e0b" /> {detalhe.avaliacao.toFixed(1)}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", lineHeight: 1.3 }}>
                  {detalhe.titulo_normalizado}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Corpo scrollável */}
        <div style={{ overflowY: "auto", flex: 1, padding: 16 }}>
          {loading && <div style={{ textAlign: "center", padding: 40, color: "#475569" }}>Carregando...</div>}
          {!loading && !detalhe && <div style={{ textAlign: "center", padding: 40, color: "#ef4444" }}>Título não encontrado.</div>}
          {!loading && detalhe && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Gêneros */}
              {detalhe.generos && detalhe.generos.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {detalhe.generos.map(g => (
                    <span key={g} style={{ fontSize: 11, color: "#94a3b8", background: "#1e2130", padding: "3px 10px", borderRadius: 20, border: "1px solid #252840" }}>{g}</span>
                  ))}
                </div>
              )}

              {/* Sinopse */}
              {detalhe.sinopse && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Sinopse</div>
                  <div style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.7 }}>{detalhe.sinopse}</div>
                </div>
              )}

              {/* Disponível em */}
              {detalhe.disponibilidade.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Disponível em</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {detalhe.disponibilidade.map((d, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#13151f", borderRadius: 8, border: `1px solid ${COR_SERVIDOR[d.servidor] || "#1e2130"}30` }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: COR_SERVIDOR[d.servidor] || "#6b7280", flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{d.servidor}</div>
                          <div style={{ fontSize: 11, color: "#64748b" }}>{d.categoria_origem}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Temporadas (série) */}
              {detalhe.tipo === "SERIE" && detalhe.temporadas.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
                    Temporadas ({detalhe.temporadas.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {detalhe.temporadas.map(t => (
                      <div key={t.temporada} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#13151f", borderRadius: 8, border: "1px solid #1e2130" }}>
                        <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 500 }}>Temporada {t.temporada}</span>
                        <span style={{ fontSize: 12, color: "#475569" }}>{t.total_episodios} ep</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Busca no catálogo ────────────────────────────────────────────────────────
function ResultadoBuscaCatalogo({ resultados, loading, onSelect, onClose }: {
  resultados: TituloBusca[]; loading: boolean;
  onSelect: (t: TituloCard) => void; onClose: () => void;
}) {
  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#475569" }}><RefreshCw size={20} style={{ animation: "spin 1s linear infinite", margin: "0 auto 10px", display: "block" }} />Buscando...</div>;
  if (resultados.length === 0) return (
    <div style={{ textAlign: "center", padding: 40, color: "#374151" }}>
      <Search size={28} style={{ margin: "0 auto 12px", display: "block", opacity: 0.3 }} />
      <div style={{ fontSize: 14 }}>Nenhum resultado encontrado</div>
      <div style={{ fontSize: 12, marginTop: 6 }}>Tente outros termos</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {resultados.map(t => (
        <button key={t.id} onClick={() => onSelect(t)}
          style={{ display: "flex", gap: 12, padding: "10px 0", background: "none", border: "none", borderBottom: "1px solid #1a1d2e", cursor: "pointer", textAlign: "left", width: "100%" }}
          onMouseEnter={e => (e.currentTarget.style.background = "#13151f")}
          onMouseLeave={e => (e.currentTarget.style.background = "none")}>
          <Poster titulo={t.titulo_normalizado} posterUrl={t.poster_tmdb_url} coverUrl={t.cover_url} size="sm" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: t.tipo === "FILME" ? "#f59e0b" : "#6366f1", background: t.tipo === "FILME" ? "#f59e0b15" : "#6366f115", padding: "2px 7px", borderRadius: 20 }}>
                {t.tipo === "FILME" ? "Filme" : "Série"}
              </span>
              {t.ano && <span style={{ fontSize: 11, color: "#475569" }}>{t.ano}</span>}
              {t.avaliacao && (
                <span style={{ fontSize: 11, color: "#f59e0b", display: "flex", alignItems: "center", gap: 2 }}>
                  <Star size={9} fill="#f59e0b" /> {t.avaliacao.toFixed(1)}
                </span>
              )}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", marginBottom: 4, lineHeight: 1.3 }}>
              {t.titulo_normalizado}
            </div>
            {t.sinopse && (
              <div style={{ fontSize: 12, color: "#64748b", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", lineHeight: 1.5, marginBottom: 6 }}>
                {t.sinopse}
              </div>
            )}
            {/* Rotas disponíveis */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {t.rotas.map((r, i) => (
                <span key={i} style={{ fontSize: 10, color: COR_SERVIDOR[r.servidor] || "#94a3b8", background: (COR_SERVIDOR[r.servidor] || "#94a3b8") + "15", padding: "2px 7px", borderRadius: 20, border: `1px solid ${(COR_SERVIDOR[r.servidor] || "#94a3b8")}30` }}>
                  {r.servidor} / {r.categoria}
                </span>
              ))}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── Aba Catálogo (Filmes / Séries) ──────────────────────────────────────────
function AbaCatalogo({ tipo, servidorAdmin }: { tipo: TipoConteudo; servidorAdmin: ServidorId | "TODOS" }) {
  const [servidor, setServidor] = useState<ServidorId>(servidorAdmin === "TODOS" ? "ELITE" : servidorAdmin as ServidorId);
  const [novidades, setNovidades] = useState<TituloCard[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [catSelecionada, setCatSelecionada] = useState<Categoria | null>(null);
  const [titulos, setTitulos] = useState<TituloCard[]>([]);
  const [totalTitulos, setTotalTitulos] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingNov, setLoadingNov] = useState(true);
  const [loadingCats, setLoadingCats] = useState(true);
  const [loadingTits, setLoadingTits] = useState(false);
  const [detalhando, setDetalhando] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  const [resultadosBusca, setResultadosBusca] = useState<TituloBusca[]>([]);
  const [loadingBusca, setLoadingBusca] = useState(false);

  // Carrega novidades
  useEffect(() => {
    setLoadingNov(true);
    const srv = servidorAdmin === "TODOS" ? "TODOS" : servidor;
    fetch(`/api/catalogo/novidades?servidor=${srv}&tipo=${tipo}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setNovidades(d.data); })
      .finally(() => setLoadingNov(false));
  }, [servidor, tipo, servidorAdmin]);

  // Carrega categorias
  useEffect(() => {
    setLoadingCats(true);
    setCatSelecionada(null);
    setTitulos([]);
    fetch(`/api/catalogo/categorias?servidor=${servidor}&tipo=${tipo}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setCategorias(d.data); })
      .finally(() => setLoadingCats(false));
  }, [servidor, tipo]);

  // Carrega títulos da categoria
  useEffect(() => {
    if (!catSelecionada) return;
    setLoadingTits(true);
    setTitulos([]);
    fetch(`/api/catalogo/titulos?servidor=${servidor}&tipo=${tipo}&categoria=${encodeURIComponent(catSelecionada.categoria_origem)}&page=${page}`)
      .then(r => r.json())
      .then(d => { if (d.ok) { setTitulos(d.data); setTotalTitulos(d.total); } })
      .finally(() => setLoadingTits(false));
  }, [catSelecionada, servidor, tipo, page]);

  // Busca
  useEffect(() => {
    if (!buscaAtiva.trim()) { setResultadosBusca([]); return; }
    setLoadingBusca(true);
    const srv = servidorAdmin === "TODOS" ? "TODOS" : servidor;
    fetch(`/api/catalogo/busca?q=${encodeURIComponent(buscaAtiva)}&servidor=${srv}&tipo=${tipo}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setResultadosBusca(d.data); })
      .finally(() => setLoadingBusca(false));
  }, [buscaAtiva, servidor, tipo, servidorAdmin]);

  const SERVIDORES: ServidorId[] = ["ELITE", "NATV", "FAST"];
  const emBusca = buscaAtiva.trim().length > 0;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto", background: "#0f1117" }}>
      {/* Filtro servidor (visível para admin) */}
      {servidorAdmin === "TODOS" && (
        <div style={{ padding: "10px 16px 0", display: "flex", gap: 8, flexShrink: 0 }}>
          {SERVIDORES.map(srv => (
            <button key={srv} onClick={() => { setServidor(srv); setCatSelecionada(null); setPage(1); }}
              style={{ padding: "5px 14px", borderRadius: 20, border: `1px solid ${servidor === srv ? COR_SERVIDOR[srv] : "#252840"}`, background: servidor === srv ? COR_SERVIDOR[srv] + "20" : "transparent", color: servidor === srv ? COR_SERVIDOR[srv] : "#64748b", fontSize: 12, fontWeight: servidor === srv ? 700 : 400, cursor: "pointer" }}>
              {srv}
            </button>
          ))}
        </div>
      )}

      {/* Barra de busca */}
      <div style={{ padding: "10px 16px", flexShrink: 0 }}>
        <div style={{ position: "relative" }}>
          <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#475569", pointerEvents: "none" }} />
          <input
            value={busca}
            onChange={e => { setBusca(e.target.value); if (!e.target.value.trim()) setBuscaAtiva(""); }}
            onKeyDown={e => e.key === "Enter" && setBuscaAtiva(busca.trim())}
            placeholder={`Buscar ${tipo === "FILME" ? "filmes" : "séries"}...`}
            style={{ width: "100%", height: 40, paddingLeft: 36, paddingRight: busca ? 36 : 12, background: "#13151f", border: "1px solid #252840", borderRadius: 10, fontSize: 14, color: "#e2e8f0", outline: "none", boxSizing: "border-box" }}
            onFocus={e => (e.target.style.borderColor = "#6366f1")}
            onBlur={e => (e.target.style.borderColor = "#252840")}
          />
          {busca && (
            <button onClick={() => { setBusca(""); setBuscaAtiva(""); }}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#475569", display: "flex" }}>
              <X size={14} />
            </button>
          )}
        </div>
        {busca && (
          <button onClick={() => setBuscaAtiva(busca.trim())}
            style={{ marginTop: 8, width: "100%", height: 36, background: "#6366f1", border: "none", borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Buscar
          </button>
        )}
      </div>

      {/* Conteúdo */}
      <div style={{ flex: 1, padding: "0 16px 20px", overflowY: "auto" }}>
        {emBusca ? (
          <ResultadoBuscaCatalogo resultados={resultadosBusca} loading={loadingBusca} onSelect={t => setDetalhando(t.id)} onClose={() => setBuscaAtiva("")} />
        ) : catSelecionada ? (
          <div>
            {/* Breadcrumb */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <button onClick={() => { setCatSelecionada(null); setPage(1); }}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", background: "#13151f", border: "1px solid #252840", borderRadius: 7, color: "#94a3b8", fontSize: 12, cursor: "pointer" }}>
                ← Categorias
              </button>
              <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600 }}>{catSelecionada.emoji} {catSelecionada.label}</span>
              <span style={{ fontSize: 11, color: "#475569" }}>({totalTitulos.toLocaleString()} títulos)</span>
            </div>
            {loadingTits ? (
              <div style={{ textAlign: "center", padding: 40, color: "#475569" }}><RefreshCw size={20} style={{ animation: "spin 1s linear infinite", margin: "0 auto 10px", display: "block" }} /></div>
            ) : (
              <GradeMiniaturas titulos={titulos} total={totalTitulos} page={page} onSelect={t => setDetalhando(t.id)} onPage={p => { setPage(p); window.scrollTo(0, 0); }} />
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Carrossel */}
            {loadingNov ? null : novidades.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
                  ✨ Adicionados recentemente
                </div>
                <Carrossel itens={novidades} onSelect={t => setDetalhando(t.id)} />
              </div>
            )}
            {/* Categorias */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
                Navegar por categoria
              </div>
              {loadingCats ? (
                <div style={{ textAlign: "center", padding: 30, color: "#475569" }}><RefreshCw size={18} style={{ animation: "spin 1s linear infinite", margin: "0 auto", display: "block" }} /></div>
              ) : (
                <GradeCategorias categorias={categorias} onSelect={c => { setCatSelecionada(c); setPage(1); }} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal detalhe */}
      {detalhando && <ModalDetalhe id={detalhando} onClose={() => setDetalhando(null)} />}
    </div>
  );
}

// ─── Busca EPG (canais) ───────────────────────────────────────────────────────
function ResultadoBuscaEPG({ epg, busca, progsPorCanal, onClear }: { epg: EpgData; busca: string; progsPorCanal: Map<string, Programa[]>; onClear: () => void }) {
  const [detalhe, setDetalhe] = useState<null | { tipo: "canal"; canal: Canal } | { tipo: "programa"; titulo: string }>(null);
  const termo = busca.toLowerCase().trim();
  const agora = Date.now();

  const canaisMatch = useMemo(() => epg.canais.filter(c => normalizar(c.nome).includes(normalizar(busca)) || normalizar(c.display_name).includes(normalizar(busca))), [epg, busca]);

  const programasMatch = useMemo(() => {
    const titulos = new Map<string, { prog: Programa; canal: Canal }[]>();
    const cmap = new Map(epg.canais.map(c => [c.id, c]));
    for (const p of epg.programas) {
      if (!normalizar(p.title).includes(normalizar(busca))) continue;
      const c = cmap.get(p.channel_id); if (!c) continue;
      const arr = titulos.get(p.title) || []; arr.push({ prog: p, canal: c }); titulos.set(p.title, arr);
    }
    return [...titulos.entries()].map(([titulo, items]) => ({ titulo, items: items.sort((a, b) => new Date(a.prog.start).getTime() - new Date(b.prog.start).getTime()) })).sort((a, b) => b.items.length - a.items.length);
  }, [epg, busca]);

  const progCanal = useMemo(() => {
    if (detalhe?.tipo !== "canal") return [];
    const fim = agora + 24 * 3600000;
    return (progsPorCanal.get(detalhe.canal.id) || []).filter(p => new Date(p.stop).getTime() > agora && new Date(p.start).getTime() < fim).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }, [detalhe, progsPorCanal, agora]);

  if (detalhe?.tipo === "canal") return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <button onClick={() => setDetalhe(null)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", background: "#1a1d2e", border: "1px solid #252840", borderRadius: 7, color: "#94a3b8", fontSize: 12, cursor: "pointer" }}>← Voltar</button>
        <Logo src={detalhe.canal.icon} nome={detalhe.canal.nome} categoria={detalhe.canal.categoria} size={32} />
        <div><div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9" }}>{detalhe.canal.nome}</div><div style={{ fontSize: 11, color: "#475569" }}>{detalhe.canal.categoria}</div></div>
        <button onClick={onClear} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", background: "#111", border: "1px solid #1e1e2e", borderRadius: 7, color: "#475569", fontSize: 12, cursor: "pointer" }}><X size={12} /> Nova busca</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {progCanal.map((p, i) => {
          const emAnd = agora >= new Date(p.start).getTime() && agora <= new Date(p.stop).getTime();
          const cor = CAT_COR[detalhe.canal.categoria] || "#6b7280";
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8, background: emAnd ? cor + "12" : "#0f0f0f", border: `1px solid ${emAnd ? cor + "40" : "#1a1a1a"}` }}>
              {emAnd && <div style={{ fontSize: 10, fontWeight: 700, color: cor, background: cor + "20", padding: "2px 7px", borderRadius: 20, flexShrink: 0 }}>AO VIVO</div>}
              <span style={{ fontSize: 13, color: "#64748b", flexShrink: 0, minWidth: 90 }}>{formatHora(p.start)} – {formatHora(p.stop)}</span>
              <span style={{ fontSize: 13, fontWeight: emAnd ? 600 : 400, color: emAnd ? "#f1f5f9" : "#94a3b8", flex: 1 }}>{p.title}</span>
              <span style={{ fontSize: 11, color: "#374151", flexShrink: 0 }}>{p.duracao_min} min</span>
            </div>
          );
        })}
        {progCanal.length === 0 && <div style={{ textAlign: "center", padding: 30, color: "#374151", fontSize: 13 }}>Sem programação disponível</div>}
      </div>
    </div>
  );

  if (detalhe?.tipo === "programa") {
    const ocorrencias = programasMatch.find(p => p.titulo === detalhe.titulo)?.items || [];
    return (
      <div style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <button onClick={() => setDetalhe(null)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", background: "#1a1d2e", border: "1px solid #252840", borderRadius: 7, color: "#94a3b8", fontSize: 12, cursor: "pointer" }}>← Voltar</button>
          <div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9" }}>{detalhe.titulo}</div><div style={{ fontSize: 11, color: "#475569" }}>{ocorrencias.length} exibição(ões)</div></div>
          <button onClick={onClear} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", background: "#111", border: "1px solid #1e1e2e", borderRadius: 7, color: "#475569", fontSize: 12, cursor: "pointer" }}><X size={12} /> Nova busca</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {ocorrencias.map((item, i) => {
            const emAnd = agora >= new Date(item.prog.start).getTime() && agora <= new Date(item.prog.stop).getTime();
            const passou = agora > new Date(item.prog.stop).getTime();
            const corCanal = CAT_COR[item.canal.categoria] || "#6b7280";
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8, background: emAnd ? corCanal + "12" : "#0f0f0f", border: `1px solid ${emAnd ? corCanal + "40" : "#1a1a1a"}`, opacity: passou ? 0.45 : 1 }}>
                <Logo src={item.canal.icon} nome={item.canal.nome} categoria={item.canal.categoria} size={32} />
                <div style={{ minWidth: 110, flexShrink: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#bbb" }}>{item.canal.nome}</div>
                  <div style={{ fontSize: 10, color: "#475569" }}>{item.canal.categoria}</div>
                </div>
                {emAnd && <div style={{ fontSize: 10, fontWeight: 700, color: corCanal, background: corCanal + "20", padding: "2px 7px", borderRadius: 20 }}>AO VIVO</div>}
                <span style={{ fontSize: 13, color: "#64748b", flexShrink: 0 }}>{formatHora(item.prog.start)} – {formatHora(item.prog.stop)}</span>
                <span style={{ fontSize: 11, color: "#374151", flexShrink: 0, marginLeft: "auto" }}>{item.prog.duracao_min} min</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "#94a3b8" }}>Resultados para <span style={{ color: "#f1f5f9", fontWeight: 600 }}>"{busca}"</span></div>
        <button onClick={onClear} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#111", border: "1px solid #1e1e2e", borderRadius: 8, color: "#475569", fontSize: 12, cursor: "pointer" }}><X size={13} /> Limpar</button>
      </div>
      {canaisMatch.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>📺 Canais ({canaisMatch.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {canaisMatch.map(canal => {
              const cor = CAT_COR[canal.categoria] || "#6b7280";
              const progsCanal = progsPorCanal.get(canal.id) || [];
              const atual = progsCanal.find(p => agora >= new Date(p.start).getTime() && agora <= new Date(p.stop).getTime());
              return (
                <div key={canal.id} onClick={() => setDetalhe({ tipo: "canal", canal })}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8, cursor: "pointer", background: "#0f0f0f", border: "1px solid #1a1a1a" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "#161616"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "#0f0f0f"; }}>
                  <Logo src={canal.icon} nome={canal.nome} categoria={canal.categoria} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{canal.nome}</div>
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{canal.categoria}{atual ? ` · ${atual.title}` : ""}</div>
                  </div>
                  <span style={{ fontSize: 11, color: "#374151" }}>Ver →</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {programasMatch.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>🎬 Programas ({programasMatch.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {programasMatch.map(({ titulo, items }) => {
              const emAr = items.some(i => agora >= new Date(i.prog.start).getTime() && agora <= new Date(i.prog.stop).getTime());
              return (
                <div key={titulo} onClick={() => setDetalhe({ tipo: "programa", titulo })}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8, cursor: "pointer", background: emAr ? "#6366f112" : "#0f0f0f", border: `1px solid ${emAr ? "#6366f140" : "#1a1a1a"}` }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = emAr ? "#6366f120" : "#161616"}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = emAr ? "#6366f112" : "#0f0f0f"}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {emAr && <div style={{ fontSize: 10, fontWeight: 700, color: "#6366f1", background: "#6366f120", padding: "2px 7px", borderRadius: 20 }}>AO VIVO</div>}
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{titulo}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{items.length} canal(is)</div>
                  </div>
                  <span style={{ fontSize: 11, color: "#374151" }}>Ver →</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {canaisMatch.length === 0 && programasMatch.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#374151" }}>
          <Search size={24} style={{ margin: "0 auto 10px", display: "block", opacity: 0.3 }} />
          <div style={{ fontSize: 13 }}>Nenhum resultado para "{busca}"</div>
        </div>
      )}
    </div>
  );
}

// ─── Aba Canais ───────────────────────────────────────────────────────────────
function AbaCanais({ epg, progsPorCanal }: { epg: EpgData; progsPorCanal: Map<string, Programa[]> }) {
  const [catAtiva, setCatAtiva] = useState("Todos");
  const [subAtiva, setSubAtiva] = useState("Todos");
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  const [catOpen, setCatOpen] = useState(false);
  const catRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function h(e: MouseEvent) { if (catRef.current && !catRef.current.contains(e.target as Node)) setCatOpen(false); }
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);

  const catsDisponiveis = useMemo(() => {
    const s = new Set(epg.canais.map(c => c.categoria));
    return CATS_ORDEM.filter(c => s.has(c));
  }, [epg]);

  const canaisFiltrados = useMemo(() => {
    let lista = epg.canais;
    if (catAtiva !== "Todos") lista = lista.filter(c => c.categoria === catAtiva);
    if (subAtiva !== "Todos") {
      const sg = (SUBGRUPOS[catAtiva] || []).find(s => s.label === subAtiva);
      if (sg) lista = lista.filter(c => sg.match.some(m => c.display_name.toUpperCase().includes(m)));
    }
    return lista;
  }, [epg, catAtiva, subAtiva]);

  const emBusca = buscaAtiva.trim().length > 0;
  const subgruposDisponiveis = SUBGRUPOS[catAtiva] || [];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Filtros canais */}
      <div style={{ flexShrink: 0, background: "#13151f", borderBottom: "1px solid #1e2130" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", flexWrap: "wrap" }}>
          {/* Dropdown categoria */}
          <div ref={catRef} style={{ position: "relative" }}>
            <button onClick={() => setCatOpen(o => !o)}
              style={{ display: "flex", alignItems: "center", gap: 5, height: 34, padding: "0 10px", background: catAtiva !== "Todos" ? (CAT_COR[catAtiva] + "20") : "#1a1d2e", border: `1px solid ${catAtiva !== "Todos" ? CAT_COR[catAtiva] + "50" : "#252840"}`, borderRadius: 7, cursor: "pointer", color: catAtiva !== "Todos" ? CAT_COR[catAtiva] : "#94a3b8", fontSize: 12, fontWeight: catAtiva !== "Todos" ? 600 : 400, whiteSpace: "nowrap" }}>
              {catAtiva === "Todos" ? "Categoria" : `${CAT_EMOJI[catAtiva]} ${catAtiva}`}
              <ChevronDown size={12} style={{ opacity: 0.6, transform: catOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
            </button>
            {catOpen && (
              <div onClick={() => setCatOpen(false)} style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, minWidth: 200, background: "#13151f", border: "1px solid #1e2130", borderRadius: 10, zIndex: 200, overflow: "hidden", boxShadow: "0 12px 40px rgba(0,0,0,0.7)", maxHeight: 280, overflowY: "auto" }}>
                {[{ value: "Todos", label: "📡 Todas" }, ...catsDisponiveis.map(c => ({ value: c, label: `${CAT_EMOJI[c]} ${c}` }))].map(opt => (
                  <button key={opt.value} onClick={() => { setCatAtiva(opt.value); setSubAtiva("Todos"); }}
                    style={{ display: "block", width: "100%", padding: "8px 14px", background: catAtiva === opt.value ? "#1e2130" : "none", border: "none", textAlign: "left", cursor: "pointer", color: catAtiva === opt.value ? "#f1f5f9" : "#94a3b8", fontSize: 13, borderLeft: `3px solid ${catAtiva === opt.value ? (CAT_COR[opt.value] || "#6366f1") : "transparent"}` }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Subgrupo */}
          {subgruposDisponiveis.length > 0 && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {subgruposDisponiveis.map(sg => (
                <button key={sg.label} onClick={() => setSubAtiva(s => s === sg.label ? "Todos" : sg.label)}
                  style={{ padding: "4px 10px", borderRadius: 20, border: `1px solid ${subAtiva === sg.label ? CAT_COR[catAtiva] || "#6366f1" : "#252840"}`, background: subAtiva === sg.label ? (CAT_COR[catAtiva] || "#6366f1") + "20" : "transparent", color: subAtiva === sg.label ? CAT_COR[catAtiva] || "#6366f1" : "#64748b", fontSize: 11, cursor: "pointer" }}>
                  {sg.label}
                </button>
              ))}
            </div>
          )}

          {/* Busca */}
          <div style={{ position: "relative", flex: 1, minWidth: 120 }}>
            <Search size={12} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "#475569", pointerEvents: "none" }} />
            <input value={busca} onChange={e => { setBusca(e.target.value); if (!e.target.value.trim()) setBuscaAtiva(""); }}
              onKeyDown={e => e.key === "Enter" && setBuscaAtiva(busca.trim())}
              placeholder="Buscar..." style={{ width: "100%", height: 34, paddingLeft: 26, paddingRight: busca ? 26 : 8, background: "#1a1d2e", border: `1px solid ${emBusca ? "#6366f1" : "#252840"}`, borderRadius: 7, fontSize: 12, color: "#e2e8f0", outline: "none", boxSizing: "border-box" }} />
            {busca && <button onClick={() => { setBusca(""); setBuscaAtiva(""); }} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#475569", display: "flex" }}><X size={11} /></button>}
          </div>
          <button onClick={() => setBuscaAtiva(busca.trim())}
            style={{ height: 34, padding: "0 12px", background: "#6366f1", border: "none", borderRadius: 7, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>Buscar</button>
        </div>
      </div>

      {emBusca
        ? <div style={{ flex: 1, overflowY: "auto" }}><ResultadoBuscaEPG epg={epg} busca={buscaAtiva} progsPorCanal={progsPorCanal} onClear={() => { setBusca(""); setBuscaAtiva(""); }} /></div>
        : canaisFiltrados.length === 0
          ? <div style={{ textAlign: "center", padding: 60, color: "#374151", fontSize: 13 }}>Nenhum canal encontrado.</div>
          : <GradeEPG canais={canaisFiltrados} progsPorCanal={progsPorCanal} />
      }
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
// ADMIN: servidorAdmin = "TODOS" (vê filtro de servidor)
// Cliente: servidorAdmin = "ELITE" | "NATV" | "FAST" (travado no servidor dele)
const SERVIDOR_ADMIN: ServidorId | "TODOS" = "TODOS";

type Tab = "canais" | "filmes" | "series";

export default function GuiaTVPage() {
  const [tab, setTab] = useState<Tab>("canais");
  const [epg, setEpg] = useState<EpgData | null>(null);
  const [loadingEpg, setLoadingEpg] = useState(true);
  const [erroEpg, setErroEpg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ tipo: "ok" | "err"; texto: string } | null>(null);
  const [showCatalogo, setShowCatalogo] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [notifCount] = useState(0); // TODO: integrar com AdminShell notifications

  // EPG
  useEffect(() => {
    setLoadingEpg(true); setErroEpg(null);
    fetch(`${process.env.NEXT_PUBLIC_R2_DEV_URL}/epg/epg_br.json?t=${Date.now()}`, { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setEpg)
      .catch(() => setErroEpg("Grade não encontrada. Rode o Sync EPG."))
      .finally(() => setLoadingEpg(false));
  }, []);

  const progsPorCanal = useMemo(() => {
    if (!epg) return new Map<string, Programa[]>();
    const map = new Map<string, Programa[]>();
    const brtMs = Date.now() - 3 * 3600000;
    const ini = brtMs - 6 * 3600000, fim = brtMs + 24 * 3600000;
    for (const p of epg.programas) {
      const s = new Date(p.start).getTime(), e = new Date(p.stop).getTime();
      if (e < ini || s > fim) continue;
      const arr = map.get(p.channel_id) || []; arr.push(p); map.set(p.channel_id, arr);
    }
    return map;
  }, [epg]);

  async function handleSync() {
    setSyncing(true); setSyncMsg(null);
    try {
      const d = await fetch("/api/epg/sync", { method: "POST" }).then(r => r.json());
      if (d.ok) { setSyncMsg({ tipo: "ok", texto: `EPG sincronizado em ${d.duracao_s}s` }); setTimeout(() => window.location.reload(), 1800); }
      else setSyncMsg({ tipo: "err", texto: d.error || "Sync falhou" });
    } catch (e: any) { setSyncMsg({ tipo: "err", texto: e.message }); }
    finally { setSyncing(false); }
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "canais",  label: "Canais",  icon: <Tv size={15} /> },
    { id: "filmes",  label: "Filmes",  icon: <Film size={15} /> },
    { id: "series",  label: "Séries",  icon: <Clapperboard size={15} /> },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 57px)", background: "#0f1117", color: "#cbd5e1", overflow: "hidden" }}>

      {/* ── Top bar própria da Guia TV ─────────────────────────────────────── */}
      <div style={{ flexShrink: 0, background: "#050505", borderBottom: "1px solid #ffffff10", zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 0, padding: "0 12px", height: 48 }}>

          {/* Logo com badge de notificação */}
          <a href="/admin" style={{ position: "relative", display: "flex", alignItems: "center", marginRight: 8, flexShrink: 0 }}>
            <img src="/brand/logo-gestor-celular.png" alt="Gestor" style={{ height: 32, width: 32, objectFit: "contain" }} />
            {notifCount > 0 && (
              <div style={{ position: "absolute", top: -4, right: -4, background: "#ef4444", borderRadius: "50%", minWidth: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff", border: "2px solid #050505", padding: "0 3px" }}>
                {notifCount > 9 ? "9+" : notifCount}
              </div>
            )}
          </a>

          {/* Divisor */}
          <div style={{ width: 1, height: 24, background: "#ffffff15", marginRight: 10 }} />

          {/* Tabs centrais */}
          <div style={{ display: "flex", flex: 1, justifyContent: "center", gap: 4 }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, border: tab === t.id ? "1px solid #6366f140" : "1px solid transparent", background: tab === t.id ? "#6366f115" : "transparent", color: tab === t.id ? "#818cf8" : "#64748b", fontSize: 13, fontWeight: tab === t.id ? 600 : 400, cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap" }}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* Ações direita */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
            {tab === "canais" && (
              <button onClick={handleSync} disabled={syncing}
                style={{ display: "flex", alignItems: "center", gap: 4, height: 30, padding: "0 10px", background: syncing ? "#1a1d2e" : "#10b98115", border: `1px solid ${syncing ? "#252840" : "#10b98140"}`, borderRadius: 7, cursor: syncing ? "not-allowed" : "pointer", color: syncing ? "#374151" : "#10b981", fontSize: 11, fontWeight: 500, flexShrink: 0 }}>
                <RefreshCw size={11} style={{ animation: syncing ? "spin 1s linear infinite" : "none" }} />
                <span className="hidden sm:inline">EPG</span>
              </button>
            )}
            <button onClick={() => setShowCatalogo(true)}
              style={{ display: "flex", alignItems: "center", gap: 4, height: 30, padding: "0 10px", background: "#6366f115", border: "1px solid #6366f140", borderRadius: 7, cursor: "pointer", color: "#818cf8", fontSize: 11, fontWeight: 500, flexShrink: 0 }}>
              <Database size={11} /> <span style={{ display: "none" }}>Catálogo</span>
            </button>
            <button onClick={() => setShowMobileMenu(o => !o)}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, background: "transparent", border: "1px solid #1e2130", borderRadius: 7, cursor: "pointer", color: "#64748b" }}>
              <Menu size={15} />
            </button>
          </div>
        </div>

        {/* Mensagem sync EPG */}
        {syncMsg && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 16px", background: syncMsg.tipo === "ok" ? "#10b98115" : "#ef444415", borderTop: `1px solid ${syncMsg.tipo === "ok" ? "#10b98130" : "#ef444430"}`, fontSize: 12, color: syncMsg.tipo === "ok" ? "#10b981" : "#ef4444" }}>
            {syncMsg.tipo === "ok" ? <CheckCircle size={12} /> : <AlertTriangle size={12} />} {syncMsg.texto}
            <button onClick={() => setSyncMsg(null)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "inherit" }}><X size={11} /></button>
          </div>
        )}
      </div>

      {/* ── Menu mobile ──────────────────────────────────────────────────────── */}
      {showMobileMenu && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.7)" }} onClick={() => setShowMobileMenu(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ position: "absolute", top: 0, right: 0, width: 260, height: "100%", background: "#0f1117", borderLeft: "1px solid #1e2130", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 16px 10px" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>Menu</span>
              <button onClick={() => setShowMobileMenu(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}><X size={16} /></button>
            </div>
            <div style={{ padding: "0 8px" }}>
              {[
                { href: "/admin", label: "Dashboard", emoji: "🏠" },
                { href: "/admin/cliente", label: "Clientes", emoji: "👥" },
                { href: "/admin/teste", label: "Testes", emoji: "⏰" },
                { href: "/admin/revendedor", label: "Revendas", emoji: "🤝" },
                { href: "/admin/auditoria", label: "Log Portal", emoji: "📜" },
                { href: "/admin/gerenciador/servidor", label: "Servidores", emoji: "🖥️" },
                { href: "/admin/settings/profile", label: "Perfil", emoji: "👤" },
              ].map(item => (
                <a key={item.href} href={item.href}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, color: "#94a3b8", fontSize: 14, textDecoration: "none", marginBottom: 2 }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#13151f")}
                  onMouseLeave={e => (e.currentTarget.style.background = "none")}>
                  <span>{item.emoji}</span> {item.label}
                </a>
              ))}
              <div style={{ height: 1, background: "#1e2130", margin: "10px 12px" }} />
              <a href="/logout" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, color: "#ef4444", fontSize: 14, textDecoration: "none" }}>
                <span>🚪</span> Sair
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ── Conteúdo principal ────────────────────────────────────────────────── */}
      {tab === "canais" && (
        loadingEpg
          ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: 80, color: "#374151", fontSize: 13 }}><RefreshCw size={16} style={{ animation: "spin 1s linear infinite" }} />Carregando...</div>
          : erroEpg
            ? <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 80, textAlign: "center" }}>
              <AlertTriangle size={28} color="#f59e0b" />
              <div style={{ fontSize: 14, color: "#bbb" }}>Grade não encontrada</div>
              <div style={{ fontSize: 12, color: "#374151" }}>{erroEpg}</div>
              <button onClick={handleSync} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#10b98115", border: "1px solid #10b98130", borderRadius: 8, color: "#10b981", fontSize: 12, cursor: "pointer" }}><RefreshCw size={13} />Sync EPG</button>
            </div>
            : epg && <AbaCanais epg={epg} progsPorCanal={progsPorCanal} />
      )}

      {tab === "filmes" && <AbaCatalogo tipo="FILME" servidorAdmin={SERVIDOR_ADMIN} />}
      {tab === "series" && <AbaCatalogo tipo="SERIE" servidorAdmin={SERVIDOR_ADMIN} />}

      {/* Modal sync catálogo (mantido do original) */}
      {showCatalogo && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setShowCatalogo(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#13151f", border: "1px solid #1e2130", borderRadius: 14, width: "100%", maxWidth: 500, padding: 20, boxShadow: "0 24px 64px rgba(0,0,0,0.9)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", display: "flex", alignItems: "center", gap: 8 }}>
                <Database size={16} color="#6366f1" /> Gerenciar Catálogo
              </div>
              <button onClick={() => setShowCatalogo(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#475569" }}><X size={16} /></button>
            </div>
            <p style={{ fontSize: 13, color: "#475569", marginBottom: 16 }}>
              Use este painel para sincronizar o catálogo de filmes e séries dos servidores. O sync do Fast requer a extensão do Chrome instalada.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              {(["elite", "natv", "fast"] as const).map(srv => (
                <button key={srv} onClick={() => window.open(`/admin/gerenciador/guia-tv?sync=${srv}`, "_self")}
                  style={{ flex: 1, padding: "10px 0", background: "#1a1d2e", border: "1px solid #252840", borderRadius: 8, color: "#94a3b8", fontSize: 13, fontWeight: 600, cursor: "pointer", textTransform: "uppercase" }}>
                  {srv}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
        ::-webkit-scrollbar { width: 4px; height: 4px }
        ::-webkit-scrollbar-track { background: transparent }
        ::-webkit-scrollbar-thumb { background: #252840; border-radius: 2px }
        * { -webkit-tap-highlight-color: transparent }
      `}</style>
    </div>
  );
}
