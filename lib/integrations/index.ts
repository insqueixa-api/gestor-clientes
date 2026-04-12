import { GerenciaAppIntegration, GpcComputadorIntegration } from "./gerenciaapp"; 
import { DupleCastIntegration } from "./duplecast";
import { IboSolIntegration } from "./ibosol"; 

const INTEGRATION_REGISTRY: Record<string, any> = {
    "IBOREVENDA":       GerenciaAppIntegration,
    "ZONEX":            GerenciaAppIntegration,
    "VUREVENDA":        GerenciaAppIntegration,
    "FACILITA":         GerenciaAppIntegration,
    "UNIREVENDA":       GerenciaAppIntegration,
    "GPC_ROKU":         GerenciaAppIntegration,
    "GPC_ANDROID":      GerenciaAppIntegration,
    "GPC_COMPUTADOR":   GpcComputadorIntegration, // ✅ NOVO

    "DUPLECAST":        DupleCastIntegration, 
    "IBOSOL":           IboSolIntegration, 
};

export function getIntegrationHandler(integrationType: string) {
    if (!integrationType) return null;
    return INTEGRATION_REGISTRY[integrationType.toUpperCase()] || null;
}