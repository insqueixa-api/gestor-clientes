// src/lib/integrations/index.ts
import { IBORevendaIntegration } from "./gerenciaapps/iborevenda";
import { ZoneXIntegration } from "./gerenciaapps/zonex";
import { VURevendaIntegration } from "./gerenciaapps/vurevenda"; // ✅ Importa a nova regra

const INTEGRATION_REGISTRY: Record<string, any> = {
    "IBOREVENDA": IBORevendaIntegration, // IBO Revenda (App ID 10)
    "ZONEX": ZoneXIntegration,           // Zone X (App ID 11)
    "VUREVENDA": VURevendaIntegration,   // VU Revenda (App ID 12)
};

export function getIntegrationHandler(integrationType: string) {
    if (!integrationType) return null;
    return INTEGRATION_REGISTRY[integrationType.toUpperCase()] || null;
}

