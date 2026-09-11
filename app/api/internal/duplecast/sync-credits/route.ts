// app/api/internal/duplecast/sync-credits/route.ts
//
// ✅ 11/09/2026, pedido do Márcio (projeto de tirar o Fluid Compute — achado
// durante o Grupo 2): `lib/client-portal/fulfillment.ts` chamava
// `syncDuplecastCredits` direto e esperava (`await`) o resultado, dentro do
// mesmo `after()` que já rodou `renewDuplecastWithCode` — com
// `maxDuration=60`, as duas chamadas somadas podiam estourar o orçamento
// (cada uma pode levar até ~46-58s num Cloudflare lento do lado deles) e
// cortar etapas mais importantes que vêm depois (resolver o sino, gravar o
// log, avisar o cliente) — já reordenado pra rodar por último, mas o
// Márcio pediu um passo a mais: nem esperar a resposta, só acionar.
//
// Rota internal-only (não é a `app/api/integrations/duplecast/sync-credits`,
// que exige sessão de admin de verdade — usada pelo botão "Sincronizar" do
// painel; essa aqui não tem UI, só existe pra ser chamada de servidor pra
// servidor). Responde IMEDIATAMENTE (antes de sincronizar de verdade) e
// termina o sync em segundo plano no seu PRÓPRIO `after()` — com seu
// PRÓPRIO orçamento de maxDuration, desacoplado por completo do que quer
// que tenha chamado essa rota. O `syncDuplecastCredits` já atualiza
// `api_integrations` sozinho quando termina (mesma função usada pela rota
// com sessão) — quem chamou aqui não precisa fazer mais nada.
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isInternalRequest } from "@/lib/internal-auth";
import { syncDuplecastCredits } from "@/lib/apps/duplecast-renewal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: NextRequest) {
  if (!isInternalRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as any));
  const tenantId = String(body?.tenant_id || "").trim();
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "tenant_id é obrigatório" }, { status: 400 });
  }

  // ✅ Responde na hora — quem chamou (fulfillment.ts) não espera o sync
  // terminar, só confirma que foi aceito. O trabalho de verdade roda depois,
  // no after() desta invocação (orçamento próprio, não compartilha com quem
  // chamou).
  after(async () => {
    await syncDuplecastCredits(supabaseAdmin, tenantId).catch(() => {
      // best-effort — mesma filosofia da chamada síncrona antiga: se
      // falhar, o saldo fica desatualizado até o botão manual
      // "Sincronizar" ou a próxima renovação bem-sucedida corrigir.
    });
  });

  return NextResponse.json({ ok: true, accepted: true });
}
