// components/guia-tv/types.ts
// Tipos compartilhados entre GuiaTVView.tsx e os modais extraídos pra
// next/dynamic (14/08/2026) — evita import circular entre eles.
export type TipoConteudo = "FILME" | "SERIE";
export type ServidorId = "ELITE" | "NATV" | "FAST";
