// app/admin/gerenciador/cobranca/shared.tsx
// Tipo, constante e componentes de formulário usados tanto pela página
// principal (page.tsx: BillingPage/CampaignWindowCard) quanto pelos
// modais extraídos pra next/dynamic (15/08/2026): AutomationWizard,
// ImpactListModal, LogsModal.
export type ClientLight = {
  id: string;
  display_name: string;
  whatsapp_username: string;
  server_id: string;
  plan_label: string;
  vencimento: string | null;
  created_at: string;
  computed_status: string;
  server_name?: string;
  apps_names?: string[];

  // ✅ Novos campos do Banco
  username?: string;
  secondary_display_name?: string;
  secondary_whatsapp_username?: string;
  price_amount?: number;
};

export const TYPES = [
  "Vencimento",
  "Pós-Venda",
  "Manutenção",
  "Divulgação",
  "Boas Vindas",
  "Outros",
];

export const BILLING_TZ = "America/Sao_Paulo";

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[9px] font-medium text-muted-foreground mb-1 uppercase tracking-[0.12em]">
      {children}
    </label>
  );
}
export function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-8 px-2.5 bg-card border border-border rounded-lg text-xs text-foreground outline-none focus:border-emerald-500 transition-colors ${className}`}
    />
  );
}
