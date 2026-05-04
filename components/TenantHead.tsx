"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useModules } from "@/lib/modules/ModulesContext";

// Mapa de rota → nome legível da página
const PAGE_NAMES: Record<string, string> = {
  "/admin":                              "Dashboard",
  "/admin/cliente":                      "Clientes",
  "/admin/revendedor":                   "Revendas",
  "/admin/teste":                        "Testes",
  "/admin/gerenciador/servidor":         "Servidores",
  "/admin/gerenciador/plano":            "Planos",
  "/admin/gerenciador/mensagem":         "Mensagens",
  "/admin/gerenciador/cobranca":         "Automação",
  "/admin/gerenciador/pagamento":        "Pagamento",
  "/admin/gerenciador/aplicativo":       "Aplicativos",
  "/admin/settings/profile":            "Perfil",
  "/admin/settings/financeiro_pessoal": "Financeiro",
  "/admin/settings/gestao_saas":        "Gestão SaaS",
  "/admin/settings/api-server":         "API",
};

function getPageName(pathname: string): string {
  // Tenta match exato primeiro
  if (PAGE_NAMES[pathname]) return PAGE_NAMES[pathname];
  // Tenta match por prefixo (para sub-rotas dinâmicas)
  const match = Object.keys(PAGE_NAMES)
    .sort((a, b) => b.length - a.length) // mais específico primeiro
    .find(key => pathname.startsWith(key));
  return match ? PAGE_NAMES[match] : "Painel";
}

export default function TenantHead() {
  const { slug, logoUrl } = useModules();
  const pathname = usePathname();

  // Favicon
  useEffect(() => {
    document.querySelectorAll(
      "link[rel='icon'], link[rel='shortcut icon'], link[rel='apple-touch-icon']"
    ).forEach(el => el.remove());

    const link = document.createElement("link");
    link.rel = "icon";
    link.href = logoUrl ? `${logoUrl}?v=${Date.now()}` : "/favicon.ico";
    document.head.insertBefore(link, document.head.firstChild);
  }, [logoUrl]);

  // Título — MutationObserver impede o Next.js de sobrescrever
  useEffect(() => {
    const pageName = getPageName(pathname);
    const tenantSlug = slug
      ? slug.charAt(0).toUpperCase() + slug.slice(1)
      : "UniGestor";
    const desiredTitle = `${tenantSlug} | ${pageName}`;

    document.title = desiredTitle;

    // Observa o <head> inteiro — captura quando o Next.js
    // remove e recria o <title> durante navegação RSC
    const observer = new MutationObserver(() => {
      if (document.title !== desiredTitle) {
        document.title = desiredTitle;
      }
    });

    observer.observe(document.head, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [pathname, slug]);

  return null;
}