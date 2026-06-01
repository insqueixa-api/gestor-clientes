"use client";
import { useRouter, usePathname } from "next/navigation";

const MODULES_META: Record<string, { label: string; icon: string }> = {
  iptv: { label: "IPTV", icon: "📺" },
  financeiro: { label: "Financeiro", icon: "📊" },
};

export function DashboardFilter({
  availableModules,
  currentViews,
}: {
  availableModules: string[];
  currentViews: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  function select(key: string) {
    if (currentViews.length === 1 && currentViews[0] === key) return; // já ativo, ignora
    router.push(`${pathname}?view=${key}`);
  }

  return (
    <div className="flex bg-slate-100 dark:bg-black/30 p-1 rounded-xl border border-slate-200 dark:border-border">
      {availableModules.map((key) => {
        const active = currentViews.length === 1 && currentViews[0] === key;
        const meta = MODULES_META[key] ?? { label: key, icon: "❓" };
        return (
          <button
            key={key}
            onClick={() => select(key)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1.5 ${
              active
                ? "bg-white dark:bg-card text-emerald-600 dark:text-white shadow-sm"
                : "text-slate-500 dark:text-white/50 hover:text-slate-800 dark:hover:text-white/80"
            }`}
          >
            <span>{meta.icon}</span>
            <span>{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
