"use client";
import { useState, use, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// Inicializa o Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function PagamentoClientePage({
  params,
}: {
  params: Promise<{ whatsapp: string }>;
}) {
  const { whatsapp } = use(params);
  
  // Estados
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [clientData, setClientData] = useState<any>(null);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // BLINDAGEM: Verifica se existe o cliente com esse WhatsApp E se os 4 últimos dígitos batem com o PIN digitado
      // Nota: Se você criou a coluna 'access_pin', mude de 'whatsapp.slice(-4)' para buscar 'access_pin'
      const { data, error: sbError } = await supabase
        .from("clients")
        .select("*")
        .eq("whatsapp", whatsapp)
        .single();

      if (sbError || !data) {
        setError("Cliente não encontrado.");
        setLoading(false);
        return;
      }

      // Validação: Se você ainda não usa a coluna access_pin, usamos os 4 últimos dígitos do número do banco
      const validPin = data.access_pin || data.whatsapp.slice(-4);

      if (pin === validPin) {
        setClientData(data);
        setIsUnlocked(true);
      } else {
        setError("PIN incorreto. Tente os 4 últimos dígitos do seu celular.");
      }
    } catch (err) {
      setError("Erro ao validar acesso.");
    } finally {
      setLoading(false);
    }
  };

  // --- TELA DE BLOQUEIO (PIN) ---
  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-[#0f141a] flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#161b22] rounded-3xl shadow-2xl p-8 text-center border border-white/10">
          <div className="w-20 h-20 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center text-4xl mx-auto mb-6 border border-emerald-500/20">
            🔒
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Área do Cliente</h1>
          <p className="text-sm text-slate-400 mb-8">
            Para sua segurança, digite os <strong>4 últimos dígitos</strong> do seu WhatsApp para visualizar a fatura.
          </p>

          <form onSubmit={handleUnlock} className="space-y-6">
            <div className="flex justify-center">
              <input
                type="text"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="0000"
                className="w-40 h-16 text-center text-3xl tracking-[0.3em] font-black bg-black/40 border-2 border-white/10 text-emerald-500 rounded-2xl focus:border-emerald-500 outline-none transition-all"
                autoFocus
              />
            </div>
            
            {error && <p className="text-sm text-red-400 font-medium animate-pulse">{error}</p>}
            
            <button
              type="submit"
              disabled={loading || pin.length < 4}
              className="w-full h-14 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white font-bold rounded-2xl transition-all shadow-lg shadow-emerald-600/20"
            >
              {loading ? "Verificando..." : "ACESSAR FATURA"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- ÁREA DESBLOQUEADA (DADOS REAIS DO SUPABASE) ---
  return (
    <div className="min-h-screen bg-[#0f141a] p-4 sm:p-8 text-white">
      <div className="max-w-2xl mx-auto bg-[#161b22] rounded-3xl shadow-2xl border border-white/10 overflow-hidden">
        
        {/* Header Dinâmico */}
        <div className="bg-emerald-600 p-8 text-center">
          <h1 className="text-2xl font-black uppercase tracking-tight">Fatura de Renovação</h1>
          <p className="opacity-90 mt-1 font-medium">Olá, {clientData?.name || "Cliente"}</p>
        </div>

        {/* Dados Reais do Banco */}
        <div className="p-8 border-b border-white/5 space-y-6">
          <div className="grid grid-cols-2 gap-8">
            <div>
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Plano Ativo</p>
              <p className="text-lg font-bold text-white">{clientData?.plan_name || "Plano Standard"}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Vencimento</p>
              <p className="text-lg font-bold text-rose-500">{clientData?.due_date || "Hoje"}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Login de Acesso</p>
              <p className="text-lg font-mono text-slate-300">{clientData?.username || "---"}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Valor da Renovação</p>
              <p className="text-2xl font-black text-emerald-500">R$ {clientData?.price || "0,00"}</p>
            </div>
          </div>
        </div>

        {/* Área de Pagamento */}
        <div className="p-8 bg-black/20 text-center">
          <h2 className="text-lg font-bold mb-6 text-slate-300">Pagamento via PIX Automático</h2>
          
          <div className="w-56 h-56 bg-white p-2 mx-auto rounded-2xl mb-6 shadow-inner flex items-center justify-center">
            {/* Aqui você pode colocar a URL do QR Code da sua API de PIX se tiver */}
            <span className="text-black text-[10px] font-bold">QR CODE DISPONÍVEL APÓS GERAÇÃO</span>
          </div>

          <button className="w-full py-4 bg-white text-black hover:bg-slate-200 font-black rounded-2xl transition-all active:scale-95 shadow-xl">
            COPIAR CÓDIGO PIX
          </button>
          
          <p className="mt-4 text-[10px] text-slate-500 uppercase font-bold tracking-widest">
            A liberação é automática após o pagamento
          </p>
        </div>
      </div>
    </div>
  );
}