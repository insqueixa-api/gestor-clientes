// app/api/workout/generate/route.ts
// Gera um plano de treino de calistenia (casa, sem academia) usando o
// Gemini já integrado no projeto (lib/whatsapp/gemini-client.ts). Chamado
// só quando o usuário clica em "Gerar treino" na tela de Perfil — nunca
// automaticamente — e o resultado é salvo por quem chamou em
// profiles.workout_plan (docs/sql/workout_habit.sql), então a IA só roda
// uma vez por geração, não a cada visita à página.
import { NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { callGemini } from "@/lib/whatsapp/gemini-client";
import { EXERCISES, type Difficulty } from "@/lib/workout/exercises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEVELS: Difficulty[] = ["iniciante", "intermediário", "avançado"];

function cleanJsonText(raw: string): string {
  let t = String(raw || "").trim();
  t = t.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
  return t;
}

type PlanDay = { label: string; exercises: { exercise_id: string; sets: number; reps: string }[] };
type Plan = { days: PlanDay[] };

function validatePlan(raw: any, validIds: Set<string>): Plan | null {
  if (!raw || !Array.isArray(raw.days) || raw.days.length < 2 || raw.days.length > 6) return null;
  const days: PlanDay[] = [];
  for (const d of raw.days) {
    const label = typeof d?.label === "string" ? d.label.trim().slice(0, 80) : "";
    if (!label || !Array.isArray(d?.exercises)) return null;
    const exercises = d.exercises
      .filter((ex: any) => ex && typeof ex.exercise_id === "string" && validIds.has(ex.exercise_id))
      .map((ex: any) => ({
        exercise_id: ex.exercise_id,
        sets: Number.isFinite(Number(ex.sets)) ? Math.min(6, Math.max(1, Math.round(Number(ex.sets)))) : 3,
        reps: typeof ex.reps === "string" && ex.reps.trim() ? ex.reps.trim().slice(0, 20) : "10-12",
      }));
    if (exercises.length < 3) return null;
    days.push({ label, exercises: exercises.slice(0, 8) });
  }
  return { days };
}

async function requestPlan(apiKey: string, level: Difficulty, frequencyDays: number, attempt: number): Promise<any> {
  const catalog = EXERCISES.map((e) => `- id:"${e.id}" | ${e.name} | grupo:${e.muscleGroup} | nível:${e.difficulty}`).join("\n");

  const reinforcement =
    attempt > 1
      ? "\n\nATENÇÃO: na tentativa anterior o JSON veio inválido ou usou exercise_id que não existe na lista. Use APENAS os ids exatamente como estão escritos na lista, entre aspas."
      : "";

  const prompt = `Você é um personal trainer especialista em calistenia (treino com peso do corpo, 100% em casa, sem academia e sem equipamentos além de uma barra fixa opcional e um banco/cadeira firme).

Monte um plano de treino em casa de ${frequencyDays} dias por semana, nível "${level}", alternando grupos musculares (ex: empurrar/puxar/pernas ou full body), usando SOMENTE exercícios da lista abaixo — nunca invente um exercício fora dela.

Lista de exercícios disponíveis (use o id exato):
${catalog}

Para cada dia escolha de 4 a 6 exercícios adequados ao nível "${level}", definindo séries (sets, 2 a 5) e repetições (reps, texto curto tipo "8-12" ou "30s" pra exercícios isométricos como prancha/cadeira na parede).

Responda APENAS com um JSON válido, sem markdown, sem comentários, no formato exato:
{"days":[{"label":"Treino A — Empurrar (Peito/Ombro/Tríceps)","exercises":[{"exercise_id":"flexao-braco","sets":3,"reps":"8-12"}]}]}${reinforcement}`;

  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
    },
  };

  const result = await callGemini(apiKey, payload, 30_000);
  const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const cleaned = cleanJsonText(rawText);
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!geminiKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // corpo vazio é aceitável — usa defaults
  }

  const level: Difficulty = LEVELS.includes(body?.level) ? body.level : "iniciante";
  const frequencyDays = Number.isFinite(Number(body?.frequency_days))
    ? Math.min(5, Math.max(2, Math.round(Number(body.frequency_days))))
    : 3;

  const validIds = new Set(EXERCISES.map((e) => e.id));

  try {
    let plan: Plan | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const raw = await requestPlan(geminiKey, level, frequencyDays, attempt);
      plan = validatePlan(raw, validIds);
      if (plan) break;
    }

    if (!plan) {
      return NextResponse.json(
        { error: "A IA não conseguiu montar um treino válido. Tente de novo." },
        { status: 422 },
      );
    }

    return NextResponse.json({
      ok: true,
      plan: {
        generated_at: new Date().toISOString(),
        level,
        frequency_days: frequencyDays,
        days: plan.days,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Falha ao gerar treino." }, { status: 500 });
  }
}
