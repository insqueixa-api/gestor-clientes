// lib/apps/resvg-tmp-cleanup.ts
//
// ✅ 18/09/2026, camada extra de proteção pedida pelo Márcio (investigação
// de "Functions Storage" alta na Vercel): mesmo já tendo desligado
// `loadSystemFonts` do Resvg (que evita a causa mais provável), essa
// limpeza roda como segunda linha de defesa — caso a instância da function
// seja reaproveitada entre invocações (comum em produção) e alguma
// biblioteca nativa ainda grave algo em /tmp por baixo dos panos, isso
// garante que não fica acumulando. Best-effort: nunca lança, nunca atrasa
// nem quebra o fluxo real (resolver captcha) por causa disso.
import os from "os";
import fs from "fs";
import path from "path";

export function cleanupResvgTmpCache(): void {
  try {
    const tmpDir = os.tmpdir();
    for (const entry of fs.readdirSync(tmpDir)) {
      if (/font|resvg|fontconfig/i.test(entry)) {
        fs.rmSync(path.join(tmpDir, entry), { recursive: true, force: true });
      }
    }
  } catch {
    // best-effort — nunca deve derrubar o fluxo de captcha por causa disso
  }
}
