import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

export async function POST(req: Request) {
  try {
    // 1. Proteção da Rota Interna
    const secret = req.headers.get("x-internal-secret");
    if (secret !== process.env.INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await req.json();
    const { clientName, serverUsername, serverName, planLabel, amount, currency, mpPaymentId, reason } = data;

    // 2. Formatadores Visuais
    const formattedMoney = new Intl.NumberFormat("pt-BR", { 
      style: "currency", 
      currency: currency || "BRL" 
    }).format(amount);
    
    // 3. URLs Importantes e Engenharia de Roteamento para o Kiwi Browser
    // Puxa dinamicamente a URL base de produção para servir as mídias e links locais
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.UNIGESTOR_APP_URL || "https://unigestor.net.br";
    const auditUrl = `${baseUrl}/admin/auditoria`;
    
    // ✅ O Segredo do Kiwi: Um link composto via Android Intent que intercepta o SO
    // e força a abertura direta dentro do ecossistema do Kiwi Browser (package: com.kiwibrowser.browser)
    const kiwiIntentUrl = `intent://unigestor.net.br/admin/auditoria#Intent;scheme=https;package=com.kiwibrowser.browser;end;`;

    // 4. Montar Estrutura Dinâmica do E-mail (HTML)
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
        <div style="background-color: #10b981; color: white; padding: 20px; text-align: center;">
          <h2 style="margin: 0; font-size: 20px; letter-spacing: -0.5px;">⚠️ Ação Manual Requerida ⚠️</h2>
          <p style="margin: 5px 0 0; font-size: 14px; opacity: 0.9;">Um pagamento foi aprovado, mas a renovação precisa de suporte manual.</p>
        </div>
        
        <div style="padding: 20px;">
          <p style="margin-top: 0;">Olá!</p>
          <p>O cliente <strong>${clientName}</strong> (${serverUsername}) efetuou um pagamento via Portal, mas a automação não pôde concluir a recarga automática no servidor.</p>
          
          <div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0; border-radius: 4px; font-size: 14px;">
            <strong style="color: #b45309;">Motivo / Erro:</strong> ${reason}
          </div>

          <h3 style="border-bottom: 1px solid #eee; padding-bottom: 8px; font-size: 15px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 25px;">Detalhes da Assinatura</h3>
          <ul style="list-style: none; padding: 0; margin: 0; font-size: 14px;">
            <li style="margin-bottom: 10px; flex items-center;"><span style="margin-right: 8px;">👤</span> <strong>Login:</strong> <span style="font-family: monospace; background-color: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${serverUsername}</span></li>
            <li style="margin-bottom: 10px;"><span style="margin-right: 8px;">🖥️</span> <strong>Servidor:</strong> ${serverName}</li>
            <li style="margin-bottom: 10px;"><span style="margin-right: 8px;">📦  </span> <strong>Plano:</strong> ${planLabel}</li>
            <li style="margin-bottom: 10px;"><span style="margin-right: 8px;">💰</span> <strong>Valor Pago:</strong> <strong style="color: #10b981;">${formattedMoney}</strong></li>
            <li style="margin-bottom: 10px;"><span style="margin-right: 8px;">🧾</span> <strong>Ref. Pagamento:</strong> <span style="font-family: monospace; color: #64748b;">${mpPaymentId || "Não identificada"}</span></li>
          </ul>

          <div style="text-align: center; margin-top: 35px; margin-bottom: 15px; border-top: 1px solid #f1f5f9; pt-25px;">
            <p style="font-size: 13px; color: #64748b; margin-bottom: 15px; font-weight: bold;">Escolha onde deseja processar a Auditoria:</p>
            
            <a href="${auditUrl}" style="background-color: #10b981; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; display: inline-block; width: 80%; max-width: 250px; margin-bottom: 12px; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.2); font-size: 14px; text-align: center;">
              💻 Abrir no Computador
            </a>
            
            <br />
            
            <a href="${kiwiIntentUrl}" style="background-color: #1e293b; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 13px; width: 80%; max-width: 250px; box-shadow: 0 4px 6px -1px rgba(30, 41, 59, 0.2); text-align: center;">
              🥝 Abrir no Kiwi (Telemóvel)
            </a>
          </div>
        </div>
        
        {/* ✅ Rodapé escuro integrado com a logo-full-light da pasta public */}
        <div style="background-color: #0f141a; text-align: center; padding: 25px 15px; font-size: 11px; color: #94a3b8; border-top: 1px solid #1e293b;">
          <img src="${baseUrl}/brand/logo-full-light.png" alt="UniGestor" style="max-height: 42px; margin-bottom: 12px; display: block; margin-left: auto; margin-right: auto; border: none; outline: none;" />
          Este é um e-mail automático emitido pelo core do sistema UniGestor.<br/>
          Por favor, não responda diretamente a esta mensagem.
        </div>
      </div>
    `;

    // 5. Instanciar Transmissor SMTP (Gmail Oficial)
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      }
    });

    // 6. Despachar Mensagem para Destinos Configurados
    await transporter.sendMail({
      from: `"UniGestor" <${process.env.EMAIL_USER}>`,
      to: ["insqueixa@gmail.com", "marcio.martins@gmx.com"],
      subject: `🚨 Ação Requerida: Renovação manual pendente no servidor`,
      html: emailHtml,
    });

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("❌ [API_EMAIL] Falha crítica no disparo de e-mail:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}