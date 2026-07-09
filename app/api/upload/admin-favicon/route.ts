// app/api/upload/admin-favicon/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.redirect(new URL("/favicon.ico", req.url));

    const { data: member } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!member?.tenant_id) return NextResponse.redirect(new URL("/favicon.ico", req.url));

    const { data: tenant } = await supabase
      .from("tenants")
      .select("logo_url, profile")
      .eq("id", member.tenant_id)
      .maybeSingle();

    if (!tenant?.logo_url) return NextResponse.redirect(new URL("/favicon.ico", req.url));

    // Redireciona para a logo do tenant — o browser vai cachear como favicon
    return NextResponse.redirect(tenant.logo_url, { status: 302 });
  } catch {
    return NextResponse.redirect(new URL("/favicon.ico", req.url));
  }
}