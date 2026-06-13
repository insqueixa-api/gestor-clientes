"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, RefreshCw, AlertTriangle, CheckCircle,
  X, ChevronDown, Database, Star, ChevronLeft, ChevronRight, Film,
  Tv, Clapperboard, Swords, Laugh, Ghost, Heart, Eye, Rocket,
  Shield, Sparkles, Globe, Music2, Crosshair, BookOpen, Users,
  Baby, VideoIcon, Flame, Trophy, Clock, Compass, Sunset,
} from "lucide-react";

// ─── Ícone de categoria (slug → Lucide icon) ─────────────────────────────────
function CatIcon({slug,size=16,color="#64748b"}:{slug:string;size?:number;color?:string}) {
  const props={size,color,strokeWidth:1.8};
  switch(slug){
    case "anime":      return <Tv {...props}/>;
    case "dorama":     return <Tv {...props}/>;
    case "novela":     return <Heart {...props}/>;
    case "kids":       return <Baby {...props}/>;
    case "doc":        return <VideoIcon {...props}/>;
    case "action":     return <Flame {...props}/>;
    case "comedy":     return <Laugh {...props}/>;
    case "drama":      return <Film {...props}/>;
    case "horror":     return <Ghost {...props}/>;
    case "romance":    return <Heart {...props}/>;
    case "thriller":   return <Eye {...props}/>;
    case "scifi":      return <Rocket {...props}/>;
    case "superhero":  return <Shield {...props}/>;
    case "new":        return <Sparkles {...props}/>;
    case "national":   return <Globe {...props}/>;
    case "4k":         return <Star {...props}/>;
    case "war":        return <Swords {...props}/>;
    case "western":    return <Compass {...props}/>;
    case "family":     return <Users {...props}/>;
    case "animation":  return <Clapperboard {...props}/>;
    case "music":      return <Music2 {...props}/>;
    case "crime":      return <Crosshair {...props}/>;
    case "history":    return <BookOpen {...props}/>;
    case "classic":    return <Clock {...props}/>;
    case "reality":    return <Trophy {...props}/>;
    case "adventure":  return <Sunset {...props}/>;
    case "fantasy":    return <Sparkles {...props}/>;
    case "mystery":    return <Eye {...props}/>;
    case "religious":  return <BookOpen {...props}/>;
    case "sport":      return <Trophy {...props}/>;
    case "biography":  return <BookOpen {...props}/>;
    default:           return <Film {...props}/>;
  }
}

// ─── Tipos EPG ────────────────────────────────────────────────────────────────
type Canal = { id: string; display_name: string; nome: string; categoria: string; icon: string; servidor: string; };
type Programa = { channel_id: string; channel_nome: string; categoria: string; start: string; stop: string; duracao_min: number; title: string; desc: string; prog_icon?: string; };
type EpgData = { gerado_em: string; total_canais: number; total_programas: number; canais: Canal[]; programas: Programa[]; };

// ─── Tipos Catálogo ───────────────────────────────────────────────────────────
type TipoConteudo = "FILME" | "SERIE";
type ServidorId   = "ELITE" | "NATV" | "FAST";
type TituloCard = {
  id: string; titulo_normalizado: string; tipo: TipoConteudo;
  cover_url: string | null; poster_tmdb_url: string | null;
  ano: number | null; sinopse: string | null; avaliacao: number | null;
  generos: string[] | null; total_temporadas: number; total_episodios: number;
  tmdb_confirmado: boolean; categoria_origem?: string; adicionado_em?: string;
};
type TituloBusca = TituloCard & { rotas: { servidor: string; categoria: string }[]; };
type Categoria = { categoria_origem: string; label: string; emoji: string; total: number; };
type Detalhe = TituloCard & {
  tmdb_id: number | null;
  disponibilidade: { servidor: string; categoria_origem: string; adicionado_em: string; sincronizado_em: string }[];
  temporadas: { temporada: number; total_episodios: number; servidores: string[] }[];
};
type SrvId = "elite" | "natv" | "fast";
type SrvStatus = "idle" | "running" | "ok" | "error";
type CatalogInfo = { ultimo_sync: string | null; filmes: number; series_unicas: number; episodios: number; };

// ─── Constantes EPG ───────────────────────────────────────────────────────────
const CATS_ORDEM = ["Aberta","Notícias","Esportes","Filmes","Variedades","Documentários","Infantil","Música","Regional","Religioso","Outros"];
const CAT_COR: Record<string,string> = { "Aberta":"#3b82f6","Notícias":"#ef4444","Esportes":"#10b981","Filmes":"#f59e0b","Variedades":"#8b5cf6","Documentários":"#06b6d4","Infantil":"#ec4899","Música":"#6366f1","Regional":"#84cc16","Religioso":"#f97316","Outros":"#6b7280" };
const CAT_EMOJI: Record<string,string> = { "Aberta":"📺","Notícias":"📰","Esportes":"⚽","Filmes":"🎬","Variedades":"🎭","Documentários":"🌍","Infantil":"🧒","Música":"🎵","Regional":"🗺️","Religioso":"✝️","Outros":"📡" };
const SUBGRUPOS: Record<string,{label:string;match:string[]}[]> = {
  "Esportes":[{label:"SporTV",match:["SPORTV","SPORT TV"]},{label:"Premiere",match:["PREMIERE"]},{label:"ESPN",match:["ESPN"]},{label:"Combate",match:["COMBATE"]},{label:"BandSports",match:["BANDSPORT"]},{label:"DAZN",match:["DAZN"]}],
  "Filmes":[{label:"Telecine",match:["TELECINE"]},{label:"HBO",match:["HBO"]},{label:"TNT",match:["TNT"]},{label:"Universal",match:["UNIVERSAL"]},{label:"Warner",match:["WARNER"]},{label:"Paramount",match:["PARAMOUNT"]},{label:"Megapix",match:["MEGAPIX"]}],
  "Infantil":[{label:"Cartoon",match:["CARTOON"]},{label:"Disney",match:["DISNEY"]},{label:"Nick",match:["NICK","NICKELODEON"]},{label:"Gloob",match:["GLOOB"]}],
};

const PX_POR_MIN = 4;
const HORA_WIDTH = 60 * PX_POR_MIN;
const CANAL_COL_W = 180;
const LINHA_H = 72;
const REGUA_H = 34;
const TOTAL_HORAS = 48;
const COR_SERVIDOR: Record<string, string> = { ELITE: "#6366f1", NATV: "#10b981", FAST: "#06b6d4" };

// Filtra categorias lixo do Elite (SERIES A, SERIES B, etc com < 20 títulos)
function isCategoriaPrincipal(cat: string, total: number): boolean {
  if (/^SERIES [A-Z0-9]$/i.test(cat) && total < 20) return false;
  if (/^SERIES 0 a 9$/i.test(cat)) return false;
  return true;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function nowBRT(): Date { return new Date(); }
function formatHora(iso: string) { return new Date(iso).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}); }
function formatDataHora(iso: string) { return new Date(iso).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}); }
function iniciais(nome: string) { return nome.split(" ").filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase(); }
function normalizar(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
}

// ─── Logo canal ───────────────────────────────────────────────────────────────
function Logo({src,nome,categoria,size=32}:{src?:string;nome:string;categoria?:string;size?:number}) {
  const [err,setErr]=useState(false);
  const cor=CAT_COR[categoria||""]||"#6b7280";
  if(!src||err) return <div style={{width:size,height:size,flexShrink:0,borderRadius:7,background:cor+"20",border:`1.5px solid ${cor}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.3,fontWeight:700,color:cor,userSelect:"none"}}>{iniciais(nome)}</div>;
  return <img src={src} alt={nome} onError={()=>setErr(true)} style={{width:size,height:size,flexShrink:0,objectFit:"contain",borderRadius:7,background:"#111",border:"1px solid #ffffff10"}} />;
}

// ─── Tooltip programa ─────────────────────────────────────────────────────────
function ProgramaTooltip({prog,onClose}:{prog:Programa;onClose:()=>void}) {
  return (
    <div style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#161616",border:"1px solid #2a2a2a",borderRadius:14,overflow:"hidden",maxWidth:460,width:"100%"}}>
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

// ─── Grade EPG ────────────────────────────────────────────────────────────────
function GradeEPG({canais,progsPorCanal}:{canais:Canal[];progsPorCanal:Map<string,Programa[]>}) {
  const scrollRef=useRef<HTMLDivElement>(null);
  const [agora,setAgora]=useState(nowBRT);
  const [progSel,setProgSel]=useState<Programa|null>(null);
  const [showNomes,setShowNomes]=useState(true);
  useEffect(()=>{const iv=setInterval(()=>setAgora(nowBRT()),60000);return()=>clearInterval(iv);},[]);
  const gradeWidth=TOTAL_HORAS*HORA_WIDTH;
  const baseMs=useMemo(()=>{const a=new Date();const m=new Date(a);m.setUTCHours(3,0,0,0);if(m.getTime()>a.getTime())m.setUTCDate(m.getUTCDate()-1);return m.getTime();},[]);
  const agoraOffsetPx=useMemo(()=>((agora.getTime()-baseMs)/60000)*PX_POR_MIN,[agora,baseMs]);
  const horaLabels=useMemo(()=>Array.from({length:TOTAL_HORAS+1},(_,i)=>({x:i*HORA_WIDTH,label:new Date(baseMs+i*3600000).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})})),[baseMs]);
  const canalW=showNomes?CANAL_COL_W:60;
  useEffect(()=>{if(scrollRef.current&&agoraOffsetPx>0)scrollRef.current.scrollLeft=Math.max(0,agoraOffsetPx-2*HORA_WIDTH);},[agoraOffsetPx]);
  return (
    <>
      {progSel&&<ProgramaTooltip prog={progSel} onClose={()=>setProgSel(null)}/>}
      <div ref={scrollRef} style={{overflowX:"auto",overflowY:"auto",background:"#0f1117",flex:1,minHeight:0}}>
        <div style={{display:"inline-block",width:canalW+gradeWidth}}>
          <div style={{position:"sticky",top:0,zIndex:30,display:"flex",height:REGUA_H,background:"#13151f",borderBottom:"1px solid #1e2130"}}>
            <div style={{width:canalW,flexShrink:0,position:"sticky",left:0,zIndex:31,background:"#13151f",borderRight:"1px solid #1e2130",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <button onClick={()=>setShowNomes(v=>!v)} style={{background:"none",border:"none",cursor:"pointer",color:"#475569",fontSize:10,padding:"2px 6px"}}>{showNomes?"◀":"▶"}</button>
            </div>
            <div style={{position:"relative",width:gradeWidth,flexShrink:0}}>
              {horaLabels.map((h,i)=>(<div key={i} style={{position:"absolute",left:h.x,top:0,height:"100%",display:"flex",alignItems:"center",paddingLeft:8,borderLeft:i>0?"1px solid #1e2130":"none"}}><span style={{fontSize:11,color:"#4a5568",whiteSpace:"nowrap"}}>{h.label}</span></div>))}
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
                  {progs.length===0&&Array.from({length:Math.ceil(TOTAL_HORAS/2)},(_,i)=>(<div key={i} style={{position:"absolute",left:i*2*HORA_WIDTH+1,width:2*HORA_WIDTH-6,top:5,bottom:5,borderRadius:5,background:"#141624",border:"1px solid #1e2130",display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:13,color:"#64748b",fontWeight:500}}>Sem informação</span></div>))}
                  {progs.map(prog=>{
                    const sMs=new Date(prog.start).getTime(),eMs=new Date(prog.stop).getTime();
                    const lRaw=((sMs-baseMs)/60000)*PX_POR_MIN,wRaw=Math.max(((eMs-sMs)/60000)*PX_POR_MIN-2,4);
                    const lPx=Math.max(lRaw,0),wPx=Math.max(wRaw-(lPx-lRaw),20);
                    const isAtual=agoraBrtMs>=sMs&&agoraBrtMs<=eMs;
                    return (
                      <div key={prog.start} onClick={()=>setProgSel(prog)}
                        style={{position:"absolute",left:lPx+1,width:wPx-2,top:5,bottom:5,borderRadius:5,cursor:"pointer",background:isAtual?cor+"22":"#1a1d2e",border:`1px solid ${isAtual?cor+"50":"#252840"}`,clipPath:"inset(0 round 5px)",display:"flex",alignItems:"center",transition:"background 0.1s"}}
                        onMouseEnter={e=>{(e.currentTarget as HTMLDivElement).style.background=isAtual?cor+"35":"#1e2130";}}
                        onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.background=isAtual?cor+"22":"#1a1d2e";}}>
                        <div style={{position:"sticky",left:canalW,display:"flex",alignItems:"center",height:"100%",minWidth:0,maxWidth:"100%"}}>
                          {prog.prog_icon&&wPx>90&&<img src={prog.prog_icon} alt="" style={{height:"100%",width:"auto",maxWidth:Math.min(wPx*0.28,52),objectFit:"cover",flexShrink:0,opacity:0.8}}/>}
                          <div style={{flex:1,minWidth:0,display:"flex",alignItems:isAtual?"flex-start":"center",gap:5,padding:"4px 7px"}}>
                            {isAtual&&<div style={{width:5,height:5,borderRadius:"50%",background:cor,flexShrink:0,marginTop:3}}/>}
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

// ─── Modal Catálogo (idêntico ao original) ────────────────────────────────────
function LimparCatalogo() {
  const [limpando, setLimpando] = React.useState(false);
  const [preview, setPreview] = React.useState<Record<string,number>|null>(null);
  const [limpezaOk, setLimpezaOk] = React.useState<Record<string,number>|null>(null);
  const [srvLimpar, setSrvLimpar] = React.useState<string>("TODOS");
  const [showLimpar, setShowLimpar] = React.useState(false);

  async function carregarPreview() {
    setShowLimpar(true); setPreview(null); setLimpezaOk(null);
    const d = await fetch("/api/catalogo/limpar").then(r=>r.json()).catch(()=>null);
    if (d?.ok) setPreview(d.preview);
  }

  async function executarLimpeza() {
    setLimpando(true);
    const d = await fetch("/api/catalogo/limpar", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({servidor: srvLimpar})
    }).then(r=>r.json()).catch(()=>null);
    if (d?.ok) setLimpezaOk(d.resultado);
    setLimpando(false); setShowLimpar(false);
  }

  return (
    <div style={{background:"#0f1117",border:`1px solid ${limpezaOk?"#10b98140":"#1e2130"}`,borderRadius:10,padding:14}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:limpezaOk?"#10b981":"#374151"}}/>
            <span style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>Limpar Removidos</span>
          </div>
          <div style={{fontSize:11,color:"#374151",marginTop:4,paddingLeft:15}}>
            Remove títulos que saíram dos servidores desde o último sync
          </div>
          {limpezaOk&&(
            <div style={{fontSize:11,color:"#10b981",marginTop:4,paddingLeft:15}}>
              ✓ {Object.entries(limpezaOk).map(([s,n])=>`${s}: ${n} removidos`).join(" · ")}
            </div>
          )}
        </div>
        <button
          onClick={showLimpar ? ()=>setShowLimpar(false) : carregarPreview}
          disabled={limpando}
          style={{display:"flex",alignItems:"center",justifyContent:"center",gap:5,padding:"6px 12px",width:130,background:limpando?"#1a1d2e":"#ef444420",border:`1px solid ${limpando?"#252840":"#ef444450"}`,borderRadius:7,color:limpando?"#374151":"#ef4444",fontSize:12,fontWeight:600,cursor:limpando?"not-allowed":"pointer",flexShrink:0}}>
          <X size={11}/>{limpando?"Limpando...":showLimpar?"Cancelar":"Limpar"}
        </button>
      </div>
      {showLimpar&&(
        <div style={{marginTop:10,padding:"10px 12px",background:"#080808",borderRadius:6,border:"1px solid #141414"}}>
          <div style={{fontSize:11,color:"#64748b",marginBottom:8}}>Servidor alvo:</div>
          <div style={{display:"flex",background:"#1a1d2e",padding:3,borderRadius:6,gap:3,marginBottom:10}}>
            {["TODOS","ELITE","NATV","FAST"].map(s=>(
              <button key={s} onClick={()=>setSrvLimpar(s)}
                style={{padding:"4px 10px",background:srvLimpar===s?"#ef4444":"transparent",color:srvLimpar===s?"#fff":"#64748b",border:"none",borderRadius:5,fontSize:11,fontWeight:600,cursor:"pointer"}}>
                {s}
              </button>
            ))}
          </div>
          {preview
            ? <div style={{fontSize:11,color:"#64748b",marginBottom:10}}>
                {srvLimpar==="TODOS"
                  ? Object.entries(preview).map(([s,n])=>`${s}: ${n} títulos`).join(" · ")
                  : `${srvLimpar}: ${preview[srvLimpar]||0} títulos serão removidos`}
              </div>
            : <div style={{fontSize:11,color:"#374151",marginBottom:10}}>Carregando preview...</div>
          }
          <button onClick={executarLimpeza} disabled={limpando}
            style={{padding:"5px 16px",background:"#ef4444",border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:limpando?"not-allowed":"pointer"}}>
            Confirmar limpeza
          </button>
        </div>
      )}
    </div>
  );
}

function ModalCatalogo({onClose}:{onClose:()=>void}) {
  const [status,setStatus]=useState<Record<SrvId,SrvStatus>>({elite:"idle",natv:"idle",fast:"idle"});
  const [logs,setLogs]=useState<Record<SrvId,string[]>>({elite:[],natv:[],fast:[]});
  const [info,setInfo]=useState<Record<SrvId,CatalogInfo|null>>({elite:null,natv:null,fast:null});
  const addLog=(srv:SrvId,msg:string)=>setLogs(p=>({...p,[srv]:[...p[srv],msg]}));
  useEffect(()=>{(["elite","natv","fast"] as SrvId[]).forEach(async srv=>{try{const d=await fetch(`/api/epg/sync-catalog/${srv}`).then(r=>r.json());if(d.resultado){setInfo(p=>({...p,[srv]:{ultimo_sync:d.executado_em||null,filmes:d.resultado.filmes||0,series_unicas:d.resultado.series_unicas||d.resultado.series||0,episodios:d.resultado.episodios||0}}));}}catch{}});},[]);
  async function syncElite(){setStatus(p=>({...p,elite:"running"}));setLogs(p=>({...p,elite:[]}));addLog("elite","↑ Conectando ao servidor Elite...");try{const d=await fetch("/api/epg/sync-catalog/elite",{method:"POST"}).then(r=>r.json());if(d.error)throw new Error(d.error);addLog("elite",`✓ Filmes: ${d.filmes??0}`);addLog("elite",`✓ Séries únicas: ${d.series_unicas??0}`);addLog("elite",`✓ Episódios: ${d.episodios??0}`);addLog("elite",`✓ Novos títulos: ${d.novos_titulos??0}`);addLog("elite",`✓ Novos episódios: ${d.novos_episodios??0}`);addLog("elite",`✅ Concluído em ${d.duracao_s}s`);setInfo(p=>({...p,elite:{ultimo_sync:new Date().toISOString(),filmes:d.filmes??0,series_unicas:d.series_unicas??0,episodios:d.episodios??0}}));setStatus(p=>({...p,elite:"ok"}));}catch(e:any){addLog("elite",`❌ ${e.message}`);setStatus(p=>({...p,elite:"error"}));}}
  async function syncNaTV(){setStatus(p=>({...p,natv:"running"}));setLogs(p=>({...p,natv:[]}));addLog("natv","↑ Conectando ao servidor NaTV...");try{const d=await fetch("/api/epg/sync-catalog/natv",{method:"POST"}).then(r=>r.json());if(d.error)throw new Error(d.error);addLog("natv",`✓ Filmes: ${d.filmes??0}`);addLog("natv",`✓ Séries únicas: ${d.series_unicas??0}`);addLog("natv",`✓ Episódios: ${d.episodios??0}`);addLog("natv",`✓ Novos títulos: ${d.novos_titulos??0}`);addLog("natv",`✓ Novos episódios: ${d.novos_episodios??0}`);addLog("natv",`✅ Concluído em ${d.duracao_s}s`);setInfo(p=>({...p,natv:{ultimo_sync:new Date().toISOString(),filmes:d.filmes??0,series_unicas:d.series_unicas??0,episodios:d.episodios??0}}));setStatus(p=>({...p,natv:"ok"}));}catch(e:any){addLog("natv",`❌ ${e.message}`);setStatus(p=>({...p,natv:"error"}));}}
  async function syncFast(){setStatus(p=>({...p,fast:"running"}));setLogs(p=>({...p,fast:[]}));addLog("fast","⬇ Buscando URL M3U...");try{const res=await fetch("/api/epg/sync-catalog/fast");const data=await res.json();if(!data.m3u_url)throw new Error("URL M3U não encontrada.");addLog("fast","⬇ Baixando M3U via extensão...");function onResult(e:Event){const detail=(e as CustomEvent).detail;window.removeEventListener("UNIGESTOR_INTEGRATION_RESPONSE",onResult);if(!detail?.ok){addLog("fast",`❌ ${detail?.error||"Erro desconhecido"}`);setStatus(p=>({...p,fast:"error"}));return;}addLog("fast","↑ Processando em background...");}window.addEventListener("UNIGESTOR_INTEGRATION_RESPONSE",onResult);async function onDone(e:Event){const detail=(e as CustomEvent).detail;if(detail?.action!=="FAST_VOD_SYNC_RESULT")return;window.removeEventListener("UNIGESTOR_BACKGROUND_MESSAGE",onDone as any);if(!detail.ok){addLog("fast",`❌ ${detail.error}`);setStatus(p=>({...p,fast:"error"}));return;}addLog("fast",`✓ Filmes: ${detail.filmes??0}`);addLog("fast",`✓ Séries: ${detail.series??0}`);addLog("fast",`✓ Episódios: ${detail.episodios??0}`);try{const log=await fetch("/api/epg/sync-catalog/fast").then(r=>r.json());if(log.resultado?.novos_titulos!==undefined){addLog("fast",`✓ Novos títulos: ${log.resultado.novos_titulos}`);addLog("fast",`✓ Novos episódios: ${log.resultado.novos_episodios}`);}}catch{}addLog("fast","✅ Concluído!");setInfo(p=>({...p,fast:{ultimo_sync:new Date().toISOString(),filmes:detail.filmes??0,series_unicas:detail.series??0,episodios:detail.episodios??0}}));setStatus(p=>({...p,fast:"ok"}));}window.addEventListener("UNIGESTOR_BACKGROUND_MESSAGE",onDone);window.dispatchEvent(new CustomEvent("UNIGESTOR_INTEGRATION_CALL",{detail:{action:"FAST_VOD_SYNC",m3uUrl:data.m3u_url.replace(/&output=ts$/i,"").replace(/&output=ts&/i,"&"),apiBase:window.location.origin}}));}catch(e:any){addLog("fast",`❌ ${e.message}`);setStatus(p=>({...p,fast:"error"}));}}
  const SERVIDORES:{id:SrvId;label:string;cor:string;onSync:()=>void}[]=[{id:"elite",label:"EliteTV",cor:"#6366f1",onSync:syncElite},{id:"natv",label:"NaTV",cor:"#10b981",onSync:syncNaTV},{id:"fast",label:"FastTV",cor:"#06b6d4",onSync:syncFast}];
  const [tmdbStatus,setTmdbStatus]=useState<"idle"|"running"|"ok"|"error">("idle");
  const [tmdbLogs,setTmdbLogs]=useState<string[]>([]);
  const [tmdbLote,setTmdbLote]=useState<number>(50);
  const [tmdbInfo,setTmdbInfo]=useState<{filmes:{sem_tmdb:number;com_tmdb:number};series:{sem_tmdb:number;com_tmdb:number}}|null>(null);
  const [tmdbConfirm,setTmdbConfirm]=useState(false);
  const [tmdbTipo,setTmdbTipo]=useState<"FILME"|"SERIE">("FILME");
  const addTmdbLog=(msg:string)=>setTmdbLogs(p=>[...p,msg]);
  useEffect(()=>{fetch("/api/epg/sync-tmdb").then(r=>r.json()).then(d=>{if(d.filmes)setTmdbInfo(d);}).catch(()=>{});},[]);
  async function syncTmdb(){setTmdbStatus("running");setTmdbLogs([]);setTmdbConfirm(false);let loteNum=1,totalProc=0,totalEnc=0,totalNao=0;addTmdbLog(`↑ Iniciando — ${tmdbTipo==="FILME"?"Filmes":"Séries"} · lote ${tmdbLote}`);try{while(true){const d=await fetch(`/api/epg/sync-tmdb?tipo=${tmdbTipo}&lote=${tmdbLote}`,{method:"POST"}).then(r=>r.json());if(d.error)throw new Error(d.error);if(d.processados===0){addTmdbLog("✅ Todos os títulos já foram processados!");break;}totalProc+=d.processados;totalEnc+=d.encontrados;totalNao+=d.nao_encontrados;loteNum++;setTmdbLogs(p=>{const n=[...p];n[n.length-1]=`↻ Lote ${loteNum-1} · ${totalProc} processados · ${totalEnc} encontrados · ${totalNao} não encontrados`;return n;});if(!d.proximo_lote){addTmdbLog(`✅ Concluído! ${totalProc} processados · ${totalEnc} encontrados · ${totalNao} não encontrados`);break;}const s=await fetch("/api/epg/sync-tmdb").then(r=>r.json());if(s.filmes)setTmdbInfo(s);await new Promise(r=>setTimeout(r,60_000));}const s=await fetch("/api/epg/sync-tmdb").then(r=>r.json());if(s.filmes)setTmdbInfo(s);setTmdbStatus("ok");}catch(e:any){addTmdbLog(`❌ ${e.message}`);setTmdbStatus("error");}}
  return (
    <div style={{position:"fixed",inset:0,zIndex:9998,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#13151f",border:"1px solid #1e2130",borderRadius:14,width:"100%",maxWidth:520,boxShadow:"0 24px 64px rgba(0,0,0,0.9)",overflow:"hidden",maxHeight:"90vh",display:"flex",flexDirection:"column"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:"1px solid #1e2130",flexShrink:0}}>
          <div><div style={{fontSize:15,fontWeight:700,color:"#f1f5f9",display:"flex",alignItems:"center",gap:8}}><Database size={16} color="#6366f1"/> Sincronizar Catálogo</div><div style={{fontSize:11,color:"#475569",marginTop:3}}>Filmes e séries — rode cada servidor individualmente</div></div>
          <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:"#475569"}}><X size={16}/></button>
        </div>
        <div style={{overflowY:"auto",flex:1,padding:16,display:"flex",flexDirection:"column",gap:12}}>
          {SERVIDORES.map(({id,label,cor,onSync})=>{const st=status[id],lg=logs[id],inf=info[id],running=st==="running";return(<div key={id} style={{background:"#0f1117",border:`1px solid ${st==="ok"?cor+"40":st==="error"?"#ef444430":"#1e2130"}`,borderRadius:10,padding:14}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}><div><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:7,height:7,borderRadius:"50%",background:st==="ok"?cor:st==="error"?"#ef4444":st==="running"?cor:"#374151",animation:st==="running"?"pulse 1s infinite":undefined}}/><span style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>{label}</span></div>{inf&&<div style={{fontSize:11,color:"#374151",marginTop:4,paddingLeft:15}}>{inf.ultimo_sync?`sync ${formatDataHora(inf.ultimo_sync)}`:"sem sync"} · {inf.filmes.toLocaleString()} filmes · {inf.series_unicas.toLocaleString()} séries · {inf.episodios.toLocaleString()} ep</div>}</div><button onClick={onSync} disabled={running} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:5,padding:"6px 12px",width:130,background:running?"#1a1d2e":cor+"20",border:`1px solid ${running?"#252840":cor+"50"}`,borderRadius:7,color:running?"#374151":cor,fontSize:12,fontWeight:600,cursor:running?"not-allowed":"pointer",flexShrink:0}}><RefreshCw size={11} style={{animation:running?"spin 1s linear infinite":"none"}}/>{running?"Rodando...":"Sincronizar"}</button></div>{lg.length>0&&<div style={{marginTop:10,padding:"8px 10px",background:"#080808",borderRadius:6,border:"1px solid #141414"}}>{lg.map((l,i)=><div key={i} style={{fontSize:11,color:l.startsWith("❌")?"#ef4444":l.startsWith("✅")?"#10b981":"#64748b",lineHeight:1.6}}>{l}</div>)}</div>}</div>);})}
          <div style={{background:"#0f1117",border:`1px solid ${tmdbStatus==="ok"?"#f59e0b40":tmdbStatus==="error"?"#ef444430":"#1e2130"}`,borderRadius:10,padding:14}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}><div><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:7,height:7,borderRadius:"50%",background:tmdbStatus==="ok"?"#f59e0b":tmdbStatus==="error"?"#ef4444":tmdbStatus==="running"?"#f59e0b":"#374151",animation:tmdbStatus==="running"?"pulse 1s infinite":undefined}}/><span style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>Enriquecimento TMDB</span></div>{tmdbInfo&&<div style={{fontSize:11,color:"#374151",marginTop:4,paddingLeft:15}}>Filmes: {tmdbInfo.filmes.com_tmdb.toLocaleString()} com TMDB · {tmdbInfo.filmes.sem_tmdb.toLocaleString()} faltando · Séries: {tmdbInfo.series.com_tmdb.toLocaleString()} com TMDB · {tmdbInfo.series.sem_tmdb.toLocaleString()} faltando</div>}</div><button onClick={()=>setTmdbConfirm(v=>!v)} disabled={tmdbStatus==="running"} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:5,padding:"6px 12px",width:130,background:tmdbStatus==="running"?"#1a1d2e":"#f59e0b20",border:`1px solid ${tmdbStatus==="running"?"#252840":"#f59e0b50"}`,borderRadius:7,color:tmdbStatus==="running"?"#374151":"#f59e0b",fontSize:12,fontWeight:600,cursor:tmdbStatus==="running"?"not-allowed":"pointer",flexShrink:0}}><RefreshCw size={11} style={{animation:tmdbStatus==="running"?"spin 1s linear infinite":"none"}}/>{tmdbStatus==="running"?"Rodando...":"Enriquecer"}</button></div>
            {tmdbConfirm&&tmdbStatus!=="running"&&<div style={{marginTop:10,padding:"10px 12px",background:"#13151f",borderRadius:8,border:"1px solid #252840"}}><div style={{fontSize:12,color:"#94a3b8",marginBottom:8}}>Configurar lote:</div><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}><div style={{display:"flex",background:"#1a1d2e",padding:3,borderRadius:6,gap:3}}><button onClick={()=>setTmdbTipo("FILME")} style={{padding:"4px 10px",background:tmdbTipo==="FILME"?"#f59e0b":"transparent",color:tmdbTipo==="FILME"?"#000":"#64748b",border:"none",borderRadius:5,fontSize:11,fontWeight:600,cursor:"pointer"}}>Filmes</button><button onClick={()=>setTmdbTipo("SERIE")} style={{padding:"4px 10px",background:tmdbTipo==="SERIE"?"#f59e0b":"transparent",color:tmdbTipo==="SERIE"?"#000":"#64748b",border:"none",borderRadius:5,fontSize:11,fontWeight:600,cursor:"pointer"}}>Séries</button></div><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:11,color:"#64748b"}}>Lote:</span><input type="number" min={5} max={100} value={tmdbLote} onChange={e=>setTmdbLote(Math.min(100,Math.max(5,parseInt(e.target.value)||5)))} style={{width:60,padding:"3px 6px",background:"#0f1117",border:"1px solid #252840",borderRadius:5,color:"#e2e8f0",fontSize:12,textAlign:"center"}}/><span style={{fontSize:10,color:"#374151"}}>(máx 100)</span></div><button onClick={syncTmdb} style={{marginLeft:"auto",padding:"5px 14px",background:"#f59e0b",border:"none",borderRadius:6,color:"#000",fontSize:12,fontWeight:700,cursor:"pointer"}}>Confirmar</button></div>{tmdbInfo&&<div style={{fontSize:11,color:"#475569"}}>{tmdbTipo==="FILME"?tmdbInfo.filmes.sem_tmdb.toLocaleString():tmdbInfo.series.sem_tmdb.toLocaleString()} {tmdbTipo==="FILME"?"filmes":"séries"} aguardando</div>}</div>}
            {tmdbLogs.length>0&&<div style={{marginTop:10,padding:"8px 10px",background:"#080808",borderRadius:6,border:"1px solid #141414"}}>{tmdbLogs.map((l,i)=><div key={i} style={{fontSize:11,color:l.startsWith("❌")?"#ef4444":l.startsWith("✅")?"#10b981":l.startsWith("↻")?"#f59e0b":"#64748b",lineHeight:1.6}}>{l}</div>)}</div>}
          </div>
          
          {/* Novo Bloco: Revisão TMDB Manual */}
          <div style={{background:"#0f1117",border:"1px solid #1e2130",borderRadius:10,padding:14}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:"#374151"}}/>
                  <span style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>Enriquecimento TMDB (Manual)</span>
                </div>
                <div style={{fontSize:11,color:"#374151",marginTop:4,paddingLeft:15}}>Revisão em lote de títulos sem informações</div>
              </div>
              <button onClick={()=>{onClose();setTimeout(()=>window.dispatchEvent(new CustomEvent("OPEN_TMDB_LOTE")),100);}}
                style={{display:"flex",alignItems:"center",justifyContent:"center",gap:5,padding:"6px 12px",width:130,background:"#f59e0b20",border:"1px solid #f59e0b50",borderRadius:7,color:"#f59e0b",fontSize:12,fontWeight:600,cursor:"pointer",flexShrink:0}}>
                <RefreshCw size={11}/> Revisar Lote
              </button>
            </div>
          </div>

          {/* Bloco Limpar Catálogo (Movido para o final) */}
          <LimparCatalogo />

        </div>

        <div style={{padding:"12px 20px",borderTop:"1px solid #1e2130",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{fontSize:11,color:"#374151",display:"flex",alignItems:"center",gap:6}}><RefreshCw size={10}/> Títulos já existentes são ignorados — só novos são contabilizados</div>
        </div>
      </div>
    </div>
  );
}

// ─── Poster ───────────────────────────────────────────────────────────────────
// Tamanho fixo para alinhar o grid
const POSTER_W = 148;
const POSTER_H = 222; // ratio 2:3

function Poster({titulo,posterUrl,coverUrl}:{titulo:string;posterUrl:string|null;coverUrl:string|null}) {
  const [err,setErr]=useState(false);
  const src=(!err&&(posterUrl||coverUrl))||null;
  if(!src) return <div style={{width:POSTER_W,height:POSTER_H,background:"linear-gradient(135deg,#1e2130,#252840)",borderRadius:8,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,flexShrink:0}}><Film size={32} color="#374151"/><span style={{fontSize:10,color:"#374151",textAlign:"center",padding:"0 8px",lineHeight:1.3}}>{titulo.slice(0,24)}</span></div>;
  return <img src={src} alt={titulo} onError={()=>setErr(true)} style={{width:POSTER_W,height:POSTER_H,objectFit:"cover",borderRadius:8,flexShrink:0,background:"#1a1d2e",display:"block"}}/>;
}

// ─── Carrossel multi-linha ────────────────────────────────────────────────────
// 5 linhas × 4 colunas no desktop = 20 visíveis por vez
// Cada linha avança independentemente (15s), pausa no hover
// No mobile: 1 coluna, avança tudo junto

const COLS_DESKTOP = 5;
const ROWS = 5;
const AUTOPLAY_MS = 15000;

// Divide array em chunks de N
function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Linha individual do carrossel
function CarrosselLinha({
  linhaIdx, paginas, onSelect, tipo,
}: {
  linhaIdx: number;
  paginas: TituloCard[][];  // cada página tem COLS_DESKTOP itens
  onSelect: (t: TituloCard) => void;
  tipo: TipoConteudo;
}) {
  const [pg, setPg] = useState(0);
  const [pausado, setPausado] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const totalPgs = paginas.length;

  useEffect(() => {
    if (pausado || totalPgs <= 1) return;
    timer.current = setTimeout(() => setPg(i => (i + 1) % totalPgs), AUTOPLAY_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [pg, pausado, totalPgs]);

  const itens = paginas[pg] || [];

  return (
    <div
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      style={{ display: "flex", flexDirection: "column", gap: 6 }}
    >
      {/* Grade de pósteres */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${COLS_DESKTOP}, 1fr)`,
        gap: 8,
      }}>
        {itens.map(item => {
          const src = item.poster_tmdb_url || item.cover_url;
          const isNovo = item.adicionado_em
            ? (Date.now() - new Date(item.adicionado_em).getTime()) < 7 * 86400000
            : false;
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item)}
              style={{
                position: "relative", background: "none", border: "none",
                cursor: "pointer", padding: 0, borderRadius: 8, overflow: "hidden",
                aspectRatio: "2/3",
              }}
            >
              {src
                ? <img src={src} alt={item.titulo_normalizado}
                    style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8, display: "block" }} />
                : <div style={{
                    width: "100%", height: "100%", background: "linear-gradient(135deg,#1e2130,#252840)",
                    borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Film size={24} color="#374151" />
                  </div>
              }
              {/* Gradiente inferior com título */}
              <div style={{
                position: "absolute", inset: 0,
                background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 55%)",
                borderRadius: 8,
              }} />
              <div style={{
                position: "absolute", bottom: 6, left: 6, right: 6,
                fontSize: 10, color: "#e2e8f0", fontWeight: 600,
                lineHeight: 1.3, textShadow: "0 1px 3px rgba(0,0,0,0.8)",
                overflow: "hidden", display: "-webkit-box",
                WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
              }}>
                {item.titulo_normalizado}
              </div>
              {/* Badge Novo / Atualização */}
              {isNovo && (
                <div style={{
                  position: "absolute", top: 5, left: 5,
                  fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
                  background: tipo === "SERIE" ? "#10b981" : "#6366f1",
                  color: "#fff", padding: "2px 6px", borderRadius: 4,
                }}>
                  {tipo === "SERIE" ? "ATUALIZ." : "NOVO"}
                </div>
              )}
              {/* Avaliação */}
              {item.avaliacao && (
                <div style={{
                  position: "absolute", top: 5, right: 5,
                  display: "flex", alignItems: "center", gap: 2,
                  background: "rgba(0,0,0,0.75)", borderRadius: 4, padding: "2px 5px",
                }}>
                  <Star size={8} fill="#f59e0b" color="#f59e0b" />
                  <span style={{ fontSize: 9, color: "#f59e0b", fontWeight: 700 }}>
                    {item.avaliacao.toFixed(1)}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>
      {/* Controles da linha */}
      {totalPgs > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
          <button onClick={() => setPg(i => (i - 1 + totalPgs) % totalPgs)}
            style={{ background: "#1a1d2e", border: "1px solid #252840", borderRadius: 6, width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#64748b" }}>
            <ChevronLeft size={13} />
          </button>
          <div style={{ display: "flex", gap: 4 }}>
            {paginas.map((_, i) => (
              <button key={i} onClick={() => setPg(i)}
                style={{ width: i === pg ? 16 : 5, height: 5, borderRadius: 3, background: i === pg ? "#6366f1" : "#252840", border: "none", cursor: "pointer", transition: "all 0.25s", padding: 0 }} />
            ))}
          </div>
          <button onClick={() => setPg(i => (i + 1) % totalPgs)}
            style={{ background: "#1a1d2e", border: "1px solid #252840", borderRadius: 6, width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#64748b" }}>
            <ChevronRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

function Carrossel({ itens, onSelect, tipo }: { itens: TituloCard[]; onSelect: (t: TituloCard) => void; tipo: TipoConteudo }) {
  if (itens.length === 0) return null;

  // Divide itens em linhas de COLS_DESKTOP, depois cada linha em páginas
  const linhas: TituloCard[][][] = [];
  for (let r = 0; r < ROWS; r++) {
    const start = r * COLS_DESKTOP * 3; // até 3 páginas por linha
    const slice = itens.slice(start, start + COLS_DESKTOP * 3);
    if (slice.length === 0) break;
    linhas.push(chunks(slice, COLS_DESKTOP));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {linhas.map((paginas, i) => (
        <CarrosselLinha key={i} linhaIdx={i} paginas={paginas} onSelect={onSelect} tipo={tipo} />
      ))}
    </div>
  );
}


// ─── Modal Detalhe ────────────────────────────────────────────────────────────
type TmdbResultado = {
  tmdb_id: number; titulo: string; titulo_original: string;
  ano: number | null; sinopse: string | null; avaliacao: number | null;
  poster_url: string | null;
};

function ModalDetalhe({id,onClose}:{id:string;onClose:()=>void}) {
  const [detalhe,setDetalhe]=useState<Detalhe|null>(null);
  const [loading,setLoading]=useState(true);
  const [showTmdb,setShowTmdb]=useState(false);
  const [tmdbQ,setTmdbQ]=useState("");
  const [tmdbResultados,setTmdbResultados]=useState<TmdbResultado[]>([]);
  const [tmdbLoading,setTmdbLoading]=useState(false);
  const [tmdbAplicando,setTmdbAplicando]=useState(false);
  const [tmdbOk,setTmdbOk]=useState(false);
  const [deletando,setDeletando]=useState(false);
  const [deleteOk,setDeleteOk]=useState(false);
  const [showDeleteMenu,setShowDeleteMenu]=useState(false);

  useEffect(()=>{
    fetch(`/api/catalogo/detalhe?id=${id}`).then(r=>r.json()).then(d=>{
      if(d.ok){setDetalhe(d.data);setTmdbQ(d.data.titulo_normalizado);}
    }).finally(()=>setLoading(false));
  },[id]);

  async function buscarTmdb(){
    if(!tmdbQ.trim()||!detalhe)return;
    setTmdbLoading(true);setTmdbResultados([]);
    const d=await fetch(`/api/catalogo/tmdb-buscar?q=${encodeURIComponent(tmdbQ)}&tipo=${detalhe.tipo}`).then(r=>r.json()).catch(()=>null);
    if(d?.ok)setTmdbResultados(d.data);
    setTmdbLoading(false);
  }

  async function aplicarTmdb(resultado:TmdbResultado){
    if(!detalhe)return;
    setTmdbAplicando(true);
    const d=await fetch("/api/catalogo/tmdb-aplicar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({master_id:detalhe.id,tmdb_id:resultado.tmdb_id,tipo:detalhe.tipo})}).then(r=>r.json()).catch(()=>null);
    if(d?.ok){
      setDetalhe(prev=>prev?{...prev,tmdb_id:resultado.tmdb_id,tmdb_confirmado:true,poster_tmdb_url:resultado.poster_url,sinopse:resultado.sinopse,avaliacao:resultado.avaliacao,ano:resultado.ano||prev.ano}:prev);
      setTmdbOk(true);setShowTmdb(false);setTimeout(()=>setTmdbOk(false),3000);
    }
    setTmdbAplicando(false);
  }

  const backdrop=detalhe?.poster_tmdb_url||detalhe?.cover_url||"";
  return (
    <div style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,0.88)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0f1117",width:"100%",maxWidth:680,maxHeight:"92vh",borderRadius:16,overflow:"hidden",display:"flex",flexDirection:"column",boxShadow:"0 32px 80px rgba(0,0,0,0.95)"}}>

        {/* Header com backdrop */}
        <div style={{position:"relative",height:200,background:"#13151f",flexShrink:0}}>
          {backdrop&&<><img src={backdrop} alt="" style={{width:"100%",height:"100%",objectFit:"cover",opacity:0.4}}/><div style={{position:"absolute",inset:0,background:"linear-gradient(to top,#0f1117 0%,transparent 60%)"}}/></>}
          <button onClick={onClose} style={{position:"absolute",top:12,right:12,background:"rgba(0,0,0,0.7)",border:"none",borderRadius:"50%",width:34,height:34,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"#94a3b8",zIndex:2}}><X size={16}/></button>
          {!loading&&detalhe&&(
            <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"0 16px 16px",display:"flex",gap:14,alignItems:"flex-end"}}>
              <Poster titulo={detalhe.titulo_normalizado} posterUrl={detalhe.poster_tmdb_url} coverUrl={detalhe.cover_url}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
                  <span style={{fontSize:10,fontWeight:700,color:"#6366f1",background:"#6366f120",padding:"2px 8px",borderRadius:20,textTransform:"uppercase"}}>{detalhe.tipo==="FILME"?"Filme":"Série"}</span>
                  {detalhe.ano&&<span style={{fontSize:11,color:"#64748b"}}>{detalhe.ano}</span>}
                  {detalhe.avaliacao&&<span style={{fontSize:12,color:"#f59e0b",display:"flex",alignItems:"center",gap:3,fontWeight:600}}><Star size={12} fill="#f59e0b"/>{detalhe.avaliacao.toFixed(1)}</span>}
                  {detalhe.tmdb_confirmado
                    ?<span style={{fontSize:10,color:"#10b981",background:"#10b98115",padding:"2px 7px",borderRadius:20,border:"1px solid #10b98130"}}>TMDB ✓</span>
                    :<span style={{fontSize:10,color:"#f59e0b",background:"#f59e0b15",padding:"2px 7px",borderRadius:20,border:"1px solid #f59e0b30"}}>Sem TMDB</span>
                  }
                </div>
                <div style={{fontSize:18,fontWeight:700,color:"#f1f5f9",lineHeight:1.3}}>{detalhe.titulo_normalizado}</div>
              </div>
            </div>
          )}
        </div>

        {/* Corpo */}
        <div style={{overflowY:"auto",flex:1,padding:16}}>
          {loading&&<div style={{textAlign:"center",padding:40,color:"#475569"}}>Carregando...</div>}
          {!loading&&!detalhe&&<div style={{textAlign:"center",padding:40,color:"#ef4444"}}>Título não encontrado.</div>}
          {!loading&&detalhe&&(
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              {/* Botão Corrigir TMDB */}
              <div style={{display:"flex",alignItems:"center",gap:8,justifyContent:"flex-end",flexWrap:"wrap"}}>
                {tmdbOk&&<span style={{fontSize:11,color:"#10b981"}}>✓ TMDB atualizado</span>}
                {deleteOk&&<span style={{fontSize:11,color:"#10b981"}}>✓ Removido</span>}
                <button onClick={()=>setShowTmdb(v=>!v)}
                  style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",background:showTmdb?"#6366f120":"#13151f",border:`1px solid ${showTmdb?"#6366f1":"#252840"}`,borderRadius:8,color:showTmdb?"#818cf8":"#64748b",fontSize:11,cursor:"pointer",fontWeight:500}}>
                  <RefreshCw size={11}/> {showTmdb?"Fechar busca":"Corrigir TMDB"}
                </button>
                {/* Botão deletar individual */}
                <div style={{position:"relative"}}>
                  <button onClick={()=>setShowDeleteMenu(v=>!v)} disabled={deletando}
                    style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",background:showDeleteMenu?"#ef444420":"#13151f",border:`1px solid ${showDeleteMenu?"#ef4444":"#252840"}`,borderRadius:8,color:showDeleteMenu?"#ef4444":"#64748b",fontSize:11,cursor:deletando?"wait":"pointer",fontWeight:500}}>
                    <X size={11}/> Deletar título
                  </button>
                  {showDeleteMenu&&detalhe&&(
                    <div style={{position:"absolute",top:"calc(100% + 6px)",right:0,background:"#13151f",border:"1px solid #ef444430",borderRadius:10,padding:12,zIndex:10,minWidth:200,boxShadow:"0 12px 40px rgba(0,0,0,0.7)"}}>
                      <div style={{fontSize:11,color:"#ef4444",fontWeight:700,marginBottom:8,textTransform:"uppercase",letterSpacing:0.5}}>Remover de qual servidor?</div>
                      <div style={{display:"flex",flexDirection:"column",gap:6}}>
                        {detalhe.disponibilidade.map(d=>(
                          <button key={d.servidor} onClick={async()=>{
                            setDeletando(true);setShowDeleteMenu(false);
                            const res=await fetch("/api/catalogo/titulo",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:detalhe.id,servidor:d.servidor})}).then(r=>r.json()).catch(()=>null);
                            if(res?.ok){
                              setDeleteOk(true);
                              if(res.removido_master){setTimeout(()=>onClose(),1500);}
                              else{setDetalhe(prev=>prev?{...prev,disponibilidade:prev.disponibilidade.filter(x=>x.servidor!==d.servidor)}:prev);}
                            }
                            setDeletando(false);
                          }}
                            style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:"#0f1117",border:"1px solid #1e2130",borderRadius:7,cursor:"pointer",color:"#e2e8f0",fontSize:12,textAlign:"left"}}
                            onMouseEnter={e=>(e.currentTarget.style.borderColor="#ef4444")}
                            onMouseLeave={e=>(e.currentTarget.style.borderColor="#1e2130")}>
                            <div style={{width:7,height:7,borderRadius:"50%",background:COR_SERVIDOR[d.servidor]||"#6b7280",flexShrink:0}}/>
                            {d.servidor}
                            <span style={{fontSize:10,color:"#475569",marginLeft:"auto"}}>{d.categoria_origem}</span>
                          </button>
                        ))}
                        {detalhe.disponibilidade.length>1&&(
                          <button onClick={async()=>{
                            setDeletando(true);setShowDeleteMenu(false);
                            for(const d of detalhe.disponibilidade){
                              await fetch("/api/catalogo/titulo",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:detalhe.id,servidor:d.servidor})}).then(r=>r.json()).catch(()=>null);
                            }
                            setDeleteOk(true);
                            setDeletando(false);
                            setTimeout(()=>onClose(),1500);
                          }}
                            style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:"#ef444415",border:"1px solid #ef444430",borderRadius:7,cursor:"pointer",color:"#ef4444",fontSize:12,fontWeight:600,marginTop:4}}>
                            <X size={11}/> Remover de todos
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Painel de correção TMDB */}
              {showTmdb&&(
                <div style={{background:"#13151f",border:"1px solid #1e2130",borderRadius:10,padding:14}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Buscar no TMDB</div>
                  <div style={{display:"flex",gap:8,marginBottom:12}}>
                    <input value={tmdbQ} onChange={e=>setTmdbQ(e.target.value)}
                      onKeyDown={e=>e.key==="Enter"&&buscarTmdb()}
                      style={{flex:1,height:34,padding:"0 12px",background:"#0f1117",border:"1px solid #252840",borderRadius:8,color:"#e2e8f0",fontSize:13,outline:"none"}}
                      placeholder="Nome para buscar no TMDB..."/>
                    <button onClick={buscarTmdb} disabled={tmdbLoading}
                      style={{height:34,padding:"0 14px",background:"#6366f1",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:600,cursor:tmdbLoading?"wait":"pointer",flexShrink:0}}>
                      {tmdbLoading?<RefreshCw size={12} style={{animation:"spin 1s linear infinite"}}/>:"Buscar"}
                    </button>
                  </div>
                  {tmdbResultados.length>0&&(
                    <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:320,overflowY:"auto"}}>
                      {tmdbResultados.map(r=>(
                        <button key={r.tmdb_id} onClick={()=>aplicarTmdb(r)} disabled={tmdbAplicando}
                          style={{display:"flex",gap:10,padding:10,background:"#0f1117",border:"1px solid #1e2130",borderRadius:8,cursor:"pointer",textAlign:"left",alignItems:"flex-start",transition:"all 0.15s"}}
                          onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor="#6366f1";(e.currentTarget as HTMLButtonElement).style.background="#6366f108";}}
                          onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor="#1e2130";(e.currentTarget as HTMLButtonElement).style.background="#0f1117";}}>
                          {r.poster_url
                            ?<img src={r.poster_url} alt={r.titulo} style={{width:44,height:66,objectFit:"cover",borderRadius:5,flexShrink:0}}/>
                            :<div style={{width:44,height:66,background:"#1e2130",borderRadius:5,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}><Film size={16} color="#374151"/></div>
                          }
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:13,fontWeight:600,color:"#f1f5f9",lineHeight:1.3,marginBottom:3}}>{r.titulo}</div>
                            {r.titulo_original!==r.titulo&&<div style={{fontSize:10,color:"#475569",marginBottom:4}}>{r.titulo_original}</div>}
                            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4}}>
                              {r.ano&&<span style={{fontSize:11,color:"#64748b"}}>{r.ano}</span>}
                              {r.avaliacao&&<span style={{fontSize:11,color:"#f59e0b",display:"flex",alignItems:"center",gap:2}}><Star size={9} fill="#f59e0b"/>{r.avaliacao}</span>}
                              <span style={{fontSize:10,color:"#374151"}}>ID: {r.tmdb_id}</span>
                            </div>
                            {r.sinopse&&<div style={{fontSize:11,color:"#475569",overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",lineHeight:1.5}}>{r.sinopse}</div>}
                          </div>
                          <div style={{fontSize:10,fontWeight:700,color:"#ffffff",background:"#6366f1",padding:"4px 8px",borderRadius:5,flexShrink:0,marginTop:4}}>Aplicar →</div>
                        </button>
                      ))}
                    </div>
                  )}
                  {tmdbResultados.length===0&&!tmdbLoading&&<div style={{fontSize:12,color:"#374151",textAlign:"center",padding:"8px 0"}}>Digite um nome e pressione Buscar</div>}
                </div>
              )}

              {detalhe.generos&&detalhe.generos.length>0&&<div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{detalhe.generos.map(g=><span key={g} style={{fontSize:11,color:"#94a3b8",background:"#1e2130",padding:"3px 10px",borderRadius:20,border:"1px solid #252840"}}>{g}</span>)}</div>}
              {detalhe.sinopse&&<div><div style={{fontSize:11,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Sinopse</div><div style={{fontSize:14,color:"#94a3b8",lineHeight:1.7}}>{detalhe.sinopse}</div></div>}
              {detalhe.disponibilidade.length>0&&(
                <div><div style={{fontSize:11,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Disponível em</div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>{detalhe.disponibilidade.map((d,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"#13151f",borderRadius:8,border:`1px solid ${COR_SERVIDOR[d.servidor]||"#1e2130"}30`}}><div style={{width:8,height:8,borderRadius:"50%",background:COR_SERVIDOR[d.servidor]||"#6b7280",flexShrink:0}}/><div><div style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>{d.servidor}</div><div style={{fontSize:11,color:"#64748b"}}>{d.categoria_origem}</div></div></div>))}</div></div>
              )}
              {detalhe.tipo==="SERIE"&&detalhe.temporadas.length>0&&(
                <div><div style={{fontSize:11,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Temporadas ({detalhe.temporadas.length})</div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>{detalhe.temporadas.map(t=><div key={t.temporada} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",background:"#13151f",borderRadius:8,border:"1px solid #1e2130"}}><span style={{fontSize:13,color:"#e2e8f0",fontWeight:500}}>Temporada {t.temporada}</span><span style={{fontSize:12,color:"#475569"}}>{t.total_episodios} ep</span></div>)}</div></div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Resultado busca catálogo ─────────────────────────────────────────────────
function ResultadoBuscaCatalogo({resultados,loading,onSelect}:{resultados:TituloBusca[];loading:boolean;onSelect:(t:TituloCard)=>void}) {
  if(loading)return <div style={{textAlign:"center",padding:40,color:"#475569"}}><RefreshCw size={20} style={{animation:"spin 1s linear infinite",margin:"0 auto 10px",display:"block"}}/>Buscando...</div>;
  if(resultados.length===0)return <div style={{textAlign:"center",padding:40,color:"#374151"}}><Search size={28} style={{margin:"0 auto 12px",display:"block",opacity:0.3}}/><div style={{fontSize:14}}>Nenhum resultado</div><div style={{fontSize:12,marginTop:6,color:"#374151"}}>Tente outros termos</div></div>;
  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(480px,1fr))",gap:2}}>
      {resultados.map(t=>(
        <button key={t.id} onClick={()=>onSelect(t)} style={{display:"flex",gap:12,padding:"12px 4px",background:"none",border:"none",borderBottom:"1px solid #1a1d2e",cursor:"pointer",textAlign:"left",width:"100%"}} onMouseEnter={e=>(e.currentTarget.style.background="#13151f")} onMouseLeave={e=>(e.currentTarget.style.background="none")}>
          <div style={{width:POSTER_W,flexShrink:0}}><Poster titulo={t.titulo_normalizado} posterUrl={t.poster_tmdb_url} coverUrl={t.cover_url}/></div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
              <span style={{fontSize:10,fontWeight:700,color:t.tipo==="FILME"?"#f59e0b":"#6366f1",background:t.tipo==="FILME"?"#f59e0b15":"#6366f115",padding:"2px 7px",borderRadius:20}}>{t.tipo==="FILME"?"Filme":"Série"}</span>
              {t.ano&&<span style={{fontSize:11,color:"#475569"}}>{t.ano}</span>}
              {t.avaliacao&&<span style={{fontSize:11,color:"#f59e0b",display:"flex",alignItems:"center",gap:2}}><Star size={9} fill="#f59e0b"/>{t.avaliacao.toFixed(1)}</span>}
            </div>
            <div style={{fontSize:14,fontWeight:600,color:"#e2e8f0",marginBottom:4,lineHeight:1.3}}>{t.titulo_normalizado}</div>
            {t.sinopse&&<div style={{fontSize:12,color:"#64748b",overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",lineHeight:1.5,marginBottom:6}}>{t.sinopse}</div>}
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{t.rotas.map((r,i)=><span key={i} style={{fontSize:10,color:COR_SERVIDOR[r.servidor]||"#94a3b8",background:(COR_SERVIDOR[r.servidor]||"#94a3b8")+"15",padding:"2px 7px",borderRadius:20,border:`1px solid ${(COR_SERVIDOR[r.servidor]||"#94a3b8")}30`}}>{r.servidor} / {r.categoria}</span>)}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── Grid de miniaturas (tamanho fixo, alinhado) ──────────────────────────────
function GradeMiniaturas({titulos,total,page,perPage=50,onSelect,onPage}:{titulos:TituloCard[];total:number;page:number;perPage?:number;onSelect:(t:TituloCard)=>void;onPage:(p:number)=>void}) {
  const totalPags=Math.ceil(total/perPage);
  return (
    <div>
      {/* Grid com colunas de tamanho fixo para alinhar perfeitamente */}
      <div style={{display:"grid",gridTemplateColumns:`repeat(auto-fill, ${POSTER_W+4}px)`,gap:14,justifyContent:"start"}}>
        {titulos.map(t=>(
          <button key={t.id} onClick={()=>onSelect(t)} style={{background:"none",border:"none",cursor:"pointer",padding:0,textAlign:"left",width:POSTER_W+4}}>
            <div style={{position:"relative",marginBottom:7}}>
              <Poster titulo={t.titulo_normalizado} posterUrl={t.poster_tmdb_url} coverUrl={t.cover_url}/>
              {t.avaliacao&&<div style={{position:"absolute",top:5,left:5,background:"rgba(0,0,0,0.85)",borderRadius:4,padding:"2px 6px",display:"flex",alignItems:"center",gap:3}}><Star size={9} fill="#f59e0b" color="#f59e0b"/><span style={{fontSize:10,color:"#f59e0b",fontWeight:600}}>{t.avaliacao.toFixed(1)}</span></div>}
            </div>
            <div style={{fontSize:11,color:"#94a3b8",lineHeight:1.3,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",width:POSTER_W+4}}>{t.titulo_normalizado}</div>
            {t.ano&&<div style={{fontSize:10,color:"#475569",marginTop:2}}>{t.ano}</div>}
          </button>
        ))}
      </div>
      {totalPags>1&&<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginTop:24}}>
        <button disabled={page<=1} onClick={()=>onPage(page-1)} style={{padding:"6px 14px",background:page<=1?"#0f1117":"#1a1d2e",border:"1px solid #252840",borderRadius:7,color:page<=1?"#374151":"#94a3b8",cursor:page<=1?"not-allowed":"pointer",fontSize:12}}>← Anterior</button>
        <span style={{fontSize:12,color:"#475569"}}>{page} / {totalPags}</span>
        <button disabled={page>=totalPags} onClick={()=>onPage(page+1)} style={{padding:"6px 14px",background:page>=totalPags?"#0f1117":"#1a1d2e",border:"1px solid #252840",borderRadius:7,color:page>=totalPags?"#374151":"#94a3b8",cursor:page>=totalPags?"not-allowed":"pointer",fontSize:12}}>Próxima →</button>
      </div>}
    </div>
  );
}

// ─── Aba Catálogo ─────────────────────────────────────────────────────────────
function AbaCatalogo({tipo,servidorAdmin}:{tipo:TipoConteudo;servidorAdmin:ServidorId|"TODOS"}) {
  const [servidor,setServidor]=useState<ServidorId|"TODOS">(servidorAdmin==="TODOS"?"TODOS":servidorAdmin as ServidorId);
  const [novidades,setNovidades]=useState<TituloCard[]>([]);
  const [categorias,setCategorias]=useState<Categoria[]>([]);
  const [subCategorias,setSubCategorias]=useState<Categoria[]>([]);
  const [catSelecionada,setCatSelecionada]=useState<Categoria|null>(null);
  const [subCatSelecionada,setSubCatSelecionada]=useState<Categoria|null>(null);
  const [titulos,setTitulos]=useState<TituloCard[]>([]);
  const [totalTitulos,setTotalTitulos]=useState(0);
  const [perPage,setPerPage]=useState(50);
  const [page,setPage]=useState(1);
  const [loadingNov,setLoadingNov]=useState(true);
  const [loadingCats,setLoadingCats]=useState(true);
  const [loadingTits,setLoadingTits]=useState(false);
  const [detalhando,setDetalhando]=useState<string|null>(null);
  const [busca,setBusca]=useState("");
  const [buscaAtiva,setBuscaAtiva]=useState("");
  const [resultadosBusca,setResultadosBusca]=useState<TituloBusca[]>([]);
  const [loadingBusca,setLoadingBusca]=useState(false);
  const [catDropOpen,setCatDropOpen]=useState(false);
  const [subDropOpen,setSubDropOpen]=useState(false);
  const catDropRef=useRef<HTMLDivElement>(null);
  const subDropRef=useRef<HTMLDivElement>(null);

  useEffect(()=>{
    function h(e:MouseEvent){if(catDropRef.current&&!catDropRef.current.contains(e.target as Node))setCatDropOpen(false);}
    document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);
  },[]);
  useEffect(()=>{
    function h(e:MouseEvent){if(subDropRef.current&&!subDropRef.current.contains(e.target as Node))setSubDropOpen(false);}
    document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);
  },[]);

  // Novidades
  useEffect(()=>{
    setLoadingNov(true);setNovidades([]);
    fetch(`/api/catalogo/novidades?servidor=${servidor}&tipo=${tipo}`)
      .then(r=>r.json()).then(d=>{if(d.ok&&d.data)setNovidades(d.data);}).finally(()=>setLoadingNov(false));
  },[servidor,tipo]);

  // Categorias — filtradas e em ordem alfabética
  useEffect(()=>{
    setLoadingCats(true);setCatSelecionada(null);setSubCatSelecionada(null);setSubCategorias([]);setTitulos([]);
    fetch(`/api/catalogo/categorias?servidor=${servidor}&tipo=${tipo}`)
      .then(r=>r.json()).then(d=>{
        if(d.ok){
          const filtradas=(d.data as Categoria[])
            .filter(c=>isCategoriaPrincipal(c.categoria_origem,c.total))
            .sort((a,b)=>a.label.localeCompare(b.label,"pt-BR"));
          setCategorias(filtradas);
        }
      }).finally(()=>setLoadingCats(false));
  },[servidor,tipo]);

  // Subcategorias quando categoria muda (para servidores com hierarquia)
  useEffect(()=>{
    setSubCatSelecionada(null);setSubCategorias([]);
    if(!catSelecionada)return;
    // Filtra sub-categorias do mesmo servidor que começam com o label da categoria (padrão NaTV: "FILMES: ...")
    // Para Elite e Fast não há subcategoria real — lista fica vazia
  },[catSelecionada]);

  // Títulos
  useEffect(()=>{
    const cat=subCatSelecionada||catSelecionada;
    if(!cat)return;
    setLoadingTits(true);setTitulos([]);
    fetch(`/api/catalogo/titulos?servidor=${servidor}&tipo=${tipo}&categoria=${encodeURIComponent(cat.categoria_origem)}&page=${page}`)
      .then(r=>r.json()).then(d=>{if(d.ok){setTitulos(d.data);setTotalTitulos(d.total);setPerPage(d.per_page||50);}}).finally(()=>setLoadingTits(false));
  },[catSelecionada,subCatSelecionada,servidor,tipo,page]);

  // Busca
  useEffect(()=>{
    if(!buscaAtiva.trim()){setResultadosBusca([]);return;}
    setLoadingBusca(true);
    const srv=servidor;
    fetch(`/api/catalogo/busca?q=${encodeURIComponent(buscaAtiva)}&servidor=${srv}&tipo=${tipo}`)
      .then(r=>r.json()).then(d=>{if(d.ok)setResultadosBusca(d.data);}).finally(()=>setLoadingBusca(false));
  },[buscaAtiva,servidor,tipo,servidorAdmin]);

  const SERVIDORES:(ServidorId|"TODOS")[]=["TODOS","ELITE","NATV","FAST"];
  const emBusca=buscaAtiva.trim().length>0;
  const catAtiva=subCatSelecionada||catSelecionada;

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflowY:"auto",background:"#0f1117"}}>

      {/* ── Barra de controles ── */}
      <div style={{flexShrink:0,padding:"10px 16px",display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",borderBottom:"1px solid #1e2130",background:"#0b0d14"}}>

        {/* Servidor (só admin) */}
        {servidorAdmin==="TODOS"&&SERVIDORES.map(srv=>{
          const cor=srv==="TODOS"?"#94a3b8":(COR_SERVIDOR[srv as ServidorId]||"#94a3b8");
          const ativo=servidor===srv;
          return(
            <button key={srv} onClick={()=>{setServidor(srv as ServidorId|"TODOS");setCatSelecionada(null);setSubCatSelecionada(null);setPage(1);setBusca("");setBuscaAtiva("");}}
              style={{padding:"5px 14px",borderRadius:20,border:`1px solid ${ativo?cor:"#252840"}`,background:ativo?cor+"20":"transparent",color:ativo?cor:"#64748b",fontSize:12,fontWeight:ativo?700:400,cursor:"pointer",flexShrink:0}}>
              {srv}
            </button>
          );
        })}

        {/* Dropdown Categoria */}
        <div ref={catDropRef} style={{position:"relative",flexShrink:0}}>
          <button onClick={()=>setCatDropOpen(o=>!o)}
            style={{display:"flex",alignItems:"center",gap:5,padding:"5px 12px",borderRadius:20,height:32,border:`1px solid ${catSelecionada?"#6366f1":"#252840"}`,background:catSelecionada?"#6366f120":"transparent",color:catSelecionada?"#818cf8":"#64748b",fontSize:12,cursor:"pointer",fontWeight:catSelecionada?700:400,whiteSpace:"nowrap"}}>
            {catSelecionada?<><CatIcon slug={catSelecionada.emoji} size={12} color="#818cf8"/><span style={{marginLeft:5}}>{catSelecionada.label}</span></>:<><Database size={11} style={{marginRight:4}}/> Categoria</>}
            <ChevronDown size={11} style={{opacity:0.6,transform:catDropOpen?"rotate(180deg)":"none",transition:"transform 0.15s"}}/>
          </button>
          {catDropOpen&&!loadingCats&&(
            <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,minWidth:220,maxHeight:320,overflowY:"auto",background:"#13151f",border:"1px solid #1e2130",borderRadius:10,zIndex:300,boxShadow:"0 12px 40px rgba(0,0,0,0.7)"}}>
              <button onClick={()=>{setCatSelecionada(null);setSubCatSelecionada(null);setCatDropOpen(false);}}
                style={{display:"block",width:"100%",padding:"8px 14px",background:"none",border:"none",borderBottom:"1px solid #1e2130",textAlign:"left",cursor:"pointer",color:"#64748b",fontSize:12}}>— Todas as categorias</button>
              {categorias.map(c=>(
                <button key={c.categoria_origem} onClick={()=>{setCatSelecionada(c);setSubCatSelecionada(null);setPage(1);setCatDropOpen(false);}}
                  style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",padding:"8px 14px",background:catSelecionada?.categoria_origem===c.categoria_origem?"#1e2130":"none",border:"none",textAlign:"left",cursor:"pointer",color:catSelecionada?.categoria_origem===c.categoria_origem?"#f1f5f9":"#94a3b8",fontSize:13,borderLeft:`3px solid ${catSelecionada?.categoria_origem===c.categoria_origem?"#6366f1":"transparent"}`}}
                  onMouseEnter={e=>(e.currentTarget.style.background="#1e2130")} onMouseLeave={e=>(e.currentTarget.style.background=catSelecionada?.categoria_origem===c.categoria_origem?"#1e2130":"none")}>
                  <span style={{display:"flex",alignItems:"center",gap:7}}><CatIcon slug={c.emoji} size={13} color="#64748b"/>{c.label}</span><span style={{fontSize:10,color:"#374151"}}>{c.total.toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Dropdown Subcategoria (só aparece se categoria selecionada tem filhos) */}
        {catSelecionada&&subCategorias.length>0&&(
          <div ref={subDropRef} style={{position:"relative",flexShrink:0}}>
            <button onClick={()=>setSubDropOpen(o=>!o)}
              style={{display:"flex",alignItems:"center",gap:5,padding:"5px 12px",borderRadius:20,height:32,border:`1px solid ${subCatSelecionada?"#10b981":"#252840"}`,background:subCatSelecionada?"#10b98120":"transparent",color:subCatSelecionada?"#10b981":"#64748b",fontSize:12,cursor:"pointer",fontWeight:subCatSelecionada?700:400,whiteSpace:"nowrap"}}>
              {subCatSelecionada?<><CatIcon slug={subCatSelecionada.emoji} size={12} color="#10b981"/><span style={{marginLeft:5}}>{subCatSelecionada.label}</span></>:<><ChevronDown size={11} style={{marginRight:3}}/> Subcategoria</>}
              <ChevronDown size={11} style={{opacity:0.6,transform:subDropOpen?"rotate(180deg)":"none",transition:"transform 0.15s"}}/>
            </button>
            {subDropOpen&&(
              <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,minWidth:200,maxHeight:280,overflowY:"auto",background:"#13151f",border:"1px solid #1e2130",borderRadius:10,zIndex:300,boxShadow:"0 12px 40px rgba(0,0,0,0.7)"}}>
                <button onClick={()=>{setSubCatSelecionada(null);setSubDropOpen(false);}} style={{display:"block",width:"100%",padding:"8px 14px",background:"none",border:"none",borderBottom:"1px solid #1e2130",textAlign:"left",cursor:"pointer",color:"#64748b",fontSize:12}}>— Todas</button>
                {subCategorias.map(c=>(
                  <button key={c.categoria_origem} onClick={()=>{setSubCatSelecionada(c);setPage(1);setSubDropOpen(false);}}
                    style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",padding:"8px 14px",background:subCatSelecionada?.categoria_origem===c.categoria_origem?"#1e2130":"none",border:"none",cursor:"pointer",color:"#94a3b8",fontSize:13}}
                    onMouseEnter={e=>(e.currentTarget.style.background="#1e2130")} onMouseLeave={e=>(e.currentTarget.style.background=subCatSelecionada?.categoria_origem===c.categoria_origem?"#1e2130":"none")}>
                    <span style={{display:"flex",alignItems:"center",gap:7}}><CatIcon slug={c.emoji} size={13} color="#64748b"/>{c.label}</span><span style={{fontSize:10,color:"#374151"}}>{c.total.toLocaleString()}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Limpar categoria */}
        {catAtiva&&(
          <button onClick={()=>{setCatSelecionada(null);setSubCatSelecionada(null);setPage(1);}}
            style={{display:"flex",alignItems:"center",gap:3,padding:"4px 8px",background:"#ef444415",border:"1px solid #ef444430",borderRadius:20,color:"#ef4444",fontSize:11,cursor:"pointer",flexShrink:0}}>
            <X size={10}/> {catAtiva.label}
          </button>
        )}

        {/* Busca com autocomplete */}
        <div style={{position:"relative",flex:1,minWidth:140}}>
          <Search size={13} style={{position:"absolute",left:10,top:16,transform:"translateY(-50%)",color:"#475569",pointerEvents:"none",zIndex:1}}/>
          <input value={busca}
            onChange={e=>{
              setBusca(e.target.value);
              if(!e.target.value.trim()){setBuscaAtiva("");return;}
              // Autocomplete: dispara busca após 300ms de pausa
              setBuscaAtiva(e.target.value.trim());
            }}
            onKeyDown={e=>{
              if(e.key==="Enter") setBuscaAtiva(busca.trim());
              if(e.key==="Escape"){setBusca("");setBuscaAtiva("");}
            }}
            placeholder={`Buscar ${tipo==="FILME"?"filmes":"séries"}...`}
            style={{width:"100%",height:32,paddingLeft:30,paddingRight:busca?30:10,background:"#13151f",border:"1px solid #252840",borderRadius:20,fontSize:13,color:"#e2e8f0",outline:"none",boxSizing:"border-box"}}
            onFocus={e=>(e.target.style.borderColor="#6366f1")} onBlur={e=>(e.target.style.borderColor="#252840")}/>
          {busca&&<button onClick={()=>{setBusca("");setBuscaAtiva("");}} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"#475569",display:"flex"}}><X size={12}/></button>}
        </div>
        {busca&&<button onClick={()=>setBuscaAtiva(busca.trim())} style={{height:32,padding:"0 14px",background:"#6366f1",border:"none",borderRadius:20,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",flexShrink:0}}>Buscar</button>}
      </div>

      {/* ── Conteúdo ── */}
      <div style={{flex:1,padding:"16px 16px 24px",overflowY:"auto"}}>
        {emBusca?(
          <ResultadoBuscaCatalogo resultados={resultadosBusca} loading={loadingBusca} onSelect={t=>setDetalhando(t.id)}/>
        ):catAtiva?(
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
              <button onClick={()=>{setCatSelecionada(null);setSubCatSelecionada(null);setPage(1);}}
                style={{display:"flex",alignItems:"center",gap:5,padding:"5px 10px",background:"#13151f",border:"1px solid #252840",borderRadius:7,color:"#94a3b8",fontSize:12,cursor:"pointer"}}>← Início</button>
              <span style={{fontSize:13,color:"#e2e8f0",fontWeight:600,display:"flex",alignItems:"center",gap:6}}><CatIcon slug={catAtiva.emoji} size={14} color="#818cf8"/>{catAtiva.label}</span>
              <span style={{fontSize:11,color:"#475569"}}>({totalTitulos.toLocaleString()} títulos)</span>
            </div>
            {loadingTits?<div style={{textAlign:"center",padding:40,color:"#475569"}}><RefreshCw size={20} style={{animation:"spin 1s linear infinite",margin:"0 auto 10px",display:"block"}}/></div>:
              <GradeMiniaturas titulos={titulos} total={totalTitulos} page={page} perPage={perPage} onSelect={t=>setDetalhando(t.id)} onPage={p=>setPage(p)}/>}
          </div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:24}}>
            {/* Carrossel — sempre no topo */}
            {loadingNov?(
              <div style={{height:220,background:"#13151f",borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center"}}><RefreshCw size={20} style={{animation:"spin 1s linear infinite",color:"#374151"}}/></div>
            ):novidades.length>0?(
              <div>
                <div style={{fontSize:11,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Adicionados recentemente</div>
                <Carrossel itens={novidades} onSelect={t=>setDetalhando(t.id)} tipo={tipo}/>
              </div>
            ):(
              <div style={{height:80,display:"flex",alignItems:"center",justifyContent:"center",color:"#374151",fontSize:13,background:"#13151f",borderRadius:12}}>Nenhum título recente com dados do TMDB</div>
            )}

          </div>
        )}
      </div>

      {detalhando&&<ModalDetalhe id={detalhando} onClose={()=>setDetalhando(null)}/>}
    </div>
  );
}

// ─── Modal TMDB Revisão em Lote ───────────────────────────────────────────────
type LoteItem = {
  id: string; titulo_normalizado: string; tipo: TipoConteudo;
  tmdb_id: number|null; tmdb_confirmado: boolean;
  poster_tmdb_url: string|null; cover_url: string|null;
  candidatos: TmdbResultado[]; escolhido: number|null; ignorado: boolean;
};

function ModalTmdbLote({onClose}:{onClose:()=>void}) {
  const [tipo,setTipo]=useState<TipoConteudo>("FILME");
  const [lote,setLote]=useState(10);
  const [soSemTmdb,setSoSemTmdb]=useState(true);
  const [itens,setItens]=useState<LoteItem[]>([]);
  const [loading,setLoading]=useState(false);
  const [salvando,setSalvando]=useState(false);
  const [totalSalvos,setTotalSalvos]=useState(0);

  async function carregarLote(){
    setLoading(true);setItens([]);
    const filtro=soSemTmdb?"&sem_tmdb=true":"";
    const data=await fetch(`/api/catalogo/tmdb-lote?tipo=${tipo}&lote=${lote}${filtro}`).then(r=>r.json()).catch(()=>null);
    if(!data?.ok){setLoading(false);return;}

    // Para cada título, busca candidatos no TMDB em paralelo
    const com_candidatos:LoteItem[]=await Promise.all(
      (data.data as any[]).map(async (t:any)=>{
        const d=await fetch(`/api/catalogo/tmdb-buscar?q=${encodeURIComponent(t.titulo_normalizado)}&tipo=${tipo}`).then(r=>r.json()).catch(()=>null);
        return{
          id:t.id,titulo_normalizado:t.titulo_normalizado,tipo:t.tipo,
          tmdb_id:t.tmdb_id,tmdb_confirmado:t.tmdb_confirmado,
          poster_tmdb_url:t.poster_tmdb_url,cover_url:t.cover_url,
          candidatos:(d?.ok?d.data:[]).slice(0,5),
          // Pré-seleciona o primeiro candidato se confiante (título muito similar)
          escolhido:d?.ok&&d.data.length>0?d.data[0].tmdb_id:null,
          ignorado:false,
        } as LoteItem;
      })
    );
    setItens(com_candidatos);setLoading(false);
  }

  async function salvarEscolhas(){
    setSalvando(true);let salvos=0;
    for(const item of itens){
      if(item.ignorado||!item.escolhido)continue;
      const cand=item.candidatos.find(c=>c.tmdb_id===item.escolhido);
      if(!cand)continue;
      const d=await fetch("/api/catalogo/tmdb-aplicar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({master_id:item.id,tmdb_id:item.escolhido,tipo:item.tipo})}).then(r=>r.json()).catch(()=>null);
      if(d?.ok)salvos++;
    }
    setTotalSalvos(salvos);setSalvando(false);
    setItens(p=>p.map(i=>({...i,ignorado:!i.ignorado&&i.escolhido?true:i.ignorado})));
  }

  const pendentes=itens.filter(i=>!i.ignorado&&i.escolhido).length;

  return(
    <div style={{position:"fixed",inset:0,zIndex:9998,background:"rgba(0,0,0,0.88)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0f1117",width:"100%",maxWidth:900,maxHeight:"92vh",borderRadius:16,display:"flex",flexDirection:"column",boxShadow:"0 32px 80px rgba(0,0,0,0.95)"}}>
        {/* Header */}
        <div style={{padding:"16px 20px",borderBottom:"1px solid #1e2130",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:"#f1f5f9",display:"flex",alignItems:"center",gap:8}}><RefreshCw size={15} color="#f59e0b"/> Enriquecimento TMDB (Manual)</div>
            <div style={{fontSize:11,color:"#475569",marginTop:3}}>Verifique e corrija os dados do TMDB em massa</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:"#475569"}}><X size={16}/></button>
        </div>

        {/* Configuração */}
        <div style={{padding:"12px 20px",borderBottom:"1px solid #1e2130",display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",flexShrink:0,background:"#0b0d14"}}>
          <div style={{display:"flex",background:"#1a1d2e",padding:3,borderRadius:7,gap:3}}>
            <button onClick={()=>setTipo("FILME")} style={{padding:"4px 14px",background:tipo==="FILME"?"#6366f1":"transparent",color:tipo==="FILME"?"#fff":"#64748b",border:"none",borderRadius:5,fontSize:12,fontWeight:600,cursor:"pointer"}}>Filmes</button>
            <button onClick={()=>setTipo("SERIE")} style={{padding:"4px 14px",background:tipo==="SERIE"?"#6366f1":"transparent",color:tipo==="SERIE"?"#fff":"#64748b",border:"none",borderRadius:5,fontSize:12,fontWeight:600,cursor:"pointer"}}>Séries</button>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:12,color:"#64748b"}}>Lote:</span>
            <input type="number" min={5} max={30} value={lote} onChange={e=>setLote(Math.min(30,Math.max(5,parseInt(e.target.value)||10)))}
              style={{width:55,padding:"4px 8px",background:"#0f1117",border:"1px solid #252840",borderRadius:6,color:"#e2e8f0",fontSize:12,textAlign:"center"}}/>
          </div>
          <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12,color:"#64748b"}}>
            <input type="checkbox" checked={soSemTmdb} onChange={e=>setSoSemTmdb(e.target.checked)}/>
            Só sem TMDB
          </label>
          <button onClick={carregarLote} disabled={loading}
            style={{padding:"6px 16px",background:"#6366f1",border:"none",borderRadius:7,color:"#fff",fontSize:12,fontWeight:600,cursor:loading?"wait":"pointer",display:"flex",alignItems:"center",gap:5}}>
            {loading?<><RefreshCw size={11} style={{animation:"spin 1s linear infinite"}}/>Carregando...</>:"Carregar lote"}
          </button>
          {totalSalvos>0&&<span style={{fontSize:12,color:"#10b981"}}>✓ {totalSalvos} salvo(s)</span>}
        </div>

        {/* Lista */}
        <div style={{flex:1,overflowY:"auto",padding:16}}>
          {loading&&<div style={{textAlign:"center",padding:60,color:"#475569"}}><RefreshCw size={20} style={{animation:"spin 1s linear infinite",margin:"0 auto 12px",display:"block"}}/>Buscando candidatos no TMDB...</div>}
          {!loading&&itens.length===0&&<div style={{textAlign:"center",padding:60,color:"#374151",fontSize:13}}>Configure e clique em "Carregar lote" para começar</div>}
          {itens.map(item=>(
            <div key={item.id} style={{marginBottom:16,background:item.ignorado?"#0b0d14":"#13151f",border:`1px solid ${item.ignorado?"#1a1a1a":"#1e2130"}`,borderRadius:10,padding:14,opacity:item.ignorado?0.4:1}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                {item.poster_tmdb_url||item.cover_url
                  ?<img src={item.poster_tmdb_url||item.cover_url||""} alt="" style={{width:36,height:54,objectFit:"cover",borderRadius:5,flexShrink:0}}/>
                  :<div style={{width:36,height:54,background:"#1e2130",borderRadius:5,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}><Film size={14} color="#374151"/></div>
                }
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:"#f1f5f9"}}>{item.titulo_normalizado}</div>
                  <div style={{display:"flex",gap:6,marginTop:3}}>
                    <span style={{fontSize:10,color:item.tmdb_confirmado?"#10b981":"#f59e0b"}}>{item.tmdb_confirmado?"TMDB ✓":"Sem TMDB"}</span>
                    {item.tmdb_id&&<span style={{fontSize:10,color:"#374151"}}>ID atual: {item.tmdb_id}</span>}
                  </div>
                </div>
                <button onClick={()=>setItens(p=>p.map(i=>i.id===item.id?{...i,ignorado:!i.ignorado}:i))}
                  style={{padding:"3px 10px",background:"#ef444415",border:"1px solid #ef444430",borderRadius:6,color:"#ef4444",fontSize:10,cursor:"pointer",flexShrink:0}}>
                  {item.ignorado?"Reativar":"Ignorar"}
                </button>
              </div>
              {/* Candidatos */}
              {!item.ignorado&&item.candidatos.length>0&&(
                <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4}}>
                  {item.candidatos.map(c=>{
                    const sel=item.escolhido===c.tmdb_id;
                    return(
                      <button key={c.tmdb_id} onClick={()=>setItens(p=>p.map(i=>i.id===item.id?{...i,escolhido:sel?null:c.tmdb_id}:i))}
                        style={{flexShrink:0,width:90,background:sel?"#6366f120":"#0f1117",border:`1.5px solid ${sel?"#6366f1":"#1e2130"}`,borderRadius:8,padding:6,cursor:"pointer",textAlign:"center",transition:"all 0.15s"}}>
                        {c.poster_url
                          ?<img src={c.poster_url} alt={c.titulo} style={{width:78,height:117,objectFit:"cover",borderRadius:5,marginBottom:5,display:"block"}}/>
                          :<div style={{width:78,height:117,background:"#1e2130",borderRadius:5,marginBottom:5,display:"flex",alignItems:"center",justifyContent:"center"}}><Film size={16} color="#374151"/></div>
                        }
                        <div style={{fontSize:9,color:sel?"#818cf8":"#94a3b8",lineHeight:1.3,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{c.titulo}</div>
                        {c.ano&&<div style={{fontSize:9,color:"#475569",marginTop:2}}>{c.ano}</div>}
                        {sel&&<div style={{fontSize:9,color:"#6366f1",marginTop:2,fontWeight:700}}>✓ Selecionado</div>}
                      </button>
                    );
                  })}
                </div>
              )}
              {!item.ignorado&&item.candidatos.length===0&&<div style={{fontSize:11,color:"#374151",padding:"4px 0"}}>Sem candidatos encontrados</div>}
            </div>
          ))}
        </div>

        {/* Footer */}
        {itens.length>0&&(
          <div style={{padding:"12px 20px",borderTop:"1px solid #1e2130",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
            <div style={{fontSize:12,color:"#475569"}}>{pendentes} título(s) com seleção pronta</div>
            <button onClick={salvarEscolhas} disabled={salvando||pendentes===0}
              style={{padding:"7px 20px",background:pendentes>0?"#10b981":"#1a1d2e",border:"none",borderRadius:8,color:pendentes>0?"#fff":"#374151",fontSize:12,fontWeight:600,cursor:pendentes>0&&!salvando?"pointer":"not-allowed",display:"flex",alignItems:"center",gap:6}}>
              {salvando?<><RefreshCw size={11} style={{animation:"spin 1s linear infinite"}}/>Salvando...</>:`Salvar ${pendentes} escolha(s)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Busca EPG canais ─────────────────────────────────────────────────────────
function ResultadoBuscaEPG({epg,busca,progsPorCanal,onClear}:{epg:EpgData;busca:string;progsPorCanal:Map<string,Programa[]>;onClear:()=>void}) {
  const [detalhe,setDetalhe]=useState<null|{tipo:"canal";canal:Canal}|{tipo:"programa";titulo:string}>(null);
  const agora=Date.now();
  const canaisMatch=useMemo(()=>epg.canais.filter(c=>normalizar(c.nome).includes(normalizar(busca))||normalizar(c.display_name).includes(normalizar(busca))),[epg,busca]);
  const programasMatch=useMemo(()=>{const titulos=new Map<string,{prog:Programa;canal:Canal}[]>();const cmap=new Map(epg.canais.map(c=>[c.id,c]));for(const p of epg.programas){if(!normalizar(p.title).includes(normalizar(busca)))continue;const c=cmap.get(p.channel_id);if(!c)continue;const arr=titulos.get(p.title)||[];arr.push({prog:p,canal:c});titulos.set(p.title,arr);}return[...titulos.entries()].map(([titulo,items])=>({titulo,items:items.sort((a,b)=>new Date(a.prog.start).getTime()-new Date(b.prog.start).getTime())})).sort((a,b)=>b.items.length-a.items.length);},[epg,busca]);
  const progCanal=useMemo(()=>{if(detalhe?.tipo!=="canal")return[];const fim=agora+24*3600000;return(progsPorCanal.get(detalhe.canal.id)||[]).filter(p=>new Date(p.stop).getTime()>agora&&new Date(p.start).getTime()<fim).sort((a,b)=>new Date(a.start).getTime()-new Date(b.start).getTime());},[detalhe,progsPorCanal,agora]);
  if(detalhe?.tipo==="canal")return(<div style={{padding:"16px 20px"}}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}><button onClick={()=>setDetalhe(null)} style={{display:"flex",alignItems:"center",gap:5,padding:"5px 10px",background:"#1a1d2e",border:"1px solid #252840",borderRadius:7,color:"#94a3b8",fontSize:12,cursor:"pointer"}}>← Voltar</button><Logo src={detalhe.canal.icon} nome={detalhe.canal.nome} categoria={detalhe.canal.categoria} size={32}/><div><div style={{fontSize:15,fontWeight:700,color:"#f1f5f9"}}>{detalhe.canal.nome}</div><div style={{fontSize:11,color:"#475569"}}>{detalhe.canal.categoria}</div></div><button onClick={onClear} style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:5,padding:"5px 10px",background:"#111",border:"1px solid #1e1e2e",borderRadius:7,color:"#475569",fontSize:12,cursor:"pointer"}}><X size={12}/> Nova busca</button></div><div style={{display:"flex",flexDirection:"column",gap:6}}>{progCanal.map((p,i)=>{const emAnd=agora>=new Date(p.start).getTime()&&agora<=new Date(p.stop).getTime();const cor=CAT_COR[detalhe.canal.categoria]||"#6b7280";return(<div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:8,background:emAnd?cor+"12":"#0f0f0f",border:`1px solid ${emAnd?cor+"40":"#1a1a1a"}`}}>{emAnd&&<div style={{fontSize:10,fontWeight:700,color:cor,background:cor+"20",padding:"2px 7px",borderRadius:20,flexShrink:0}}>AO VIVO</div>}<span style={{fontSize:13,color:"#64748b",flexShrink:0,minWidth:90}}>{formatHora(p.start)} – {formatHora(p.stop)}</span><span style={{fontSize:13,fontWeight:emAnd?600:400,color:emAnd?"#f1f5f9":"#94a3b8",flex:1}}>{p.title}</span><span style={{fontSize:11,color:"#374151",flexShrink:0}}>{p.duracao_min} min</span></div>);})}  {progCanal.length===0&&<div style={{textAlign:"center",padding:30,color:"#374151",fontSize:13}}>Sem programação disponível</div>}</div></div>);
  if(detalhe?.tipo==="programa"){const ocorrencias=programasMatch.find(p=>p.titulo===detalhe.titulo)?.items||[];return(<div style={{padding:"16px 20px"}}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}><button onClick={()=>setDetalhe(null)} style={{display:"flex",alignItems:"center",gap:5,padding:"5px 10px",background:"#1a1d2e",border:"1px solid #252840",borderRadius:7,color:"#94a3b8",fontSize:12,cursor:"pointer"}}>← Voltar</button><div style={{flex:1}}><div style={{fontSize:15,fontWeight:700,color:"#f1f5f9"}}>{detalhe.titulo}</div><div style={{fontSize:11,color:"#475569"}}>{ocorrencias.length} exibição(ões)</div></div><button onClick={onClear} style={{display:"flex",alignItems:"center",gap:5,padding:"5px 10px",background:"#111",border:"1px solid #1e1e2e",borderRadius:7,color:"#475569",fontSize:12,cursor:"pointer"}}><X size={12}/> Nova busca</button></div><div style={{display:"flex",flexDirection:"column",gap:6}}>{ocorrencias.map((item,i)=>{const emAnd=agora>=new Date(item.prog.start).getTime()&&agora<=new Date(item.prog.stop).getTime();const passou=agora>new Date(item.prog.stop).getTime();const corCanal=CAT_COR[item.canal.categoria]||"#6b7280";return(<div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:8,background:emAnd?corCanal+"12":"#0f0f0f",border:`1px solid ${emAnd?corCanal+"40":"#1a1a1a"}`,opacity:passou?0.45:1}}><Logo src={item.canal.icon} nome={item.canal.nome} categoria={item.canal.categoria} size={32}/><div style={{minWidth:110,flexShrink:0}}><div style={{fontSize:12,fontWeight:600,color:"#bbb"}}>{item.canal.nome}</div><div style={{fontSize:10,color:"#475569"}}>{item.canal.categoria}</div></div>{emAnd&&<div style={{fontSize:10,fontWeight:700,color:corCanal,background:corCanal+"20",padding:"2px 7px",borderRadius:20}}>AO VIVO</div>}<span style={{fontSize:13,color:"#64748b",flexShrink:0}}>{formatHora(item.prog.start)} – {formatHora(item.prog.stop)}</span><span style={{fontSize:11,color:"#374151",flexShrink:0,marginLeft:"auto"}}>{item.prog.duracao_min} min</span></div>);})}</div></div>);}
  return(<div style={{padding:"16px 20px"}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}><div style={{fontSize:13,color:"#94a3b8"}}>Resultados para <span style={{color:"#f1f5f9",fontWeight:600}}>"{busca}"</span></div><button onClick={onClear} style={{display:"flex",alignItems:"center",gap:5,padding:"6px 12px",background:"#111",border:"1px solid #1e1e2e",borderRadius:8,color:"#475569",fontSize:12,cursor:"pointer"}}><X size={13}/> Limpar</button></div>{canaisMatch.length>0&&(<div style={{marginBottom:20}}><div style={{fontSize:11,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>📺 Canais ({canaisMatch.length})</div><div style={{display:"flex",flexDirection:"column",gap:6}}>{canaisMatch.map(canal=>{const progsCanal=progsPorCanal.get(canal.id)||[];const atual=progsCanal.find(p=>agora>=new Date(p.start).getTime()&&agora<=new Date(p.stop).getTime());return(<div key={canal.id} onClick={()=>setDetalhe({tipo:"canal",canal})} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:8,cursor:"pointer",background:"#0f0f0f",border:"1px solid #1a1a1a"}} onMouseEnter={e=>{(e.currentTarget as HTMLDivElement).style.background="#161616";}} onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.background="#0f0f0f";}}><Logo src={canal.icon} nome={canal.nome} categoria={canal.categoria} size={36}/><div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>{canal.nome}</div><div style={{fontSize:11,color:"#475569",marginTop:2}}>{canal.categoria}{atual?` · ${atual.title}`:""}</div></div><span style={{fontSize:11,color:"#374151"}}>Ver →</span></div>);})}</div></div>)}{programasMatch.length>0&&(<div><div style={{fontSize:11,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>🎬 Programas ({programasMatch.length})</div><div style={{display:"flex",flexDirection:"column",gap:6}}>{programasMatch.map(({titulo,items})=>{const emAr=items.some(i=>agora>=new Date(i.prog.start).getTime()&&agora<=new Date(i.prog.stop).getTime());return(<div key={titulo} onClick={()=>setDetalhe({tipo:"programa",titulo})} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:8,cursor:"pointer",background:emAr?"#6366f112":"#0f0f0f",border:`1px solid ${emAr?"#6366f140":"#1a1a1a"}`}} onMouseEnter={e=>(e.currentTarget as HTMLDivElement).style.background=emAr?"#6366f120":"#161616"} onMouseLeave={e=>(e.currentTarget as HTMLDivElement).style.background=emAr?"#6366f112":"#0f0f0f"}><div style={{flex:1}}><div style={{display:"flex",alignItems:"center",gap:8}}>{emAr&&<div style={{fontSize:10,fontWeight:700,color:"#6366f1",background:"#6366f120",padding:"2px 7px",borderRadius:20}}>AO VIVO</div>}<span style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>{titulo}</span></div><div style={{fontSize:11,color:"#475569",marginTop:2}}>{items.length} canal(is)</div></div><span style={{fontSize:11,color:"#374151"}}>Ver →</span></div>);})}</div></div>)}{canaisMatch.length===0&&programasMatch.length===0&&(<div style={{textAlign:"center",padding:"40px 0",color:"#374151"}}><Search size={24} style={{margin:"0 auto 10px",display:"block",opacity:0.3}}/><div style={{fontSize:13}}>Nenhum resultado para "{busca}"</div></div>)}</div>);
}

// ─── Aba Canais ───────────────────────────────────────────────────────────────
function AbaCanais({epg,progsPorCanal,syncing,onSync,syncMsg}:{epg:EpgData;progsPorCanal:Map<string,Programa[]>;syncing:boolean;onSync:()=>void;syncMsg:{tipo:"ok"|"err";texto:string}|null}) {
  const [catAtiva,setCatAtiva]=useState("Todos");
  const [subAtiva,setSubAtiva]=useState("Todos");
  const [busca,setBusca]=useState("");
  const [buscaAtiva,setBuscaAtiva]=useState("");
  const [catOpen,setCatOpen]=useState(false);
  const catRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{function h(e:MouseEvent){if(catRef.current&&!catRef.current.contains(e.target as Node))setCatOpen(false);}document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[]);
  const catsDisponiveis=useMemo(()=>{const s=new Set(epg.canais.map(c=>c.categoria));return CATS_ORDEM.filter(c=>s.has(c));},[epg]);
  const canaisFiltrados=useMemo(()=>{let lista=epg.canais;if(catAtiva!=="Todos")lista=lista.filter(c=>c.categoria===catAtiva);if(subAtiva!=="Todos"){const sg=(SUBGRUPOS[catAtiva]||[]).find(s=>s.label===subAtiva);if(sg)lista=lista.filter(c=>sg.match.some(m=>c.display_name.toUpperCase().includes(m)));}return lista;},[epg,catAtiva,subAtiva]);
  const emBusca=buscaAtiva.trim().length>0;
  const subgruposDisponiveis=SUBGRUPOS[catAtiva]||[];
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}>
      <div style={{flexShrink:0,background:"#0b0d14",borderBottom:"1px solid #1e2130"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",flexWrap:"wrap"}}>
          <div ref={catRef} style={{position:"relative"}}>
            <button onClick={()=>setCatOpen(o=>!o)} style={{display:"flex",alignItems:"center",gap:5,height:32,padding:"0 10px",background:catAtiva!=="Todos"?(CAT_COR[catAtiva]+"20"):"#1a1d2e",border:`1px solid ${catAtiva!=="Todos"?CAT_COR[catAtiva]+"50":"#252840"}`,borderRadius:20,cursor:"pointer",color:catAtiva!=="Todos"?CAT_COR[catAtiva]:"#94a3b8",fontSize:12,fontWeight:catAtiva!=="Todos"?600:400,whiteSpace:"nowrap"}}>
              {catAtiva==="Todos"?"Categoria":catAtiva}<ChevronDown size={12} style={{opacity:0.6,transform:catOpen?"rotate(180deg)":"none",transition:"transform 0.15s"}}/>
            </button>
            {catOpen&&(<div onClick={()=>setCatOpen(false)} style={{position:"absolute",top:"calc(100% + 6px)",left:0,minWidth:200,background:"#13151f",border:"1px solid #1e2130",borderRadius:10,zIndex:200,overflow:"hidden",boxShadow:"0 12px 40px rgba(0,0,0,0.7)",maxHeight:280,overflowY:"auto"}}>
              {[{value:"Todos",label:"Todas as categorias"},...catsDisponiveis.map(c=>({value:c,label:c}))].map(opt=>(<button key={opt.value} onClick={()=>{setCatAtiva(opt.value);setSubAtiva("Todos");}} style={{display:"block",width:"100%",padding:"8px 14px",background:catAtiva===opt.value?"#1e2130":"none",border:"none",textAlign:"left",cursor:"pointer",color:catAtiva===opt.value?"#f1f5f9":"#94a3b8",fontSize:13,borderLeft:`3px solid ${catAtiva===opt.value?(CAT_COR[opt.value]||"#6366f1"):"transparent"}`}} onMouseEnter={e=>(e.currentTarget.style.background="#1e2130")} onMouseLeave={e=>(e.currentTarget.style.background=catAtiva===opt.value?"#1e2130":"none")}>{opt.label}</button>))}
            </div>)}
          </div>
          {catAtiva!=="Todos"&&<button onClick={()=>{setCatAtiva("Todos");setSubAtiva("Todos");}} style={{display:"flex",alignItems:"center",gap:3,padding:"4px 8px",background:"#ef444415",border:"1px solid #ef444430",borderRadius:6,color:"#ef4444",fontSize:11,cursor:"pointer"}}><X size={10}/> Limpar</button>}
          {subgruposDisponiveis.length>0&&<div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{subgruposDisponiveis.map(sg=><button key={sg.label} onClick={()=>setSubAtiva(s=>s===sg.label?"Todos":sg.label)} style={{padding:"4px 10px",borderRadius:20,border:`1px solid ${subAtiva===sg.label?CAT_COR[catAtiva]||"#6366f1":"#252840"}`,background:subAtiva===sg.label?(CAT_COR[catAtiva]||"#6366f1")+"20":"transparent",color:subAtiva===sg.label?CAT_COR[catAtiva]||"#6366f1":"#64748b",fontSize:11,cursor:"pointer"}}>{sg.label}</button>)}</div>}
          <div style={{position:"relative",flex:1,minWidth:120}}>
            <Search size={12} style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",color:"#475569",pointerEvents:"none"}}/>
            <input value={busca} onChange={e=>{setBusca(e.target.value);if(!e.target.value.trim())setBuscaAtiva("");}} onKeyDown={e=>e.key==="Enter"&&setBuscaAtiva(busca.trim())} placeholder="Buscar..." style={{width:"100%",height:32,paddingLeft:26,paddingRight:busca?26:8,background:"#1a1d2e",border:`1px solid ${emBusca?"#6366f1":"#252840"}`,borderRadius:7,fontSize:12,color:"#e2e8f0",outline:"none",boxSizing:"border-box"}}/>
            {busca&&<button onClick={()=>{setBusca("");setBuscaAtiva("");}} style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"#475569",display:"flex"}}><X size={11}/></button>}
          </div>
          <button onClick={()=>setBuscaAtiva(busca.trim())} style={{height:32,padding:"0 12px",background:"#6366f1",border:"none",borderRadius:7,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",flexShrink:0}}>Buscar</button>
          <button onClick={onSync} disabled={syncing} style={{display:"flex",alignItems:"center",gap:4,height:32,padding:"0 10px",background:syncing?"#1a1d2e":"#10b98115",border:`1px solid ${syncing?"#252840":"#10b98140"}`,borderRadius:7,cursor:syncing?"not-allowed":"pointer",color:syncing?"#374151":"#10b981",fontSize:11,fontWeight:500,flexShrink:0}}>
            <RefreshCw size={11} style={{animation:syncing?"spin 1s linear infinite":"none"}}/> Sync EPG
          </button>
        </div>
        {syncMsg&&(<div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 16px",background:syncMsg.tipo==="ok"?"#10b98115":"#ef444415",borderTop:`1px solid ${syncMsg.tipo==="ok"?"#10b98130":"#ef444430"}`,fontSize:12,color:syncMsg.tipo==="ok"?"#10b981":"#ef4444"}}>{syncMsg.tipo==="ok"?<CheckCircle size={12}/>:<AlertTriangle size={12}/>}{syncMsg.texto}</div>)}
      </div>
      {emBusca?<div style={{flex:1,overflowY:"auto"}}><ResultadoBuscaEPG epg={epg} busca={buscaAtiva} progsPorCanal={progsPorCanal} onClear={()=>{setBusca("");setBuscaAtiva("");}}/></div>:canaisFiltrados.length===0?<div style={{textAlign:"center",padding:60,color:"#374151",fontSize:13}}>Nenhum canal encontrado.</div>:<GradeEPG canais={canaisFiltrados} progsPorCanal={progsPorCanal}/>}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
// Sem top bar própria — tudo fica no AdminShell
const SERVIDOR_ADMIN: ServidorId | "TODOS" = "TODOS";
export type GuiaTVTab = "canais" | "filmes" | "series";

export default function GuiaTVPage() {
  // A tab pode vir via searchParams para o AdminShell poder controlar
  const [tab,setTab]=useState<GuiaTVTab>("canais");
  const [epg,setEpg]=useState<EpgData|null>(null);
  const [loadingEpg,setLoadingEpg]=useState(true);
  const [erroEpg,setErroEpg]=useState<string|null>(null);
  const [syncing,setSyncing]=useState(false);
  const [syncMsg,setSyncMsg]=useState<{tipo:"ok"|"err";texto:string}|null>(null);
  const [showCatalogo,setShowCatalogo]=useState(false);
  const [showTmdbLote,setShowTmdbLote]=useState(false);

  // Listener para abrir revisão em lote via evento (disparado pelo ModalCatalogo)
  useEffect(()=>{
    const h=()=>setShowTmdbLote(true);
    window.addEventListener("OPEN_TMDB_LOTE",h);
    return()=>window.removeEventListener("OPEN_TMDB_LOTE",h);
  },[]);

  // Expõe tab e setter para o AdminShell via evento customizado
  useEffect(()=>{
    const handler=(e:Event)=>{const t=(e as CustomEvent).detail as GuiaTVTab;setTab(t);};
    window.addEventListener("GUIA_TV_SET_TAB",handler);
    // Anuncia que a página está pronta
    window.dispatchEvent(new CustomEvent("GUIA_TV_READY",{detail:tab}));
    return()=>window.removeEventListener("GUIA_TV_SET_TAB",handler);
  },[]);

  useEffect(()=>{window.dispatchEvent(new CustomEvent("GUIA_TV_TAB_CHANGED",{detail:tab}));},[tab]);

  useEffect(()=>{
    setLoadingEpg(true);setErroEpg(null);
    fetch(`${process.env.NEXT_PUBLIC_R2_DEV_URL}/epg/epg_br.json?t=${Date.now()}`,{cache:"no-store"})
      .then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();}).then(setEpg)
      .catch(()=>setErroEpg("Grade não encontrada. Rode o Sync EPG.")).finally(()=>setLoadingEpg(false));
  },[]);

  const progsPorCanal=useMemo(()=>{
    if(!epg)return new Map<string,Programa[]>();
    const map=new Map<string,Programa[]>();
    const brtMs=Date.now()-3*3600000;const ini=brtMs-6*3600000,fim=brtMs+24*3600000;
    for(const p of epg.programas){const s=new Date(p.start).getTime(),e=new Date(p.stop).getTime();if(e<ini||s>fim)continue;const arr=map.get(p.channel_id)||[];arr.push(p);map.set(p.channel_id,arr);}
    return map;
  },[epg]);

  async function handleSync(){
    setSyncing(true);setSyncMsg(null);
    try{const d=await fetch("/api/epg/sync",{method:"POST"}).then(r=>r.json());if(d.ok){setSyncMsg({tipo:"ok",texto:`EPG sincronizado em ${d.duracao_s}s`});setTimeout(()=>window.location.reload(),1800);}else setSyncMsg({tipo:"err",texto:d.error||"Sync falhou"});}
    catch(e:any){setSyncMsg({tipo:"err",texto:e.message});}finally{setSyncing(false);}
  }

  return (
    <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 57px)",background:"#0f1117",color:"#cbd5e1",overflow:"hidden"}}>

      {/* Barra de sub-navegação interna — tabs + catálogo */}
      <div style={{flexShrink:0,background:"#050505",borderBottom:"1px solid #ffffff10"}}>
        <div style={{display:"flex",alignItems:"center",padding:"0 16px",height:46,gap:4}}>
          {(["canais","filmes","series"] as GuiaTVTab[]).map(t=>(
            <button key={t} onClick={()=>setTab(t)}
              style={{display:"flex",alignItems:"center",gap:6,padding:"5px 18px",borderRadius:8,border:tab===t?"1px solid #6366f140":"1px solid transparent",background:tab===t?"#6366f115":"transparent",color:tab===t?"#818cf8":"#64748b",fontSize:13,fontWeight:tab===t?600:400,cursor:"pointer",transition:"all 0.15s",whiteSpace:"nowrap",textTransform:"capitalize"}}>
              {t==="canais"?<><Tv size={14}/> Canais</>:t==="filmes"?<><Film size={14}/> Filmes</>:<><Clapperboard size={14}/> Séries</>}
            </button>
          ))}
          <div style={{flex:1}}/>
          <button onClick={()=>setShowCatalogo(true)}
            style={{display:"flex",alignItems:"center",gap:4,height:30,padding:"0 12px",background:"#6366f115",border:"1px solid #6366f140",borderRadius:7,cursor:"pointer",color:"#818cf8",fontSize:11,fontWeight:500,flexShrink:0}}>
            <Database size={11}/> Catálogo
          </button>
        </div>
      </div>

      {/* Conteúdo */}
      {tab==="canais"&&(
        loadingEpg?<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,padding:80,color:"#374151",fontSize:13}}><RefreshCw size={16} style={{animation:"spin 1s linear infinite"}}/>Carregando...</div>
        :erroEpg?<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12,padding:80,textAlign:"center"}}><AlertTriangle size={28} color="#f59e0b"/><div style={{fontSize:14,color:"#bbb"}}>{erroEpg}</div><button onClick={handleSync} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 14px",background:"#10b98115",border:"1px solid #10b98130",borderRadius:8,color:"#10b981",fontSize:12,cursor:"pointer"}}><RefreshCw size={13}/>Sync EPG</button></div>
        :epg&&<AbaCanais epg={epg} progsPorCanal={progsPorCanal} syncing={syncing} onSync={handleSync} syncMsg={syncMsg}/>
      )}
      {tab==="filmes"&&<AbaCatalogo tipo="FILME" servidorAdmin={SERVIDOR_ADMIN}/>}
      {tab==="series"&&<AbaCatalogo tipo="SERIE" servidorAdmin={SERVIDOR_ADMIN}/>}

      {showCatalogo&&<ModalCatalogo onClose={()=>setShowCatalogo(false)}/>}
      {showTmdbLote&&<ModalTmdbLote onClose={()=>setShowTmdbLote(false)}/>}

      <style>{`
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#252840;border-radius:2px}
        *{-webkit-tap-highlight-color:transparent}
      `}</style>
    </div>
  );
}
