// lib/fastdepix.ts
// ✅ 04/09/2026 — integração FastDePix (3 provedores: fastpay, fastflow,
// depix — mesma API REST, chave definida pelo "Tipo de integração" gerado
// no painel deles). Doc oficial: https://fastdepix.space/api/docs.php
//
// DePix EXIGE user.name + user.cpf_cnpj em toda cobrança (o Portal do
// Cliente ainda não coleta CPF/CNPJ no checkout de renovação — ver
// docs/fiscal/nota-fiscal-reforma-tributaria-2027.md, o mesmo campo do
// projeto de nota fiscal resolve isso). FastPay/FastFlow aceitam cobrança
// só com nome (ou totalmente anônima) dentro do teto de cada provedor.
import type { GatewayType } from "@/app/admin/gerenciador/pagamento/shared";

const FASTDEPIX_BASE_URL = "https://fastdepix.space/api/v1";

export type FastDepixProviderType = "fastpay" | "fastflow" | "depix";

export function isFastDepixGatewayType(type: string): type is FastDepixProviderType {
  return type === "fastpay" || type === "fastflow" || type === "depix";
}

export type FastDepixTransaction = {
  id: number;
  amount: number;
  status: string;
  payment_provider?: string;
  qr_code?: string | null;
  qr_code_text?: string | null;
  qr_code_expires_at?: string | null;
  end_to_end_id?: string | null;
};

export class FastDepixError extends Error {
  constructor(message: string, public readonly httpStatus?: number, public readonly body?: any) {
    super(message);
  }
}

async function fastDepixRequest(apiKey: string, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${FASTDEPIX_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok || json?.success === false) {
    throw new FastDepixError(json?.message || `FastDePix HTTP ${res.status}`, res.status, json);
  }
  return json;
}

// ✅ DePix não permite cobrança anônima (user.name + user.cpf_cnpj sempre
// obrigatórios) — quem chama isso deve garantir os dois campos quando
// providerType === "depix", ou a própria API retorna 422.
export async function createFastDepixTransaction(params: {
  apiKey: string;
  providerType: FastDepixProviderType;
  amount: number;
  payerName?: string;
  payerCpfCnpj?: string;
  notificationUrl?: string;
}): Promise<FastDepixTransaction> {
  const { apiKey, providerType, amount, payerName, payerCpfCnpj, notificationUrl } = params;

  if (providerType === "depix" && (!payerName || !payerCpfCnpj)) {
    throw new FastDepixError("DePix exige nome e CPF/CNPJ do pagador em toda cobrança.");
  }

  const body: Record<string, unknown> = { amount: Number(amount) };
  if (payerName || payerCpfCnpj) {
    body.user = {
      ...(payerName ? { name: payerName } : {}),
      ...(payerCpfCnpj ? { cpf_cnpj: payerCpfCnpj } : {}),
    };
  }
  if (notificationUrl) body.notification_url = notificationUrl;

  const json = await fastDepixRequest(apiKey, "/transactions", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return json.data as FastDepixTransaction;
}

export async function getFastDepixTransaction(apiKey: string, id: number | string): Promise<FastDepixTransaction> {
  const json = await fastDepixRequest(apiKey, `/transactions/${id}`);
  return json.data as FastDepixTransaction;
}

// ✅ A API devolve qr_code como URL de imagem (não base64) — o front do
// Portal (RenewClient.tsx) só sabe renderizar pix_qr_code_base64 (mesmo
// contrato do Mercado Pago), então baixa e converte aqui pra não precisar
// mexer na UI de pagamento (código sensível, evitar tocar sem necessidade).
export async function fetchQrCodeAsBase64(qrCodeUrl: string): Promise<string | null> {
  try {
    const res = await fetch(qrCodeUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  } catch {
    return null;
  }
}

export function fastDepixLabel(type: GatewayType | FastDepixProviderType): string {
  if (type === "fastpay") return "FastPay";
  if (type === "fastflow") return "FastFlow";
  if (type === "depix") return "DePix";
  return String(type);
}
