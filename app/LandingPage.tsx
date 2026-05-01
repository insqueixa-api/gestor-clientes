import Link from "next/link";
import React from "react";

// ==========================================
// COMPONENTES DA PÁGINA
// ==========================================

const Header = () => (
  <header className="fixed top-0 w-full z-50 bg-white/80 dark:bg-[#0b1015]/80 backdrop-blur-md border-b border-slate-200 dark:border-white/5">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <img src="/brand/logo-full-light.png" alt="UniGestor" className="h-7" />
      </div>
      <nav className="hidden md:flex items-center gap-8">
        <a href="#beneficios" className="text-sm font-semibold text-slate-600 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition">Como Funciona</a>
        <a href="#modulos" className="text-sm font-semibold text-slate-600 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition">Módulos</a>
      </nav>
      <Link
        href="/login"
        className="h-9 px-5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-lg flex items-center justify-center shadow-lg shadow-emerald-500/20 transition-transform hover:scale-105 active:scale-95"
      >
        Acessar Sistema
      </Link>
    </div>
  </header>
);

const Hero = () => (
  <section className="relative pt-32 pb-16 sm:pt-40 sm:pb-24 px-4 overflow-hidden">
    <div className="absolute top-1/2 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none -z-10" />
    
    <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
      {/* Esquerda: Copywriter de Conversão */}
      <div className="max-w-2xl">
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tighter text-slate-900 dark:text-white leading-tight">
          Seu dinheiro entra. <br className="hidden sm:block" />
          <span className="text-emerald-600 dark:text-emerald-500">Mas para onde ele vai?</span>
        </h1>
        <p className="mt-6 text-lg text-slate-600 dark:text-zinc-400 leading-relaxed">
          Organize salário, contas da casa, empréstimos, cartão, compras e renda extra em um único painel. Entenda seu presente e planeje seu futuro.
        </p>
        
        <ul className="mt-8 space-y-3">
          {['Salários e receitas', 'Contas recorrentes', 'Cartões e empréstimos', 'Metas e investimentos'].map((item, i) => (
            <li key={i} className="flex items-center gap-3 text-sm font-semibold text-slate-700 dark:text-zinc-300">
              <span className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs">✓</span>
              {item}
            </li>
          ))}
        </ul>

        <div className="mt-10">
          <Link
            href="/login"
            className="inline-flex h-14 px-8 bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white text-base font-bold rounded-xl items-center justify-center shadow-xl shadow-slate-900/20 dark:shadow-emerald-500/20 transition-transform hover:-translate-y-1"
          >
            Começar agora
          </Link>
        </div>
      </div>

      {/* Direita: Mockup Estático e Premium */}
      <div className="relative">
        <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white/50 dark:bg-[#161b22]/50 backdrop-blur-xl shadow-2xl overflow-hidden flex flex-col h-[400px]">
          {/* Header Fake */}
          <div className="h-10 bg-slate-100 dark:bg-[#0f141a] border-b border-slate-200 dark:border-white/5 flex items-center px-4 gap-2 shrink-0">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-rose-400"></div>
              <div className="w-3 h-3 rounded-full bg-amber-400"></div>
              <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
            </div>
            <div className="mx-auto text-[10px] font-bold text-slate-400 tracking-widest uppercase">Visão Geral</div>
          </div>
          {/* Corpo do Mockup Simplificado */}
          <div className="p-6 flex-1 flex flex-col gap-4">
             <div className="grid grid-cols-2 gap-4">
                <div className="bg-emerald-50 dark:bg-emerald-500/10 p-4 rounded-xl border border-emerald-100 dark:border-emerald-500/20">
                  <p className="text-[10px] uppercase font-bold text-emerald-600 mb-1">Entradas</p>
                  <p className="text-xl font-black text-emerald-700 dark:text-emerald-400">R$ 5.250,00</p>
                </div>
                <div className="bg-rose-50 dark:bg-rose-500/10 p-4 rounded-xl border border-rose-100 dark:border-rose-500/20">
                  <p className="text-[10px] uppercase font-bold text-rose-600 mb-1">Saídas</p>
                  <p className="text-xl font-black text-rose-700 dark:text-rose-400">R$ 3.390,00</p>
                </div>
             </div>
             {/* Barras de progresso simuladas */}
             <div className="space-y-3 mt-4">
               <div>
                 <div className="flex justify-between text-xs mb-1"><span className="text-slate-500">Mercado</span><span className="font-bold text-slate-700 dark:text-zinc-200">R$ 1.120</span></div>
                 <div className="h-2 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-rose-400 w-[60%]"></div></div>
               </div>
               <div>
                 <div className="flex justify-between text-xs mb-1"><span className="text-slate-500">Cartão de Crédito</span><span className="font-bold text-slate-700 dark:text-zinc-200">R$ 1.240</span></div>
                 <div className="h-2 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-rose-400 w-[75%]"></div></div>
               </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  </section>
);

const PainPoints = () => (
  <section className="py-24 bg-slate-100 dark:bg-white/[0.02] border-y border-slate-200 dark:border-white/5">
    <div className="max-w-4xl mx-auto px-4 text-center">
      <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white leading-tight mb-6">
        Você recebe. Paga conta. Usa cartão.<br/> Faz mercado. Paga internet.
      </h2>
      <p className="text-xl text-emerald-600 dark:text-emerald-400 font-medium mb-12">
        No fim do mês sobra a dúvida: <span className="font-black italic">"Pra onde foi meu dinheiro?"</span>
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: '😰', text: 'Final do mês apertado' },
          { icon: '💳', text: 'Cartão acumulando' },
          { icon: '📅', text: 'Contas vencendo' },
          { icon: '💨', text: 'Dinheiro sumindo' }
        ].map((item, i) => (
          <div key={i} className="bg-white dark:bg-[#161b22] p-6 rounded-2xl border border-slate-200 dark:border-white/10 shadow-sm">
            <div className="text-3xl mb-3">{item.icon}</div>
            <p className="text-sm font-bold text-slate-700 dark:text-zinc-300">{item.text}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const FinancialDashboard = () => (
  <section className="py-24 max-w-6xl mx-auto px-4">
    <div className="text-center mb-12">
      <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white mb-4">A realidade financeira mapeada</h2>
      <p className="text-slate-600 dark:text-zinc-400">Dados claros, organizados e fáceis de entender.</p>
    </div>

    {/* Dashboard Premium Realista */}
    <div className="bg-white dark:bg-[#161b22] rounded-2xl border border-slate-200 dark:border-white/10 shadow-2xl overflow-hidden max-w-4xl mx-auto">
      <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100 dark:divide-white/5">
        
        {/* Receitas */}
        <div className="p-6 sm:p-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide text-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Receitas
            </h3>
            <span className="text-sm font-bold text-slate-900 dark:text-white">R$ 5.250,00</span>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center text-sm"><span className="text-slate-600 dark:text-zinc-400">Salário</span><span className="font-bold text-slate-800 dark:text-zinc-200">R$ 3.200</span></div>
            <div className="flex justify-between items-center text-sm"><span className="text-slate-600 dark:text-zinc-400">Adiantamento</span><span className="font-bold text-slate-800 dark:text-zinc-200">R$ 700</span></div>
            <div className="flex justify-between items-center text-sm"><span className="text-slate-600 dark:text-zinc-400">Venda Produto</span><span className="font-bold text-slate-800 dark:text-zinc-200">R$ 450</span></div>
            <div className="flex justify-between items-center text-sm"><span className="text-slate-600 dark:text-zinc-400">Serviços Extras</span><span className="font-bold text-slate-800 dark:text-zinc-200">R$ 900</span></div>
          </div>
        </div>

        {/* Despesas */}
        <div className="p-6 sm:p-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wide text-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-500"></span> Despesas
            </h3>
            <span className="text-sm font-bold text-slate-900 dark:text-white">R$ 3.390,00</span>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center text-sm"><span className="text-slate-600 dark:text-zinc-400">Supermercado</span><span className="font-bold text-slate-800 dark:text-zinc-200">R$ 1.120</span></div>
            <div className="flex justify-between items-center text-sm"><span className="text-slate-600 dark:text-zinc-400">Cartão de Crédito</span><span className="font-bold text-slate-800 dark:text-zinc-200">R$ 1.240</span></div>
            <div className="flex justify-between items-center text-sm"><span className="text-slate-600 dark:text-zinc-400">Empréstimo (2/12)</span><span className="font-bold text-slate-800 dark:text-zinc-200">R$ 620</span></div>
            <div className="flex justify-between items-center text-sm"><span className="text-slate-600 dark:text-zinc-400">Energia Elétrica</span><span className="font-bold text-slate-800 dark:text-zinc-200">R$ 187</span></div>
            <div className="flex justify-between items-center text-sm"><span className="text-slate-600 dark:text-zinc-400">Internet</span><span className="font-bold text-slate-800 dark:text-zinc-200">R$ 129</span></div>
            <div className="flex justify-between items-center text-sm"><span className="text-slate-600 dark:text-zinc-400">Água</span><span className="font-bold text-slate-800 dark:text-zinc-200">R$ 84</span></div>
          </div>
        </div>
        
      </div>
    </div>
  </section>
);

const Benefits = () => (
  <section id="beneficios" className="py-24 bg-slate-50 dark:bg-[#0b1015]">
    <div className="max-w-7xl mx-auto px-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {[
        { title: 'Controle Mensal', desc: 'Saiba exatamente qual será seu saldo até o último dia do mês.' },
        { title: 'Contas Recorrentes', desc: 'Cadastre uma vez. O sistema projeta os meses seguintes sozinho.' },
        { title: 'Categorias Inteligentes', desc: 'Identifique os ralos financeiros que estão consumindo sua renda.' },
        { title: 'Planejamento Futuro', desc: 'Tome decisões hoje baseadas em como seu caixa estará amanhã.' }
      ].map((b, i) => (
        <div key={i} className="p-6 border border-slate-200 dark:border-white/10 rounded-2xl bg-white dark:bg-[#161b22]">
          <h3 className="font-bold text-slate-900 dark:text-white mb-2">{b.title}</h3>
          <p className="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed">{b.desc}</p>
        </div>
      ))}
    </div>
  </section>
);

const Modules = () => (
  <section id="modulos" className="py-24 max-w-7xl mx-auto px-4 border-t border-slate-200 dark:border-white/5">
    <div className="text-center mb-16">
      <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white mb-4">Expanda quando precisar</h2>
      <p className="text-slate-600 dark:text-zinc-400">Ferramentas extras nativas para quem precisa gerenciar mais do que a própria casa.</p>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      
      {/* Academia */}
      <div className="p-8 border border-slate-200 dark:border-white/10 rounded-2xl bg-white dark:bg-white/5 relative">
        <span className="absolute top-4 right-4 text-[10px] font-bold uppercase px-2 py-1 bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-400 rounded">Em Desenvolvimento</span>
        <div className="text-3xl mb-4">🏋️</div>
        <h3 className="font-bold text-xl text-slate-900 dark:text-white mb-4">Academia</h3>
        <ul className="space-y-2 text-sm text-slate-600 dark:text-zinc-400">
          <li>• Gestão de Alunos</li>
          <li>• Controle de Mensalidades</li>
          <li>• Check-in e Catraca</li>
          <li>• Planos Personalizados</li>
        </ul>
      </div>

      {/* Personal */}
      <div className="p-8 border border-slate-200 dark:border-white/10 rounded-2xl bg-white dark:bg-white/5 relative">
        <span className="absolute top-4 right-4 text-[10px] font-bold uppercase px-2 py-1 bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-400 rounded">Em Desenvolvimento</span>
        <div className="text-3xl mb-4">⏱️</div>
        <h3 className="font-bold text-xl text-slate-900 dark:text-white mb-4">Personal Trainer</h3>
        <ul className="space-y-2 text-sm text-slate-600 dark:text-zinc-400">
          <li>• Ficha de Clientes</li>
          <li>• Evolução de Treinos</li>
          <li>• Pagamentos e Pacotes</li>
          <li>• Agenda Automática</li>
        </ul>
      </div>

      {/* Condominio */}
      <div className="p-8 border border-slate-200 dark:border-white/10 rounded-2xl bg-white dark:bg-white/5 relative opacity-70 grayscale hover:grayscale-0 transition-all">
        <span className="absolute top-4 right-4 text-[10px] font-bold uppercase px-2 py-1 bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-400 rounded">Em Breve</span>
        <div className="text-3xl mb-4">🏢</div>
        <h3 className="font-bold text-xl text-slate-900 dark:text-white mb-4">Condomínio</h3>
        <ul className="space-y-2 text-sm text-slate-600 dark:text-zinc-400">
          <li>• Cadastro de Moradores</li>
          <li>• Reservas de Áreas</li>
          <li>• Cobranças (Boleto/Pix)</li>
          <li>• Financeiro e Transparência</li>
        </ul>
      </div>

    </div>
  </section>
);

const Security = () => (
  <section className="py-12 bg-emerald-900 text-emerald-50 text-center px-4">
    <p className="text-sm font-medium flex items-center justify-center gap-2">
      <span className="text-xl">🔒</span> Seus dados bancários e pessoais são blindados e seguem rigorosamente a LGPD.
    </p>
  </section>
);

const FinalCTA = () => (
  <section className="py-32 px-4 text-center">
    <h2 className="text-4xl sm:text-5xl font-extrabold text-slate-900 dark:text-white mb-6 tracking-tight">
      Pare de adivinhar. <br className="hidden sm:block" />
      <span className="text-emerald-600">Comece a controlar.</span>
    </h2>
    
    <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center items-center">
      <Link
        href="/login"
        className="h-14 px-10 bg-emerald-600 hover:bg-emerald-500 text-white text-lg font-bold rounded-xl flex items-center justify-center shadow-xl shadow-emerald-500/20 transition-transform hover:scale-105"
      >
        Entrar no UniGestor
      </Link>
      <a
        href="https://wa.me/5521992347771"
        target="_blank"
        rel="noopener noreferrer"
        className="h-14 px-8 bg-transparent border border-slate-300 dark:border-white/20 text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-white/5 text-base font-bold rounded-xl flex items-center justify-center transition-colors gap-2"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.373 0 0 4.98 0 11.111c0 3.508 1.777 6.64 4.622 8.67L3.333 24l4.444-2.222c1.333.37 2.592.556 4.223.556 6.627 0 12-4.98 12-11.111S18.627 0 12 0zm0 20c-1.37 0-2.703-.247-3.963-.733l-.283-.111-2.592 1.296.852-2.37-.37-.259C3.852 16.37 2.667 13.852 2.667 11.11 2.667 6.148 6.963 2.222 12 2.222c5.037 0 9.333 3.926 9.333 8.889S17.037 20 12 20zm5.037-6.63c-.278-.139-1.63-.815-1.889-.907-.259-.093-.445-.139-.63.139-.185.278-.722.907-.889 1.093-.167.185-.333.208-.611.069-.278-.139-1.167-.43-2.222-1.37-.822-.733-1.37-1.63-1.528-1.907-.157-.278-.017-.43.122-.569.126-.126.278-.333.417-.5.139-.167.185-.278.278-.463.093-.185.046-.347-.023-.486-.069-.139-.63-1.519-.863-2.083-.227-.546-.458-.472-.63-.48l-.54-.01c-.185 0-.486.069-.74.347-.254.278-.972.95-.972 2.315 0 1.365.996 2.685 1.135 2.87.139.185 1.96 2.997 4.87 4.207.681.294 1.213.47 1.628.602.684.217 1.306.187 1.797.113.548-.082 1.63-.667 1.86-1.31.23-.643.23-1.193.162-1.31-.069-.116-.254-.185-.532-.324z"/>
        </svg>
        Dúvidas? WhatsApp
      </a>
    </div>
  </section>
);

const Footer = () => (
  <footer className="border-t border-slate-200 dark:border-white/5 py-8 text-center bg-slate-50 dark:bg-[#0b1015]">
    <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">
      &copy; {new Date().getFullYear()} UniGestor. Todos os direitos reservados.
    </p>
  </footer>
);

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#0b1015] text-slate-800 dark:text-zinc-200 font-sans overflow-x-hidden selection:bg-emerald-500 selection:text-white">
      <Header />
      <main>
        <Hero />
        <PainPoints />
        <FinancialDashboard />
        <Benefits />
        <Modules />
        <Security />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}