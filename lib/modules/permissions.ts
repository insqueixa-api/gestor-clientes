export type Module = 
  | "iptv" 
  | "saas" 
  | "financeiro" 
  | "academia" 
  | "personal" 
  | "condominio";

// Quais módulos têm acesso a cada feature/página
export const PERMISSIONS = {
  // Navegação
  dashboard:          ["iptv", "saas", "financeiro", "academia", "personal"] as Module[],
  clientes:           ["iptv", "saas"] as Module[],
  alunos:             ["academia", "personal"] as Module[],
  revendas:           ["iptv", "saas"] as Module[],
  testes:             ["iptv", "saas"] as Module[],

  // Gerenciador
  servidores:         ["iptv", "saas", "academia", "personal", "financeiro"] as Module[],
  planos:             ["iptv", "saas", "academia", "personal", "financeiro"] as Module[],
  mensagens:          ["iptv", "saas", "academia", "personal", "financeiro"] as Module[],
  cobranca:           ["iptv", "saas", "academia", "personal", "financeiro"] as Module[],
  pagamento:          ["iptv", "saas", "academia", "personal", "financeiro"] as Module[],
  aplicativos:        ["iptv", "saas"] as Module[],

  // Conta
  perfil:             ["iptv", "saas", "financeiro", "academia", "personal", "condominio"] as Module[],
  financeiroPage:     ["financeiro"] as Module[],
  gestaoSaas:         ["saas"] as Module[],
  apiIntegracoes:     ["iptv", "saas"] as Module[],

  // Branding/visual
  branding:           ["academia", "personal", "condominio"] as Module[],
  apiKeys:            ["iptv", "saas"] as Module[],
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;