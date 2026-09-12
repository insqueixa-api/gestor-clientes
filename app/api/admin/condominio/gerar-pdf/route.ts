// app/api/admin/condominio/gerar-pdf/route.ts
// Repassa os dados da Edição (montados no front) pra VM que roda o serviço
// de PDF (Puppeteer) — mesmo padrão de proxy já usado pra VM do WhatsApp
// (lib/whatsapp/wa-context.ts: Bearer token fixo, timeout com
// AbortController, sem fila/webhook), só que com timeout maior porque
// Puppeteer é mais lento que as chamadas do WhatsApp. Rota stateless — não
// toca no banco, só encaminha e devolve os bytes do PDF (dá pra
// pré-visualizar sem salvar nada em condominio_edicoes).
import { NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// ✅ Sem isso, o Vercel mata a function no limite padrão do plano (bem
// menor que os 280s que já damos pro AbortController abaixo) antes da VM
// terminar o Puppeteer — mesmo padrão usado nas outras rotas que fazem
// proxy pra VM (ex: app/api/integrations/apps/*).
// ✅ 30/08/2026: 65s → 160s, pedido do Márcio depois dos timeouts de hoje —
// a causa raiz (networkidle0 na VM) já foi corrigida, isso aqui é margem
// extra pra edições com muitas fotos/ações não flertarem com o limite.
// ⚠️ 11/09/2026: 160→60s (obrigatório pra desligar o Fluid Compute, Hobby
// trava em 60s sem ele). Decisão consciente do Márcio: PDFs de edições
// grandes podiam passar a falhar por timeout — aceito temporariamente, sem
// redesenho.
// ✅ 12/09/2026: 60s → 280s. Fluid Compute foi mantido ligado de vez
// (decisão definitiva do Márcio) — o teto de 60s do Hobby sem Fluid não
// existe mais, então a limitação de 11/09 deixou de fazer sentido. Pedido
// explícito do Márcio: "podemos voltar pra 2min, condomínio principalmente,
// talvez até mais se possível... posso manter o condomínio como está" — ou
// seja, sem redesenhar a rota (continua um proxy simples pra VM), só dando
// bem mais orçamento de tempo. 280s fica a 20s do teto absoluto do Hobby
// com Fluid Compute (300s), cobrindo com folga real qualquer edição com
// muitas fotos/ações.
export const maxDuration = 280;

export async function POST(req: Request) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;

  const baseUrl = String(process.env.PDF_VM_BASE_URL || "").trim();
  const token = String(process.env.PDF_VM_TOKEN || "").trim();
  if (!baseUrl || !token) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!body?.condominio?.nome || !Array.isArray(body?.itens)) {
    return NextResponse.json(
      { error: "condominio e itens são obrigatórios" },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  // ✅ 270s (12/09/2026, era 150s) — folga de 10s abaixo do maxDuration
  // (280s) da própria rota.
  const timeout = setTimeout(() => controller.abort(), 270_000);

  try {
    const vmRes = await fetch(`${baseUrl}/gerar-pdf`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!vmRes.ok) {
      const errText = await vmRes.text().catch(() => "");
      let errMsg = errText;
      try {
        errMsg = JSON.parse(errText)?.error || errText;
      } catch {}
      return NextResponse.json(
        { error: errMsg || `Falha ao gerar PDF (status ${vmRes.status})` },
        { status: 502 },
      );
    }

    const pdfBuffer = await vmRes.arrayBuffer();
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition":
          vmRes.headers.get("content-disposition") ||
          `attachment; filename="informativo.pdf"`,
      },
    });
  } catch (e: any) {
    const isTimeout = e?.name === "AbortError";
    return NextResponse.json(
      { error: isTimeout ? "Timeout ao gerar o PDF" : e?.message || "Falha ao conectar no serviço de PDF" },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
