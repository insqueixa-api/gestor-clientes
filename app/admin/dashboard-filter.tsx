"use client";
import { useRouter, usePathname } from "next/navigation";

const MODULES_META: Record<string, { label: string; icon: string }> = {
  iptv:       { label: "IPTV",       icon: "📺" },
  financeiro: { label: "Financeiro", icon: "📊" },
};

export function DashboardFilter({
  availableModules,
  currentViews,
}: {
  availableModules: string[];
  currentViews: string[];
}) {
  const router   = useRouter();
  const pathname = usePathname();

  function toggle(key: string) {
    const isActive = currentViews.includes(key);
    let next: string[];
    if (isActive) {
      next = currentViews.filter(v => v !== key);
    } else {
      next = [...currentViews, key];
    }

    // Não permite desabilitar tudo (pelo menos 1 ativo)
    if (next.length === 0) return;

    if (next.length === availableModules.length) {
      router.push(pathname);
    } else {
      router.push(`${pathname}?view=${next.join(",")}`);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {availableModules.map(key => {
        const active = currentViews.includes(key);
        const meta = MODULES_META[key] ?? { label: key, icon: "❓" };
        return (
          <button
            key={key}
            onClick={() => toggle(key)}
            className={`flex items-center gap-2 h-9 px-3 rounded-lg border text-sm font-bold transition-all shadow-sm ${
              active
                ? "bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600"
                : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/40 hover:text-slate-700 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/10"
            }`}
            title={active ? `Ocultar ${meta.label}` : `Mostrar ${meta.label}`}
          >
            <span>{meta.icon}</span>
            <span>{meta.label}</span>
            {active && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}
