// app/api/notifications/app-renewal/route.ts
//
// Email de "Renovação de Aplicativo pendente" — mesmo padrão visual do
// e-mail de renovação manual de assinatura IPTV (manual-renewal/route.ts),
// mas pra pagamento avulso de licença de app (payment_type='app_renewal').
// Antes só existia notificação no sino (markAppRenewalPaid em
// lib/client-portal/fulfillment.ts) — sem email, ficava fácil passar batido
// se ninguém abrisse o admin. Pedido do Márcio, 06/08/2026.
import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { isInternalRequest } from "@/lib/internal-auth";

export async function POST(req: Request) {
  try {
    if (!isInternalRequest(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await req.json();
    const {
      clientName,
      serverUsername,
      serverName,
      appName,
      amount,
      currency,
      paymentRef,
      fields,
    }: {
      clientName: string;
      serverUsername: string;
      serverName: string;
      appName: string;
      amount: number;
      currency: string;
      paymentRef: string;
      fields: { label: string; value: string }[];
    } = data;

    const formattedMoney = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency || "BRL",
    }).format(amount);

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.UNIGESTOR_APP_URL ||
      "https://unigestor.net.br";
    // Abre direto na aba "Aplicativos" da Auditoria — é lá que fica o botão
    // "Concluir" dessa renovação específica.
    const auditUrl = `${baseUrl}/admin/auditoria?view=aplicativos`;
    const kiwiRedirectUrl = `${baseUrl}/redirect-kiwi?url=${encodeURIComponent(auditUrl)}`;

    const fieldsHtml = (fields || [])
      .filter((f) => f && String(f.value || "").trim())
      .map(
        (f) =>
          `<li style="margin-bottom: 8px;"><span style="margin-right: 8px;">🔧</span> <strong>${f.label}:</strong> <span style="font-family: monospace; color: #475569;">${f.value}</span></li>`,
      )
      .join("");

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
        <div style="background-color: #a855f7; color: white; padding: 20px; text-align: center;">
          <h2 style="margin: 0; font-size: 20px; letter-spacing: -0.5px;">🟣 Renovação de Aplicativo Pendente 🟣</h2>
          <p style="margin: 5px 0 0; font-size: 14px; opacity: 0.9;">O pagamento da licença já caiu — falta renovar por fora e concluir no admin.</p>
        </div>

        <div style="padding: 20px;">
          <p style="margin-top: 0;">Olá!</p>
          <p>O cliente <strong>${clientName}</strong> (${serverUsername}${serverName ? ` - ${serverName}` : ""}) pagou a renovação da licença do aplicativo <strong>${appName}</strong> pelo Portal. A cobrança é automática, mas a renovação de verdade (junto ao parceiro) precisa ser feita manualmente.</p>

          <h3 style="border-bottom: 1px solid #eee; padding-bottom: 8px; font-size: 15px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 25px;">Cliente / Servidor</h3>
          <ul style="list-style: none; padding: 0; margin: 0; font-size: 14px;">
            <li style="margin-bottom: 8px;"><span style="margin-right: 8px;">👤</span> <strong>Login:</strong> ${serverUsername}</li>
            <li style="margin-bottom: 8px;"><span style="margin-right: 8px;">🖥️</span> <strong>Servidor:</strong> ${serverName || "—"}</li>
            <li style="margin-bottom: 8px;"><span style="margin-right: 8px;">📱</span> <strong>Aplicativo:</strong> ${appName}</li>
            <li style="margin-bottom: 8px;"><span style="margin-right: 8px;">💰</span> <strong>Valor Pago:</strong> <strong style="color: #a855f7;">${formattedMoney}</strong></li>
            <li style="margin-bottom: 8px;"><span style="margin-right: 8px;">🧾</span> <strong>Ref. Pagamento:</strong> <span style="font-family: monospace; color: #64748b;">${paymentRef || "Não identificada"}</span></li>
          </ul>

          ${
            fieldsHtml
              ? `<h3 style="border-bottom: 1px solid #eee; padding-bottom: 8px; font-size: 15px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 25px;">Dados de Configuração do App</h3>
          <ul style="list-style: none; padding: 0; margin: 0; font-size: 14px;">${fieldsHtml}</ul>`
              : `<div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0; border-radius: 4px; font-size: 13px; color: #b45309;">Sem dados de configuração salvos (app pode ter sido removido/reconfigurado depois do pagamento) — confira direto no cadastro do cliente.</div>`
          }

          <div style="text-align: center; margin-top: 35px; margin-bottom: 15px; border-top: 1px solid #f1f5f9; padding-top: 25px;">
            <p style="font-size: 13px; color: #64748b; margin-bottom: 15px; font-weight: bold;">Escolha o navegador:</p>

            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto; max-width: 500px;">
            <tr>
              <td align="center" width="50%" style="padding: 0 5px;">
                <a href="${auditUrl}" style="background-color: #a855f7; color: white; text-decoration: none; padding: 12px 10px; border-radius: 6px; font-weight: bold; display: block; font-size: 13px; text-align: center; box-shadow: 0 4px 6px -1px rgba(168, 85, 247, 0.2);">
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

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"UniGestor Informa" <${process.env.EMAIL_USER}>`,
      to: ["insqueixa@gmail.com", "marcio.martins@gmx.com"],
      subject: `🚨 Atenção: Renovação de Aplicativo pendente!`,
      html: emailHtml,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
