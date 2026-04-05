// src/lib/integrations/index.ts
import { GerenciaAppIntegration } from "./gerenciaapp";
// import { DuplecastIntegration } from "./duplecast"; // <-- Exemplo de como será no futuro

// O "Cérebro" que liga o nome do banco de dados com o arquivo de código correto
const INTEGRATION_REGISTRY: Record<string, any> = {
    "GERENCIAAPP": GerenciaAppIntegration, // Supondo que 'GERENCIAAPP' é o valor salvo no seu banco em app.integration_type
    // "DUPLECAST": DuplecastIntegration,
};

// Função que a tela vai chamar para descobrir qual código usar
export function getIntegrationHandler(integrationType: string) {
    if (!integrationType) return null;
    return INTEGRATION_REGISTRY[integrationType.toUpperCase()] || null;
}