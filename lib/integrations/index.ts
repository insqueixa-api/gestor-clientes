import { GerenciaAppIntegration, GpcComputadorIntegration } from "./gerenciaapp"; 
import { DupleCastIntegration } from "./duplecast";
import { IbosolAPI as IboSolIntegration } from "@/app/api/integrations/apps/ibosol/ibosol"; // ✅ Import ajustado

const INTEGRATION_REGISTRY: Record<string, any> = {
    "IBOREVENDA":       GerenciaAppIntegration,
    "ZONEX":            GerenciaAppIntegration,
    "VUREVENDA":        GerenciaAppIntegration,
    "FACILITA":         GerenciaAppIntegration,
    "UNIREVENDA":       GerenciaAppIntegration,
    "GPC_ROKU":         GerenciaAppIntegration,
    "GPC_ANDROID":      GerenciaAppIntegration,
    "GPC_COMPUTADOR":   GpcComputadorIntegration, 

    "DUPLECAST":        DupleCastIntegration, 
    "IBOSOL":           IboSolIntegration, // ✅ Agora aponta corretamente para a API
};

export function getIntegrationHandler(integrationType: string) {
    if (!integrationType) return null;
    return INTEGRATION_REGISTRY[integrationType.toUpperCase()] || null;
}