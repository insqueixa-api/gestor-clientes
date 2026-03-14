import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = ["Nome do Modelo", "Conteúdo da Mensagem"];

  const example = [
    "Aviso de Vencimento 3 Dias",
    "Olá {primeiro_nome}, sua fatura vence em {dias_para_vencimento}. Link: {link_pagamento}",
  ];

  const generalNotes = [
    "⚠️ INSTRUÇÕES GERAIS ⚠️",
    "• Nome do Modelo: Obrigatório. Identifica a mensagem no sistema.",
    "• Conteúdo da Mensagem: Obrigatório. O texto que será enviado ao cliente.",
    "• Atualização: Se você importar um modelo com um nome que já existe no seu painel, ele será ATUALIZADO com o novo texto.",
    "• Exclua as linhas de exemplo e estas instruções antes de importar."
  ];

  // Adiciona a "colinha" com todas as variáveis para ajudar o usuário!
  const varsHeader = ["📌 VARIÁVEIS DISPONÍVEIS", "O QUE ELA FAZ"];
  const varsData = [
    ["{saudacao_tempo}", "Bom dia / Boa tarde / Boa noite"],
    ["{dias_desde_cadastro}", "Dias como cliente (Ex: 45 dias)"],
    ["{dias_para_vencimento}", "Dias restantes (Ex: 5 dias)"],
    ["{dias_atraso}", "Dias de atraso (Ex: 2 dias)"],
    ["{hoje_data}", "Data atual (DD/MM/AAAA)"],
    ["{hoje_dia_semana}", "Ex: Sexta-feira"],
    ["{hora_agora}", "Hora do envio (HH:MM)"],
    ["{saudacao}", "Sr., Sra."],
    ["{primeiro_nome}", "Primeiro nome (Ex: João)"],
    ["{nome_completo}", "Nome completo"],
    ["{whatsapp}", "Celular do cliente"],
    ["{observacoes}", "Notas internas do cliente"],
    ["{data_cadastro}", "Data registro (DD/MM/AAAA)"],
    ["{usuario_app}", "Usuário do Servidor"],
    ["{senha_app}", "Senha do Servidor"],
    ["{plano_nome}", "Nome do Plano"],
    ["{telas_qtd}", "Quantidade de Telas"],
    ["{tecnologia}", "Ex: IPTV, P2P"],
    ["{servidor_nome}", "Nome do Servidor"],
    ["{data_vencimento}", "Data de vencimento (DD/MM/AAAA)"],
    ["{hora_vencimento}", "Hora do vencimento (HH:MM)"],
    ["{dia_da_semana_venc}", "Ex: Segunda-feira"],
    ["{revenda_nome}", "Nome do Revendedor responsável"],
    ["{usuario_revenda}", "Usuário da Revenda no Painel"],
    ["{revenda_site}", "Link do Painel Web"],
    ["{venda_creditos}", "Qtd. de Créditos da Última Recarga"],
    ["{link_pagamento}", "Link Área do Cliente / Fatura"],
    ["{pin_cliente}", "PIN da Área do Cliente (4 dígitos)"],
    ["{valor_fatura}", "Valor da renovação (Ex: R$ 40,00)"],
    ["{pix_manual_cnpj}", "Chave PIX (CNPJ)"],
    ["{pix_manual_cpf}", "Chave PIX (CPF)"],
    ["{pix_manual_aleatoria}", "Chave PIX (Aleatória)"],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet([
    headers,
    example,
    [],
    ...generalNotes.map((n) => [n]),
    [],
    varsHeader,
    ...varsData,
  ]);

  worksheet["!cols"] = [
    { wch: 35 }, // Nome do Modelo (ou Variável)
    { wch: 80 }, // Conteúdo (ou Descrição da Variável)
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Template");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="template_mensagens.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}