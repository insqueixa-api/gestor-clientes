import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLIENTS = {
  "Insqueixa / NaTV": "f7e0b6e7-e7bb-486f-924c-5fc6704b94e9",
  "InsqueixaElite / EliteTV": "27a871c0-4850-4bd0-8a5a-52609abe569f",
  "Insqueixa / FastTV": "aefcff7a-9b8f-46be-9a1b-155a73a472de",
};

for (const [label, clientId] of Object.entries(CLIENTS)) {
  const { data } = await supabase
    .from("client_apps")
    .select("id, field_values, apps(name)")
    .eq("client_id", clientId)
    .in("apps.name", ["Duplex TV", "IPTV Duplex Play"]);
  for (const row of data || []) {
    if (!row.apps) continue;
    console.log(`${label} / ${row.apps.name} (${row.id}):`, JSON.stringify(row.field_values));
  }
}

// also check activity log for recent configure events on these apps
const { data: logs } = await supabase
  .from("client_app_activity_log")
  .select("client_id, app_name, event, detail, created_at")
  .in("app_name", ["Duplex TV", "IPTV Duplex Play"])
  .order("created_at", { ascending: false })
  .limit(10);
console.log("\nÚltimos eventos de log pra Duplex TV / IPTV Duplex Play:");
for (const l of logs || []) console.log(" -", l.created_at, l.app_name, l.event, JSON.stringify(l.detail));
