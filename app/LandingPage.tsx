import Link from "next/link";
import React from "react";

export default function LandingPage() {
  return (
    <div className="bg-[#0b1015] text-white min-h-screen overflow-x-hidden font-sans">

      {/* BACKGROUND GLOW */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-emerald-500/20 blur-[160px]" />
      </div>

      {/* HEADER */}
      <header className="fixed top-0 w-full z-50 bg-black/40 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 h-16 flex justify-between items-center">
          <img src="/brand/logo-full-light.png" className="h-8" />

          <nav className="hidden md:flex gap-8 text-sm text-zinc-400 font-semibold">
            <a href="#dashboard" className="hover:text-white">Financeiro</a>
            <a href="#modulos" className="hover:text-white">Módulos</a>
            <a href="#seguranca" className="hover:text-white">Segurança</a>
          </nav>

          <Link href="/login" className="h-11 px-6 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold flex items-center">
            Acessar
          </Link>
        </div>
      </header>

      {/* HERO */}
      <section className="pt-32 pb-24">
        <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-16 items-center">

          {/* LEFT */}
          <div>
            <span className="text-emerald-400 text-xs font-bold uppercase tracking-widest">
              CONTROLE FINANCEIRO REAL
            </span>

            <h1 className="text-5xl lg:text-6xl font-black mt-6 leading-tight">
              Seu dinheiro entra.
              <br />
              <span className="text-emerald-500">Mas ele não fica.</span>
            </h1>

            <p className="text-zinc-400 text-lg mt-6 max-w-xl">
              Salário, mercado, cartão, contas da casa, empréstimos…
              Organize tudo em um único painel e finalmente entenda sua vida financeira.
            </p>

            <div className="flex gap-4 mt-10">
              <Link href="/login" className="h-14 px-8 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold flex items-center">
                Começar agora
              </Link>
            </div>
          </div>

          {/* DASHBOARD PREMIUM */}
          <div id="dashboard" className="relative">

            <div className="rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 p-6 shadow-2xl">

              {/* TOP CARDS */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-emerald-500/10 p-4 rounded-xl">
                  <p className="text-xs text-zinc-400">Receitas</p>
                  <p className="text-2xl font-black text-emerald-400">R$ 5.230</p>
                </div>

                <div className="bg-rose-500/10 p-4 rounded-xl">
                  <p className="text-xs text-zinc-400">Despesas</p>
                  <p className="text-2xl font-black text-rose-400">R$ 3.336</p>
                </div>

                <div className="bg-white/10 p-4 rounded-xl">
                  <p className="text-xs text-zinc-400">Saldo</p>
                  <p className="text-2xl font-black">R$ 1.894</p>
                </div>
              </div>

              {/* GRAPH FAKE */}
              <div className="mt-8 h-32 flex items-end gap-2">
                {[20, 40, 30, 60, 80, 50, 90].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-emerald-500/40 rounded-t-md"
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>

              {/* LIST */}
              <div className="mt-8 space-y-4 text-sm">
                {[
                  ["Salário", "+ R$ 3.200"],
                  ["Mercado", "- R$ 850"],
                  ["Cartão", "- R$ 620"],
                  ["Internet", "- R$ 120"],
                ].map(([name, value]) => (
                  <div key={name} className="flex justify-between">
                    <span className="text-zinc-400">{name}</span>
                    <span className={value.includes("+") ? "text-emerald-400" : "text-rose-400"}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* DOR REAL */}
      <section className="py-24 text-center">
        <h2 className="text-4xl font-black">
          Você recebe.
          <span className="text-rose-500"> Mas nunca sobra.</span>
        </h2>

        <p className="text-zinc-400 mt-6 max-w-2xl mx-auto">
          Conta de luz, água, mercado, cartão, empréstimo…
          no final do mês sobra a dúvida:
        </p>

        <p className="text-2xl font-black mt-6">
          Pra onde foi meu dinheiro?
        </p>
      </section>

      {/* BENEFICIOS */}
      <section className="py-20 max-w-7xl mx-auto px-6 grid md:grid-cols-3 gap-6">
        {[
          ["📊", "Visão total", "Veja tudo em um único lugar"],
          ["🔁", "Automação", "Contas recorrentes automáticas"],
          ["🎯", "Planejamento", "Projete seu futuro financeiro"],
        ].map(([icon, title, desc]) => (
          <div key={title} className="bg-white/5 border border-white/10 p-8 rounded-3xl">
            <div className="text-3xl mb-4">{icon}</div>
            <h3 className="font-black text-xl">{title}</h3>
            <p className="text-zinc-400 mt-2">{desc}</p>
          </div>
        ))}
      </section>

      {/* MODULOS */}
      <section id="modulos" className="py-24 text-center">
        <h2 className="text-4xl font-black mb-14">
          Expanda conforme você cresce
        </h2>

        <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-6 px-6">
          {[
            ["🏋️", "Academia", "EM DESENVOLVIMENTO"],
            ["💪", "Personal", "EM DESENVOLVIMENTO"],
            ["🏢", "Condomínio", "EM BREVE"],
          ].map(([emoji, title, status]) => (
            <div key={title} className="bg-white/5 border border-white/10 p-8 rounded-3xl">
              <div className="text-4xl">{emoji}</div>
              <p className="text-xs text-emerald-400 mt-4">{status}</p>
              <h3 className="text-2xl font-black mt-2">{title}</h3>
            </div>
          ))}
        </div>
      </section>

      {/* SEGURANÇA */}
      <section id="seguranca" className="py-24 text-center border-t border-white/10">
        <h2 className="text-4xl font-black">Seus dados protegidos</h2>
        <p className="text-zinc-400 mt-4">
          Criptografia, LGPD e segurança de nível bancário.
        </p>
      </section>

      {/* CTA FINAL */}
      <section className="py-24 text-center">
        <h2 className="text-5xl font-black">
          Pare de adivinhar.
          <span className="text-emerald-500"> Comece a controlar.</span>
        </h2>

        <Link
          href="/login"
          className="inline-flex mt-10 h-14 px-10 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold items-center"
        >
          Entrar no UniGestor
        </Link>
      </section>

      {/* WHATSAPP FLOAT */}
      <a
        href="https://wa.me/5521992347771"
        target="_blank"
        className="fixed bottom-6 right-6 bg-green-500 hover:bg-green-400 w-14 h-14 rounded-full flex items-center justify-center shadow-2xl"
      >
        💬
      </a>

      {/* FOOTER */}
      <footer className="border-t border-white/10 py-8 text-center text-zinc-500">
        © {new Date().getFullYear()} UniGestor
      </footer>
    </div>
  );
}