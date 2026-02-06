// lib/messageUtils.ts

// 1. Função de Saudação (A que você perguntou)
export function getSaudacaoBrasilia() {
  const horaStr = new Date().toLocaleTimeString("pt-BR", { 
    timeZone: "America/Sao_Paulo", 
    hour: "numeric", 
    hour12: false 
  });
  const hora = parseInt(horaStr);

  if (hora >= 4 && hora < 12) return "Bom dia";
  if (hora >= 12 && hora < 18) return "Boa tarde";
  return "Boa noite";
}

// 2. Função Principal de Substituição (Usaremos no futuro para enviar)
export function processarMensagem(template: string, dados: any) {
  let mensagem = template;

  // Substitui a tag de saudação
  if (mensagem.includes("{saudacao_tempo}")) {
    mensagem = mensagem.replace(/{saudacao_tempo}/g, getSaudacaoBrasilia());
  }

  // Substitui dados do cliente (Exemplo básico)
  if (dados.cliente) {
    mensagem = mensagem.replace(/{nome_completo}/g, dados.cliente.nome || "");
    mensagem = mensagem.replace(/{primeiro_nome}/g, dados.cliente.nome.split(" ")[0] || "");
    // ... aqui adicionaremos as outras tags (vencimento, servidor, etc)
  }

  return mensagem;
}