// app/admin/settings/condominio/shared.ts
// Tipos e constantes usados tanto pela lista de Ações (page.tsx) quanto
// pelas telas de Edições (edicoes/page.tsx, edicoes/nova/page.tsx) — fica
// num módulo à parte porque um page.tsx do App Router só pode exportar os
// exports especiais de página (default, metadata, etc.); qualquer `export
// const`/`export type` a mais quebra o typecheck do Next.
export const LOCALSTORAGE_KEY = "condominio_ultimo_id";

export type TituloPaginaCondominio = "logo_nome" | "logo" | "nome";

export type CondominioRow = {
  id: string;
  tenant_id: string;
  nome: string;
  logo_url: string | null;
  endereco: string | null;
  contato: string | null;
  gestao: string | null;
  slogan1: string | null;
  slogan2: string | null;
  cor_primaria: string | null;
  cor_secundaria: string | null;
  titulo_pagina: TituloPaginaCondominio;
  created_at: string;
};

export type StatusAcao =
  | "futuro"
  | "planejado"
  | "em_andamento"
  | "pausado"
  | "concluido";

export type AcaoRow = {
  id: string;
  tenant_id: string;
  condominio_id: string;
  titulo: string;
  categoria: string;
  texto: string | null;
  status: StatusAcao;
  fotos: { url: string; legenda: string }[];
  arquivada: boolean;
  created_at: string;
  updated_at: string;
};

// Mesmo formato de nome do protótipo local (Vidamerica): "{condomínio} -
// Informativo {Semanal|Mensal} - v{003}.pdf". Espelhado também em
// docs/vm-pdf-service/template.js (o <title> do HTML vira o /Title do PDF
// — é dali que o navegador sugere o nome ao salvar uma pré-visualização
// aberta via blob:, que não carrega Content-Disposition).
export function nomeArquivoPdf(
  nomeCondominio: string,
  tipo: "semanal" | "mensal",
  versao: number,
): string {
  const tipoLabel = tipo === "mensal" ? "Mensal" : "Semanal";
  return `${nomeCondominio} - Informativo ${tipoLabel} - v${String(versao).padStart(3, "0")}.pdf`;
}

export const STATUS_ORDEM: StatusAcao[] = [
  "concluido",
  "em_andamento",
  "pausado",
  "planejado",
  "futuro",
];

export const STATUS_COR: Record<
  StatusAcao,
  { bg: string; text: string; border: string; label: string }
> = {
  futuro: {
    bg: "bg-slate-500/10",
    text: "text-slate-500",
    border: "border-slate-500/30",
    label: "Futuro",
  },
  planejado: {
    bg: "bg-amber-500/10",
    text: "text-amber-500",
    border: "border-amber-500/30",
    label: "Planejado",
  },
  em_andamento: {
    bg: "bg-sky-500/10",
    text: "text-sky-500",
    border: "border-sky-500/30",
    label: "Em andamento",
  },
  pausado: {
    bg: "bg-rose-500/10",
    text: "text-rose-500",
    border: "border-rose-500/30",
    label: "Pausado",
  },
  concluido: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-500",
    border: "border-emerald-500/30",
    label: "Concluído",
  },
};
