// app/api/integrations/apps/ibosol/solve-captcha/route.ts
// Resolve o captcha de imagem do iboplayer.com (texto distorcido) via Gemini
// — chamado pela extensão do Chrome (background.js) durante o fluxo de
// remoção do IBO Player, que roda num navegador real (não CDP), então não
// esbarra no bloqueio Cloudflare que bloqueia chamadas server-to-server.
// Protegido por x-internal-secret (mesma chave, embutida só localmente no
// background.js — arquivo não versionado) pra não expor a chave do Gemini.
import { NextResponse } from "next/server";
import { isInternalRequest } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (!isInternalRequest(req)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { imageBase64 } = body;
    if (!imageBase64) {
      return NextResponse.json({ ok: false, error: "imageBase64 é obrigatório." }, { status: 400 });
    }

    const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
    if (!geminiKey) {
      return NextResponse.json({ ok: false, error: "GEMINI_API_KEY não configurada." }, { status: 500 });
    }

    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: "Esta é uma imagem de captcha com texto distorcido sobre fundo preto. Responda APENAS com os caracteres exatos que você consegue ler (letras e/ou números), sem espaços, sem explicação.",
                },
                { inline_data: { mime_type: "image/png", data: imageBase64 } },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return NextResponse.json({ ok: false, error: `Gemini ${res.status}: ${err.slice(0, 200)}` }, { status: 502 });
    }

    const json = await res.json();
    const answer = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!answer) {
      return NextResponse.json({ ok: false, error: "Gemini não retornou resposta." }, { status: 502 });
    }

    return NextResponse.json({ ok: true, answer: answer.toUpperCase() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Erro interno." }, { status: 500 });
  }
}
