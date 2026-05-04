"use client";

import { useEffect } from "react";
import { useModules } from "@/lib/modules/ModulesContext";

export default function TenantHead() {
  const { slug, logoUrl, tenantName, hasIPTVorSaaS, hasFinanceiro, isOnlyFinanceiro } = useModules();

  useEffect(() => {
    // ── Título da aba ──────────────────────────────────────────────────
    const display = tenantName || slug || "UniGestor";
    document.title = `${display} | UniGestor`;

    // ── Favicon ───────────────────────────────────────────────────────
    // Remove favicons existentes
    document.querySelectorAll("link[rel~='icon']").forEach(el => el.remove());

    const link = document.createElement("link");
    link.rel = "icon";
    // Se o tenant tem logo própria, usa ela. Senão, usa o padrão da UniGestor.
    link.href = logoUrl || "/favicon.ico";
    document.head.appendChild(link);
  }, [slug, logoUrl, tenantName]);

  // Componente invisível — só efeito colateral
  return null;
}