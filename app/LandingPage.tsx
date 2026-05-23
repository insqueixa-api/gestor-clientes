import Link from "next/link";
import React from "react";

// ─────────────────────────────────────────────
// ÍCONES INLINE (sem dependência externa)
// ─────────────────────────────────────────────
const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IconWhatsApp = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
  </svg>
);
const IconArrow = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);
const IconShield = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

// ─────────────────────────────────────────────
// DADOS BRASILEIROS REALISTAS
// ─────────────────────────────────────────────
const RECEITAS = [
  { desc: "Salário CLT", cat: "💼 Salário", conta: "Nubank", valor: 3200, status: "RECEBIDO", tipo: "MENSAL", data: "05/05" },
  { desc: "Adiantamento", cat: "💼 Salário", conta: "Nubank", valor: 700, status: "RECEBIDO", tipo: "AVULSO", data: "20/04" },
  { desc: "Prestação de Serviços", cat: "🤝 Renda Extra", conta: "Mercado Pago", valor: 450, status: "RECEBIDO", tipo: "AVULSO", data: "14/05" },
  { desc: "Venda de Produto", cat: "🛍️ Vendas", conta: "Pix", valor: 320, status: "PENDENTE", tipo: "AVULSO", data: "18/05" },
];

const DESPESAS = [
  { desc: "Aluguel", cat: "🏠 Moradia", conta: "Nubank", valor: 1200, status: "PAGO", tipo: "MENSAL", data: "10/05" },
  { desc: "Fatura Cartão Nubank", cat: "💳 Cartão de Crédito", conta: "Nubank", valor: 1140, status: "PENDENTE", tipo: "MENSAL", data: "15/05" },
  { desc: "Supermercado Atacadão", cat: "🛒 Compras", conta: "Cartão", valor: 780, status: "PAGO", tipo: "AVULSO", data: "08/05" },
  { desc: "Empréstimo Pessoal", cat: "🏦 Dívidas", conta: "Caixa", valor: 620, status: "PAGO", tipo: "PARCELA 4/24", data: "12/05" },
  { desc: "Conta de Luz (ENEL)", cat: "⚡ Essenciais", conta: "Débito Auto", valor: 187, status: "PENDENTE", tipo: "MENSAL", data: "20/05" },
  { desc: "Plano de Internet", cat: "📶 Essenciais", conta: "Débito Auto", valor: 129, status: "PAGO", tipo: "MENSAL", data: "05/05" },
  { desc: "Conta de Água", cat: "💧 Essenciais", conta: "Débito Auto", valor: 84, status: "PENDENTE", tipo: "MENSAL", data: "22/05" },
];

const CATEGORIAS_DESPESAS = [
  { nome: "Moradia", valor: 1200, pct: 100, cor: "bg-rose-500" },
  { nome: "Cartão de Crédito", valor: 1140, pct: 95, cor: "bg-orange-500" },
  { nome: "Supermercado", valor: 780, pct: 65, cor: "bg-amber-500" },
  { nome: "Empréstimo", valor: 620, pct: 52, cor: "bg-red-500" },
  { nome: "Essenciais", valor: 400, pct: 33, cor: "bg-rose-400" },
];

// ─────────────────────────────────────────────
// HEADER
// ─────────────────────────────────────────────
const Header = () => (
  <header className="fixed top-0 w-full z-50 bg-white/90 dark:bg-[#080d12]/90 backdrop-blur-xl border-b border-slate-100 dark:border-white/[0.06]">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 h-[60px] flex items-center justify-between gap-4">
      <img src="/brand/logo-full-light.png" alt="UniGestor" className="h-7 dark:hidden" />
      <img src="/brand/logo-gestor.png" alt="UniGestor" className="h-7 hidden dark:block" />

      <nav className="hidden md:flex items-center gap-6">
        {[
          { label: "Como Funciona", href: "#como-funciona" },
          { label: "Para sua Família", href: "#dashboard" },
          { label: "Módulos", href: "#modulos" },
        ].map(({ label, href }) => (
          <a
            key={href}
            href={href}
            className="text-[13px] font-semibold text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            {label}
          </a>
        ))}
      </nav>

      <div className="flex items-center gap-3">
        <a
          href="https://wa.me/5521992347771?text=Ol%C3%A1%21%20Gostaria%20de%20saber%20mais%20sobre%20o%20UniGestor."
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:flex items-center gap-2 h-9 px-4 border border-[#25D366]/40 text-[#128c4a] dark:text-[#25D366] text-[13px] font-bold rounded-lg hover:bg-[#25D366]/5 transition-colors"
        >
          <IconWhatsApp /> Falar no WhatsApp
        </a>
        <Link href="/admin" className="h-9 px-5 bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white text-[13px] font-bold rounded-lg flex items-center gap-2 shadow-lg shadow-slate-900/10 dark:shadow-emerald-500/20 transition-all hover:scale-105 active:scale-95">
          Acessar Sistema <IconArrow />
        </Link>
      </div>
    </div>
  </header>
);

// ─────────────────────────────────────────────
// HERO SECTION
// ─────────────────────────────────────────────
const Hero = () => (
  <section className="relative pt-[100px] pb-0 overflow-hidden bg-white dark:bg-[#080d12]">
    {/* Grid de fundo */}
    <div
      className="absolute inset-0 opacity-[0.03] dark:opacity-[0.04] pointer-events-none"
      style={{
        backgroundImage: "linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)",
        backgroundSize: "60px 60px",
      }}
    />
    {/* Glow */}
    <div className="absolute top-20 left-1/4 w-[600px] h-[600px] bg-emerald-500/10 rounded-full blur-[140px] pointer-events-none" />

    <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start pt-8 pb-0">

        {/* — LEFT: Copy —*/}
        <div className="max-w-lg">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[11px] font-bold uppercase tracking-widest mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Controle Financeiro Pessoal
          </div>

          <h1 className="text-[42px] sm:text-[52px] font-black tracking-tighter text-slate-900 dark:text-white leading-[1.05]">
            Seu dinheiro entra.{" "}
            <br />
            <span className="text-emerald-600 dark:text-emerald-400">
              Mas para onde
              <br />
              ele vai?
            </span>
          </h1>

          <p className="mt-6 text-[17px] text-slate-600 dark:text-zinc-400 leading-relaxed">
            Organize salário, aluguel, empréstimos, cartão e mercado em um único painel. Entenda onde está gastando demais e comece a construir seu futuro.
          </p>

          <ul className="mt-8 grid grid-cols-2 gap-y-3 gap-x-4">
            {[
              "Salários e renda extra",
              "Contas recorrentes",
              "Cartões e empréstimos",
              "Categorias inteligentes",
              "Projeção mensal",
              "Metas financeiras",
            ].map((item) => (
              <li key={item} className="flex items-center gap-2.5 text-[13px] font-semibold text-slate-700 dark:text-zinc-300">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <IconCheck />
                </span>
                {item}
              </li>
            ))}
          </ul>

          <div className="mt-10 flex flex-col sm:flex-row gap-3">
  
    <a href="https://wa.me/5521992347771?text=Ol%C3%A1%21%20Quero%20come%C3%A7ar%20a%20organizar%20minhas%20finan%C3%A7as%20com%20o%20UniGestor."
    target="_blank"
    rel="noopener noreferrer"
    className="h-[52px] px-8 bg-emerald-600 hover:bg-emerald-500 text-white text-[15px] font-bold rounded-xl flex items-center justify-center gap-2 shadow-xl shadow-emerald-500/25 transition-all hover:-translate-y-0.5"
  >
    Começar a organizar <IconArrow />
  </a>
  
    <a href="#dashboard"
    className="h-[52px] px-6 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-zinc-300 text-[15px] font-bold rounded-xl flex items-center justify-center transition-colors hover:bg-slate-50 dark:hover:bg-white/10"
  >
    Ver como funciona
  </a>
</div>
        </div>

        {/* — RIGHT: Dashboard Mockup Estático Premium — */}
        <div className="relative flex justify-center lg:justify-end">
          <div className="w-full max-w-[520px] rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111820] shadow-2xl shadow-slate-900/10 dark:shadow-black/50 overflow-hidden">
            {/* Barra de título */}
            <div className="h-10 bg-slate-50 dark:bg-[#0c1117] border-b border-slate-100 dark:border-white/[0.06] flex items-center px-4 gap-2">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-rose-400" />
                <div className="w-3 h-3 rounded-full bg-amber-400" />
                <div className="w-3 h-3 rounded-full bg-emerald-400" />
              </div>
              <div className="flex-1 flex justify-center">
                <div className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 tracking-widest uppercase">
                  unigestor.net.br
                </div>
              </div>
            </div>

            {/* Cards de resumo */}
            <div className="p-4 grid grid-cols-3 gap-3">
              <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 p-3 rounded-xl">
                <p className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">Receitas</p>
                <p className="text-[17px] font-black text-emerald-700 dark:text-emerald-300 tabular-nums">R$ 4.670</p>
                <p className="text-[9px] text-emerald-600/60 dark:text-emerald-400/60 mt-0.5">Recebido no mês</p>
              </div>
              <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20 p-3 rounded-xl">
                <p className="text-[9px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider mb-1">Despesas</p>
                <p className="text-[17px] font-black text-rose-700 dark:text-rose-300 tabular-nums">R$ 4.140</p>
                <p className="text-[9px] text-rose-600/60 dark:text-rose-400/60 mt-0.5">Pago no mês</p>
              </div>
              <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 p-3 rounded-xl">
                <p className="text-[9px] font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Saldo</p>
                <p className="text-[17px] font-black text-slate-800 dark:text-white tabular-nums">R$ 2.810</p>
                <p className="text-[9px] text-slate-400 mt-0.5">Disponível</p>
              </div>
            </div>

            {/* Ranking de despesas */}
            <div className="px-4 pb-2">
              <p className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest mb-3">
                Despesas por Categoria
              </p>
              <div className="space-y-2.5">
                {CATEGORIAS_DESPESAS.map(({ nome, valor, pct, cor }) => (
                  <div key={nome}>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="font-semibold text-slate-600 dark:text-zinc-300">{nome}</span>
                      <span className="font-black text-slate-700 dark:text-zinc-200 tabular-nums">R$ {valor.toLocaleString("pt-BR")}</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 dark:bg-white/[0.06] rounded-full overflow-hidden">
                      <div
                        className={`h-full ${cor} rounded-full`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Últimas transações */}
            <div className="mt-3 border-t border-slate-100 dark:border-white/[0.06]">
              <div className="px-4 py-2 flex items-center justify-between">
                <p className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest">Lançamentos</p>
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">ver todos →</span>
              </div>
              <div className="divide-y divide-slate-50 dark:divide-white/[0.04]">
                {[
                  { desc: "Salário CLT", cat: "💼 Salário", valor: "+R$ 3.200", status: "RECEBIDO", cor: "text-emerald-600" },
                  { desc: "Aluguel", cat: "🏠 Moradia", valor: "-R$ 1.200", status: "PAGO", cor: "text-rose-600" },
                  { desc: "Supermercado", cat: "🛒 Compras", valor: "-R$ 780", status: "PAGO", cor: "text-rose-600" },
                  { desc: "Fatura Cartão", cat: "💳 Cartão", valor: "-R$ 1.140", status: "PENDENTE", cor: "text-rose-600" },
                ].map(({ desc, cat, valor, status, cor }) => (
                  <div key={desc} className="px-4 py-2.5 flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-[12px] font-bold text-slate-700 dark:text-zinc-200 truncate">{desc}</p>
                      <p className="text-[10px] text-slate-400 dark:text-zinc-500">{cat}</p>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className={`text-[12px] font-black tabular-nums ${cor}`}>{valor}</p>
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                        status === "RECEBIDO" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
                        : status === "PAGO" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"
                      }`}>{status}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="h-3" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
);

// ─────────────────────────────────────────────
// PAIN POINTS
// ─────────────────────────────────────────────
const PainPoints = () => (
  <section className="py-20 bg-slate-900 dark:bg-[#060a0f] text-white">
    <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
      <p className="text-slate-400 text-sm font-bold uppercase tracking-[0.2em] mb-6">Isso parece familiar?</p>
      <h2 className="text-[32px] sm:text-[42px] font-extrabold tracking-tight leading-tight mb-4">
        Você recebe. Paga conta. Usa cartão.<br />
        Faz mercado. Paga internet. Coloca gasolina.
      </h2>
      <p className="text-xl text-emerald-400 font-bold mb-14">
        No fim do mês sobra sempre a mesma dúvida:{" "}
        <span className="italic text-white">"Cadê o meu dinheiro?"</span>
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: "💸", title: "Dinheiro sumindo", sub: "Sem saber para onde vai" },
          { icon: "💳", title: "Cartão acumulando", sub: "Fatura surpresa no fim do mês" },
          { icon: "📅", title: "Contas vencendo", sub: "Lembretes chegando tarde" },
          { icon: "😰", title: "Mês apertado", sub: "Dificuldade de guardar algo" },
        ].map(({ icon, title, sub }) => (
          <div
            key={title}
            className="bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.08] rounded-2xl p-6 text-left transition-colors"
          >
            <div className="text-3xl mb-3">{icon}</div>
            <p className="font-bold text-white text-[15px]">{title}</p>
            <p className="text-slate-400 text-[12px] mt-1 leading-relaxed">{sub}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

// ─────────────────────────────────────────────
// COMO FUNCIONA
// ─────────────────────────────────────────────
const ComoFunciona = () => (
  <section id="como-funciona" className="py-24 bg-white dark:bg-[#080d12]">
    <div className="max-w-6xl mx-auto px-4 sm:px-6">
      <div className="text-center mb-16">
        <p className="text-emerald-600 dark:text-emerald-400 text-[11px] font-bold uppercase tracking-[0.2em] mb-3">Como Funciona</p>
        <h2 className="text-[32px] sm:text-[40px] font-extrabold tracking-tight text-slate-900 dark:text-white">
          Tudo no lugar certo, em 3 passos simples
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {[
          {
            num: "01",
            icon: "📝",
            title: "Cadastre suas contas",
            desc: "Adicione suas receitas (salário, bicos, vendas) e despesas (aluguel, cartão, empréstimos, contas essenciais). Uma única vez.",
            color: "border-emerald-200 dark:border-emerald-500/30",
            numColor: "text-emerald-600 dark:text-emerald-400",
          },
          {
            num: "02",
            icon: "📊",
            title: "Visualize o panorama",
            desc: "Veja em tempo real quanto entrou, quanto saiu, qual é o seu saldo real e para onde seu dinheiro está indo mês a mês.",
            color: "border-sky-200 dark:border-sky-500/30",
            numColor: "text-sky-600 dark:text-sky-400",
          },
          {
            num: "03",
            icon: "🎯",
            title: "Tome o controle",
            desc: "Identifique gastos excessivos, organize prioridades, crie metas e acompanhe sua evolução financeira com clareza.",
            color: "border-violet-200 dark:border-violet-500/30",
            numColor: "text-violet-600 dark:text-violet-400",
          },
        ].map(({ num, icon, title, desc, color, numColor }) => (
          <div
            key={num}
            className={`p-8 rounded-2xl border-2 ${color} bg-slate-50 dark:bg-white/[0.03] relative`}
          >
            <span className={`absolute top-6 right-6 text-[11px] font-black ${numColor} opacity-40`}>
              {num}
            </span>
            <div className="text-4xl mb-5">{icon}</div>
            <h3 className="text-[18px] font-bold text-slate-900 dark:text-white mb-3">{title}</h3>
            <p className="text-[14px] text-slate-600 dark:text-zinc-400 leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

// ─────────────────────────────────────────────
// DASHBOARD COMPLETO (A PEÇA CENTRAL)
// ─────────────────────────────────────────────
const FullDashboard = () => (
  <section id="dashboard" className="py-24 bg-slate-50 dark:bg-[#060a0f] border-y border-slate-100 dark:border-white/[0.04]">
    <div className="max-w-7xl mx-auto px-4 sm:px-6">
      <div className="text-center mb-12">
        <p className="text-emerald-600 dark:text-emerald-400 text-[11px] font-bold uppercase tracking-[0.2em] mb-3">
          Para Sua Família
        </p>
        <h2 className="text-[32px] sm:text-[40px] font-extrabold tracking-tight text-slate-900 dark:text-white">
          A realidade financeira brasileira,{" "}
          <span className="text-emerald-600 dark:text-emerald-400">finalmente mapeada</span>
        </h2>
        <p className="mt-4 text-[15px] text-slate-600 dark:text-zinc-400 max-w-xl mx-auto">
          Dados reais, organizados como você vai ver no seu painel — com categorias do dia a dia de qualquer família.
        </p>
      </div>

      {/* Painel Principal */}
      <div className="bg-white dark:bg-[#111820] rounded-2xl border border-slate-200 dark:border-white/[0.08] shadow-2xl overflow-hidden max-w-5xl mx-auto">
        {/* Header do painel */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/[0.06] bg-slate-50 dark:bg-[#0c1117]">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-white">Finanças Pessoais</h3>
            <p className="text-[11px] text-slate-400 dark:text-zinc-500 mt-0.5 uppercase tracking-wider">Maio 2026</p>
          </div>
          <div className="flex gap-2">
            {["Receitas", "Despesas", "Saldo"].map((t, i) => (
              <span
                key={t}
                className={`text-[10px] font-bold px-3 py-1 rounded-full ${
                  i === 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
                  : i === 1 ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400"
                  : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-zinc-300"
                }`}
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* Tabela de Lançamentos */}
        <div className="overflow-x-auto">
          <table className="w-full text-left" style={{ minWidth: 700 }}>
            <thead>
              <tr className="border-b border-slate-100 dark:border-white/[0.06] text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-500">
                <th className="px-6 py-3">Descrição</th>
                <th className="px-4 py-3 text-center">Data</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3">Categoria</th>
                <th className="px-4 py-3">Conta</th>
                <th className="px-6 py-3 text-right">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-white/[0.04]">
              {/* RECEITAS */}
              <tr className="bg-slate-50/50 dark:bg-white/[0.02]">
                <td colSpan={6} className="px-6 py-2 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">
                  📈 Receitas do Mês
                </td>
              </tr>
              {RECEITAS.map(({ desc, cat, conta, valor, status, tipo, data }) => (
                <tr key={desc} className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                  <td className="px-6 py-3">
                    <p className="text-[13px] font-bold text-slate-700 dark:text-zinc-200">{desc}</p>
                    <p className="text-[10px] text-slate-400 dark:text-zinc-500 mt-0.5 uppercase tracking-wide">{tipo}</p>
                  </td>
                  <td className="px-4 py-3 text-center text-[12px] font-mono text-slate-500 dark:text-zinc-400">{data}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                      status === "RECEBIDO"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"
                    }`}>{status}</span>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-slate-600 dark:text-zinc-400">{cat}</td>
                  <td className="px-4 py-3 text-[12px] text-slate-500 dark:text-zinc-500">{conta}</td>
                  <td className="px-6 py-3 text-right text-[13px] font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                    + R$ {valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}

              {/* DESPESAS */}
              <tr className="bg-slate-50/50 dark:bg-white/[0.02]">
                <td colSpan={6} className="px-6 py-2 text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-widest">
                  📉 Despesas do Mês
                </td>
              </tr>
              {DESPESAS.map(({ desc, cat, conta, valor, status, tipo, data }) => (
                <tr key={desc} className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                  <td className="px-6 py-3">
                    <p className="text-[13px] font-bold text-slate-700 dark:text-zinc-200">{desc}</p>
                    <p className="text-[10px] text-slate-400 dark:text-zinc-500 mt-0.5 uppercase tracking-wide">{tipo}</p>
                  </td>
                  <td className="px-4 py-3 text-center text-[12px] font-mono text-slate-500 dark:text-zinc-400">{data}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                      status === "PAGO"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"
                    }`}>{status}</span>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-slate-600 dark:text-zinc-400">{cat}</td>
                  <td className="px-4 py-3 text-[12px] text-slate-500 dark:text-zinc-500">{conta}</td>
                  <td className="px-6 py-3 text-right text-[13px] font-black text-rose-600 dark:text-rose-400 tabular-nums">
                    - R$ {valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}

              {/* Rodapé com totais */}
              <tr className="bg-slate-900 dark:bg-black/40 text-white">
                <td colSpan={4} className="px-6 py-4 text-[12px] font-bold text-slate-300">
                  💰 Saldo Final do Mês
                </td>
                <td className="px-4 py-4 text-right text-[11px] text-slate-400">
                  <span className="text-emerald-400">Receitas: R$ 4.670</span>
                  <br />
                  <span className="text-rose-400">Despesas: R$ 4.140</span>
                </td>
                <td className="px-6 py-4 text-right text-[18px] font-black text-emerald-400 tabular-nums">
                  R$ 530,00
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Nota contextual */}
      <p className="text-center mt-6 text-[12px] text-slate-400 dark:text-zinc-500 italic">
        * Dados fictícios baseados na realidade de uma família brasileira de classe média.
      </p>
    </div>
  </section>
);

// ─────────────────────────────────────────────
// BENEFÍCIOS
// ─────────────────────────────────────────────
const Benefits = () => (
  <section className="py-24 bg-white dark:bg-[#080d12]">
    <div className="max-w-7xl mx-auto px-4 sm:px-6">
      <div className="text-center mb-16">
        <h2 className="text-[32px] sm:text-[40px] font-extrabold tracking-tight text-slate-900 dark:text-white">
          Por que funciona de verdade
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          {
            icon: "🔁",
            title: "Recorrências Automáticas",
            desc: "Cadastre aluguel, internet, empréstimento uma vez. O sistema projeta os próximos meses sozinho.",
            bg: "bg-sky-50 dark:bg-sky-500/10",
            border: "border-sky-200 dark:border-sky-500/20",
          },
          {
            icon: "📊",
            title: "Visão de Caixa Real",
            desc: "Saiba exatamente seu saldo projetado até o último dia do mês. Sem surpresas.",
            bg: "bg-emerald-50 dark:bg-emerald-500/10",
            border: "border-emerald-200 dark:border-emerald-500/20",
          },
          {
            icon: "🏷️",
            title: "Categorias Inteligentes",
            desc: "Descubra os ralos financeiros. Supermercado, lazer, dívidas — tudo categorizado e rankeado.",
            bg: "bg-amber-50 dark:bg-amber-500/10",
            border: "border-amber-200 dark:border-amber-500/20",
          },
          {
            icon: "🎯",
            title: "Planejamento de Futuro",
            desc: "Com o passado organizado, fica fácil planejar: economizar, investir, quitar dívidas.",
            bg: "bg-violet-50 dark:bg-violet-500/10",
            border: "border-violet-200 dark:border-violet-500/20",
          },
        ].map(({ icon, title, desc, bg, border }) => (
          <div
            key={title}
            className={`p-6 rounded-2xl border ${bg} ${border}`}
          >
            <div className="text-3xl mb-4">{icon}</div>
            <h3 className="text-[16px] font-bold text-slate-900 dark:text-white mb-2">{title}</h3>
            <p className="text-[13px] text-slate-600 dark:text-zinc-400 leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

// ─────────────────────────────────────────────
// MÓDULOS
// ─────────────────────────────────────────────
const Modules = () => (
  <section id="modulos" className="py-24 bg-slate-50 dark:bg-[#060a0f] border-t border-slate-100 dark:border-white/[0.04]">
    <div className="max-w-7xl mx-auto px-4 sm:px-6">
      <div className="text-center mb-16">
        <p className="text-slate-400 dark:text-zinc-500 text-[11px] font-bold uppercase tracking-[0.2em] mb-3">
          Módulos Específicos
        </p>
        <h2 className="text-[32px] sm:text-[40px] font-extrabold tracking-tight text-slate-900 dark:text-white">
          Expanda quando seu negócio pedir
        </h2>
        <p className="mt-4 text-[15px] text-slate-600 dark:text-zinc-400">
          Ferramentas extras para quem precisa gerenciar mais do que a própria casa.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Academia */}
        <div className="bg-white dark:bg-[#111820] border border-slate-200 dark:border-white/[0.08] rounded-2xl p-8 relative group hover:border-sky-300 dark:hover:border-sky-500/40 transition-colors">
          <div className="absolute top-5 right-5">
            <span className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-400 border border-sky-200 dark:border-sky-500/30">
              Em desenvolvimento
            </span>
          </div>
          <div className="w-14 h-14 rounded-2xl bg-sky-100 dark:bg-sky-500/20 flex items-center justify-center text-2xl mb-6">
            🏋️
          </div>
          <h3 className="text-[20px] font-bold text-slate-900 dark:text-white mb-2">Academia</h3>
          <p className="text-[13px] text-slate-500 dark:text-zinc-400 mb-6 leading-relaxed">
            Sistema completo para quem tem uma academia ou espaço fitness.
          </p>
          <ul className="space-y-2">
            {["Cadastro e gestão de alunos", "Controle de mensalidades", "Check-in e acesso", "Planos e modalidades"].map((item) => (
              <li key={item} className="flex items-center gap-2 text-[12px] text-slate-600 dark:text-zinc-400">
                <span className="w-4 h-4 rounded-full bg-sky-100 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 flex items-center justify-center flex-shrink-0">
                  <IconCheck />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Personal */}
        <div className="bg-white dark:bg-[#111820] border border-slate-200 dark:border-white/[0.08] rounded-2xl p-8 relative group hover:border-emerald-300 dark:hover:border-emerald-500/40 transition-colors">
          <div className="absolute top-5 right-5">
            <span className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-400 border border-sky-200 dark:border-sky-500/30">
              Em desenvolvimento
            </span>
          </div>
          <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center text-2xl mb-6">
            ⏱️
          </div>
          <h3 className="text-[20px] font-bold text-slate-900 dark:text-white mb-2">Personal Trainer</h3>
          <p className="text-[13px] text-slate-500 dark:text-zinc-400 mb-6 leading-relaxed">
            Organize sua carteira de clientes, treinos e recebimentos em um só lugar.
          </p>
          <ul className="space-y-2">
            {["Ficha e evolução de clientes", "Planilha de treinos", "Controle de pagamentos", "Agenda automática"].map((item) => (
              <li key={item} className="flex items-center gap-2 text-[12px] text-slate-600 dark:text-zinc-400">
                <span className="w-4 h-4 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
                  <IconCheck />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Condomínio */}
        <div className="bg-slate-50 dark:bg-[#0c1117] border border-slate-200 dark:border-white/[0.05] rounded-2xl p-8 relative opacity-70 hover:opacity-90 transition-opacity">
          <div className="absolute top-5 right-5">
            <span className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-full bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-zinc-400 border border-slate-200 dark:border-white/10">
              Em breve
            </span>
          </div>
          <div className="w-14 h-14 rounded-2xl bg-slate-200 dark:bg-white/10 flex items-center justify-center text-2xl mb-6 grayscale">
            🏢
          </div>
          <h3 className="text-[20px] font-bold text-slate-600 dark:text-zinc-300 mb-2">Condomínio</h3>
          <p className="text-[13px] text-slate-400 dark:text-zinc-500 mb-6 leading-relaxed">
            Gestão financeira e administrativa completa para síndicos e administradoras.
          </p>
          <ul className="space-y-2">
            {["Cadastro de moradores", "Reservas de áreas comuns", "Cobranças via Pix/Boleto", "Transparência financeira"].map((item) => (
              <li key={item} className="flex items-center gap-2 text-[12px] text-slate-500 dark:text-zinc-500">
                <span className="w-4 h-4 rounded-full bg-slate-100 dark:bg-white/10 text-slate-400 flex items-center justify-center flex-shrink-0">
                  <IconCheck />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  </section>
);

// ─────────────────────────────────────────────
// SEGURANÇA
// ─────────────────────────────────────────────
const Security = () => (
  <section className="py-16 bg-slate-900 dark:bg-black/60 text-white">
    <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/10 text-emerald-400 mb-6">
        <IconShield />
      </div>
      <h2 className="text-2xl font-extrabold tracking-tight mb-4">
        Seus dados sempre protegidos
      </h2>
      <p className="text-slate-400 text-[15px] leading-relaxed max-w-2xl mx-auto">
        A infraestrutura do UniGestor é construída com criptografia ponta-a-ponta. Suas informações financeiras e pessoais permanecem{" "}
        <strong className="text-white">100% confidenciais</strong> e em estrita conformidade com a{" "}
        <strong className="text-emerald-400">Lei Geral de Proteção de Dados (LGPD)</strong>.
      </p>
    </div>
  </section>
);

// ─────────────────────────────────────────────
// CTA FINAL
// ─────────────────────────────────────────────
const FinalCTA = () => (
  <section className="py-32 bg-white dark:bg-[#080d12] relative overflow-hidden">
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="w-[800px] h-[400px] bg-emerald-500/10 rounded-full blur-[120px]" />
    </div>
    <div className="relative max-w-3xl mx-auto px-4 sm:px-6 text-center">
      <h2 className="text-[42px] sm:text-[56px] font-black tracking-tighter text-slate-900 dark:text-white leading-tight mb-6">
        Pare de adivinhar.
        <br />
        <span className="text-emerald-600 dark:text-emerald-400">Comece a controlar.</span>
      </h2>
      <p className="text-[17px] text-slate-600 dark:text-zinc-400 mb-4 max-w-xl mx-auto leading-relaxed">
        Quer entender como o UniGestor pode transformar sua organização financeira?
        Fale direto comigo no WhatsApp — sem enrolação, sem robô.
      </p>
      <p className="text-[14px] text-slate-400 dark:text-zinc-500 mb-10">
        Já é cliente? Acesse o sistema e comece agora mesmo.
      </p>
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        
        <a  href="https://wa.me/5521992347771?text=Ol%C3%A1%21%20Quero%20entender%20como%20o%20UniGestor%20pode%20me%20ajudar%20a%20controlar%20minhas%20finan%C3%A7as."
          target="_blank"
          rel="noopener noreferrer"
          className="h-[56px] px-10 bg-emerald-600 hover:bg-emerald-500 text-white text-[16px] font-bold rounded-xl flex items-center justify-center gap-2 shadow-2xl shadow-emerald-500/30 transition-all hover:-translate-y-1 hover:scale-105"
        >
          <IconWhatsApp /> Falar com o Administrador
        </a>
        
        <a  href="/admin"
          className="h-[56px] px-8 bg-transparent border-2 border-slate-300 dark:border-white/20 text-slate-700 dark:text-zinc-300 text-[16px] font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
        >
          Já tenho conta <IconArrow />
        </a>
      </div>
    </div>
  </section>
);

// ─────────────────────────────────────────────
// FOOTER
// ─────────────────────────────────────────────
const Footer = () => (
  <footer className="border-t border-slate-100 dark:border-white/[0.05] bg-slate-50 dark:bg-[#060a0f] py-8">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
      <img src="/brand/logo-full-light.png" alt="UniGestor" className="h-6 opacity-40 grayscale dark:hidden" />
      <img src="/brand/logo-gestor.png" alt="UniGestor" className="h-6 opacity-30 grayscale hidden dark:block" />
      <p className="text-[11px] text-slate-400 dark:text-zinc-600 font-medium tracking-wide">
        &copy; {new Date().getFullYear()} UniGestor · Todos os direitos reservados · LGPD
      </p>
      <div className="flex gap-4 text-[11px] font-semibold text-slate-400 dark:text-zinc-500">
        <a href="#como-funciona" className="hover:text-slate-700 dark:hover:text-zinc-300 transition-colors">Como Funciona</a>
        <a href="#modulos" className="hover:text-slate-700 dark:hover:text-zinc-300 transition-colors">Módulos</a>
        <Link href="/admin" className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">Acessar</Link>
      </div>
    </div>
  </footer>
);

// ─────────────────────────────────────────────
// PÁGINA PRINCIPAL
// ─────────────────────────────────────────────
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#080d12] text-slate-800 dark:text-zinc-200 overflow-x-hidden selection:bg-emerald-500 selection:text-white">
      <Header />
      <main>
        <Hero />
        <PainPoints />
        <ComoFunciona />
        <FullDashboard />
        <Benefits />
        <Modules />
        <Security />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
