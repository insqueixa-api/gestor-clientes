// lib/apps/types.ts
// Tipos canônicos do domínio "aplicativos do cliente" — ponto único de
// verdade para o que hoje está redefinido separadamente em novo_cliente.tsx
// (AppCatalog/SelectedAppInstance), RenewBetaClient.tsx (InstalledApp),
// AddAppModal.tsx (CatalogApp), AppDetailClient.tsx (AppDetail) e
// app/admin/gerenciador/aplicativo/page.tsx (AppData). A migração dos
// arquivos acima para usar estes tipos acontece em fase futura — por agora
// isto é consumido só por lib/apps/orchestration.ts e pelas rotas novas.

// Campo de configuração de um app do catálogo (coluna apps.fields_config).
export type AppFieldType = "text" | "mac" | "date" | "device_key" | "email" | "password" | string;

export type AppFieldConfig = {
  id: string;
  type: AppFieldType;
  label: string;
  required?: boolean;
};

// Linha da tabela `apps` (catálogo).
export type AppCatalogEntry = {
  id: string;
  name: string;
  icon_url?: string | null;
  info_url?: string | null;
  integration_type?: string | null;
  cost_type?: "paid" | "partnership" | string | null;
  is_active?: boolean;
  discontinued_replacement_name?: string | null;
  fields_config: AppFieldConfig[];
};

// Linha da tabela `client_apps` já persistida, com o catálogo resolvido —
// forma "canônica" de um app instalado. Estados locais de UI (ex: instância
// ainda não salva no admin, ou campos de edição inline no portal) devem
// envolver este tipo, não redefini-lo.
export type ClientAppRecord = {
  id: string;
  client_id: string;
  app_id: string;
  field_values: Record<string, string>;
  app: AppCatalogEntry;
};

// Payload devolvido por um IntegrationHandler ao montar a chamada pro
// endpoint do parceiro (app/api/integrations/apps/*). Estrutural — cada
// handler em lib/integrations/*.ts monta o que o parceiro dele espera.
export type IntegrationPayload = Record<string, unknown>;

// Contrato leve dos handlers em lib/integrations/index.ts (hoje tipados como
// `any` no INTEGRATION_REGISTRY). Só documenta o formato — não é validado em
// runtime.
export type IntegrationHandler = {
  actionPrefix: string;
  // true = tem endpoint /api/integrations/apps/* server-to-server (ex:
  // GERENCIAAPP, DUPLECAST, MESSITV...). false/ausente = só via extensão do
  // Chrome no browser do admin (hoje só CLOUDDY) — nunca passa por
  // lib/apps/orchestration.ts.
  useApi?: boolean;
  apiEndpoint?: string;
  buildCreatePayload: (params: {
    username: string;
    password?: string;
    macValue: string;
    finalServerName: string;
    serverName?: string;
    m3uUrl: string;
    appName?: string;
    serverId?: string | null;
  }) => IntegrationPayload;
  buildDeletePayload: (params: {
    username: string;
    finalServerName?: string;
    serverName?: string;
    macValue: string;
    appName?: string;
    password?: string;
  }) => IntegrationPayload;
};

export type PartnerApiResponse = {
  ok?: boolean;
  error?: string;
  expireDate?: string | null;
  message?: string;
  repeat_warning?: boolean;
  suggest_secondary?: boolean;
  blocked?: boolean;
};

// Resultado estruturado das funções de lib/apps/orchestration.ts — cada rota
// chamadora (portal ou admin) decide como transformar isso em resposta HTTP,
// rate-limit e log de auditoria (client_app_activity_log). `stage` existe só
// em ConfigureAppResult porque é o único fluxo com uma trava de tentativas
// (rate-limit) hoje — o portal precisa saber se a falha chegou a chamar o
// parceiro (loga + conta pra trava) ou parou antes (não loga, igual hoje).
export type ConfigureAppResult =
  | { ok: true; expireDate: string | null; message: string | null }
  | { ok: false; stage: "precondition"; error: string; status: number }
  | { ok: false; stage: "partner_call"; error: string };

// `rawExpireDate` é o que o parceiro devolveu de verdade (pode ser null,
// ex: DUPLEXTV) — separado de `expireDate`, que já aplica o fallback "sem
// retorno → mantém o valor salvo no banco". A rota loga o raw (auditoria) e
// devolve o final pro cliente/admin.
export type CheckAppValidityResult =
  | { ok: true; expireDate: string | null; rawExpireDate: string | null }
  | { ok: false; error: string };

// `attempted: false` = app sem integração automática, nada foi chamado no
// parceiro (quem decide o que fazer com isso — pedido pendente no portal,
// exclusão direta no admin — é a rota, não aqui).
export type RemoveAppFromPartnerResult =
  | { attempted: false }
  | { attempted: true; ok: true }
  | { attempted: true; ok: false; error: string };
