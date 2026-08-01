// app/api/notifications/manual-renewal/route.ts
import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { isInternalRequest } from "@/lib/internal-auth";

export async function POST(req: Request) {
  try {
    // 1. Proteção da Rota Interna
    if (!isInternalRequest(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await req.json();
    const { clientName, serverUsername, serverName, planLabel, amount, currency, mpPaymentId, reason } = data;

    // 2. Formatadores Visuais
    const formattedMoney = new Intl.NumberFormat("pt-BR", { 
      style: "currency", 
      currency: currency || "BRL" 
    }).format(amount);
    
    // 3. URLs Importantes
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.UNIGESTOR_APP_URL || "https://unigestor.net.br";
    const auditUrl = `${baseUrl}/admin/auditoria`;
    
    // ✅ Engenharia de Redirecionamento: Aponta para uma página sua, passando a URL como parâmetro
    const kiwiRedirectUrl = `${baseUrl}/redirect-kiwi?url=${encodeURIComponent(auditUrl)}`;

    // 4. Montar Estrutura Dinâmica do E-mail (HTML)
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
        <div style="background-color: #10b981; color: white; padding: 20px; text-align: center;">
          <h2 style="margin: 0; font-size: 20px; letter-spacing: -0.5px;">⚠️ Ação Manual Necessária ⚠️</h2>
          <p style="margin: 5px 0 0; font-size: 14px; opacity: 0.9;">Um pagamento foi aprovado, mas a renovação precisa de suporte manual.</p>
        </div>
        
        <div style="padding: 20px;">
          <p style="margin-top: 0;">Olá!</p>
          <p>O cliente <strong>${clientName}</strong> (${serverUsername} - ${serverName}) efetuou um pagamento via Portal, mas a automação não pôde concluir a recarga automática no servidor.</p>
          
          <div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0; border-radius: 4px; font-size: 14px;">
            <strong style="color: #b45309;">Motivo / Erro:</strong> ${reason}
          </div>

          <h3 style="border-bottom: 1px solid #eee; padding-bottom: 8px; font-size: 15px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 25px;">Detalhes da Assinatura</h3>
          <ul style="list-style: none; padding: 0; margin: 0; font-size: 14px;">
            <li style="margin-bottom: 8px;"><span style="margin-right: 8px;">👤</span> <strong>Login:</strong> ${serverUsername}</li>
            <li style="margin-bottom: 8px;"><span style="margin-right: 8px;">🖥️</span> <strong>Servidor:</strong> ${serverName}</li>
            <li style="margin-bottom: 8px;"><span style="margin-right: 8px;">📦</span> <strong>Plano:</strong> ${planLabel}</li>
            <li style="margin-bottom: 8px;"><span style="margin-right: 8px;">💰</span> <strong>Valor Pago:</strong> <strong style="color: #10b981;">${formattedMoney}</strong></li>
            <li style="margin-bottom: 8px;"><span style="margin-right: 8px;">🧾</span> <strong>Ref. Pagamento:</strong> <span style="font-family: monospace; color: #64748b;">${mpPaymentId || "Não identificada"}</span></li>
          </ul>

          <div style="text-align: center; margin-top: 35px; margin-bottom: 15px; border-top: 1px solid #f1f5f9; padding-top: 25px;">
            <p style="font-size: 13px; color: #64748b; margin-bottom: 15px; font-weight: bold;">Escolha o navegador:</p>
            
            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto; max-width: 500px;">
            <tr>
              <td align="center" width="50%" style="padding: 0 5px;">
                <a href="${auditUrl}" style="background-color: #10b981; color: white; text-decoration: none; padding: 12px 10px; border-radius: 6px; font-weight: bold; display: block; font-size: 13px; text-align: center; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.2);">
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
      subject: `🚨 Atenção: Renovação pendente!`,
      html: emailHtml,
    });

    return NextResponse.json({ success: true });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

//para disparar o email teste, desbloqueie o codigo no seguinte diretório: app/api/dev-trigger-email/route.ts
// Remova os comentários de bloqueio no início e no final "/* */" do arquivo, e então acesse a seguinte URL no navegador: https://unigestor.net.br/api/dev-trigger-email

