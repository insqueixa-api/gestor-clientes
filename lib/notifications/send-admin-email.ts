// lib/notifications/send-admin-email.ts
// ✅ 29/08/2026: helper genérico pra e-mail avulso ao admin — antes disso,
// cada notificação por e-mail (transferência, renovação manual pendente,
// app renewal, saldo baixo) reimplementava o mesmo nodemailer/gmail do
// zero. Novos casos (ex: WhatsApp desconectado) usam este; os antigos não
// foram migrados de propósito (risco > ganho mexer no que já funciona sem
// necessidade).
import nodemailer from "nodemailer";

const ADMIN_EMAILS = ["insqueixa@gmail.com", "marcio.martins@gmx.com"];

export async function sendAdminEmail(subject: string, html: string): Promise<void> {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });

  await transporter.sendMail({
    from: `"UniGestor Informa" <${process.env.EMAIL_USER}>`,
    to: ADMIN_EMAILS,
    subject,
    html,
  });
}
