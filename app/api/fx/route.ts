import { NextResponse } from "next/server";

// Cache de 1 hora para evitar floodar as APIs externas (opcional, mas recomendado)
export const revalidate = 3600; 

const ALLOWED = new Set(["BRL", "USD", "EUR"]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeCurrency(v: any, fallback: string) {
  const s = String(v ?? "").trim().toUpperCase();
  if (ALLOWED.has(s)) return s;
  return fallback;
}

// --- PROVEDOR 1: FRANKFURTER (Banco Central Europeu) ---
async function tryFrankfurter(base: string, to: string) {
  const url = `https://api.frankfurter.app/latest?from=${base}&to=${to}`;
  const res = await fetch(url, { next: { revalidate: 3600 } }); // Cache Next.js
  if (!res.ok) throw new Error(`Frankfurter status: ${res.status}`);
  
  const json = await res.json();
  const rate = Number(json?.rates?.[to]);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Frankfurter invalid rate");
  
  return { rate, source: "frankfurter", date: json.date };
}

// --- PROVEDOR 2: AWESOMEAPI (Excelente para BRL) ---
async function tryAwesomeApi(base: string, to: string) {
  // AwesomeAPI usa formato "USD-BRL"
  const pair = `${base}-${to}`;
  const key = `${base}${to}`; // Retorno vem como USDBRL
  const url = `https://economia.awesomeapi.com.br/last/${pair}`;
  
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`AwesomeAPI status: ${res.status}`);
  
  const json = await res.json();
  const item = json[key];
  const rate = Number(item?.bid); // 'bid' é o valor de compra/mercado
  
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("AwesomeAPI invalid rate");
  
  // Awesome data vem como "YYYY-MM-DD HH:mm:ss", pegamos só a data
  const date = item.create_date ? item.create_date.split(" ")[0] : new Date().toISOString().slice(0, 10);
  
  return { rate, source: "awesomeapi", date };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const base = normalizeCurrency(searchParams.get("base"), "USD");
    const to = normalizeCurrency(searchParams.get("to"), "BRL");

    // 1. Identidade (USD -> USD)
    if (base === to) {
      return NextResponse.json({
        base,
        to,
        rate: 1,
        date: new Date().toISOString().slice(0, 10),
        source: "identity",
      });
    }

    // 2. Tenta Frankfurter
    try {
      const data = await tryFrankfurter(base, to);
      return NextResponse.json({ base, to, ...data });
    } catch (err1) {
      console.warn(`[FX] Frankfurter failed for ${base}-${to}, trying backup...`, err1);
    }

    // 3. Tenta AwesomeAPI (Backup)
    try {
      const data = await tryAwesomeApi(base, to);
      return NextResponse.json({ base, to, ...data });
    } catch (err2) {
      console.error(`[FX] AwesomeAPI also failed for ${base}-${to}`, err2);
    }

    // 4. Se tudo falhar, retorna erro 500 (O Front usará o fallback 5 ou 6)
    return NextResponse.json(
      { error: "All FX providers failed" },
      { status: 500 }
    );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}