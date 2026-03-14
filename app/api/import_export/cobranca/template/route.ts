import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = [
    "Nome da Cobrança",
    "Mensagem",             // ✅ ADICIONADO
    "Tipo",
    "Modo",
    "Horário (Auto)",       // ✅ Horário está aqui!
    "Dias da Semana (Auto)",// ✅ Dias da semana
    "Status Alvo",
    "Servidores Alvo",
    "Planos Alvo",
    "Apps Alvo",
    "Campo Base",
    "Dias de Diferença",
    "Sessão WhatsApp",
    "Delay Mínimo",
    "Delay Máximo"
  ];

  const examples = [
    [
      "Aviso de Vencimento 3 Dias", 
      "Pagamento Realizado",        // ✅ Nome exato do template
      "Vencimento",                 
      "Automático",                 
      "10:00",                      
      "Seg, Ter, Qua, Qui, Sex, Sab, Dom", 
      "Ativo, Vencido",             
      "",                           
      "",                           
      "",                           
      "Vencimento",                 
      "-3",                         
      "default",                    
      "15",                         
      "60"                          
    ],
    [
      "Boas Vindas Imediata",
      "",                           // ✅ Vazio de propósito no exemplo
      "Boas Vindas",
      "Manual",                     
      "",
      "",
      "Ativo",
      "Servidor Principal",         
      "Mensal, Anual",              
      "DuplexPlay",                 
      "Cadastro",
      "0",                          
      "default",
      "5",
      "20"
    ]
  ];

  const notes = [
    "⚠️ INSTRUÇÕES PARA IMPORTAÇÃO DE AUTOMAÇÕES ⚠️",
    "• Nome da Cobrança: Obrigatório.",
    "• Mensagem: Digite o nome EXATO do modelo de mensagem cadastrado no painel. (Ex: Aviso 3 Dias).",
    "• Tipo: Vencimento, Pós-Venda, Manutenção, Divulgação, Boas Vindas, Outros.",
    "• Modo: Automático ou Manual.",
    "• Dias da Semana: Separe por vírgulas (Ex: Seg, Ter, Qua, Qui, Sex, Sab, Dom).",
    "• Status Alvo: Ativo, Vencido, Teste, Arquivado (Deixe vazio para TODOS).",
    "• Servidores, Planos, Apps: Digite os nomes exatos separados por vírgula (Deixe vazio para TODOS).",
    "• Campo Base: Vencimento ou Cadastro.",
    "• Dias de Diferença: Use números negativos para ANTES (Ex: -3), 0 para NO DIA, e positivos para DEPOIS (Ex: 5).",
    "• Delay: Tempo em segundos entre as mensagens para evitar bloqueios.",
    "🔒 ATENÇÃO 1: Se a coluna MENSAGEM estiver vazia (ou o nome estiver incorreto), a automação não enviará nada. Você precisará editá-la no painel depois para vincular uma mensagem.",
    "🔒 ATENÇÃO 2: Todas as automações serão importadas como DESATIVADAS por segurança. Ative-as no painel após revisar."
  ];

  const worksheet = XLSX.utils.aoa_to_sheet([
    headers,
    ...examples,
    [], // linha em branco separadora
    ...notes.map((n) => [n]),
  ]);

  // Largura das colunas para melhor leitura
  worksheet["!cols"] = [
    { wch: 30 }, // Nome
    { wch: 25 }, // Mensagem
    { wch: 15 }, // Tipo
    { wch: 15 }, // Modo
    { wch: 15 }, // Horário
    { wch: 35 }, // Dias da Semana
    { wch: 25 }, // Status
    { wch: 25 }, // Servidores
    { wch: 25 }, // Planos
    { wch: 25 }, // Apps
    { wch: 15 }, // Campo Base
    { wch: 20 }, // Dias Diff
    { wch: 18 }, // Sessão
    { wch: 15 }, // Delay Min
    { wch: 15 }, // Delay Max
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Template");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="template_automacoes.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}