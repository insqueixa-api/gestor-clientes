"use client";
// app/admin/agenda/shared.tsx
// Tipos, helpers de telefone e pedaços de UI usados tanto pela lista
// principal (page.tsx) quanto pelos modais extraídos pra next/dynamic
// (14/08/2026): EditContatoModal, EnviarMensagemModal, ExcluirContatoModal.
import { Send, Trash2 } from "lucide-react";
import {
  Modal as SharedModal,
  ModalHeader,
  ModalBody,
} from "@/components/ui/Modal";

// ─── TIPOS ───────────────────────────────────────────────────────────────────
export type ContactItem = { label: string; value: string };

export type GoogleContact = {
  id: string;
  tenant_id: string;
  google_resource_name: string;
  display_name: string | null;
  phones: ContactItem[] | null;
  emails: ContactItem[] | null;
  avatar_url: string | null;
  birthday: string | null;
  labels: string[] | null;
  synced_at: string;
  phone_e164?: string | null;
  secondary_phone?: string | null;
  email?: string | null;
};

// Tipo de telefone no editForm — com DDI e confirmed separados
export type EditPhone = {
  id: string;
  label: string;
  ddi: string;
  national: string;
  confirmed: boolean;
};
export type EditEmail = { id: string; label: string; value: string };

// ─── DDI ─────────────────────────────────────────────────────────────────────
export type DdiOption = { code: string; label: string; flag: string };

// ⚠️ IMPORTANTE: mantido sorted longest-to-shortest igual ao padrão do sistema
export const DDI_OPTIONS: DdiOption[] = [
  { code: "55", label: "Brasil", flag: "🇧🇷" },
  { code: "1", label: "EUA/Canadá", flag: "🇺🇸" },
  { code: "351", label: "Portugal", flag: "🇵🇹" },
  { code: "353", label: "Irlanda", flag: "🇮🇪" },
  { code: "507", label: "Panamá", flag: "🇵🇦" },
  { code: "506", label: "Costa Rica", flag: "🇨🇷" },
  { code: "595", label: "Paraguai", flag: "🇵🇾" },
  { code: "591", label: "Bolívia", flag: "🇧🇴" },
  { code: "234", label: "Nigéria", flag: "🇳🇬" },
  { code: "254", label: "Quênia", flag: "🇰🇪" },
  { code: "212", label: "Marrocos", flag: "🇲🇦" },
  { code: "971", label: "Emirados Árabes", flag: "🇦🇪" },
  { code: "966", label: "Arábia Saudita", flag: "🇸🇦" },
  { code: "44", label: "Reino Unido", flag: "🇬🇧" },
  { code: "34", label: "Espanha", flag: "🇪🇸" },
  { code: "49", label: "Alemanha", flag: "🇩🇪" },
  { code: "33", label: "França", flag: "🇫🇷" },
  { code: "39", label: "Itália", flag: "🇮🇹" },
  { code: "52", label: "México", flag: "🇲🇽" },
  { code: "54", label: "Argentina", flag: "🇦🇷" },
  { code: "56", label: "Chile", flag: "🇨🇱" },
  { code: "57", label: "Colômbia", flag: "🇨🇴" },
  { code: "58", label: "Venezuela", flag: "🇻🇪" },
  { code: "32", label: "Bélgica", flag: "🇧🇪" },
  { code: "46", label: "Suécia", flag: "🇸🇪" },
  { code: "31", label: "Holanda", flag: "🇳🇱" },
  { code: "41", label: "Suíça", flag: "🇨🇭" },
  { code: "45", label: "Dinamarca", flag: "🇩🇰" },
  { code: "48", label: "Polônia", flag: "🇵🇱" },
  { code: "30", label: "Grécia", flag: "🇬🇷" },
  { code: "27", label: "África do Sul", flag: "🇿🇦" },
  { code: "20", label: "Egito", flag: "🇪🇬" },
  { code: "86", label: "China", flag: "🇨🇳" },
  { code: "91", label: "Índia", flag: "🇮🇳" },
  { code: "81", label: "Japão", flag: "🇯🇵" },
  { code: "82", label: "Coreia do Sul", flag: "🇰🇷" },
  { code: "66", label: "Tailândia", flag: "🇹🇭" },
  { code: "62", label: "Indonésia", flag: "🇮🇩" },
  { code: "60", label: "Malásia", flag: "🇲🇾" },
  { code: "98", label: "Irã", flag: "🇮🇷" },
  { code: "90", label: "Turquia", flag: "🇹🇷" },
  { code: "61", label: "Austrália", flag: "🇦🇺" },
  { code: "64", label: "Nova Zelândia", flag: "🇳🇿" },
];

export function onlyDigits(raw: string) {
  return (raw || "").replace(/\D+/g, "");
}

// Infere DDI testando do maior código pro menor (evita colisão 1 vs 353)
export function inferDDI(digits: string): string {
  if (!digits) return "55";
  const sorted = [...DDI_OPTIONS].sort((a, b) => b.code.length - a.code.length);
  for (const opt of sorted) {
    if (digits.startsWith(opt.code)) return opt.code;
  }
  return "55";
}

// Formata o número nacional por DDI
export function formatNational(ddi: string, nat: string): string {
  let d = onlyDigits(nat);
  // Strip zero inicial apenas para processar, mas não para exibir
  if (ddi === "55" && d.startsWith("0")) d = d.slice(1);
  if (ddi === "55") {
    const area = d.slice(0, 2);
    const rest = d.slice(2);
    if (!area) return d;
    if (rest.length === 9)
      return `(0${area}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    if (rest.length === 8)
      return `(0${area}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
    return `(0${area}) ${rest}`.trim();
  }
  // Genérico: agrupa em blocos
  const groups: string[] = [];
  let i = 0;
  while (i < d.length) {
    const step = d.length - i > 7 ? 3 : 4;
    groups.push(d.slice(i, i + step));
    i += step;
  }
  return groups.join(" ").trim();
}

// 🌟 NOVA função central de exibição:
// Brasil  → (021) 99999-8888
// Outros  → 🇵🇹 +351 XXX XXX XXX
export function displayPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = onlyDigits(raw);
  if (!digits) return raw || "";

  const hasPlus = raw.trim().startsWith("+");
  let ddi = "55";
  let national = digits;

  if (hasPlus || digits.length > 11) {
    ddi = inferDDI(digits);
    national = digits.startsWith(ddi) ? digits.slice(ddi.length) : digits;
  }

  if (ddi === "55") {
    if (national.startsWith("0")) national = national.slice(1);
    const ddd = national.slice(0, 2);
    const rest = national.slice(2);
    if (rest.length === 9)
      return `(0${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    if (rest.length === 8)
      return `(0${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
    return `(0${ddd}) ${rest}`.trim();
  }

  const opt = DDI_OPTIONS.find((o) => o.code === ddi);
  const flag = opt?.flag || "🌐";
  return `${flag} +${ddi} ${formatNational(ddi, national)}`;
}

// Converte um phone raw (ex: "+5521999998888" ou "21999998888") para EditPhone
export function parsePhoneToEditPhone(
  raw: string,
  label: string,
  id: string,
): EditPhone {
  const digits = onlyDigits(raw);
  if (!digits) return { id, label, ddi: "55", national: "", confirmed: false };
  let ddi = "55";
  let national = digits;
  if (digits.length > 11 || raw.trim().startsWith("+")) {
    ddi = inferDDI(digits);
    national = digits.startsWith(ddi) ? digits.slice(ddi.length) : digits;
  }
  return {
    id,
    label,
    ddi,
    national: formatNational(ddi, national) || national,
    confirmed: true,
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
export function getPhonesArray(
  contact: GoogleContact,
): { id: string; label: string; value: string }[] {
  if (
    contact.phones &&
    Array.isArray(contact.phones) &&
    contact.phones.length > 0
  ) {
    return contact.phones.map((p, i) => ({
      id: i.toString(),
      label: p.label || "Celular",
      value: p.value,
    }));
  }
  const arr = [];
  if (contact.phone_e164)
    arr.push({ id: "old1", label: "Celular", value: contact.phone_e164 });
  if (contact.secondary_phone)
    arr.push({ id: "old2", label: "Telefone", value: contact.secondary_phone });
  return arr;
}

export function getEmailsArray(
  contact: GoogleContact,
): { id: string; label: string; value: string }[] {
  if (
    contact.emails &&
    Array.isArray(contact.emails) &&
    contact.emails.length > 0
  ) {
    return contact.emails.map((e, i) => ({
      id: i.toString(),
      label: e.label || "Pessoal",
      value: e.value,
    }));
  }
  if (contact.email)
    return [{ id: "old1", label: "Pessoal", value: contact.email }];
  return [];
}

// Modal com dark mode corrigido — usa dark:bg-card alinhado ao padrão do sistema
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <SharedModal onClose={onClose} maxWidth="max-w-3xl">
      <ModalHeader onClose={onClose}>
        <div className="font-medium text-foreground">{title}</div>
      </ModalHeader>
      <ModalBody className="p-4 bg-card">{children}</ModalBody>
    </SharedModal>
  );
}

// ─── ÍCONES compartilhados entre tabela principal e modais ───────────────────
export function IconSend() {
  return <Send className="w-4 h-4" />;
}
export function IconTrash() {
  return <Trash2 className="w-4 h-4" />;
}
