"use client";

import { useState, use, useEffect } from "react";
// Opcional: importe o supabaseBrowser para buscar os dados futuramente
// import { supabaseBrowser } from "@/lib/supabase/browser";

export default function PagamentoClientePage({
  params,
}: {
  params: Promise<{ whatsapp: string }>;
}) {
  // Desempacota os parâmetros da URL
  const { whatsapp } = use(params);

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  // Pega os 4 últimos dígitos do telefone vindo da URL para usar como senha
  const last4Digits = whatsapp.slice(-4);

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === last4Digits) {
      setIsUnlocked(true);
      setError("");
      // FUTURO: Aqui você chamará o Supabase para carregar os dados reais da fatura
    } else {
      setError("Senha incorreta. Tente novamente.");
    }
  };

  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center border border-slate-100">
          <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-4">
            🔒
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Área Restrita</h1>
          <p className="text-sm text-slate-500 mb-6">
            Para acessar os detalhes da sua fatura e renovação, digite os <strong>4 últimos dígitos do seu celular</strong>.
          </p>

          <form onSubmit={handleUnlock} className="space-y-4">
            <div>
              <input
                type="text"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="Ex: 8888"
                className="w-32 h-14 text-center text-2xl tracking-widest font-bold border-2 border-slate-200 rounded-xl focus:border-blue-500 outline-none transition-colors"
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-red-500 font-bold">{error}</p>}
            
            <button
              type="submit"
              className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors"
            >
              Acessar Fatura
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- ÁREA DESBLOQUEADA (Esqueleto da Fatura) ---
  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
        {/* Header Fatura */}
        <div className="bg-emerald-600 p-6 text-white text-center">
          <h1 className="text-2xl font-bold">Renovação de Assinatura</h1>
          <p className="opacity-80 mt-1">Status: Aguardando Pagamento</p>
        </div>

        {/* Dados do Cliente */}
        <div className="p-6 border-b border-slate-100 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-400 font-bold uppercase">Plano</p>
              <p className="text-slate-800 font-medium">Painel Master VIP</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-bold uppercase">Vencimento</p>
              <p className="text-slate-800 font-medium text-rose-500">10/02/2026</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-bold uppercase">Usuário</p>
              <p className="text-slate-800 font-mono">joao.silva</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-bold uppercase">Valor</p>
              <p className="text-emerald-600 font-bold text-lg">R$ 40,00</p>
            </div>
          </div>
        </div>

        {/* Área de Pagamento (Futuro PIX API) */}
        <div className="p-6 bg-slate-50 text-center">
          <h2 className="text-lg font-bold text-slate-800 mb-4">Pagamento via PIX</h2>
          <div className="w-48 h-48 bg-white border-2 border-dashed border-slate-300 mx-auto flex items-center justify-center text-slate-400 rounded-xl mb-4">
            [QR CODE PIX]
          </div>
          <button className="px-6 py-3 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl transition-colors">
            Copiar Código PIX
          </button>
        </div>
      </div>
    </div>
  );
}