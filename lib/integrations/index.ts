// src/lib/integrations/index.ts

import { GerenciaAppIntegration } from "./gerenciaapp"; 
import { DupleCastIntegration } from "./duplecast";
import { IboSolIntegration } from "./ibosol"; 

const INTEGRATION_REGISTRY: Record<string, any> = {
    // ✅ Apontamos todas as chaves antigas da família GerenciaApp para o novo motor universal
    "IBOREVENDA":   GerenciaAppIntegration,
    "ZONEX":        GerenciaAppIntegration,
    "VUREVENDA":    GerenciaAppIntegration,
    "FACILITA":     GerenciaAppIntegration,
    "UNIREVENDA":   GerenciaAppIntegration,
    "GPC_ROKU":     GerenciaAppIntegration,
    "GPC_ANDROID":  GerenciaAppIntegration,
    
    // Outras famílias
    "DUPLECAST":    DupleCastIntegration, 
    "IBOSOL":       IboSolIntegration, 
};

export function getIntegrationHandler(integrationType: string) {
    if (!integrationType) return null;
    return INTEGRATION_REGISTRY[integrationType.toUpperCase()] || null;
}