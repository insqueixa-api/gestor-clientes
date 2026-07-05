import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { notify } from "@/lib/notifications/notify";

export async function POST(req: Request) {
  try {
    // 1. Proteção da Rota Interna
    const secret = req.headers.get("x-internal-secret");
    if (secret !== process.env.INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await req.json();
    const { serverId, serverName, credits, tenantId, reason } = data;

    // ✅ NOVO: notificação no sino (tabela notifications) — não bloqueia o envio do e-mail
    if (tenantId && serverId) {
      await notify({
        tenantId,
        type: "saldo_baixo",
        title: "🪫 Saldo Baixo",
        message: `O servidor "${serverName || "Desconhecido"}" está com apenas ${credits} créditos. Recarregue imediatamente para evitar interrupções!`,
        link: "/admin/gerenciador/servidor",
        sourceId: serverId,
      });
    } else {
      console.error("[NOTIFY] low-credits: tenantId ou serverId ausente, notificação do sino pulada");
    }

    // 2. URLs Importantes
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.UNIGESTOR_APP_URL || "https://unigestor.net.br";
    const serverManagerUrl = `${baseUrl}/admin/gerenciador/servidor`;
    
    // ✅ Engenharia de Redirecionamento para o Kiwi (Manteve-se o seu padrão)
    const kiwiRedirectUrl = `${baseUrl}/redirect-kiwi?url=${encodeURIComponent(serverManagerUrl)}`;

    // 3. Cor dinâmica dependendo do nível de urgência
    // Se for 0 ou menor, é gravíssimo (vermelho escuro). Se for até 10, é vermelho normal/laranja
    const isCritical = credits <= 0;
    const headerColor = isCritical ? "#991b1b" : "#ef4444"; // red-800 ou red-500
    const alertTitle = isCritical ? "🚫 SERVIDOR SEM SALDO 🚫" : "🪫 ALERTA DE SALDO BAIXO 🪫";
    const alertSubtitle = isCritical 
      ? "O servidor não tem saldo para processar novas vendas!" 
      : "O saldo de créditos do servidor atingiu o nível crítico.";

    // 4. Montar Estrutura Dinâmica do E-mail (HTML)
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
        <div style="background-color: ${headerColor}; color: white; padding: 20px; text-align: center;">
          <h2 style="margin: 0; font-size: 20px; letter-spacing: -0.5px;">${alertTitle}</h2>
          <p style="margin: 5px 0 0; font-size: 14px; opacity: 0.9;">${alertSubtitle}</p>
        </div>
        
        <div style="padding: 20px;">
          <p style="margin-top: 0;">Olá Administrador,</p>
          <p>O sistema detectou que o estoque de créditos do seu servidor está chegando ao fim. Para evitar que os clientes fiquem sem renovação e o faturamento seja interrompido, realize uma recarga o mais rápido possível.</p>
          
          <div style="background-color: #fef2f2; padding: 15px; border-left: 4px solid #ef4444; margin: 20px 0; border-radius: 4px; font-size: 14px;">
            <strong style="color: #991b1b;">Motivo do Alerta:</strong> ${reason || "O saldo atingiu o limite configurado."}
          </div>

          <h3 style="border-bottom: 1px solid #eee; padding-bottom: 8px; font-size: 15px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 25px;">Status do Servidor</h3>
          <ul style="list-style: none; padding: 0; margin: 0; font-size: 15px;">
            <li style="margin-bottom: 10px;"><span style="margin-right: 8px;">🖥️</span> <strong>Servidor:</strong> ${serverName || "Não identificado"}</li>
            <li style="margin-bottom: 10px;">
              <span style="margin-right: 8px;">💳</span> <strong>Saldo Atual:</strong> 
              <span style="font-size: 18px; font-weight: bold; color: ${headerColor}; padding-left: 5px;">
                ${credits} crédito(s)
              </span>
            </li>
          </ul>

          <div style="text-align: center; margin-top: 35px; margin-bottom: 15px; border-top: 1px solid #f1f5f9; padding-top: 25px;">
            <p style="font-size: 13px; color: #64748b; margin-bottom: 15px; font-weight: bold;">Recarregar agora via navegador:</p>
            
            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto; max-width: 500px;">
            <tr>
              <td align="center" width="50%" style="padding: 0 5px;">
                <a href="${serverManagerUrl}" style="background-color: #10b981; color: white; text-decoration: none; padding: 12px 10px; border-radius: 6px; font-weight: bold; display: block; font-size: 13px; text-align: center; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.2);">
                  <img src="${baseUrl}/brand/icon-chrome.png" alt="Chrome" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 7px; border: 0;">
                  <span style="vertical-align: middle;">Abrir Chrome</span>
                </a>
              </td>
              <td align="center" width="50%" style="padding: 0 5px;">
                <a href="${kiwiRedirectUrl}" style="background-color: #1c457d; color: white; text-decoration: none; padding: 12px 10px; border-radius: 6px; font-weight: bold; display: block; font-size: 13px; text-align: center; box-shadow: 0 4px 6px -1px rgba(30, 41, 59, 0.2);">
                  <img src="${baseUrl}/brand/icon-kiwi.png" alt="Kiwi" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 7px; border: 0; border-radius: 4px;">
                  <span style="vertical-align: middle;">Abrir Kiwi</span>
                </a>
              </td>
            </tr>
          </table>
          </div>
        </div>
        
        <div style="background-color: #0f141a; text-align: center; padding: 25px 15px; font-size: 11px; color: #eaeaea; border-top: 1px solid #1e293b;">
          <img src="${baseUrl}/brand/logo-gestor.png" alt="UniGestor" style="max-height: 42px; margin-bottom: 12px; display: block; margin-left: auto; margin-right: auto; border: none; outline: none;" />
          Este é um e-mail automático emitido pelo core do sistema UniGestor.<br/>
          Por favor, não responda diretamente a esta mensagem.
        </div>
      </div>
    `;

    // 5. Instanciar Transmissor SMTP
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      }
    });

    // 6. Despachar Mensagem
    await transporter.sendMail({
      from: `"UniGestor Informa" <${process.env.EMAIL_USER}>`,
      to: ["insqueixa@gmail.com", "marcio.martins@gmx.com"],
      subject: `🚨 URGENTE: Saldo Baixo (${credits} créditos) - ${serverName || 'Servidor'}`,
      html: emailHtml,
    });

    return NextResponse.json({ success: true });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}