"use client";

import Link from "next/link";
import Image from "next/image";
import { createPortal } from "react-dom";
import { useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

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
}: {
  children: React.ReactNode;
  userLabel: string;
  tenantName: string;
}) {
  const [openMenu, setOpenMenu] = useState<null | "manager" | "settings" | "mobile">(null);

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

          <Link
            href="/admin"
            className="flex items-center gap-3 font-semibold min-w-0 hover:opacity-90 transition-opacity no-underline"
          >
            <BrandUser userLabel={userLabel} tenantName={tenantName} />
          </Link>

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
              <NavLink href="/admin/teste" label="🧪 Testes" />

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
            <MenuLink href="/admin/gerenciador/plano" label="📦 Planos" onClick={() => setOpenMenu(null)} />
            <MenuLink href="/admin/gerenciador/mensagem" label="💬 Mensagem padrão" onClick={() => setOpenMenu(null)} />
            <Divider />
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/30">
              Financeiro
            </div>
            <MenuLink href="/admin/gerenciador/cobranca" label="🧾 Cobrança" onClick={() => setOpenMenu(null)} />
            <MenuLink href="/admin/gerenciador/pagamento" label="💳 Formas de pagamento" onClick={() => setOpenMenu(null)} />
            <Divider />
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
            <MenuLink href="/admin/teste" label="🧪 Testes" onClick={() => setOpenMenu(null)} />

            <Divider />

            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/30">
              Gerenciador
            </div>
            <MenuLink href="/admin/gerenciador/servidor" label="🖥️ Servidores" onClick={() => setOpenMenu(null)} />
            <MenuLink href="/admin/gerenciador/plano" label="📦 Planos" onClick={() => setOpenMenu(null)} />
            <MenuLink href="/admin/gerenciador/mensagem" label="💬 Mensagem padrão" onClick={() => setOpenMenu(null)} />
            <MenuLink href="/admin/gerenciador/cobranca" label="🧾 Cobrança" onClick={() => setOpenMenu(null)} />
            <MenuLink href="/admin/gerenciador/pagamento" label="💳 Formas de pagamento" onClick={() => setOpenMenu(null)} />
            <MenuLink href="/admin/gerenciador/aplicativo" label="📱 Aplicativos" onClick={() => setOpenMenu(null)} />

            <Divider />

            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/30">
              Conta
            </div>
            <MenuLink href="/admin/settings/profile" label="👤 Perfil" onClick={() => setOpenMenu(null)} />
            <MenuLink href="/admin/settings/api-bank" label="🏦 API Banco" onClick={() => setOpenMenu(null)} />
            <MenuLink href="/admin/settings/api-server" label="🧩 API Servidor" onClick={() => setOpenMenu(null)} />

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
            
            <Divider />
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/30">
              Integrações
            </div>
            <MenuLink href="/admin/settings/api-bank" label="🏦 API Banco" onClick={() => setOpenMenu(null)} />
            <MenuLink href="/admin/settings/api-server" label="🧩 API Servidor" onClick={() => setOpenMenu(null)} />
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
    </div>
  );
}

/* --- Componentes Auxiliares --- */

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

function NavLink({ href, label }: { href: string; label: string }) {
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

function MenuLink({
  href,
  label,
  onClick,
}: {
  href: string;
  label: string;
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
