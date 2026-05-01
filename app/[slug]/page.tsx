"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
// Importe seus componentes de UI (botões, inputs) conforme necessário

export default function TenantLoginPage() {
  const params = useParams();
  const slug = params.slug as string; // Aqui ele pega a palavra "triade" da URL

  const [tenantData, setTenantData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTenantBrand() {
      if (!slug) return;
      
      // Busca as configurações públicas da marca usando o slug
      // (Lembre-se de configurar o RLS no Supabase para permitir leitura anônima dessas colunas)
      const { data, error } = await supabaseBrowser
        .from("tenants")
        .select("id, name, logo_url, brand_color")
        .eq("slug", slug)
        .single();

      if (data) {
        setTenantData(data);
      }
      setLoading(false);
    }
    loadTenantBrand();
  }, [slug]);

  if (loading) return <div className="min-h-screen bg-slate-50 dark:bg-[#0f141a]" />;

  if (!tenantData) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Página não encontrada. Verifique o endereço.
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
      <div className="w-full max-w-md p-8 bg-white rounded-2xl shadow-xl text-center">
        
        {/* A MÁGICA: Renderiza a logo do cliente ou o nome dele */}
        {tenantData.logo_url ? (
          <img src={tenantData.logo_url} alt={tenantData.name} className="h-16 mx-auto mb-6" />
        ) : (
          <h1 className="text-2xl font-bold mb-6 text-slate-800">{tenantData.name}</h1>
        )}

        <p className="text-sm text-slate-500 mb-6">Acesse a área do aluno</p>

        {/* Aqui você coloca o form de login (e-mail/senha ou WhatsApp/PIN) */}
        <form>
            {/* Inputs... */}
            <button 
              className="w-full py-3 rounded-lg text-white font-bold transition"
              style={{ backgroundColor: tenantData.brand_color || "#059669" }} // Usa a cor dele ou um verde padrão
            >
              Entrar
            </button>
        </form>

      </div>
    </div>
  );
}