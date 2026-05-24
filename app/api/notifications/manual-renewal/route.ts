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
    const formattedMoney = new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(amount);
    
    // 3. Montar E-mail (HTML)
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #10b981; color: white; padding: 20px; text-align: center;">
          <h2 style="margin: 0;">Ação Manual Requerida ⚠️</h2>
          <p style="margin: 5px 0 0; font-size: 14px;">Um pagamento foi aprovado, mas a renovação precisa de suporte manual.</p>
        </div>
        
        <div style="padding: 20px;">
          <p>Olá!</p>
          <p>O cliente <strong>${clientName}</strong> efetuou um pagamento via Portal, mas a automação não pôde concluir a recarga automática no servidor.</p>
          
          <div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0;">
            <strong>Motivo / Erro:</strong> ${reason}
          </div>

          <h3 style="border-bottom: 1px solid #eee; padding-bottom: 5px;">Detalhes da Assinatura</h3>
          <ul style="list-style: none; padding: 0; margin: 0;">
            <li style="margin-bottom: 8px;">👤 <strong>Login:</strong> ${serverUsername}</li>
            <li style="margin-bottom: 8px;">🖥️ <strong>Servidor:</strong> ${serverName}</li>
            <li style="margin-bottom: 8px;">📦 <strong>Plano:</strong> ${planLabel}</li>
            <li style="margin-bottom: 8px;">💰 <strong>Valor Pago:</strong> ${formattedMoney}</li>
            <li style="margin-bottom: 8px;">🧾 <strong>Ref. Pagamento:</strong> ${mpPaymentId || "Não identificada"}</li>
          </ul>

          <div style="text-align: center; margin-top: 30px;">
            <a href="https://unigestor.net.br/admin/auditoria" style="background-color: #10b981; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; display: inline-block;">Acessar Painel de Auditoria</a>
          </div>
        </div>
        
        <div style="background-color: #f1f5f9; text-align: center; padding: 15px; font-size: 12px; color: #64748b;">
          Este é um e-mail automático do sistema UniGestor.
        </div>
      </div>
    `;

    // 4. Configurar a conexão com o seu Gmail
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      }
    });

    // 5. Disparar o email
    await transporter.sendMail({
      from: `"UniGestor Alertas" <${process.env.EMAIL_USER}>`,
      to: ["insqueixa@gmail.com", "marcio.martins@gmx.com"], // Seus dois e-mails
      subject: `🚨 Ação Requerida: Renovação manual pendente para ${clientName}`,
      html: emailHtml,
    });

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("Erro na API de Email:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}