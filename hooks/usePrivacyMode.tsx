"use client";
// hooks/usePrivacyMode.tsx
// ✅ 13/10/2026, pedido do Márcio: "modo oculto" UNIVERSAL do admin. Antes
// cada tela tinha o seu olho (useState local) que voltava a mostrar tudo ao
// trocar de página. Agora é um estado só, ligado/desligado de qualquer
// página (olho fixo no topo do admin ou o olho de cada tela) e lembrado no
// navegador (localStorage) — continua oculto ao navegar e ao recarregar.
//
// Duas formas de usar numa tela:
//   1) const { valuesHidden } = usePrivacyMode()  → classe condicional
//   2) className="sensitive" → borrado pelo CSS global (app/globals.css)
//      quando <html data-privacy="on">, sem precisar do hook.
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "ug_privacy_mode";

type PrivacyCtx = {
  valuesHidden: boolean;
  setValuesHidden: (v: boolean | ((prev: boolean) => boolean)) => void;
  toggle: () => void;
};

const PrivacyContext = createContext<PrivacyCtx | null>(null);

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const [valuesHidden, setHidden] = useState(false);

  // lê a escolha salva logo ao montar (antes dos dados das telas chegarem)
  useEffect(() => {
    setHidden(readStored());
  }, []);

  useEffect(() => {
    document.documentElement.dataset.privacy = valuesHidden ? "on" : "off";
    try {
      window.localStorage.setItem(STORAGE_KEY, valuesHidden ? "1" : "0");
    } catch {}
  }, [valuesHidden]);

  // outra aba mudou o modo → acompanha
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setHidden(e.newValue === "1");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setValuesHidden = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setHidden((prev) => (typeof v === "function" ? (v as (p: boolean) => boolean)(prev) : v));
  }, []);
  const toggle = useCallback(() => setHidden((p) => !p), []);

  return <PrivacyContext.Provider value={{ valuesHidden, setValuesHidden, toggle }}>{children}</PrivacyContext.Provider>;
}

/** Fora do admin (sem provider) devolve "sempre visível" — nunca quebra. */
export function usePrivacyMode(): PrivacyCtx {
  const ctx = useContext(PrivacyContext);
  return ctx ?? { valuesHidden: false, setValuesHidden: () => {}, toggle: () => {} };
}
