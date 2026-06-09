"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Upload, Download, RefreshCw, Tv,
  AlertTriangle, CheckCircle, X, Clock, Wifi
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

// Subgrupos por categoria para filtro rápido
const SUBGRUPOS: Record<string,{label:string;match:string[]}[]> = {
  "Esportes":[
    {label:"SporTV",   match:["SPORTV","SPORT TV"]},
    {label:"Premiere", match:["PREMIERE"]},
    {label:"ESPN",     match:["ESPN"]},
    {label:"Combate",  match:["COMBATE"]},
    {label:"BandSports",match:["BANDSPORT","BAND SPORT"]},
    {label:"CONMEBOL", match:["CONMEBOL"]},
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
    {label:"E!",       match:["E!","E ENTERTAINMENT"]},
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

// ─── Helpers ─────────────────────────────────────────────────
function formatHora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR",
    {hour:"2-digit",minute:"2-digit",timeZone:"America/Sao_Paulo"});
}
function formatDataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR",
    {day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"America/Sao_Paulo"});
}
function progresso(start:string,stop:string) {
  const now=Date.now(), s=new Date(start).getTime(), e=new Date(stop).getTime();
  if(now<s)return 0; if(now>e)return 100;
  return Math.round(((now-s)/(e-s))*100);
}
function isAoVivo(start:string,stop:string) {
  const now=Date.now();
  return now>=new Date(start).getTime()&&now<=new Date(stop).getTime();
}
function diasDecorridos(iso:string) {
  return Math.floor((Date.now()-new Date(iso).getTime())/(86400000));
}
function iniciais(nome:string) {
  return nome.split(" ").filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase();
}

// ─── Logo do canal ────────────────────────────────────────────
function Logo({canal,size=52}:{canal:Canal;size?:number}) {
  const [err,setErr]=useState(false);
  const cor=CAT_COR[canal.categoria]||"#6b7280";
  if(!canal.icon||err) return (
    <div style={{
      width:size,height:size,flexShrink:0,
      background:cor+"15",border:`1.5px solid ${cor}30`,
      borderRadius:10,display:"flex",alignItems:"center",
      justifyContent:"center",fontSize:size*.28,fontWeight:700,
      color:cor,letterSpacing:"-0.5px",
    }}>{iniciais(canal.nome)}</div>
  );
  return (
    <img src={canal.icon} alt={canal.nome} onError={()=>setErr(true)}
      style={{
        width:size,height:size,flexShrink:0,
        objectFit:"contain",borderRadius:10,
        background:"rgba(255,255,255,0.03)",
        border:"1px solid rgba(255,255,255,0.07)",
      }}
    />
  );
}

// ─── Row de canal ─────────────────────────────────────────────
function CanalRow({canal,programas}:{canal:Canal;programas:Programa[]}) {
  const now=Date.now();
  const cor=CAT_COR[canal.categoria]||"#6b7280";
  const aoVivo=programas.find(p=>isAoVivo(p.start,p.stop));
  const proximos=programas
    .filter(p=>new Date(p.start).getTime()>now)
    .sort((a,b)=>new Date(a.start).getTime()-new Date(b.start).getTime())
    .slice(0,3);
  const pct=aoVivo?progresso(aoVivo.start,aoVivo.stop):0;

  return (
    <div
      style={{display:"flex",gap:14,padding:"12px 16px",
        borderBottom:"1px solid var(--color-border-tertiary)",
        transition:"background 0.12s",cursor:"default"}}
      onMouseEnter={e=>(e.currentTarget.style.background="rgba(255,255,255,0.018)")}
      onMouseLeave={e=>(e.currentTarget.style.background="transparent")}
    >
      <Logo canal={canal} size={52}/>
      <div style={{flex:1,minWidth:0}}>
        {/* Nome + badge */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
          <span style={{fontSize:13,fontWeight:500,color:"var(--color-text-primary)",
            overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            {canal.nome}
          </span>
          {aoVivo&&(
            <span style={{
              fontSize:9,fontWeight:800,color:"#ef4444",letterSpacing:"0.8px",
              background:"#ef444415",borderRadius:4,padding:"2px 6px",
              border:"1px solid #ef444430",flexShrink:0,
            }}>AO VIVO</span>
          )}
        </div>

        {/* Programa atual */}
        {aoVivo?(
          <>
            <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:4}}>
              <span style={{fontSize:12,fontWeight:700,color:cor,flexShrink:0}}>
                {formatHora(aoVivo.start)}
              </span>
              <span style={{fontSize:13,fontWeight:500,color:"var(--color-text-primary)",
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>
                {aoVivo.title}
              </span>
              <span style={{fontSize:11,color:"var(--color-text-secondary)",flexShrink:0}}>
                até {formatHora(aoVivo.stop)}
              </span>
            </div>
            {/* Barra de progresso */}
            <div style={{height:2,background:"rgba(255,255,255,0.07)",
              borderRadius:2,marginBottom:6,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${pct}%`,
                background:`linear-gradient(90deg, ${cor}, ${cor}99)`,
                borderRadius:2,transition:"width 1s"}}/>
            </div>
          </>
        ):(
          <div style={{fontSize:12,color:"var(--color-text-secondary)",
            fontStyle:"italic",marginBottom:6}}>
            Sem programação agora
          </div>
        )}

        {/* Próximos */}
        {proximos.length>0&&(
          <div style={{display:"flex",flexDirection:"column",gap:2}}>
            {proximos.map(p=>(
              <div key={p.start} style={{display:"flex",gap:8,alignItems:"baseline"}}>
                <span style={{fontSize:11,color:cor+"99",flexShrink:0,minWidth:38,fontWeight:500}}>
                  {formatHora(p.start)}
                </span>
                <span style={{fontSize:11,color:"var(--color-text-secondary)",
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {p.title}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Seção de categoria ───────────────────────────────────────
function CatSecao({cat,canais,progs,buscaAtiva}:{
  cat:string; canais:Canal[];
  progs:Map<string,Programa[]>; buscaAtiva:boolean;
}) {
  const cor=CAT_COR[cat]||"#6b7280";
  const subs=SUBGRUPOS[cat]||[];
  const [subAtivo,setSubAtivo]=useState<string|null>(null);

  const {grupos,semGrupo}=useMemo(()=>{
    if(!subs.length||buscaAtiva)return{grupos:[],semGrupo:canais};
    const usados=new Set<string>();
    const g=subs.map(sg=>{
      const lista=canais.filter(c=>{
        const n=c.display_name.toUpperCase();
        return sg.match.some(m=>n.includes(m));
      });
      lista.forEach(c=>usados.add(c.id));
      return{...sg,canais:lista};
    }).filter(g=>g.canais.length>0);
    return{grupos:g,semGrupo:canais.filter(c=>!usados.has(c.id))};
  },[canais,subs,buscaAtiva]);

  const exibir=useMemo(()=>{
    if(buscaAtiva||!subAtivo)return canais;
    return grupos.find(g=>g.label===subAtivo)?.canais||canais;
  },[canais,grupos,subAtivo,buscaAtiva]);

  if(!canais.length)return null;

  return (
    <section style={{marginBottom:6}}>
      {/* Header da categoria */}
      <div style={{
        display:"flex",alignItems:"center",gap:10,
        padding:"9px 16px",
        background:`linear-gradient(90deg, ${cor}12 0%, transparent 80%)`,
        borderLeft:`3px solid ${cor}`,marginBottom:6,
      }}>
        <span style={{fontSize:15}}>{CAT_EMOJI[cat]}</span>
        <span style={{fontSize:13,fontWeight:600,color:"var(--color-text-primary)"}}>
          {cat}
        </span>
        <span style={{
          fontSize:11,color:cor,background:cor+"18",
          borderRadius:5,padding:"1px 6px",border:`1px solid ${cor}28`,
        }}>{canais.length}</span>

        {/* Pills de subgrupo */}
        {grupos.length>0&&!buscaAtiva&&(
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginLeft:6}}>
            <button onClick={()=>setSubAtivo(null)} style={{
              height:24,padding:"0 9px",borderRadius:6,fontSize:11,fontWeight:500,
              cursor:"pointer",border:"1px solid",transition:"all 0.12s",
              background:!subAtivo?cor+"18":"transparent",
              color:!subAtivo?cor:"var(--color-text-secondary)",
              borderColor:!subAtivo?cor+"40":"var(--color-border-tertiary)",
            }}>Todos</button>
            {grupos.map(g=>(
              <button key={g.label} onClick={()=>setSubAtivo(subAtivo===g.label?null:g.label)} style={{
                height:24,padding:"0 9px",borderRadius:6,fontSize:11,fontWeight:500,
                cursor:"pointer",border:"1px solid",transition:"all 0.12s",
                background:subAtivo===g.label?cor+"18":"transparent",
                color:subAtivo===g.label?cor:"var(--color-text-secondary)",
                borderColor:subAtivo===g.label?cor+"40":"var(--color-border-tertiary)",
              }}>{g.label} <span style={{opacity:0.6}}>({g.canais.length})</span></button>
            ))}
          </div>
        )}
      </div>

      {/* Lista de canais */}
      <div style={{
        background:"var(--color-background-primary)",
        border:"1px solid var(--color-border-tertiary)",
        borderRadius:12,overflow:"hidden",
      }}>
        {exibir.map(canal=>(
          <CanalRow key={canal.id} canal={canal} programas={progs.get(canal.id)||[]}/>
        ))}
      </div>
    </section>
  );
}

// ─── Página ───────────────────────────────────────────────────
export default function GuiaTVPage() {
  const [epg,setEpg]=useState<EpgData|null>(null);
  const [loading,setLoading]=useState(true);
  const [erro,setErro]=useState<string|null>(null);
  const [catAtiva,setCatAtiva]=useState("Todos");
  const [busca,setBusca]=useState("");
  const [uploading,setUploading]=useState(false);
  const [syncing,setSyncing]=useState(false);
  const [msg,setMsg]=useState<{tipo:"ok"|"err";texto:string}|null>(null);
  const fileRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{
    async function load(){
      setLoading(true);setErro(null);
      try{
        const res=await fetch(
          `${process.env.NEXT_PUBLIC_R2_DEV_URL}/epg/epg_br.json?t=${Date.now()}`,
          {cache:"no-store"}
        );
        if(!res.ok)throw new Error(`HTTP ${res.status}`);
        setEpg(await res.json());
      }catch{
        setErro("Grade não encontrada. Rode o sync para carregar.");
      }finally{setLoading(false);}
    }
    load();
  },[]);

  // Programas das próximas 6h por canal
  const progsPorCanal=useMemo(()=>{
    if(!epg)return new Map<string,Programa[]>();
    const map=new Map<string,Programa[]>();
    const agora=Date.now(), limite=agora+6*3600000;
    for(const p of epg.programas){
      if(new Date(p.stop).getTime()<agora)continue;
      if(new Date(p.start).getTime()>limite)continue;
      const arr=map.get(p.channel_id)||[];arr.push(p);
      map.set(p.channel_id,arr);
    }
    return map;
  },[epg]);

  // Canais filtrados agrupados por categoria
  const {cats,porCat,total}=useMemo(()=>{
    if(!epg)return{cats:[],porCat:new Map<string,Canal[]>(),total:0};
    const q=busca.trim().toLowerCase();
    let lista=epg.canais;
    if(catAtiva!=="Todos")lista=lista.filter(c=>c.categoria===catAtiva);
    if(q)lista=lista.filter(c=>
      c.nome.toLowerCase().includes(q)||c.display_name.toLowerCase().includes(q)
    );
    const map=new Map<string,Canal[]>();
    for(const c of lista){
      const arr=map.get(c.categoria)||[];arr.push(c);map.set(c.categoria,arr);
    }
    const cats=CATS_ORDEM.filter(c=>map.has(c));
    const total=[...map.values()].reduce((a,v)=>a+v.length,0);
    return{cats,porCat:map,total};
  },[epg,catAtiva,busca]);

  const catsDisponiveis=useMemo(()=>{
    if(!epg)return[];
    const set=new Set(epg.canais.map(c=>c.categoria));
    return CATS_ORDEM.filter(c=>set.has(c));
  },[epg]);

  async function handleUpload(file:File){
    setUploading(true);setMsg(null);
    try{
      const{presignedUrl}=await fetch("/api/epg/upload-fast").then(r=>r.json());
      await fetch(presignedUrl,{method:"PUT",body:file,headers:{"Content-Type":"application/xml"}});
      const d=await fetch("/api/epg/upload-fast",{method:"POST"}).then(r=>r.json());
      if(d.ok){
        setMsg({tipo:"ok",texto:`Fast atualizado — ${d.total_canais} canais, ${d.total_programas} programas`});
        setTimeout(()=>window.location.reload(),1800);
      }else setMsg({tipo:"err",texto:d.error||"Erro ao processar"});
    }catch(e:any){setMsg({tipo:"err",texto:e.message});}
    finally{setUploading(false);}
  }

  async function handleSync(){
    setSyncing(true);setMsg(null);
    try{
      const d=await fetch("/api/epg/sync",{method:"POST"}).then(r=>r.json());
      if(d.ok){
        const srvs=d.log?.resultado?.servidores_ok?.join(" + ");
        setMsg({tipo:"ok",texto:`Sync OK — ${srvs} em ${d.duracao_s}s`});
        setTimeout(()=>window.location.reload(),1800);
      }else setMsg({tipo:"err",texto:d.error||"Sync falhou"});
    }catch(e:any){setMsg({tipo:"err",texto:e.message});}
    finally{setSyncing(false);}
  }

  return(
    <div style={{maxWidth:1080,margin:"0 auto",padding:"16px 12px 48px"}}>

      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
        <Tv style={{color:"#ef4444",width:20,height:20,flexShrink:0}}/>
        <h1 style={{fontSize:18,fontWeight:500,color:"var(--color-text-primary)",margin:0}}>
          Guia TV
        </h1>
        {epg&&(
          <span style={{fontSize:12,color:"var(--color-text-secondary)"}}>
            · {epg.total_canais} canais · atualizado {formatDataHora(epg.gerado_em)}
          </span>
        )}
      </div>

      {/* Barra de status */}
      {epg&&(
        <div style={{
          display:"flex",flexWrap:"wrap",gap:8,alignItems:"center",
          padding:"9px 14px",marginBottom:12,
          background:"var(--color-background-secondary)",
          border:"1px solid var(--color-border-tertiary)",borderRadius:12,
        }}>
          {/* Fast */}
          <div style={{display:"flex",alignItems:"center",gap:5,fontSize:12}}>
            <div style={{
              width:7,height:7,borderRadius:"50%",flexShrink:0,
              background:epg.fast_valido?"#10b981":"#f59e0b",
              boxShadow:epg.fast_valido?"0 0 6px #10b98166":"0 0 6px #f59e0b66",
            }}/>
            <span style={{color:"var(--color-text-secondary)"}}>Fast</span>
            <span style={{color:epg.fast_valido?"#10b981":"#f59e0b",fontWeight:500}}>
              {epg.fast_valido
                ?`${epg.fast_gerado_em?diasDecorridos(epg.fast_gerado_em):0}d`
                :epg.fast_gerado_em?`expirado (${diasDecorridos(epg.fast_gerado_em)}d)`:"não enviado"}
            </span>
          </div>
          <span style={{color:"var(--color-border-secondary)"}}>·</span>
          <span style={{fontSize:12,color:"var(--color-text-secondary)"}}>
            <span style={{color:"var(--color-text-primary)",fontWeight:500}}>
              {epg.servidores_ok.join(" + ")}
            </span>
          </span>
          <span style={{color:"var(--color-border-secondary)"}}>·</span>
          <span style={{fontSize:12,color:"var(--color-text-secondary)"}}>
            {epg.total_programas.toLocaleString("pt-BR")} programas
          </span>

          <div style={{flex:1}}/>

          {/* Ações */}
          <a href="http://psbox.top/epg.php" target="_blank" rel="noopener noreferrer"
            style={{
              display:"flex",alignItems:"center",gap:5,fontSize:12,fontWeight:500,
              color:"var(--color-text-secondary)",textDecoration:"none",
              background:"var(--color-background-primary)",
              border:"1px solid var(--color-border-secondary)",
              borderRadius:8,padding:"5px 10px",transition:"all 0.12s",
            }}>
            <Download style={{width:12,height:12}}/>Baixar Fast
          </a>

          <button onClick={()=>fileRef.current?.click()} disabled={uploading} style={{
            display:"flex",alignItems:"center",gap:5,fontSize:12,fontWeight:500,
            color:uploading?"var(--color-text-secondary)":"#f59e0b",
            background:"var(--color-background-primary)",
            border:`1px solid ${uploading?"var(--color-border-tertiary)":"#f59e0b40"}`,
            borderRadius:8,padding:"5px 10px",
            cursor:uploading?"not-allowed":"pointer",transition:"all 0.12s",
          }}>
            <Upload style={{width:12,height:12}}/>
            {uploading?"Enviando...":"Upload Fast"}
          </button>
          <input ref={fileRef} type="file" accept=".xml" style={{display:"none"}}
            onChange={e=>{const f=e.target.files?.[0];if(f)handleUpload(f);e.target.value="";}}/>

          <button onClick={handleSync} disabled={syncing} style={{
            display:"flex",alignItems:"center",gap:5,fontSize:12,fontWeight:500,
            color:syncing?"var(--color-text-secondary)":"#10b981",
            background:"var(--color-background-primary)",
            border:`1px solid ${syncing?"var(--color-border-tertiary)":"#10b98140"}`,
            borderRadius:8,padding:"5px 10px",
            cursor:syncing?"not-allowed":"pointer",transition:"all 0.12s",
          }}>
            <RefreshCw style={{width:12,height:12,animation:syncing?"spin 1s linear infinite":"none"}}/>
            {syncing?"Sincronizando...":"Sync"}
          </button>
        </div>
      )}

      {/* Feedback */}
      {msg&&(
        <div style={{
          display:"flex",alignItems:"center",gap:8,padding:"9px 14px",
          marginBottom:12,borderRadius:10,fontSize:13,
          background:msg.tipo==="ok"?"#10b98115":"#ef444415",
          border:`1px solid ${msg.tipo==="ok"?"#10b98140":"#ef444440"}`,
          color:msg.tipo==="ok"?"#10b981":"#ef4444",
        }}>
          {msg.tipo==="ok"
            ?<CheckCircle style={{width:14,height:14,flexShrink:0}}/>
            :<AlertTriangle style={{width:14,height:14,flexShrink:0}}/>}
          {msg.texto}
          <button onClick={()=>setMsg(null)} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:"inherit",padding:0}}>
            <X style={{width:13,height:13}}/>
          </button>
        </div>
      )}

      {/* Busca + Filtro */}
      <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        {/* Input busca */}
        <div style={{position:"relative",flex:"1 1 200px",maxWidth:320}}>
          <Search style={{
            position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",
            width:14,height:14,color:"var(--color-text-secondary)",pointerEvents:"none",
          }}/>
          <input value={busca} onChange={e=>setBusca(e.target.value)}
            placeholder="Buscar canal..."
            style={{
              width:"100%",height:36,paddingLeft:32,paddingRight:10,
              background:"var(--color-background-primary)",
              border:"1px solid var(--color-border-secondary)",
              borderRadius:9,fontSize:13,color:"var(--color-text-primary)",
              outline:"none",boxSizing:"border-box",
            }}
          />
        </div>

        {/* Pills */}
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {["Todos",...catsDisponiveis].map(cat=>{
            const ativo=catAtiva===cat;
            const cor=cat==="Todos"?"#6b7280":(CAT_COR[cat]||"#6b7280");
            const count=cat==="Todos"
              ?epg?.canais.length||0
              :epg?.canais.filter(c=>c.categoria===cat).length||0;
            return(
              <button key={cat} onClick={()=>setCatAtiva(cat)} style={{
                height:30,padding:"0 11px",borderRadius:7,
                fontSize:12,fontWeight:500,cursor:"pointer",
                border:"1px solid",transition:"all 0.12s",
                background:ativo?cor+"18":"var(--color-background-primary)",
                color:ativo?cor:"var(--color-text-secondary)",
                borderColor:ativo?cor+"50":"var(--color-border-tertiary)",
              }}>
                {cat==="Todos"?"📡":CAT_EMOJI[cat]} {cat}
                {count>0&&<span style={{opacity:0.6,marginLeft:4}}>({count})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Contador */}
      {!loading&&!erro&&(
        <div style={{fontSize:12,color:"var(--color-text-secondary)",marginBottom:12}}>
          {total===0
            ?"Nenhum canal encontrado"
            :`${total} canal${total!==1?"is":""}${busca?` para "${busca}"`:""}`}
        </div>
      )}

      {/* Loading */}
      {loading&&(
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",
          gap:10,padding:80,color:"var(--color-text-secondary)",fontSize:14}}>
          <RefreshCw style={{width:18,height:18,animation:"spin 1s linear infinite"}}/>
          Carregando grade de programação...
        </div>
      )}

      {/* Erro */}
      {erro&&!loading&&(
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",
          gap:12,padding:80,textAlign:"center"}}>
          <AlertTriangle style={{width:28,height:28,color:"#f59e0b"}}/>
          <div style={{fontSize:15,fontWeight:500,color:"var(--color-text-primary)"}}>
            Grade não encontrada
          </div>
          <div style={{fontSize:13,color:"var(--color-text-secondary)"}}>{erro}</div>
          <button onClick={handleSync} disabled={syncing} style={{
            display:"flex",alignItems:"center",gap:6,fontSize:13,fontWeight:500,
            color:"#10b981",background:"#10b98115",border:"1px solid #10b98140",
            borderRadius:9,padding:"8px 16px",cursor:"pointer",
          }}>
            <RefreshCw style={{width:14,height:14}}/>
            {syncing?"Sincronizando...":"Sincronizar agora"}
          </button>
        </div>
      )}

      {/* Conteúdo */}
      {!loading&&!erro&&epg&&(
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {cats.length===0?(
            <div style={{textAlign:"center",padding:60,
              color:"var(--color-text-secondary)",fontSize:14}}>
              Nenhum canal encontrado para os filtros selecionados.
            </div>
          ):cats.map(cat=>(
            <CatSecao
              key={cat} cat={cat}
              canais={porCat.get(cat)||[]}
              progs={progsPorCanal}
              buscaAtiva={busca.trim().length>0}
            />
          ))}
        </div>
      )}

      <style>{`
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        input:focus{border-color:#10b981!important;box-shadow:0 0 0 3px #10b98112!important;}
      `}</style>
    </div>
  );
}
