"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, RefreshCw, AlertTriangle, CheckCircle, X, Tv, ChevronDown, Database } from "lucide-react";

type Canal = { id: string; display_name: string; nome: string; categoria: string; icon: string; servidor: string; };
type Programa = { channel_id: string; channel_nome: string; categoria: string; start: string; stop: string; duracao_min: number; title: string; desc: string; prog_icon?: string; };
type EpgData = { gerado_em: string; total_canais: number; total_programas: number; canais: Canal[]; programas: Programa[]; };
type SyncResult = { filmes?: number; series_unicas?: number; episodios?: number; duracao_s?: number; error?: string; };
type CatalogInfo = { ultimo_sync: string | null; filmes: number; series_unicas: number; episodios: number; };

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
const TOTAL_HORAS = 48; // ontem meia-noite → depois de amanhã meia-noite

function nowBRT(): Date { return new Date(); }
function formatHora(iso: string) { return new Date(iso).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}); }
function formatDataHora(iso: string) { return new Date(iso).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}); }
function iniciais(nome: string) { return nome.split(" ").filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase(); }

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
        {prog.prog_icon&&<div style={{position:"relative",height:200,background:"#111"}}><img src={prog.prog_icon} alt={prog.title} style={{width:"100%",height:"100%",objectFit:"cover"}}/><div style={{position:"absolute",inset:0,background:"linear-gradient(to top,#161616 0%,transparent 60%)"}}/><button onClick={onClose} style={{position:"absolute",top:10,right:10,background:"rgba(0,0,0,0.6)",border:"none",cursor:"pointer",color:"#fff",borderRadius:"50%",width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center"}}><X style={{width:14,height:14}}/></button></div>}
        <div style={{padding:18}}>
          {!prog.prog_icon&&<div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}><button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:"#666"}}><X style={{width:16,height:16}}/></button></div>}
          <div style={{fontSize:13,color:"#777",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.5px"}}>{prog.channel_nome} · {prog.categoria}</div>
          <div style={{fontSize:19,fontWeight:600,color:"#fff",lineHeight:1.3,marginBottom:10}}>{prog.title}</div>
          <div style={{display:"flex",gap:8,marginBottom:prog.desc?12:0}}><span style={{fontSize:14,color:"#f59e0b",fontWeight:600}}>{formatHora(prog.start)} – {formatHora(prog.stop)}</span><span style={{fontSize:14,color:"#555"}}>· {prog.duracao_min} min</span></div>
          {prog.desc&&<div style={{fontSize:15,color:"#aaa",lineHeight:1.6}}>{prog.desc}</div>}
        </div>
      </div>
    </div>
  );
}

function ResultadoBusca({epg,busca,progsPorCanal,onClear}:{epg:EpgData;busca:string;progsPorCanal:Map<string,Programa[]>;onClear:()=>void}) {
  const [detalhe, setDetalhe] = useState<
    | null
    | {tipo:"canal"; canal:Canal}
    | {tipo:"programa"; titulo:string}
  >(null);

  const termo = busca.toLowerCase().trim();

  // Canais cujo nome contém o termo
  const canaisMatch = useMemo(()=>
    epg.canais.filter(c => c.nome.toLowerCase().includes(termo) || c.display_name.toLowerCase().includes(termo))
  ,[epg, termo]);

  // Programas cujo título contém o termo (títulos únicos)
  const programasMatch = useMemo(()=>{
    const titulos = new Map<string, {prog:Programa; canal:Canal}[]>();
    const cmap = new Map(epg.canais.map(c=>[c.id,c]));
    for(const p of epg.programas){
      if(!p.title.toLowerCase().includes(termo)) continue;
      const c = cmap.get(p.channel_id);
      if(!c) continue;
      const arr = titulos.get(p.title) || [];
      arr.push({prog:p, canal:c});
      titulos.set(p.title, arr);
    }
    return [...titulos.entries()]
      .map(([titulo, items])=>({titulo, items: items.sort((a,b)=>new Date(a.prog.start).getTime()-new Date(b.prog.start).getTime())}))
      .sort((a,b)=>b.items.length-a.items.length);
  },[epg, termo]);

  // Programação de um canal nas próximas 24h
  const progCanal = useMemo(()=>{
    if(detalhe?.tipo !== "canal") return [];
    const agora = Date.now();
    const fim = agora + 24*3600000;
    return (progsPorCanal.get(detalhe.canal.id) || [])
      .filter(p => new Date(p.stop).getTime() > agora && new Date(p.start).getTime() < fim)
      .sort((a,b)=>new Date(a.start).getTime()-new Date(b.start).getTime());
  },[detalhe, progsPorCanal]);

  const agora = Date.now();
  const cor = detalhe?.tipo==="canal" ? (CAT_COR[detalhe.canal.categoria]||"#6b7280") : "#6366f1";

  // ── Detalhe de canal ──────────────────────────────────────────────────────
  if(detalhe?.tipo==="canal"){
    return (
      <div style={{padding:"16px 20px"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          <button onClick={()=>setDetalhe(null)} style={{display:"flex",alignItems:"center",gap:5,padding:"5px 10px",background:"#1a1d2e",border:"1px solid #252840",borderRadius:7,color:"#94a3b8",fontSize:12,cursor:"pointer"}}>
            ← Voltar
          </button>
          <Logo src={detalhe.canal.icon} nome={detalhe.canal.nome} categoria={detalhe.canal.categoria} size={32}/>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:"#f1f5f9"}}>{detalhe.canal.nome}</div>
            <div style={{fontSize:11,color:"#475569"}}>{detalhe.canal.categoria} · próximas 24h</div>
          </div>
          <button onClick={onClear} style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:5,padding:"5px 10px",background:"#111",border:"1px solid #1e1e2e",borderRadius:7,color:"#475569",fontSize:12,cursor:"pointer"}}><X style={{width:12,height:12}}/> Nova busca</button>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {progCanal.length===0&&<div style={{textAlign:"center",padding:40,color:"#374151",fontSize:13}}>Sem programação disponível</div>}
          {progCanal.map((p,i)=>{
            const emAnd = agora>=new Date(p.start).getTime()&&agora<=new Date(p.stop).getTime();
            return (
              <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:8,background:emAnd?cor+"12":"#0f0f0f",border:`1px solid ${emAnd?cor+"40":"#1a1a1a"}`}}>
                {emAnd&&<div style={{display:"flex",alignItems:"center",gap:4,fontSize:10,fontWeight:700,color:cor,background:cor+"20",padding:"2px 7px",borderRadius:20,flexShrink:0,whiteSpace:"nowrap"}}><div style={{width:5,height:5,borderRadius:"50%",background:cor,animation:"pulse 1s infinite"}}/> AO VIVO</div>}
                <span style={{fontSize:13,color:"#64748b",flexShrink:0,minWidth:90}}>{formatHora(p.start)} – {formatHora(p.stop)}</span>
                <span style={{fontSize:13,fontWeight:emAnd?600:400,color:emAnd?"#f1f5f9":"#94a3b8",flex:1}}>{p.title}</span>
                <span style={{fontSize:11,color:"#374151",flexShrink:0}}>{p.duracao_min} min</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Detalhe de programa ───────────────────────────────────────────────────
  if(detalhe?.tipo==="programa"){
    const ocorrencias = programasMatch.find(p=>p.titulo===detalhe.titulo)?.items || [];
    return (
      <div style={{padding:"16px 20px"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          <button onClick={()=>setDetalhe(null)} style={{display:"flex",alignItems:"center",gap:5,padding:"5px 10px",background:"#1a1d2e",border:"1px solid #252840",borderRadius:7,color:"#94a3b8",fontSize:12,cursor:"pointer"}}>
            ← Voltar
          </button>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:700,color:"#f1f5f9"}}>{detalhe.titulo}</div>
            <div style={{fontSize:11,color:"#475569"}}>{ocorrencias.length} exibição{ocorrencias.length!==1?"ões":""} encontrada{ocorrencias.length!==1?"s":""}</div>
          </div>
          <button onClick={onClear} style={{display:"flex",alignItems:"center",gap:5,padding:"5px 10px",background:"#111",border:"1px solid #1e1e2e",borderRadius:7,color:"#475569",fontSize:12,cursor:"pointer"}}><X style={{width:12,height:12}}/> Nova busca</button>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {ocorrencias.map((item,i)=>{
            const emAnd = agora>=new Date(item.prog.start).getTime()&&agora<=new Date(item.prog.stop).getTime();
            const passou = agora>new Date(item.prog.stop).getTime();
            const corCanal = CAT_COR[item.canal.categoria]||"#6b7280";
            return (
              <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:8,background:emAnd?corCanal+"12":"#0f0f0f",border:`1px solid ${emAnd?corCanal+"40":"#1a1a1a"}`,opacity:passou?0.45:1}}>
                <Logo src={item.canal.icon} nome={item.canal.nome} categoria={item.canal.categoria} size={32}/>
                <div style={{minWidth:130,flexShrink:0}}>
                  <div style={{fontSize:12,fontWeight:600,color:"#bbb"}}>{item.canal.nome}</div>
                  <div style={{fontSize:10,color:"#475569"}}>{item.canal.categoria}</div>
                </div>
                {emAnd&&<div style={{display:"flex",alignItems:"center",gap:4,fontSize:10,fontWeight:700,color:corCanal,background:corCanal+"20",padding:"2px 7px",borderRadius:20,flexShrink:0}}><div style={{width:5,height:5,borderRadius:"50%",background:corCanal,animation:"pulse 1s infinite"}}/> AO VIVO</div>}
                <span style={{fontSize:13,color:"#64748b",flexShrink:0}}>{formatHora(item.prog.start)} – {formatHora(item.prog.stop)}</span>
                <span style={{fontSize:11,color:"#374151",flexShrink:0,marginLeft:"auto"}}>{item.prog.duracao_min} min</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Lista de resultados ───────────────────────────────────────────────────
  return (
    <div style={{padding:"16px 20px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
        <div style={{fontSize:13,color:"#94a3b8"}}>Resultados para <span style={{color:"#f1f5f9",fontWeight:600}}>"{busca}"</span></div>
        <button onClick={onClear} style={{display:"flex",alignItems:"center",gap:5,padding:"6px 12px",background:"#111",border:"1px solid #1e1e2e",borderRadius:8,color:"#475569",fontSize:12,cursor:"pointer"}}><X style={{width:13,height:13}}/> Limpar</button>
      </div>

      {/* Seção Canais */}
      {canaisMatch.length>0&&(
        <div style={{marginBottom:24}}>
          <div style={{fontSize:11,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:"0.8px",marginBottom:10}}>
            📺 Canais ({canaisMatch.length})
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {canaisMatch.map(canal=>{
              const cor = CAT_COR[canal.categoria]||"#6b7280";
              const progsCanal = progsPorCanal.get(canal.id)||[];
              const atual = progsCanal.find(p=>agora>=new Date(p.start).getTime()&&agora<=new Date(p.stop).getTime());
              return (
                <div key={canal.id} onClick={()=>setDetalhe({tipo:"canal",canal})}
                  style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:8,cursor:"pointer",background:"#0f0f0f",border:"1px solid #1a1a1a"}}
                  onMouseEnter={e=>{(e.currentTarget as HTMLDivElement).style.background="#161616";(e.currentTarget as HTMLDivElement).style.borderColor=cor+"40";}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.background="#0f0f0f";(e.currentTarget as HTMLDivElement).style.borderColor="#1a1a1a";}}>
                  <Logo src={canal.icon} nome={canal.nome} categoria={canal.categoria} size={36}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>{canal.nome}</div>
                    <div style={{fontSize:11,color:"#475569",marginTop:2}}>{canal.categoria}{atual?` · ${atual.title}`:""}</div>
                  </div>
                  <span style={{fontSize:11,color:"#374151"}}>Ver programação →</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Seção Programas */}
      {programasMatch.length>0&&(
        <div>
          <div style={{fontSize:11,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:"0.8px",marginBottom:10}}>
            🎬 Programas ({programasMatch.length})
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {programasMatch.map(({titulo,items})=>{
              const emAr = items.some(i=>agora>=new Date(i.prog.start).getTime()&&agora<=new Date(i.prog.stop).getTime());
              const proximo = items.find(i=>new Date(i.prog.start).getTime()>agora);
              return (
                <div key={titulo} onClick={()=>setDetalhe({tipo:"programa",titulo})}
                  style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:8,cursor:"pointer",background:emAr?"#6366f112":"#0f0f0f",border:`1px solid ${emAr?"#6366f140":"#1a1a1a"}`}}
                  onMouseEnter={e=>{(e.currentTarget as HTMLDivElement).style.background=emAr?"#6366f120":"#161616";}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.background=emAr?"#6366f112":"#0f0f0f";}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      {emAr&&<div style={{fontSize:10,fontWeight:700,color:"#6366f1",background:"#6366f120",padding:"2px 7px",borderRadius:20,flexShrink:0,display:"flex",alignItems:"center",gap:4}}><div style={{width:5,height:5,borderRadius:"50%",background:"#6366f1",animation:"pulse 1s infinite"}}/> AO VIVO</div>}
                      <span style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>{titulo}</span>
                    </div>
                    <div style={{fontSize:11,color:"#475569",marginTop:2}}>
                      {items.length} canal{items.length!==1?"is":""}
                      {proximo&&!emAr?` · próximo: ${formatHora(proximo.prog.start)} em ${proximo.canal.nome}`:""}
                    </div>
                  </div>
                  <span style={{fontSize:11,color:"#374151",flexShrink:0}}>Ver canais →</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {canaisMatch.length===0&&programasMatch.length===0&&(
        <div style={{textAlign:"center",padding:"60px 0",color:"#374151"}}>
          <Search style={{width:28,height:28,margin:"0 auto 12px",display:"block",opacity:0.3}}/>
          <div style={{fontSize:14}}>Nenhum resultado para "{busca}"</div>
        </div>
      )}
    </div>
  );
}

function GradeEPG({canais,progsPorCanal}:{canais:Canal[];progsPorCanal:Map<string,Programa[]>}) {
  const scrollRef=useRef<HTMLDivElement>(null);
  const [agora,setAgora]=useState(nowBRT);
  const [progSel,setProgSel]=useState<Programa|null>(null);
  const isMobile=typeof window!=="undefined"&&window.innerWidth<768;
  const [showNomes,setShowNomes]=useState(!isMobile);
  const canalW=showNomes?CANAL_COL_W:(isMobile?60:54);
  const linhaH=isMobile?80:LINHA_H;

  useEffect(()=>{const iv=setInterval(()=>setAgora(nowBRT()),60000);return()=>clearInterval(iv);},[]);

  const gradeWidth=TOTAL_HORAS*HORA_WIDTH;

  const baseMs=useMemo(()=>{
    // Meia-noite de hoje em BRT (UTC-3)
    const agora = new Date();
    const brtOffset = -3 * 60;
    const meianoite = new Date(agora);
    meianoite.setUTCHours(3, 0, 0, 0); // 03:00 UTC = 00:00 BRT
    // Se já passou da meia-noite BRT hoje, usa hoje; senão usa ontem
    if (meianoite.getTime() > agora.getTime()) {
      meianoite.setUTCDate(meianoite.getUTCDate() - 1);
    }
    return meianoite.getTime();
  },[]);

  const agoraOffsetPx=useMemo(()=>{
    return((agora.getTime()-baseMs)/60000)*PX_POR_MIN;
  },[agora,baseMs]);

  const horaLabels=useMemo(()=>
    Array.from({length:TOTAL_HORAS+1},(_,i)=>({
      x:i*HORA_WIDTH,
      label:new Date(baseMs+i*3600000).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}),
    }))
  ,[baseMs]);

  useEffect(()=>{
    if(scrollRef.current&&agoraOffsetPx>0)
      scrollRef.current.scrollLeft=Math.max(0,agoraOffsetPx-2*HORA_WIDTH);
  },[agoraOffsetPx]);

  return (
    <>
      {progSel&&<ProgramaTooltip prog={progSel} onClose={()=>setProgSel(null)}/>}
<div ref={scrollRef} style={{overflowX:"auto",overflowY:"auto",background:"#0f1117",flex:1,minHeight:0}}>
        <div style={{display:"inline-block",width:canalW+gradeWidth,maxWidth:canalW+gradeWidth}}>
          {/* Régua sticky no topo */}
          <div style={{position:"sticky",top:0,zIndex:30,display:"flex",height:REGUA_H,background:"#13151f",borderBottom:"1px solid #1e2130"}}>
            <div style={{width:canalW,flexShrink:0,position:"sticky",left:0,zIndex:31,background:"#13151f",borderRight:"1px solid #1e2130"}}/>
            <div style={{position:"relative",width:gradeWidth,flexShrink:0}}>
              {horaLabels.map((h,i)=>(
                <div key={i} style={{position:"absolute",left:h.x,top:0,height:"100%",display:"flex",alignItems:"center",paddingLeft:8,borderLeft:i>0?"1px solid #1e2130":"none"}}>
                  <span style={{fontSize:11,color:"#4a5568",whiteSpace:"nowrap"}}>{h.label}</span>
                </div>
              ))}
              <div style={{position:"absolute",left:agoraOffsetPx,top:0,width:2,height:"100%",background:"#ef4444"}}/>
            </div>
          </div>
          {/* Linhas de canal */}
          {canais.map(canal=>{
            const progs=(progsPorCanal.get(canal.id)||[]).sort((a,b)=>new Date(a.start).getTime()-new Date(b.start).getTime());
            const cor=CAT_COR[canal.categoria]||"#6b7280";
            const agoraBrtMs=agora.getTime()-3*3600000;
            return (
              <div key={canal.id} style={{display:"flex",height:linhaH,borderBottom:"1px solid #1a1d2e"}}>
                {/* Coluna canal sticky */}
                <div style={{width:canalW,flexShrink:0,position:"sticky",left:0,zIndex:20,background:"#0f1117",borderRight:"1px solid #1e2130",display:"flex",alignItems:"center",gap:showNomes?10:0,padding:showNomes?"0 12px":"0",justifyContent:showNomes?"flex-start":"center",cursor:isMobile?"pointer":"default",userSelect:"none"}}
                  onClick={()=>isMobile&&setShowNomes(v=>!v)}>
                  <Logo src={canal.icon} nome={canal.nome} categoria={canal.categoria} size={showNomes?(isMobile?40:34):(isMobile?50:44)}/>
                  {showNomes&&<span style={{fontSize:13,color:"#94a3b8",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{canal.nome}</span>}
                </div>
                {/* Área programas */}
                <div style={{position:"relative",width:gradeWidth,flexShrink:0}}>
                <div style={{position:"absolute",left:agoraOffsetPx,top:0,width:2,height:"100%",background:"#ef4444",zIndex:5,pointerEvents:"none"}}/>
                {horaLabels.map((h,i)=>i>0&&<div key={i} style={{position:"absolute",left:h.x,top:0,width:1,height:"100%",background:"#1e2130",pointerEvents:"none"}}/>)}
                {progs.length===0&&Array.from({length:Math.ceil(TOTAL_HORAS/2)},(_,i)=>(
                  <div key={i} style={{position:"absolute",left:i*2*HORA_WIDTH+1,width:2*HORA_WIDTH-6,top:5,bottom:5,borderRadius:5,background:"#141624",border:"1px solid #1e2130",display:"flex",alignItems:"center",justifyContent:"center",opacity:0.8}}>
                    <span style={{fontSize:13,color:"#64748b",fontWeight:500}}>Sem informação</span>
                  </div>
                ))}
                {progs.map(prog=>{
                  const sMs=new Date(prog.start).getTime();
                  const eMs=new Date(prog.stop).getTime();
                  const lRaw=((sMs-baseMs)/60000)*PX_POR_MIN;
                    const wRaw=Math.max(((eMs-sMs)/60000)*PX_POR_MIN-2,4);
                    const lPx=Math.max(lRaw,0);
                    const wPx=Math.max(wRaw-(lPx-lRaw),20);
                    const isAtual=agoraBrtMs>=sMs&&agoraBrtMs<=eMs;
                    return (
                      <div key={prog.start} onClick={()=>setProgSel(prog)}
                          style={{position:"absolute",left:lPx+1,width:wPx-2,top:5,bottom:5,borderRadius:5,cursor:"pointer",background:isAtual?cor+"22":"#1a1d2e",border:`1px solid ${isAtual?cor+"50":"#252840"}`,clipPath:"inset(0 round 5px)",display:"flex",alignItems:"center",transition:"background 0.1s"}}
                          onMouseEnter={e=>{(e.currentTarget as HTMLDivElement).style.background=isAtual?cor+"35":"#1e2130";(e.currentTarget as HTMLDivElement).style.borderColor=cor+"60";}}
                          onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.background=isAtual?cor+"22":"#1a1d2e";(e.currentTarget as HTMLDivElement).style.borderColor=isAtual?cor+"50":"#252840";}}>
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

function DropdownFiltro({label,ativo,cor,disabled,children}:{label:string;ativo:boolean;cor?:string;disabled?:boolean;children:React.ReactNode}) {
  const [open,setOpen]=useState(false);
  const ref=useRef<HTMLDivElement>(null);
  const c=cor||"#6366f1";
  useEffect(()=>{
    function h(e:MouseEvent){if(ref.current&&!ref.current.contains(e.target as Node))setOpen(false);}
    document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);
  },[]);
  return (
    <div ref={ref} style={{position:"relative",flexShrink:0, opacity: disabled ? 0.4 : 1}}>
      <button onClick={()=>!disabled && setOpen(o=>!o)} style={{display:"flex",alignItems:"center",gap:6,height:36,padding:"0 12px",background:ativo?c+"15":"#1a1d2e",border:`1px solid ${ativo?c+"50":"#252840"}`,borderRadius:8,cursor:disabled?"not-allowed":"pointer",color:ativo?c:"#94a3b8",fontSize:13,fontWeight:ativo?600:400,whiteSpace:"nowrap"}}>
        {label}<ChevronDown style={{width:13,height:13,opacity:0.6,transform:open?"rotate(180deg)":"none",transition:"transform 0.15s"}}/>
      </button>
      {open && !disabled &&(
        <div onClick={()=>setOpen(false)} style={{position:"absolute",top:"calc(100% + 6px)",left:0,minWidth:200,background:"#13151f",border:"1px solid #1e2130",borderRadius:10,zIndex:200,overflow:"hidden",boxShadow:"0 12px 40px rgba(0,0,0,0.7)",maxHeight:320,overflowY:"auto"}}>
          {children}
        </div>
      
      )}
    </div>
  );
}

// ─── Modal Sync Catálogo ──────────────────────────────────────────────────────
function ModalCatalogo({onClose}:{onClose:()=>void}) {
  type SrvId = "elite"|"natv"|"fast";
  type SrvStatus = "idle"|"running"|"ok"|"error";

  const [status, setStatus] = useState<Record<SrvId,SrvStatus>>({elite:"idle",natv:"idle",fast:"idle"});
  const [logs,   setLogs]   = useState<Record<SrvId,string[]>>({elite:[],natv:[],fast:[]});
  const [info,   setInfo]   = useState<Record<SrvId,CatalogInfo|null>>({elite:null,natv:null,fast:null});

  const addLog = (srv:SrvId, msg:string) => setLogs(p=>({...p,[srv]:[...p[srv],msg]}));

  useEffect(()=>{
    (["elite","natv","fast"] as SrvId[]).forEach(async srv=>{
      try{
        const d = await fetch(`/api/epg/sync-catalog/${srv}`).then(r=>r.json());
        if(d.resultado){
          setInfo(p=>({...p,[srv]:{
            ultimo_sync: d.executado_em || null,
            filmes:      d.resultado.filmes        || 0,
            series_unicas: d.resultado.series_unicas || 0,
            episodios:   d.resultado.episodios     || 0,
          }}));
        }
      }catch{}
    });
  },[]);

  async function syncElite(){
    setStatus(p=>({...p,elite:"running"}));
    setLogs(p=>({...p,elite:[]}));
    addLog("elite","↑ Conectando ao servidor Elite...");
    try{
      const d = await fetch("/api/epg/sync-catalog/elite",{method:"POST"}).then(r=>r.json());
      if(d.error) throw new Error(d.error);
      addLog("elite",`✓ Filmes: ${d.filmes ?? 0}`);
      addLog("elite",`✓ Séries únicas: ${d.series_unicas ?? 0}`);
      addLog("elite",`✓ Episódios: ${d.episodios ?? 0}`);
      addLog("elite",`✓ Novos títulos: ${d.novos_titulos ?? 0}`);
      addLog("elite",`✓ Novos episódios: ${d.novos_episodios ?? 0}`);
      addLog("elite",`✅ Concluído em ${d.duracao_s}s`);
      setInfo(p=>({...p,elite:{ultimo_sync:new Date().toISOString(),filmes:d.filmes??0,series_unicas:d.series_unicas??0,episodios:d.episodios??0}}));
      setStatus(p=>({...p,elite:"ok"}));
    }catch(e:any){addLog("elite",`❌ ${e.message}`);setStatus(p=>({...p,elite:"error"}));}
  }

  async function syncNaTV(){
    setStatus(p=>({...p,natv:"running"}));
    setLogs(p=>({...p,natv:[]}));
    addLog("natv","↑ Conectando ao servidor NaTV...");
    try{
      const d = await fetch("/api/epg/sync-catalog/natv",{method:"POST"}).then(r=>r.json());
      if(d.error) throw new Error(d.error);
      addLog("natv",`✓ Filmes: ${d.filmes ?? 0}`);
      addLog("natv",`✓ Séries únicas: ${d.series_unicas ?? 0}`);
      addLog("natv",`✓ Episódios: ${d.episodios ?? 0}`);
      addLog("natv",`✓ Novos títulos: ${d.novos_titulos ?? 0}`);
      addLog("natv",`✓ Novos episódios: ${d.novos_episodios ?? 0}`);
      addLog("natv",`✅ Concluído em ${d.duracao_s}s`);
      setInfo(p=>({...p,natv:{ultimo_sync:new Date().toISOString(),filmes:d.filmes??0,series_unicas:d.series_unicas??0,episodios:d.episodios??0}}));
      setStatus(p=>({...p,natv:"ok"}));
    }catch(e:any){addLog("natv",`❌ ${e.message}`);setStatus(p=>({...p,natv:"error"}));}
  }

  async function syncFast(){
    setStatus(p=>({...p,fast:"running"}));
    setLogs(p=>({...p,fast:[]}));
    addLog("fast","⬇ Buscando URL M3U do servidor Fast...");

    // Cole aqui o ID (UUID) exato que corresponde ao servidor Fast
    

    try {
      const res = await fetch(`/api/epg/sync-catalog/fast`);

      const data = await res.json();
      
      if (!data.m3u_url) {
        throw new Error("URL M3U não encontrada no banco de dados.");
      }

      addLog("fast","⬇ Baixando M3U via extensão...");

      // 2. Prepara os listeners
      function onResult(e:Event){
        const detail = (e as CustomEvent).detail;
        window.removeEventListener("UNIGESTOR_INTEGRATION_RESPONSE", onResult);
        if(!detail?.ok){
          addLog("fast",`❌ ${detail?.error||"Erro desconhecido"}`);
          setStatus(p=>({...p,fast:"error"}));
          return;
        }
        addLog("fast","↑ Processando em background...");
      }
      window.addEventListener("UNIGESTOR_INTEGRATION_RESPONSE", onResult);

      async function onDone(e:Event){
        const detail = (e as CustomEvent).detail;
        if(detail?.action !== "FAST_VOD_SYNC_RESULT") return;
        window.removeEventListener("UNIGESTOR_BACKGROUND_MESSAGE", onDone as any);
        if(!detail.ok){
          addLog("fast",`❌ ${detail.error}`);
          setStatus(p=>({...p,fast:"error"}));
          return;
        }
        addLog("fast",`✓ Filmes processados: ${detail.filmes ?? 0}`);
        addLog("fast",`✓ Séries únicas: ${detail.series ?? 0}`);
        addLog("fast",`✓ Episódios: ${detail.episodios ?? 0}`);
        // Busca novos do log salvo pelo finalizar
        try {
          const log = await fetch("/api/epg/sync-catalog/fast").then(r=>r.json());
          if(log.resultado?.novos_titulos !== undefined){
            addLog("fast",`✓ Novos títulos: ${log.resultado.novos_titulos}`);
            addLog("fast",`✓ Novos episódios: ${log.resultado.novos_episodios}`);
          }
        } catch {}
        addLog("fast","✅ Concluído!");
        setInfo(p=>({...p,fast:{ultimo_sync:new Date().toISOString(),filmes:detail.filmes??0,series_unicas:detail.series??0,episodios:detail.episodios??0}}));
        setStatus(p=>({...p,fast:"ok"}));
      }
      window.addEventListener("UNIGESTOR_BACKGROUND_MESSAGE", onDone);


      // 3. Dispara o evento passando a URL recebida
      window.dispatchEvent(new CustomEvent("UNIGESTOR_INTEGRATION_CALL",{
        detail:{
          action:"FAST_VOD_SYNC",
          m3uUrl: data.m3u_url.replace(/&output=ts$/i, "").replace(/&output=ts&/i, "&"),

          apiBase: window.location.origin,
        }
      }));

    } catch(e:any) {
      addLog("fast",`❌ ${e.message}`);
      setStatus(p=>({...p,fast:"error"}));
    }
  }

  const SERVIDORES: {id:SrvId;label:string;cor:string;onSync:()=>void}[] = [
    {id:"elite", label:"EliteTV",  cor:"#6366f1", onSync:syncElite},
    {id:"natv",  label:"NaTV",     cor:"#10b981", onSync:syncNaTV},
    {id:"fast",  label:"FastTV",   cor:"#f59e0b", onSync:syncFast},
  ];

  // ─── TMDB ────────────────────────────────────────────────────────────────
  const [tmdbStatus,   setTmdbStatus]   = useState<"idle"|"running"|"ok"|"error">("idle");
  const [tmdbLogs,     setTmdbLogs]     = useState<string[]>([]);
  const [tmdbLote,     setTmdbLote]     = useState<number>(50);
  const [tmdbInfo,     setTmdbInfo]     = useState<{filmes:{sem_tmdb:number;com_tmdb:number};series:{sem_tmdb:number;com_tmdb:number}}|null>(null);
  const [tmdbConfirm,  setTmdbConfirm]  = useState(false);
  const [tmdbTipo,     setTmdbTipo]     = useState<"FILME"|"SERIE">("FILME");

  const addTmdbLog = (msg:string) => setTmdbLogs(p=>[...p,msg]);

  useEffect(()=>{
    fetch('/api/epg/sync-tmdb').then(r=>r.json()).then(d=>{
      if(d.filmes) setTmdbInfo(d);
    }).catch(()=>{});
  },[]);

  async function syncTmdb(){
    setTmdbStatus("running");
    setTmdbLogs([]);
    setTmdbConfirm(false);

    let loteNum   = 1;
    let totalProc = 0;
    let totalEnc  = 0;
    let totalNao  = 0;

    addTmdbLog(`↑ Iniciando — ${tmdbTipo === "FILME" ? "Filmes" : "Séries"} · lote ${tmdbLote}`);

    try{
      while(true){
        const d = await fetch(`/api/epg/sync-tmdb?tipo=${tmdbTipo}&lote=${tmdbLote}`,{method:"POST"}).then(r=>r.json());

        if(d.error) throw new Error(d.error);

        if(d.processados === 0){
          addTmdbLog("✅ Todos os títulos já foram processados!");
          break;
        }

        totalProc += d.processados;
        totalEnc  += d.encontrados;
        totalNao  += d.nao_encontrados;
        loteNum++;

        // Atualiza a última linha em vez de empilhar
        setTmdbLogs(p => {
          const novo = [...p];
          novo[novo.length - 1] = `↻ Lote ${loteNum - 1} · ${totalProc} processados · ${totalEnc} encontrados · ${totalNao} não encontrados`;
          return novo;
        });

        if(!d.proximo_lote){
          addTmdbLog(`✅ Concluído! ${totalProc} processados · ${totalEnc} encontrados · ${totalNao} não encontrados`);
          break;
        }

        // 15 segundos entre lotes
        // Atualiza contador do card em tempo real
        const s = await fetch('/api/epg/sync-tmdb').then(r=>r.json());
        if(s.filmes) setTmdbInfo(s);

        // 10 segundos entre lotes
        await new Promise(r => setTimeout(r, 15_000));
      }

      const s = await fetch('/api/epg/sync-tmdb').then(r=>r.json());
      if(s.filmes) setTmdbInfo(s);
      setTmdbStatus("ok");

    }catch(e:any){
      addTmdbLog(`❌ ${e.message} (processados até agora: ${totalProc})`);
      setTmdbStatus("error");
    }
  }

  return (
    <div style={{position:"fixed",inset:0,zIndex:9998,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#13151f",border:"1px solid #1e2130",borderRadius:14,width:"100%",maxWidth:520,boxShadow:"0 24px 64px rgba(0,0,0,0.9)",overflow:"hidden"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:"1px solid #1e2130"}}>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:"#f1f5f9",display:"flex",alignItems:"center",gap:8}}>
              <Database style={{width:16,height:16,color:"#6366f1"}}/> Sincronizar Catálogo
            </div>
            <div style={{fontSize:11,color:"#475569",marginTop:3}}>Filmes e séries — rode cada servidor individualmente</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:"#475569"}}><X style={{width:16,height:16}}/></button>
        </div>

        <div style={{padding:16,display:"flex",flexDirection:"column",gap:12}}>
          {SERVIDORES.map(({id,label,cor,onSync})=>{
            const st = status[id];
            const lg = logs[id];
            const inf = info[id];
            const running = st==="running";
            return (
              <div key={id} style={{background:"#0f1117",border:`1px solid ${st==="ok"?cor+"40":st==="error"?"#ef444430":"#1e2130"}`,borderRadius:10,padding:14}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:7,height:7,borderRadius:"50%",background:st==="ok"?cor:st==="error"?"#ef4444":st==="running"?cor:"#374151",boxShadow:st==="running"?`0 0 8px ${cor}`:undefined,animation:st==="running"?"pulse 1s infinite":undefined}}/>
                      <span style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>{label}</span>
                    </div>
                    {inf && (
                      <div style={{fontSize:11,color:"#374151",marginTop:4,paddingLeft:15}}>
                        {inf.ultimo_sync ? `sync ${formatDataHora(inf.ultimo_sync)}` : "sem sync"} · {inf.filmes.toLocaleString()} filmes · {inf.series_unicas.toLocaleString()} séries · {inf.episodios.toLocaleString()} ep
                      </div>
                    )}
                  </div>
                  <button onClick={onSync} disabled={running} style={{display:"flex",alignItems:"center",gap:5,padding:"6px 12px",background:running?"#1a1d2e":cor+"20",border:`1px solid ${running?"#252840":cor+"50"}`,borderRadius:7,color:running?"#374151":cor,fontSize:12,fontWeight:600,cursor:running?"not-allowed":"pointer",flexShrink:0}}>
                    <RefreshCw style={{width:11,height:11,animation:running?"spin 1s linear infinite":"none"}}/>
                    {running?"Rodando...":"Sincronizar"}
                  </button>
                </div>
                {lg.length>0&&(
                  <div style={{marginTop:10,padding:"8px 10px",background:"#080808",borderRadius:6,border:"1px solid #141414"}}>
                    {lg.map((l,i)=>(
                      <div key={i} style={{fontSize:11,color:l.startsWith("❌")?"#ef4444":l.startsWith("✅")?"#10b981":"#64748b",lineHeight:1.6}}>{l}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Card TMDB */}
        <div style={{padding:"0 16px 12px"}}>
          <div style={{background:"#0f1117",border:`1px solid ${tmdbStatus==="ok"?"#f59e0b40":tmdbStatus==="error"?"#ef444430":"#1e2130"}`,borderRadius:10,padding:14}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:tmdbStatus==="ok"?"#f59e0b":tmdbStatus==="error"?"#ef4444":tmdbStatus==="running"?"#f59e0b":"#374151",animation:tmdbStatus==="running"?"pulse 1s infinite":undefined}}/>
                  <span style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>Enriquecimento TMDB</span>
                </div>
                {tmdbInfo && (
                  <div style={{fontSize:11,color:"#374151",marginTop:4,paddingLeft:15}}>
                    Filmes: {tmdbInfo.filmes.com_tmdb.toLocaleString()} com TMDB · {tmdbInfo.filmes.sem_tmdb.toLocaleString()} faltando
                    {" · "}Séries: {tmdbInfo.series.com_tmdb.toLocaleString()} com TMDB · {tmdbInfo.series.sem_tmdb.toLocaleString()} faltando
                  </div>
                )}
              </div>
              <button onClick={()=>setTmdbConfirm(v=>!v)} disabled={tmdbStatus==="running"} style={{display:"flex",alignItems:"center",gap:5,padding:"6px 12px",background:tmdbStatus==="running"?"#1a1d2e":"#f59e0b20",border:`1px solid ${tmdbStatus==="running"?"#252840":"#f59e0b50"}`,borderRadius:7,color:tmdbStatus==="running"?"#374151":"#f59e0b",fontSize:12,fontWeight:600,cursor:tmdbStatus==="running"?"not-allowed":"pointer",flexShrink:0}}>
                <RefreshCw style={{width:11,height:11,animation:tmdbStatus==="running"?"spin 1s linear infinite":"none"}}/>
                {tmdbStatus==="running"?"Rodando...":"Enriquecer"}
              </button>
            </div>

            {/* Painel de confirmação */}
            {tmdbConfirm && tmdbStatus !== "running" && (
              <div style={{marginTop:10,padding:"10px 12px",background:"#13151f",borderRadius:8,border:"1px solid #252840"}}>
                <div style={{fontSize:12,color:"#94a3b8",marginBottom:8}}>Configurar lote:</div>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                  {/* Tipo */}
                  <div style={{display:"flex",background:"#1a1d2e",padding:3,borderRadius:6,gap:3}}>
                    <button onClick={()=>setTmdbTipo("FILME")} style={{padding:"4px 10px",background:tmdbTipo==="FILME"?"#f59e0b":"transparent",color:tmdbTipo==="FILME"?"#000":"#64748b",border:"none",borderRadius:5,fontSize:11,fontWeight:600,cursor:"pointer"}}>Filmes</button>
                    <button onClick={()=>setTmdbTipo("SERIE")} style={{padding:"4px 10px",background:tmdbTipo==="SERIE"?"#f59e0b":"transparent",color:tmdbTipo==="SERIE"?"#000":"#64748b",border:"none",borderRadius:5,fontSize:11,fontWeight:600,cursor:"pointer"}}>Séries</button>
                  </div>
                  {/* Lote */}
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:11,color:"#64748b"}}>Lote:</span>
                    <input
                      type="number" min={5} max={100} value={tmdbLote}
                      onChange={e=>setTmdbLote(Math.min(100,Math.max(5,parseInt(e.target.value)||5)))}
                      style={{width:60,padding:"3px 6px",background:"#0f1117",border:"1px solid #252840",borderRadius:5,color:"#e2e8f0",fontSize:12,textAlign:"center"}}
                    />
                    <span style={{fontSize:10,color:"#374151"}}>(máx 100)</span>
                  </div>
                  <button onClick={syncTmdb} style={{marginLeft:"auto",padding:"5px 14px",background:"#f59e0b",border:"none",borderRadius:6,color:"#000",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                    Confirmar
                  </button>
                </div>
                {tmdbInfo && (
                  <div style={{fontSize:11,color:"#475569"}}>
                    {tmdbTipo==="FILME" ? tmdbInfo.filmes.sem_tmdb.toLocaleString() : tmdbInfo.series.sem_tmdb.toLocaleString()} {tmdbTipo === "FILME" ? "filmes" : "séries"} aguardando enriquecimento
                  </div>
                )}
              </div>
            )}

            {/* Logs */}
            {tmdbLogs.length>0&&(
              <div style={{marginTop:10,padding:"8px 10px",background:"#080808",borderRadius:6,border:"1px solid #141414"}}>
                {tmdbLogs.map((l,i)=>(
                  <div key={i} style={{fontSize:11,color:l.startsWith("❌")?"#ef4444":l.startsWith("✅")?"#10b981":l.startsWith("↻")?"#f59e0b":"#64748b",lineHeight:1.6}}>{l}</div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{padding:"10px 20px 16px",borderTop:"1px solid #1e2130"}}>
          <div style={{fontSize:11,color:"#374151",display:"flex",alignItems:"center",gap:6}}>
            <RefreshCw style={{width:10,height:10}}/> Títulos já existentes são ignorados — só novos são contabilizados
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function GuiaTVPage() {
  const [epg,setEpg]=useState<EpgData|null>(null);
  const [loading,setLoading]=useState(true);
  const [erro,setErro]=useState<string|null>(null);
  const [syncing,setSyncing]=useState(false);
  const [msg,setMsg]=useState<{tipo:"ok"|"err";texto:string}|null>(null);
  const [catAtiva,setCatAtiva]=useState("Todos");
  const [subAtiva,setSubAtiva]=useState("Todos");
  const [busca,setBusca]=useState("");
  const [buscaAtiva,setBuscaAtiva]=useState("");
  const [showCatalogo,setShowCatalogo]=useState(false);

  useEffect(()=>{
    (async()=>{
      setLoading(true);setErro(null);
      try{
        const res=await fetch(`${process.env.NEXT_PUBLIC_R2_DEV_URL}/epg/epg_br.json?t=${Date.now()}`,{cache:"no-store"});
        if(!res.ok)throw new Error(`HTTP ${res.status}`);
        setEpg(await res.json());
      }catch{setErro("Grade não encontrada. Rode o Sync EPG.");}
      finally{setLoading(false);}
    })();
  },[]);

  async function handleSync(){
    setSyncing(true);setMsg(null);
    try{
      const d=await fetch("/api/epg/sync",{method:"POST"}).then(r=>r.json());
      if(d.ok){setMsg({tipo:"ok",texto:`EPG sincronizado em ${d.duracao_s}s`});setTimeout(()=>window.location.reload(),1800);}
      else setMsg({tipo:"err",texto:d.error||"Sync falhou"});
    }catch(e:any){setMsg({tipo:"err",texto:e.message});}
    finally{setSyncing(false);}
  }

  const progsPorCanal=useMemo(()=>{
    if(!epg)return new Map<string,Programa[]>();
    const map=new Map<string,Programa[]>();
    const brtMs=Date.now()-3*3600000;
    const ini=brtMs-6*3600000,fim=brtMs+24*3600000;
    for(const p of epg.programas){
      const s=new Date(p.start).getTime(),e=new Date(p.stop).getTime();
      if(e<ini||s>fim)continue;
      const arr=map.get(p.channel_id)||[];arr.push(p);map.set(p.channel_id,arr);
    }
    return map;
  },[epg]);

  const canaisFiltrados=useMemo(()=>{
    if(!epg)return[];
    let lista=epg.canais;
    if(catAtiva!=="Todos")lista=lista.filter(c=>c.categoria===catAtiva);
    if(subAtiva!=="Todos"){const sg=(SUBGRUPOS[catAtiva]||[]).find(s=>s.label===subAtiva);if(sg)lista=lista.filter(c=>sg.match.some(m=>c.display_name.toUpperCase().includes(m)));}
    return lista;
  },[epg,catAtiva,subAtiva]);

  const resultadosBusca=useMemo(()=>{
    if(!epg||!buscaAtiva.trim())return[];
    
    // Busca inteligente: divide a string em palavras e exige que TODAS estejam presentes em qualquer campo
    const kws = buscaAtiva.toLowerCase().trim().split(/\s+/);
    const res:Array<{canal:Canal;prog:Programa}>=[];
    const cmap=new Map(epg.canais.map(c=>[c.id,c]));
    
    for(const p of epg.programas){
      const c=cmap.get(p.channel_id);if(!c)continue;
      if(catAtiva!=="Todos"&&c.categoria!==catAtiva)continue;

      const textoBuscavel = `${p.title} ${p.desc || ""} ${c.nome} ${c.categoria}`.toLowerCase();
      const match = kws.every(kw => textoBuscavel.includes(kw));
      
      if(match) res.push({canal:c,prog:p});
    }
    const agora=Date.now();
    return res.sort((a,b)=>{
      const aA=agora>=new Date(a.prog.start).getTime()&&agora<=new Date(a.prog.stop).getTime();
      const bA=agora>=new Date(b.prog.start).getTime()&&agora<=new Date(b.prog.stop).getTime();
      if(aA&&!bA)return-1;if(!aA&&bA)return 1;
      return new Date(a.prog.start).getTime()-new Date(b.prog.start).getTime();
    });
  },[epg,buscaAtiva,catAtiva]);

  const catsDisponiveis=useMemo(()=>{if(!epg)return[];const s=new Set(epg.canais.map(c=>c.categoria));return CATS_ORDEM.filter(c=>s.has(c));},[epg]);
  const subgruposDisponiveis=SUBGRUPOS[catAtiva]||[];
  const emBusca=buscaAtiva.trim().length>0;

  // Layout: header fixo + grade ocupa o resto da viewport
  return (
    <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 57px)",background:"#0f1117",color:"#cbd5e1",overflow:"hidden"}}>
      {showCatalogo&&<ModalCatalogo onClose={()=>setShowCatalogo(false)}/>}

      {/* Header */}
      <div style={{flexShrink:0,background:"#13151f",borderBottom:"1px solid #1e2130",zIndex:40}}>
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"14px 20px",flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginRight:4}}>
            <Tv style={{color:"#ef4444",width:16,height:16,flexShrink:0}}/>
            <span style={{fontSize:14,fontWeight:700,color:"#f1f5f9",whiteSpace:"nowrap"}}>Guia TV</span>
            {epg&&<span style={{fontSize:10,color:"#475569",whiteSpace:"nowrap"}}>{epg.total_canais} canais · {formatDataHora(epg.gerado_em)}</span>}
          </div>
          
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <DropdownFiltro label={catAtiva==="Todos"?"Categoria":`${CAT_EMOJI[catAtiva]} ${catAtiva}`} ativo={catAtiva!=="Todos"} cor={catAtiva!=="Todos"?CAT_COR[catAtiva]:undefined}>
            {[{value:"Todos",label:"📡 Todas as categorias"},...catsDisponiveis.map(c=>({value:c,label:`${CAT_EMOJI[c]} ${c}`}))].map(opt=>(
              <button key={opt.value} onClick={()=>{setCatAtiva(opt.value);setSubAtiva("Todos");}} style={{display:"block",width:"100%",padding:"8px 14px",background:catAtiva===opt.value?"#1e2130":"none",border:"none",textAlign:"left",cursor:"pointer",color:catAtiva===opt.value?"#f1f5f9":"#94a3b8",fontSize:13,borderLeft:`3px solid ${catAtiva===opt.value?(CAT_COR[opt.value]||"#6366f1"):"transparent"}`}}
                onMouseEnter={e=>(e.currentTarget.style.background="#1e2130")} onMouseLeave={e=>(e.currentTarget.style.background=catAtiva===opt.value?"#1e2130":"none")}>{opt.label}</button>
            ))}
          </DropdownFiltro>
            {catAtiva!=="Todos"&&(
              <button onClick={()=>{setCatAtiva("Todos");setSubAtiva("Todos");}} style={{display:"flex",alignItems:"center",gap:3,padding:"4px 8px",background:"#ef444415",border:"1px solid #ef444430",borderRadius:6,color:"#ef4444",fontSize:11,cursor:"pointer"}}>
                <X style={{width:10,height:10}}/> Limpar
              </button>
            )}
          </div>
          
          <DropdownFiltro disabled={subgruposDisponiveis.length === 0} label={subAtiva==="Todos"?"Subcategoria":subAtiva} ativo={subAtiva!=="Todos"} cor={catAtiva!=="Todos"?CAT_COR[catAtiva]:undefined}>
            {[{value:"Todos",label:`Todos em ${catAtiva}`},...subgruposDisponiveis.map(s=>({value:s.label,label:s.label}))].map(opt=>(
              <button key={opt.value} onClick={()=>setSubAtiva(opt.value)} style={{display:"block",width:"100%",padding:"8px 14px",background:subAtiva===opt.value?"#1e2130":"none",border:"none",textAlign:"left",cursor:"pointer",color:subAtiva===opt.value?"#f1f5f9":"#94a3b8",fontSize:13,borderLeft:`3px solid ${subAtiva===opt.value?(CAT_COR[catAtiva]||"#6366f1"):"transparent"}`}}
                onMouseEnter={e=>(e.currentTarget.style.background="#1e2130")} onMouseLeave={e=>(e.currentTarget.style.background=subAtiva===opt.value?"#1e2130":"none")}>{opt.label}</button>
            ))}
          </DropdownFiltro>

          <div style={{position:"relative",flex:1,minWidth:180,maxWidth:360}}>
            <Search style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",width:13,height:13,color:"#475569",pointerEvents:"none"}}/>
            <input value={busca} onChange={e=>setBusca(e.target.value)} onKeyDown={e=>e.key==="Enter"&&setBuscaAtiva(busca.trim())} placeholder="Buscar programas..." style={{width:"100%",height:36,paddingLeft:32,paddingRight:busca?30:10,background:"#1a1d2e",border:`1px solid ${emBusca?"#6366f1":"#252840"}`,borderRadius:8,fontSize:13,color:"#e2e8f0",outline:"none",boxSizing:"border-box"}}
              onFocus={e=>(e.target.style.borderColor="#6366f1")} onBlur={e=>(e.target.style.borderColor=emBusca?"#6366f1":"#252840")}/>
            {busca&&<button onClick={()=>{setBusca("");setBuscaAtiva("");}} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"#475569",display:"flex",padding:0}}><X style={{width:13,height:13}}/></button>}
          </div>
          <button onClick={()=>setBuscaAtiva(busca.trim())} style={{height:36,padding:"0 14px",background:"#6366f1",border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",flexShrink:0}}>Buscar</button>
          <div style={{flex:1,minWidth:8}}/>
          {/* Botão Catálogo */}
          <button onClick={()=>setShowCatalogo(true)} style={{display:"flex",alignItems:"center",gap:5,height:36,padding:"0 12px",background:"#16213e",border:"1px solid #6366f150",borderRadius:8,cursor:"pointer",color:"#6366f1",fontSize:12,fontWeight:500,flexShrink:0}}>
            <Database style={{width:11,height:11}}/> Catálogo
          </button>
          {/* Botão Sync EPG */}
          <button onClick={handleSync} disabled={syncing} style={{display:"flex",alignItems:"center",gap:5,height:36,padding:"0 12px",background:"#0d2218",border:`1px solid ${syncing?"#1a1a1a":"#10b98150"}`,borderRadius:8,cursor:syncing?"not-allowed":"pointer",color:syncing?"#2d4a3e":"#10b981",fontSize:12,fontWeight:500,flexShrink:0}}>
            <RefreshCw style={{width:11,height:11,animation:syncing?"spin 1s linear infinite":"none"}}/>{syncing?"Sincronizando...":"Sync EPG"}
          </button>
        </div>
        {msg&&(
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 20px",background:msg.tipo==="ok"?"#10b98115":"#ef444415",borderBottom:`1px solid ${msg.tipo==="ok"?"#10b98130":"#ef444430"}`,fontSize:12,color:msg.tipo==="ok"?"#10b981":"#ef4444"}}>
            {msg.tipo==="ok"?<CheckCircle style={{width:13,height:13}}/>:<AlertTriangle style={{width:13,height:13}}/>}{msg.texto}
            <button onClick={()=>setMsg(null)} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:"inherit"}}><X style={{width:12,height:12}}/></button>
          </div>
        )}
      </div>

      {/* Conteúdo — ocupa o resto */}
      {loading&&<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,padding:80,color:"#374151",fontSize:13}}><RefreshCw style={{width:16,height:16,animation:"spin 1s linear infinite"}}/>Carregando...</div>}
      {erro&&!loading&&(
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12,padding:80,textAlign:"center"}}>
          <AlertTriangle style={{width:28,height:28,color:"#f59e0b"}}/><div style={{fontSize:14,color:"#bbb"}}>Grade não encontrada</div><div style={{fontSize:12,color:"#374151"}}>{erro}</div>
          <button onClick={handleSync} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 14px",background:"#10b98115",border:"1px solid #10b98130",borderRadius:8,color:"#10b981",fontSize:12,cursor:"pointer"}}><RefreshCw style={{width:13,height:13}}/>Sync EPG agora</button>
        </div>
      )}
      {!loading&&!erro&&epg&&(
        emBusca
          ? <div style={{flex:1,overflowY:"auto"}}><ResultadoBusca epg={epg} busca={buscaAtiva} progsPorCanal={progsPorCanal} onClear={()=>{setBusca("");setBuscaAtiva("");}}/></div>
          : canaisFiltrados.length===0
            ? <div style={{textAlign:"center",padding:60,color:"#374151",fontSize:13}}>Nenhum canal encontrado.</div>
            : <GradeEPG canais={canaisFiltrados} progsPorCanal={progsPorCanal}/>
      )}

      <style>{`
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#252840;border-radius:2px}
      `}</style>
    </div>
  );
}
