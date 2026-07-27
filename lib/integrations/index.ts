// lib/integrations/index.ts
import { GerenciaAppIntegration } from "./gerenciaapp";
import { DupleCastIntegration } from "./duplecast";
import { IbosolAPI as IboSolIntegration } from "@/app/api/integrations/apps/ibosol/ibosol";
import { IboProAPI as IboProIntegration } from "@/app/api/integrations/apps/ibopro/ibopro";
import { QuickPlayerAPI } from "./quickplayer";
import { MessiTVIntegration } from "./messitv";
import { BobPlayerIntegration } from "./bobplayer";
import { IboPlayerIntegration } from "./iboplayer";

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
    "IBOSOL":           IboSolIntegration,
    "IBOPRO":           IboProIntegration,
    "QUICKPLAYER":      QuickPlayerAPI,
    "MESSITV":          MessiTVIntegration,
    "BOBPLAYER":        BobPlayerIntegration,
    "IBOPLAYER":        IboPlayerIntegration,
};

export function getIntegrationHandler(integrationType: string) {
    if (!integrationType) return null;
    return INTEGRATION_REGISTRY[integrationType.toUpperCase()] || null;
}