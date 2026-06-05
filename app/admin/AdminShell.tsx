"use client";

import Link from "next/link";
import Image from "next/image";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePathname } from "next/navigation";
import React from "react";
import {
  LayoutDashboard,
  Users,
  Activity,
  Clock,
  Network,
  Settings2,
  UserCircle,
  Server,
  Layers,
  MessageSquare,
  Receipt,
  CreditCard,
  Smartphone,
  User,
  Wallet,
  Code,
  Bell,
  BookOpen,
  ScrollText,
  RefreshCcw,
  RotateCcw,
  X,
} from "lucide-react";

function getHojeSP(): Date {
  const spStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  const [y, m, d] = spStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function getTargetDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split("T")[0].split("-").map(Number);
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

function BrandUser({
  userLabel,
  tenantName,
  logoUrl,
}: {
  userLabel: string;
  tenantName: string;
  logoUrl?: string | null;
}) {
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
        <div className="text-[10px] uppercase tracking-wider text-white/40 font-medium leading-none mb-0.5 group-hover:text-white/60 transition-colors">
          Logado como
        </div>
        <div className="text-xs font-medium text-white truncate max-w-50 sm:max-w-66 tracking-tight group-hover:text-emerald-400 transition-colors uppercase">
          {userLabel}
        </div>
      </div>
    </div>
  );
}

type Notification = {
  id: string;
  title: string;
  message: string;
  link: string;
  type: "warning" | "error" | "info" | "whatsapp";
  data?: any;
  is_read: boolean;
  created_at: string;
};

// Renderiza **negrito** dentro de um texto, sem HTML inseguro
function renderBold(text: any): React.ReactNode {
  // Blindagem contra cache velho
  if (typeof text !== "string") return text;
  if (!text.includes("**")) return text;
  
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-bold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}
export default function AdminShell({
  children,
  userLabel,
  tenantName,
  tenantId,
  whatsappSessions,
  logoUrl,
}: {
  children: React.ReactNode;
  userLabel: string;
  tenantName: string;
  tenantId?: string;
  whatsappSessions?: number;
  logoUrl?: string | null;
}) {
  const [openMenu, setOpenMenu] = useState<
    null | "manager" | "settings" | "mobile"
  >(null);
  const [waDisconnected, setWaDisconnected] = useState(false);
  const [showWaModal, setShowWaModal] = useState(false);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [selectedNotification, setSelectedNotification] =
    useState<Notification | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications],
  );

  useEffect(() => {
    if (!whatsappSessions || whatsappSessions < 1) return;

    async function checkWaSessions() {
      try {
        const [r1, r2] = await Promise.all([
          fetch("/api/whatsapp/status", { cache: "no-store" })
            .then((r) => r.json())
            .catch(() => ({})),
          whatsappSessions! >= 2
            ? fetch("/api/whatsapp/status2", { cache: "no-store" })
                .then((r) => r.json())
                .catch(() => ({}))
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
  }, [whatsappSessions]);

  useEffect(() => {
    const loadNotifications = async () => {
      const list: Notification[] = [];
      const nowIso = new Date().toISOString();
      const dataAtualSP = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
      }).format(new Date());

      if (waDisconnected) {
        list.push({
          id: "whatsapp_disconnected",
          title: "📵 WhatsApp Desconectado",
          message: "Reconecte para retomar o envio de mensagens.",
          link: "/admin/settings/profile",
          type: "whatsapp",
          is_read: false,
          created_at: nowIso,
        });
      }

      if (tenantId) {
        try {
          const { data: transacoes, error } = await supabaseBrowser
            .from("fin_transacoes")
            .select("id, descricao, valor, data_vencimento, tipo")
            .eq("status", "PENDENTE")
            .lte("data_vencimento", dataAtualSP);

          if (!error && transacoes) {
            transacoes.forEach((t) => {
              const vencido = isOverdue(t.data_vencimento);
              const diasAtrasoRaw = daysUntil(t.data_vencimento + "T12:00:00");
              const diasAtraso =
                diasAtrasoRaw !== null ? Math.abs(diasAtrasoRaw) : 0;
              const dataFormatada = t.data_vencimento
                .split("-")
                .reverse()
                .join("/");

              const icone = t.tipo === "RECEITA" ? "📈" : "📉";
              const tituloTipo =
                t.tipo === "RECEITA" ? "Recebimento" : "Pagamento";
              const valorFmt = new Intl.NumberFormat("pt-BR", {
                style: "currency",
                currency: "BRL",
              }).format(t.valor);

              const titleNotif = vencido
                ? `🟥 ${tituloTipo} Vencido`
                : `🟧 ${tituloTipo} Vence Hoje`;
              const messageNotif = vencido
                ? `${icone} ${t.descricao} - ${valorFmt}. Vencido há ${diasAtraso} dia(s) (${dataFormatada}).`
                : `${icone} ${t.descricao} - ${valorFmt}. Pendente para hoje (${dataFormatada}).`;

              list.push({
                id: `fin_${t.id}`,
                title: titleNotif,
                message: messageNotif,
                link: "/admin/settings/financeiro_pessoal",
                type: vencido ? "error" : "warning",
                is_read: false,
                created_at: nowIso,
                data: { transacaoId: t.id },
              });
            });
          }
        } catch (e) {}
      }

      if (tenantId) {
        try {
          const { data: pendingManual, error: manualErr } =
            await supabaseBrowser
              .from("client_portal_payments")
              .select("id, created_at")
              .eq("tenant_id", tenantId)
              .eq("fulfillment_status", "manual_pending");

          if (!manualErr && pendingManual) {
            pendingManual.forEach((p) => {
              list.push({
                id: `manual_${p.id}`,
                title: "🟣 Ação Necessária",
                message:
                  "Um pagamento foi aprovado e aguarda liberação manual no servidor.",
                link: "/admin/auditoria",
                type: "info",
                is_read: false,
                created_at: p.created_at || nowIso,
              });
            });
          }
        } catch (e) {}
      }

      if (tenantId) {
        try {
          const { data: failedWa, error: waErr } = await supabaseBrowser
            .from("client_portal_payments")
            .select("id, created_at")
            .eq("tenant_id", tenantId)
            .eq("whatsapp_status", "error")
            .in("fulfillment_status", ["done", "manual_done"]);

          if (!waErr && failedWa) {
            failedWa.forEach((p) => {
              list.push({
                id: `wa_err_${p.id}`,
                title: "💬 Falha no WhatsApp",
                message:
                  "Uma recarga foi efetuada, mas o envio do comprovante pelo WhatsApp falhou. Reenvie pela Auditoria.",
                link: "/admin/auditoria",
                type: "error",
                is_read: false,
                created_at: p.created_at || nowIso,
              });
            });
          }
        } catch (e) {}
      }

      // ✅ NOVO: Falhas das automações de cobrança (somente HOJE, fuso SP)
      if (tenantId) {
        try {
          // Início do dia de hoje em São Paulo, convertido para um instante UTC
          const startOfTodaySP = new Date(`${dataAtualSP}T00:00:00-03:00`).toISOString();

          // 1) Busca TODOS os disparos de automação de hoje para cruzar falhas vs sucessos
          const { data: todayJobs, error: jobsErr } = await supabaseBrowser
            .from("client_message_jobs")
            .select("id, client_id, automation_id, status, send_at")
            .eq("tenant_id", tenantId)
            .not("automation_id", "is", null)
            .gte("send_at", startOfTodaySP);

          // Blindagem: Garante que só vai tentar rodar o loop se for DE FATO uma lista válida
          const validJobs = Array.isArray(todayJobs) ? todayJobs : [];

          if (!jobsErr && validJobs.length > 0) {
            // 2) Agrupa para saber se o cliente teve sucesso na mesma automação hoje
            const statusByAutoAndClient: Record<string, Record<string, boolean>> = {};

            validJobs.forEach((j: any) => {
              if (!j.automation_id || !j.client_id) return;
              
              if (!statusByAutoAndClient[j.automation_id]) {
                statusByAutoAndClient[j.automation_id] = {};
              }
              
              // Se ainda não registramos o cliente, o padrão é falso (falhou/pendente)
              if (statusByAutoAndClient[j.automation_id][j.client_id] === undefined) {
                statusByAutoAndClient[j.automation_id][j.client_id] = false;
              }

              // Se teve um status SENT, marca como verdadeiro (sucesso real, anula falhas anteriores)
              if (j.status === "SENT") {
                statusByAutoAndClient[j.automation_id][j.client_id] = true;
              }
            });

            const countByAuto: Record<string, number> = {};
            
            // Conta APENAS clientes que ficaram com 'false' (ou seja, falharam e NUNCA tiveram SENT hoje)
            Object.keys(statusByAutoAndClient).forEach(autoId => {
              const clients = statusByAutoAndClient[autoId];
              let realFails = 0;
              Object.values(clients).forEach(hasSent => {
                if (!hasSent) realFails++;
              });
              
              if (realFails > 0) {
                countByAuto[autoId] = realFails;
              }
            });

            const autoIds = Object.keys(countByAuto);
            if (autoIds.length > 0) {
              // 3) Busca nome e horário das regras envolvidas
              const { data: autos } = await supabaseBrowser
                .from("billing_automations")
                .select("id, name, schedule_time")
                .eq("tenant_id", tenantId)
                .in("id", autoIds);

              const autoMap: Record<string, { name: string; time: string }> = {};
              (autos || []).forEach((a: any) => {
                autoMap[a.id] = {
                  name: a.name || "Automação",
                  time: a.schedule_time ? String(a.schedule_time).slice(0, 5) : "",
                };
              });

              // 4) Um alerta por automação
              autoIds.forEach((autoId) => {
                const info = autoMap[autoId] || { name: "Automação", time: "" };
                const qtd = countByAuto[autoId];
                const horaTxt = info.time ? ` às ${info.time}hs` : "";
                const clienteTxt =
                  qtd > 1
                    ? `${qtd} clientes não foram notificados`
                    : `${qtd} cliente não foi notificado`;
                list.push({
                  id: `auto_fail_${autoId}_${dataAtualSP}`,
                  title: `🤖 Falha: **${info.name}**`,
                  message: `A regra não foi enviada${horaTxt}. ${clienteTxt} via WhatsApp.`,
                  link: "/admin/gerenciador/cobranca",
                  type: "error",
                  is_read: false,
                  created_at: nowIso,
                });
              });
            }
          }
        } catch (e) {}
      }

      // ✅ NOVO: Notificação de Saldo Baixo nos Servidores (<= 15)
      if (tenantId) {
        try {
          const { data: serversBaixo, error: srvErr } = await supabaseBrowser
            .from("servers")
            .select("id, name, credits_available")
            .eq("tenant_id", tenantId)
            .eq("is_archived", false)
            .lte("credits_available", 15); // Menor ou igual a 15

          if (!srvErr && serversBaixo) {
            serversBaixo.forEach((s) => {
              list.push({
                id: `srv_low_credits_${s.id}`,
                title: "🪫 Saldo Baixo",
                message: `O servidor "${s.name}" está com apenas ${s.credits_available} créditos. Recarregue imediatamente para evitar interrupções!`,
                link: "/admin/gerenciador/servidor", // Direciona para a gestão de servidores
                type: "error", // Tipo error para aparecer vermelho e chamar atenção
                is_read: false,
                created_at: nowIso,
              });
            });
          }
        } catch (e) {}
      }

      const dismissed = JSON.parse(
        localStorage.getItem("dismissed_notifs") || "[]",
      );
      const readNotifs = JSON.parse(
        localStorage.getItem("read_notifs") || "[]",
      );

      const filteredList = list
        .filter((n) => !dismissed.includes(n.id))
        .map((n) => (readNotifs.includes(n.id) ? { ...n, is_read: true } : n));

      setNotifications(filteredList);
    };

    loadNotifications();
  }, [waDisconnected, tenantId, refreshTrigger]);

  const managerRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const mobileRef = useRef<HTMLDivElement>(null);

  const [managerPos, setManagerPos] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const [settingsPos, setSettingsPos] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const [mobilePos, setMobilePos] = useState<{
    top: number;
    right: number;
  } | null>(null);

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

  const settingsActive = useMemo(
    () => pathname.startsWith("/admin/settings"),
    [pathname],
  );

  function openManager() {
    if (openMenu === "manager") {
      setOpenMenu(null);
      return;
    }
    const btn = managerRef.current?.querySelector("button");
    if (btn) {
      const r = (btn as HTMLButtonElement).getBoundingClientRect();
      setManagerPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }
    setOpenMenu("manager");
  }

  function openSettings() {
    if (openMenu === "settings") {
      setOpenMenu(null);
      return;
    }
    const btn = settingsRef.current?.querySelector("button");
    if (btn) {
      const r = (btn as HTMLButtonElement).getBoundingClientRect();
      setSettingsPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }
    setOpenMenu("settings");
  }

  function openMobileMenu() {
    if (openMenu === "mobile") {
      setOpenMenu(null);
      return;
    }
    const btn = mobileRef.current?.querySelector("button");
    if (btn) {
      const r = (btn as HTMLButtonElement).getBoundingClientRect();
      setMobilePos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }
    setOpenMenu("mobile");
  }

  const clearAllNotifications = () => {
    const currentIds = notifications.map((n) => n.id);
    const dismissed = JSON.parse(
      localStorage.getItem("dismissed_notifs") || "[]",
    );
    const newDismissed = Array.from(new Set([...dismissed, ...currentIds]));
    localStorage.setItem("dismissed_notifs", JSON.stringify(newDismissed));
    setNotifications([]);
  };

  const handleSync = () => {
    localStorage.removeItem("dismissed_notifs");
    localStorage.removeItem("read_notifs");
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleMarkAsUnread = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const readNotifs = JSON.parse(localStorage.getItem("read_notifs") || "[]");
    const newReadNotifs = readNotifs.filter(
      (notifId: string) => notifId !== id,
    );
    localStorage.setItem("read_notifs", JSON.stringify(newReadNotifs));
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: false } : n)),
    );
  };

  const handleDismiss = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const dismissed = JSON.parse(
      localStorage.getItem("dismissed_notifs") || "[]",
    );
    if (!dismissed.includes(id)) {
      dismissed.push(id);
      localStorage.setItem("dismissed_notifs", JSON.stringify(dismissed));
    }
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const handleNotificationClick = (n: Notification) => {
    const readNotifs = JSON.parse(localStorage.getItem("read_notifs") || "[]");
    if (!readNotifs.includes(n.id)) {
      readNotifs.push(n.id);
      localStorage.setItem("read_notifs", JSON.stringify(readNotifs));
    }

    setNotifications((prev) =>
      prev.map((noti) =>
        noti.id === n.id ? { ...noti, is_read: true } : noti,
      ),
    );
    setShowNotificationsModal(false);

    if (n.id === "whatsapp_disconnected") {
      setShowWaModal(true);
    } else {
      window.location.href = n.link;
    }
  };

  const canUseDom = typeof document !== "undefined";

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-200">
      <div className="sticky top-0 z-50 bg-[#050505] text-white border-b border-white/10 shadow-lg">
        <div className="mx-auto flex w-full items-center gap-2 px-3 sm:px-4 py-2">
          <div className="flex items-center gap-4">
            <Link
              href="/admin"
              className="flex items-center gap-3 font-semibold min-w-0 hover:opacity-90 transition-opacity no-underline text-white"
            >
              <BrandUser
                userLabel={userLabel}
                tenantName={tenantName}
                logoUrl={logoUrl}
              />
            </Link>

            <div className="relative">
              <button
                onClick={() => setShowNotificationsModal(true)}
                className={[
                  "flex items-center justify-center w-8 h-8 rounded-full border border-white/10 shadow-sm transition-colors",
                  unreadCount > 0
                    ? "bg-rose-500 hover:bg-rose-600 text-white"
                    : "bg-white/5 hover:bg-white/10 text-white/90",
                ].join(" ")}
                title="Notificações"
              >
                <Bell className="w-5 h-5" />
              </button>
              {unreadCount > 0 && (
                <div className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-rose-500 border-2 border-[#050505] text-[9px] font-bold text-white shadow-sm">
                  {unreadCount}
                </div>
              )}
            </div>
          </div>

          <div className="flex-1" />

          <nav className="flex items-center gap-1 text-sm whitespace-nowrap">
            <div className="flex items-center gap-1 sm:hidden">
              <NavLink
                href="/admin/cliente"
                label={
                  <span className="flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-sky-400" /> Clientes
                  </span>
                }
              />

              <div ref={mobileRef} className="relative">
                <button
                  onClick={openMobileMenu}
                  className={[
                    "rounded-lg px-3 py-2 text-sm transition-all duration-200 font-medium flex items-center gap-2 tracking-tight",
                    openMenu === "mobile"
                      ? "bg-white/10 text-emerald-400"
                      : "text-white/80 hover:text-white hover:bg-white/5",
                  ].join(" ")}
                >
                  <span className="text-base leading-none">☰</span> Menu{" "}
                  <span
                    className={[
                      "transition-transform duration-200 text-[8px] opacity-40",
                      openMenu === "mobile" ? "rotate-180" : "",
                    ].join(" ")}
                  >
                    ▼
                  </span>
                </button>
              </div>
            </div>

            <div className="hidden sm:flex items-center gap-1">
              <NavLink
                href="/admin"
                label={
                  <span className="flex items-center gap-1.5">
                    <LayoutDashboard className="w-4 h-4 text-emerald-400" />{" "}
                    Dashboard
                  </span>
                }
              />
              <NavLink
                href="/admin/cliente"
                label={
                  <span className="flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-sky-400" /> Clientes
                  </span>
                }
              />
              <NavLink
                href="/admin/auditoria"
                label={
                  <span className="flex items-center gap-1.5">
                    <ScrollText className="w-4 h-4 text-emerald-400" /> Log
                    Portal
                  </span>
                }
              />
              <NavLink
                href="/admin/revendedor"
                label={
                  <span className="flex items-center gap-1.5">
                    <Network className="w-4 h-4 text-violet-400" /> Revendas
                  </span>
                }
              />
              <NavLink
                href="/admin/teste"
                label={
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-amber-400" /> Testes
                  </span>
                }
              />

              <div className="w-px h-6 bg-white/10 mx-2" />

              <div ref={managerRef} className="relative">
                <button
                  onClick={openManager}
                  className={[
                    "rounded-lg px-3 py-2 text-sm transition-all duration-200 font-medium flex items-center gap-2 tracking-tight",
                    managerActive
                      ? "bg-white/10 text-emerald-400"
                      : "text-white/80 hover:text-white hover:bg-white/5",
                  ].join(" ")}
                >
                  <span className="flex items-center gap-1.5">
                    <Settings2 className="w-4 h-4 text-white/70" /> Gerenciador
                  </span>{" "}
                  <span
                    className={[
                      "transition-transform duration-200 text-[8px] opacity-40",
                      openMenu === "manager" ? "rotate-180" : "",
                    ].join(" ")}
                  >
                    ▼
                  </span>
                </button>
              </div>

              <div ref={settingsRef} className="relative">
                <button
                  onClick={openSettings}
                  className={[
                    "rounded-lg px-3 py-2 text-sm transition-all duration-200 font-medium flex items-center gap-2 tracking-tight",
                    settingsActive
                      ? "bg-white/10 text-emerald-400"
                      : "text-white/80 hover:text-white hover:bg-white/5",
                  ].join(" ")}
                >
                  <span className="flex items-center gap-1.5">
                    <UserCircle className="w-4 h-4 text-pink-400" />{" "}
                    <span className="hidden sm:inline">Conta</span>
                  </span>{" "}
                  <span
                    className={[
                      "transition-transform duration-200 text-[8px] opacity-40",
                      openMenu === "settings" ? "rotate-180" : "",
                    ].join(" ")}
                  >
                    ▼
                  </span>
                </button>
              </div>
            </div>
          </nav>
        </div>
      </div>

      {canUseDom &&
        openMenu === "manager" &&
        managerPos &&
        createPortal(
          <DropdownPortal
            right={managerPos.right}
            top={managerPos.top}
            onClose={() => setOpenMenu(null)}
          >
            <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/80 dark:text-white/30">
              Gestão
            </div>
            <MenuLink
              href="/admin/gerenciador/servidor"
              label={
                <span className="flex items-center gap-2">
                  <Server className="w-4 h-4 text-sky-400" /> Servidores
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <MenuLink
              href="/admin/gerenciador/plano"
              label={
                <span className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-400" /> Planos
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <MenuLink
              href="/admin/gerenciador/mensagem"
              label={
                <span className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-green-400" /> Mensagens
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <Divider />
            <MenuLink
              href="/admin/gerenciador/cobranca"
              label={
                <span className="flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-amber-400" /> Automação de
                  Cobrança
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <MenuLink
              href="/admin/gerenciador/pagamento"
              label={
                <span className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-violet-400" /> Formas de
                  pagamento
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <MenuLink
              href="/admin/gerenciador/aplicativo"
              label={
                <span className="flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-pink-400" /> Aplicativos
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
          </DropdownPortal>,
          document.body,
        )}

      {canUseDom &&
        openMenu === "mobile" &&
        mobilePos &&
        createPortal(
          <DropdownPortal
            right={mobilePos.right}
            top={mobilePos.top}
            onClose={() => setOpenMenu(null)}
          >
            <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/80 dark:text-white/30">
              Navegação
            </div>

            <MenuLink
              href="/admin/auditoria"
              label={
                <span className="flex items-center gap-2 text-emerald-400">
                  <ScrollText className="w-4 h-4 text-emerald-400" /> Log Portal
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <MenuLink
              href="/admin"
              label={
                <span className="flex items-center gap-2">
                  <LayoutDashboard className="w-4 h-4 text-emerald-400" />{" "}
                  Dashboard
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <MenuLink
              href="/admin/cliente"
              label={
                <span className="flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-sky-400" /> Clientes
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <MenuLink
              href="/admin/revendedor"
              label={
                <span className="flex items-center gap-1.5">
                  <Network className="w-4 h-4 text-violet-400" /> Revendas
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <MenuLink
              href="/admin/teste"
              label={
                <span className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" /> Testes
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <Divider />

            <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/80 dark:text-white/30">
              Gerenciador
            </div>
            <MenuLink
              href="/admin/gerenciador/servidor"
              label={
                <span className="flex items-center gap-2">
                  <Server className="w-4 h-4 text-sky-400" /> Servidores
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <MenuLink
              href="/admin/gerenciador/plano"
              label={
                <span className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-400" /> Planos
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <MenuLink
              href="/admin/gerenciador/mensagem"
              label={
                <span className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-green-400" /> Mensagens
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <MenuLink
              href="/admin/gerenciador/cobranca"
              label={
                <span className="flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-amber-400" /> Automação de
                  Cobrança
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <MenuLink
              href="/admin/gerenciador/pagamento"
              label={
                <span className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-violet-400" /> Formas de
                  pagamento
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <MenuLink
              href="/admin/gerenciador/aplicativo"
              label={
                <span className="flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-pink-400" /> Aplicativos
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <Divider />

            <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/80 dark:text-white/30">
              Conta
            </div>
            <MenuLink
              href="/admin/settings/profile"
              label={
                <span className="flex items-center gap-2">
                  <User className="w-4 h-4 text-pink-400" /> Perfil
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <MenuLink
              href="/admin/agenda"
              label={
                <span className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-indigo-400" /> Agenda
                  Telefônica
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <MenuLink
              href="/admin/settings/financeiro_pessoal"
              label={
                <span className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-emerald-400" /> Controle
                  Financeiro
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <MenuLink
              href="/admin/settings/api-server"
              label={
                <span className="flex items-center gap-2">
                  <Code className="w-4 h-4 text-sky-400" /> API de Integrações
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <Divider />
            <LogoutLink onLogout={() => setOpenMenu(null)} />
          </DropdownPortal>,
          document.body,
        )}

      {canUseDom &&
        openMenu === "settings" &&
        settingsPos &&
        createPortal(
          <DropdownPortal
            right={settingsPos.right}
            top={settingsPos.top}
            onClose={() => setOpenMenu(null)}
          >
            <MenuLink
              href="/admin/settings/profile"
              label={
                <span className="flex items-center gap-2">
                  <User className="w-4 h-4 text-pink-400" /> Perfil
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <MenuLink
              href="/admin/agenda"
              label={
                <span className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-indigo-400" /> Agenda
                  Telefônica
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <MenuLink
              href="/admin/settings/financeiro_pessoal"
              label={
                <span className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-emerald-400" /> Controle
                  Financeiro
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />

            <MenuLink
              href="/admin/settings/api-server"
              label={
                <span className="flex items-center gap-2">
                  <Code className="w-4 h-4 text-sky-400" /> API de Integrações
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
            <Divider />
            <LogoutLink onLogout={() => setOpenMenu(null)} />
          </DropdownPortal>,
          document.body,
        )}

      <main className="mx-auto w-full px-0 sm:px-2 pt-2 pb-6 animate-in fade-in duration-500">
        {children}
      </main>

      {showNotificationsModal && (
        <Modal
          title="Notificações"
          onClose={() => setShowNotificationsModal(false)}
        >
          <div className="space-y-4">
            <div className="flex justify-end gap-2">
              <button
                onClick={handleSync}
                className="px-3 py-1.5 rounded-lg border border-border dark:border-border text-foreground/90 font-medium hover:bg-transparent/50 dark:hover:bg-card/5 transition-colors text-xs uppercase flex items-center gap-1.5"
                title="Recupera as notificações apagadas do navegador"
              >
                <RefreshCcw className="w-3.5 h-3.5" /> Sincronizar
              </button>
              {notifications.length > 0 && (
                <button
                  onClick={clearAllNotifications}
                  className="px-3 py-1.5 rounded-lg border border-border dark:border-border text-foreground/90 font-medium hover:bg-rose-500/10 hover:text-rose-400 hover:border-rose-500/20 dark:hover:bg-rose-500/10 dark:hover:text-rose-400 transition-colors text-xs uppercase"
                >
                  Limpar todas
                </button>
              )}
            </div>

            {notifications.length === 0 ? (
              <div className="text-center text-muted-foreground dark:text-white/60 py-8">
                Você não tem notificações.
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1.5">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    className={[
                      "p-3 rounded-lg border cursor-pointer transition-colors flex items-start gap-3",
                      n.is_read
                        ? "bg-transparent border-border"
                        : "bg-emerald-500/10 border-emerald-500/20 hover:border-emerald-300 dark:hover:border-emerald-500/30",
                    ].join(" ")}
                  >
                    <div className="text-xl flex-shrink-0 mt-0.5">
                      {n.type === "error"
                        ? "🟥"
                        : n.type === "warning"
                          ? "⚠️"
                          : n.type === "whatsapp"
                            ? "📵"
                            : "📢"}
                    </div>

                    <div className="flex-1 min-w-0 pr-1">
                      <div className="flex items-center gap-2">
                        {!n.is_read && (
                          <div className="h-2 w-2 rounded-full bg-emerald-500 flex-shrink-0 shadow-sm" />
                        )}
                        <p className="text-foreground text-sm font-medium truncate">
                          {renderBold(n.title)}
                        </p>
                      </div>
                      <p className="text-muted-foreground text-xs mt-1 leading-relaxed line-clamp-2">
                        {n.message}
                      </p>
                    </div>

                    <div className="flex flex-col items-center justify-start flex-shrink-0 pl-3 ml-1 border-l border-border min-h-[32px] gap-1">
                      <button
                        onClick={(e) => handleDismiss(e, n.id)}
                        className="p-1 text-muted-foreground/80 hover:text-rose-500 hover:bg-rose-500/10 dark:hover:bg-card/10 rounded-md transition-colors"
                        title="Ocultar notificação"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      {n.is_read && (
                        <button
                          onClick={(e) => handleMarkAsUnread(e, n.id)}
                          className="p-1 text-muted-foreground/80 hover:text-emerald-500 hover:bg-emerald-500/10 dark:hover:bg-card/10 rounded-md transition-colors"
                          title="Marcar como não lido"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {selectedNotification && selectedNotification.type === "info" && (
        <Modal
          title={`📢 ${selectedNotification.title}`}
          onClose={() => setSelectedNotification(null)}
        >
          <div className="space-y-6">
            <div className="bg-transparent border border-border p-4 rounded-lg flex gap-3">
              <span className="text-2xl mt-0.5">📢</span>
              <div>
                <p className="text-foreground/90/90 text-sm font-medium">
                  {selectedNotification.title}
                </p>
                <p className="text-foreground/70 text-xs mt-1">
                  {selectedNotification.message}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setSelectedNotification(null)}
                className="px-4 py-2 rounded-lg border border-border dark:border-border text-foreground/90 font-medium hover:bg-transparent/50 dark:hover:bg-card/5 transition-colors text-xs uppercase"
              >
                Fechar
              </button>
              <Link
                href={selectedNotification.link}
                onClick={() => setSelectedNotification(null)}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-500 transition-colors text-xs uppercase shadow-lg shadow-emerald-900/20"
              >
                Ver mais
              </Link>
            </div>
          </div>
        </Modal>
      )}

      {showWaModal && (
        <Modal
          title="📵 WhatsApp Desconectado"
          onClose={() => setShowWaModal(false)}
        >
          <div className="space-y-6">
            <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-lg flex gap-3">
              <span className="text-2xl mt-0.5">📲</span>
              <div>
                <p className="text-foreground/90/90 text-sm font-medium">
                  Nenhuma sessão do WhatsApp está conectada no momento.
                </p>
                <p className="text-foreground/70 text-xs mt-1">
                  Os disparos automáticos e manuais estão pausados. Reconecte
                  para retomar o envio de mensagens.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowWaModal(false)}
                className="px-4 py-2 rounded-lg border border-border dark:border-border text-foreground/90 font-medium hover:bg-transparent/50 dark:hover:bg-card/5 transition-colors text-xs uppercase"
              >
                Fechar
              </button>
              <a
                href="/admin/settings/profile"
                onClick={() => setShowWaModal(false)}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-500 transition-colors text-xs uppercase shadow-lg shadow-emerald-900/20"
              >
                Ir para Configurações
              </a>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.60)",
        display: "grid",
        placeItems: "center",
        zIndex: 99999,
        padding: 16,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-card dark:bg-background border border-border rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-transparent">
          <div className="font-medium text-foreground">
            {title}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-transparent dark:hover:bg-card/10 text-muted-foreground dark:text-white/60 hover:text-foreground dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function IconX() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function DropdownPortal({
  children,
  top,
  right,
  onClose,
}: {
  children: React.ReactNode;
  top: number;
  right: number;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-9999" onMouseDown={onClose}>
      <div
        className="absolute animate-in fade-in zoom-in-95 duration-200"
        style={{ top, right }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="w-64 rounded-xl border border-border bg-card shadow-2xl overflow-hidden p-1.5 transition-colors">
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
      onClick={() => {
        onLogout?.();
        window.location.href = "/logout";
      }}
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-rose-400 hover:bg-rose-500/10 dark:hover:bg-rose-500/10 transition-all"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="opacity-70 group-hover:scale-110 transition-transform"
      >
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>{" "}
      Sair da conta
    </button>
  );
}

function NavLink({ href, label }: { href: string; label: React.ReactNode }) {
  const pathname = usePathname();
  const active =
    href === "/admin" ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={[
        "rounded-lg px-3 py-2 text-sm transition-all duration-200 inline-flex items-center font-medium tracking-tight",
        active
          ? "bg-white/10 text-emerald-400 shadow-sm"
          : "text-white/80 hover:text-white hover:bg-white/5",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

function MenuLink({
  href,
  label,
  onClick,
}: {
  href: string;
  label: React.ReactNode;
  onClick?: () => void;
}) {
  const pathname = usePathname();
  const isActive = pathname === href;
  return (
    <Link
      href={href}
      onClick={onClick}
      className={[
        "block rounded-lg px-3 py-2.5 text-sm transition-all font-medium tracking-tight",
        isActive
          ? "bg-emerald-500/10 text-emerald-400"
          : "text-muted-foreground/80 hover:text-foreground dark:hover:text-foreground dark:text-white hover:bg-transparent/50 dark:hover:bg-card/5",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

function Divider() {
  return <div className="my-1.5 h-px bg-border mx-2" />;
}

function IconDashboard() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#34d399"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20V10" />
      <path d="M18 20V4" />
      <path d="M6 20V14" />
    </svg>
  );
}
function IconFastTimer() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#fbbf24"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
      <line x1="9" y1="2" x2="15" y2="2" />
    </svg>
  );
}
function IconClientes() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#38bdf8"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IconRevendas() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#a78bfa"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 7.65l8.42 8.42 8.42-8.42a5.4 5.4 0 0 0 0-7.65z" />
    </svg>
  );
}
function IconGerenciador() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#94a3b8"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M16.24 7.76a6 6 0 0 1 0 8.49M4.93 4.93a10 10 0 0 0 0 14.14M7.76 7.76a6 6 0 0 0 0 8.49" />
    </svg>
  );
}
function IconConta() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#f472b6"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function IconMenuServidor() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#38bdf8"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}
function IconMenuPlano() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#34d399"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}
function IconMenuMensagens() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#4ade80"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function IconMenuCobranca() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#fbbf24"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
      <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
      <line x1="6" y1="1" x2="6" y2="4" />
      <line x1="10" y1="1" x2="10" y2="4" />
      <line x1="14" y1="1" x2="14" y2="4" />
    </svg>
  );
}
function IconMenuPagamento() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#a78bfa"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}
function IconMenuAplicativo() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#f472b6"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  );
}
function IconMenuPerfil() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#f472b6"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function IconMenuFinanceiro() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#34d399"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
function IconMenuApi() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#38bdf8"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
function IconSininho({ className }: { className?: string }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
function IconAgenda() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#fb923c"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="M8 14h.01" />
      <path d="M12 14h.01" />
      <path d="M16 14h.01" />
      <path d="M8 18h.01" />
      <path d="M12 18h.01" />
      <path d="M16 18h.01" />
    </svg>
  );
}

function IconLog() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}
function IconSync({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 21v-5h5" />
    </svg>
  );
}
function IconUndo() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  );
}
