import { IBORevendaIntegration } from "./gerenciaapps/iborevenda";
import { ZoneXIntegration } from "./gerenciaapps/zonex";
import { VURevendaIntegration } from "./gerenciaapps/vurevenda";
import { FacilitaIntegration } from "./gerenciaapps/facilita";
import { UNIRevendaIntegration } from "./gerenciaapps/unirevenda";
import { GPCRokuIntegration } from "./gerenciaapps/gpc_roku";       // ✅ Importa GPC Roku
import { GPCAndroidIntegration } from "./gerenciaapps/gpc_android"; // ✅ Importa GPC Android

const INTEGRATION_REGISTRY: Record<string, any> = {
    "IBOREVENDA": IBORevendaIntegration, // IBO Revenda (App ID 10)
    "ZONEX": ZoneXIntegration,           // Zone X (App ID 11)
    "VUREVENDA": VURevendaIntegration,   // VU Revenda (App ID 12)
    "FACILITA": FacilitaIntegration,     // Facilita (App ID 13)
    "UNIREVENDA": UNIRevendaIntegration, // UNI Revenda (App ID 15)
    "GPC_ROKU": GPCRokuIntegration,      // ✅ GPC Roku TV (App ID 17)
    "GPC_ANDROID": GPCAndroidIntegration,// ✅ GPC Android (App ID 20)
};

export function getIntegrationHandler(integrationType: string) {
    if (!integrationType) return null;
    return INTEGRATION_REGISTRY[integrationType.toUpperCase()] || null;
}