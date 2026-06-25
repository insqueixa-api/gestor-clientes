import nodemailer from "nodemailer";

interface TransferEmailParams {
  clientName: string;
  serverUsername: string;
  serverName: string;
  planLabel: string;
  amount: number;
  currency: string;
  mpPaymentId: string;
}

export async function sendTransferEmail(params: TransferEmailParams) {
  const { clientName, serverUsername, serverName, planLabel, amount, currency, mpPaymentId } = params;

  const formattedMoney = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency || "EUR",
  }).format(amount);

  const baseUrl = process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "https://unigestor.net.br";
  const auditUrl = `${baseUrl}/admin/auditoria`;
  const kiwiRedirectUrl = `${baseUrl}/redirect-kiwi?url=${encodeURIComponent(auditUrl)}`;

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
      <div style="background-color: #1c457d; color: white; padding: 20px; text-align: center;">
        <h2 style="margin: 0; font-size: 20px; letter-spacing: -0.5px;">🏦 Transferência Bancária Iniciada</h2>
        <p style="margin: 5px 0 0; font-size: 14px; opacity: 0.9;">Um cliente informou que vai realizar uma transferência. Aguarde o comprovante.</p>
      </div>
      
      <div style="padding: 20px;">
        <p style="margin-top: 0;">Olá!</p>
        <p>O cliente <strong>${clientName}</strong> (${serverUsername} - ${serverName}) iniciou uma renovação via transferência bancária pelo portal.</p>
        
        <div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #1c457d; margin: 20px 0; border-radius: 4px; font-size: 14px;">
          <strong style="color: #1c457d;">Ação necessária:</strong> Aguarde o comprovante e confirme o recebimento na Auditoria.
        </div>

        <h3 style="border-bottom: 1px solid #eee; padding-bottom: 8px; font-size: 15px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 25px;">Detalhes</h3>
        <ul style="list-style: none; padding: 0; margin: 0; font-size: 14px;">
          <li style="margin-bottom: 8px;"><span style="margin-right: 8px;">👤</span> <strong>Cliente:</strong> ${clientName}</li>
          <li style="margin-bottom: 8px;"><span style="margin-right: 8px;">👤</span> <strong>Login:</strong> ${serverUsername}</li>
          <li style="margin-bottom: 8px;"><span style="margin-right: 8px;">🖥️</span> <strong>Servidor:</strong> ${serverName}</li>
          <li style="margin-bottom: 8px;"><span style="margin-right: 8px;">📦</span> <strong>Plano:</strong> ${planLabel}</li>
          <li style="margin-bottom: 8px;"><span style="margin-right: 8px;">💰</span> <strong>Valor:</strong> <strong style="color: #10b981;">${formattedMoney}</strong></li>
          <li style="margin-bottom: 8px;"><span style="margin-right: 8px;">🧾</span> <strong>Ref.:</strong> <span style="font-family: monospace; color: #64748b;">${mpPaymentId}</span></li>
        </ul>

        <div style="text-align: center; margin-top: 35px; margin-bottom: 15px; border-top: 1px solid #f1f5f9; padding-top: 25px;">
          <p style="font-size: 13px; color: #64748b; margin-bottom: 15px; font-weight: bold;">Confirmar na Auditoria:</p>
          <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto; max-width: 500px;">
            <tr>
              <td align="center" width="50%" style="padding: 0 5px;">
                <a href="${auditUrl}" style="background-color: #10b981; color: white; text-decoration: none; padding: 12px 10px; border-radius: 6px; font-weight: bold; display: block; font-size: 13px; text-align: center;">
                  <span style="vertical-align: middle;">Abrir Chrome</span>
                </a>
              </td>
              <td align="center" width="50%" style="padding: 0 5px;">
                <a href="${kiwiRedirectUrl}" style="background-color: #1c457d; color: white; text-decoration: none; padding: 12px 10px; border-radius: 6px; font-weight: bold; display: block; font-size: 13px; text-align: center;">
                  <span style="vertical-align: middle;">Abrir Kiwi</span>
                </a>
              </td>
            </tr>
          </table>
        </div>
      </div>

      <div style="background-color: #0f141a; text-align: center; padding: 25px 15px; font-size: 11px; color: #eaeaea; border-top: 1px solid #1e293b;">
        <img src="${baseUrl}/brand/logo-gestor.png" alt="UniGestor" style="max-height: 42px; margin-bottom: 12px; display: block; margin-left: auto; margin-right: auto;" />
        Este é um e-mail automático emitido pelo core do sistema UniGestor.
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
    subject: `🏦 Transferência iniciada: ${clientName} — ${formattedMoney}`,
    html: emailHtml,
  });
}