import Link from "next/link";
import React from "react";

const expenseCategories = [
  { name: "Supermercado", value: "R$ 1.284", width: "85%" },
  { name: "Cartão de Crédito", value: "R$ 1.020", width: "72%" },
  { name: "Empréstimo", value: "R$ 620", width: "48%" },
  { name: "Energia", value: "R$ 187", width: "24%" },
  { name: "Água", value: "R$ 96", width: "18%" },
  { name: "Internet", value: "R$ 129", width: "20%" },
];

const incomeCategories = [
  { name: "Salário", value: "R$ 3.200", width: "90%" },
  { name: "Adiantamento", value: "R$ 700", width: "35%" },
  { name: "Serviços", value: "R$ 950", width: "42%" },
  { name: "Venda", value: "R$ 380", width: "20%" },
];

const modules = [
  {
    emoji: "🏋️",
    title: "Academia",
    status: "EM DESENVOLVIMENTO",
    desc: "Controle de alunos, mensalidades, check-in e planos.",
  },
  {
    emoji: "💪",
    title: "Personal",
    status: "EM DESENVOLVIMENTO",
    desc: "Clientes, treinos, pagamentos e agenda.",
  },
  {
    emoji: "🏢",
    title: "Condomínio",
    status: "EM BREVE",
    desc: "Moradores, reservas, cobranças e gestão financeira.",
  },
];

function CategoryBar({
  name,
  value,
  width,
  income = false,
}: {
  name: string;
  value: string;
  width: string;
  income?: boolean;
}) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-2">
        <span className="text-slate-600">{name}</span>
        <span
          className={`font-bold ${
            income ? "text-emerald-600" : "text-rose-600"
          }`}
        >
          {value}
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${
            income ? "bg-emerald-500" : "bg-rose-500"
          }`}
          style={{ width }}
        />
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="bg-slate-50 text-slate-800 min-h-screen overflow-x-hidden">
      {/* HEADER */}
      <header className="fixed top-0 w-full z-50 bg-white/90 backdrop-blur-lg border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 h-16 flex justify-between items-center">
          <img
            src="/brand/logo-full-light.png"
            className="h-8"
            alt="UniGestor"
          />

          <nav className="hidden md:flex gap-8 text-sm font-semibold text-slate-600">
            <a href="#dashboard">Financeiro</a>
            <a href="#modulos">Módulos</a>
            <a href="#seguranca">Segurança</a>
          </nav>

          <Link
            href="/login"
            className="h-11 px-6 bg-emerald-600 text-white rounded-xl font-bold flex items-center"
          >
            Acessar sistema
          </Link>
        </div>
      </header>

      {/* HERO */}
      <section className="pt-28 pb-20">
        <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-14 items-center">
          <div>
            <div className="inline-flex px-4 py-2 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold mb-6">
              ORGANIZAÇÃO FINANCEIRA REAL
            </div>

            <h1 className="text-5xl lg:text-6xl font-black leading-tight text-slate-900">
              Seu dinheiro entra.
              <br />
              <span className="text-emerald-600">Mas para onde ele vai?</span>
            </h1>

            <p className="text-xl text-slate-600 mt-6 leading-relaxed">
              Controle salário, cartão, empréstimos, compras, contas da casa e
              renda extra em um único painel.
            </p>

            <div className="grid grid-cols-2 gap-3 mt-8 text-sm text-slate-700 font-semibold">
              <div>✓ Receitas e despesas</div>
              <div>✓ Contas recorrentes</div>
              <div>✓ Planejamento mensal</div>
              <div>✓ Metas e investimentos</div>
            </div>

            <Link
              href="/login"
              className="inline-flex mt-10 h-14 px-8 bg-slate-900 text-white rounded-xl font-bold items-center"
            >
              Começar agora
            </Link>
          </div>

          {/* DASHBOARD */}
          <div
            id="dashboard"
            className="bg-white rounded-3xl border border-slate-200 shadow-2xl p-6"
          >
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="bg-emerald-50 rounded-2xl p-4">
                <div className="text-sm text-slate-500">Receitas</div>
                <div className="text-2xl font-black text-emerald-600">
                  R$ 5.230
                </div>
              </div>

              <div className="bg-rose-50 rounded-2xl p-4">
                <div className="text-sm text-slate-500">Despesas</div>
                <div className="text-2xl font-black text-rose-600">
                  R$ 3.336
                </div>
              </div>

              <div className="bg-slate-100 rounded-2xl p-4">
                <div className="text-sm text-slate-500">Saldo</div>
                <div className="text-2xl font-black text-slate-800">
                  R$ 1.894
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8 mt-8">
              <div className="space-y-4">
                <h3 className="font-bold">Receitas</h3>
                {incomeCategories.map((item) => (
                  <CategoryBar key={item.name} {...item} income />
                ))}
              </div>

              <div className="space-y-4">
                <h3 className="font-bold">Despesas</h3>
                {expenseCategories.map((item) => (
                  <CategoryBar key={item.name} {...item} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* DOR */}
      <section className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-black">
            O dinheiro entra.
            <span className="text-rose-600"> As contas levam.</span>
          </h2>

          <p className="text-slate-600 text-lg mt-4">
            Mercado, luz, água, internet, cartão, empréstimo... no fim do mês,
            sobra a mesma pergunta:
          </p>

          <p className="text-2xl font-black mt-6">
            “Pra onde foi meu dinheiro?”
          </p>
        </div>
      </section>

      {/* BENEFICIOS */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-3 gap-6">
          {[
            ["📊", "Visão clara", "Entenda sua vida financeira."],
            ["🔁", "Recorrência", "Automatize contas mensais."],
            ["🎯", "Planejamento", "Planeje metas e investimentos."],
          ].map(([icon, title, desc]) => (
            <div
              key={title}
              className="bg-white rounded-3xl p-8 border border-slate-200"
            >
              <div className="text-4xl mb-4">{icon}</div>
              <h3 className="font-black text-xl">{title}</h3>
              <p className="text-slate-600 mt-2">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* MODULOS */}
      <section id="modulos" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="text-4xl font-black text-center mb-14">
            Cresça com o UniGestor
          </h2>

          <div className="grid md:grid-cols-3 gap-6">
            {modules.map((module) => (
              <div
                key={module.title}
                className="bg-slate-50 rounded-3xl border border-slate-200 p-8"
              >
                <div className="text-4xl">{module.emoji}</div>
                <div className="text-xs font-bold text-emerald-600 mt-4">
                  {module.status}
                </div>
                <h3 className="font-black text-2xl mt-2">{module.title}</h3>
                <p className="text-slate-600 mt-3">{module.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SEGURANÇA */}
      <section
        id="seguranca"
        className="py-20 bg-slate-900 text-white text-center"
      >
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-4xl font-black">Segurança em primeiro lugar</h2>
          <p className="text-slate-300 mt-5 text-lg">
            Dados criptografados, acesso protegido e respeito à LGPD.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 text-center">
        <h2 className="text-5xl font-black">
          Pare de adivinhar.
          <span className="text-emerald-600"> Comece a controlar.</span>
        </h2>

        <Link
          href="/login"
          className="inline-flex mt-10 h-14 px-8 bg-emerald-600 text-white rounded-xl font-bold items-center"
        >
          Entrar no UniGestor
        </Link>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-slate-200 py-8 text-center text-slate-500">
        © {new Date().getFullYear()} UniGestor
      </footer>
    </div>
  );
}