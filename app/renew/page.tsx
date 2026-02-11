import { redirect } from "next/navigation";

export default function RenewIndex() {
  // Se alguém tentar acessar /renew sem o número do whats, joga pra Home
  redirect("/");
}