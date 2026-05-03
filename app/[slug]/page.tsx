"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function TenantLoginPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [tenantData, setTenantData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Estado para controlar o foco do input e mudar a cor da borda dinamicamente
  const [focusedInput, setFocusedInput] = useState<string | null>(null);

    useEffect(() => {
    async function loadTenantBrand() {
      if (!slug) return;
      
      // ✅ CORREÇÃO: Usamos os nomes reais das colunas da sua tabela tenants
      const { data, error } = await supabaseBrowser
        .from("tenants")
        .select("id, name, logo_url, primary_color, banner_urls")
        .eq("slug", slug)
        .maybeSingle(); // maybeSingle evita jogar um erro vermelho no console se não achar

      if (data) {
        setTenantData(data);
      } else {
        console.error("Erro ou Tenant não encontrado:", error);
      }
      setLoading(false);
    }
    loadTenantBrand();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#0b1015] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!tenantData) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#0b1015] flex items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">Página não encontrada</h2>
          <p className="text-slate-500 dark:text-zinc-400 text-sm">Verifique o endereço de acesso e tente novamente.</p>
        </div>
      </div>
    );
  }

  // ✅ CORREÇÃO: Usa a coluna primary_color
  const brandColor = tenantData.primary_color || "#10b981";
  
  // ✅ CORREÇÃO: Pega o primeiro banner da lista (se existir)
  const backgroundMedia = tenantData.banner_urls && tenantData.banner_urls.length > 0 ? tenantData.banner_urls[0] : null;
  
  // ✅ CORREÇÃO: Descobre se é vídeo lendo a extensão do arquivo
  const isVideo = backgroundMedia ? (backgroundMedia.includes('.mp4') || backgroundMedia.includes('.webm')) : false;

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#0b1015] selection:bg-emerald-500 selection:text-white">
      
      {/* ==========================================
          LADO ESQUERDO: Mídia Customizada do Cliente
          Fica escondido no mobile, aparece a partir do tamanho 'lg'
      ========================================== */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-slate-900 overflow-hidden items-center justify-center">
        
        {/* Renderiza Vídeo ou Imagem baseada no banco de dados */}
        {isVideo && backgroundMedia ? (
          <video 
            autoPlay 
            loop 
            muted 
            playsInline
            className="absolute inset-0 w-full h-full object-cover opacity-60"
            src={backgroundMedia}
          />
        ) : backgroundMedia ? (
          <img 
            src={backgroundMedia} 
            alt={`Ambiente da ${tenantData.name}`}
            className="absolute inset-0 w-full h-full object-cover opacity-60"
          />
        ) : (
          // Placeholder caso o cliente ainda não tenha feito upload de nada
          <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center">
            <span className="text-slate-700 text-6xl">🏋️</span>
          </div>
        )}

        {/* Overlay escuro/gradiente para garantir a leitura caso coloque algum texto por cima */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent to-slate-900/50 dark:to-[#0b1015]" />
        
        {/* Opção extra: Um texto motivacional ou slogan do cliente pode vir aqui */}
        <div className="relative z-10 p-12 max-w-lg text-white">
          <h2 className="text-4xl font-black mb-4">Supere seus limites.</h2>
          <p className="text-lg text-white/80">Acesse sua área exclusiva para acompanhar treinos, evolução física e pagamentos.</p>
        </div>
      </div>

      {/* ==========================================
          LADO DIREITO: O Formulário Padrão (Layout Único)
      ========================================== */}
      <div className="w-full lg:w-1/2 flex flex-col items-center justify-center p-8 sm:p-12 relative z-10">
        
        <div className="w-full max-w-md">
          {/* Cabeçalho do Form */}
          <div className="flex flex-col items-center mb-10 text-center">
            {tenantData.logo_url ? (
              <img src={tenantData.logo_url} alt={tenantData.name} className="h-20 object-contain mb-6" />
            ) : (
              <div 
                className="w-20 h-20 rounded-2xl flex items-center justify-center text-3xl font-bold text-white mb-6 shadow-lg"
                style={{ backgroundColor: brandColor }}
              >
                {tenantData.name.charAt(0).toUpperCase()}
              </div>
            )}
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
              {tenantData.name}
            </h1>
            <p className="text-sm font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-widest">
              Portal do Aluno
            </p>
          </div>

          {/* Formulário */}
          <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
            
            {/* Input CPF/Email */}
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-zinc-400 mb-2 uppercase tracking-wider">
                CPF ou E-mail
              </label>
              <input 
                type="text" 
                onFocus={() => setFocusedInput('login')}
                onBlur={() => setFocusedInput(null)}
                className="w-full h-14 px-4 bg-white dark:bg-black/20 border-2 rounded-xl text-slate-800 dark:text-white outline-none transition-colors"
                style={{ 
                  borderColor: focusedInput === 'login' ? brandColor : 'var(--tw-border-opacity, #e2e8f0)', // Usa a cor do cliente ao focar
                  backgroundColor: focusedInput === 'login' ? 'transparent' : ''
                }}
                placeholder="Digite seu acesso" 
              />
            </div>

            {/* Input Senha */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">
                  Senha
                </label>
                <a href="#" className="text-xs font-bold hover:underline transition-colors" style={{ color: brandColor }}>
                  Recuperar senha
                </a>
              </div>
              <input 
                type="password" 
                onFocus={() => setFocusedInput('password')}
                onBlur={() => setFocusedInput(null)}
                className="w-full h-14 px-4 bg-white dark:bg-black/20 border-2 rounded-xl text-slate-800 dark:text-white outline-none transition-colors"
                style={{ 
                  borderColor: focusedInput === 'password' ? brandColor : 'var(--tw-border-opacity, #e2e8f0)', // Usa a cor do cliente ao focar
                  backgroundColor: focusedInput === 'password' ? 'transparent' : ''
                }}
                placeholder="••••••••" 
              />
            </div>

            {/* Botão Dinâmico */}
            <button 
              type="submit"
              className="w-full h-14 mt-4 text-white text-base font-bold rounded-xl shadow-lg transition-transform hover:-translate-y-0.5 active:translate-y-0"
              style={{ 
                backgroundColor: brandColor,
                boxShadow: `0 10px 25px -5px ${brandColor}60`
              }}
            >
              Entrar no Sistema
            </button>
          </form>

        </div>
        
        {/* Assinatura UniGestor no rodapé do form */}
        <p className="absolute bottom-8 text-xs font-bold text-slate-400 dark:text-zinc-600 uppercase tracking-widest flex items-center gap-2">
          Tecnologia por 
          <img src="/brand/logo-full-light.png" alt="UniGestor" className="h-4 opacity-50 grayscale" />
        </p>

      </div>
    </div>
  );
}