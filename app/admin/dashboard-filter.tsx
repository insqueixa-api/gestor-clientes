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
    const next = isActive
      ? currentViews.filter(v => v !== key)
      : [...currentViews, key];

    if (next.length === 0) return;

    if (next.length === availableModules.length) {
      router.push(pathname);
    } else {
      router.push(`${pathname}?view=${next.join(",")}`);
    }
  }

  return (
    <div className="flex bg-slate-100 dark:bg-black/30 p-1 rounded-xl border border-slate-200 dark:border-white/5">
      {availableModules.map(key => {
        const active = currentViews.includes(key);
        const meta = MODULES_META[key] ?? { label: key, icon: "❓" };
        return (
          <button
            key={key}
            onClick={() => toggle(key)}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              active
                ? "bg-white dark:bg-[#161b22] text-emerald-600 dark:text-white shadow-sm"
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