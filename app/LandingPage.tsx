import Link from "next/link";
import React from "react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0b1015] text-slate-800 dark:text-zinc-200 font-sans overflow-x-hidden selection:bg-emerald-500 selection:text-white">
      
      {/* =====================
          HEADER (Navegação)
      ===================== */}
      <header className="fixed top-0 w-full z-50 bg-white/80 dark:bg-[#0b1015]/80 backdrop-blur-md border-b border-slate-200 dark:border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/brand/logo-full-light.png" alt="UniGestor" className="h-8" />
          </div>
          
          <nav className="hidden md:flex items-center gap-8">
            <a href="#solucoes" className="text-sm font-semibold text-slate-600 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition">Soluções</a>
            <a href="#financeiro" className="text-sm font-semibold text-slate-600 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition">Financeiro Integrado</a>
            <a href="#lgpd" className="text-sm font-semibold text-slate-600 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition">Segurança & LGPD</a>
            <a href="#contato" className="text-sm font-semibold text-slate-600 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition">Contato</a>
          </nav>

          <Link
            href="/login"
            className="h-10 px-5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20 transition-transform hover:scale-105 active:scale-95"
          >
            Entrar no Sistema
          </Link>
        </div>
      </header>

      {/* =====================
          HERO SECTION (Topo)
      ===================== */}
      <main className="relative pt-32 pb-20 sm:pt-40 sm:pb-32 px-4 flex flex-col items-center justify-center text-center">
        {/* Glows de Fundo */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-emerald-500/20 rounded-full blur-[120px] pointer-events-none -z-10" />
        
        <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tighter text-slate-900 dark:text-white max-w-4xl">
          Tudo o que seu negócio precisa, em <span className="text-emerald-600 dark:text-emerald-500">um só lugar.</span>
        </h1>
        
        <p className="mt-6 text-lg sm:text-xl text-slate-600 dark:text-zinc-400 max-w-2xl leading-relaxed">
          O UniGestor é a plataforma definitiva de gestão White Label. Controle financeiro automatizado, recorrências, clientes e acessos — feito para quem quer escalar sem dores de cabeça.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row gap-4">
          <Link
            href="/login"
            className="h-14 px-8 bg-emerald-600 hover:bg-emerald-500 text-white text-base font-bold rounded-xl flex items-center justify-center shadow-xl shadow-emerald-500/20 transition-transform hover:-translate-y-1"
          >
            Acessar meu Painel
          </Link>
          <a
            href="#solucoes"
            className="h-14 px-8 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-800 dark:text-white text-base font-bold rounded-xl flex items-center justify-center hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
          >
            Conhecer Soluções
          </a>
        </div>
      </main>

      {/* =====================
          DESTAQUE: FINANCEIRO
      ===================== */}
      <section id="financeiro" className="py-24 bg-white dark:bg-[#10161d] border-y border-slate-100 dark:border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col lg:flex-row items-center gap-16">
            
            <div className="flex-1 space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold uppercase tracking-wider">
                Módulo Ativo
              </div>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                Controle Financeiro de Alto Nível
              </h2>
              <p className="text-lg text-slate-600 dark:text-zinc-400 leading-relaxed">
                Pare de perder dinheiro com cobranças esquecidas. O módulo financeiro do UniGestor automatiza conciliações, projeta recebimentos futuros e envia lembretes inteligentes via WhatsApp.
              </p>
              
              <ul className="space-y-3 pt-4">
                {[
                  "Faturamento e previsão de recebíveis automatizados.",
                  "Cobranças e notificações via WhatsApp sem esforço.",
                  "Separação clara entre despesas e receitas por categorias.",
                  "Relatórios e Dashboards executivos em tempo real."
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="flex shrink-0 w-6 h-6 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-sm font-bold">✓</span>
                    <span className="text-slate-700 dark:text-zinc-300 font-medium">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex-1 w-full relative">
               {/* Imagem representativa do Dashboard Financeiro (Você pode trocar por um print real do seu sistema depois) */}
              <div className="aspect-video w-full rounded-2xl bg-slate-100 dark:bg-black/50 border border-slate-200 dark:border-white/10 shadow-2xl overflow-hidden flex items-center justify-center p-6">
                 <div className="w-full space-y-4 opacity-50">
                    <div className="h-4 w-1/3 bg-slate-300 dark:bg-white/20 rounded"></div>
                    <div className="grid grid-cols-2 gap-4">
                       <div className="h-24 bg-emerald-500/20 rounded-xl border border-emerald-500/30"></div>
                       <div className="h-24 bg-rose-500/20 rounded-xl border border-rose-500/30"></div>
                    </div>
                    <div className="h-40 bg-slate-300 dark:bg-white/10 rounded-xl"></div>
                 </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* =====================
          MODULARES (Grid)
      ===================== */}
      <section id="solucoes" className="py-24 max-w-7xl mx-auto px-4 sm:px-6">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight mb-4">
            Uma plataforma. Várias soluções.
          </h2>
          <p className="text-lg text-slate-600 dark:text-zinc-400">
            Adapte o sistema para a realidade da sua empresa. Ative e desative módulos conforme a sua necessidade.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          
          {/* Card SaaS */}
          <div className="p-8 rounded-2xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-amber-500/50 transition-colors group">
            <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center text-2xl mb-6 group-hover:scale-110 transition-transform">
              ⚡
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">Rede de Revendas (SaaS)</h3>
            <p className="text-slate-600 dark:text-zinc-400 text-sm leading-relaxed">
              Crie sub-contas, distribua créditos e monte sua própria rede hierárquica. Controle total sobre lojistas parceiros.
            </p>
          </div>

          {/* Card Academia */}
          <div className="p-8 rounded-2xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-sky-500/50 transition-colors group relative overflow-hidden">
            <div className="absolute top-4 right-4 bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-400 text-[10px] px-2 py-1 rounded font-bold uppercase tracking-wide">
              Novo
            </div>
            <div className="w-12 h-12 rounded-xl bg-sky-100 dark:bg-sky-500/20 flex items-center justify-center text-2xl mb-6 group-hover:scale-110 transition-transform">
              🏋️
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">Módulo Academia</h3>
            <p className="text-slate-600 dark:text-zinc-400 text-sm leading-relaxed">
              Catraca virtual, reconhecimento facial, gestão de planos e acesso de alunos. Modernize a recepção do seu espaço.
            </p>
          </div>

          {/* Card Condominio */}
          <div className="p-8 rounded-2xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-purple-500/50 transition-colors group relative overflow-hidden">
             <div className="absolute top-4 right-4 bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400 text-[10px] px-2 py-1 rounded font-bold uppercase tracking-wide opacity-80">
              Em Breve
            </div>
            <div className="w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center text-2xl mb-6 group-hover:scale-110 transition-transform grayscale">
              🏢
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">Condomínios</h3>
            <p className="text-slate-600 dark:text-zinc-400 text-sm leading-relaxed opacity-80">
              Gestão de moradores, controle de encomendas na portaria e reservas de espaços comuns.
            </p>
          </div>

        </div>
      </section>

      {/* =====================
          LGPD E SEGURANÇA
      ===================== */}
      <section id="lgpd" className="py-24 bg-slate-900 dark:bg-[#080b0e] text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center text-3xl mx-auto mb-6">
            🔒
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-6">
            Sua Empresa Segura (LGPD)
          </h2>
          <p className="text-lg text-slate-400 leading-relaxed mb-8">
            Nossa infraestrutura é construída com os mais altos padrões de criptografia e isolamento de dados. Asseguramos que os dados sensíveis dos seus clientes permaneçam totalmente confidenciais, em conformidade estrita com a Lei Geral de Proteção de Dados (LGPD).
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm font-bold text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Isolamento Multi-Tenant Ativo
          </div>
        </div>
      </section>

      {/* =====================
          CONTATO / FALE CONOSCO
      ===================== */}
      <section id="contato" className="py-24 bg-white dark:bg-[#10161d] border-t border-slate-100 dark:border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight mb-4">
              Fale Conosco
            </h2>
            <p className="text-lg text-slate-600 dark:text-zinc-400">
              Ficou com alguma dúvida? Entre em contato agora mesmo e descubra como podemos ajudar a transformar a gestão do seu negócio.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            
            {/* Coluna Esquerda: WhatsApp e Info */}
            <div className="space-y-8">
              <div className="bg-slate-50 dark:bg-white/5 p-8 rounded-2xl border border-slate-200 dark:border-white/10">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Atendimento Rápido</h3>
                <p className="text-slate-600 dark:text-zinc-400 mb-6 leading-relaxed">
                  A forma mais rápida de falar com nossos especialistas é através do nosso WhatsApp. Clique no botão abaixo para iniciar a conversa.
                </p>
                <a
                  href="https://wa.me/5521992347771?text=Ol%C3%A1!%20Vim%20pelo%20site%20e%20gostaria%20de%20saber%20mais%20informa%C3%A7%C3%B5es%20sobre%20o%20UniGestor."
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-3 h-14 px-8 bg-[#25D366] hover:bg-[#20bd5a] text-white text-base font-bold rounded-xl shadow-xl shadow-[#25D366]/20 transition-transform hover:-translate-y-1 w-full sm:w-auto"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.373 0 0 4.98 0 11.111c0 3.508 1.777 6.64 4.622 8.67L3.333 24l4.444-2.222c1.333.37 2.592.556 4.223.556 6.627 0 12-4.98 12-11.111S18.627 0 12 0zm0 20c-1.37 0-2.703-.247-3.963-.733l-.283-.111-2.592 1.296.852-2.37-.37-.259C3.852 16.37 2.667 13.852 2.667 11.11 2.667 6.148 6.963 2.222 12 2.222c5.037 0 9.333 3.926 9.333 8.889S17.037 20 12 20zm5.037-6.63c-.278-.139-1.63-.815-1.889-.907-.259-.093-.445-.139-.63.139-.185.278-.722.907-.889 1.093-.167.185-.333.208-.611.069-.278-.139-1.167-.43-2.222-1.37-.822-.733-1.37-1.63-1.528-1.907-.157-.278-.017-.43.122-.569.126-.126.278-.333.417-.5.139-.167.185-.278.278-.463.093-.185.046-.347-.023-.486-.069-.139-.63-1.519-.863-2.083-.227-.546-.458-.472-.63-.48l-.54-.01c-.185 0-.486.069-.74.347-.254.278-.972.95-.972 2.315 0 1.365.996 2.685 1.135 2.87.139.185 1.96 2.997 4.87 4.207.681.294 1.213.47 1.628.602.684.217 1.306.187 1.797.113.548-.082 1.63-.667 1.86-1.31.23-.643.23-1.193.162-1.31-.069-.116-.254-.185-.532-.324z"/>
                  </svg>
                  Chamar no WhatsApp
                </a>
              </div>
              
              <div className="flex items-center gap-4 text-slate-600 dark:text-zinc-400">
                <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center shrink-0 text-xl">
                  ✉️
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">E-mail Comercial</p>
                  <p className="text-sm">marcio.martins@gmx.com</p>
                </div>
              </div>
            </div>

            {/* Coluna Direita: Formulário Email */}
            <div className="bg-white dark:bg-[#161b22] p-8 rounded-2xl border border-slate-200 dark:border-white/10 shadow-lg">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6">Envie uma Mensagem</h3>
              {/* Usando mailto nativo para abrir o cliente de email do visitante */}
              <form action="mailto:marcio.martins@gmx.com" method="post" encType="text/plain" className="space-y-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1.5 uppercase tracking-wider">Seu Nome</label>
                  <input type="text" name="Nome" required className="w-full h-11 px-4 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500 transition-colors" placeholder="Como podemos te chamar?" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1.5 uppercase tracking-wider">E-mail para Retorno</label>
                  <input type="email" name="Email" required className="w-full h-11 px-4 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500 transition-colors" placeholder="seu@email.com" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1.5 uppercase tracking-wider">Mensagem</label>
                  <textarea name="Mensagem" required rows={4} className="w-full p-4 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500 transition-colors resize-none" placeholder="Escreva sua dúvida aqui..."></textarea>
                </div>
                <button type="submit" className="w-full h-12 bg-slate-800 hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 text-white text-sm font-bold rounded-xl transition-colors">
                  Enviar Mensagem
                </button>
              </form>
            </div>

          </div>
        </div>
      </section>

      {/* =====================
          FOOTER
      ===================== */}
      <footer className="border-t border-slate-200 dark:border-white/5 bg-white dark:bg-[#0b1015] py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 opacity-50 grayscale">
            <img src="/brand/logo-full-light.png" alt="UniGestor" className="h-6" />
          </div>
          <p className="text-xs text-slate-500 dark:text-zinc-500">
            &copy; {new Date().getFullYear()} UniGestor. Todos os direitos reservados.
          </p>
        </div>
      </footer>

    </div>
  );
}