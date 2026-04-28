"use client";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";

const MODULE_META: Record<string, { label: string; icon: string }> = {
  iptv:       { label: "IPTV",       icon: "📺" },
  saas:       { label: "SaaS",       icon: "⚡" },
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
  const [open, setOpen]       = useState(false);
  const [selected, setSelected] = useState<string[]>(currentViews);

  function apply(newSelected: string[]) {
    setOpen(false);
    const effective = newSelected.length === 0 || newSelected.length === availableModules.length
      ? availableModules : newSelected;
    if (effective.length === availableModules.length) router.push(pathname);
    else router.push(`${pathname}?view=${effective.join(",")}`);
  }

  function toggle(key: string) {
    setSelected(prev =>
      prev.includes(key) ? prev.filter(v => v !== key) : [...prev, key]
    );
  }

  const allSelected = selected.length === availableModules.length;
  const label = allSelected ? "Mostrar Tudo"
    : selected.length === 0 ? "Nenhum"
    : selected.map(v => MODULE_META[v]?.label ?? v).join(", ");

  return (
    <div className="relative">
      <button
        onClick={() => open ? apply(selected) : setOpen(true)}
        className="flex items-center gap-2 h-9 px-3 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm font-bold text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-white/10 transition-colors shadow-sm"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/>
        </svg>
        <span className="max-w-[180px] truncate">{label}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => apply(selected)} />
          <div className="absolute right-0 top-11 z-50 w-52 bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl p-1.5 space-y-0.5">

            {/* Mostrar Tudo */}
            <button
              onClick={() => setSelected(availableModules)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold hover:bg-slate-50 dark:hover:bg-white/5 text-slate-700 dark:text-white"
            >
              <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0 ${allSelected ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300 dark:border-white/20"}`}>
                {allSelected && "✓"}
              </span>
              Mostrar Tudo
            </button>

            <div className="h-px bg-slate-100 dark:bg-white/5 mx-2 my-1" />

            {availableModules.map(key => {
              const active = selected.includes(key);
              const meta = MODULE_META[key];
              return (
                <button key={key} onClick={() => toggle(key)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold hover:bg-slate-50 dark:hover:bg-white/5 text-slate-700 dark:text-white"
                >
                  <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0 transition-colors ${active ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300 dark:border-white/20"}`}>
                    {active && "✓"}
                  </span>
                  <span>{meta?.icon}</span>
                  <span>{meta?.label}</span>
                </button>
              );
            })}

            <div className="h-px bg-slate-100 dark:bg-white/5 mx-2 my-1" />
            <button onClick={() => apply(selected)}
              className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors"
            >
              Aplicar
            </button>
          </div>
        </>
      )}
    </div>
  );
}