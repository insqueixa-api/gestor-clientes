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
  resolveIntegrationTypeByName,
} from "@/lib/apps/panel";
import { rotatePrincipalM3u, rotateSecondaryM3u } from "@/lib/apps/m3u-lists";
import type {
  AppFieldConfig,
  ConfigureAppResult,
  CheckAppValidityResult,
  RemoveAppFromPartnerResult,
  IntegrationHandler,
  PartnerApiResponse,
} from "@/lib/apps/types";
import { getGpcRokuActivation, upsertGpcRokuActivation, formatDateOnly } from "@/lib/apps/gpc-roku-registry";

export type LoadedClientApp = {
  id: string;
  client_id: string;
  field_values: Record<string, string>;
  appName: string;
  // ✅ 03/10/2026: id do app no catálogo (GERENCIAAPP acha o código por ele)
  appId: string | null;
  integrationType: string;
  fieldsConfig: AppFieldConfig[];
  costType: string | null;
  isActive: boolean;
  // ✅ Achado 26/08/2026 (pedido do Márcio: ativação manual via Appativa
  // direto na tela do cliente) — de-para com o catálogo da Appativa, ver
  // docs/sql/apps_appativa_mapping.sql. null quando o app não está mapeado.
  appativaAppId: string | null;
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
    .select("id, client_id, app_id, field_values, apps(name, integration_type, fields_config, cost_type, is_active, appativa_app_id)")
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
    appativa_app_id?: string | null;
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
    appId: (row as { app_id?: string | null }).app_id ?? null,
    integrationType: String(apps?.integration_type || "").trim().toUpperCase(),
    fieldsConfig: Array.isArray(apps?.fields_config) ? apps.fields_config : [],
    costType: apps?.cost_type ?? null,
    isActive: apps?.is_active !== false,
    appativaAppId: apps?.appativa_app_id ? String(apps.appativa_app_id) : null,
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
  params: { appId: string; clientId: string; tenantId: string; fieldValues: Record<string, string> },
): Promise<LoadedClientApp | null> {
  // ✅ Faltava confirmar que clientId pertence ao tenant do admin
  // autenticado — diferente de loadClientApp (linha ~88), que sempre
  // escopa por tenant_id/client_id validado. Sem isso, um admin
  // autenticado que soubesse/adivinhasse o client_id de OUTRO tenant
  // conseguia reconfigurar/remover/verificar apps usando as credenciais
  // reais de servidor daquele cliente (as funções de baixo nunca
  // rechecam tenant depois deste ponto).
  const { data: clientCheck, error: clientCheckErr } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("id", params.clientId)
    .eq("tenant_id", params.tenantId)
    .maybeSingle();
  if (clientCheckErr || !clientCheck) return null;

  const { data: app, error } = await supabaseAdmin
    .from("apps")
    .select("id, name, integration_type, fields_config, cost_type, is_active, appativa_app_id")
    .eq("id", params.appId)
    .maybeSingle();
  if (error || !app) return null;

  return {
    id: `draft:${crypto.randomUUID()}`,
    client_id: params.clientId,
    field_values: params.fieldValues || {},
    appName: app.name || "Aplicativo",
    appId: app.id ?? null,
    integrationType: String(app.integration_type || "").trim().toUpperCase(),
    fieldsConfig: Array.isArray(app.fields_config) ? app.fields_config : [],
    costType: app.cost_type ?? null,
    isActive: app.is_active !== false,
    appativaAppId: app.appativa_app_id ? String(app.appativa_app_id) : null,
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
  // ✅ 02/10/2026: Reconfigurar = rotaciona a lista escolhida (outro domínio)
  // e salva; Configurar (false) = usa a que está salva. lib/apps/m3u-lists.ts
  rotate = false,
): Promise<ConfigureAppResult> {
  const handler = resolveHandler(row);
  if (!handler || !handler.useApi) {
    return { ok: false, stage: "precondition", error: "Esse aplicativo não tem integração automática disponível.", status: 400 };
  }

  const macValue = extractFieldByType(row.fieldsConfig, row.field_values, "mac");
  if (!macValue) {
    return { ok: false, stage: "precondition", error: "Preencha o ID/MAC antes de configurar.", status: 400 };
  }
  const deviceKey = extractFieldByType(row.fieldsConfig, row.field_values, "device_key");

  const { data: client, error: clientErr } = await supabaseAdmin
    .from("clients")
    .select("tenant_id, server_username, server_password, server_id, m3u_url, m3u_url_secondary")
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

  // ✅ 02/10/2026 (pedido do Márcio): principal e secundária em colunas
  // separadas — a secundária NUNCA mais sobrescreve a principal.
  //   Principal: m3u_url (admin pode mandar o valor da tela via override).
  //   Secundária: m3u_url_secondary.
  //   Vazia ou Reconfigurar → monta/rotaciona e salva no cliente.
  const rotateArgs = {
    dnsList: serverDns,
    username: client.server_username,
    password: client.server_password || "",
    serverName: server?.name,
  };
  const savedPrincipal = (m3uUrlOverride !== undefined ? m3uUrlOverride : String(client.m3u_url || "")).trim();
  const clientPatch: Record<string, string> = {};
  let m3uUrl: string;
  if (mode === "principal") {
    m3uUrl = savedPrincipal;
    if (rotate || !m3uUrl) {
      const fresh = rotatePrincipalM3u({ ...rotateArgs, currentPrincipal: savedPrincipal || client.m3u_url });
      if (fresh) {
        m3uUrl = fresh;
        clientPatch.m3u_url = fresh;
      }
    }
  } else {
    m3uUrl = String(client.m3u_url_secondary || "").trim();
    if (rotate || !m3uUrl) {
      const fresh = rotateSecondaryM3u({ ...rotateArgs, currentPrincipal: savedPrincipal, currentSecondary: m3uUrl });
      if (fresh) {
        m3uUrl = fresh;
        clientPatch.m3u_url_secondary = fresh;
      }
    }
  }
  if (Object.keys(clientPatch).length) {
    await supabaseAdmin.from("clients").update(clientPatch).eq("id", row.client_id);
  }

  const { data: integ } = await supabaseAdmin
    .from("app_integrations")
    .select("api_url, pin")
    .eq("app_name", row.integrationType)
    .maybeSingle();

  const payloadPassword = PIN_HANDLERS.has(handler.actionPrefix) ? integ?.pin || "" : client.server_password || "";

  const internalSecret = String(process.env.INTERNAL_API_SECRET || "");
  const apiEndpointUrl = internalAppUrl(handler.apiEndpoint || "");

  // ✅ 06/10/2026, pedido do Márcio: "se eu estiver apenas adicionando uma
  // lista m3u, só quero adicionar e não substituir". Antes TODO Configurar
  // apagava antes de criar — e o delete, sem achar o nome, apagava a mais
  // parecida ou TODAS as listas do aparelho (regra do Remover). Agora
  // Configurar e Reconfigurar só apagam a lista com o MESMO nome exato (a
  // própria, pra não duplicar ao reenviar) e criam de novo — nunca a mais
  // parecida, nunca as outras listas do aparelho. Duplex TV fica de fora:
  // o parceiro só sabe apagar TODAS as listas do MAC, então lá só adiciona.
  // Secundária tem nome próprio (sufixo _2) — principal e secundária
  // convivem no aparelho, uma nunca apaga a outra.
  const listName = mode === "secundaria" ? `${finalServerName}_2` : finalServerName;
  if (handler.actionPrefix !== "DUPLEXTV") {
    try {
      const deletePayload = handler.buildDeletePayload({
        username: client.server_username,
        finalServerName: listName,
        serverName: serverNameClean,
        macValue,
        appName: row.appName,
        password: payloadPassword,
      });
      await fetch(apiEndpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
        body: JSON.stringify({ ...deletePayload, base_url: integ?.api_url || "", deviceKey, exact_only: true }),
      });
    } catch {
      // best-effort — segue pro create de qualquer jeito
    }
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
      finalServerName: listName,
      serverName: serverNameClean,
      m3uUrl,
      appName: row.appName,
      serverId: client.server_id,
      appId: row.appId,
    });
  } catch (e: any) {
    return { ok: false, stage: "precondition", error: e?.message || "Não foi possível montar a configuração para este app.", status: 400 };
  }

  // ✅ GPC Roku (achado 26/08/2026, pedido do Márcio — ver docs/sql/
  // gpc_roku_activations.sql): único membro cobrado da família GerenciaApp,
  // ele quem controla ativação/validade, não o +1 ano fixo que
  // buildCreatePayload manda pra todo mundo. MAC já conhecido → usa a
  // validade cadastrada; MAC novo → cadastra como teste de 7 dias. Nunca
  // muda a validade num MAC já conhecido — isso só acontece no pagamento
  // (lib/client-portal/fulfillment.ts).
  if (row.appName === "GPC Roku" && client.tenant_id) {
    try {
      const existing = await getGpcRokuActivation(supabaseAdmin, client.tenant_id, macValue);
      if (existing) {
        (payload as Record<string, unknown>).expire_date = existing.valid_until;
        await upsertGpcRokuActivation(supabaseAdmin, {
          tenantId: client.tenant_id,
          mac: macValue,
          clientId: row.client_id,
          clientAppId: row.id,
          status: existing.status,
          validUntil: existing.valid_until,
        });
      } else {
        const trialUntil = new Date();
        trialUntil.setDate(trialUntil.getDate() + 7);
        const trialDate = formatDateOnly(trialUntil);
        await upsertGpcRokuActivation(supabaseAdmin, {
          tenantId: client.tenant_id,
          mac: macValue,
          clientId: row.client_id,
          clientAppId: row.id,
          status: "trial",
          validUntil: trialDate,
          activatedBy: "Sistema (trial automático)",
        });
        (payload as Record<string, unknown>).expire_date = trialDate;
      }
    } catch (e: any) {
      return {
        ok: false,
        stage: "precondition",
        error: e?.message || "Falha ao consultar o registro de ativação do GPC Roku.",
        status: 500,
      };
    }
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
        body: JSON.stringify({ action: "check", base_url: integ?.api_url || "", username: listName, macValue }),
      });
      const checkJson = (await checkRes.json().catch(() => ({} as PartnerApiResponse))) as PartnerApiResponse;
      if (checkJson?.ok && checkJson.expireDate) expireDate = checkJson.expireDate;
    } catch {
      // mantém o expireDate do create como fallback
    }
  }

  // ✅ 02/10/2026 (Márcio: "no teste ele não pega o trial de primeira, preciso
  // checar o vencimento"): o parceiro pode avisar já no create que o
  // aparelho está em modo de avaliação (DUPLECAST lê a mesma página do
  // "check" logo depois de criar) — marca _trial_hint na hora, igual ao
  // checkClientAppValidity. Vencimento real tira a marca.
  const isTrial = !expireDate && !!apiJson.isTrial;
  const dateField = findFieldByType(row.fieldsConfig, "date");
  if (dateField && (expireDate || isTrial)) {
    const fieldKey = String(dateField.id || dateField.label);
    const { _trial_hint: _drop, ...semTrial } = row.field_values;
    void _drop;
    const next = expireDate ? { ...semTrial, [fieldKey]: expireDate } : { ...row.field_values, _trial_hint: "1" };
    await supabaseAdmin.from("client_apps").update({ field_values: next }).eq("id", row.id);
  }

  // ✅ 02/10/2026: guarda qual lista foi pro app (mostrado no card)
  await supabaseAdmin
    .from("client_apps")
    .update({ m3u_list: mode, m3u_list_at: new Date().toISOString() })
    .eq("id", row.id);

  return { ok: true, expireDate, isTrial, message: apiJson.message || "Configurado com sucesso.", m3uUrl, m3uList: mode };
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
    return { ok: false, error: "Preencha o ID/MAC antes de verificar." };
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
  const isTrial = !!apiJson.isTrial;
  let expireDate = rawExpireDate;
  if (expireDate && dateField) {
    const fieldKey = String(dateField.id || dateField.label);
    // ✅ 30/09/2026: vencimento REAL chegou (licença ativada) → sai do modo
    // de avaliação. Antes a marca _trial_hint nunca era removida.
    const { _trial_hint: _drop, ...semTrial } = row.field_values;
    void _drop;
    await supabaseAdmin
      .from("client_apps")
      .update({ field_values: { ...semTrial, [fieldKey]: expireDate } })
      .eq("id", row.id);
  } else if (dateField && isTrial) {
    // ✅ 30/09/2026, pedido do Márcio: parceiro confirma "trial" (ex:
    // DUPLECAST — a página dele mostra "Expire on" VAZIO no trial) → marca
    // modo de avaliação MESMO se houver data salva à mão; a data fica
    // guardada, só não é mostrada como validade, e a renovação fica liberada
    // no portal. Substitui a regra de 10/08/2026 (data manual escondia o trial).
    // expireDate fica null de propósito: quem chama trata "veio data" como
    // vencimento real confirmado (o admin tiraria o selo de avaliação).
    if (row.field_values["_trial_hint"] !== "1") {
      await supabaseAdmin
        .from("client_apps")
        .update({ field_values: { ...row.field_values, _trial_hint: "1" } })
        .eq("id", row.id);
    }
  } else if (dateField) {
    // Parceiro não devolveu vencimento e não é trial (ex: DUPLEXTV quase
    // nunca devolve) — mantém o valor já salvo no banco.
    const fieldKey = String(dateField.id || dateField.label);
    expireDate = row.field_values[fieldKey] || null;
  }

  return { ok: true, expireDate, rawExpireDate, isTrial };
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

  // ✅ 06/10/2026: a secundária tem nome próprio (`<nome>_2`) — o Remover tira
  // ela também, mas SÓ pelo nome exato (best-effort; Duplex TV já apagou
  // tudo do MAC no delete acima).
  if (finalServerName && handler.actionPrefix !== "DUPLEXTV") {
    try {
      const secPayload = handler.buildDeletePayload({
        username: client?.server_username || "",
        finalServerName: `${finalServerName}_2`,
        serverName: serverNameClean,
        macValue,
        appName: row.appName,
        password: payloadPassword,
      });
      await fetch(internalAppUrl(handler.apiEndpoint || ""), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
        body: JSON.stringify({ ...secPayload, base_url: integ?.api_url || "", deviceKey, exact_only: true }),
      });
    } catch {
      // best-effort
    }
  }

  if (apiJson?.ok) return { attempted: true, ok: true };
  return { attempted: true, ok: false, error: apiJson?.error || "Falha ao remover do painel do parceiro." };
}
