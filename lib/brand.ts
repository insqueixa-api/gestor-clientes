// lib/brand.ts
// ✅ 08/10/2026, pedido do Márcio: as logos saem do R2, não de /public.
// Motivo: o desafio anti-robô da Vercel (X-Vercel-Mitigated: challenge, 429)
// pega toda requisição sem o cookie de verificação — inclusive imagem. No
// computador do trabalho (rede com filtro corporativo) a logo não carregava,
// e e-mail (o Gmail busca a imagem pelo servidor dele) tinha o mesmo risco.
// O R2 público não passa pela Vercel. Arquivos em brand/ (fora da limpeza de
// órfãos, ver lib/r2-folders.ts); cache de 1 ano → logo nova = arquivo -v2.
const R2 = process.env.NEXT_PUBLIC_R2_DEV_URL || "https://pub-8e8ff91eeb56476bad638408b73fc287.r2.dev";

export const BRAND_LOGO_URL = `${R2}/brand/logo-gestor-v1.png`;
export const BRAND_LOGO_MOBILE_URL = `${R2}/brand/logo-gestor-celular-v1.png`;
export const BRAND_LOGO_FULL_LIGHT_URL = `${R2}/brand/logo-full-light-v1.png`;
// Ícones de navegador nos e-mails de aviso (Chrome/Kiwi)
export const BRAND_ICON_CHROME_URL = `${R2}/brand/icon-chrome-v1.png`;
export const BRAND_ICON_KIWI_URL = `${R2}/brand/icon-kiwi-v1.png`;
