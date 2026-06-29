"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
// Importando o X que estava no seu código original
import { X } from "lucide-react";
// Novos ícones do Lucide para bater com o padrão visual que você mandou em image_0.png
import { 
  Search, RefreshCw, AlertTriangle, CheckCircle,
  ChevronDown, Database, Star, ChevronLeft, ChevronRight, Film,
  Tv, Clapperboard, Swords, Laugh, Ghost, Heart, Eye, Rocket,
  Shield, Sparkles, Globe, Music2, Crosshair, BookOpen, Users,
  Baby, VideoIcon, Flame, Trophy, Clock, Compass, Sunset, Calendar
} from "lucide-react";

// ✅ Novos imports para Toasts (seguindo o padrão que você mandou na página de planos)
// Certifique-se de que esses arquivos existem no caminho especificado
import ToastNotifications from "@/app/admin/ToastNotifications"; 
// Você precisará criar ou importar este hook se ele já existir em @/hooks
import { useConfirm } from "@/app/admin/HookuseConfirm";

// ADICIONAR ISSO:
type ServidorCliente = "ELITE" | "NATV" | "FAST" | "TODOS";
interface GuiaTVViewProps {
  servidorFiltro?: ServidorCliente;
  modoCliente?: boolean;
}


// ─── Ícone de categoria (slug → Lucide icon) ─────────────────────────────────
// Estilizado para respeitar o tema claro/escuro usando Tailwind
function CatIcon({slug,size=16,color="text-muted-foreground"}:{slug:string;size?:number;color?:string}) {
  const props={size, className:`${color} shrink-0`, strokeWidth:1.8};
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

// ─── Tipos (Originais e Preservados) ───────────────────────────────────────────
type Canal = { id: string; display_name: string; nome: string; categoria: string; icon: string; servidor: string; };
type Programa = { channel_id: string; channel_nome: string; categoria: string; start: string; stop: string; duracao_min: number; title: string; desc: string; prog_icon?: string; };
type EpgData = { gerado_em: string; total_canais: number; total_programas: number; canais: Canal[]; programas: Programa[]; };
type TipoConteudo = "FILME" | "SERIE";
type ServidorId   = "ELITE" | "NATV" | "FAST";
type TituloCard = { id: string; titulo_normalizado: string; tipo: TipoConteudo; cover_url: string | null; poster_tmdb_url: string | null; ano: number | null; sinopse: string | null; avaliacao: number | null; generos: string[] | null; total_temporadas: number; total_episodios: number; tmdb_confirmado: boolean; categoria_origem?: string; adicionado_em?: string; };
type TituloBusca = TituloCard & { rotas: { servidor: string; categoria: string }[]; };
type Categoria = { categoria_origem: string; label: string; emoji: string; total: number; };
type Detalhe = TituloCard & { tmdb_id: number | null; disponibilidade: { servidor: string; categoria_origem: string; adicionado_em: string; sincronizado_em: string }[]; temporadas: { temporada: number; total_episodios: number; servidores: string[] }[]; };
type SrvId = "elite" | "natv" | "fast";
type SrvStatus = "idle" | "running" | "ok" | "error";
type CatalogInfo = { ultimo_sync: string | null; filmes: number; series_unicas: number; episodios: number; };

// ─── Constantes EPG (Originais e Preservadas) ──────────────────────────────────
const CATS_ORDEM = ["Aberta","Notícias","Esportes","Filmes","Variedades","Documentários","Infantil","Música","Regional","Religioso","Outros"];
const CAT_COR: Record<string,string> = { "Aberta":"#3b82f6","Notícias":"#ef4444","Esportes":"#10b981","Filmes":"#f59e0b","Variedades":"#8b5cf6","Documentários":"#06b6d4","Infantil":"#ec4899","Música":"#6366f1","Regional":"#84cc16","Religioso":"#f97316","Outros":"#6b7280" };
// Cores padrão Tailwind para uso no tema claro/escuro
const CAT_COR_TW: Record<string,string> = { "Aberta":"text-sky-500","Notícias":"text-rose-500","Esportes":"text-emerald-500","Filmes":"text-amber-500","Variedades":"text-violet-500","Documentários":"text-cyan-500","Infantil":"text-pink-500","Música":"text-indigo-500","Regional":"text-lime-500","Religioso":"text-orange-500","Outros":"text-slate-500" };

// Preservando o SUBGRUPOS para manter a lógica de filtragem original
const SUBGRUPOS: Record<string,{label:string;match:string[]}[]> = {
  "Esportes":[{label:"SporTV",match:["SPORTV","SPORT TV"]},{label:"Premiere",match:["PREMIERE"]},{label:"ESPN",match:["ESPN"]},{label:"Combate",match:["COMBATE"]},{label:"BandSports",match:["BANDSPORT"]},{label:"DAZN",match:["DAZN"]}],
  "Filmes":[{label:"Telecine",match:["TELECINE"]},{label:"HBO",match:["HBO"]},{label:"TNT",match:["TNT"]},{label:"Universal",match:["UNIVERSAL"]},{label:"Warner",match:["WARNER"]},{label:"Paramount",match:["PARAMOUNT"]},{label:"Megapix",match:["MEGAPIX"]}],
  "Infantil":[{label:"Cartoon",match:["CARTOON"]},{label:"Disney",match:["DISNEY"]},{label:"Nick",match:["NICK","NICKELODEON"]},{label:"Gloob",match:["GLOOB"]}],
};

const COR_SERVIDOR: Record<string, string> = { ELITE: "#6366f1", NATV: "#10b981", FAST: "#06b6d4" };

// Lógica de filtragem lixo original e preservada
function isCategoriaPrincipal(cat: string, total: number): boolean {
  if (/^SERIES [A-Z0-9]$/i.test(cat) && total < 20) return false;
  if (/^SERIES 0 a 9$/i.test(cat)) return false;
  return true;
}

// ─── Helpers (Originais e Preservados) ──────────────────────────────────────────
function nowBRT(): Date { return new Date(); }
function formatHora(iso: string) { return new Date(iso).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",timeZone:"America/Sao_Paulo"}); }
function formatDataHora(iso: string) { return new Date(iso).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"America/Sao_Paulo"}); }
function iniciais(nome: string) { return nome.split(" ").filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase(); }
function normalizar(s: string): string { return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim(); }

// ─── Componentes Visuais (Refatorados para Tailwind e Performance) ─────────────

// ✅ Refatorado: Logo canal com Tailwind e suporte a temas
function Logo({src,nome,categoria,size=32}:{src?:string;nome:string;categoria?:string;size?:number}) {
  const [err,setErr]=useState(false);
  const corBase = CAT_COR[categoria||""] || "#6b7280";
  const initials = iniciais(nome);

  if(!src||err) return (
    <div 
      className="shrink-0 flex items-center justify-center rounded-lg select-none border font-bold"
      style={{
        width:size,
        height:size,
        background: corBase + "15", // 8% opacity do original
        borderColor: corBase + "40", // 25% opacity do original
        fontSize: size*0.4,
        color: corBase
      }}
    >
      {initials}
    </div>
  );

 return (
    <img 
      src={src} 
      alt={nome} 
      onError={()=>setErr(true)} 
      className="shrink-0 object-contain rounded-lg border border-border bg-dark-surface p-1 shadow-sm"


      style={{width:size,height:size}}
    />
  );
}

// ✅ Refatorado: ProgressBar para o programa atual (Usa UTC nativo agora)
function ProgressBar({start, stop}:{start:string; stop:string}) {
  const nowMs = Date.now(); // ✅ Usa o horário atual real (UTC)
  const sMs = new Date(start).getTime();
  const eMs = new Date(stop).getTime();
  const total = eMs - sMs;
  if(total <= 0) return null;
  // ✅ Cálculo seguro usando UTC
  const progress = Math.max(0, Math.min(100, ((nowMs - sMs) / total) * 100));

  return (
    // ✅ Barra mais nítida: Altura h-1.5, fundo do trilho (slate-200/700) e verde mais escuro.
    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mt-1.5">
      <div 
        className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
        style={{width: `${progress}%`}}
      />
    </div>
  );
}

// ✅ Refatorado: Tooltip programa (Visual Limpo com Tailwind)
function ProgramaTooltip({prog,onClose}:{prog:Programa;onClose:()=>void}) {
  return (
    <div className="fixed inset-0 z-[9998] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div 
        onClick={e=>e.stopPropagation()} 
        className="bg-card border border-border rounded-2xl overflow-hidden shadow-2xl max-w-md w-full animate-in fade-in-0 zoom-in-95"
      >
        {prog.prog_icon&&<div className="relative h-56 bg-muted/30"><img src={prog.prog_icon} alt={prog.title} className="w-full h-full object-cover"/><div className="absolute inset-0 bg-gradient-to-t from-card via-card/20 to-transparent"/><button onClick={onClose} className="absolute top-3 right-3 bg-black/60 text-white rounded-full p-1.5 hover:bg-black/80"><X size={16}/></button></div>}
        <div className="p-6">
          {!prog.prog_icon&&<div className="flex justify-end mb-4"><button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={20}/></button></div>}
          <div className="flex items-center gap-2 text-xs text-muted-foreground/90 uppercase tracking-wider mb-2.5">
            <Tv size={12}/>
            {prog.channel_nome} · {prog.categoria}
          </div>
          <div className="text-xl font-semibold text-foreground tracking-tight leading-tight mb-3">{prog.title}</div>
          <div className="flex items-center gap-2 mb-5">
            <span className="text-sm text-amber-500 font-semibold">{formatHora(prog.start)} – {formatHora(prog.stop)}</span>
            <span className="text-xs text-muted-foreground">· {prog.duracao_min} min</span>
          </div>
          {prog.desc&&<div className="text-sm text-foreground/80 leading-relaxed font-normal whitespace-pre-wrap">{prog.desc}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Grade EPG Refatorada (Performance e Visual) ─────────────────────────────

// ✅ NOVO COMPONENTE: Grade performática em formato de lista (Parecido com o app)
// Esta grade carrega APENAS as logos dos canais, otimizando o carregamento inicial.
// Os detalhes e capas só aparecem ao abrir o modal lateral do canal.
function GradeListaPerformance({canais, progsPorCanal}:{canais:Canal[];progsPorCanal:Map<string,Programa[]>}) {
  const scrollRef=useRef<HTMLDivElement>(null);
  const [agora,setAgora]=useState(nowBRT);
  const [progSel,setProgSel]=useState<Programa|null>(null);
  const [canalDetalheSel, setCanalDetalheSel] = useState<Canal | null>(null);

  useEffect(()=>{
    // Atualiza a barrinha de progresso a cada minuto
    const iv=setInterval(()=>setAgora(nowBRT()),60000);
    return()=>clearInterval(iv);
  },[]);

  const agoraMs = agora.getTime();
  // REMOVIDO: const agoraBrtMs=agoraMs-3*3600000; // ✅ Hack de timezone removido

  return (
    <>
      {progSel&&<ProgramaTooltip prog={progSel} onClose={()=>setProgSel(null)}/>}
      
      {/* Modal Lateral de Detalhes do Canal (Onde as capas pesadas são carregadas) */}
      {canalDetalheSel && (
        <ModalDetalheCanal 
          canal={canalDetalheSel} 
          progsPorCanal={progsPorCanal}
          agoraMs={agoraMs}
          onProgSelect={setProgSel}
          onClose={() => setCanalDetalheSel(null)} 
        />
      )}

      {/* Container da lista com fundo claro/card */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto bg-background p-4 sm:p-5">
        <div className="max-w-[1400px] mx-auto space-y-2.5">
          {canais.map(canal => {
            const progs=(progsPorCanal.get(canal.id)||[]).sort((a,b)=>new Date(a.start).getTime()-new Date(b.start).getTime());
            
          // ✅ Lógica corrigida para encontrar o programa atual usando UTC e comparação exclusiva no final (<)
          const progAtualIndex = progs.findIndex(p => {
            const sMs=new Date(p.start).getTime();
            const eMs=new Date(p.stop).getTime();
            return agoraMs >= sMs && agoraMs < eMs;
          });

            const progAtual = progAtualIndex !== -1 ? progs[progAtualIndex] : null;
            const proximosProgs = progAtualIndex !== -1 ? progs.slice(progAtualIndex + 1, progAtualIndex + 3) : progs.slice(0, 2);
            
            const catTwColor = CAT_COR_TW[canal.categoria] || "text-slate-500";
            const corBase = CAT_COR[canal.categoria] || "#6b7280";

            // ✅ MUDANÇA 3: Ocultar canais sem programação
            if (progs.length === 0) return null;

            return (
              <div 
                key={canal.id} 
                onClick={() => setCanalDetalheSel(canal)}
                // ✅ GRID CORRIGIDO: 3 colunas (1fr) de exato mesmo tamanho + seta
                className="group flex flex-col md:grid md:grid-cols-[1fr_1fr_1fr_auto] items-center gap-4 md:gap-6 p-4 rounded-2xl border border-border bg-card hover:border-sky-500/30 hover:bg-muted/50 transition-all cursor-pointer shadow-sm"
              >
                {/* Coluna 1: Canal */}
                <div className="flex items-center gap-4 w-full shrink-0">
                  <Logo src={canal.icon} nome={canal.nome} categoria={canal.categoria} size={44}/>
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground text-base tracking-tight truncate">{canal.nome}</div>
                    <div className={`text-xs font-medium ${catTwColor} flex items-center gap-1.5`}>
                      <div className="w-2 h-2 rounded-full" style={{backgroundColor: corBase}}/>
                      {canal.categoria}
                    </div>
                  </div>
                </div>

                {/* Coluna 2 - Programa Atual */}
                <div className="w-full border-t md:border-t-0 md:border-l border-border/60 pt-3 md:pt-0 md:pl-6">
                  {progAtual ? (
                    <div className="min-w-0 md:pr-10">
                      {/* Mobile: badge + linha única (título à esquerda, horário fixo à direita) */}
                      <div className="flex md:hidden items-center gap-2 mb-1">
                                                <span className="shrink-0 text-[10px] font-bold text-sky-500 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded uppercase tracking-wider">AO VIVO</span>

                        <span className="text-sm font-semibold text-foreground truncate flex-1 min-w-0">{progAtual.title}</span>
                        <span className="text-xs text-muted-foreground font-medium shrink-0 ml-auto">{formatHora(progAtual.start)} – {formatHora(progAtual.stop)}</span>
                      </div>
                      {/* Desktop: layout original em coluna */}
                      <div className="hidden md:block">
                        <div className="text-[10px] font-bold text-sky-500 bg-sky-500/10 px-2 py-0.5 rounded uppercase w-max mb-2 tracking-wider">AO VIVO</div>
                        <div className="flex flex-col gap-1">
                          <div className="text-sm font-semibold text-foreground truncate group-hover:text-sky-500">{progAtual.title}</div>
<div className="text-xs text-muted-foreground font-medium">
                            {formatHora(progAtual.start)} – {formatHora(progAtual.stop)}
                          </div>
                        </div>
                      </div>
                      <div className="w-full mt-1.5">
                        <ProgressBar start={progAtual.start} stop={progAtual.stop} />
                      </div>
                    </div>
                  ) : (
                    <div className="min-w-0 text-muted-foreground/70 italic text-sm pt-1">Sem informação atual</div>
                  )}
                </div>

                {/* Coluna 3 - Próximo programa */}
                <div className="w-full grid grid-cols-1 md:grid-cols-1 lg:grid-cols-2 gap-2 md:gap-4 border-t md:border-t-0 md:border-l border-border/60 pt-3 md:pt-0 md:pl-6">
                  {proximosProgs.map((p, idx) => (
                    <div key={idx} className="min-w-0">
                      {/* Mobile: horário + título na mesma linha, sem label */}
                      <div className="flex md:hidden items-baseline gap-2">
                        <span className="text-xs text-muted-foreground font-mono shrink-0">{formatHora(p.start)}</span>
                        <span className="text-sm font-medium text-foreground/90 truncate">{p.title}</span>
                      </div>
                      {/* Desktop: layout original com label */}
                      <div className="hidden md:block">
                        <div className="text-[11px] font-medium text-muted-foreground tracking-wider uppercase mb-1">
                          {idx === 0 ? "Em seguida" : "Depois"}
                        </div>
                        <div className="text-sm font-medium text-foreground/90 truncate group-hover:text-foreground">{p.title}</div>
                        <div className="text-xs text-muted-foreground font-mono">{formatHora(p.start)}</div>
                      </div>
                    </div>
                  ))}

                  {Array.from({length: 2 - proximosProgs.length}).map((_, idx) => (
                    <div key={`empty-${idx}`} className="min-w-0 opacity-40">
                      <div className="hidden md:block text-[11px] font-medium text-muted-foreground tracking-wider uppercase mb-1">Em seguida</div>
                      <div className="text-xs text-muted-foreground">Sem informação</div>
                    </div>
                  ))}
                </div>
                
                {/* Ícone seta (Coluna 'auto' no grid) */}
                <div className="flex md:items-center justify-end md:justify-center shrink-0 hidden md:flex">
                    <ChevronRight className="w-5 h-5 text-border group-hover:text-sky-500 transition-colors" />
                </div>
              </div>
            );
          })}
        </div>
        
      </div>
    </>
  );
}

// ✅ NOVO COMPONENTE: Modal Lateral de Detalhes do Canal (Onde as capas pesadas são carregadas)
// Esta grade carrega APENAS as logos dos canais, otimizando o carregamento inicial.
// Os detalhes e capas só aparecem ao abrir o modal lateral do canal.
function ModalDetalheCanal({canal, progsPorCanal, agoraMs, onProgSelect, onClose}:{canal:Canal; progsPorCanal:Map<string,Programa[]>; agoraMs:number; onProgSelect:(p:Programa)=>void; onClose:()=>void}) {
    // Filtramos e preparamos a programação para exibir dia atual e próximo
    const progs = useMemo(() => {
        const all = (progsPorCanal.get(canal.id) || []);
        // REMOVIDO: const agoraBrtMs = agoraMs - 3 * 3600000; // ✅ Hack removido
        // ✅ Filtramos programas que ainda não terminaram usando UTC real
        return all.filter(p => new Date(p.stop).getTime() > agoraMs).sort((a,b)=>new Date(a.start).getTime()-new Date(b.start).getTime());
    }, [canal, progsPorCanal, agoraMs]);

    return (
        <div className="fixed inset-0 z-[9990] bg-black/60 flex justify-end backdrop-blur-sm animate-in fade-in-0" onClick={onClose}>
            <div 
                onClick={e=>e.stopPropagation()} 
                className="w-full max-w-xl h-full bg-background border-l border-border shadow-xl flex flex-col animate-in slide-in-from-right-2 duration-300"
            >
                {/* Cabeçalho do Modal */}
                <div className="px-6 py-5 border-b border-border flex items-center gap-4 shrink-0 bg-card">
                    <Logo src={canal.icon} nome={canal.nome} categoria={canal.categoria} size={48}/>
                    <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-sky-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                            <CatIcon slug={canal.categoria.toLowerCase()} size={12} color="text-sky-500"/>
                            {canal.categoria}
                        </div>
                        <div className="text-2xl font-bold text-foreground leading-tight tracking-tight truncate">{canal.nome}</div>
                    </div>
                    <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-rose-500 rounded-full hover:bg-rose-500/10">
                        <X size={24}/>
                    </button>
                </div>

                {/* Lista de Programação (Performance-friendly - carrega imagens apenas quando visíveis no viewport) */}
                <div className="flex-1 overflow-y-auto p-6 space-y-3 bg-muted/20">
                    {progs.length === 0 ? (
                        <div className="text-center text-muted-foreground/70 italic text-sm py-20 bg-card rounded-2xl border border-border">
                            Nenhuma programação encontrada para hoje ou amanhã.
                        </div>
                    ) : progs.map(p => {
                        const sMs = new Date(p.start).getTime();
                        const eMs = new Date(p.stop).getTime();
                        // REMOVIDO: const agoraBrtMs = agoraMs - 3 * 3600000; // ✅ Redundância e hack removidos
                        // ✅ Comparação corrigida usando UTC e < para o fim
                        const emAndamento = agoraMs >= sMs && agoraMs < eMs;
                        const baseTwColor = CAT_COR_TW[canal.categoria] || "text-slate-500";
                        const corBase = CAT_COR[canal.categoria] || "#6b7280";

                        return (
                            <div 
                                key={p.start} 
                                onClick={() => onProgSelect(p)}
                                className={`flex items-start gap-3 sm:gap-4 p-4 sm:p-5 rounded-xl border bg-card transition-all cursor-pointer group shadow-sm ${emAndamento ? 'border-sky-500/30 bg-sky-500/[0.05]' : 'border-border hover:bg-muted/30'}`}
                            >
                                {/* ✅ Placeholder idêntico ao print (quadrado branco com borda e ícone) */}
                                {p.prog_icon ? (
                                    <img src={p.prog_icon} alt={p.title} loading="lazy" className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg object-cover shrink-0 border border-border bg-white" />
                                ) : (
                                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-card flex items-center justify-center shrink-0 border border-border shadow-sm">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground/50"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
                                    </div>
                                )}
                                
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap mb-1">
                                        {emAndamento && (
                                            <span className="shrink-0 text-[10px] font-bold text-sky-500 bg-sky-500/10 px-2 py-0.5 rounded-full tracking-wider uppercase">Passando</span>
                                        )}
                                        <span className="text-xs sm:text-sm font-medium text-muted-foreground">
                                            {formatHora(p.start)} – {formatHora(p.stop)}
                                        </span>
                                        <span className="text-[11px] sm:text-xs text-muted-foreground/60 ml-auto font-medium shrink-0">{p.duracao_min} min</span>
                                    </div>
                                    
                                    <div className={`text-sm sm:text-base font-semibold leading-snug line-clamp-2 group-hover:text-sky-500 tracking-tight ${emAndamento ? 'text-sky-500' : 'text-foreground'}`}>
                                        {p.title}
                                    </div>

                                    {emAndamento && (
                                        <div className="w-full max-w-[200px] mt-2 mb-2">
                                            <ProgressBar start={p.start} stop={p.stop} />
                                        </div>
                                    )}

                                    {p.desc && (
                                        <div className="text-xs sm:text-sm text-muted-foreground leading-relaxed line-clamp-2 mt-2">{p.desc}</div>
                                    )}
                                </div>
                                <div className="shrink-0 hidden sm:flex items-center justify-center pt-1">
                                    <ChevronRight className="w-4 h-4 text-border group-hover:text-sky-500"/>
                                </div>
                            </div>
                        );
                    })}
                    
                </div>
                
            </div>
            
        </div>
    );
}

// ─── Modal Catálogo (Original e Preservado) ───────────────────────────────────
// ✅ Refatorado visivelmente para Tailwind e temas claro/escuro
function LimparCatalogo() {
  const [limpando, setLimpando] = React.useState(false);
  const [preview, setPreview] = React.useState<Record<string,number>|null>(null);
  const [limpezaOk, setLimpezaOk] = React.useState<Record<string,number>|null>(null);
  const [srvLimpar, setSrvLimpar] = React.useState<string>("TODOS");
  const [showLimpar, setShowLimpar] = React.useState(false);

  // Lógica original preservada
  async function carregarPreview() {
    setShowLimpar(true); setPreview(null); setLimpezaOk(null);
    const d = await fetch("/api/catalogo/limpar").then(r=>r.json()).catch(()=>null);
    if (d?.ok) setPreview(d.preview);
  }

  // Lógica original preservada
  async function executarLimpeza() {
  setLimpando(true);
  setShowLimpar(false);
    const d = await fetch("/api/catalogo/limpar", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({servidor: srvLimpar})
    }).then(r=>r.json()).catch(()=>null);
    if (d?.ok) {
      const res = {...(d.resultado||{})};
      if (d.orfaos_removidos) res["Órfãos"] = d.orfaos_removidos;
      setLimpezaOk(res);
    }
    setLimpando(false); setShowLimpar(false);
  }

  return (
    <div className={`p-5 rounded-xl border transition-colors ${limpezaOk ? 'border-emerald-500/30 bg-emerald-500/[0.01]' : 'border-border bg-card'}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full ${limpezaOk ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}/>

            <span className="text-sm font-semibold text-foreground tracking-tight">Limpar Títulos Removidos</span>
          </div>
          <div className="text-xs text-muted-foreground/90 mt-1.5 pl-5.5 leading-relaxed">
            Remove títulos que saíram dos servidores originais desde a última sincronização.
          </div>
          {limpezaOk&&(
            <div className="text-xs text-emerald-500 font-medium mt-2 pl-5.5 flex items-center gap-1.5">
              <CheckCircle size={12}/>
              ✓ {Object.entries(limpezaOk).map(([s,n])=>`${s}: ${n} removidos`).join(" · ")}
            </div>
          )}
        </div>
        <button 
  onClick={limpando ? undefined : showLimpar ? ()=>setShowLimpar(false) : carregarPreview}
  disabled={limpando}
  className={`shrink-0 h-9 w-32 justify-center rounded-lg font-bold text-xs flex items-center gap-2 transition-all ${limpando ? 'bg-rose-600 text-white shadow-lg shadow-rose-900/20' : showLimpar ? 'bg-muted hover:bg-muted/80 text-foreground' : 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/20'}`}
>
  <RefreshCw size={12} className={limpando ? "animate-spin" : "hidden"}/>
  {!limpando && (showLimpar ? <X size={13}/> : <X size={13}/>)}
  {limpando ? "Limpando..." : showLimpar ? "Cancelar" : "Limpar Agora"}
</button>
      </div>
      {showLimpar&&(
        <div className="mt-5 p-4 rounded-xl bg-muted/40 border border-border animate-in slide-in-from-top-2">
          <div className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-3">Selecione o servidor alvo:</div>
          <div className="flex flex-wrap gap-2 mb-4 bg-muted/60 p-1.5 rounded-lg border border-border/60">
            {["TODOS","ELITE","NATV","FAST"].map(s=>(
              <button key={s} onClick={()=>setSrvLimpar(s)}
                className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${srvLimpar===s ? 'bg-rose-600 text-white shadow' : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'}`}>
                {s}
              </button>
            ))}
          </div>
          {preview
            ? <div className="text-sm text-foreground/90 mb-5 bg-card/60 p-3.5 rounded-lg border border-border/80">
                <Database size={13} className="inline-block mr-2 text-rose-400"/>
                {srvLimpar==="TODOS"
                  ? Object.entries(preview).map(([s,n])=>`${s}: ${n} títulos`).join(" · ")
                  : `${srvLimpar}: ${preview[srvLimpar]||0} títulos serão removidos.`}
              </div>
            : <div className="text-sm text-muted-foreground italic mb-5 p-3.5 flex items-center gap-2.5">
                <RefreshCw size={14} className="animate-spin text-muted-foreground/60"/>
                Carregando preview...
              </div>
          }
          <button onClick={executarLimpeza}
  className={`h-9 px-5 rounded-lg font-bold text-xs flex items-center gap-2 transition-all bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/20`}>
  <RefreshCw size={12}/>
  Confirmar Limpeza
</button>
        </div>
      )}
    </div>
  );
}

// ✅ Refatorado visivelmente para Tailwind e temas claro/escuro
function ModalCatalogo({onClose}:{onClose:()=>void}) {
  const [status,setStatus]=useState<Record<SrvId,SrvStatus>>({elite:"idle",natv:"idle",fast:"idle"});
  const [info,setInfo]=useState<Record<SrvId,CatalogInfo|null>>({elite:null,natv:null,fast:null});
  const [serverMessages, setServerMessages] = useState<Record<SrvId, { text: string, type: "success" | "error" } | null>>({elite: null, natv: null, fast: null});
  const [toasts,setToasts]=useState<any[]>([]);
  
  const removeToast=(id:number)=>setToasts(p=>p.filter(t=>t.id!==id));
  const addToast=(type:"success"|"error"|"warning",title:string,message:string)=>setToasts(p=>[...p,{id:Date.now(),type,title,message,durationMs:5000}]);
  
  // Lógica original preservada
  const carregarInfo = async () => {
  (["elite","natv","fast"] as SrvId[]).forEach(async srv => {
    try {
      const d = await fetch(`/api/epg/sync-catalog/${srv}`, { cache: "no-store" }).then(r => r.json());
      if (d.resultado) {
        setInfo(p => ({...p, [srv]: {
          ultimo_sync:   d.executado_em || null,
          filmes:        d.resultado.filmes        || 0,
          series_unicas: d.resultado.series_unicas || d.resultado.series || 0,
          episodios:     d.resultado.episodios     || 0,
        }}));
      }
    } catch {}
  });
};

useEffect(() => { carregarInfo(); }, []);
  
  async function syncElite(){setStatus(p=>({...p,elite:"running"}));setServerMessages(p=>({...p,elite:null}));try{const d=await fetch("/api/epg/sync-catalog/elite",{method:"POST"}).then(r=>r.json());if(d.error)throw new Error(d.error);await carregarInfo();setStatus(p=>({...p,elite:"ok"}));const msg=`Novos títulos: ${d.novos_titulos??0} · Concluído em ${d.duracao_s}s`;setServerMessages(p=>({...p,elite:{text:msg,type:"success"}}));addToast("success","EliteTV sincronizado",msg);}catch(e:any){setStatus(p=>({...p,elite:"error"}));setServerMessages(p=>({...p,elite:{text:e.message||"Erro desconhecido",type:"error"}}));addToast("error","Falha ao sincronizar EliteTV",e.message);}}
  
  async function syncNaTV(){setStatus(p=>({...p,natv:"running"}));setServerMessages(p=>({...p,natv:null}));try{const d=await fetch("/api/epg/sync-catalog/natv",{method:"POST"}).then(r=>r.json());if(d.error)throw new Error(d.error);await carregarInfo();setStatus(p=>({...p,natv:"ok"}));const msg=`Novos títulos: ${d.novos_titulos??0} · Concluído em ${d.duracao_s}s`;setServerMessages(p=>({...p,natv:{text:msg,type:"success"}}));addToast("success","NaTV sincronizado",msg);}catch(e:any){setStatus(p=>({...p,natv:"error"}));setServerMessages(p=>({...p,natv:{text:e.message||"Erro desconhecido",type:"error"}}));addToast("error","Falha ao sincronizar NaTV",e.message);}}
  
  async function syncFast(){setStatus(p=>({...p,fast:"running"}));setServerMessages(p=>({...p,fast:null}));try{const res=await fetch("/api/epg/sync-catalog/fast");const data=await res.json();if(!data.m3u_url)throw new Error("URL M3U não encontrada.");function onResult(e:Event){const detail=(e as CustomEvent).detail;window.removeEventListener("UNIGESTOR_INTEGRATION_RESPONSE",onResult);if(!detail?.ok){setStatus(p=>({...p,fast:"error"}));setServerMessages(p=>({...p,fast:{text:detail?.error||"Erro desconhecido",type:"error"}}));addToast("error","Falha ao sincronizar FastTV",detail?.error||"Erro desconhecido");return;}}window.addEventListener("UNIGESTOR_INTEGRATION_RESPONSE",onResult);async function onDone(e:Event){const detail=(e as CustomEvent).detail;if(detail?.action!=="FAST_VOD_SYNC_RESULT")return;window.removeEventListener("UNIGESTOR_BACKGROUND_MESSAGE",onDone as any);if(!detail.ok){setStatus(p=>({...p,fast:"error"}));setServerMessages(p=>({...p,fast:{text:detail.error||"Erro desconhecido",type:"error"}}));addToast("error","Falha ao sincronizar FastTV",detail.error);return;}const novosTitulos=detail.novos_titulos??0;const novosEpisodios=detail.novos_episodios??0;await carregarInfo();setStatus(p=>({...p,fast:"ok"}));const msg=`Novos títulos: ${novosTitulos} · Novos episódios: ${novosEpisodios}`;setServerMessages(p=>({...p,fast:{text:msg,type:"success"}}));addToast("success","FastTV sincronizado",msg);}window.addEventListener("UNIGESTOR_BACKGROUND_MESSAGE",onDone);window.dispatchEvent(new CustomEvent("UNIGESTOR_INTEGRATION_CALL",{detail:{action:"FAST_VOD_SYNC",m3uUrl:data.m3u_url.replace(/&output=ts$/i,"").replace(/&output=ts&/i,"&"),apiBase:window.location.origin}}));}catch(e:any){setStatus(p=>({...p,fast:"error"}));setServerMessages(p=>({...p,fast:{text:e.message||"Erro desconhecido",type:"error"}}));addToast("error","Falha ao sincronizar FastTV",e.message);}}
  
  const SERVIDORES:{id:SrvId;label:string;cor:string;bgClass:string;onSync:()=>void}[]=[{id:"elite",label:"EliteTV",cor:"#6366f1",bgClass:"bg-indigo-600 hover:bg-indigo-500",onSync:syncElite},{id:"natv",label:"NaTV",cor:"#10b981",bgClass:"bg-emerald-600 hover:bg-emerald-500",onSync:syncNaTV},{id:"fast",label:"FastTV",cor:"#06b6d4",bgClass:"bg-sky-600 hover:bg-sky-500",onSync:syncFast}];
  const [tmdbStatus,setTmdbStatus]=useState<"idle"|"running"|"ok"|"error">("idle");
  const [tmdbMessage, setTmdbMessage] = useState<{ text: string, type: "success" | "error" } | null>(null);
  const [tmdbInfo,setTmdbInfo]=useState<{filmes:{sem_tmdb:number;com_tmdb:number};series:{sem_tmdb:number;com_tmdb:number}}|null>(null);
  const [tmdbConfirm,setTmdbConfirm]=useState(false);
  
  useEffect(()=>{fetch("/api/epg/sync-tmdb").then(r=>r.json()).then(d=>{if(d.filmes)setTmdbInfo(d);}).catch(()=>{});},[]);
  
  async function syncTmdb() {
    setTmdbStatus("running");
    setTmdbConfirm(false);
    setTmdbMessage(null);
    let totalProc = 0, totalEnc = 0, totalNao = 0, lotes = 0;
    
    try {
      while (true) {
        // Removemos tipo e lote da URL. O backend vai fazer 50 por vez automaticamente pegando o que faltar (filme ou série).
        const d = await fetch(`/api/epg/sync-tmdb`, { method: "POST" }).then(r => r.json());
        if (d.error) throw new Error(d.error);
        
        if (d.processados === 0) {
          if (totalProc === 0) {
            const msg = "Todos os títulos já foram processados.";
            setTmdbMessage({ text: msg, type: "success" });
            addToast("success", "Enriquecimento TMDB", msg);
          }
          break;
        }
        
        totalProc += d.processados;
        totalEnc += d.encontrados;
        totalNao += d.nao_encontrados;
        lotes++;
        
        // Atualização em tempo real na tela
        setTmdbMessage({ text: `Lote: ${lotes} | ${totalProc} consultados | ${totalEnc} encontrados`, type: "success" });
        
        if (!d.proximo_lote) break;
        
        // Atualiza a estatística global a cada lote
        const s = await fetch("/api/epg/sync-tmdb").then(r => r.json());
        if (s.filmes) setTmdbInfo(s);
        
        // Delay de 2 segundos para não tomar block da API do TMDB
        await new Promise(r => setTimeout(r, 2000)); 
      }
      
      const s = await fetch("/api/epg/sync-tmdb").then(r => r.json());
      if (s.filmes) setTmdbInfo(s);
      
      setTmdbStatus("ok");
      if (totalProc > 0) {
        const msg = `Finalizado! ${totalProc} processados · ${totalEnc} encontrados · ${totalNao} não encontrados`;
        setTmdbMessage({ text: msg, type: "success" });
        addToast("success", "Enriquecimento TMDB concluído", msg);
      }
    } catch (e: any) {
      setTmdbStatus("error");
      setTmdbMessage({ text: e.message || "Erro desconhecido", type: "error" });
      addToast("error", "Falha no enriquecimento TMDB", e.message);
    }
  }
  
  return (
    <div className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div 
        onClick={e=>e.stopPropagation()} 
        className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-in fade-in-0 zoom-in-95 duration-300"
      >
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0 bg-card">
          <div>
            <div className="text-lg font-bold text-foreground flex items-center gap-2.5">
              <Database size={18} className="text-indigo-500"/> Sincronizar Catálogo (VOD)
            </div>
            <div className="text-xs text-muted-foreground/90 mt-1.5 leading-relaxed">
              Importa filmes e séries novos — rode cada servidor individualmente.
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-rose-500 transition-colors p-1 rounded-full hover:bg-rose-500/10">
            <X size={20}/>
          </button>
        </div>
        
        <div className="overflow-y-auto flex-1 p-5 space-y-3.5 bg-muted/20">
{SERVIDORES.map(({id,label,cor,bgClass,onSync})=>{
            const st=status[id];
            const inf=info[id];
            const running=st==="running";
            const borderCol = st==="ok"? cor + "40" : st==="error"? "#ef444430" : running ? cor + "30" : "#2a2a2a30";
            const msgObj = serverMessages[id];
            
            return(
              <div 
                key={id} 
                className={`p-5 rounded-xl border transition-all ${st==="ok" ? 'bg-card' : st==="running" ? 'bg-card shadow-lg shadow-indigo-900/10' : 'bg-card'}`}
                style={{borderColor: borderCol}}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <div className={`w-2.5 h-2.5 rounded-full ${st==="ok"? '': st==="error"? 'bg-rose-500': running ? 'animate-pulse': 'bg-muted'}`} style={{backgroundColor: st==="error" ? undefined : cor}}/>
                      <span className="text-sm font-semibold text-foreground tracking-tight">{label}</span>
                    </div>
                    {inf&&<div className="text-xs text-muted-foreground/90 mt-2 pl-5 tracking-tight leading-relaxed">
                      {inf.ultimo_sync?`sync ${formatDataHora(inf.ultimo_sync)}`:"sem sync"} · {inf.filmes.toLocaleString()} f · {inf.series_unicas.toLocaleString()} s · {inf.episodios.toLocaleString()} ep
                    </div>}
                    {msgObj && (
                      <div className={`text-[11px] font-medium mt-1.5 pl-5 tracking-tight flex items-center gap-1.5 ${msgObj.type === "success" ? "text-emerald-500" : "text-rose-500"}`}>
                        {msgObj.type === "success" ? <CheckCircle size={12}/> : <AlertTriangle size={12}/>}
                        {msgObj.text}
                      </div>
                    )}
                  </div>
                  <button 
                    onClick={onSync} 
                    disabled={running} 
                    className={`shrink-0 h-9 w-32 justify-center rounded-lg font-bold text-xs flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-wait shadow-sm text-white ${bgClass}`}

                  >
                    <RefreshCw size={12} className={running?"animate-spin":"none"}/>
                    {running?"Rodando...":"Sincronizar"}
                  </button>
                </div>
                </div>
            );
          })}
          
          
          <div className={`p-5 rounded-xl border bg-card transition-all ${tmdbStatus==="ok"?"border-amber-500/30":tmdbStatus==="error"?"border-rose-500/30":tmdbStatus==="running"?"border-amber-500/30 shadow-lg shadow-amber-900/10":"border-border"}`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2.5">
                  <div className={`w-2.5 h-2.5 rounded-full ${tmdbStatus==="ok"?"bg-amber-500":tmdbStatus==="error"?"bg-rose-500":tmdbStatus==="running"?"bg-amber-500 animate-pulse":"bg-amber-500"}`}/>
                  <span className="text-sm font-semibold text-foreground tracking-tight">Enriquecimento TMDB</span>
                </div>
                {tmdbInfo&&<div className="text-xs text-muted-foreground/90 mt-2 pl-5 tracking-tight leading-relaxed">
                  F: {tmdbInfo.filmes.com_tmdb.toLocaleString()} com · {tmdbInfo.filmes.sem_tmdb.toLocaleString()} faltam · S: {tmdbInfo.series.com_tmdb.toLocaleString()} com · {tmdbInfo.series.sem_tmdb.toLocaleString()} faltam
                </div>}
                {tmdbMessage && (
                  <div className={`text-[11px] font-medium mt-1.5 pl-5 tracking-tight flex items-center gap-1.5 ${tmdbMessage.type === "success" ? "text-emerald-500" : "text-rose-500"}`}>
                    {tmdbMessage.type === "success" ? <CheckCircle size={12}/> : <AlertTriangle size={12}/>}
                    {tmdbMessage.text}
                  </div>
                )}
              </div>
              <button 
                onClick={()=>setTmdbConfirm(v=>!v)} 
                disabled={tmdbStatus==="running"} 
                className={`shrink-0 h-9 w-32 justify-center rounded-lg font-bold text-xs flex items-center gap-2 transition-all bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 disabled:cursor-not-allowed shadow-md`}

              >
                <RefreshCw size={12} className={tmdbStatus==="running"?"animate-spin":"none"}/>
                {tmdbStatus==="running"?"Rodando...":"Enriquecer"}
              </button>
            </div>
            {tmdbConfirm && (
              <div className="mt-4 p-4 rounded-xl bg-background border border-border animate-in slide-in-from-top-2">
                <div className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-3">Iniciar Enriquecimento Automático</div>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3.5">
                    {tmdbInfo && (
                      <div className="text-xs font-medium text-foreground">
                        {(tmdbInfo.filmes.sem_tmdb + tmdbInfo.series.sem_tmdb).toLocaleString()} títulos aguardando enriquecimento.
                      </div>
                    )}
                    <button onClick={syncTmdb} disabled={tmdbStatus==="running"} className="h-8 px-4 rounded-md bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow disabled:opacity-50 disabled:cursor-wait">
                      Iniciar
                    </button>
                  </div>
                </div>
              </div>
            )}
</div>
          
          <LimparCatalogo />

        </div>

        <div className="p-4 border-t border-border shrink-0 bg-muted/40">
          <div className="text-[11px] text-muted-foreground flex items-center justify-center gap-2 leading-relaxed"><RefreshCw size={10} className="text-muted-foreground/60"/> Títulos já existentes são ignorados — apenas novos registros são contabilizados.</div>
        </div>
      </div>
      <div className="fixed inset-x-0 top-3 z-[999999] px-4 sm:px-6 pointer-events-none">
        <div className="pointer-events-auto max-w-sm ml-auto">
          <ToastNotifications toasts={toasts} removeToast={removeToast} />
        </div>
      </div>
    </div>
  );
}

// ─── Componente Poster Refatorado (Original e Preservado visivelmente) ───────────
const POSTER_W = 148; // mantido apenas para uso em telas fixas (ex: ResultadoBuscaCatalogo)
const POSTER_H = 222;

function Poster({titulo,posterUrl,coverUrl,fill}:{titulo:string;posterUrl:string|null;coverUrl:string|null;fill?:boolean}) {
  const [err,setErr]=useState(false);
  const src=(!err&&(posterUrl||coverUrl))||null;
  if(fill){
    if(!src) return <div className="w-full aspect-[2/3] rounded-lg flex flex-col items-center justify-center gap-2 border border-border bg-muted/40"><Film size={28} className="text-muted-foreground/60"/><span className="text-[10px] text-muted-foreground/60 text-center px-2 line-clamp-2 leading-snug">{titulo}</span></div>;
    return <img src={src} alt={titulo} loading="lazy" onError={()=>setErr(true)} className="w-full aspect-[2/3] rounded-lg object-cover border border-border shadow-sm bg-card"/>;
  }
  if(!src) return <div className="rounded-lg flex flex-col items-center justify-center gap-2.5 shrink-0 border border-border bg-muted/40" style={{width:POSTER_W,height:POSTER_H}}><Film size={32} className="text-muted-foreground/60"/><span className="text-[10px] text-muted-foreground/60 text-center px-2 line-clamp-2 leading-snug">{titulo}</span></div>;
  return <img src={src} alt={titulo} onError={()=>setErr(true)} className="rounded-lg object-cover shrink-0 border border-border shadow-sm bg-card" style={{width:POSTER_W,height:POSTER_H}}/>;
}

// ─── Carrossel Visivelmente Refatorado (Tailwind e Temas Claro/Escuro) ──────────
const COLS_DESKTOP = 5;
const ROWS = 4;
const ITENS_POR_LINHA = 12; // quantos títulos cada fileira carrega para o swipe

function chunks<T>(arr: T[], n: number): T[][] { const out: T[][] = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

// ✅ Fileira única de pôsteres com scroll horizontal nativo por swipe (sem setas/paginação)
function CarrosselLinha({ itens, onSelect, tipo } : { itens: TituloCard[]; onSelect: (t: TituloCard) => void; tipo: TipoConteudo; }) {
  return (
    <div className="no-scrollbar flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-px-4 pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
      {itens.map(item => {
        const src = item.poster_tmdb_url || item.cover_url;
        const isNovo = item.adicionado_em ? (Date.now() - new Date(item.adicionado_em).getTime()) < 7 * 86400000 : false;
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item)}
            className="group relative shrink-0 snap-start rounded-lg overflow-hidden aspect-[2/3] focus:ring-2 focus:ring-sky-500 outline-none border border-border/80 w-[calc(50%-6px)] sm:w-[160px] md:w-[180px]"
          >
            {src ? <img src={src} alt={item.titulo_normalizado} loading="lazy" className="w-full h-full object-cover rounded-lg group-hover:scale-105 transition-transform duration-300"/> : <div className="w-full h-full rounded-lg bg-muted flex items-center justify-center"><Film size={24} className="text-muted-foreground/50" /></div>}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent group-hover:via-black/40" />
            <div className="absolute bottom-2 left-2 right-2 text-left text-[10px] text-white font-semibold leading-tight line-clamp-2 tracking-tight group-hover:text-sky-300">
              {item.titulo_normalizado}
            </div>
            {isNovo && (
              <div className={`absolute top-1.5 left-1.5 text-[9px] font-bold letter-spacing-0.5 text-white px-1.5 py-0.5 rounded ${tipo === "SERIE" ? "bg-emerald-600" : "bg-sky-600"}`}>
                {tipo === "SERIE" ? "ATUALIZ." : "NOVO"}
              </div>
            )}
            {item.avaliacao && (
              <div className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-black/60 rounded px-1.5 py-0.5">
                <Star size={9} className="fill-amber-400 text-amber-400" />
                <span className="text-[10px] text-amber-400 font-bold">{item.avaliacao.toFixed(1)}</span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ✅ Mantém 4 fileiras empilhadas, cada uma é um carrossel de swipe independente
function Carrossel({ itens, onSelect, tipo }: { itens: TituloCard[]; onSelect: (t: TituloCard) => void; tipo: TipoConteudo }) {
  if (itens.length === 0) return null;
  const linhas = chunks(itens.slice(0, ROWS * ITENS_POR_LINHA), ITENS_POR_LINHA);
  return <div className="flex flex-col gap-5">{linhas.map((linha, i) => <CarrosselLinha key={i} itens={linha} onSelect={onSelect} tipo={tipo} />)}</div>;
}


// ─── Modal Detalhe Título Refatorado (Original e Preservado visivelmente) ───────
type TmdbResultado = { tmdb_id: number; titulo: string; titulo_original: string; ano: number | null; sinopse: string | null; avaliacao: number | null; poster_url: string | null; };

// ✅ Refatorado visivelmente para Tailwind e temas claro/escuro
function ModalDetalhe({id,onClose,modoCliente,servidorFiltro}:{id:string;onClose:()=>void;modoCliente?:boolean;servidorFiltro?:string}) {
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

  // ✅ Hook só chamado no modo admin — evita crash fora do ConfirmProvider
  const adminConfirm = !modoCliente ? useConfirm() : null;
  const confirm = adminConfirm?.confirm;
  const ConfirmUI = adminConfirm?.ConfirmUI ?? null;

  // Lógica original preservada
  useEffect(()=>{
    fetch(`/api/catalogo/detalhe?id=${id}`).then(r=>r.json()).then(d=>{
      if(d.ok){setDetalhe(d.data);setTmdbQ(d.data.titulo_normalizado);}
    }).finally(()=>setLoading(false));
  },[id]);

  // Lógica original preservada
  async function buscarTmdb(){
    if(!tmdbQ.trim()||!detalhe)return;
    setTmdbLoading(true);setTmdbResultados([]);
    const d=await fetch(`/api/catalogo/tmdb-buscar?q=${encodeURIComponent(tmdbQ)}&tipo=${detalhe.tipo}`).then(r=>r.json()).catch(()=>null);
    if(d?.ok)setTmdbResultados(d.data);
    setTmdbLoading(false);
  }

  /// Lógica original preservada
  async function aplicarTmdb(resultado:TmdbResultado){
    if(!detalhe)return;
    // ✅ Novo: Confirmação padrão
    const ok = await confirm({
      title: "Confirmar Enriquecimento",
      subtitle: "Tem certeza que deseja aplicar os dados do TMDB para este título?",
      // tone: "blue", // Removido
      confirmText: "Aplicar",
      cancelText: "Cancelar"
    });
    if (!ok) return;

    setTmdbAplicando(true);
    const d=await fetch("/api/catalogo/tmdb-aplicar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({master_id:detalhe.id,tmdb_id:resultado.tmdb_id,tipo:detalhe.tipo})}).then(r=>r.json()).catch(()=>null);
    if(d?.ok){
      setDetalhe(prev=>prev?{...prev,tmdb_id:resultado.tmdb_id,tmdb_confirmado:true,poster_tmdb_url:resultado.poster_url,sinopse:resultado.sinopse,avaliacao:resultado.avaliacao,ano:resultado.ano||prev.ano}:prev);
      setTmdbOk(true);setShowTmdb(false);setTimeout(()=>setTmdbOk(false),3000);
    }
    setTmdbAplicando(false);
  }

  // ✅ Novo: Deletar título refatorado com useConfirm
  async function handleDeleteIndividual(d:{servidor: string; categoria_origem: string;}) {
    if(!detalhe) return;
    
    const ok = await confirm({
      title: "Deletar Título",
      subtitle: `Tem certeza que deseja deletar este título do servidor "${d.servidor}"?`,
      // tone: "rose", // Removido
      icon: "🗑️",
      confirmText: "Deletar",
      cancelText: "Voltar"
    });
    if (!ok) return;

    setDeletando(true);
    setShowDeleteMenu(false);
    const res=await fetch("/api/catalogo/titulo",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:detalhe.id,servidor:d.servidor})}).then(r=>r.json()).catch(()=>null);
    if(res?.ok){
      setDeleteOk(true);
      if(res.removido_master){setTimeout(()=>onClose(),1500);}
      else{setDetalhe(prev=>prev?{...prev,disponibilidade:prev.disponibilidade.filter(x=>x.servidor!==d.servidor)}:prev);}
    }
    setDeletando(false);
  }

const backdrop=detalhe?.poster_tmdb_url||detalhe?.cover_url||"";

  // ✅ Cliente só vê a disponibilidade do seu próprio servidor
  const disponibilidadeFiltrada = (modoCliente && servidorFiltro && servidorFiltro !== "TODOS")
    ? (detalhe?.disponibilidade || []).filter(d => d.servidor === servidorFiltro)
    : (detalhe?.disponibilidade || []);
  
  return (
    <div className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div 
        onClick={e=>e.stopPropagation()} 
        className="bg-card border border-border w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col animate-in fade-in-0 zoom-in-95 duration-300"
      >
        <div className="relative min-h-[200px] flex-shrink-0 bg-muted/30">
          {backdrop&&<><img src={backdrop} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40"/><div className="absolute inset-0 bg-gradient-to-t from-card via-card/70 to-card/20"/></>}
          <button onClick={onClose} className="absolute top-4 right-4 bg-card/80 text-muted-foreground hover:text-rose-500 rounded-full p-2 hover:bg-rose-500/10 transition-colors z-10"><X size={20}/></button>
          {!loading&&detalhe&&(
            <div className="relative p-5 sm:p-6 flex gap-4 sm:gap-6 items-end pt-16">
              <Poster titulo={detalhe.titulo_normalizado} posterUrl={detalhe.poster_tmdb_url} coverUrl={detalhe.cover_url}/>
              <div className="flex-1 min-w-0 pb-1">
                <div className="flex items-center gap-2 mb-2.5 flex-wrap">
                  <span className={`text-[10px] sm:text-[11px] font-bold text-white px-2.5 py-1 rounded-full uppercase tracking-wide inline-flex items-center gap-1.5 ${detalhe.tipo==="FILME"?"bg-amber-600":"bg-sky-600"}`}>
                    {detalhe.tipo==="FILME"?"Filme":"Série"}
                    {(() => {
                      const caminho = modoCliente
                        ? disponibilidadeFiltrada[0]?.categoria_origem
                        : null;
                      if (!caminho) return null;
                      // remove prefixo redundante tipo "FILMES:", "Séries:", "SERIES -" etc.
                      const limpo = caminho.replace(/^(filmes?|s[eé]ries?)\s*[:\-–]\s*/i, "").trim();
                      return <>{" | "}{limpo || caminho}</>;
                    })()}
                  </span>
                  {detalhe.ano&&<span className="text-sm font-medium text-muted-foreground">{detalhe.ano}</span>}
                  {detalhe.avaliacao&&<span className="text-sm text-amber-500 flex items-center gap-1.5 font-semibold"><Star size={14} className="fill-amber-500"/>{detalhe.avaliacao.toFixed(1)}</span>}
                  {!modoCliente && (detalhe.tmdb_confirmado
                    ?<span className="text-xs font-medium text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">TMDB ✓</span>
                    :<span className="text-xs font-medium text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/30">Falta TMDB</span>
                  )}
                </div>
                <div className="text-base sm:text-2xl font-extrabold text-foreground leading-tight tracking-tight whitespace-normal line-clamp-3">{detalhe.titulo_normalizado}</div>
              </div>
            </div>
          )}
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-6 bg-card">
          {loading&&<div className="text-center p-12 text-muted-foreground italic animate-pulse">Carregando detalhes do título...</div>}
          {!loading&&!detalhe&&<div className="text-center p-12 text-rose-500 font-medium">Título não encontrado no banco de dados.</div>}
          {!loading&&detalhe&&(
            <>
{!modoCliente && (
              <div className="flex items-center gap-3 justify-end flex-wrap border-b border-border/80 pb-5">
                {tmdbOk&&<span className="text-sm text-emerald-500 flex items-center gap-1.5 font-medium"><CheckCircle size={14}/> TMDB atualizado</span>}
                {deleteOk&&<span className="text-sm text-emerald-500 flex items-center gap-1.5 font-medium"><CheckCircle size={14}/> Removido com sucesso</span>}
                <button onClick={()=>setShowTmdb(v=>!v)} className={`h-8 px-4 rounded-lg font-semibold text-xs flex items-center gap-2 transition-all ${showTmdb ? 'bg-indigo-600 text-white shadow' : 'bg-muted hover:bg-muted/80 text-foreground'}`}><RefreshCw size={12}/> {showTmdb?"Fechar Busca":"Corrigir TMDB"}</button>
                <div className="relative">
                  <button onClick={()=>setShowDeleteMenu(v=>!v)} disabled={deletando} className={`h-8 px-4 rounded-lg font-semibold text-xs flex items-center gap-2 transition-all disabled:opacity-60 disabled:cursor-wait ${showDeleteMenu ? 'bg-rose-600 text-white shadow' : 'bg-muted hover:bg-muted/80 text-foreground'}`}><X size={12}/> Deletar Individual</button>
                  {showDeleteMenu&&<div className="absolute top-full mt-2 right-0 bg-muted/90 border border-border rounded-xl p-3 z-20 min-w-56 shadow-2xl backdrop-blur"><div className="text-xs font-bold text-rose-500 mb-2.5 uppercase tracking-wide">Remover de qual servidor?</div><div className="flex flex-col gap-2">{detalhe.disponibilidade.map(d=>(<button key={d.servidor} onClick={() => handleDeleteIndividual(d)} className="w-full flex items-center gap-3 p-2.5 rounded-lg bg-card border border-border hover:border-rose-500/40 text-left text-foreground text-xs"><div className="w-2 h-2 rounded-full" style={{background:COR_SERVIDOR[d.servidor]||"#6b7280"}}/>{d.servidor}<span className="text-muted-foreground/70 ml-auto">{d.categoria_origem}</span></button>))}{detalhe.disponibilidade.length>1&&(
                    <button onClick={async()=>{
                    // ✅ Novo: Confirmação padrão
                    const ok = await confirm({
                      title: "Deletar de TODOS",
                      subtitle: `Tem certeza que deseja deletar este título de TODOS (${detalhe.disponibilidade.length}) os servidores?`,
                      // tone: "rose", // Removido
                      icon: "⚠️",
                      confirmText: "Deletar Todos",
                      cancelText: "Voltar"
                    });
                    if (!ok) return;

                    setDeletando(true);setShowDeleteMenu(false);
                    for(const d of detalhe.disponibilidade){await fetch("/api/catalogo/titulo",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:detalhe.id,servidor:d.servidor})}).then(r=>r.json()).catch(()=>null);}
                    setDeleteOk(true);setDeletando(false);setTimeout(()=>onClose(),1500);
                  }} className="w-full flex items-center gap-3 p-2.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-500 text-xs font-semibold mt-2 transition-colors"><X size={12}/> Remover de TODOS</button>
                  )}
                  </div>
                  </div>}
                </div>
              </div>
              )}

              {!modoCliente && showTmdb&&(
                <div className="p-5 rounded-xl border border-indigo-500/30 bg-indigo-500/[0.01] animate-in slide-in-from-top-2">
                  <div className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4"><Search size={16} className="text-indigo-500"/> Buscar no banco TMDB</div>
                  <div className="flex gap-2.5 mb-5">
                    <input value={tmdbQ} onChange={e=>setTmdbQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&buscarTmdb()} className="flex-1 h-10 px-4 bg-muted/40 border border-border rounded-lg text-foreground text-sm outline-none focus:border-indigo-500/50" placeholder="Digite o nome correto do título para buscar..."/>
                    <button onClick={buscarTmdb} disabled={tmdbLoading} className="h-10 px-6 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-900/20 disabled:opacity-70 disabled:cursor-wait">{tmdbLoading?<RefreshCw size={14} className="animate-spin"/>:"Buscar"}</button>
                  </div>
                  {tmdbResultados.length>0&&(
                    <div className="flex flex-col gap-2.5 max-h-80 overflow-y-auto pr-1">
                      {tmdbResultados.map(r=>(
                        <div key={r.tmdb_id} className="group p-3 rounded-lg bg-card border border-border hover:border-indigo-500/30 flex gap-3.5 items-start">
                          {r.poster_url?<img src={r.poster_url} alt={r.titulo} className="w-16 rounded-lg flex-shrink-0 border border-border"/>:<div className="w-16 aspect-[2/3] rounded-lg bg-muted flex items-center justify-center border border-border"><Film size={16} className="text-muted-foreground/50"/></div>}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold text-foreground leading-snug group-hover:text-indigo-400">{r.titulo}</div>
                            {r.titulo_original!==r.titulo&&<div className="text-xs text-muted-foreground mt-1">{r.titulo_original}</div>}
                            <div className="flex items-center gap-3.5 mt-2 flex-wrap">
                              {r.ano&&<span className="text-xs font-medium text-muted-foreground/90">{r.ano}</span>}
                              {r.avaliacao&&<span className="text-xs text-amber-500 font-semibold flex items-center gap-1.5"><Star size={11} className="fill-amber-500"/>{r.avaliacao.toFixed(1)}</span>}
                              <span className="text-xs text-muted-foreground/60">ID: {r.tmdb_id}</span>
                            </div>
                            {r.sinopse&&<div className="text-xs text-muted-foreground leading-relaxed mt-2.5 line-clamp-2">{r.sinopse}</div>}
                          </div>
                          <button onClick={()=>aplicarTmdb(r)} disabled={tmdbAplicando} className="shrink-0 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded disabled:opacity-60">Aplicar →</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {tmdbResultados.length===0&&!tmdbLoading&&<div className="text-center p-6 text-sm text-muted-foreground italic bg-muted/20 rounded-lg">Pressione "Buscar" para encontrar resultados.</div>}
                </div>
              )}

              {detalhe.sinopse&&<div className="bg-muted/20 p-5 rounded-xl border border-border"><div className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3.5">Sinopse</div><div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto pr-1">{detalhe.sinopse}</div></div>}
              
<div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-1">
                {!modoCliente && detalhe.disponibilidade.length>0&&(
                  <div className="space-y-3.5"><div className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-4">Disponível em ({detalhe.disponibilidade.length})</div>
                  {detalhe.disponibilidade.map((d,i)=>(<div key={i} className="flex items-center gap-3.5 p-3.5 rounded-xl border border-border bg-card/60"><div className="w-2 h-2 rounded-full flex-shrink-0" style={{background:COR_SERVIDOR[d.servidor]||"#6b7280"}}/><div><div className="text-sm font-semibold text-foreground tracking-tight">{d.servidor}</div><div className="text-xs text-muted-foreground/90 mt-0.5">{d.categoria_origem}</div></div></div>))}</div>
                )}
                {detalhe.tipo==="SERIE"&&detalhe.temporadas.length>0&&(
                  <div className="space-y-3.5"><div className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-4">Temporadas ({detalhe.temporadas.length})</div>
                  {detalhe.temporadas.map(t=><div key={t.temporada} className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-border bg-card/60"><span className="text-sm font-medium text-foreground tracking-tight">Temporada {t.temporada}</span><span className="text-xs text-muted-foreground font-medium">{t.total_episodios} episódios</span></div>)}</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {ConfirmUI}
    </div>
  );
}

// ✅ Refatorado visivelmente para Tailwind e temas claro/escuro
function ResultadoBuscaCatalogo({resultados,loading,onSelect}:{resultados:TituloBusca[];loading:boolean;onSelect:(t:TituloCard)=>void}) {
  if(loading)return <div className="text-center py-20 text-muted-foreground p-5 animate-pulse flex flex-col items-center gap-4"><RefreshCw size={24} className="animate-spin text-muted-foreground/60"/> Buscando no catálogo...</div>;
  if(resultados.length===0)return <div className="text-center py-20 text-muted-foreground p-5 border border-border bg-card/60 rounded-2xl flex flex-col items-center gap-3"><Search size={32} className="text-muted-foreground/60"/><div className="text-sm font-medium">Nenhum resultado encontrado.</div><div className="text-xs text-muted-foreground">Tente buscar por termos mais genéricos.</div></div>;
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      {resultados.map(t=>(
        <button key={t.id} onClick={()=>onSelect(t)} className="flex items-start gap-4 p-4 rounded-2xl bg-card border border-border hover:border-sky-500/30 hover:bg-sky-500/[0.01] transition-all text-left group">
          <div className="w-[148px] flex-shrink-0"><Poster titulo={t.titulo_normalizado} posterUrl={t.poster_tmdb_url} coverUrl={t.cover_url}/></div>
          <div className="flex-1 min-w-0 pt-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={`text-[10px] font-bold text-white px-2 py-0.5 rounded-full uppercase tracking-wide ${t.tipo==="FILME"?"bg-amber-600":"bg-sky-600"}`}>{t.tipo==="FILME"?"Filme":"Série"}</span>
              {t.ano&&<span className="text-xs font-medium text-muted-foreground">{t.ano}</span>}
              {t.avaliacao&&<span className="text-xs text-amber-500 flex items-center gap-1 font-semibold"><Star size={11} className="fill-amber-500"/>{t.avaliacao.toFixed(1)}</span>}
            </div>
            <div className="text-base font-bold text-foreground leading-snug group-hover:text-sky-400 tracking-tight whitespace-normal mb-3">{t.titulo_normalizado}</div>
            {t.sinopse&&<div className="text-xs text-muted-foreground/90 overflow-hidden line-clamp-3 leading-relaxed mb-4">{t.sinopse}</div>}
            <div className="flex gap-2 flex-wrap pt-1 border-t border-border/80 mt-2">{t.rotas.map((r,i)=><span key={i} className="text-[10px] font-semibold bg-muted border border-border px-2.5 py-1 rounded-full uppercase tracking-wide" style={{borderColor: (COR_SERVIDOR[r.servidor]||"#94a3b8") + "40", color: COR_SERVIDOR[r.servidor]||"#94a3b8"}}>{r.servidor} / {r.categoria}</span>)}</div>
          </div>
          <div className="shrink-0 pt-10"><ChevronRight className="w-5 h-5 text-border/70 group-hover:text-sky-500"/></div>
        </button>
      ))}
    </div>
  );
}

// ✅ Refatorado visivelmente para Tailwind e temas claro/escuro
function GradeMiniaturas({titulos,total,page,perPage=50,onSelect,onPage}:{titulos:TituloCard[];total:number;page:number;perPage?:number;onSelect:(t:TituloCard)=>void;onPage:(p:number)=>void}) {
  const totalPags=Math.ceil(total/perPage);
  return (
    <div className="pb-10">
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 sm:gap-5">
        {titulos.map(t=>(
          <button key={t.id} onClick={()=>onSelect(t)} className="flex flex-col gap-2 p-0 bg-transparent border-none focus:ring-0 group w-full" title={t.titulo_normalizado}>
            <div className="relative rounded-lg overflow-hidden border border-border bg-muted/30">
              <Poster titulo={t.titulo_normalizado} posterUrl={t.poster_tmdb_url} coverUrl={t.cover_url} fill/>
              {t.avaliacao&&<div className="absolute top-1.5 left-1.5 bg-black/70 rounded px-1.5 py-0.5 flex items-center gap-1"><Star size={9} className="fill-amber-400 text-amber-400"/><span className="text-[10px] text-amber-400 font-bold">{t.avaliacao.toFixed(1)}</span></div>}
              <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors rounded-lg flex items-center justify-center"><ChevronRight className="w-8 h-8 text-white/0 group-hover:text-white transition-opacity scale-50 group-hover:scale-100"/></div>
            </div>
            <div className="text-[11px] font-semibold text-foreground leading-tight line-clamp-2 group-hover:text-sky-400 w-full px-0.5">{t.titulo_normalizado}</div>
            {t.ano&&<div className="text-[10px] text-muted-foreground px-0.5">{t.ano}</div>}
          </button>
        ))}
      </div>
      {totalPags>1&&<div className="flex items-center justify-center gap-3 mt-12 bg-muted/40 p-4 rounded-xl border border-border max-w-sm mx-auto">
        <button disabled={page<=1} onClick={()=>onPage(page-1)} className="h-9 px-4 rounded-lg bg-card border border-border text-foreground text-xs font-semibold hover:border-foreground/20 disabled:opacity-50 transition-colors">← Anterior</button>
        <span className="text-sm font-semibold text-foreground">{page} / {totalPags}</span>
        <button disabled={page>=totalPags} onClick={()=>onPage(page+1)} className="h-9 px-4 rounded-lg bg-card border border-border text-foreground text-xs font-semibold hover:border-foreground/20 disabled:opacity-50 transition-colors">Próxima →</button>
      </div>}
    </div>
  );
}

// ─── Aba Catálogo Refatorada (Tailwind e Temas Claro/Escuro) ──────────────────
function AbaCatalogo({tipo,servidorAdmin,modoCliente}:{tipo:TipoConteudo;servidorAdmin:ServidorId|"TODOS";modoCliente?:boolean}) {
  // servidorAdmin já É o servidor do cliente quando modoCliente=true e servidorAdmin !== "TODOS"
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

  useEffect(()=>{ function h(e:MouseEvent){if(catDropRef.current&&!catDropRef.current.contains(e.target as Node))setCatDropOpen(false);} document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h); },[]);
  useEffect(()=>{ function h(e:MouseEvent){if(subDropRef.current&&!subDropRef.current.contains(e.target as Node))setSubDropOpen(false);} document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h); },[]);

  // Lógica original preservada
  useEffect(()=>{ setLoadingNov(true);setNovidades([]); fetch(`/api/catalogo/novidades?servidor=${servidor}&tipo=${tipo}`) .then(r=>r.json()).then(d=>{if(d.ok&&d.data)setNovidades(d.data);}).finally(()=>setLoadingNov(false)); },[servidor,tipo]);
  useEffect(()=>{ setLoadingCats(true);setCatSelecionada(null);setSubCatSelecionada(null);setSubCategorias([]);setTitulos([]); fetch(`/api/catalogo/categorias?servidor=${servidor}&tipo=${tipo}`) .then(r=>r.json()).then(d=>{ if(d.ok){ const filtradas=(d.data as Categoria[]) .filter(c=>isCategoriaPrincipal(c.categoria_origem,c.total)) .sort((a,b)=>a.label.localeCompare(b.label,"pt-BR")); setCategorias(filtradas); } }).finally(()=>setLoadingCats(false)); },[servidor,tipo]);
  // useEffect para subcategorias - mantido vazio conforme original
  useEffect(()=>{ setSubCatSelecionada(null);setSubCategorias([]); if(!catSelecionada)return; },[catSelecionada]);
  useEffect(()=>{ const cat=subCatSelecionada||catSelecionada; if(!cat)return; setLoadingTits(true);setTitulos([]); fetch(`/api/catalogo/titulos?servidor=${servidor}&tipo=${tipo}&categoria=${encodeURIComponent(cat.categoria_origem)}&page=${page}`) .then(r=>r.json()).then(d=>{if(d.ok){setTitulos(d.data);setTotalTitulos(d.total);setPerPage(d.per_page||50);}}).finally(()=>setLoadingTits(false)); },[catSelecionada,subCatSelecionada,servidor,tipo,page]);
  useEffect(()=>{ if(!buscaAtiva.trim()){setResultadosBusca([]);return;} setLoadingBusca(true); const srv=servidor; fetch(`/api/catalogo/busca?q=${encodeURIComponent(buscaAtiva)}&servidor=${srv}&tipo=${tipo}`) .then(r=>r.json()).then(d=>{if(d.ok)setResultadosBusca(d.data);}).finally(()=>setLoadingBusca(false)); },[buscaAtiva,servidor,tipo,servidorAdmin]);

  const SERVIDORES:(ServidorId|"TODOS")[]=["TODOS","ELITE","NATV","FAST"];
  const emBusca=buscaAtiva.trim().length>0;
  const catAtiva=subCatSelecionada||catSelecionada;

  return (
  <div className="flex-1 flex flex-col min-h-0 bg-background overflow-hidden">
    <div className="flex-shrink-0 px-4 sm:px-5 py-3 border-b border-border bg-card z-30 relative shadow-sm space-y-2">
      
      {/* Linha 1: Servidores (só admin) */}
      {servidorAdmin==="TODOS" && (
        <div className="flex items-center gap-2 flex-wrap">
          {SERVIDORES.map(srv=>{
            const cor = srv==="TODOS" ? "var(--muted-foreground)" : (COR_SERVIDOR[srv as ServidorId]||"#94a3b8");
            const ativo = servidor===srv;
            return(
  <button key={srv} onClick={()=>{setServidor(srv as ServidorId|"TODOS");setCatSelecionada(null);setSubCatSelecionada(null);setPage(1);setBusca("");setBuscaAtiva("");setDetalhando(null);}}
              className={`h-8 px-4 rounded-full font-bold text-xs border transition-all ${ativo ? 'bg-indigo-600 text-white shadow shadow-indigo-900/10' : 'bg-muted/40 border-border/80 text-muted-foreground hover:border-foreground/20 hover:text-foreground'}`}>
              {srv}
            </button>
            );
          })}
        </div>
      )}

      {/* Linha 2: Categoria + Subcategoria + Limpar + Busca na mesma linha */}
      <div className="flex items-center gap-2">
        <div ref={catDropRef} className="relative shrink-0">
          <button onClick={()=>setCatDropOpen(o=>!o)} className={`flex items-center gap-2 h-8 px-4 rounded-full font-semibold text-xs border transition-all ${catSelecionada ? 'bg-sky-600 text-white shadow shadow-sky-900/10' : 'bg-muted text-muted-foreground border-border/80 hover:border-foreground/20 hover:text-foreground'}`}>
            <CatIcon slug={catSelecionada?.emoji || "default"} size={13} color={catSelecionada ? "text-white" : "text-muted-foreground/90"} />
            {catSelecionada?.label || "Categorias"}
            <ChevronDown size={12} className={`opacity-60 transform ${catDropOpen?"rotate-180":"none"} transition-transform duration-150`}/>
          </button>
          {catDropOpen&&!loadingCats&&(
            <div className="absolute top-[calc(100%+8px)] left-0 min-w-56 max-h-80 overflow-y-auto bg-card border border-border rounded-2xl shadow-2xl z-50 p-2.5 animate-in slide-in-from-top-2 duration-150">
              <button onClick={()=>{setCatSelecionada(null);setSubCatSelecionada(null);setCatDropOpen(false);setPage(1);}} className="w-full text-left flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">
                <Database size={13} /> Todas as categorias
              </button>
              <div className="w-full h-px bg-border my-2"/>
              {categorias.map(c=>(
                <button key={c.categoria_origem} onClick={()=>{setCatSelecionada(c);setSubCatSelecionada(null);setPage(1);setCatDropOpen(false);}}
                  className={`w-full text-left flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${catSelecionada?.categoria_origem===c.categoria_origem ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                  <span className="flex items-center gap-2.5 min-w-0"><CatIcon slug={c.emoji} size={15} color="text-muted-foreground/90"/><span className="truncate">{c.label}</span></span>
                  <span className="text-[11px] font-bold text-muted-foreground/70 bg-background border border-border px-1.5 py-0.5 rounded">{c.total.toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {catSelecionada&&subCategorias.length>0&&(
          <div ref={subDropRef} className="relative shrink-0">
            <button onClick={()=>setSubDropOpen(o=>!o)} className={`flex items-center gap-2 h-8 px-4 rounded-full font-semibold text-xs border transition-all ${subCatSelecionada ? 'bg-emerald-600 text-white shadow shadow-emerald-900/10' : 'bg-muted text-muted-foreground border-border/80 hover:border-foreground/20 hover:text-foreground'}`}>
              <CatIcon slug={subCatSelecionada?.emoji || "default"} size={13} color={subCatSelecionada ? "text-white" : "text-muted-foreground/90"} />
              {subCatSelecionada?.label || "Subcategoria"}
              <ChevronDown size={12} className={`opacity-60 transform ${subDropOpen?"rotate-180":"none"} transition-transform duration-150`}/>
            </button>
            {subDropOpen&&(
              <div className="absolute top-[calc(100%+8px)] left-0 min-w-56 max-h-80 overflow-y-auto bg-card border border-border rounded-2xl shadow-2xl z-50 p-2.5 animate-in slide-in-from-top-2 duration-150">
                <button onClick={()=>{setSubCatSelecionada(null);setSubDropOpen(false);setPage(1);}} className="w-full text-left flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">Todas</button>
                <div className="w-full h-px bg-border my-2"/>
                {subCategorias.map(c=>(
                  <button key={c.categoria_origem} onClick={()=>{setSubCatSelecionada(c);setPage(1);setSubDropOpen(false);}}
                    className={`w-full text-left flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${subCatSelecionada?.categoria_origem===c.categoria_origem ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                    <span className="flex items-center gap-2.5 min-w-0"><CatIcon slug={c.emoji} size={15} color="text-muted-foreground/90"/><span className="truncate">{c.label}</span></span>
                    <span className="text-[11px] font-bold text-muted-foreground/70 bg-background border border-border px-1.5 py-0.5 rounded">{c.total.toLocaleString()}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {(catAtiva || busca.trim() !== "") && (
          <button onClick={()=>{setCatSelecionada(null);setSubCatSelecionada(null);setBusca("");setBuscaAtiva("");setPage(1);}}
            className="shrink-0 flex items-center gap-1 h-8 px-3 rounded-full bg-card border border-border text-muted-foreground hover:bg-muted text-xs font-medium transition-all">
            <X size={12} className="text-rose-500"/> Limpar
          </button>
        )}

        <div className="relative flex-1 min-w-0">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none"/>
          <input value={busca} onChange={e=>{setBusca(e.target.value);if(!e.target.value.trim()){setBuscaAtiva("");return;} setBuscaAtiva(e.target.value.trim());}} onKeyDown={e=>{ if(e.key==="Enter") setBuscaAtiva(busca.trim()); if(e.key==="Escape"){setBusca("");setBuscaAtiva("");} }} placeholder={`Pesquisar ${tipo==="FILME"?"filmes":"séries"}...`} className="w-full h-8 pl-9 pr-8 bg-transparent border border-border rounded-full text-sm text-foreground outline-none focus:border-emerald-500/50 transition-colors" />
          {busca&&<button onClick={()=>{setBusca("");setBuscaAtiva("");setResultadosBusca([])}} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"><X size={13}/></button>}
        </div>
      </div>
    </div>

    <div className="flex-1 px-4 sm:px-5 py-5 overflow-y-auto z-10 relative">
      {emBusca?(
        <ResultadoBuscaCatalogo resultados={resultadosBusca} loading={loadingBusca} onSelect={t=>setDetalhando(t.id)}/>
      ):catAtiva?(
        <div>
          <div className="flex items-center gap-2 mb-6 p-4 rounded-xl border border-border bg-card/60">
            <span className="text-base font-semibold text-foreground flex items-center gap-2.5 min-w-0"><CatIcon slug={catAtiva.emoji} size={16} color="text-sky-500"/>{catAtiva.label}</span>
            <span className="text-xs font-medium text-muted-foreground/90 ml-1">({totalTitulos.toLocaleString()} títulos cadastrados)</span>
            <button onClick={()=>{setCatSelecionada(null);setSubCatSelecionada(null);setPage(1);}} className="ml-auto h-8 px-4 rounded-lg bg-card border border-border text-foreground text-xs font-semibold hover:border-foreground/20 transition-colors">← Voltar</button>
          </div>
          {loadingTits?<div className="text-center py-20 text-muted-foreground animate-pulse flex flex-col items-center gap-4"><RefreshCw size={24} className="animate-spin text-muted-foreground/60"/> Carregando títulos...</div>:
            <GradeMiniaturas titulos={titulos} total={totalTitulos} page={page} perPage={perPage} onSelect={t=>setDetalhando(t.id)} onPage={p=>setPage(p)}/>}
        </div>
      ):(
        <div className="flex flex-col gap-6">
          {loadingNov?(
            <div className="h-60 bg-card rounded-xl border border-border animate-pulse flex items-center justify-center"><RefreshCw size={24} className="animate-spin text-muted-foreground/50"/></div>
          ):novidades.length>0?(
            <div className="space-y-4">
              <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Adicionados recentemente (Capas TMDB)</div>
              <Carrossel itens={novidades} onSelect={t=>setDetalhando(t.id)} tipo={tipo}/>
            </div>
          ):(
            <div className="text-center py-12 p-5 text-muted-foreground/70 italic text-sm bg-card border border-border rounded-xl">Nenhum título recente com dados TMDB encontrados no banco. Rode o Sync TMDB no Catálogo.</div>
          )}
        </div>
      )}
    </div>
    {detalhando&&<ModalDetalhe id={detalhando} onClose={()=>setDetalhando(null)} modoCliente={modoCliente} servidorFiltro={servidorAdmin}/>}
  </div>
);
}

// ─── Busca EPG (Original e Refatorada Visivelmente) ───────────────────────────
function ResultadoBuscaEPG({epg,busca,progsPorCanal,onClear}:{epg:EpgData;busca:string;progsPorCanal:Map<string,Programa[]>;onClear:()=>void}) {
  const [detalhe,setDetalhe]=useState<null|{tipo:"canal";canal:Canal}|{tipo:"programa";titulo:string}>(null);
  const [progSel,setProgSel]=useState<Programa|null>(null);
  const agora=Date.now();
  
  // Lógica original preservada
  const canaisMatch=useMemo(()=>epg.canais.filter(c=>normalizar(c.nome).includes(normalizar(busca))||normalizar(c.display_name).includes(normalizar(busca))),[epg,busca]);
  const programasMatch=useMemo(()=>{const titulos=new Map<string,{prog:Programa;canal:Canal}[]>();const cmap=new Map(epg.canais.map(c=>[c.id,c]));for(const p of epg.programas){if(!normalizar(p.title).includes(normalizar(busca)))continue;const c=cmap.get(p.channel_id);if(!c)continue;const arr=titulos.get(p.title)||[];arr.push({prog:p,canal:c});titulos.set(p.title,arr);}return[...titulos.entries()].map(([titulo,items])=>({titulo,items:items.sort((a,b)=>new Date(a.prog.start).getTime()-new Date(b.prog.start).getTime())})).sort((a,b)=>b.items.length-a.items.length);},[epg,busca]);
const agoraMs = agora;

  if(detalhe?.tipo==="canal")return(
    <>
      {progSel&&<ProgramaTooltip prog={progSel} onClose={()=>setProgSel(null)}/>}
      <ModalDetalheCanal
        canal={detalhe.canal}
        progsPorCanal={progsPorCanal}
        agoraMs={agoraMs}
        onProgSelect={setProgSel}
        onClose={()=>setDetalhe(null)}
      />
    </>
  );
  
  if(detalhe?.tipo==="programa"){const ocorrencias=programasMatch.find(p=>p.titulo===detalhe.titulo)?.items||[];return(<div className="p-6 bg-background space-y-5"><div className="flex items-center gap-4 p-4 border border-border bg-card rounded-2xl shadow-sm"><button onClick={()=>setDetalhe(null)} className="h-8 px-4 rounded-lg bg-transparent border border-border text-muted-foreground hover:bg-muted hover:text-foreground text-xs font-semibold transition-colors shrink-0">← Voltar</button><div className="flex-1 min-w-0"><div className="text-base font-bold text-foreground leading-snug">{detalhe.titulo}</div><div className="text-xs text-muted-foreground/90 mt-0.5">{ocorrencias.length} canal(is) exibindo</div></div><button onClick={onClear} className="h-8 px-3.5 rounded-lg bg-muted text-muted-foreground hover:border-foreground/20 hover:text-foreground text-[11px] font-semibold transition-colors flex items-center gap-1.5"><X size={13}/> Nova busca</button></div><div className="space-y-3 p-4 border border-border bg-card rounded-2xl shadow-sm">{ocorrencias.map((item,i)=>{const sMs=new Date(item.prog.start).getTime();const eMs=new Date(item.prog.stop).getTime();const emAndamento=agoraMs>=sMs&&agoraMs<eMs;const passou=agoraMs>=eMs;const corCanal=CAT_COR[item.canal.categoria]||"#6b7280";return(<div key={i} className={`flex flex-col md:flex-row md:items-center gap-4 p-4 rounded-lg border transition-all ${emAndamento ? 'border-sky-500/30 bg-sky-500/[0.01]' : passou ? 'border-border bg-card opacity-50' : 'border-border bg-card'}`}>{passou&&<span className="shrink-0 text-[10px] font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-full tracking-wide uppercase">Passou</span>}{emAndamento&&<span className="shrink-0 text-[10px] font-bold text-sky-500 bg-sky-500/15 px-2 py-0.5 rounded-full tracking-wide uppercase">AO VIVO</span>}<Logo src={item.canal.icon} nome={item.canal.nome} categoria={item.canal.categoria} size={40}/><div className="flex-1 min-w-0 md:border-l md:border-border md:pl-4"> <div className="text-base font-bold text-foreground leading-snug group-hover:text-sky-500 tracking-tight whitespace-normal">{item.canal.nome}</div> <div className="text-xs text-muted-foreground/90 mt-0.5">{item.canal.categoria}</div> </div> <span className="text-sm font-mono text-muted-foreground/90 font-medium shrink-0 min-w-28 text-right ml-auto">{formatHora(item.prog.start)} – {formatHora(item.prog.stop)}</span><span className="text-xs text-muted-foreground/60 shrink-0 ml-4 hidden md:block">{item.prog.duracao_min} min</span></div>);})}</div></div>);}
  
  return(<div className="p-6 bg-background space-y-6"><div className="flex items-center justify-between gap-4 p-4 border border-border bg-card rounded-xl shadow-sm"><div className="text-sm text-foreground/90 flex items-center gap-2"><Search size={14} className="text-muted-foreground/60"/> Resultados para pesquisa por: <span className="text-foreground font-semibold">"{busca}"</span></div><button onClick={onClear} className="h-8 px-3.5 rounded-lg bg-transparent border border-border text-muted-foreground hover:bg-muted hover:text-foreground text-xs font-semibold transition-colors flex items-center gap-1.5"><X size={13}/> Limpar Pesquisa</button></div>{canaisMatch.length>0&&(<div className="space-y-4 pt-1"><div className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest pl-1 flex items-center gap-2"><Tv size={13} className="text-muted-foreground/60"/> CANAIS ENCONTRADOS ({canaisMatch.length})</div><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">{canaisMatch.map(canal=>{const progsCanal=progsPorCanal.get(canal.id)||[];const atual=progsCanal.find(p=>{const sMs=new Date(p.start).getTime();const eMs=new Date(p.stop).getTime();return agoraMs>=sMs&&agoraMs<eMs;});return(<div key={canal.id} onClick={()=>setDetalhe({tipo:"canal",canal})} className="flex items-center gap-3.5 p-3.5 rounded-xl border border-border bg-card hover:border-foreground/20 hover:bg-muted/30 transition-all cursor-pointer group"><Logo src={canal.icon} nome={canal.nome} categoria={canal.categoria} size={40}/><div className="flex-1 min-w-0"><div className="text-sm font-semibold text-foreground group-hover:text-sky-500 truncate">{canal.nome}</div><div className="text-[11px] text-muted-foreground/90 mt-1 flex flex-col gap-0.5">{canal.categoria}{atual?(<span className="text-foreground/70 truncate pt-0.5">• {atual.title}</span>):""}</div></div><ChevronRight className="w-5 h-5 text-border/70 group-hover:text-sky-500 shrink-0 ml-auto"/></div>);})}</div></div>)}{programasMatch.length>0&&(<div className="space-y-4 pt-3 border-t border-border/80"><div className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest pl-1 flex items-center gap-2"><Clapperboard size={13} className="text-muted-foreground/60"/> PROGRAMAS ENCONTRADOS ({programasMatch.length})</div><div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{programasMatch.map(({titulo,items})=>{const emAr=items.some(i=>{const sMs=new Date(i.prog.start).getTime();const eMs=new Date(i.prog.stop).getTime();return agoraMs>=sMs&&agoraMs<eMs;});return(<div key={titulo} onClick={()=>setDetalhe({tipo:"programa",titulo})} className={`flex items-center gap-3.5 p-3.5 rounded-xl border transition-all cursor-pointer group ${emAr ? 'border-sky-500/30 bg-sky-500/[0.01]' : 'border-border bg-card hover:border-foreground/20 hover:bg-muted/30'}`}><div className="flex-1 min-w-0"><div className="flex items-center gap-2 mb-1">{emAr&&<span className="shrink-0 text-[9px] font-bold text-sky-500 bg-sky-500/15 px-1.5 py-0.5 rounded uppercase">Passando</span>}<span className={`text-sm font-semibold group-hover:text-sky-500 truncate ${emAr ? 'text-sky-500' : 'text-foreground'}`}>{titulo}</span></div><div className="text-[11px] text-muted-foreground/90 mt-1">Exibindo em {items.length} canal(is) agora.</div></div><ChevronRight className="w-5 h-5 text-border/70 group-hover:text-sky-500 shrink-0 ml-auto"/></div>);})}</div></div>)}{canaisMatch.length===0&&programasMatch.length===0&&(<div className="text-center py-20 text-muted-foreground p-5 border border-border bg-card/60 rounded-xl flex flex-col items-center gap-3"><Search size={32} className="text-muted-foreground/60"/><div className="text-sm font-medium">Nenhum canal ou programa encontrado para "{busca}".</div><div className="text-xs text-muted-foreground">Tente buscar por termos mais genéricos.</div></div>)}</div>);
}

// ─── Aba Canais Refatorada (Performance e Visual de Lista) ─────────────────────
function AbaCanais({epg,progsPorCanal}:{epg:EpgData;progsPorCanal:Map<string,Programa[]>}) {
  const [catAtiva,setCatAtiva]=useState("Todos");
  const [subAtiva,setSubAtiva]=useState("Todos");
  const [busca,setBusca]=useState("");
  const [buscaAtiva,setBuscaAtiva]=useState("");
  const [catOpen,setCatOpen]=useState(false);
  const catRef=useRef<HTMLDivElement>(null);
  const [subOpen,setSubOpen]=useState(false);
  const subRef=useRef<HTMLDivElement>(null);
  
  // Lógica original preservada
  useEffect(()=>{ function h(e:MouseEvent){if(catRef.current&&!catRef.current.contains(e.target as Node))setCatOpen(false);} document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h); },[]);
  useEffect(()=>{ function h(e:MouseEvent){if(subRef.current&&!subRef.current.contains(e.target as Node))setSubOpen(false);} document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h); },[]);
  const catsDisponiveis=useMemo(()=>{const s=new Set(epg.canais.map(c=>c.categoria));return CATS_ORDEM.filter(c=>s.has(c));},[epg]);
  
  
  // ✅ Lista de bloqueio movida para fora do useMemo de categoria — usada também na busca
  const CANAIS_BLOQUEADOS = useMemo(() => new Set([
    "bandhdb", 
    "globo anhanguera", 
    "record tv goiás", 
    "recordtvalt", 
    "recordtvbelem", 
    "sbttvaratubahia", 
    "idinvestigacaodiscovery", 
    "gbrbsportoalegre", 
    "tntsries", 
    "jovenpannews", 
    "gb", 
    "gbbrasilia", 
    "gbminas", 
    "gbnordeste",
    "gbnscflorianopolis",
    "gbrpccuritiba",
    "gbtvanhanguera",
    "gbtvbahia",
    "gbtvcentroamerica",
    "gbtvgazetaalagoas",
    "gbtvliberalbelem",
    "gbtvredeamazonicaboavista",
    "gbtvredeamazonicamacapa",
    "gbtvredeamazonicariobranco",
    "gbtvsergipe",
    "gbtvverdesmares",
    "intertvcabuginatal",
    "intertvgrandeminas",
    "nscblumenau",
    "nscjoinville",
    "playboy",
    "sextreme",
    "sexyhot",
    "tcaction",
    "tccult",
    "tcfun",
    "tcpipoca",
    "tcpremium",
    "tctouch",
    "tvclubeteresina",
    "tvgazetasules",
    "tvmirantesaoluis",
    "tvmorenacampogrande",
    "tvriosul",
    "tvtemsjriopreto",
    "venus",
    "eptvsuldeminas",
    "eptv ribeirão preto",
    "eptv campinas",
    "usa"
  ]), []);

  function isCanalBloqueado(c: Canal): boolean {
    const nomeNormalizado = (c.nome || "").toLowerCase().trim();
    const displayNormalizado = (c.display_name || "").toLowerCase().trim();
    const idNormalizado = (c.id || "").toLowerCase().trim();
    return CANAIS_BLOQUEADOS.has(nomeNormalizado) ||
           CANAIS_BLOQUEADOS.has(displayNormalizado) ||
           CANAIS_BLOQUEADOS.has(idNormalizado);
  }

  // ✅ epg "limpo" sem os canais ocultados — usado tanto na grade quanto na busca
  const epgVisivel = useMemo(() => ({
    ...epg,
    canais: epg.canais.filter(c => !isCanalBloqueado(c)),
  }), [epg, CANAIS_BLOQUEADOS]);

  const canaisFiltrados = useMemo(() => {
    let lista = epgVisivel.canais;
    if (catAtiva !== "Todos") lista = lista.filter(c => c.categoria === catAtiva);
    if (subAtiva !== "Todos") {
      const sg = (SUBGRUPOS[catAtiva] || []).find(s => s.label === subAtiva);
      if (sg) lista = lista.filter(c => sg.match.some(m => c.display_name.toUpperCase().includes(m)));
    }
    return lista;
  }, [epgVisivel, catAtiva, subAtiva]);

  const emBusca=buscaAtiva.trim().length>0;
  const subgruposDisponiveis=SUBGRUPOS[catAtiva]||[];

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background overflow-hidden">
      <div className="flex-shrink-0 px-4 sm:px-5 py-4 border-b border-border bg-card flex items-center gap-3 flex-wrap z-30 relative shadow-sm">
        
        {/* ✅ Botão de Categoria Principal (Azul) */}
        <div ref={catRef} className="relative">
          <button onClick={()=>setCatOpen(o=>!o)} 
            className="flex items-center gap-2 h-9 px-4 rounded-full font-semibold text-sm transition-all bg-sky-600 hover:bg-sky-500 text-white shadow-sm">
            <Database size={14} className="text-white/80" />
            {catAtiva==="Todos" ? "Categorias" : catAtiva}
            <ChevronDown size={14} className={`opacity-80 transform ${catOpen?"rotate-180":"none"} transition-transform duration-150`}/>
          </button>
          {catOpen&&(<div className="absolute top-[calc(100%+8px)] left-0 min-w-56 max-h-80 overflow-y-auto bg-card border border-border rounded-xl shadow-xl z-50 p-2 animate-in slide-in-from-top-2 duration-150">
            {[{value:"Todos",label:"Todas as categorias"},...catsDisponiveis.map(c=>({value:c,label:c}))].map(opt=>(
              <button key={opt.value} onClick={()=>{setCatAtiva(opt.value);setSubAtiva("Todos");setCatOpen(false);}}
                className={`w-full text-left flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${catAtiva===opt.value ? 'bg-sky-500/10 text-sky-500' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                <span className="truncate">{opt.label}</span>
                {opt.value!=="Todos" && <div className="w-2 h-2 rounded-full" style={{backgroundColor: CAT_COR[opt.value]}}/>}
              </button>
            ))}
          </div>)}
        </div>
        
        {/* Dropdown Subcategoria — mesmo padrão visual do Categoria */}
        {subgruposDisponiveis.length>0&&(
          <div ref={subRef} className="relative">
            <button onClick={()=>setSubOpen(o=>!o)}
              className={`flex items-center gap-2 h-9 px-4 rounded-full font-semibold text-sm border transition-all ${subAtiva!=="Todos" ? 'bg-foreground text-background border-foreground shadow-sm' : 'bg-card text-muted-foreground border-border hover:bg-muted'}`}>
              {subAtiva==="Todos" ? "Subcategoria" : subAtiva}
              <ChevronDown size={12} className={`opacity-60 transform ${subOpen?"rotate-180":"none"} transition-transform duration-150`}/>
            </button>
            {subOpen&&(
              <div className="absolute top-[calc(100%+8px)] left-0 min-w-48 max-h-80 overflow-y-auto bg-card border border-border rounded-xl shadow-xl z-50 p-2 animate-in slide-in-from-top-2 duration-150">
                <button onClick={()=>{setSubAtiva("Todos");setSubOpen(false);}}
                  className={`w-full text-left flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors ${subAtiva==="Todos" ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                  Todas
                </button>
                {subgruposDisponiveis.map(sg=>(
                  <button key={sg.label} onClick={()=>{setSubAtiva(s=>s===sg.label?"Todos":sg.label);setSubOpen(false);}}
                    className={`w-full text-left flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors ${subAtiva===sg.label ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                    {sg.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Botão Limpar tudo — categoria, subcategoria e busca */}
        {(catAtiva!=="Todos"||subAtiva!=="Todos"||busca.trim()!=="")&& (
          <button onClick={()=>{setCatAtiva("Todos");setSubAtiva("Todos");setBusca("");setBuscaAtiva("");}}
            className="flex items-center gap-1.5 h-9 px-4 rounded-full bg-card border border-border text-muted-foreground hover:bg-muted text-sm font-medium transition-all shadow-sm">
            <X size={14} className="text-rose-500"/> Limpar
          </button>
        )}
        
        <div className="relative flex-1 min-w-[200px] ml-auto">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none"/>
          <input value={busca} onChange={e=>{setBusca(e.target.value);if(!e.target.value.trim()){setBuscaAtiva("");return;} setBuscaAtiva(e.target.value.trim());}} onKeyDown={e=>e.key==="Enter"&&setBuscaAtiva(busca.trim())} placeholder="Pesquisar canais por nome..." className="w-full h-9 pl-10 pr-10 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50 transition-colors" />
          {busca&&<button onClick={()=>{setBusca("");setBuscaAtiva("");}} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"><X size={14}/></button>}
        </div>
      </div>
      
      {emBusca ? (
        <div className="flex-1 overflow-y-auto"><ResultadoBuscaEPG epg={epgVisivel} busca={buscaAtiva} progsPorCanal={progsPorCanal} onClear={()=>{setBusca("");setBuscaAtiva("");}}/></div>
      ) : canaisFiltrados.length===0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-12 text-muted-foreground italic text-sm py-28 bg-muted/20"><AlertTriangle size={28} className="text-muted-foreground/50"/>Nenhum canal encontrado para os filtros selecionados. Tente mudar a categoria ou limpar a busca.</div>
      ) : (
        // ✅ NOVA GRADE DE CANAIS EM LISTA (PARECIDA COM O APP) - PERFORMANCE OTIMIZADA
        <GradeListaPerformance canais={canaisFiltrados} progsPorCanal={progsPorCanal}/>
      )}
    </div>
  );
}

// ─── Página principal (Refatorada Claro/Escuro e Toasts) ──────────────────────────
export type GuiaTVTab = "canais" | "filmes" | "series";

// ✅ Novo: Hook que estava faltando para ler Toasts pendentes da sessionStorage
const checkQueuedToasts = (setToasts: React.Dispatch<React.SetStateAction<any[]>>) => {
  try {
    const key = "guia_tv_toasts"; // Chave padrão da sua página de planos
    const raw = window.sessionStorage.getItem(key);
    if (raw) {
      const arr = JSON.parse(raw) as any[];
      if (arr.length > 0) {
        const newToasts = arr.map((t, idx) => ({
          id: Date.now() + idx,
          type: t.type,
          title: t.title,
          message: t.message,
          durationMs: 5000,
        }));
        setToasts((prev) => [...prev, ...newToasts]);
        window.sessionStorage.removeItem(key);
      }
    }
  } catch {}
};

// ─── Modal de Dados de Uso (Acessos ao Guia TV por servidor) ─────────────────
type UsageStatsServidor = { servidor: string; total: number; mes: number; semana: number; hoje: number };

function ModalUsageStats({onClose}:{onClose:()=>void}) {
  const [loading,setLoading]=useState(true);
  const [erro,setErro]=useState<string|null>(null);
  const [dados,setDados]=useState<UsageStatsServidor[]>([]);

  function carregar() {
    setLoading(true);
    setErro(null);
    fetch("/api/client-portal/guia-tv/access-stats", { cache: "no-store" })
      .then(r=>r.json())
      .then(d=>{
        if(d.ok) setDados(d.data);
        else setErro(d.error || "Erro ao carregar estatísticas.");
      })
      .catch(()=>setErro("Erro de conexão ao carregar estatísticas."))
      .finally(()=>setLoading(false));
  }

  useEffect(()=>{
    carregar();
  },[]);

  const COR_FAIXA: Record<string,string> = { ELITE:"#6366f1", NATV:"#10b981", FAST:"#06b6d4", TODOS:"#94a3b8" };
  const LABEL_FAIXA: Record<string,string> = { ELITE:"EliteTV", NATV:"NaTV", FAST:"FastTV", TODOS:"Todos" };

  return (
    <div className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={e=>e.stopPropagation()}
        className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[85vh] flex flex-col animate-in fade-in-0 zoom-in-95 duration-300"
      >
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0 bg-card">
          <div>
            <div className="text-lg font-bold text-foreground flex items-center gap-2.5">
              <Database size={18} className="text-violet-500"/> Dados de Uso
            </div>
            <div className="text-xs text-muted-foreground/90 mt-1.5 leading-relaxed">
              Acessos de clientes ao Guia TV, por servidor.
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={carregar} disabled={loading} className="text-muted-foreground hover:text-violet-500 transition-colors p-1.5 rounded-full hover:bg-violet-500/10 disabled:opacity-50 disabled:cursor-wait">
              <RefreshCw size={18} className={loading ? "animate-spin" : ""}/>
            </button>
            <button onClick={onClose} className="text-muted-foreground hover:text-rose-500 transition-colors p-1 rounded-full hover:bg-rose-500/10">
              <X size={20}/>
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-3 bg-muted/20">
          {loading && (
            <div className="text-center py-16 text-muted-foreground animate-pulse flex flex-col items-center gap-3">
              <RefreshCw size={22} className="animate-spin text-muted-foreground/60"/>
              Carregando estatísticas...
            </div>
          )}
          {!loading && erro && (
            <div className="text-center py-16 text-rose-500 text-sm font-medium">{erro}</div>
          )}
          {!loading && !erro && dados.length===0 && (
            <div className="text-center py-16 text-muted-foreground text-sm italic">
              Nenhum acesso registrado ainda.
            </div>
          )}
          {!loading && !erro && dados.map(d=>{
            const cor = COR_FAIXA[d.servidor] || "#94a3b8";
            const label = LABEL_FAIXA[d.servidor] || d.servidor;
            return (
              <div key={d.servidor} className="p-4 rounded-xl border border-border bg-card">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-2.5 h-2.5 rounded-full" style={{background:cor}}/>
                  <span className="text-sm font-bold text-foreground tracking-tight">{label}</span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    {label:"Total", valor:d.total},
                    {label:"Mês", valor:d.mes},
                    {label:"Semana", valor:d.semana},
                    {label:"Hoje", valor:d.hoje},
                  ].map(item=>(
                    <div key={item.label} className="text-center p-2 rounded-lg bg-muted/40 border border-border/60">
                      <div className="text-base font-bold text-foreground tabular-nums">{item.valor.toLocaleString()}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{item.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-4 border-t border-border shrink-0 bg-muted/40">
          <div className="text-[11px] text-muted-foreground flex items-center justify-center gap-2 leading-relaxed">
            <RefreshCw size={10} className="text-muted-foreground/60"/> Seu próprio acesso como admin não é contabilizado.
          </div>
        </div>
      </div>
    </div>
  );
}


// Configuração original preservada
export default function GuiaTVView({ servidorFiltro, modoCliente }: GuiaTVViewProps) {
  const SERVIDOR_ADMIN = servidorFiltro ?? "TODOS";

  const [tab,setTab]=useState<GuiaTVTab>("filmes");
  const [epg,setEpg]=useState<EpgData|null>(null);
  const [loadingEpg,setLoadingEpg]=useState(true);
  const [erroEpg,setErroEpg]=useState<string|null>(null);
const [syncing,setSyncing]=useState(false);
  const [showCatalogo,setShowCatalogo]=useState(false);
  const [showUsageStats,setShowUsageStats]=useState(false);

  // ✅ Controle do Dropdown Sincronizar na Top Bar
  const [syncOpen, setSyncOpen] = useState(false);
  const syncRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function h(e: MouseEvent) {
      if (syncRef.current && !syncRef.current.contains(e.target as Node)) setSyncOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // ✅ Novos estados para Toasts da Página Principal
  const [toasts, setToasts] = useState<any[]>([]);
  const removeToast = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));
  // Atalho para adicionar toasts rapidamente
  const addToast = (type: "success" | "error" | "warning" | "info", title: string, message: string) => {
    setToasts(prev => [...prev, {id: Date.now(), type, title, message, durationMs: 5000}]);
  }

  // ✅ Novo: Checar fila de toasts ao carregar a página
  useEffect(() => {
    checkQueuedToasts(setToasts);
  }, []);

  // Lógica de tab original preservada
  useEffect(()=>{
    const handler=(e:Event)=>{const t=(e as CustomEvent).detail as GuiaTVTab;setTab(t);};
    window.addEventListener("GUIA_TV_SET_TAB",handler);
    window.dispatchEvent(new CustomEvent("GUIA_TV_READY",{detail:tab}));
    return()=>window.removeEventListener("GUIA_TV_SET_TAB",handler);
  },[]);
  useEffect(()=>{window.dispatchEvent(new CustomEvent("GUIA_TV_TAB_CHANGED",{detail:tab}));},[tab]);

  // Lógica de fetch EPG com interceptação para Renomeios e Recategorizações
  useEffect(()=>{
    setLoadingEpg(true);setErroEpg(null);
    fetch(`${process.env.NEXT_PUBLIC_R2_DEV_URL}/epg/epg_br.json?t=${Date.now()}`,{cache:"no-store"})
      .then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();})
      .then(data => {
        // 1. Dicionário de Renomeios
        const RENOMES: Record<string, string> = {
          "+ Globosat": "Globosat",
          "Tvcultura": "TV Cultura",
          "Discoverychannel": "Discovery Channel",
          "film&arts": "Film & Arts",
          "BandSports": "Band Sports",
          "Tntnovelas": "TNT Novelas",
          "GloboNews": "Globo News",
          "Boavontade": "Boa Vontade",
          "Canalsony": "Canal Sony",
          "Modoviagem": "Modo Viagem",
          "Redesuper": "Rede Super",
          "Tvpaieterno": "TV Pai Eterno"
        };

        // 2. Dicionário de Recategorizações (Mapeado pelo nome já corrigido ou original)
        const RECLASSIFICAR: Record<string, string> = {
          "Rede Super": "Religioso",
          "TV Pai Eterno": "Religioso"
        };

        // 3. Aplica as mutações nos canais antes de salvar no estado
        if (data && Array.isArray(data.canais)) {
          data.canais = data.canais.map((c: any) => {
            let novoNome = RENOMES[c.nome] || c.nome;
            let novoDisplay = RENOMES[c.display_name] || c.display_name;
            let novaCat = RECLASSIFICAR[novoNome] || RECLASSIFICAR[c.nome] || c.categoria;

            return { ...c, nome: novoNome, display_name: novoDisplay, categoria: novaCat };
          });
        }
        
        setEpg(data);
      })
      .catch(()=>setErroEpg("Grade de canais não encontrada localmente. Rode o botão 'Sync EPG Grade' para gerar.")).finally(()=>setLoadingEpg(false));
  },[]);

  // Lógica de progsPorCanal original preservada
  const progsPorCanal=useMemo(()=>{
  if(!epg)return new Map<string,Programa[]>();
  const map=new Map<string,Programa[]>();
  const agoraMs=Date.now();
  const ini=agoraMs-6*3600000,fim=agoraMs+24*3600000;
  for(const p of epg.programas){const s=new Date(p.start).getTime(),e=new Date(p.stop).getTime();if(e<ini||s>fim)continue;const arr=map.get(p.channel_id)||[];arr.push(p);map.set(p.channel_id,arr);}
  return map;
},[epg]);

  // Lógica original de sync preservada, mas com Toasts adicionados
  async function handleSync(){
    setSyncing(true);
    try{
        const d=await fetch("/api/epg/sync",{method:"POST"}).then(r=>r.json());
        if(d.ok){
            addToast("success", "Sincronização Concluída", `A grade EPG foi atualizada com sucesso em ${d.duracao_s}s. Recarregando grade...`);
            setTimeout(()=>window.location.reload(),2000);
        } else {
            addToast("error", "Falha na Sincronização", d.error || "Ocorreu um erro desconhecido ao sincronizar.");
        }
    }
    catch(e:any){
        addToast("error", "Erro na Sincronização", e.message || "Erro de conexão com o servidor.");
    }finally{setSyncing(false);}
  }

  return (
    // ✅ Refatorado: Fundo padrão claro/escuro e layout Tailwind
    <div className="flex flex-col h-[calc(100vh-57px)] bg-background text-foreground overflow-hidden transition-colors">

      {/* Barra de sub-navegação refatorada visivelmente com padrão PlansPage */}
      <div className="flex-shrink-0 bg-muted/40 border-b border-border transition-colors relative z-40">
        <div className="flex items-center px-4 sm:px-5 h-14 gap-2 sm:gap-3">
          <div className={`flex items-center gap-2 sm:gap-3 h-full ${modoCliente ? "w-full justify-around" : "overflow-x-auto custom-scrollbar flex-1"}`}>
  {(["canais","filmes","series"] as GuiaTVTab[]).map(t=>(
    <button key={t} onClick={()=>setTab(t)}
      className={`flex items-center justify-center gap-2 h-9 rounded-full transition-all text-xs sm:text-sm whitespace-nowrap focus:outline-none focus:ring-0 ${modoCliente ? "flex-1" : "px-4 sm:px-5 shrink-0"} ${tab===t ? 'bg-emerald-600 text-white font-bold shadow-md shadow-emerald-900/20' : 'bg-transparent border border-border text-muted-foreground font-medium hover:bg-muted hover:text-foreground'}`}
    >
      {t==="canais"?<><Tv size={14}/> Canais</>:t==="filmes"?<><Film size={14}/> Filmes</>:<><Clapperboard size={14}/> Séries</>}
    </button>
  ))}
</div>
          
          {/* ✅ Botão Sincronizar unificado e sempre visível */}
          {!modoCliente && (
  <div ref={syncRef} className="relative shrink-0 ml-auto">
            <button onClick={() => setSyncOpen(o => !o)}
              className={`flex items-center gap-2 h-9 px-4 rounded-full font-bold text-xs border transition-all ${syncOpen ? 'bg-sky-600 text-white shadow-md shadow-sky-900/20 border-sky-600' : 'bg-transparent border-border text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            >
              <RefreshCw size={13} className={syncing ? "animate-spin text-sky-500" : (syncOpen ? "text-white" : "text-muted-foreground")} />
              <span className="hidden sm:inline">Sincronizar</span>
              <span className="sm:hidden">Sincronizar</span>
              <ChevronDown size={12} className={`opacity-60 transform ${syncOpen ? "rotate-180" : "none"} transition-transform duration-150`} />
            </button>
            {syncOpen && (
              <div className="absolute top-[calc(100%+8px)] right-0 min-w-[240px] bg-card border border-border rounded-xl shadow-2xl z-50 p-2 animate-in slide-in-from-top-2 duration-150">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-3 py-2">Opções de Sincronização</div>
                <button onClick={() => { setShowCatalogo(true); setSyncOpen(false); }}
                  className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                  <div className="w-8 h-8 rounded-full bg-sky-500/10 flex items-center justify-center shrink-0">
                    <Database size={15} className="text-sky-500" />
                  </div>
                  Sincronizar Catálogo
                </button>
                <div className="w-full h-px bg-border my-1"></div>
                <button onClick={() => { handleSync(); setSyncOpen(false); }} disabled={syncing}
                  className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${syncing ? 'opacity-50 cursor-not-allowed bg-muted text-muted-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                  <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
                    <Tv size={15} className={syncing ? "animate-spin text-emerald-500" : "text-emerald-500"} />
                  </div>
                  {syncing ? "Sincronizando EPG..." : "Sincronizar Grade EPG"}
                </button>
                <div className="w-full h-px bg-border my-1"></div>
                <button onClick={() => { setShowUsageStats(true); setSyncOpen(false); }}
                  className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                  <div className="w-8 h-8 rounded-full bg-violet-500/10 flex items-center justify-center shrink-0">
                    <Database size={15} className="text-violet-500" />
                  </div>
                  Dados de Uso
                </button>
              </div>
            )}
          </div>
        )}
        </div>
        
      </div>

      {/* Conteúdo com layout refatorado */}
      {tab==="canais"&&(
        loadingEpg?<div className="flex flex-col items-center justify-center flex-1 gap-4 text-center p-20 text-muted-foreground animate-pulse text-sm py-40 bg-muted/20 transition-colors"><RefreshCw size={24} className="animate-spin text-muted-foreground/60"/>Carregando grade de canais...</div>
        :erroEpg?<div className="flex flex-col items-center justify-center flex-1 gap-4 text-center p-20 text-muted-foreground animate-pulse text-sm py-40 bg-muted/20 transition-colors max-w-2xl mx-auto"><AlertTriangle size={32} className="text-amber-500"/><div className="text-sm font-medium text-foreground tracking-tight">{erroEpg}</div><button onClick={handleSync} disabled={syncing} className="h-9 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 disabled:opacity-50 disabled:cursor-wait"><RefreshCw size={13} className={syncing?"animate-spin":"none"}/> {syncing?"Sincronizando Grade...":"Tentar Sincronizar Grade Agora"}</button></div>
        :epg&&<AbaCanais epg={epg} progsPorCanal={progsPorCanal} />
      )}
      {tab==="filmes"&&<AbaCatalogo tipo="FILME" servidorAdmin={SERVIDOR_ADMIN} modoCliente={modoCliente}/>}
{tab==="series"&&<AbaCatalogo tipo="SERIE" servidorAdmin={SERVIDOR_ADMIN} modoCliente={modoCliente}/>}

{showCatalogo&&<ModalCatalogo onClose={()=>setShowCatalogo(false)}/>}
      {showUsageStats&&<ModalUsageStats onClose={()=>setShowUsageStats(false)}/>}
      
      {/* Estilos originais preservados */}
      <style>{`
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:var(--muted-foreground/30);border-radius:3px}
        ::-webkit-scrollbar-thumb:hover{background:var(--muted-foreground/50)}
        *{-webkit-tap-highlight-color:transparent}
        .no-scrollbar{-ms-overflow-style:none;scrollbar-width:none}
        .no-scrollbar::-webkit-scrollbar{display:none}
      `}</style>
      
      {/* ✅ NOVO: Exibir Toasts na tela seguindo padrão da PlansPage */}
      <div className="fixed inset-x-0 top-3 z-[999999] px-4 sm:px-6 pointer-events-none">
        <div className="pointer-events-auto max-w-sm ml-auto">
          <ToastNotifications toasts={toasts} removeToast={removeToast} />
        </div>
      </div>
    </div>
  );
}