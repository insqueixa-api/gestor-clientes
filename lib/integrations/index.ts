import { GerenciaAppIntegration } from "./gerenciaapp"; 
import { DupleCastIntegration } from "./duplecast";
import { LazerPlayIntegration } from "./lazerplay"; // ✅ Importando a nova lib
import { IbosolAPI as IboSolIntegration } from "@/app/api/integrations/apps/ibosol/ibosol";
import { IboProAPI as IboProIntegration } from "@/app/api/integrations/apps/ibopro/ibopro";
import { QuickPlayerAPI as QuickPlayerIntegration } from "@/app/api/integrations/apps/quickplayer/quickplayer";

const INTEGRATION_REGISTRY: Record<string, any> = {
    "GERENCIAAPP":      GerenciaAppIntegration, 
    "IBOREVENDA":       GerenciaAppIntegration, 
    "ZONEX":            GerenciaAppIntegration,
    "VUREVENDA":        GerenciaAppIntegration,
    "FACILITA":         GerenciaAppIntegration,
    "UNIREVENDA":       GerenciaAppIntegration,
    "GPC_ROKU":         GerenciaAppIntegration,
    "GPCANDROID":       GerenciaAppIntegration,
    "GPCLG":            GerenciaAppIntegration,

    "DUPLECAST":        DupleCastIntegration, 
    "LAZERPLAY":        LazerPlayIntegration,
    "FUNPLAY":          LazerPlayIntegration,
    "FOCOXPLAY":        LazerPlayIntegration,
    "IBOSOL":           IboSolIntegration,
    "IBOPRO":           IboProIntegration,
    "QUICKPLAYER":      QuickPlayerIntegration,
};

export function getIntegrationHandler(integrationType: string) {
    if (!integrationType) return null;
    return INTEGRATION_REGISTRY[integrationType.toUpperCase()] || null;
}