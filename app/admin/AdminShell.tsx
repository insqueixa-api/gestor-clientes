"use client";

import Link from "next/link";
import Image from "next/image";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePathname } from "next/navigation";
import React from "react";
import SaasProfileRenewModal from "./settings/profile/SaasProfileRenewModal";
import { useModules } from "@/lib/modules/ModulesContext";

// Pega a data de hoje no Brasil formatada de forma zerada e segura
function getHojeSP(): Date {
  const spStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); // Retorna "YYYY-MM-DD"
  const [y, m, d] = spStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Extrai o ano, mês e dia da string ignorando letras T e fusos horários
function getTargetDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isOverdue(vencimentoIso?: string | null): boolean {
  if (!vencimentoIso) return false;
  return getTargetDate(vencimentoIso) < getHojeSP();
}

function daysUntil(s?: string | null): number | null {
  if (!s) return null;
  const diffTime = getTargetDate(s).getTime() - getHojeSP().getTime();
  return Math.round(diffTime / 86400000);
}

function BrandUser({ userLabel, tenantName, logoUrl }: { userLabel: string; tenantName: string; logoUrl?: string | null }) {
  return (
    <div className="flex items-center gap-3 min-w-0 text-white cursor-pointer group">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={tenantName}
          className="h-10 w-auto max-w-[140px] select-none object-contain transition-transform group-hover:scale-105 drop-shadow-md"
          draggable={false}
        />
      ) : (
        <>
          <Image
            src="/brand/logo-gestor-celular.png"
            alt="Gestor"
            width={44}
            height={44}
            className="h-10 w-10 select-none object-contain sm:hidden transition-transform group-hover:scale-105"
            draggable={false}
            priority
          />
          <Image
            src="/brand/logo-gestor.png"
            alt="Gestor"
            width={160}
            height={40}
            className="hidden sm:block h-10 w-auto select-none object-contain transition-transform group-hover:scale-105"
            draggable={false}
            priority
          />
        </>
      )}
      <div className="min-w-0 flex flex-col justify-center">
        <div className="text-[10px] uppercase tracking-wider text-white/40 font-bold leading-none mb-0.5 group-hover:text-white/60 transition-colors">
          Logado como
        </div>
        <div className="text-xs font-bold text-white truncate max-w-50 sm:max-w-66 tracking-tight group-hover:text-emerald-400 transition-colors uppercase">
          {userLabel}
        </div>
      </div>
    </div>
  );
}

// Estrutura das notificações
type Notification = {
  id: string;
  title: string;
  message: string;
  link: string; // Para onde ir ao clicar
  type: 'warning' | 'error' | 'info' | 'whatsapp'; // Para estilizar ou filtrar
  data?: any; // Dados extras
  is_read: boolean;
  created_at: string;
};

export default function AdminShell({
  children,
  userLabel,
  tenantName,
  role,
  financialControlEnabled,
  tenantId,
  expiresAt,
  creditBalance,
  saasPlanTableId,
  whatsappSessions,
  logoUrl,
}: {
  children: React.ReactNode;
  userLabel: string;
  tenantName: string;
  role: string;
  financialControlEnabled?: boolean;
  tenantId?: string;
  expiresAt?: string | null;
  creditBalance?: number;
  saasPlanTableId?: string | null;
  whatsappSessions?: number;
  logoUrl?: string | null;
}) {
  const {
    can,
    isOnlyFinanceiro,
    hasIPTVorSaaS,
    hasAlunos,
    hasSaaS,
  } = useModules();

  const [openMenu, setOpenMenu] = useState<null | "manager" | "settings" | "mobile">(null);
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [localExpiresAt, setLocalExpiresAt] = useState<string | null>(expiresAt ?? null);
  const [waDisconnected, setWaDisconnected] = useState(false);
  const [showWaModal, setShowWaModal] = useState(false);

  // Estados para notificações
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null); // Para o modal de detalhes

  // unreadCount
  const unreadCount = useMemo(() => notifications.filter(n => !n.is_read).length, [notifications]);

  useEffect(() => {
    if (!whatsappSessions || whatsappSessions < 1 || role === "SUPERADMIN") return;

    async function checkWaSessions() {
      try {
        const [r1, r2] = await Promise.all([
          fetch("/api/whatsapp/status", { cache: "no-store" }).then(r => r.json()).catch(() => ({})),
          whatsappSessions! >= 2
            ? fetch("/api/whatsapp/status2", { cache: "no-store" }).then(r => r.json()).catch(() => ({}))
            : Promise.resolve({ connected: true }),
        ]);
        setWaDisconnected(!r1.connected && !r2.connected);
      } catch {
        // silencioso
      }
    }

    void checkWaSessions();
    const interval = setInterval(checkWaSessions, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [whatsappSessions, role]);

  // useEffect para carregar notificações reais e financeiras
  useEffect(() => {
    const loadNotifications = async () => {
      const list: Notification[] = [];
      const nowIso = new Date().toISOString();
      // ✅ Data exata de HOJE no Brasil (formato YYYY-MM-DD) para usar na busca
      const dataAtualSP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

      // 1. Notificação de vencimento do painel
      const dias = daysUntil(localExpiresAt);
      if (dias !== null && dias <= 7) {
        list.push({
          id: 'expires_at',
          title: dias <= 0 ? '⚠️ PAINEL VENCIDO' : '📢 Aviso de Vencimento',
          message: dias <= 0 ? `Seu painel venceu há ${Math.abs(dias)} dia(s).` : `Seu painel vence em ${dias} dia(s). Renove agora.`,
          link: '/admin/settings/profile',
          type: 'warning',
          is_read: false,
          created_at: nowIso,
        });
      }

      // 2. Notificação de WhatsApp
      if (waDisconnected && role !== "SUPERADMIN") {
        list.push({
          id: 'whatsapp_disconnected',
          title: '📵 WhatsApp Desconectado',
          message: 'Reconecte para retomar o envio de mensagens.',
          link: '/admin/settings/profile',
          type: 'whatsapp',
          is_read: false,
          created_at: nowIso,
        });
      }

      // 3. Monitoramento Financeiro (Vence hoje ou Vencido)
      if (financialControlEnabled && tenantId) {
        try {
          const { data: transacoes, error } = await supabaseBrowser
            .from("fin_transacoes")
            .select("id, descricao, valor, data_vencimento, tipo")
            .eq("status", "PENDENTE")
            .lte("data_vencimento", dataAtualSP); // ✅ Puxa corretamente baseado no dia do Brasil

          if (!error && transacoes) {
            transacoes.forEach(t => {
              const vencido = isOverdue(t.data_vencimento);
              const diasAtrasoRaw = daysUntil(t.data_vencimento + 'T12:00:00');
              const diasAtraso = diasAtrasoRaw !== null ? Math.abs(diasAtrasoRaw) : 0;
              const dataFormatada = t.data_vencimento.split('-').reverse().join('/');

              const icone = t.tipo === "RECEITA" ? "📈" : "📉";
              const tituloTipo = t.tipo === "RECEITA" ? "Recebimento" : "Pagamento";
              const valorFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(t.valor);
              
              let titleNotif = "";
              let messageNotif = "";
              
              if (vencido) {
                titleNotif = `🟥 ${tituloTipo} Vencido`;
                messageNotif = `${icone} ${t.descricao} - ${valorFmt}. Vencido há ${diasAtraso} dia(s) (${dataFormatada}).`;
              } else {
                titleNotif = `🟧 ${tituloTipo} Vence Hoje`;
                messageNotif = `${icone} ${t.descricao} - ${valorFmt}. Pendente para hoje (${dataFormatada}).`;
              }

              list.push({
                id: `fin_${t.id}`,
                title: titleNotif,
                message: messageNotif,
                link: '/admin/settings/financeiro_pessoal',
                type: vencido ? 'error' : 'warning',
                is_read: false,
                created_at: nowIso,
                data: { transacaoId: t.id }
              });
            });
          }
        } catch (e) {
          console.error("Erro ao buscar notificações financeiras:", e);
        }
      }

      // 4. Monitoramento de Renovações Manuais (Sem integração ou Elite)
      if ((hasIPTVorSaaS || hasAlunos) && tenantId) {
        try {
          const { data: pendingManual, error: manualErr } = await supabaseBrowser
            .from("client_portal_payments")
            .select("id, created_at")
            .eq("tenant_id", tenantId)
            .eq("fulfillment_status", "manual_pending");

          if (!manualErr && pendingManual) {
            pendingManual.forEach(p => {
              list.push({
                id: `manual_${p.id}`,
                title: '🟣 Ação Necessária',
                message: 'Um pagamento foi aprovado e aguarda liberação manual no servidor.',
                link: '/admin/auditoria',
                type: 'info', 
                is_read: false,
                created_at: p.created_at || nowIso,
              });
            });
          }
        } catch (e) {
          console.error("Erro ao buscar renovações pendentes:", e);
        }
      }

      // 5. Monitoramento de Falha no WhatsApp
      if ((hasIPTVorSaaS || hasAlunos) && tenantId) {
        try {
          const { data: failedWa, error: waErr } = await supabaseBrowser
            .from("client_portal_payments")
            .select("id, created_at")
            .eq("tenant_id", tenantId)
            .eq("whatsapp_status", "error")
            .in("fulfillment_status", ["done", "manual_done"]);

          if (!waErr && failedWa) {
            failedWa.forEach(p => {
              list.push({
                id: `wa_err_${p.id}`,
                title: '💬 Falha no WhatsApp',
                message: 'Uma recarga foi efetuada, mas o envio do comprovante pelo WhatsApp falhou. Reenvie pela Auditoria.',
                link: '/admin/auditoria',
                type: 'error', // Destaca a falha em vermelho
                is_read: false,
                created_at: p.created_at || nowIso,
              });
            });
          }
        } catch (e) {
          console.error("Erro ao buscar falhas de whatsapp:", e);
        }
      }

      // ✅ Busca na memória do navegador os IDs que você já ocultou e filtra a lista
      const dismissed = JSON.parse(localStorage.getItem("dismissed_notifs") || "[]");
      const filteredList = list.filter(n => !dismissed.includes(n.id));

      setNotifications(filteredList);
    };

    loadNotifications();
  }, [localExpiresAt, waDisconnected, role, financialControlEnabled, tenantId, hasIPTVorSaaS, hasAlunos]); // ✅ Dependências atualizadas

  const managerRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const mobileRef = useRef<HTMLDivElement>(null);

  const [managerPos, setManagerPos] = useState<{ top: number; right: number } | null>(null);
  const [settingsPos, setSettingsPos] = useState<{ top: number; right: number } | null>(null);
  const [mobilePos, setMobilePos] = useState<{ top: number; right: number } | null>(null);

  const pathname = usePathname();

const managerActive = useMemo(() => {
    return (
      pathname.startsWith("/admin/servers") ||
      pathname.startsWith("/admin/plano") ||
      pathname.startsWith("/admin/mensagem") ||
      pathname.startsWith("/admin/cobranca") ||
      pathname.startsWith("/admin/pagamento") ||
      pathname.startsWith("/admin/aplicativo")
    );
  }, [pathname]);

  const alunoActive = pathname.startsWith("/admin/aluno");

  const settingsActive = useMemo(() => pathname.startsWith("/admin/settings"), [pathname]);

  function openManager() {
    if (openMenu === "manager") { setOpenMenu(null); return; }
    const btn = managerRef.current?.querySelector("button");
    if (btn) {
      const r = (btn as HTMLButtonElement).getBoundingClientRect();
      setManagerPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }
    setOpenMenu("manager");
  }

  function openSettings() {
    if (openMenu === "settings") { setOpenMenu(null); return; }
    const btn = settingsRef.current?.querySelector("button");
    if (btn) {
      const r = (btn as HTMLButtonElement).getBoundingClientRect();
      setSettingsPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }
    setOpenMenu("settings");
  }

  function openMobileMenu() {
    if (openMenu === "mobile") { setOpenMenu(null); return; }
    const btn = mobileRef.current?.querySelector("button");
    if (btn) {
      const r = (btn as HTMLButtonElement).getBoundingClientRect();
      setMobilePos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }
    setOpenMenu("mobile");
  }

  // ✅ Limpa todas visualmente e grava na memória para não voltarem ao recarregar
  const clearAllNotifications = () => {
    const currentIds = notifications.map(n => n.id);
    const dismissed = JSON.parse(localStorage.getItem("dismissed_notifs") || "[]");
    const newDismissed = Array.from(new Set([...dismissed, ...currentIds]));
    localStorage.setItem("dismissed_notifs", JSON.stringify(newDismissed));
    setNotifications([]);
  };

  // ✅ Nova função para ocultar UMA notificação (Botão X)
  const handleDismiss = (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // Impede de abrir a notificação ao clicar no X
    const dismissed = JSON.parse(localStorage.getItem("dismissed_notifs") || "[]");
    if (!dismissed.includes(id)) {
      dismissed.push(id);
      localStorage.setItem("dismissed_notifs", JSON.stringify(dismissed));
    }
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  // Função de clique na notificação
  const handleNotificationClick = (n: Notification) => {
    setNotifications(prev => prev.map(noti => noti.id === n.id ? { ...noti, is_read: true } : noti));
    
    setShowNotificationsModal(false); // Fecha o painel de notificações
    
    if (n.id === 'expires_at') {
      setShowWarningModal(true);
    } else if (n.id === 'whatsapp_disconnected') {
      setShowWaModal(true);
    } else {
      window.location.href = n.link; // Leva para o financeiro ou outro local
    }
  };

  const canUseDom = typeof document !== "undefined";

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0f141a] text-slate-800 dark:text-white transition-colors duration-200">
      {/* TOP NAV */}
      <div className="sticky top-0 z-50 bg-[#050505] text-white border-b border-white/10 shadow-lg">
        <div className="mx-auto flex w-full max-w-screen-2xl items-center gap-2 px-2 sm:px-6 lg:px-8 py-2">

          <div className="flex items-center gap-4">
            <Link
              href="/admin"
              className="flex items-center gap-3 font-semibold min-w-0 hover:opacity-90 transition-opacity no-underline"
            >
              <BrandUser userLabel={userLabel} tenantName={tenantName} logoUrl={logoUrl} />
            </Link>

            {/* Novo Sininho Unificado */}
            <div className="relative">
              <button
                onClick={() => setShowNotificationsModal(true)}
                className={[
                  "flex items-center justify-center w-8 h-8 rounded-full border border-white/10 shadow-sm transition-colors",
                  unreadCount > 0 ? "bg-rose-500 hover:bg-rose-600 text-white" : "bg-white/5 hover:bg-white/10 text-white/60",
                ].join(" ")}
                title="Notificações"
              >
                <IconSininho className="w-5 h-5" />
              </button>
              {unreadCount > 0 && (
                <div className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-[10px] font-bold text-white shadow">
                  {unreadCount}
                </div>
              )}
            </div>

          </div>

          <div className="flex-1" />

          <nav className="flex items-center gap-1 text-sm whitespace-nowrap">

            {/* ── MOBILE ── */}
            <div className="flex items-center gap-1 sm:hidden">
              {isOnlyFinanceiro ? (
                <NavLink href="/admin/settings/financeiro_pessoal" label={<span className="flex items-center gap-1.5"><IconMenuFinanceiro /> Financeiro</span>} />
              ) : hasIPTVorSaaS ? (
                <NavLink href="/admin/cliente" label={<span className="flex items-center gap-1.5"><IconClientes /> Clientes</span>} />
              ) : hasAlunos ? (
                <NavLink href="/admin/aluno" label={<span className="flex items-center gap-1.5"><IconClientes /> Alunos</span>} />
              ) : (
                <NavLink href="/admin" label={<span className="flex items-center gap-1.5"><IconDashboard /> Dashboard</span>} />
              )}

              <div ref={mobileRef} className="relative">
                <button
                  onClick={openMobileMenu}
                  className={[
                    "rounded-lg px-3 py-2 text-sm transition-all duration-200 font-bold flex items-center gap-2 tracking-tight",
                    openMenu === "mobile" ? "bg-white/15 text-emerald-400" : "text-white/70 hover:text-white hover:bg-white/5",
                  ].join(" ")}
                >
                  <span className="text-base leading-none">☰</span> Menu{" "}
                  <span className={["transition-transform duration-200 text-[8px] opacity-40", openMenu === "mobile" ? "rotate-180" : ""].join(" ")}>▼</span>
                </button>
              </div>
            </div>

            {/* ── DESKTOP ── */}
            <div className="hidden sm:flex items-center gap-1">
              {isOnlyFinanceiro ? (
                <>
                  <NavLink href="/admin" label={<span className="flex items-center gap-1.5"><IconDashboard /> Dashboard</span>} />
                  <NavLink href="/admin/settings/financeiro_pessoal" label={<span className="flex items-center gap-1.5"><IconMenuFinanceiro /> Controle Financeiro</span>} />
                  <NavLink href="/admin/settings/profile" label={<span className="flex items-center gap-1.5"><IconMenuPerfil /> Perfil</span>} />
                  <div className="w-px h-6 bg-white/10 mx-2" />
                  <button onClick={() => window.location.href = "/logout"} className="rounded-lg px-3 py-2 text-sm transition-all duration-200 inline-flex items-center font-bold tracking-tight text-rose-400 hover:text-rose-300 hover:bg-rose-400/10 gap-1.5">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Sair
                  </button>
                </>
              ) : (
                <>
                  {can("dashboard")  && <NavLink href="/admin" label={<span className="flex items-center gap-1.5"><IconDashboard /> Dashboard</span>} />}
                  {hasIPTVorSaaS    && <NavLink href="/admin/cliente" label={<span className="flex items-center gap-1.5"><IconClientes /> Clientes</span>} />}
                  {hasAlunos        && <NavLink href="/admin/aluno" label={<span className="flex items-center gap-1.5"><IconClientes /> Alunos</span>} />}
                  
                  {/* Novo Menu de Auditoria - Visível apenas para quem tem Clientes/Alunos */}
                  {(hasIPTVorSaaS || hasAlunos) && (
                    <NavLink href="/admin/auditoria" label={<span className="flex items-center gap-1.5"><IconLog /> Log Portal</span>} />
                  )}

                  {can("revendas")  && <NavLink href="/admin/revendedor" label={<span className="flex items-center gap-1.5"><IconRevendas /> Revendas</span>} />}
                  {can("testes")    && <NavLink href="/admin/teste" label={<span className="flex items-center gap-1.5"><IconFastTimer /> Testes</span>} />}

                  <div className="w-px h-6 bg-white/10 mx-2" />

                  <div ref={managerRef} className="relative">
                    <button
                      onClick={openManager}
                      className={[
                        "rounded-lg px-3 py-2 text-sm transition-all duration-200 font-bold flex items-center gap-2 tracking-tight",
                        managerActive ? "bg-white/15 text-emerald-400" : "text-white/70 hover:text-white hover:bg-white/5",
                      ].join(" ")}
                    >
                      <span className="flex items-center gap-1.5"><IconGerenciador /> Gerenciador</span>{" "}
                      <span className={["transition-transform duration-200 text-[8px] opacity-40", openMenu === "manager" ? "rotate-180" : ""].join(" ")}>▼</span>
                    </button>
                  </div>

                  <div ref={settingsRef} className="relative">
                    <button
                      onClick={openSettings}
                      className={[
                        "rounded-lg px-3 py-2 text-sm transition-all duration-200 font-bold flex items-center gap-2 tracking-tight",
                        settingsActive ? "bg-white/15 text-emerald-400" : "text-white/70 hover:text-white hover:bg-white/5",
                      ].join(" ")}
                    >
                      <span className="flex items-center gap-1.5"><IconConta /> <span className="hidden sm:inline">Conta</span></span>{" "}
                      <span className={["transition-transform duration-200 text-[8px] opacity-40", openMenu === "settings" ? "rotate-180" : ""].join(" ")}>▼</span>
                    </button>
                  </div>
                </>
              )}
            </div>

          </nav>
        </div>
      </div>

      {/* ── DROPDOWN GERENCIADOR ── */}
      {canUseDom && openMenu === "manager" && managerPos &&
        createPortal(
          <DropdownPortal right={managerPos.right} top={managerPos.top} onClose={() => setOpenMenu(null)}>
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/30">Gestão</div>
            {can("servidores")  && <MenuLink href="/admin/gerenciador/servidor" label={<span className="flex items-center gap-2"><IconMenuServidor /> Servidores</span>} onClick={() => setOpenMenu(null)} />}
            {can("planos")      && <MenuLink href="/admin/gerenciador/plano" label={<span className="flex items-center gap-2"><IconMenuPlano /> Planos</span>} onClick={() => setOpenMenu(null)} />}
            {can("mensagens")   && <MenuLink href="/admin/gerenciador/mensagem" label={<span className="flex items-center gap-2"><IconMenuMensagens /> Mensagens</span>} onClick={() => setOpenMenu(null)} />}
            <Divider />
            {can("cobranca")    && <MenuLink href="/admin/gerenciador/cobranca" label={<span className="flex items-center gap-2"><IconMenuCobranca /> Automação de Cobrança</span>} onClick={() => setOpenMenu(null)} />}
            {can("pagamento")   && <MenuLink href="/admin/gerenciador/pagamento" label={<span className="flex items-center gap-2"><IconMenuPagamento /> Formas de pagamento</span>} onClick={() => setOpenMenu(null)} />}
            {can("aplicativos") && <MenuLink href="/admin/gerenciador/aplicativo" label={<span className="flex items-center gap-2"><IconMenuAplicativo /> Aplicativos</span>} onClick={() => setOpenMenu(null)} />}
          </DropdownPortal>,
          document.body
        )
      }

      {/* ── DROPDOWN MOBILE ── */}
      {canUseDom && openMenu === "mobile" && mobilePos &&
        createPortal(
          <DropdownPortal right={mobilePos.right} top={mobilePos.top} onClose={() => setOpenMenu(null)}>
            {isOnlyFinanceiro ? (
              <>
                <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/30">Navegação</div>
                <MenuLink href="/admin" label={<span className="flex items-center gap-2"><IconDashboard /> Dashboard</span>} onClick={() => setOpenMenu(null)} />
                <MenuLink href="/admin/settings/profile" label={<span className="flex items-center gap-2"><IconMenuPerfil /> Perfil</span>} onClick={() => setOpenMenu(null)} />
                <Divider />
                <LogoutLink onLogout={() => setOpenMenu(null)} />
              </>
            ) : (
              <>
                <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/30">Navegação</div>
                
                {/* Primeira opção no Mobile se tiver acesso */}
                {(hasIPTVorSaaS || hasAlunos) && (
                  <MenuLink href="/admin/auditoria" label={<span className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400"><IconLog /> Log Portal</span>} onClick={() => setOpenMenu(null)} />
                )}

                {can("dashboard")   && <MenuLink href="/admin" label={<span className="flex items-center gap-2"><IconDashboard /> Dashboard</span>} onClick={() => setOpenMenu(null)} />}
                {hasIPTVorSaaS      && <MenuLink href="/admin/cliente" label={<span className="flex items-center gap-1.5"><IconClientes /> Clientes</span>} onClick={() => setOpenMenu(null)} />}
                {hasAlunos          && <MenuLink href="/admin/aluno" label={<span className="flex items-center gap-1.5"><IconClientes /> Alunos</span>} onClick={() => setOpenMenu(null)} />}
                {can("revendas")    && <MenuLink href="/admin/revendedor" label={<span className="flex items-center gap-1.5"><IconRevendas /> Revendas</span>} onClick={() => setOpenMenu(null)} />}
                {can("testes")      && <MenuLink href="/admin/teste" label={<span className="flex items-center gap-2"><IconFastTimer /> Testes</span>} onClick={() => setOpenMenu(null)} />}
                <Divider />

                <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/30">Gerenciador</div>
                {can("servidores")  && <MenuLink href="/admin/gerenciador/servidor" label={<span className="flex items-center gap-2"><IconMenuServidor /> Servidores</span>} onClick={() => setOpenMenu(null)} />}
                {can("planos")      && <MenuLink href="/admin/gerenciador/plano" label={<span className="flex items-center gap-2"><IconMenuPlano /> Planos</span>} onClick={() => setOpenMenu(null)} />}
                {can("mensagens")   && <MenuLink href="/admin/gerenciador/mensagem" label={<span className="flex items-center gap-2"><IconMenuMensagens /> Mensagens</span>} onClick={() => setOpenMenu(null)} />}
                {can("cobranca")    && <MenuLink href="/admin/gerenciador/cobranca" label={<span className="flex items-center gap-2"><IconMenuCobranca /> Automação de Cobrança</span>} onClick={() => setOpenMenu(null)} />}
                {can("pagamento")   && <MenuLink href="/admin/gerenciador/pagamento" label={<span className="flex items-center gap-2"><IconMenuPagamento /> Formas de pagamento</span>} onClick={() => setOpenMenu(null)} />}
                {can("aplicativos") && <MenuLink href="/admin/gerenciador/aplicativo" label={<span className="flex items-center gap-2"><IconMenuAplicativo /> Aplicativos</span>} onClick={() => setOpenMenu(null)} />}
                <Divider />

                <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/30">Conta</div>
                {can("perfil")         && <MenuLink href="/admin/settings/profile" label={<span className="flex items-center gap-2"><IconMenuPerfil /> Perfil</span>} onClick={() => setOpenMenu(null)} />}
                {financialControlEnabled && <MenuLink href="/admin/settings/financeiro_pessoal" label={<span className="flex items-center gap-2"><IconMenuFinanceiro /> Controle Financeiro</span>} onClick={() => setOpenMenu(null)} />}
                {hasSaaS && role !== "USER" && <MenuLink href="/admin/settings/gestao_saas" label={<span className="flex items-center gap-2"><IconMenuSaas /> Gestão SaaS</span>} onClick={() => setOpenMenu(null)} />}
                {can("apiIntegracoes") && <MenuLink href="/admin/settings/api-server" label={<span className="flex items-center gap-2"><IconMenuApi /> API de Integrações</span>} onClick={() => setOpenMenu(null)} />}
                <Divider />
                <LogoutLink onLogout={() => setOpenMenu(null)} />
              </>
            )}
          </DropdownPortal>,
          document.body
        )
      }

      {/* ── DROPDOWN CONTA ── */}
      {canUseDom && openMenu === "settings" && settingsPos &&
        createPortal(
          <DropdownPortal right={settingsPos.right} top={settingsPos.top} onClose={() => setOpenMenu(null)}>
            {can("perfil") && <MenuLink href="/admin/settings/profile" label={<span className="flex items-center gap-2"><IconMenuPerfil /> Perfil</span>} onClick={() => setOpenMenu(null)} />}

            {financialControlEnabled && (
              <MenuLink href="/admin/settings/financeiro_pessoal" label={<span className="flex items-center gap-2"><IconMenuFinanceiro /> Controle Financeiro</span>} onClick={() => setOpenMenu(null)} />
            )}

            {hasSaaS && role !== "USER" && (
              <MenuLink href="/admin/settings/gestao_saas" label={<span className="flex items-center gap-2"><IconMenuSaas /> Gestão SaaS</span>} onClick={() => setOpenMenu(null)} />
            )}

            {can("apiIntegracoes") && (
              <MenuLink href="/admin/settings/api-server" label={<span className="flex items-center gap-2"><IconMenuApi /> API de Integrações</span>} onClick={() => setOpenMenu(null)} />
            )}
            <Divider />
            <LogoutLink onLogout={() => setOpenMenu(null)} />
          </DropdownPortal>,
          document.body
        )
      }

      <main className="mx-auto w-full max-w-screen-2xl px-2 sm:px-6 lg:px-8 pt-2 pb-6 animate-in fade-in duration-500">
        {children}
      </main>

      {/* Modal Principal de Notificações */}
      {showNotificationsModal && (
        <Modal title="Notificações" onClose={() => setShowNotificationsModal(false)}>
          <div className="space-y-4">
            {notifications.length === 0 ? (
              <div className="text-center text-slate-500 dark:text-white/60 py-8">
                Você não tem notificações.
              </div>
            ) : (
              <>
                <div className="flex justify-end">
                  <button onClick={clearAllNotifications} className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-white/10 text-slate-700 dark:text-white font-bold hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-xs uppercase">
                    Limpar todas
                  </button>
                </div>
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1.5">
                  {notifications.map(n => (
                    <div
                      key={n.id}
                      onClick={() => handleNotificationClick(n)}
                      className={[
                        "p-4 rounded-lg border cursor-pointer transition-colors flex gap-3 items-start",
                        n.is_read
                          ? "bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10"
                          : "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 hover:border-emerald-300 dark:hover:border-emerald-500/30",
                      ].join(" ")}
                    >
                      <div className="text-2xl mt-0.5">
                        {n.type === 'error' ? '🟥' : n.type === 'warning' ? '⚠️' : n.type === 'whatsapp' ? '📵' : '📢'}
                      </div>
                      <div className="flex-1">
                        <p className="text-slate-800 dark:text-white text-sm font-medium">
                          {n.title}
                        </p>
                        <p className="text-slate-600 dark:text-white/70 text-xs mt-1 line-clamp-2">
                          {n.message}
                        </p>
                        <p className="text-slate-400 dark:text-white/40 text-[10px] mt-2">
                          {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(n.created_at))}
                        </p>
                      </div>
                      
                      {/* ✅ Container da bolinha e do X alinhados horizontalmente */}
                      <div className="flex items-center gap-3 mt-1">
                        {!n.is_read && <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-sm flex-shrink-0" />}
                        <button
                          onClick={(e) => handleDismiss(e, n.id)}
                          className="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-white/10 rounded-md transition-colors"
                          title="Ocultar notificação"
                        >
                          <IconX />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* Modal de Detalhes da Notificação (genérico) */}
      {selectedNotification && selectedNotification.type === 'info' && (
        <Modal title={`📢 ${selectedNotification.title}`} onClose={() => setSelectedNotification(null)}>
          <div className="space-y-6">
            <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 p-4 rounded-lg flex gap-3">
              <span className="text-2xl mt-0.5">📢</span>
              <div>
                <p className="text-slate-700 dark:text-white/90 text-sm font-medium">
                  {selectedNotification.title}
                </p>
                <p className="text-slate-500 dark:text-white/60 text-xs mt-1">
                  {selectedNotification.message}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setSelectedNotification(null)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-white/10 text-slate-700 dark:text-white font-bold hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-xs uppercase">
                Fechar
              </button>
              <Link href={selectedNotification.link} onClick={() => setSelectedNotification(null)} className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-500 transition-colors text-xs uppercase shadow-lg shadow-emerald-900/20">
                Ver mais
              </Link>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal aviso de vencimento */}
      {showWarningModal && (
        <Modal title="⚠️ Aviso de Vencimento" onClose={() => setShowWarningModal(false)}>
          <div className="space-y-6">
            <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-4 rounded-lg flex gap-3">
              <span className="text-2xl mt-0.5">📢</span>
              <div>
                <p className="text-slate-700 dark:text-white/90 text-sm font-medium">
                  {(() => {
                    const dias = daysUntil(localExpiresAt) ?? 0;
                    if (!localExpiresAt) return "Seu painel está próximo do vencimento.";
                    const [y, m, d] = localExpiresAt.split("T")[0].split("-").map(Number);
                    const dateObj = new Date(y, m - 1, d);
                    const dateStr = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(dateObj);
                    const weekDayStr = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(dateObj).replace("-feira", " feira");
                    if (dias < 0) return <>Seu painel venceu na <strong>{weekDayStr}</strong> dia <strong>{dateStr}</strong>, e já está vencido há <strong>{Math.abs(dias)}</strong> dia(s)!</>;
                    if (dias === 0) return <>Seu painel vence <strong>HOJE</strong>, dia <strong>{dateStr}</strong>!</>;
                    return <>Seu painel vence na <strong>{weekDayStr}</strong> dia <strong>{dateStr}</strong>, você tem <strong>{dias}</strong> para antecipar a renovação.</>;
                  })()}
                </p>
                <p className="text-slate-500 dark:text-white/60 text-xs mt-1">
                  Renove agora mesmo para evitar o bloqueio automático e manter seus serviços funcionando sem interrupções.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowWarningModal(false)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-white/10 text-slate-700 dark:text-white font-bold hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-xs uppercase">
                Fechar
              </button>
              <button
                onClick={() => { setShowWarningModal(false); setShowRenewModal(true); }}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-500 transition-colors text-xs uppercase shadow-lg shadow-emerald-900/20"
              >
                Renovar Agora
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal WhatsApp desconectado */}
      {showWaModal && (
        <Modal title="📵 WhatsApp Desconectado" onClose={() => setShowWaModal(false)}>
          <div className="space-y-6">
            <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 p-4 rounded-lg flex gap-3">
              <span className="text-2xl mt-0.5">📲</span>
              <div>
                <p className="text-slate-700 dark:text-white/90 text-sm font-medium">
                  Nenhuma sessão do WhatsApp está conectada no momento.
                </p>
                <p className="text-slate-500 dark:text-white/60 text-xs mt-1">
                  Os disparos automáticos e manuais estão pausados. Reconecte para retomar o envio de mensagens.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowWaModal(false)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-white/10 text-slate-700 dark:text-white font-bold hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-xs uppercase">
                Fechar
              </button>
              <a href="/admin/settings/profile" onClick={() => setShowWaModal(false)} className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-500 transition-colors text-xs uppercase shadow-lg shadow-emerald-900/20">
                Ir para Configurações
              </a>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal renovação */}
      {showRenewModal && tenantId && (
        <SaasProfileRenewModal
          tenantId={tenantId}
          role={role as "MASTER" | "USER"}
          saasPlanTableId={saasPlanTableId ?? null}
          creditBalance={creditBalance ?? 0}
          currentExpiry={expiresAt ?? null}
          whatsappSessions={whatsappSessions ?? 1}
          onClose={() => setShowRenewModal(false)}
          onSuccess={() => { setShowRenewModal(false); window.location.reload(); }}
        />
      )}
    </div>
  );
}

/* ── Componentes auxiliares ── */

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.60)", display: "grid", placeItems: "center", zIndex: 99999, padding: 16 }}
    >
      <div onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-lg bg-white dark:bg-[#0f141a] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
          <div className="font-bold text-slate-800 dark:text-white">{title}</div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white">
            <IconX />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}

function IconX() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>;
}

function DropdownPortal({ children, top, right, onClose }: { children: React.ReactNode; top: number; right: number; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-9999" onMouseDown={onClose}>
      <div
        className="absolute animate-in fade-in zoom-in-95 duration-200"
        style={{ top, right }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="w-64 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#161b22] shadow-2xl overflow-hidden p-1.5 transition-colors">
          {children}
        </div>
      </div>
    </div>
  );
}

function LogoutLink({ onLogout }: { onLogout?: () => void }) {
  return (
    <button
      type="button"
      onClick={() => { onLogout?.(); window.location.href = "/logout"; }}
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-all"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-70 group-hover:scale-110 transition-transform"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Sair da conta
    </button>
  );
}

function NavLink({ href, label }: { href: string; label: React.ReactNode }) {
  const pathname = usePathname();
  const active = href === "/admin" ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={[
        "rounded-lg px-3 py-2 text-sm transition-all duration-200 inline-flex items-center font-bold tracking-tight",
        active ? "bg-white/15 text-emerald-400 shadow-sm" : "text-white/70 hover:text-white hover:bg-white/5",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

function MenuLink({ href, label, onClick }: { href: string; label: React.ReactNode; onClick?: () => void }) {
  const pathname = usePathname();
  const isActive = pathname === href;
  return (
    <Link
      href={href}
      onClick={onClick}
      className={[
        "block rounded-lg px-3 py-2.5 text-sm transition-all font-bold tracking-tight",
        isActive
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/5",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

function Divider() {
  return <div className="my-1.5 h-px bg-slate-100 dark:bg-white/5 mx-2" />;
}

function IconDashboard() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20V14"/></svg>;
}
function IconFastTimer() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/><line x1="9" y1="2" x2="15" y2="2"/></svg>;
}
function IconClientes() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
}
function IconRevendas() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 7.65l8.42 8.42 8.42-8.42a5.4 5.4 0 0 0 0-7.65z"/></svg>;
}
function IconGerenciador() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M16.24 7.76a6 6 0 0 1 0 8.49M4.93 4.93a10 10 0 0 0 0 14.14M7.76 7.76a6 6 0 0 0 0 8.49"/></svg>;
}
function IconConta() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f472b6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
}
function IconMenuServidor() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>;
}
function IconMenuPlano() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;
}
function IconMenuMensagens() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
}
function IconMenuCobranca() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>;
}
function IconMenuPagamento() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>;
}
function IconMenuAplicativo() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f472b6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>;
}
function IconMenuPerfil() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f472b6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
}
function IconMenuFinanceiro() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>;
}
function IconMenuSaas() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>;
}
function IconMenuApi() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>;
}
// Novo ícone de Sininho
function IconSininho({ className }: { className?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
function IconLog() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>
  );
}