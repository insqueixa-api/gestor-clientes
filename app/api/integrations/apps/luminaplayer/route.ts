// app/api/integrations/apps/luminaplayer/route.ts
// Família inoRain — toda a lógica em lib/integrations/inorain-family-route.ts.
import { makeInorainRoute } from "@/lib/integrations/inorain-family-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = makeInorainRoute("LUMINAPLAYER");
