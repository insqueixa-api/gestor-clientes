// template.js — monta o HTML do informativo (jornalzinho do condomínio) a
// partir dos dados recebidos do Next.js. Sem Tailwind CDN (sem dependência
// de rede externa na hora de gerar) — CSS puro embutido. Cores
// institucionais (cabeçalho/rodapé/título de seção) vêm de
// condominio.cor_primaria/cor_secundaria; a paleta de status (badge de cada
// ação) é fixa, igual ao protótipo local — é um indicador semântico
// universal, não faz parte da identidade visual do condomínio.

const STATUS_LABEL = {
  futuro: "FUTURO",
  planejado: "PLANEJADO / EM COTAÇÃO",
  em_andamento: "EM ANDAMENTO",
  pausado: "PAUSADO",
  concluido: "CONCLUÍDO",
};

const STATUS_COR = {
  futuro: { bg: "#f1f5f9", text: "#475569", border: "#94a3b8" },
  planejado: { bg: "#fef3c7", text: "#92400e", border: "#f59e0b" },
  em_andamento: { bg: "#dbeafe", text: "#1e40af", border: "#3b82f6" },
  pausado: { bg: "#fee2e2", text: "#991b1b", border: "#ef4444" },
  concluido: { bg: "#d1fae5", text: "#065f46", border: "#10b981" },
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function nl2br(s) {
  return esc(s).replace(/\n/g, "<br/>");
}

// Agrupa itens consecutivos do mesmo status em blocos (a ordem já vem pronta
// do front — aqui só faz o "chunking" visual, não reordena nada).
function agruparPorStatus(itens) {
  const grupos = [];
  for (const item of itens) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.status === item.status) {
      ultimo.itens.push(item);
    } else {
      grupos.push({ status: item.status, itens: [item] });
    }
  }
  return grupos;
}

function formatarDataExtenso(dataISO) {
  const meses = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];
  const [ano, mes, dia] = String(dataISO).split("-").map(Number);
  return `${dia} de ${meses[(mes || 1) - 1]} de ${ano}`;
}

// Mesmo formato de nome usado no front (nomeArquivoPdf em shared.ts) —
// repetido aqui pra virar o <title> do HTML, porque é dele que o Puppeteer
// tira o metadado /Title do PDF gerado. Sem isso, quando o usuário abre o
// PDF direto num blob: URL (pré-visualização) e tenta "Salvar como", o
// navegador não tem Content-Disposition pra ler (blob: descarta headers) e
// sugere um nome aleatório em vez do nome certo.
function nomeArquivoPdf(nomeCondominio, tipo, versao) {
  const tipoLabel = tipo === "mensal" ? "Mensal" : "Semanal";
  return `${nomeCondominio} - Informativo ${tipoLabel} - v${String(versao || 1).padStart(3, "0")}`;
}

function montarHtml({ condominio, edicao, itens }) {
  const corPrimaria = condominio.cor_primaria || "#1e3a8a";
  const corSecundaria = condominio.cor_secundaria || "#facc15";
  const tipoLabel = edicao.tipo === "mensal" ? "Mensal" : "Semanal";
  const nomeArquivo = nomeArquivoPdf(condominio.nome, edicao.tipo, edicao.versao);
  const grupos = agruparPorStatus(itens);

  // ✅ 30/08/2026, achado do Márcio: mesma regra de titulo_pagina
  // ("logo_nome" | "logo" | "nome") usada no admin (app/admin/settings/
  // condominio/page.tsx) — o PDF sempre mostrava logo+nome juntos, sem
  // olhar pra essa configuração. Sem logo cadastrada, "logo" cai pra
  // "nome" (nunca mostra o cabeçalho vazio).
  const temLogo = !!condominio.logo_url;
  const tituloPaginaModo = condominio.titulo_pagina || "logo_nome";
  const tituloPaginaEfetivo = tituloPaginaModo === "logo" && !temLogo ? "nome" : tituloPaginaModo;
  const exibirLogo = tituloPaginaEfetivo !== "nome" && temLogo;
  const exibirNomeCondominio = tituloPaginaEfetivo !== "logo";

  const cardsHtml = (itensGrupo) =>
    itensGrupo
      .map((item) => {
        const capa = item.fotos && item.fotos[0];
        const extras = (item.fotos || []).slice(1);
        // ✅ 30/08/2026, achado do Márcio: mesmo posY (0-100, "center Y%")
        // ajustado no CapaEditorModal.tsx não estava chegando no PDF — a
        // capa sempre saía com o enquadramento padrão do CSS, ignorando o
        // que foi arrastado na tela. Mesmo padrão/fallback (20%) do admin.
        const capaPosY = capa?.posY ?? 20;
        return `
        <div class="card">
          ${capa ? `<img class="capa" style="object-position:center ${capaPosY}%" src="${esc(capa.url)}" />` : ""}
          <div class="card-body">
            <h3>${esc(item.titulo)}</h3>
            ${item.texto ? `<p class="texto">${nl2br(item.texto)}</p>` : ""}
            ${
              extras.length
                ? `<div class="mini-grid">${extras
                    .map((f) => `<img src="${esc(f.url)}" />`)
                    .join("")}</div>`
                : ""
            }
          </div>
        </div>`;
      })
      .join("");

  const secoesHtml = grupos
    .map((g, idx) => {
      const cor = STATUS_COR[g.status] || STATUS_COR.planejado;
      return `
      <div class="secao ${idx % 2 === 1 ? "zebra" : ""}">
        <h2 style="border-left-color:${cor.border}">${esc(STATUS_LABEL[g.status] || g.status)}</h2>
        <div class="grid">${cardsHtml(g.itens)}</div>
      </div>`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(nomeArquivo)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; font-family: Arial, Helvetica, sans-serif; color:#1f2937; background:#fff; }
  .header { background:${corPrimaria}; border-bottom:8px solid ${corSecundaria}; padding:20px 32px; display:flex; align-items:center; justify-content:space-between; }
  .header .logo-wrap { background:#fff; border-radius:12px; padding:6px 14px; display:flex; align-items:center; gap:10px; }
  .header .logo-wrap img { height:40px; display:block; }
  .header .logo-wrap .nome { font-weight:bold; font-size:16px; color:${corPrimaria}; }
  .header .edicao-box { background:rgba(0,0,0,.18); border:1px solid rgba(255,255,255,.25); border-radius:10px; padding:10px 18px; text-align:right; }
  .header .edicao-box .tipo { color:${corSecundaria}; font-weight:bold; font-size:15px; }
  .header .edicao-box .versao { color:#fff; font-size:11px; opacity:.85; margin-top:2px; }
  .intro { background:linear-gradient(to right, #eff6ff, #ffffff); padding:18px 32px; font-size:13px; color:#374151; }
  .secao { padding:18px 32px; border-top:1px solid #e2e8f0; }
  .secao.zebra { background:#f8fafc; }
  .secao h2 { font-size:18px; font-weight:bold; text-transform:uppercase; letter-spacing:.05em; border-left-width:4px; border-left-style:solid; padding-left:10px; margin:0 0 14px; color:${corPrimaria}; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .card { background:#fff; border-radius:12px; box-shadow:0 2px 6px rgba(0,0,0,.08); border:1px solid #f1f5f9; overflow:hidden; }
  .card .capa { width:100%; height:170px; object-fit:cover; display:block; }
  .card-body { padding:12px 14px; }
  .card-body h3 { margin:0 0 6px; font-size:15px; font-weight:bold; color:${corPrimaria}; }
  .card-body .texto { margin:0; font-size:12px; color:#4b5563; white-space:pre-wrap; }
  .mini-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:4px; margin-top:8px; }
  .mini-grid img { width:100%; height:56px; object-fit:cover; border-radius:6px; }
  .footer { background:${corPrimaria}; border-top:8px solid ${corSecundaria}; padding:16px 32px; text-align:center; color:#fff; font-size:12px; }
  .footer .linha1 { font-weight:bold; margin-bottom:2px; }
</style>
</head>
<body>
  <div class="header">
    <div class="logo-wrap">
      ${exibirLogo ? `<img src="${esc(condominio.logo_url)}" />` : ""}
      ${exibirNomeCondominio ? `<span class="nome">${esc(condominio.nome)}</span>` : ""}
    </div>
    <div class="edicao-box">
      <div class="tipo">Informativo ${tipoLabel}</div>
      <div class="versao">Edição v${String(edicao.versao || 1).padStart(3, "0")} — ${formatarDataExtenso(edicao.data_referencia)}</div>
    </div>
  </div>

  ${edicao.introducao ? `<div class="intro">${nl2br(edicao.introducao)}</div>` : ""}

  ${secoesHtml}

  <div class="footer">
    <div class="linha1">Administração ${esc(condominio.nome)}</div>
    <div>${esc(condominio.gestao || "")}</div>
    <div>${esc(condominio.slogan1 || "")} ${condominio.slogan2 ? " · " + esc(condominio.slogan2) : ""}</div>
  </div>
</body>
</html>`;
}

module.exports = { montarHtml, nomeArquivoPdf };
