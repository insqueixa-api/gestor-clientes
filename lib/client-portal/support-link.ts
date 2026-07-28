// lib/client-portal/support-link.ts
//
// Link "Fale com o suporte" pra falha/bloqueio de configuração de app no
// portal (renew-beta). Texto FIXO de propósito — é o gatilho que o
// whatsapp-service reconhece pra pausar o bot na hora (garantido, não é "o
// bot provavelmente entende"). Ver o regex irmão em
// whatsapp-service/src/sessionManager.js (busca por "preciso de ajuda com a
// configuração do meu aplicativo no portal") — mudar a frase aqui exige
// mudar lá também.
export const PORTAL_SUPPORT_MESSAGE =
  "Olá, preciso de ajuda com a configuração do meu aplicativo no portal (não consegui resolver sozinho).";

export function buildPortalSupportLink(supportPhone: string): string {
  const digits = String(supportPhone || "").replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(PORTAL_SUPPORT_MESSAGE)}`;
}
