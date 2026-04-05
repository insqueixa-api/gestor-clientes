// src/lib/integrations/index.ts
import { IBORevendaIntegration } from "./gerenciaapps/iborevenda";
import { ZoneXIntegration } from "./gerenciaapps/zonex"; // ✅ Importa a nova regra

const INTEGRATION_REGISTRY: Record<string, any> = {
    "IBOREVENDA": IBORevendaIntegration, // IBO Revenda (App ID 10)
    "ZONEX": ZoneXIntegration,             // Zone X (App ID 11)
};

export function getIntegrationHandler(integrationType: string) {
    if (!integrationType) return null;
    return INTEGRATION_REGISTRY[integrationType.toUpperCase()] || null;
}

