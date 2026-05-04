"use client";

import { createContext, useContext, useMemo } from "react";
import { PERMISSIONS, type Module, type PermissionKey } from "./permissions";

interface ModulesContextValue {
  modules: Module[];
  can: (key: PermissionKey) => boolean;
  hasModule: (mod: Module) => boolean;
  // Helpers prontos mais usados
  hasIPTV: boolean;
  hasSaaS: boolean;
  hasIPTVorSaaS: boolean;
  hasFinanceiro: boolean;
  hasAcademia: boolean;
  hasPersonal: boolean;
  hasCondominio: boolean;
  isOnlyFinanceiro: boolean;
  hasAlunos: boolean;
}

const ModulesContext = createContext<ModulesContextValue | null>(null);

export function ModulesProvider({
  children,
  activeModules,
}: {
  children: React.ReactNode;
  activeModules: string[];
}) {
  const value = useMemo<ModulesContextValue>(() => {
    const modules = activeModules.map(m => (m || "").toLowerCase()) as Module[];

    const hasModule = (mod: Module) => modules.includes(mod);
    const can = (key: PermissionKey) =>
      PERMISSIONS[key].some(mod => modules.includes(mod));

    const hasIPTV       = hasModule("iptv");
    const hasSaaS       = hasModule("saas");
    const hasFinanceiro = hasModule("financeiro");
    const hasAcademia   = hasModule("academia");
    const hasPersonal   = hasModule("personal");
    const hasCondominio = hasModule("condominio");

    return {
      modules,
      can,
      hasModule,
      hasIPTV,
      hasSaaS,
      hasIPTVorSaaS:    hasIPTV || hasSaaS,
      hasFinanceiro,
      hasAcademia,
      hasPersonal,
      hasCondominio,
      isOnlyFinanceiro: modules.length > 0 && modules.every(m => m === "financeiro"),
      hasAlunos:        hasAcademia || hasPersonal,
    };
  }, [activeModules]);

  return (
    <ModulesContext.Provider value={value}>
      {children}
    </ModulesContext.Provider>
  );
}

export function useModules() {
  const ctx = useContext(ModulesContext);
  if (!ctx) throw new Error("useModules deve ser usado dentro de ModulesProvider");
  return ctx;
}