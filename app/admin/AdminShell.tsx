"use client";
// app/admin/AdminShell.tsx

import Link from "next/link";
import Image from "next/image";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { TenantProvider } from "@/lib/tenant-context";
import { usePathname } from "next/navigation";
import React from "react";
import {
  Modal as SharedModal,
  ModalHeader,
  ModalBody,
} from "@/components/ui/Modal";
import {
  LayoutDashboard,
  Users,
  Tv,
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
  Tag,
  Building2,
  ChevronDown,
} from "lucide-react";

const PAGE_NAMES: Record<string, string> = {
  "/admin": "Dashboard",
  "/admin/cliente": "Clientes",
  "/admin/revendedor": "Revendas",
  "/admin/teste": "Testes",
  "/admin/auditoria": "Log Portal",
  "/admin/agenda": "Agenda Telefônica",
  "/admin/gerenciador/guia-tv": "Guia TV",
  "/admin/gerenciador/servidor": "Servidores",
  "/admin/gerenciador/plano": "Planos",
  "/admin/gerenciador/mensagem": "Mensagens",
  "/admin/gerenciador/cobranca": "Automação de Cobrança",
  "/admin/gerenciador/pagamento": "Formas de Pagamento",
  "/admin/gerenciador/aplicativo": "Aplicativos",
  "/admin/settings/profile": "Perfil",
  "/admin/settings/whatsapp": "WhatsApp",
  "/admin/settings/financeiro_pessoal": "Controle Financeiro",
  "/admin/settings/condominio": "Condomínio",
  "/admin/settings/cupons": "Cupons",
  "/admin/settings/api-server": "API de Integrações",
};

function getPageName(path: string): string {
  if (PAGE_NAMES[path]) return PAGE_NAMES[path];
  const match = Object.keys(PAGE_NAMES)
    .sort((a, b) => b.length - a.length)
    .find((key) => path.startsWith(key));
  return match ? PAGE_NAMES[match] : "Painel";
}

function BrandUser({ userLabel }: { userLabel: string }) {
  return (
    <div className="flex items-center gap-3 min-w-0 text-white cursor-pointer group">
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
  type: string; // vem direto da tabela: fin_vencido, whatsapp_falha, automacao_falha, fulfillment_error, transfer_aguardando, manual_pending, saldo_baixo (ou "whatsapp_desconectado_local" para o item ephemeral)
  is_read: boolean;
  created_at: string;
};

// ✅ NOVO: emoji de exibição por tipo (a tabela já guarda o emoji no título/mensagem,
// isso aqui é só o ícone grande da lista)
function getNotifEmoji(type: string): string {
  switch (type) {
    case "fin_vencido":
      return "🟥";
    case "whatsapp_falha":
      return "💬";
    case "automacao_falha":
      return "🤖";
    case "transfer_aguardando":
      return "🏦";
    case "manual_pending":
      return "🟣";
    case "fulfillment_error":
      return "🔴";
    case "saldo_baixo":
      return "🪫";
    case "sugestao_conteudo":
      return "🍿";
    case "cron_falha":
      return "⏰";
    default:
      return "🔔";
  }
}

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
  tenantId,
}: {
  children: React.ReactNode;
  userLabel: string;
  tenantId?: string;
}) {
  const [openMenu, setOpenMenu] = useState<
    null | "manager" | "settings" | "mobile"
  >(null);
  const [notifications, setNotifications] = useState<Notification[]>([]); // ✅ vem direto da tabela notifications
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);

  // ✅ Pedido do Márcio, 06/08/2026: o botão "Sincronizar" só incrementava
  // um contador (refreshTrigger, removido) sem nenhum feedback visual —
  // clicar nele parecia "travado" mesmo quando a busca acontecia certinho
  // por trás. Agora vira uma chamada direta e aguardada, com o ícone
  // girando enquanto roda.
  const [syncingNotifications, setSyncingNotifications] = useState(false);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications],
  );

  const loadNotifications = useCallback(async () => {
    if (!tenantId) return;
    try {
      const { data, error } = await supabaseBrowser
        .from("notifications")
        .select("id, type, title, message, link, is_read, created_at")
        .eq("tenant_id", tenantId)
        .is("archived_at", null)
        .is("resolved_at", null)
        .order("created_at", { ascending: false })
        .limit(50);

      if (!error && data) {
        setNotifications(data as Notification[]);
      }
    } catch {}
  }, [tenantId]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

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
  // ✅ Só colapsa/expande o CONTEÚDO de cada seção do menu mobile — o menu
  // continua abrindo todo aberto por padrão (pedido do Márcio), essas
  // setinhas são só pra quem quer recolher uma seção fora do caminho.
  const [mobileGerenciadorOpen, setMobileGerenciadorOpen] = useState(true);
  const [mobileContaOpen, setMobileContaOpen] = useState(true);

  const pathname = usePathname();

  // ✅ Título da aba dinâmico por página (substitui o antigo TenantHead,
  // removido na limpeza do SaaS multi-tenant — aqui não depende mais de slug/tenant).
  useEffect(() => {
    const pageName = getPageName(pathname);
    const desiredTitle = `UniGestor - ${pageName}`;

    document.title = desiredTitle;

    // Observa o <head> inteiro — captura quando o Next.js
    // remove e recria o <title> durante navegação RSC
    const observer = new MutationObserver(() => {
      if (document.title !== desiredTitle) {
        document.title = desiredTitle;
      }
    });
    observer.observe(document.head, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [pathname]);

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

  // ✅ Ref espelhando openMenu — os handlers de hover (abaixo) rodam dentro
  // de setTimeout, onde o closure do state ficaria "congelado" no valor de
  // quando o timer foi armado. O ref sempre reflete o valor atual.
  const openMenuRef = useRef<typeof openMenu>(null);
  useEffect(() => {
    openMenuRef.current = openMenu;
  }, [openMenu]);

  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearHoverTimer() {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }

  useEffect(() => clearHoverTimer, []);

  function computeTriggerPos(ref: React.RefObject<HTMLDivElement | null>) {
    const btn = ref.current?.querySelector("button");
    if (!btn) return null;
    const r = (btn as HTMLButtonElement).getBoundingClientRect();
    return { top: r.bottom + 8, right: window.innerWidth - r.right };
  }

  function showManagerMenu() {
    const pos = computeTriggerPos(managerRef);
    if (pos) setManagerPos(pos);
    setOpenMenu("manager");
  }

  function showSettingsMenu() {
    const pos = computeTriggerPos(settingsRef);
    if (pos) setSettingsPos(pos);
    setOpenMenu("settings");
  }

  // ✅ Pedido do Márcio, 05/08/2026: hover no gerenciador/conta no topbar.
  // Se já tem um dos dois dropdowns aberto (por clique) e o mouse passa por
  // cima do outro, troca na hora — sem precisar clicar de novo. Se nenhum
  // dos dois está aberto, só abre depois de ~900ms parado em cima (evita
  // abrir sozinho quando o mouse só está passando por cima a caminho de
  // outro lugar). Tudo client-side, não bate em nenhuma rota/API.
  function handleTriggerHoverEnter(
    menu: "manager" | "settings",
    show: () => void,
  ) {
    clearHoverTimer();
    const current = openMenuRef.current;
    if (current === menu) return;
    if (current === "manager" || current === "settings") {
      show();
      return;
    }
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null;
      show();
    }, 900);
  }

  function handleTriggerHoverLeave() {
    clearHoverTimer();
  }

  function openManager() {
    clearHoverTimer();
    if (openMenu === "manager") {
      setOpenMenu(null);
      return;
    }
    showManagerMenu();
  }

  function openSettings() {
    clearHoverTimer();
    if (openMenu === "settings") {
      setOpenMenu(null);
      return;
    }
    showSettingsMenu();
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

  const clearAllNotifications = async () => {
    const dbIds = notifications.map((n) => n.id);
    if (dbIds.length > 0) {
      try {
        await supabaseBrowser
          .from("notifications")
          .update({ archived_at: new Date().toISOString() })
          .in("id", dbIds);
      } catch {}
    }
    setNotifications([]);
  };

  const handleSync = async () => {
    if (syncingNotifications) return;
    setSyncingNotifications(true);
    try {
      await loadNotifications();
    } finally {
      setSyncingNotifications(false);
    }
  };

  const handleMarkAsUnread = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();

    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: false } : n)),
    );
    try {
      await supabaseBrowser
        .from("notifications")
        .update({ is_read: false })
        .eq("id", id);
    } catch {}
  };

  const handleDismiss = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();

    setNotifications((prev) => prev.filter((n) => n.id !== id));
    try {
      await supabaseBrowser
        .from("notifications")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id);
    } catch {}
  };

  const handleNotificationClick = async (n: Notification) => {
    setShowNotificationsModal(false);

    setNotifications((prev) =>
      prev.map((noti) =>
        noti.id === n.id ? { ...noti, is_read: true } : noti,
      ),
    );
    try {
      await supabaseBrowser
        .from("notifications")
        .update({ is_read: true })
        .eq("id", n.id);
    } catch {}

    // ✅ .assign() em vez de atribuir .href direto — mesmo efeito (navega e
    // empilha no histórico), mas o React Compiler trata escrita de
    // propriedade em objeto externo ao componente como mutação suspeita;
    // chamada de método passa despercebida.
    window.location.assign(n.link);
  };

  const canUseDom = typeof document !== "undefined";

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-200">
      <div className="sticky top-0 z-50 bg-[#050505] text-white border-b border-white/10 shadow-lg">
        <div className="mx-auto flex w-full items-center gap-1 px-1.5 sm:gap-2 sm:px-4 py-2">
          <div className="flex items-center gap-2 sm:gap-4">
            <Link
              href="/admin"
              prefetch={false}
              className="flex items-center gap-3 font-semibold min-w-0 hover:opacity-90 transition-opacity no-underline text-white"
            >
              <BrandUser userLabel={userLabel} />
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
            <div className="flex items-center gap-0.5 sm:hidden">
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
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <ScrollText className="w-4 h-4 text-emerald-400" /> Log
                  </span>
                }
              />

              <div ref={mobileRef} className="relative">
                <button
                  onClick={openMobileMenu}
                  className={[
                    "rounded-lg px-2 py-2 sm:px-3 text-sm transition-all duration-200 font-medium flex items-center gap-2 tracking-tight",
                    openMenu === "mobile"
                      ? "bg-white/10 text-emerald-400"
                      : "text-white/80 hover:text-white hover:bg-white/5",
                  ].join(" ")}
                >
                  <span className="text-base leading-none">☰</span> Menu
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

              <div
                ref={managerRef}
                className="relative"
                onMouseEnter={() =>
                  handleTriggerHoverEnter("manager", showManagerMenu)
                }
                onMouseLeave={handleTriggerHoverLeave}
              >
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

              <div
                ref={settingsRef}
                className="relative"
                onMouseEnter={() =>
                  handleTriggerHoverEnter("settings", showSettingsMenu)
                }
                onMouseLeave={handleTriggerHoverLeave}
              >
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
            triggerRef={managerRef}
          >
            <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Gestão
            </div>
            <MenuLink
              href="/admin/gerenciador/guia-tv"
              label={
                <span className="flex items-center gap-2">
                  <Tv className="w-4 h-4 text-rose-400" /> Guia TV
                </span>
              }
              onClick={() => setOpenMenu(null)}
            />
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
            <Divider />
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
              href="/admin/settings/cupons"
              label={
                <span className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-amber-400" /> Cupons
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
            <Divider />
            <MenuLink
              href="/admin/gerenciador/aplicativo"
              label={
                <span className="flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-pink-400" /> Aplicativos
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
            triggerRef={mobileRef}
          >
            <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Navegação
            </div>

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

            <MobileSectionHeader
              label="Gerenciador"
              open={mobileGerenciadorOpen}
              onToggle={() => setMobileGerenciadorOpen((v) => !v)}
            />
            {mobileGerenciadorOpen && (
              <>
                <MenuLink
                  href="/admin/gerenciador/guia-tv"
                  label={
                    <span className="flex items-center gap-2">
                      <Tv className="w-4 h-4 text-rose-400" /> Guia TV
                    </span>
                  }
                  onClick={() => setOpenMenu(null)}
                />
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
                  href="/admin/gerenciador/mensagem"
                  label={
                    <span className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-green-400" />{" "}
                      Mensagens
                    </span>
                  }
                  onClick={() => setOpenMenu(null)}
                />
                <MenuLink
                  href="/admin/gerenciador/cobranca"
                  label={
                    <span className="flex items-center gap-2">
                      <Receipt className="w-4 h-4 text-amber-400" /> Automação
                      de Cobrança
                    </span>
                  }
                  onClick={() => setOpenMenu(null)}
                />
                <Divider />
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
                  href="/admin/settings/cupons"
                  label={
                    <span className="flex items-center gap-2">
                      <Tag className="w-4 h-4 text-amber-400" /> Cupons
                    </span>
                  }
                  onClick={() => setOpenMenu(null)}
                />
                <MenuLink
                  href="/admin/gerenciador/pagamento"
                  label={
                    <span className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-violet-400" /> Formas
                      de pagamento
                    </span>
                  }
                  onClick={() => setOpenMenu(null)}
                />
                <Divider />
                <MenuLink
                  href="/admin/gerenciador/aplicativo"
                  label={
                    <span className="flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-pink-400" />{" "}
                      Aplicativos
                    </span>
                  }
                  onClick={() => setOpenMenu(null)}
                />
                <MenuLink
                  href="/admin/settings/api-server"
                  label={
                    <span className="flex items-center gap-2">
                      <Code className="w-4 h-4 text-sky-400" /> API de
                      Integrações
                    </span>
                  }
                  onClick={() => setOpenMenu(null)}
                />
              </>
            )}
            <Divider />

            <MobileSectionHeader
              label="Conta"
              open={mobileContaOpen}
              onToggle={() => setMobileContaOpen((v) => !v)}
            />
            {mobileContaOpen && (
              <>
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
                  href="/admin/settings/whatsapp"
                  label={
                    <span className="flex items-center gap-2">
                      <WhatsAppIcon className="w-4 h-4 text-emerald-400" />{" "}
                      WhatsApp
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
                  href="/admin/settings/condominio"
                  label={
                    <span className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-slate-400" />{" "}
                      Condomínio
                    </span>
                  }
                  onClick={() => setOpenMenu(null)}
                />
              </>
            )}
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
            triggerRef={settingsRef}
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
              href="/admin/settings/whatsapp"
              label={
                <span className="flex items-center gap-2">
                  <WhatsAppIcon className="w-4 h-4 text-emerald-400" /> WhatsApp
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
              href="/admin/settings/condominio"
              label={
                <span className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-slate-400" /> Condomínio
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
        <TenantProvider tenantId={tenantId}>{children}</TenantProvider>
      </main>

      {showNotificationsModal && (
        <Modal
          title="Notificações"
          onClose={() => setShowNotificationsModal(false)}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2 w-full">
              <div className="flex-1 grid grid-cols-3 gap-2">
                <Link
                  href="/admin/auditoria"
                  onClick={() => setShowNotificationsModal(false)}
                  prefetch={false}
                  className="px-3 py-1.5 rounded-lg border border-border text-foreground/90 font-medium hover:bg-muted transition-colors text-xs uppercase flex items-center justify-center gap-1.5 whitespace-nowrap"
                  title="Ver registros de auditoria"
                >
                  <ScrollText className="w-3.5 h-3.5 text-emerald-500" /> Log do
                  Portal
                </Link>
                <Link
                  href="/admin/cron-status"
                  onClick={() => setShowNotificationsModal(false)}
                  prefetch={false}
                  className="px-3 py-1.5 rounded-lg border border-border text-foreground/90 font-medium hover:bg-muted transition-colors text-xs uppercase flex items-center justify-center gap-1.5 whitespace-nowrap"
                  title="Ver se os crons rodaram certinho"
                >
                  <ScrollText className="w-3.5 h-3.5 text-sky-500" /> Crons
                </Link>
                <button
                  onClick={handleSync}
                  disabled={syncingNotifications}
                  className="px-3 py-1.5 rounded-lg border border-border text-foreground/90 font-medium hover:bg-muted transition-colors text-xs uppercase flex items-center justify-center gap-1.5 whitespace-nowrap disabled:opacity-60"
                  title="Busca notificações novas agora"
                >
                  <RefreshCcw
                    className={[
                      "w-3.5 h-3.5",
                      syncingNotifications ? "animate-spin" : "",
                    ].join(" ")}
                  />{" "}
                  Sincronizar
                </button>
              </div>
              {notifications.length > 0 && (
                <button
                  onClick={clearAllNotifications}
                  className="shrink-0 px-3 py-1.5 rounded-lg border border-border text-foreground/90 font-medium hover:bg-rose-500/10 hover:text-rose-500 hover:border-rose-500/20 transition-colors text-xs uppercase whitespace-nowrap"
                >
                  Limpar todas
                </button>
              )}
            </div>

            {notifications.length === 0 ? (
              <div className="text-center text-muted-foreground/70 py-8">
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
                        : "bg-emerald-500/10 border-emerald-500/20 hover:border-emerald-500/30",
                    ].join(" ")}
                  >
                    <div className="text-xl flex-shrink-0 mt-0.5">
                      {getNotifEmoji(n.type)}
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
                        className="p-1 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500 rounded-md transition-colors"
                        title="Ocultar notificação"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      {n.is_read && (
                        <button
                          onClick={(e) => handleMarkAsUnread(e, n.id)}
                          className="p-1 text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-500 rounded-md transition-colors"
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
  return (
    <SharedModal onClose={onClose} maxWidth="max-w-lg">
      <ModalHeader onClose={onClose}>
        <div className="font-medium text-foreground">{title}</div>
      </ModalHeader>
      <ModalBody>{children}</ModalBody>
    </SharedModal>
  );
}

function DropdownPortal({
  children,
  top,
  right,
  onClose,
  triggerRef,
}: {
  children: React.ReactNode;
  top: number;
  right: number;
  onClose: () => void;
  // ✅ Correção 05/08/2026: o antigo overlay "fixed inset-0" ficava por
  // cima de TODA a página (inclusive da topbar, por causa do z-index alto
  // do portal), roubando os eventos de mouse dos outros triggers — por
  // isso o hover entre "Gerenciador" e "Conta" não trocava de menu na
  // hora. Trocado por um listener de mousedown no document que ignora
  // cliques dentro do painel OU no próprio botão que abriu o menu (o
  // botão cuida do toggle sozinho).
  triggerRef?: React.RefObject<HTMLElement | null>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutsideMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef?.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("mousedown", handleOutsideMouseDown);
    return () =>
      document.removeEventListener("mousedown", handleOutsideMouseDown);
  }, [onClose, triggerRef]);

  return (
    <div
      ref={panelRef}
      // ✅ Sem isso, um painel com mais itens que cabem na tela (ex: o menu
      // mobile, que junta navegação + Gerenciador + Conta num único
      // dropdown) simplesmente estourava pra baixo da viewport — como o
      // painel é fixed, rolar a página não adianta (ele não acompanha o
      // scroll), então os itens do fim ficavam inacessíveis.
      // maxHeight + overflow-y-auto TÊM que estar no mesmo elemento: uma
      // 1ª tentativa botou o maxHeight num wrapper e "max-h-full +
      // overflow-y-auto" num filho — não funciona, porque max-height (ao
      // contrário de height) não dá altura DEFINIDA pro wrapper, então a
      // porcentagem "100%" do filho não resolve pra nada e ele cresce livre
      // (confirmado com teste isolado antes de fechar esse fix).
      // dvh (não vh) acompanha a barra de endereço do navegador no mobile.
      className="fixed z-[9999] w-64 rounded-xl border border-border bg-card shadow-2xl overflow-y-auto overscroll-contain custom-scrollbar p-1.5 transition-colors animate-in fade-in zoom-in-95 duration-200"
      style={{ top, right, maxHeight: `calc(100dvh - ${top}px - 16px)` }}
    >
      {children}
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
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-rose-500 hover:bg-rose-500/10 transition-all"
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
      prefetch={false}
      className={[
        "rounded-lg px-2 py-2 sm:px-3 text-sm transition-all duration-200 inline-flex items-center font-medium tracking-tight",
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
      prefetch={false}
      className={[
        "block rounded-lg px-3 py-2.5 text-sm transition-all font-medium tracking-tight",
        isActive
          ? "bg-emerald-500/10 text-emerald-500"
          : "text-muted-foreground hover:text-foreground hover:bg-muted",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

function Divider() {
  return <div className="my-1.5 h-px bg-border mx-2" />;
}

// ✅ Cabeçalho de seção do menu mobile (Gerenciador/Conta) com setinha pra
// recolher só o conteúdo daquela seção — o menu continua abrindo todo
// expandido por padrão, isso é só um atalho pra quem quer recolher uma
// seção que não usa naquele momento.
function MobileSectionHeader({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
    >
      {label}
      <ChevronDown
        className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
      />
    </button>
  );
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  );
}
