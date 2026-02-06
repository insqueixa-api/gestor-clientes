"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type AppTheme = "light" | "dark";

type ThemeCtx = {
  theme: AppTheme;
  setTheme: (t: AppTheme) => void;
  toggleTheme: () => void;
  openWhatsApp: (phone: string, message: string) => void;
};

const ThemeContext = createContext<ThemeCtx | null>(null);

/**
 * Aplica o tema no elemento raiz para que os tokens do theme.css 
 * e as classes dark: do Tailwind funcionem perfeitamente.
 */
function applyTheme(t: AppTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = t;
  
  // Garante que a classe 'dark' também seja alternada para suporte total ao Tailwind
  if (t === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
}: {
  children: React.ReactNode;
  defaultTheme?: AppTheme;
}) {
  const [theme, setThemeState] = useState<AppTheme>(defaultTheme);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("app_theme") as AppTheme;
    const initial = stored || defaultTheme;
    setThemeState(initial);
    applyTheme(initial);
    setMounted(true);
  }, [defaultTheme]);

  const api = useMemo<ThemeCtx>(() => {
    return {
      theme,
      setTheme: (t) => {
        setThemeState(t);
        applyTheme(t);
        localStorage.setItem("app_theme", t);
      },
      toggleTheme: () => {
        const next: AppTheme = theme === "dark" ? "light" : "dark";
        setThemeState(next);
        applyTheme(next);
        localStorage.setItem("app_theme", next);
      },
      openWhatsApp: (phone, message) => {
        const url = `https://api.whatsapp.com/send?phone=${phone.replace(/\D/g, "")}&text=${encodeURIComponent(message)}`;
        window.open(url, "_blank");
      }
    };
  }, [theme]);

  // Evita o efeito de "flash" de tema incorreto e erros de hidratação
  if (!mounted) {
    return <div style={{ visibility: "hidden" }}>{children}</div>;
  }

  return <ThemeContext.Provider value={api}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  
  // Fallback seguro para evitar que o projeto quebre se o hook for chamado fora do Provider
  // Mantida a correção para o setTheme conforme seu ajuste anterior
  return ctx || { 
    theme: 'light', 
    setTheme: () => {}, 
    toggleTheme: () => {}, 
    openWhatsApp: () => {} 
  } as ThemeCtx;
}