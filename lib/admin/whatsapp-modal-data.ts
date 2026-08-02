import { supabaseBrowser } from "@/lib/supabase/browser";

export type WhatsAppSessionOption = {
  id: string;
  label: string;
};

export type MessageTemplate = {
  id: string;
  name: string;
  content: string;
  image_url?: string | null;
  category?: string | null;
};

export function buildWhatsAppSessionLabel(
  profile: any,
  sessionName: string,
): string {
  return profile?.connected ? sessionName : `${sessionName} (não conectado)`;
}

export async function loadWhatsAppSessionOptions(): Promise<
  WhatsAppSessionOption[]
> {
  const [res1, res2] = await Promise.all([
    fetch("/api/whatsapp/profile", { cache: "no-store" }).catch(() => null),
    fetch("/api/whatsapp/profile2", { cache: "no-store" }).catch(
      () => null,
    ),
  ]);

  const prof1 = res1 && res1.ok ? await res1.json().catch(() => ({})) : {};
  const prof2 = res2 && res2.ok ? await res2.json().catch(() => ({})) : {};

  const name1 =
    typeof window !== "undefined"
      ? localStorage.getItem("wa_label_1") || "Contato Principal"
      : "Contato Principal";
  const name2 =
    typeof window !== "undefined"
      ? localStorage.getItem("wa_label_2") || "Contato Secundário"
      : "Contato Secundário";

  const options: WhatsAppSessionOption[] = [
    { id: "default", label: buildWhatsAppSessionLabel(prof1, name1) },
  ];

  if (prof2?.connected) {
    options.push({
      id: "session2",
      label: buildWhatsAppSessionLabel(prof2, name2),
    });
  }

  return options;
}

export async function loadTenantMessageTemplates(
  tenantId: string,
): Promise<MessageTemplate[]> {
  const { data, error } = await supabaseBrowser
    .from("message_templates")
    .select("id,name,content,image_url,category")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  if (error) return [];

  return ((data as any[]) || []).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    content: String(row.content ?? ""),
    image_url: row.image_url || null,
    category: row.category || "Geral",
  }));
}
