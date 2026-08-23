// server.js — serviço de geração de PDF do informativo de condomínio.
// Chamado pelo Next.js (Vercel) via HTTP com Bearer token — mesmo padrão já
// usado pra VM do WhatsApp (UNIGESTOR_WA_BASE_URL/TOKEN), só que aqui pra
// PDF: PDF_VM_BASE_URL/PDF_VM_TOKEN. Puppeteer liga só durante a geração
// (poucos segundos por request) e fecha em seguida — não fica residente.
const http = require("http");
const puppeteer = require("puppeteer");
const { montarHtml } = require("./template");

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

async function gerarPdf(payload) {
  const html = montarHtml(payload);
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    const largura = 794; // ~210mm a 96dpi (A4)
    await page.setViewport({ width: largura, height: 1123 });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30_000 });
    const altura = await page.evaluate(() => document.documentElement.scrollHeight);
    const pdf = await page.pdf({
      width: largura,
      height: altura,
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    return pdf;
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

    const pdf = await gerarPdf(payload);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="informativo.pdf"`,
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
