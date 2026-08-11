# Documentação de telas — Gestor de Clientes

Um arquivo por tela do Admin e do Portal do Cliente: o que cada uma faz, de onde vêm os dados (tabelas/views/RPCs do Supabase), quais rotas de API chama, quais integrações externas usa, e os achados (bugs corrigidos e pontos que ficaram para confirmação) de uma auditoria ponta-a-ponta feita em 11/08/2026.

## Admin

- [Dashboard](dashboard.md) — `/admin`
- [Agenda](agenda.md) — `/admin/agenda`
- [Auditoria](auditoria.md) — `/admin/auditoria`
- [Clientes](clientes.md) — `/admin/cliente` e `/admin/cliente/[id]`
- [Testes](teste.md) — `/admin/teste`
- [Revendedor](revendedor.md) — `/admin/revendedor` e `/admin/revendedor/[id]`
- [Gerenciador de Aplicativo](gerenciador-aplicativo.md)
- [Gerenciador de Cobrança](gerenciador-cobranca.md)
- [Gerenciador de Guia TV](gerenciador-guia-tv.md)
- [Gerenciador de Mensagem](gerenciador-mensagem.md)
- [Gerenciador de Pagamento](gerenciador-pagamento.md)
- [Gerenciador de Plano](gerenciador-plano.md)
- [Gerenciador de Servidor](gerenciador-servidor.md)
- [Settings: API/Server](settings-api-server.md)
- [Settings: Cupons](settings-cupons.md)
- [Settings: Financeiro Pessoal](settings-financeiro-pessoal.md)
- [Settings: Profile](settings-profile.md)
- [Settings: WhatsApp](settings-whatsapp.md)

## Portal do Cliente

- [Portal principal (Renew)](portal-renew.md) — `/renew`
- [Detalhe de app](portal-apps-detalhe.md) — `/renew/apps/[id]`
- [Guia de TV](portal-guia-tv.md) — `/renew/guia-tv`

## Autenticação

- [Login, Logout, Reset Password, Redirect Kiwi](autenticacao.md) — `/login`, `/logout`, `/reset-password`, `/redirect-kiwi`
