export type M3UBadgeRule = "none" | "primary" | "secondary" | "both";

export const PORTAL_VARIABLE_OPTIONS: { key: string; label: string }[] = [
  { key: "codigo", label: "Código" },
  { key: "usuario_app", label: "Usuário" },
  { key: "senha_app", label: "Senha" },
  { key: "dns_servidor", label: "DNS" },
  { key: "m3u_url", label: "Link M3U" },
  { key: "dns_servidor_r2", label: "DNS (Rota 2 - só NaTV)" },
  { key: "m3u_url_r2", label: "Link M3U (Rota 2 - só NaTV)" },
];

export const PORTAL_VARIABLE_LABELS: Record<string, string> =
  PORTAL_VARIABLE_OPTIONS.reduce((acc, item) => {
    acc[item.key] = item.label;
    return acc;
  }, {} as Record<string, string>);

export const M3U_VARIABLE_KEYS = ["m3u_url", "m3u_url_r2"] as const;

export const NON_M3U_VARIABLE_OPTIONS = PORTAL_VARIABLE_OPTIONS.filter(
  (opt) => !M3U_VARIABLE_KEYS.includes(opt.key as (typeof M3U_VARIABLE_KEYS)[number]),
);

export const PORTAL_INSTRUCTION_TAGS: { tag: string; label: string }[] = [
  { tag: "{m3u_url}", label: "Link M3U" },
  { tag: "{m3u_url_r2}", label: "Link M3U (Rota 2)" },
];

export function badgesToM3URule(keys: string[]): M3UBadgeRule {
  const hasPrimary = keys.includes("m3u_url");
  const hasSecondary = keys.includes("m3u_url_r2");
  if (hasPrimary && hasSecondary) return "both";
  if (hasSecondary) return "secondary";
  if (hasPrimary) return "primary";
  return "none";
}

export function applyM3URule(keys: string[], rule: M3UBadgeRule): string[] {
  const withoutM3U = keys.filter(
    (k) => !M3U_VARIABLE_KEYS.includes(k as (typeof M3U_VARIABLE_KEYS)[number]),
  );
  if (rule === "primary") return [...withoutM3U, "m3u_url"];
  if (rule === "secondary") return [...withoutM3U, "m3u_url_r2"];
  if (rule === "both") return [...withoutM3U, "m3u_url", "m3u_url_r2"];
  return withoutM3U;
}

export function buildPortalVariableFields(
  selectedKeys: string[] | null | undefined,
  values: Record<string, string>,
) {
  const keys = Array.isArray(selectedKeys) ? selectedKeys : [];
  if (!keys.length) return [] as Array<{ id: string; label: string; value: string }>;

  return keys
    .filter((key) => !!PORTAL_VARIABLE_LABELS[key])
    .map((key) => ({
      id: key,
      label: PORTAL_VARIABLE_LABELS[key],
      value: values[key] || "",
    }))
    .filter((field) => field.value);
}
