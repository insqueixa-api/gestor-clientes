"use client";

import Link from "next/link";
import Image from "next/image";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react"; // ✅ Adicionado useEffect
import { supabaseBrowser } from "@/lib/supabase/browser"; // ✅ Import do banco
import { usePathname } from "next/navigation";
import React from "react";
import SaasProfileRenewModal from "./settings/profile/SaasProfileRenewModal"; // ✅ NOVO IMPORT DO MODAL

function daysUntil(s?: string | null): number | null {
  if (!s) return null;
  // ✅ Método à prova de balas: extrai DIA/MÊS/ANO exatos no fuso de São Paulo
  const target = new Date(s);
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' });
  
  const [d1, m1, y1] = fmt.format(target).split('/');
  const [d2, m2, y2] = fmt.format(now).split('/');
  
  const tDate = new Date(Number(y1), Number(m1) - 1, Number(d1));
  const nDate = new Date(Number(y2), Number(m2) - 1, Number(d2));
  
  return Math.round((tDate.getTime() - nDate.getTime()) / 86400000);
}


// Componente que exibe Logo + Nome do Usuário (agora vem do SERVER)
function BrandUser({ userLabel, tenantName }: { userLabel: string; tenantName: string }) {
  return (
    <div className="flex items-center gap-3 min-w-0 text-white cursor-pointer group">
            {/* Mobile: logo curta */}
      <Image
        src="/brand/logo-gestor-celular.png"
        alt="Gestor"
        width={44}
        height={44}
        className="h-10 w-10 select-none object-contain sm:hidden transition-transform group-hover:scale-105"
        draggable={false}
        priority
      />

      {/* Desktop: logo completa */}
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
        <div className="text-[10px] uppercase tracking-wider text-white/40 font-bold leading-none mb-0.5 group-hover:text-white/60 transition-colors">
          Logado como
        </div>

        {/* ✅ AQUI: Adicionei 'uppercase' e removi a div de baixo que repetia informação */}
        <div className="text-xs font-bold text-white truncate max-w-50 sm:max-w-66 tracking-tight group-hover:text-emerald-400 transition-colors uppercase">
          {userLabel}
        </div>
      </div>
    </div>
  );
}


export default function AdminShell({
  children,
  userLabel,
  tenantName,
  role,
  financialControlEnabled,
  tenantId, // ✅ NOVAS PROPS
  expiresAt,
  creditBalance,
  saasPlanTableId,
  whatsappSessions,
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
}) {
  const [openMenu, setOpenMenu] = useState<null | "manager" | "settings" | "mobile">(null);
  
  // ✅ Controle do Modal de Renovação Pelo Sino
  const [showRenewModal, setShowRenewModal] = useState(false);
  // ✅ Controle do Modal de Aviso (O "Hulk")
  const [showWarningModal, setShowWarningModal] = useState(false);

  const [localExpiresAt, setLocalExpiresAt] = useState<string | null>(expiresAt ?? null);

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

  const settingsActive = useMemo(() => pathname.startsWith("/admin/settings"), [pathname]);

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


  const canUseDom = typeof document !== "undefined";

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0f141a] text-slate-800 dark:text-white transition-colors duration-200">
      {/* TOP NAV */}
      <div className="sticky top-0 z-50 bg-[#050505] text-white border-b border-white/10 shadow-lg">
        {/* Adicionado mx-auto e max-w-screen-2xl */}
        <div className="mx-auto flex w-full max-w-screen-2xl items-center gap-2 px-2 sm:px-6 lg:px-8 py-2">

          <div className="flex items-center gap-4">
            <Link
              href="/admin"
              className="flex items-center gap-3 font-semibold min-w-0 hover:opacity-90 transition-opacity no-underline"
            >
              <BrandUser userLabel={userLabel} tenantName={tenantName} />
            </Link>

            {/* ✅ SINO DE ALERTA DE VENCIMENTO (Apenas o ícone piscando) */}
            {role !== "SUPERADMIN" && (() => {
              const dias = daysUntil(localExpiresAt);
              if (dias !== null && dias <= 7) {
                const isDanger = dias <= 0;
                const colorClass = isDanger 
                  ? "bg-rose-100 text-rose-600 border-rose-200 hover:bg-rose-200 dark:bg-rose-500/20 dark:text-rose-400 dark:border-rose-500/30" 
                  : "bg-amber-100 text-amber-600 border-amber-200 hover:bg-amber-200 dark:bg-amber-500/20 dark:text-amber-400 dark:border-amber-500/30";
                  
                return (
                  <button
                    onClick={() => setShowWarningModal(true)}
                    className={`flex items-center justify-center w-8 h-8 rounded-full border shadow-sm transition-colors animate-pulse ${colorClass}`}
                    title="Aviso de Vencimento"
                  >
                    <span className="text-sm leading-none">🔔</span>
                  </button>
                );
              }
              return null;
            })()}
          </div>

          <div className="flex-1" />

          <nav className="flex items-center gap-1 text-sm whitespace-nowrap">
            {/* ✅ MOBILE: mostra só Clientes + Menu */}
            <div className="flex items-center gap-1 sm:hidden">
              <NavLink href="/admin/cliente" label="👥 Clientes" />

              <div ref={mobileRef} className="relative">
                <button
                  onClick={openMobileMenu}
                  className={[
                    "rounded-lg px-3 py-2 text-sm transition-all duration-200 font-bold flex items-center gap-2 tracking-tight",
                    openMenu === "mobile"
                      ? "bg-white/15 text-emerald-400"
                      : "text-white/70 hover:text-white hover:bg-white/5",
                  ].join(" ")}
                >
                  <span className="text-base leading-none">☰</span> Menu{" "}
                  <span
                    className={[
                      "transition-transform duration-200 text-[8px] opacity-40",
                      openMenu === "mobile" ? "rotate-180" : "",
                    ].join(" ")}
                  >
                    
                  </span>
                </button>
              </div>
            </div>

            {/* ✅ DESKTOP: mantém tudo */}
            <div className="hidden sm:flex items-center gap-1">
              <NavLink href="/admin" label="📊 Dashboard" />
              <NavLink href="/admin/cliente" label="👥 Clientes" />
              <NavLink href="/admin/revendedor" label="🤝 Revendas" />
              <NavLink href="/admin/teste" label="🕒 Testes" />

              <div className="w-px h-6 bg-white/10 mx-2" />

              <div ref={managerRef} className="relative">
                <button
                  onClick={openManager}
                  className={[
                    "rounded-lg px-3 py-2 text-sm transition-all duration-200 font-bold flex items-center gap-2 tracking-tight",
                    managerActive
                      ? "bg-white/15 text-emerald-400"
                      : "text-white/70 hover:text-white hover:bg-white/5",
                  ].join(" ")}
                >
                  <span>🛠️</span> Gerenciador{" "}
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
                    "rounded-lg px-3 py-2 text-sm transition-all duration-200 font-bold flex items-center gap-2 tracking-tight",
                    settingsActive
                      ? "bg-white/15 text-emerald-400"
                      : "text-white/70 hover:text-white hover:bg-white/5",
                  ].join(" ")}
                >
                  <span>⚙️</span> <span className="hidden sm:inline">Conta</span>{" "}
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

      {/* Dropdowns */}
      {canUseDom && openMenu === "manager" && managerPos &&
        createPortal(
          <DropdownPortal right={managerPos.right} top={managerPos.top} onClose={() => setOpenMenu(null)}>
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/30">
              Gestão
            </div>
            <MenuLink href="/admin/gerenciador/servidor" label="🖥️ Servidores" onClick={() => setOpenMenu(null)} />
            <MenuLink href="/admin/gerenciador/plano" label="🛒 Planos" onClick={() => setOpenMenu(null)} />
            <MenuLink 
  href="/admin/gerenciador/mensagem" 
  label={
    <span className="flex items-center gap-2">
      <span className="text-emerald-500 dark:text-emerald-400">
        <IconWhatsApp />
      </span>
      Mensagens WhatsApp
    </span>
  } 
  onClick={() => setOpenMenu(null)} 
/>
            <Divider />
            <MenuLink href="/admin/gerenciador/cobranca" label="💵 Automação de Cobrança" onClick={() => setOpenMenu(null)} />
            <MenuLink href="/admin/gerenciador/pagamento" label="💳 Formas de pagamento" onClick={() => setOpenMenu(null)} />
            <MenuLink href="/admin/gerenciador/aplicativo" label="📱 Aplicativos" onClick={() => setOpenMenu(null)} />
          </DropdownPortal>,
          document.body
        )
      }

            {canUseDom && openMenu === "mobile" && mobilePos &&
        createPortal(
          <DropdownPortal right={mobilePos.right} top={mobilePos.top} onClose={() => setOpenMenu(null)}>
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/30">
              Navegação 
            </div>

            <MenuLink href="/admin" label="📊 Dashboard" onClick={() => setOpenMenu(null)} />
            <MenuLink href="/admin/cliente" label="👥 Clientes" onClick={() => setOpenMenu(null)} />
            <MenuLink href="/admin/revendedor" label="🤝 Revendas" onClick={() => setOpenMenu(null)} />
            <MenuLink href="/admin/teste" label="🕒 Testes" onClick={() => setOpenMenu(null)} />

            <Divider />

            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/30">
              Gerenciador
            </div>
            <MenuLink href="/admin/gerenciador/servidor" label="🖥️ Servidores" onClick={() => setOpenMenu(null)} />
            <MenuLink href="/admin/gerenciador/plano" label="🛒 Planos" onClick={() => setOpenMenu(null)} />
            <MenuLink 
  href="/admin/gerenciador/mensagem" 
  label={
    <span className="flex items-center gap-2">
      <span className="text-emerald-500 dark:text-emerald-400">
        <IconWhatsApp />
      </span>
      Mensagens WhatsApp
    </span>
  } 
  onClick={() => setOpenMenu(null)} 
/>
            <MenuLink href="/admin/gerenciador/cobranca" label="💵 Cobrança" onClick={() => setOpenMenu(null)} />
            <MenuLink href="/admin/gerenciador/pagamento" label="💳 Formas de pagamento" onClick={() => setOpenMenu(null)} />
            <MenuLink href="/admin/gerenciador/aplicativo" label="📱 Aplicativos" onClick={() => setOpenMenu(null)} />
            <Divider />

            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/30">
              Conta
            </div>
            <MenuLink href="/admin/settings/profile" label="👤 Perfil" onClick={() => setOpenMenu(null)} />
            
            {/* ✅ APARECE SE O CONTROLE FINANCEIRO ESTIVER HABILITADO */}
            {financialControlEnabled && (
              <MenuLink href="/admin/settings/financeiro_pessoal" label="💰 Controle Financeiro" onClick={() => setOpenMenu(null)} />
            )}

            {/* ✅ OCULTA GESTÃO SAAS SE FOR USER */}
            {role !== "USER" && (
              <MenuLink href="/admin/settings/gestao_saas" label="🚀 Gestão SaaS" onClick={() => setOpenMenu(null)} />
            )}

            <MenuLink href="/admin/settings/api-server" label="🔌 API Servidor" onClick={() => setOpenMenu(null)} />
            <Divider />
            <LogoutLink onLogout={() => setOpenMenu(null)} />
          </DropdownPortal>,
          document.body
        )
      }


      {canUseDom && openMenu === "settings" && settingsPos &&
        createPortal(
          <DropdownPortal right={settingsPos.right} top={settingsPos.top} onClose={() => setOpenMenu(null)}>
            <MenuLink href="/admin/settings/profile" label="👤 Perfil" onClick={() => setOpenMenu(null)} />
            
            {/* ✅ APARECE SE O CONTROLE FINANCEIRO ESTIVER HABILITADO */}
            {financialControlEnabled && (
              <MenuLink href="/admin/settings/financeiro_pessoal" label="💰 Controle Financeiro" onClick={() => setOpenMenu(null)} />
            )}

            {/* ✅ OCULTA GESTÃO SAAS SE FOR USER */}
            {role !== "USER" && (
              <MenuLink href="/admin/settings/gestao_saas" label="🚀 Gestão SaaS" onClick={() => setOpenMenu(null)} />
            )}

            <MenuLink href="/admin/settings/api-server" label="🔌 API Servidor" onClick={() => setOpenMenu(null)} />
            <Divider />
            <LogoutLink onLogout={() => setOpenMenu(null)} />
          </DropdownPortal>,
          document.body
        )
      }


      {/* Adicionado mx-auto e max-w-screen-2xl */}
      <main className="mx-auto w-full max-w-screen-2xl px-2 sm:px-6 lg:px-8 pt-2 pb-6 animate-in fade-in duration-500">
        {children}
      </main>

      {/* ✅ O "HULK" - MODAL DE AVISO DE VENCIMENTO */}
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
                      
                      // Extrai os dados para a formatação inteligente
                      const [y, m, d] = localExpiresAt.split("T")[0].split("-").map(Number);
                      const dateObj = new Date(y, m - 1, d);
                      const dateStr = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(dateObj);
                      const weekDayStr = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(dateObj).replace("-feira", " feira");
                      
                      if (dias < 0) {
                        return <>Seu painel venceu na <strong>{weekDayStr}</strong> dia <strong>{dateStr}</strong>, e já está vencido há <strong>{Math.abs(dias)}</strong> dia(s)!</>;
                      } else if (dias === 0) {
                        return <>Seu painel vence <strong>HOJE</strong>, dia <strong>{dateStr}</strong>!</>;
                      } else {
                        return <>Seu painel vence na <strong>{weekDayStr}</strong> dia <strong>{dateStr}</strong>, você tem <strong>{dias}</strong> para antecipar a renovação.</>;
                      }
                    })()}
                  </p>
                  <p className="text-slate-500 dark:text-white/60 text-xs mt-1">
                    Renove agora mesmo para evitar o bloqueio automático e manter seus serviços funcionando sem interrupções.
                  </p>
                </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowWarningModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-white/10 text-slate-700 dark:text-white font-bold hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-xs uppercase"
              >
                Fechar
              </button>

              <button
                onClick={() => {
                  setShowWarningModal(false);
                  setShowRenewModal(true); // ✅ Abre o modal de renovação
                }}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-500 transition-colors text-xs uppercase shadow-lg shadow-emerald-900/20"
              >
                Renovar Agora
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ✅ MODAL DE RENOVAÇÃO DO SINO */}
      {showRenewModal && tenantId && (
        <SaasProfileRenewModal
          tenantId={tenantId}
          role={role as "MASTER" | "USER"}
          saasPlanTableId={saasPlanTableId ?? null}
          creditBalance={creditBalance ?? 0}
          currentExpiry={expiresAt ?? null}
          whatsappSessions={whatsappSessions ?? 1}
          onClose={() => setShowRenewModal(false)}
          onSuccess={() => {
            setShowRenewModal(false);
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}

/* --- Componentes Auxiliares --- */

// ✅ Componente Genérico Modal (Copiado da Tela de Clientes)
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
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
        <div className="w-64 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#161b22] shadow-2xl overflow-hidden p-1.5 transition-colors">
          {children}
        </div>
      </div>
    </div>
  );
}

function LogoutLink({ onLogout }: { onLogout?: () => void }) {
  const handleLogout = () => {
    onLogout?.();
    window.location.href = "/logout";
  };

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-all"
    >
      <span className="opacity-70 group-hover:scale-110 transition-transform text-base">🚪</span> Sair da conta
    </button>
  );
}

function NavLink({ href, label }: { href: string; label: React.ReactNode }) {
  const pathname = usePathname();
  // Se for a home do admin, checa o path exato. Senão, checa se começa com o href.
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
function IconWhatsApp() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      <path d="M9 10c0 .5.5 1.5 1.5 2.5s2 1.5 2.5 1.5.5 0 .5-.5" />
    </svg>
  );
}
