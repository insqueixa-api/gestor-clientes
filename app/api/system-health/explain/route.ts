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
  supabase: "Supabase é o banco de dados (Postgres), o login/autenticação de TODO o sistema, e também onde rodam os cron jobs automáticos (pg_cron) — sincronização de catálogo, cobrança, limpeza, etc. Problema aqui pode afetar login, qualquer tela que carrega dado, E as automações de madrugada ao mesmo tempo — não é um serviço isolado.",
  vercel: "Vercel é onde a aplicação web roda inteira — o painel admin, o portal do cliente, e TODAS as rotas de API que os cron jobs chamam (sincronização de catálogo, despacho de cobrança, etc). Se cair, o site fica fora do ar E as automações que dependem de chamar uma rota (não as que rodam só dentro do banco) param junto.",
  cloudflare: "Cloudflare NÃO é o CDN do site principal (unigestor.net.br roda direto na Vercel, sem Cloudflare no meio). O uso real aqui é o Cloudflare R2 — onde ficam guardados TODOS os arquivos enviados no sistema (fotos de ações/condomínio, PDFs de informativo, logos). Uso secundário: resolver o desafio anti-bot do site da Duplecast (app de revenda, via FlareSolverr rodando na VM Hetzner) pra automatizar login/renovação desse app específico. Problema aqui tende a ser upload/download de arquivo falhando, ou a integração da Duplecast — não o site em si.",
  gemini_free: "A chave gratuita da IA Gemini — usada em: variação de texto de mensagem de cobrança, revisão de texto do informativo de condomínio, geração do treino de calistenia, resolver captcha em 3 integrações de apps (IBO Player/Bob Player/MessiTV), e essa própria explicação que você está lendo agora. Tem cota baixa e erro 429/503 por sobrecarga é comum e geralmente transitório (normaliza em minutos).",
  gemini_paid: "A chave PAGA da IA Gemini — reserva automática só quando a gratuita falha por sobrecarga/cota (nenhum uso ativo além disso, pra não gastar à toa). Se essa TAMBÉM estiver com problema, todas as funções que dependem de IA (listadas na chave gratuita) ficam indisponíveis até normalizar.",
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
