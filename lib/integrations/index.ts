// lib/integrations/index.ts
import type { IntegrationHandler } from "@/lib/apps/types";
import { GerenciaAppIntegration } from "./gerenciaapp";
import { DupleCastIntegration } from "./duplecast";
import { IboProAPI as IboProIntegration } from "@/app/api/integrations/apps/ibopro/ibopro";
import { QuickPlayerAPI } from "./quickplayer";
import { MessiTVIntegration } from "./messitv";
import { BobPlayerIntegration } from "./bobplayer";
import { IboPlayerIntegration } from "./iboplayer";
import { DuplexTvIntegration } from "./duplextv";
import { NinjaPlusIntegration } from "./ninjaplus";
import { CapPlayerIntegration } from "./capplayer";
import { INORAIN_FAMILY, makeInorainIntegration } from "./inorain-family";

const INTEGRATION_REGISTRY: Record<string, IntegrationHandler> = {
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
    "IBOPRO":           IboProIntegration,
    "QUICKPLAYER":      QuickPlayerAPI,
    "MESSITV":          MessiTVIntegration,
    "BOBPLAYER":        BobPlayerIntegration,
    "IBOPLAYER":        IboPlayerIntegration,
    "DUPLEXTV":         DuplexTvIntegration,
    "NINJAPLUS":        NinjaPlusIntegration,
    "CAPPLAYER":        CapPlayerIntegration,
    // ✅ 03/10/2026: família inoRain (IPTV Duplex, Player.io, OTT Player,
    // IPTV 4K, Plus, Pro, Star...) — uma rota compartilhada pra todas.
    ...Object.fromEntries(Object.keys(INORAIN_FAMILY).map((h) => [h, makeInorainIntegration(h)])),
    // ✅ CLOUDDY não entra aqui de propósito — é 100% via
    // extensão (Cloudflare Turnstile real bloqueia qualquer chamada
    // server-to-server). Ver "COMEÇO INTEGRAÇÃO: CLOUDDY" em
    // unigestor-extensao/background.js e os handlers handleClouddy* em
    // app/admin/cliente/novo_cliente.tsx.
};

export function getIntegrationHandler(integrationType: string) {
    if (!integrationType) return null;
    return INTEGRATION_REGISTRY[integrationType.toUpperCase()] || null;
}