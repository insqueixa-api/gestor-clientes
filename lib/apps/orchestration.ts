// lib/apps/orchestration.ts
// Núcleo único de "o que acontece de verdade" ao configurar/verificar
// vencimento/remover um app do cliente no painel do parceiro. Extraído SEM
// MUDAR COMPORTAMENTO de app/api/client-portal/apps/{configure,remove,
// check-validity}/route.ts (hoje a implementação mais madura e testada em
// produção) — essas rotas passam a chamar as funções daqui, e as novas
// rotas admin (app/api/admin/apps/{configure,remove}) também.
//
// O que fica de fora de propósito (continua em cada rota chamadora, porque
// é política específica de cada lado, não lógica de integração):
//   - autenticação (session_token no portal, Bearer+tenant_members no admin)
//   - rate-limit de "Reconfigurar" (30min/3 tentativas) — só existe no portal
//   - decidir "pedido de remoção pendente" vs excluir na hora — só o portal
//     tem essa fila; o admin sempre exclui direto
//   - client_app_activity_log (cada rota sabe melhor o que logar e quando)
import { SupabaseClient } from "@supabase/supabase-js";
import { getIntegrationHandler } from "@/lib/integrations";
import {
  PIN_HANDLERS,
  CHECK_VALIDITY_HANDLERS,
  extractFieldByType,
  findFieldByType,
  internalAppUrl,
  buildM3uUrlFromDns,
  buildM3uUrlSecondary,
  resolveIntegrationTypeByName,
} from "@/lib/apps/panel";
import type {
  AppFieldConfig,
  ConfigureAppResult,
  CheckAppValidityResult,
  RemoveAppFromPartnerResult,
  IntegrationHandler,
  PartnerApiResponse,
} from "@/lib/apps/types";

export type LoadedClientApp = {
  id: string;
  client_id: string;
  field_values: Record<string, string>;
  appName: string;
  integrationType: string;
  fieldsConfig: AppFieldConfig[];
  costType: string | null;
  isActive: boolean;
};

// Resolve o handler pelo integration_type do catálogo e, se vazio/não
// reconhecido, cai pro "salva-vidas" por nome (mesma lógica que
// novo_cliente.tsx sempre teve — agora compartilhada, pra admin e portal
// nunca discordarem sobre qual app tem integração automática).
function resolveHandler(row: Pick<LoadedClientApp, "integrationType" | "appName">): IntegrationHandler | null {
  let handler = row.integrationType ? (getIntegrationHandler(row.integrationType) as IntegrationHandler | null) : null;
  if (!handler) {
    const fallbackType = resolveIntegrationTypeByName(row.appName);
    handler = fallbackType ? (getIntegrationHandler(fallbackType) as IntegrationHandler | null) : null;
  }
  return handler;
}

// Busca a linha client_apps + catálogo já resolvidos — usado pelas 3 rotas
// (portal e admin) antes de chamar qualquer função abaixo. `clientId`
// opcional reforça a checagem de posse feita pelo portal (o admin não tem
// esse dado obrigatoriamente à mão e escopa só por tenant_id).
export async function loadClientApp(
  supabaseAdmin: SupabaseClient,
  params: {
    clientAppId: string;
    tenantId: string;
    clientId?: string;
    // Só o admin usa isto — o app pode já estar salvo (tem client_app_id)
    // mas o admin editou um campo (ex: trocou o MAC) e ainda não clicou
    // "Salvar" no cliente antes de clicar "Configurar" de novo. Sem isto, a
    // rota usaria o field_values antigo do banco, ignorando o que está na
    // tela — exatamente o que o admin nunca fez (sempre mandou o valor
    // fresco da tela pro parceiro, salvo ou não).
    fieldValuesOverride?: Record<string, string>;
  },
): Promise<LoadedClientApp | null> {
  // Portal: escopa por client_id (igual sempre foi — o client_id já veio
  // validado contra a sessão em validatePortalClient). Admin: não tem um
  // client_id obrigatório à mão, escopa por tenant_id (igual já fazia
  // app/api/admin/apps/check-validity/route.ts antes desta extração).
  let query = supabaseAdmin
    .from("client_apps")
    .select("id, client_id, field_values, apps(name, integration_type, fields_config, cost_type, is_active)")
    .eq("id", params.clientAppId);
  query = params.clientId ? query.eq("client_id", params.clientId) : query.eq("tenant_id", params.tenantId);

  const { data: row, error } = await query.single();
  if (error || !row) return null;

  const apps = (row as { apps?: {
    name?: string;
    integration_type?: string | null;
    fields_config?: AppFieldConfig[];
    cost_type?: string | null;
    is_active?: boolean;
  } }).apps;
  return {
    id: row.id,
    client_id: row.client_id,
    // Mescla por cima do que já está salvo — nunca substitui o objeto
    // inteiro. O override normalmente só tem os campos "de negócio"
    // (mac/date/device_key etc.), enquanto o banco pode ter outras chaves
    // que não fazem parte de fields_config (ex: _config_cost/
    // _config_partner, usadas por novo_cliente.tsx pra guardar custo/
    // parceria por instância) — substituir tudo apagaria essas chaves na
    // próxima vez que o vencimento fosse persistido.
    field_values: params.fieldValuesOverride
      ? { ...(row.field_values || {}), ...params.fieldValuesOverride }
      : row.field_values || {},
    appName: apps?.name || "Aplicativo",
    integrationType: String(apps?.integration_type || "").trim().toUpperCase(),
    fieldsConfig: Array.isArray(apps?.fields_config) ? apps.fields_config : [],
    costType: apps?.cost_type ?? null,
    isActive: apps?.is_active !== false,
  };
}

// Monta um LoadedClientApp "de mentirinha" pra apps que o admin ainda não
// salvou em client_apps — o admin permite adicionar um app e clicar
// Configurar/Verificar/Remover na hora, antes de clicar "Salvar" no cliente
// (fluxo real, confirmado pelo Márcio, 29/07/2026). `id` nasce com um
// prefixo que nunca bate com uma linha real: os updates de field_values
// dentro de configureClientApp/checkClientAppValidity viram no-op (0 linhas
// afetadas) em vez de arriscar colidir com outra coisa — o valor novo já
// volta na resposta HTTP, e quem chama decide o que fazer com ele (guardar
// no state local até o próximo "Salvar"). Catálogo (`apps`) não é
// tenant-scoped hoje (mesmo padrão do fetch direto em novo_cliente.tsx), só
// filtra por id.
export async function loadClientAppDraft(
  supabaseAdmin: SupabaseClient,
  params: { appId: string; clientId: string; fieldValues: Record<string, string> },
): Promise<LoadedClientApp | null> {
  const { data: app, error } = await supabaseAdmin
    .from("apps")
    .select("id, name, integration_type, fields_config, cost_type, is_active")
    .eq("id", params.appId)
    .maybeSingle();
  if (error || !app) return null;

  return {
    id: `draft:${crypto.randomUUID()}`,
    client_id: params.clientId,
    field_values: params.fieldValues || {},
    appName: app.name || "Aplicativo",
    integrationType: String(app.integration_type || "").trim().toUpperCase(),
    fieldsConfig: Array.isArray(app.fields_config) ? app.fields_config : [],
    costType: app.cost_type ?? null,
    isActive: app.is_active !== false,
  };
}

// Espelha app/api/client-portal/apps/configure/route.ts:164-289 (delete
// tolerante + create + recheck GERENCIAAPP + persistência do vencimento).
export async function configureClientApp(
  supabaseAdmin: SupabaseClient,
  row: LoadedClientApp,
  mode: "principal" | "secundaria",
  // Só o admin usa isto — antes de "Salvar" o m3u_url do cliente pode ainda
  // não estar no banco (formulário sendo editado), então o admin manda o
  // valor que está na tela. Portal nunca passa isso — sempre lê do banco
  // (client.m3u_url), que é sempre a fonte da verdade por lá.
  m3uUrlOverride?: string,
): Promise<ConfigureAppResult> {
  const handler = resolveHandler(row);
  if (!handler || !handler.useApi) {
    return { ok: false, stage: "precondition", error: "Esse aplicativo não tem integração automática disponível.", status: 400 };
  }

  const macValue = extractFieldByType(row.fieldsConfig, row.field_values, "mac");
  if (!macValue) {
    return { ok: false, stage: "precondition", error: "Preencha o Device ID (MAC) antes de configurar.", status: 400 };
  }
  const deviceKey = extractFieldByType(row.fieldsConfig, row.field_values, "device_key");

  const { data: client, error: clientErr } = await supabaseAdmin
    .from("clients")
    .select("server_username, server_password, server_id, m3u_url")
    .eq("id", row.client_id)
    .single();
  if (clientErr || !client) {
    return { ok: false, stage: "precondition", error: "Cliente não encontrado", status: 404 };
  }

  const { data: server } = await supabaseAdmin
    .from("servers")
    .select("name, dns")
    .eq("id", client.server_id)
    .maybeSingle();
  const serverNameClean = String(server?.name || "Servidor").replace(/\s+/g, "");
  const finalServerName = `${client.server_username}_${serverNameClean}`;
  const serverDns = Array.isArray(server?.dns) ? server.dns : [];

  // Sem override (portal, sempre): fonte da verdade é o banco. Com override
  // (admin): a tela manda, mesmo vazia — igual sempre foi o comportamento
  // client-side do admin, que nunca olhava pro client.m3u_url salvo.
  let m3uUrl = (m3uUrlOverride !== undefined ? m3uUrlOverride : String(client.m3u_url || "")).trim();
  if (mode === "secundaria") {
    if (m3uUrlOverride !== undefined && m3uUrl) {
      // Admin: já sorteou e mostrou esse link na tela antes de chamar aqui
      // (mesmo texto que o próprio admin vê) — usa o mesmo valor, só
      // garante que fica salvo no cliente também.
      await supabaseAdmin.from("clients").update({ m3u_url: m3uUrl }).eq("id", row.client_id);
    } else {
      const freshUrl = buildM3uUrlSecondary(serverDns, client.server_username, client.server_password || "", server?.name);
      if (freshUrl) {
        m3uUrl = freshUrl;
        await supabaseAdmin.from("clients").update({ m3u_url: m3uUrl }).eq("id", row.client_id);
      }
    }
  } else if (!m3uUrl) {
    m3uUrl = buildM3uUrlFromDns(serverDns, client.server_username, client.server_password || "");
  }

  const { data: integ } = await supabaseAdmin
    .from("app_integrations")
    .select("api_url, pin")
    .eq("app_name", row.integrationType)
    .maybeSingle();

  const payloadPassword = PIN_HANDLERS.has(handler.actionPrefix) ? integ?.pin || "" : client.server_password || "";

  const internalSecret = String(process.env.INTERNAL_API_SECRET || "");
  const apiEndpointUrl = internalAppUrl(handler.apiEndpoint || "");

  // "Configurar" = deletar (tolerante a "não encontrado") + criar — muitos
  // clientes já têm o app configurado de antes desse fluxo existir. Erro do
  // delete nunca derruba o fluxo (best-effort, igual ao original).
  try {
    const deletePayload = handler.buildDeletePayload({
      username: client.server_username,
      finalServerName,
      serverName: serverNameClean,
      macValue,
      appName: row.appName,
      password: payloadPassword,
    });
    await fetch(apiEndpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify({ ...deletePayload, base_url: integ?.api_url || "", deviceKey }),
    });
  } catch {
    // best-effort — segue pro create de qualquer jeito
  }

  // ✅ buildCreatePayload pode travar de propósito (ex: GERENCIAAPP sem
  // ranking_app_id mapeado pro app — ver lib/integrations/gerenciaapp.ts)
  // em vez de arriscar montar um payload errado. Vira erro de precondição
  // normal aqui, igual aos outros checks acima — nunca deixa a exceção
  // subir crua.
  let payload: ReturnType<typeof handler.buildCreatePayload>;
  try {
    payload = handler.buildCreatePayload({
      username: client.server_username,
      password: payloadPassword,
      macValue,
      finalServerName,
      serverName: serverNameClean,
      m3uUrl,
      appName: row.appName,
      serverId: client.server_id,
    });
  } catch (e: any) {
    return { ok: false, stage: "precondition", error: e?.message || "Não foi possível montar a configuração para este app.", status: 400 };
  }

  const apiRes = await fetch(apiEndpointUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
    body: JSON.stringify({ ...payload, base_url: integ?.api_url || "", deviceKey }),
  });
  const apiJson = (await apiRes.json().catch(() => ({} as PartnerApiResponse))) as PartnerApiResponse;

  if (!apiJson?.ok) {
    return { ok: false, stage: "partner_call", error: apiJson?.error || "Falha ao configurar no painel do parceiro." };
  }

  // GERENCIAAPP: o create manda "hoje + 1 ano" fixo (exigência do payload
  // deles, não é vencimento real) — busca o vencimento de verdade via
  // "check" logo em seguida, com fallback pro valor do create se falhar.
  let expireDate: string | null = apiJson.expireDate || null;
  if (handler.actionPrefix === "GERENCIAAPP") {
    try {
      const checkRes = await fetch(apiEndpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
        body: JSON.stringify({ action: "check", base_url: integ?.api_url || "", username: finalServerName, macValue }),
      });
      const checkJson = (await checkRes.json().catch(() => ({} as PartnerApiResponse))) as PartnerApiResponse;
      if (checkJson?.ok && checkJson.expireDate) expireDate = checkJson.expireDate;
    } catch {
      // mantém o expireDate do create como fallback
    }
  }

  const dateField = findFieldByType(row.fieldsConfig, "date");
  if (expireDate && dateField) {
    const fieldKey = String(dateField.id || dateField.label);
    await supabaseAdmin
      .from("client_apps")
      .update({ field_values: { ...row.field_values, [fieldKey]: expireDate } })
      .eq("id", row.id);
  }

  return { ok: true, expireDate, message: apiJson.message || "Configurado com sucesso." };
}

// Espelha app/api/client-portal/apps/check-validity/route.ts:51-152 (consulta
// read-only, sem criar/alterar nada no parceiro).
export async function checkClientAppValidity(
  supabaseAdmin: SupabaseClient,
  row: LoadedClientApp,
): Promise<CheckAppValidityResult> {
  // Só "parceria" (custo embutido no plano do servidor) não tem vencimento
  // próprio rastreado.
  if (row.costType === "partnership") {
    return { ok: false, error: "Esse aplicativo não tem vencimento próprio — está incluso no plano." };
  }

  const handler = resolveHandler(row);
  if (!handler || !handler.useApi || !CHECK_VALIDITY_HANDLERS.has(handler.actionPrefix)) {
    return { ok: false, error: "Verificação de validade não disponível para este aplicativo." };
  }

  const macValue = extractFieldByType(row.fieldsConfig, row.field_values, "mac");
  if (!macValue) {
    return { ok: false, error: "Preencha o Device ID (MAC) antes de verificar." };
  }
  const deviceKey = extractFieldByType(row.fieldsConfig, row.field_values, "device_key");

  // GerenciaApp-family busca por "username_servidor" (igual ao delete), não
  // só pelo MAC — precisa dos dados do servidor do cliente.
  let username = "";
  if (handler.actionPrefix === "GERENCIAAPP") {
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("server_username, server_id")
      .eq("id", row.client_id)
      .single();
    const { data: server } = client?.server_id
      ? await supabaseAdmin.from("servers").select("name").eq("id", client.server_id).maybeSingle()
      : { data: null };
    const serverNameClean = String(server?.name || "Servidor").replace(/\s+/g, "");
    username = client ? `${client.server_username}_${serverNameClean}` : "";
  }

  const { data: integ } = await supabaseAdmin
    .from("app_integrations")
    .select("api_url")
    .eq("app_name", row.integrationType)
    .maybeSingle();

  const internalSecret = String(process.env.INTERNAL_API_SECRET || "");
  const apiRes = await fetch(internalAppUrl(handler.apiEndpoint || ""), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
    body: JSON.stringify({
      action: "check",
      macValue,
      mac: macValue,
      mac_address: macValue,
      username,
      deviceKey,
      app_name: row.appName,
      base_url: integ?.api_url || "",
    }),
  });
  const apiJson = (await apiRes.json().catch(() => ({} as PartnerApiResponse))) as PartnerApiResponse;

  if (!apiJson?.ok) {
    return { ok: false, error: apiJson?.error || "Falha ao consultar o painel do parceiro." };
  }

  // Quando o parceiro não devolve vencimento (ex: DUPLEXTV quase nunca
  // devolve), nunca mostra "não encontrado" — mantém o valor já salvo no
  // banco e devolve ele como se tivesse achado.
  const dateField = findFieldByType(row.fieldsConfig, "date");
  const rawExpireDate: string | null = apiJson.expireDate || null;
  let expireDate = rawExpireDate;
  if (expireDate && dateField) {
    const fieldKey = String(dateField.id || dateField.label);
    await supabaseAdmin
      .from("client_apps")
      .update({ field_values: { ...row.field_values, [fieldKey]: expireDate } })
      .eq("id", row.id);
  } else if (dateField) {
    const fieldKey = String(dateField.id || dateField.label);
    expireDate = row.field_values[fieldKey] || null;
  }

  return { ok: true, expireDate, rawExpireDate };
}

// Espelha app/api/client-portal/apps/remove/route.ts:133-180 — só a parte
// "desconfigura no painel do parceiro" (best-effort quanto ao resultado, mas
// uma exceção de rede/parse aqui propaga igual ao original, não é engolida).
// NÃO apaga a linha client_apps nem decide "pedido pendente" — isso é da
// rota chamadora.
export async function removeClientAppFromPartner(
  supabaseAdmin: SupabaseClient,
  row: LoadedClientApp,
): Promise<RemoveAppFromPartnerResult> {
  const handler = resolveHandler(row);
  const hasWorkingIntegration = !!handler && !!handler.useApi;
  if (!hasWorkingIntegration) return { attempted: false };

  const macValue = extractFieldByType(row.fieldsConfig, row.field_values, "mac");
  const deviceKey = extractFieldByType(row.fieldsConfig, row.field_values, "device_key");

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("server_username, server_password, server_id")
    .eq("id", row.client_id)
    .single();

  const { data: server } = client?.server_id
    ? await supabaseAdmin.from("servers").select("name").eq("id", client.server_id).maybeSingle()
    : { data: null };
  const serverNameClean = String(server?.name || "Servidor").replace(/\s+/g, "");
  const finalServerName = client ? `${client.server_username}_${serverNameClean}` : "";

  const { data: integ } = await supabaseAdmin
    .from("app_integrations")
    .select("api_url, pin")
    .eq("app_name", row.integrationType)
    .maybeSingle();

  const payloadPassword = PIN_HANDLERS.has(handler.actionPrefix) ? integ?.pin || "" : client?.server_password || "";

  const payload = handler.buildDeletePayload({
    username: client?.server_username || "",
    finalServerName,
    serverName: serverNameClean,
    macValue,
    appName: row.appName,
    password: payloadPassword,
  });

  const internalSecret = String(process.env.INTERNAL_API_SECRET || "");
  const apiRes = await fetch(internalAppUrl(handler.apiEndpoint || ""), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
    body: JSON.stringify({ ...payload, base_url: integ?.api_url || "", deviceKey }),
  });
  const apiJson = (await apiRes.json().catch(() => ({} as PartnerApiResponse))) as PartnerApiResponse;

  if (apiJson?.ok) return { attempted: true, ok: true };
  return { attempted: true, ok: false, error: apiJson?.error || "Falha ao remover do painel do parceiro." };
}
