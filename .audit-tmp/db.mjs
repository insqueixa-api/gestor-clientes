import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const envContent = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envContent.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

export const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
export const TENANT_ID = "a5ab0672-c845-4c40-96b9-eeed197e04ed";
export const ENV = env;
