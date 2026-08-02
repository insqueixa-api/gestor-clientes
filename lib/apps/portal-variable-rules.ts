export const PORTAL_VARIABLE_OPTIONS: { key: string; label: string }[] = [
  { key: "codigo", label: "Código" },
  { key: "name", label: "Name" },
  { key: "usuario_app", label: "Usuário" },
  { key: "senha_app", label: "Senha" },
  { key: "dns_servidor", label: "DNS" },
  { key: "m3u_url", label: "Lista M3U" },
];

export const PORTAL_VARIABLE_LABELS: Record<string, string> =
  PORTAL_VARIABLE_OPTIONS.reduce((acc, item) => {
    acc[item.key] = item.label;
    return acc;
  }, {} as Record<string, string>);

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
