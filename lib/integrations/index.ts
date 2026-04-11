import { IBORevendaIntegration } from "./gerenciaapps/iborevenda";
import { ZoneXIntegration } from "./gerenciaapps/zonex";
import { VURevendaIntegration } from "./gerenciaapps/vurevenda";
import { FacilitaIntegration } from "./gerenciaapps/facilita";
import { UNIRevendaIntegration } from "./gerenciaapps/unirevenda";
import { GPCRokuIntegration } from "./gerenciaapps/gpc_roku";
import { GPCAndroidIntegration } from "./gerenciaapps/gpc_android";
import { DupleCastIntegration } from "./duplecast/duplecast";
import { IboSolIntegration } from "./ibosol/ibosol"; // ✅ NOVO IMPORT

const INTEGRATION_REGISTRY: Record<string, any> = {
    "IBOREVENDA":   IBORevendaIntegration,
    "ZONEX":        ZoneXIntegration,
    "VUREVENDA":    VURevendaIntegration,
    "FACILITA":     FacilitaIntegration,
    "UNIREVENDA":   UNIRevendaIntegration,
    "GPC_ROKU":     GPCRokuIntegration,
    "GPC_ANDROID":  GPCAndroidIntegration,
    "DUPLECAST":    DupleCastIntegration, 
    "IBOSOL":       IboSolIntegration, // ✅ NOVA FAMÍLIA
};

export function getIntegrationHandler(integrationType: string) {
    if (!integrationType) return null;
    return INTEGRATION_REGISTRY[integrationType.toUpperCase()] || null;
}