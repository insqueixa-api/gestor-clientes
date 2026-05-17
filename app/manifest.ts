import { MetadataRoute } from 'next'
import { createClient } from "@/lib/supabase/server";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Valores padrão (Fallback)
  let appName = "UniGestor";
  let shortName = "UniGestor";
  let themeColor = "#050505";
  
  // Apontando para o diretório correto que vimos no AdminShell
  // Voltando para os ícones quadrados perfeitos na raiz
// Apontando para dentro da pasta brand (VERSÃO AZUL)
  let iconAny192 = "/brand/icon-192x192blue.png";
  let iconAny512 = "/brand/icon-512x512blue.png";
  let iconMask192 = "/brand/icon-192x192.png";
  let iconMask512 = "/brand/icon-512x512.png";

  if (user) {
    const { data: member } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (member?.tenant_id) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("name, slug, logo_url, primary_color")
        .eq("id", member.tenant_id)
        .maybeSingle();

      if (tenant) {
        appName = tenant.name || appName;
        shortName = tenant.slug ? tenant.slug.charAt(0).toUpperCase() + tenant.slug.slice(1) : shortName;
        themeColor = tenant.primary_color || themeColor;

        if (tenant.logo_url) {
          iconAny192 = iconAny512 = iconMask192 = iconMask512 = tenant.logo_url;
        }
      }
    }
  }

  // O Next.js já sabe que isso vai virar o arquivo /manifest.webmanifest
  return {
    name: appName,
    short_name: shortName,
    description: "Plataforma de Gestão",
    start_url: "/admin",
    display: "standalone",
    background_color: "#0f141b",
    theme_color: themeColor,
    icons: [
      {
        src: iconAny192,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: iconAny512,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: iconMask192,
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: iconMask512,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}