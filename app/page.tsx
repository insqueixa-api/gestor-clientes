"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js"; // Importe o cliente do Supabase

// Inicializa o Supabase para consulta rápida
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function AreaDoCliente() {
  const [whatsapp, setWhatsapp] = useState("");
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<{ text: string; type: "error" | "success" } | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const cleanPhone = useMemo(() => whatsapp.replace(/\D/g, ""), [whatsapp]);

  const canSubmit = useMemo(() => {
    return cleanPhone.length >= 10 && pin.length === 4;
  }, [cleanPhone, pin]);

  // Função para redirecionar ao Painel
  async function handleAcesso(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    router.push(`/renew/${cleanPhone}?pin=${pin}`);
  }

  // NOVA FUNÇÃO: Validar cliente e enviar PIN via WhatsApp
  async function handleLembrarPin() {
    if (cleanPhone.length < 10) {
      setMsg({ text: "Digite seu WhatsApp completo primeiro.", type: "error" });
      return;
    }

    setLoading(true);
    setMsg(null);

    try {
      // 1. Verifica se o cliente existe no banco
      const { data, error } = await supabase
        .from("clients")
        .select("whatsapp, access_pin")
        .eq("whatsapp", cleanPhone)
        .single();

      if (error || !data) {
        setMsg({ text: "Cliente não encontrado.", type: "error" });
        return;
      }

      // 2. Chama sua API interna para enviar a mensagem
      const response = await fetch("/api/whatsapp/send-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cleanPhone }),
      });

      const resData = await response.json();

      if (response.ok) {
        setMsg({ text: "PIN enviado para seu WhatsApp!", type: "success" });
      } else {
        throw new Error(resData.error || "Erro desconhecido");
      }

    } catch (err) {
      setMsg({ text: "Erro ao enviar mensagem. Tente mais tarde.", type: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center px-6 py-10 bg-slate-50 dark:bg-[#0f141a]">
      {/* Fundo com gradiente */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0b2a4a] via-[#0f141a] to-[#0e6b5c] opacity-90 dark:opacity-100" />
        <div className="absolute -top-40 -right-40 h-[520px] w-[520px] rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-[520px] w-[520px] rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.06] mix-blend-overlay" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.7' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='.4'/%3E%3C/svg%3E\")" }} />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="rounded-3xl border border-white/20 bg-white/85 backdrop-blur-xl shadow-2xl dark:bg-[#161b22]/80 dark:border-white/10 overflow-hidden">
          
          <div className="px-8 pt-10 pb-6 text-center">
            <div className="flex items-center justify-center">
              <img src="/brand/logo-full-light.png" alt="UniGestor" className="h-12 w-auto select-none" />
            </div>
            <h1 className="mt-6 text-2xl font-bold text-slate-800 dark:text-white uppercase tracking-tight">Área do Cliente</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-white/60">Consulte suas faturas e dados de acesso.</p>
          </div>

          <div className="px-8 pb-10">
            <form onSubmit={handleAcesso} className="space-y-5">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-white/50 ml-1">Seu WhatsApp</label>
                <input
                  type="text"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="55 (__) _____-____"
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-5 py-4 text-slate-900 outline-none transition focus:ring-2 focus:ring-emerald-500/60 dark:border-white/10 dark:bg-black/40 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-white/50 ml-1">PIN de Segurança (4 dígitos)</label>
                <input
                  type="password"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••"
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-5 py-4 text-center text-2xl tracking-[0.5em] text-slate-900 outline-none transition focus:ring-2 focus:ring-emerald-500/60 dark:border-white/10 dark:bg-black/40 dark:text-white"
                />
              </div>

              <div className="space-y-3">
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className={`w-full rounded-2xl py-4 font-bold text-lg transition shadow-lg ${!canSubmit ? "bg-slate-300 text-white cursor-not-allowed dark:bg-white/10" : "bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95 shadow-emerald-500/20"}`}
                >
                  Acessar Painel
                </button>

                <button
                  type="button"
                  onClick={handleLembrarPin}
                  disabled={loading}
                  className="w-full text-xs font-bold text-slate-500 dark:text-emerald-500/70 hover:text-emerald-500 uppercase tracking-widest transition-colors py-2"
                >
                  {loading ? "Verificando..." : "Esqueci meu PIN (Enviar via WhatsApp)"}
                </button>
              </div>

              {msg && (
                <div className={`mt-2 text-center text-sm font-bold ${msg.type === "error" ? "text-red-500" : "text-emerald-500"}`}>
                  {msg.text}
                </div>
              )}
            </form>

            <div className="mt-8 text-center">
               <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-white/30 bg-black/10 dark:bg-white/5 px-4 py-1.5 rounded-full border border-white/5">
                Conexão Criptografada
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}