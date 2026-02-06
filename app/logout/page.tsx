import { logoutAction } from "./actions";

export default async function LogoutPage() {
  // Executa no servidor e redireciona.
  await logoutAction();

  // Nunca renderiza, porque o redirect interrompe.
  return null;
}
