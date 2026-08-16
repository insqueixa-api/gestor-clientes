// app/admin/gerenciador/mensagem/shared.tsx
// Tipo, constantes e helper usados tanto pela lista principal (page.tsx)
// quanto pelos modais extraídos pra next/dynamic (15/08/2026):
// PreviewModal e EditorModal.

// --- TIPOS ---
export type MessageTemplate = {
  id: string;
  name: string;
  content: string;
  updated_at: string;
  is_system_default: boolean;
  image_url: string | null;
  category?: string | null;
};

// --- Nomes Protegidos pelo Sistema ---
export const PROTECTED_TEMPLATES = ["Pagamento Realizado", "Teste - Boas-vindas"];

// ✅ Categorias do Sistema
export const MESSAGE_CATEGORIES = [
  "Cliente IPTV",
  "Vencimentos",
  "Promoções",
  "Manutenção",
  "Fidelidade",
  "Geral",
];

// ✅ Reconhecedor Automático Simplificado
export function getTemplateCategory(msg: MessageTemplate) {
  if (msg.category && msg.category !== "Geral") return msg.category;
  if (msg.name === "Pagamento Realizado" || msg.name === "Teste - Boas-vindas")
    return "Cliente IPTV";
  return "Geral";
}
