// server.js — serviço de geração de PDF do informativo de condomínio.
// Chamado pelo Next.js (Vercel) via HTTP com Bearer token — mesmo padrão já
// usado pra VM do WhatsApp (UNIGESTOR_WA_BASE_URL/TOKEN), só que aqui pra
// PDF: PDF_VM_BASE_URL/PDF_VM_TOKEN. Puppeteer liga só durante a geração
// (poucos segundos por request) e fecha em seguida — não fica residente.
const http = require("http");
const puppeteer = require("puppeteer");
const { PDFDocument } = require("pdf-lib");
const { montarHtml, nomeArquivoPdf } = require("./template");

function contentDispositionPdf(nomeArquivo) {
  const ascii = nomeArquivo
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${ascii}.pdf"; filename*=UTF-8''${encodeURIComponent(nomeArquivo)}.pdf`;
}

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.PDF_VM_TOKEN || "";

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 10 * 1024 * 1024) {
        reject(new Error("Payload muito grande"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// ✅ 30/08/2026, achado do Márcio: a pré-visualização (aberta via blob: no
// front) não carrega o header Content-Disposition — blob: URL descarta
// TODOS os headers HTTP. Nesse caso o Chrome sugere o nome pra salvar a
// partir do metadado /Title do PDF em si — e o page.pdf() do Puppeteer NÃO
// copia o <title> do HTML pra esse metadado sozinho (por isso vinha um ID
// aleatório). pdf-lib seta o /Title de verdade, depois de gerado.
async function gerarPdf(payload, nomeArquivo) {
  const html = montarHtml(payload);
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    const largura = 794; // ~210mm a 96dpi (A4)
    await page.setViewport({ width: largura, height: 1123 });
    // ✅ 30/08/2026, achado do Márcio (timeout ao gerar PDF, 3-4x seguidas):
    // "networkidle0" exige ZERO atividade de rede por 500ms — QUALQUER foto
    // do R2 lenta ou travada (comum quando a Ação tem várias) já estourava
    // o timeout de 30s e derrubava a geração inteira (log real da VM:
    // "TimeoutError: Navigation timeout of 30000 ms exceeded"). Troca:
    // espera só o HTML/CSS (domcontentloaded, quase instantâneo) e depois
    // espera cada <img> terminar (carregar OU falhar) — timeout PRÓPRIO de
    // 40s por imagem (30/08/2026: era 20s, ampliado a pedido do Márcio pra
    // dar mais margem), em paralelo, não em série. Uma foto lenta/quebrada
    // não trava mais as outras nem a geração inteira.
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.evaluate(() => {
      const imgs = Array.from(document.images);
      return Promise.all(
        imgs.map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve) => {
            const done = () => resolve();
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
            setTimeout(done, 40000);
          });
        }),
      );
    });
    const altura = await page.evaluate(() => document.documentElement.scrollHeight);
    const pdf = await page.pdf({
      width: largura,
      height: altura,
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });

    const pdfDoc = await PDFDocument.load(pdf);
    pdfDoc.setTitle(nomeArquivo);
    return Buffer.from(await pdfDoc.save());
  } finally {
    await browser.close();
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  if (req.method !== "POST" || req.url !== "/gerar-pdf") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Rota não encontrada" }));
    return;
  }

  const auth = req.headers["authorization"] || "";
  const tokenRecebido = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!TOKEN || tokenRecebido !== TOKEN) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Não autorizado" }));
    return;
  }

  try {
    const raw = await readBody(req);
    const payload = JSON.parse(raw);
    if (!payload?.condominio?.nome || !Array.isArray(payload?.itens)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Payload inválido (condominio.nome e itens são obrigatórios)" }));
      return;
    }

    const nomeArquivo = nomeArquivoPdf(
      payload.condominio.nome,
      payload.edicao?.tipo,
      payload.edicao?.versao,
    );
    const pdf = await gerarPdf(payload, nomeArquivo);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDispositionPdf(nomeArquivo),
      "Content-Length": pdf.length,
    });
    res.end(pdf);
  } catch (e) {
    console.error("Erro ao gerar PDF:", e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e?.message || "Falha ao gerar PDF" }));
  }
});

server.listen(PORT, () => {
  console.log(`Serviço de PDF ouvindo na porta ${PORT}`);
});
