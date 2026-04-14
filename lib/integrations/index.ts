import { GerenciaAppIntegration } from "./gerenciaapp"; 
import { DupleCastIntegration } from "./duplecast";
import { IbosolAPI as IboSolIntegration } from "@/app/api/integrations/apps/ibosol/ibosol";
import { IboProAPI as IboProIntegration } from "@/app/api/integrations/apps/ibopro/ibopro";

const INTEGRATION_REGISTRY: Record<string, any> = {
    "GERENCIAAPP":      GerenciaAppIntegration, // ✅ Nova chave oficial
    "IBOREVENDA":       GerenciaAppIntegration, // ✅ Mantido como fallback para clientes antigos no banco
    "ZONEX":            GerenciaAppIntegration,
    "VUREVENDA":        GerenciaAppIntegration,
    "FACILITA":         GerenciaAppIntegration,
    "UNIREVENDA":       GerenciaAppIntegration,
    "GPC_ROKU":         GerenciaAppIntegration,
    "GPC_ANDROID":      GerenciaAppIntegration,

    "DUPLECAST":        DupleCastIntegration, 
    "IBOSOL":           IboSolIntegration,
    "IBOPRO":           IboProIntegration,
};

export function getIntegrationHandler(integrationType: string) {
    if (!integrationType) return null;
    return INTEGRATION_REGISTRY[integrationType.toUpperCase()] || null;
}