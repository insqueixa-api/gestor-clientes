import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ error: "Em desenvolvimento" }, { status: 501 });
}