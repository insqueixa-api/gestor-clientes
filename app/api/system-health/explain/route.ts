// app/api/system-health/explain/route.ts
// ✅ 31/08/2026, pedido do Márcio: botão "Explique com IA" em cada item do
// painel Sistema — não é uma investigação nova, é o Gemini explicando em
// português simples o diagnóstico que a própria checagem já levantou (o
// `detail` de cada item já carrega o dado técnico real: contagem de
// falhas, mensagem de erro, validade, etc). Mesmo padrão de fallback
// grátis→paga de qualquer outra chamada Gemini do projeto (callGemini).
import { NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { callGemini } from "@/lib/whatsapp/gemini-client";

export const dynamic = "force-dynamic";

// ✅ 31/08/2026, achado do Márcio: sem contexto real, a IA "completa" o que
// cada item faz com a suposição mais óbvia genérica — e erra (ex: disse que
// o proxy dedicado serve pra streaming de canais IPTV pros clientes, quando
// na real ele só existe pra 2 coisas: a sessão do WhatsApp não ser
// bloqueada por parecer "aparelho saindo de datacenter", e a rota do
// GerenciaApp/Fast — nada a ver com entrega de canal nenhum). Cada check_key
// tem aqui a descrição REAL e específica do que ele é nesse sistema —
// removendo a chance da IA inventar propósito por conta própria.
const CHECK_CONTEXT: Record<string, string> = {
  whatsapp_1: "Sessão PRINCIPAL do WhatsApp (biblioteca Baileys, rodando na VM Hetzner) — é o número que o robô usa pra mandar as mensagens automáticas de cobrança (vencimento) pros clientes de IPTV/revenda. Se cair, as cobranças automáticas param de sair.",
  whatsapp_2: "Sessão SECUNDÁRIA do WhatsApp, mesma VM — hoje não é usada no dia a dia, só fica disponível caso precise habilitar um segundo número. Ficar desconectada é normal e não afeta nada em uso ativo.",
  billing_sends: "Conta quantas mensagens de cobrança (vencimento) tentaram sair via WhatsApp e falharam nas últimas 6 horas. Quase sempre falha porque a sessão PRINCIPAL do WhatsApp (item separado) está desconectada — é consequência, não causa própria.",
  vm_hetzner: "A VM (servidor) na Hetzner que roda o serviço do WhatsApp (Baileys) — hospeda só isso, mais nada. Sem ela, nenhuma mensagem de cobrança sai.",
  vm_google: "A VM (servidor) no Google Cloud que gera os PDFs dos informativos de condomínio (via Puppeteer/Chromium headless) — não tem relação NENHUMA com WhatsApp nem com IPTV, é só a geração desses PDFs.",
  proxy: "Proxy dedicado (IP fixo comprado da ProxyBR) usado por EXATAMENTE 2 coisas no sistema: (1) a conexão do WhatsApp acima, pra não ser bloqueada por parecer 'aparelho saindo de datacenter'; (2) a integração com o painel de revenda GerenciaApp/Fast. NÃO tem NENHUMA relação com entrega/streaming de canais de IPTV pros clientes finais — isso é uma parte totalmente separada do sistema.",
  gemini_free: "A chave gratuita da IA Gemini — usada em: variação de texto de mensagem de cobrança, revisão de texto do informativo de condomínio, geração do treino de calistenia, resolver captcha em 3 integrações de apps (IBO Player/Bob Player/MessiTV), e essa própria explicação que você está lendo agora. Tem cota baixa e erro 429/503 por sobrecarga é comum e geralmente transitório (normaliza em minutos).",
  gemini_paid: "A chave PAGA da IA Gemini — reserva automática só quando a gratuita falha por sobrecarga/cota (nenhum uso ativo além disso, pra não gastar à toa). Se essa TAMBÉM estiver com problema, todas as funções que dependem de IA (listadas na chave gratuita) ficam indisponíveis até normalizar.",
  supabase: "Dados REAIS do projeto Supabase dele (não da plataforma em geral — o check antigo que mostrava status genérico da plataforma foi removido em 02/09/2026) — CPU/RAM/disco do servidor de banco (via endpoint de métricas privilegiado da Supabase), conexões ativas, e contagem de erros na última hora (via Management API, usando o token pessoal SUPABASE_ACCESS_TOKEN). Esse token é da CONTA inteira dele no Supabase, sem opção de expiração escolhível na criação, mas foi gerado com validade de 1 ano (02/09/2026 → 02/09/2027) — se o detalhe da checagem trouxer um aviso de '⚠ SUPABASE_ACCESS_TOKEN vence em Xd', isso significa literalmente que em X dias esse token para de funcionar e a contagem de erros para de aparecer (o resto do card continua funcionando normal). A ação nesse caso é: gerar um token novo em supabase.com/dashboard/account/tokens e colar na env var SUPABASE_ACCESS_TOKEN dentro da Vercel (Project Settings → Environment Variables, marcando Production e Preview) — não precisa mexer em código nenhum.",
  vercel: "Dados REAIS do deploy/projeto dele na Vercel (não da plataforma em geral — o check antigo que mostrava status genérico da plataforma foi removido em 02/09/2026) — status do deploy atual, quantos dos últimos 5 deploys ficaram OK, e o tempo de resposta real de unigestor.net.br. Depende do token VERCEL_API_TOKEN (pessoal, acesso à conta inteira, sem expiração) — se esse token for revogado ou expirar, esse card específico fica em 'Atenção' com 'VERCEL_API_TOKEN não configurado', mas o resto do sistema continua funcionando normal (esse token só serve pra ESTE painel de monitoramento, não é usado por nenhuma outra função do site).",
  cloudflare: "Status REAL do Cloudflare segundo relatos de usuário (Downdetector), não a página de status oficial deles (removida em 02/09/2026 — o Márcio notou que às vezes ela demora a refletir incidentes que já afetam ele de verdade). Consultado via FlareSolverr rodando na VM Hetzner (Downdetector bloqueia acesso direto, mesma proteção anti-bot do site da Duplecast). Isso importa MUITO nesse sistema especificamente porque há um problema conhecido e ainda sem solução: o Cloudflare bloqueia as integrações Duplecast e IBO Player family (Reconfigurar/Remover) em produção — quando esse card mostrar 'possíveis problemas' ou 'problemas detectados', é um sinal forte de que esse bloqueio específico pode estar ativo ou piorado. Resultado cacheado por até 25min (a consulta em si é cara, resolve um desafio anti-bot de verdade a cada vez) — o horário real da última checagem pode estar um pouco atrasado.",
  cloudflare_r2: "Espaço usado de verdade nos buckets do Cloudflare R2 dele (unigestor-media e unigestor-vault) — número de arquivos, MB ocupados, e tempo de resposta real da API. Usa as mesmas credenciais R2 (S3-compatíveis) que o resto do sistema já usa pra fazer upload de fotos/PDFs — não depende de token novo nenhum. O aviso de 'Atenção' aqui só apareceria perto de 9GB usados (o R2 tem 10GB grátis por mês, depois começa a cobrar) — hoje está bem longe disso (~63MB).",
};

export async function POST(req: Request) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;

  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!geminiKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const checkKey = String(body?.checkKey || "").trim();
  const label = String(body?.label || "").trim();
  const status = String(body?.status || "").trim();
  const detail = String(body?.detail || "").trim();
  if (!label || !status) {
    return NextResponse.json({ error: "label e status são obrigatórios" }, { status: 400 });
  }

  const contexto = CHECK_CONTEXT[checkKey];

  const prompt = `Você está explicando um item de um painel de monitoramento interno de um sistema de gestão (IPTV + revenda + condomínio) pro dono do sistema, que não é técnico mas administra tudo sozinho.

Item do painel: "${label}"
${contexto ? `O que esse item REALMENTE é/verifica nesse sistema (use ISSO, não invente outra função): "${contexto}"` : "(sem descrição própria cadastrada pra esse item — descreva só a partir do nome e do detalhe abaixo, sem inventar pra que serve)"}
Status atual: ${status === "fail" ? "FALHA (vermelho)" : status === "warn" ? "ATENÇÃO (amarelo)" : "OK (verde)"}
Detalhe técnico registrado pela checagem automática: "${detail || "(sem detalhe adicional — está tudo normal)"}"

Responda em português do Brasil, direto e sem jargão desnecessário, em no máximo 4-5 frases curtas:
1. O que esse item verifica, em 1 frase simples — baseado SOMENTE na descrição real dada acima (se houver). Nunca invente ou generalize pra outras partes do sistema que não foram mencionadas (ex: não é sobre streaming/entrega de canais de IPTV, a menos que isso esteja escrito explicitamente acima).
2. O que o status/detalhe atual significa na prática (impacto real, se houver).
3. Se for FALHA ou ATENÇÃO: o que fazer a seguir, de forma concreta. Se for OK: só confirme que está tudo bem, sem inventar problema.

Não use markdown, não use títulos numerados na resposta, escreva como um parágrafo corrido ou 2 curtos.`;

  try {
    const result = await callGemini(
      geminiKey,
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
      },
      25_000,
    );
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      return NextResponse.json({ error: "IA não retornou explicação (resposta vazia)" }, { status: 502 });
    }
    return NextResponse.json({ explanation: text });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message?.slice(0, 300) || "Falha ao consultar a IA" }, { status: 502 });
  }
}
