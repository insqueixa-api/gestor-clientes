import { supabase } from "@/lib/supabase/client";

export default async function Home() {
  const { data, error } = await supabase.from("tenants").select("*").limit(5);

  return (
    <main style={{ padding: 20, fontFamily: "Arial" }}>
      <h1>Teste Supabase</h1>
      {error ? (
        <pre>Erro: {JSON.stringify(error, null, 2)}</pre>
      ) : (
        <pre>{JSON.stringify(data, null, 2)}</pre>
      )}
    </main>
  );
}
