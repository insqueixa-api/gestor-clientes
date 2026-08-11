# Telas: Login, Logout, Reset Password, Redirect Kiwi

Quatro telas auxiliares pequenas, agrupadas num único documento.

## Login (`/login`)

Arquivos: [app/login/page.tsx](../../app/login/page.tsx), [app/login/actions.ts](../../app/login/actions.ts)

Login do **admin** (Supabase Auth — diferente do Portal do Cliente, que usa sessão própria). Duas abas (Login / Esqueci a senha) num componente client-side; o login roda via Server Action (`signInWithPassword`), o "esqueci a senha" roda no client (`resetPasswordForEmail`). Ambos exigem Cloudflare Turnstile antes do submit. Após login, a action já resolve e cacheia o contexto admin (tenant/role) num cookie antes do `redirect("/admin")`.

**Achado (não alterado):** a verificação server-side do Turnstile (`login/actions.ts`) é pulada por completo se `TURNSTILE_SECRET_KEY` não estiver definida — fail-open silencioso. Não é uma falha ativa hoje (a env existe), mas se a variável sumir/expirar, o login passa a aceitar qualquer submit sem captcha real, sem nenhum aviso. Não alterei porque trocar isso para fail-closed tem risco de travar o próprio login do admin em caso de erro de configuração — prefiro que você decida esse trade-off.

## Logout (`/logout`)

Arquivos: [app/logout/page.tsx](../../app/logout/page.tsx), `actions.ts`

Limpa `sessionStorage`/`localStorage` no navegador, roda a Server Action `signOut({ scope: 'local' })`, limpa o cookie de contexto admin, redireciona para `/login`. Fluxo simples e correto no essencial.

**Achado de baixo risco:** uma linha remove uma chave `localStorage` do formato legado do supabase-js v1 (`"supabase.auth.token"`) — o client atual guarda sessão em cookies, não nessa chave, então é provavelmente um no-op inofensivo (código morto). Não alterado.

## Reset Password (`/reset-password`) — CORRIGIDO

Arquivo: [app/reset-password/page.tsx](../../app/reset-password/page.tsx)

**[CORRIGIDO] "Esqueci a senha" (do admin — o cliente final do portal não tem senha, autentica só por sessão de WhatsApp) provavelmente estava quebrado de ponta a ponta em produção.** A causa era uma incompatibilidade de fluxo entre quem pede o reset e quem consome o link:

- O pedido (`login/page.tsx`) usa `supabaseBrowser` (`lib/supabase/browser.ts`, baseado em `@supabase/ssr`), cujo client é fixado em `flowType: "pkce"` — o link de recuperação gerado aponta para `/reset-password?code=...`.
- A página que consumia esse link (`reset-password/page.tsx`) criava um client **diferente e próprio**, usando `@supabase/supabase-js` puro sem especificar `flowType` — que por padrão é `"implicit"`, e espera o token no formato `/reset-password#access_token=...`.
- Ao abrir um link `?code=...` com um client em modo implícito, a biblioteca detectava a inconsistência e não criava a sessão — o erro era engolido internamente, e a página só mostrava "Link Inválido — Este link de recuperação expirou ou já foi utilizado", mesmo para um link recém-clicado.

**Correção aplicada:** trocado o client próprio pelo mesmo `supabaseBrowser` já usado em `login/page.tsx` para pedir o reset. Como `createBrowserClient` (`@supabase/ssr`) já vem com `flowType: "pkce"` e `detectSessionInUrl: true` por padrão, a troca do `?code=` pela sessão passa a acontecer automaticamente na inicialização do client — não foi necessário chamar `exchangeCodeForSession` manualmente (confirmado lendo a lógica interna de `_getSessionFromURL` em `node_modules/@supabase/auth-js`). De quebra, também troquei os 2 redirects hardcoded (`https://unigestor.net.br/login`) por `${window.location.origin}/login`, que funcionam em qualquer ambiente (produção, preview, localhost).

**Ainda não testado com um e-mail de recuperação real** — a correção segue exatamente o mesmo mecanismo já usado (e funcionando) no resto do sistema, mas peço para você confirmar pedindo um reset de verdade assim que possível.

## Redirect Kiwi (`/redirect-kiwi`)

Arquivo: [app/redirect-kiwi/page.tsx](../../app/redirect-kiwi/page.tsx)

Não é parte do fluxo de autenticação — é um utilitário de deep link Android: recebe `?url=`, monta um `intent://` pra abrir aquele endereço direto no app Kiwi Browser, com fallback textual após 2s. Usado por 4 templates de e-mail de notificação ao admin (transferência bancária, renovação manual, saldo baixo de servidor, renovação de app), sempre apontando para páginas internas `/admin/...`.

**[CORRIGIDO] Open redirect sem validação.** O parâmetro `url` era aceito sem nenhuma checagem — qualquer valor virava o destino do intent, incluindo domínios arbitrários (`?url=https://site-qualquer.com`), o que poderia ser usado para dar aparência de legitimidade a um link de phishing usando o domínio real do sistema. Adicionada checagem de mesma origem (`window.location.origin`) antes de montar o intent — os 4 usos reais (sempre `baseUrl + /admin/...`) continuam funcionando normalmente, qualquer outro destino é ignorado.
