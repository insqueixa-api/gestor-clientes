"use client";

import { useSearchParams } from "next/navigation";
import { useState, useEffect, useMemo } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import Image from "next/image";

// ========= TYPES =========
interface ClientAccount {
  id: string;
  display_name: string;
  server_username: string;
  server_name: string;
  screens: number;
  plan_label: string;
  vencimento: string;
  price_amount: number;
  price_currency: string;
  plan_table_id: string;
  is_trial: boolean;
  is_archived: boolean;
}

interface PlanPrice {
  period: string;
  price_amount: number;
}

interface SessionData {
  tenant_id: string;
  whatsapp_username: string;
}

const PERIOD_LABELS: Record<string, string> = {
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
};

const PERIOD_MONTHS: Record<string, number> = {
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

// ========= HELPERS =========
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function formatMoney(amount: number, currency: string = "BRL") {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(amount);
}

function getTimeRemaining(vencimento: string) {
  const now = new Date();
  const due = new Date(vencimento);
  const diff = due.getTime() - now.getTime();

  if (diff <= 0) return { expired: true, text: "Vencido" };

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return { expired: false, text: `${days} dia${days > 1 ? "s" : ""}` };
  return { expired: false, text: `${hours}h ${minutes}min` };
}

function formatDateTime(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function calculateDiscount(monthlyPrice: number, totalPrice: number, months: number) {
  const monthlyEquivalent = totalPrice / months;
  const discount = ((monthlyPrice - monthlyEquivalent) / monthlyPrice) * 100;
  return Math.round(discount * 10) / 10; // 1 casa decimal
}

// ========= MAIN COMPONENT =========
export default function RenewClient() {
  const sp = useSearchParams();
  const session = useMemo(() => (sp.get("session") ?? "").trim(), [sp]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [accounts, setAccounts] = useState<ClientAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [prices, setPrices] = useState<PlanPrice[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>("MONTHLY");

  // ========= LOAD SESSION & ACCOUNTS =========
  useEffect(() => {
    async function loadData() {
      if (!session) {
        setError("Sessão inválida");
        setLoading(false);
        return;
      }

      try {
        // 1. Validar sessão
        const { data: sessionResult, error: sessionErr } = await supabaseBrowser.rpc(
          "portal_resolve_token",
          { p_token: session }
        );

        if (sessionErr || !sessionResult) {
          throw new Error("Sessão expirada ou inválida");
        }

        const sess = sessionResult as any;
        setSessionData({
          tenant_id: sess.tenant_id,
          whatsapp_username: sess.whatsapp_username,
        });

        // 2. Buscar contas do cliente
        const { data: accountsData, error: accountsErr } = await supabaseBrowser
          .from("clients")
          .select(`
            id,
            display_name,
            server_username,
            server_id,
            servers (name),
            screens,
            plan_label,
            vencimento,
            price_amount,
            price_currency,
            plan_table_id,
            is_trial,
            is_archived
          `)
          .eq("tenant_id", sess.tenant_id)
          .eq("whatsapp_username", sess.whatsapp_username)
          .order("is_trial", { ascending: true })
          .order("vencimento", { ascending: false });

        if (accountsErr) throw accountsErr;

        const mapped: ClientAccount[] = (accountsData || []).map((acc: any) => ({
          id: acc.id,
          display_name: acc.display_name || "Sem nome",
          server_username: acc.server_username || "",
          server_name: acc.servers?.name || "Servidor",
          screens: acc.screens || 1,
          plan_label: acc.plan_label || "Mensal",
          vencimento: acc.vencimento,
          price_amount: acc.price_amount || 0,
          price_currency: acc.price_currency || "BRL",
          plan_table_id: acc.plan_table_id,
          is_trial: acc.is_trial || false,
          is_archived: acc.is_archived || false,
        }));

        setAccounts(mapped);

        // Se só tem 1 conta, seleciona automaticamente
        if (mapped.length === 1) {
          setSelectedAccountId(mapped[0].id);
        }

        setLoading(false);
      } catch (err: any) {
        console.error("Erro ao carregar dados:", err);
        setError(err.message || "Erro ao carregar dados");
        setLoading(false);
      }
    }

    loadData();
  }, [session]);

  // ========= LOAD PRICES WHEN ACCOUNT SELECTED =========
  useEffect(() => {
    async function loadPrices() {
      if (!selectedAccountId) return;

      const account = accounts.find((a) => a.id === selectedAccountId);
      if (!account || !account.plan_table_id) return;

      try {
        const { data, error } = await supabaseBrowser
          .from("plan_table_items")
          .select(`
            period,
            plan_table_item_prices (
              screens_count,
              price_amount
            )
          `)
          .eq("plan_table_id", account.plan_table_id);

        if (error) throw error;

        const pricesMap: PlanPrice[] = (data || []).map((item: any) => {
          const priceObj = item.plan_table_item_prices?.find(
            (p: any) => p.screens_count === account.screens
          );
          return {
            period: item.period,
            price_amount: priceObj?.price_amount || 0,
          };
        });

        setPrices(pricesMap);

        // Define período inicial baseado no plano atual
        const currentPeriod = Object.keys(PERIOD_LABELS).find(
          (k) => PERIOD_LABELS[k] === account.plan_label
        );
        if (currentPeriod) setSelectedPeriod(currentPeriod);
      } catch (err) {
        console.error("Erro ao carregar preços:", err);
      }
    }

    loadPrices();
  }, [selectedAccountId, accounts]);

  // ========= COMPUTED =========
  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId),
    [accounts, selectedAccountId]
  );

  const selectedPrice = useMemo(
    () => prices.find((p) => p.period === selectedPeriod),
    [prices, selectedPeriod]
  );

  const monthlyPrice = useMemo(
    () => prices.find((p) => p.period === "MONTHLY"),
    [prices]
  );

  const discount = useMemo(() => {
    if (!monthlyPrice || !selectedPrice || selectedPeriod === "MONTHLY") return 0;
    const months = PERIOD_MONTHS[selectedPeriod];
    return calculateDiscount(monthlyPrice.price_amount, selectedPrice.price_amount, months);
  }, [monthlyPrice, selectedPrice, selectedPeriod]);

  const timeRemaining = useMemo(() => {
    if (!selectedAccount) return null;
    return getTimeRemaining(selectedAccount.vencimento);
  }, [selectedAccount]);

  // ========= HANDLERS =========
  const handleSelectAccount = (accountId: string) => {
    setSelectedAccountId(accountId);
  };

  const handleRenew = async () => {
    if (!selectedAccount || !selectedPrice) return;

    // TODO: Integração com gateway de pagamento (amanhã)
    alert("Integração com pagamento será implementada em breve!");
  };

  // ========= RENDER: LOADING =========
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-[#0a0f1a] dark:via-[#0d1321] dark:to-[#0f1629]">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600 dark:text-white/60">Carregando...</p>
        </div>
      </div>
    );
  }

  // ========= RENDER: ERROR =========
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-[#0a0f1a] dark:via-[#0d1321] dark:to-[#0f1629] p-4">
        <div className="max-w-md w-full bg-white dark:bg-[#161b22] rounded-2xl shadow-2xl p-8 text-center border border-red-200 dark:border-red-500/20">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-red-500 mb-2">Sessão Inválida</h1>
          <p className="text-slate-500 dark:text-white/60">{error}</p>
        </div>
      </div>
    );
  }

  // ========= RENDER: ACCOUNT SELECTOR =========
  if (!selectedAccountId && accounts.length > 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-[#0a0f1a] dark:via-[#0d1321] dark:to-[#0f1629] p-4 py-8">
        <div className="max-w-2xl mx-auto">
          {/* Header com Logo */}
          <div className="text-center mb-8">
            <div className="inline-block bg-white dark:bg-[#161b22] rounded-2xl p-4 shadow-lg mb-4">
              <Image
                src="/logo.svg"
                alt="Logo"
                width={120}
                height={40}
                className="dark:invert"
              />
            </div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">
              {getGreeting()}! 👋
            </h1>
            <p className="text-slate-600 dark:text-white/60">
              Selecione a conta que deseja gerenciar
            </p>
          </div>

          {/* Lista de Contas */}
          <div className="space-y-3">
            {accounts.map((account) => {
              const time = getTimeRemaining(account.vencimento);
              return (
                <button
                  key={account.id}
                  onClick={() => handleSelectAccount(account.id)}
                  className="w-full bg-white dark:bg-[#161b22] rounded-xl p-4 border-2 border-slate-200 dark:border-white/10 hover:border-blue-500 dark:hover:border-blue-500 transition-all shadow-lg hover:shadow-xl group"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-left flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-bold text-slate-800 dark:text-white">
                          {account.display_name}
                        </h3>
                        {account.is_trial && (
                          <span className="px-2 py-0.5 bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 text-xs font-bold rounded">
                            TESTE
                          </span>
                        )}
                        {account.is_archived && (
                          <span className="px-2 py-0.5 bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-white/60 text-xs font-bold rounded">
                            ARQUIVADO
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-500 dark:text-white/50">
                        {account.server_name} • {account.screens} tela{account.screens > 1 ? "s" : ""}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-white/40 mt-1">
                        {account.server_username}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-bold mb-1 ${time?.expired ? "text-red-500" : "text-emerald-500"}`}>
                        {time?.text}
                      </div>
                      <div className="text-xs text-slate-400 dark:text-white/40">
                        {account.plan_label}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ========= RENDER: NO ACCOUNTS =========
  if (accounts.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-[#0a0f1a] dark:via-[#0d1321] dark:to-[#0f1629] p-4">
        <div className="max-w-md w-full bg-white dark:bg-[#161b22] rounded-2xl shadow-2xl p-8 text-center">
          <p className="text-slate-500 dark:text-white/60">Nenhuma conta encontrada</p>
        </div>
      </div>
    );
  }

  // ========= RENDER: MAIN PAGE =========
  if (!selectedAccount) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-[#0a0f1a] dark:via-[#0d1321] dark:to-[#0f1629] p-4 py-8">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header com Logo */}
        <div className="text-center">
          <div className="inline-block bg-white dark:bg-[#161b22] rounded-2xl p-4 shadow-lg mb-4">
            <Image
              src="/logo.svg"
              alt="Logo"
              width={120}
              height={40}
              className="dark:invert"
            />
          </div>
        </div>

        {/* Saudação */}
        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-2xl p-6 text-white shadow-xl">
          <h1 className="text-2xl font-bold mb-2">
            {getGreeting()}, {selectedAccount.display_name}! 👋
          </h1>
          <p className="text-blue-100">
            {selectedAccount.is_trial
              ? "Você está no período de teste. Renove agora e garanta seu acesso contínuo!"
              : "Mantenha sua assinatura em dia e continue aproveitando nossos serviços!"}
          </p>
        </div>

        {/* Botão Voltar (se tem múltiplas contas) */}
        {accounts.length > 1 && (
          <button
            onClick={() => setSelectedAccountId(null)}
            className="flex items-center gap-2 text-sm text-slate-600 dark:text-white/60 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Trocar de conta
          </button>
        )}

        {/* Card de Dados */}
        <div className="bg-white dark:bg-[#161b22] rounded-2xl shadow-xl border border-slate-200 dark:border-white/10 overflow-hidden">
          <div className="bg-gradient-to-r from-slate-50 to-blue-50 dark:from-white/5 dark:to-blue-500/5 px-6 py-4 border-b border-slate-200 dark:border-white/10">
            <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
              📺 Dados de Acesso
            </h2>
          </div>

          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider block mb-1">
                  Usuário
                </label>
                <div className="text-sm font-mono text-slate-800 dark:text-white bg-slate-50 dark:bg-black/20 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10">
                  {selectedAccount.server_username}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider block mb-1">
                  Servidor
                </label>
                <div className="text-sm font-medium text-slate-800 dark:text-white bg-slate-50 dark:bg-black/20 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10">
                  {selectedAccount.server_name}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider block mb-1">
                  Telas
                </label>
                <div className="text-sm font-bold text-slate-800 dark:text-white bg-slate-50 dark:bg-black/20 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10">
                  {selectedAccount.screens} {selectedAccount.screens > 1 ? "telas" : "tela"}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider block mb-1">
                  Plano Atual
                </label>
                <div className="text-sm font-bold text-slate-800 dark:text-white bg-slate-50 dark:bg-black/20 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10">
                  {selectedAccount.plan_label}
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider block mb-1">
                Vencimento
              </label>
              <div className="flex items-center justify-between bg-slate-50 dark:bg-black/20 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10">
                <span className="text-sm font-medium text-slate-800 dark:text-white">
                  {formatDateTime(selectedAccount.vencimento)}
                </span>
                {timeRemaining && (
                  <span className={`text-xs font-bold px-2 py-1 rounded ${timeRemaining.expired ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"}`}>
                    {timeRemaining.text}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Seletor de Plano */}
        <div className="bg-white dark:bg-[#161b22] rounded-2xl shadow-xl border border-slate-200 dark:border-white/10 overflow-hidden">
          <div className="bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-500/5 dark:to-green-500/5 px-6 py-4 border-b border-slate-200 dark:border-white/10">
            <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
              💰 Escolha seu Plano
            </h2>
          </div>

          <div className="p-6 space-y-3">
            {prices.map((price) => {
              const months = PERIOD_MONTHS[price.period];
              const isMonthly = price.period === "MONTHLY";
              const monthlyRef = monthlyPrice?.price_amount || price.price_amount;
              const discountPercent = isMonthly ? 0 : calculateDiscount(monthlyRef, price.price_amount, months);
              const isSelected = selectedPeriod === price.period;

              return (
                <button
                  key={price.period}
                  onClick={() => setSelectedPeriod(price.period)}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all ${isSelected ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10" : "border-slate-200 dark:border-white/10 hover:border-emerald-300 dark:hover:border-emerald-500/50"}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${isSelected ? "border-emerald-500 bg-emerald-500" : "border-slate-300 dark:border-white/20"}`}>
                          {isSelected && (
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                        <span className="font-bold text-slate-800 dark:text-white">
                          {PERIOD_LABELS[price.period]}
                        </span>
                        {discountPercent > 0 && (
                          <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-bold rounded">
                            {discountPercent}% OFF
                          </span>
                        )}
                      </div>
                      {!isMonthly && (
                        <p className="text-xs text-slate-500 dark:text-white/50 mt-1">
                          {formatMoney(price.price_amount / months)}/mês
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold text-slate-800 dark:text-white">
                        {formatMoney(price.price_amount)}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Botão de Renovação */}
        <button
          onClick={handleRenew}
          disabled={!selectedPrice}
          className="w-full bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white font-bold py-4 rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Renovar Agora • {selectedPrice ? formatMoney(selectedPrice.price_amount) : "—"}
        </button>
      </div>
    </div>
  );
}
