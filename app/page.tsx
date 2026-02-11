"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export default function AreaDoCliente() {
  const [whatsapp, setWhatsapp] = useState("");
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  // Validação simples para liberar o botão
  const canSubmit = useMemo(() => {
    const cleanPhone = whatsapp.replace(/\D/g, "");
    return cleanPhone.length >= 10 && pin.length === 4;
  }, [whatsapp, pin]);

  async function handleAcesso(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    const cleanPhone = whatsapp.replace(/\D/g, "");
    
    // Aqui ele redireciona para a página da fatura passando o PIN
    // A validação real do PIN faremos dentro da página /p/[whatsapp]
    router.push(`/p/${cleanPhone}?pin=${pin}`);
  }

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center px-6 py-10 bg-slate-50 dark:bg-[#0f141a]">
      {/* Fundo com gradiente + glow (Mantido conforme seu original) */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0b2a4a] via-[#0f141a] to-[#0e6b5c] opacity-90 dark:opacity-100" />
        <div className="absolute -top-40 -right-40 h-[520px] w-[520px] rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-[520px] w-[520px] rounded-full bg-blue-500/20 blur-3xl" />

        <div
          className="absolute inset-0 opacity-[0.06] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.7' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='.4'/%3E%3C/svg%3E\")",
          }}
        />
      </div>

      {/* Card Principal */}
      <div className="relative z-10 w-full max-w-md">
        <div className="rounded-3xl border border-white/20 bg-white/85 backdrop-blur-xl shadow-2xl dark:bg-[#161b22]/80 dark:border-white/10 overflow-hidden">
          
          {/* Header com sua Logo */}
          <div className="px-8 pt-10 pb-6 text-center">
            <div className="flex items-center justify-center">
              <img
                src="/brand/logo-full-light.png"
                alt="UniGestor"
                className="h-12 w-auto select-none"
                draggable={false}
              />
            </div>

            <h1 className="mt-6 text-2xl font-bold text-slate-800 dark:text-white uppercase tracking-tight">
              Área do Cliente
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-white/60">
              Consulte suas faturas e dados de acesso.
            </p>
          </div>

          {/* Form de Acesso */}
          <div className="px-8 pb-10">
            <form onSubmit={handleAcesso} className="space-y-5">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-white/50 ml-1">
                  Seu WhatsApp
                </label>
                <input
                  type="text"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="55 (__) _____-____"
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-5 py-4 text-slate-900 outline-none transition focus:ring-2 focus:ring-emerald-500/60 dark:border-white/10 dark:bg-black/40 dark:text-white dark:placeholder:text-white/20"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-white/50 ml-1">
                  PIN de Segurança (4 dígitos)
                </label>
                <input
                  type="password"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="••••"
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-5 py-4 text-center text-2xl tracking-[0.5em] text-slate-900 outline-none transition focus:ring-2 focus:ring-emerald-500/60 dark:border-white/10 dark:bg-black/40 dark:text-white dark:placeholder:text-white/20"
                />
              </div>

              <button
                type="submit"
                disabled={!canSubmit}
                className={[
                  "w-full rounded-2xl py-4 font-bold text-lg transition shadow-lg",
                  !canSubmit
                    ? "bg-slate-300 text-white cursor-not-allowed dark:bg-white/10"
                    : "bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95 shadow-emerald-500/20",
                ].join(" ")}
              >
                Acessar Painel
              </button>

              {msg && (
                <div className="mt-2 text-center text-sm text-red-500 font-medium">
                  {msg}
                </div>
              )}
            </form>

            {/* Rodapé Interno */}
            <div className="mt-8 text-center">
               <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-white/30 bg-black/10 dark:bg-white/5 px-4 py-1.5 rounded-full border border-white/5">
                Conexão Criptografada
              </span>
            </div>
          </div>
        </div>

        {/* Créditos Final */}
        <div className="mt-8 text-center text-[11px] text-white/40 uppercase tracking-widest font-medium">
          UniGestor © {new Date().getFullYear()} • Todos os direitos reservados
        </div>
      </div>
    </div>
  );
}