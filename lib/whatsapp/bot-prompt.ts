// lib/whatsapp/bot-prompt.ts

export const BASE_DE_CONHECIMENTO_FIXA = `
### [Cliente IPTV] Pagamento Realizado
✅ *{saudacao_tempo}* {nome_completo}, tudo bem?

Sua assinatura está renovada!

👤 *Usuário:* {usuario_app}
📅 *Vencimento:* {data_vencimento} {hora_vencimento}hs
🖥️ *Servidor:* {servidor_nome}

Para maior facilidade, renove sempre direto pelo seu painel:

🌐 *Portal:* {link_pagamento}
🔑 *Senha:* (_últimos 4 dígitos do WhatsApp_)

Bom entretenimento!
Um abraço,
Márcio

### [Cliente IPTV] Recarga Revenda
{saudacao_tempo}, {revenda_nome}, tudo bem?

*Pagamento confirmado com sucesso!* 🚀

Seus *{venda_creditos}* créditos foram adicionados com sucesso!

🖥️ *Servidor:* {servidor_nome}
👤 *Usuário:* {usuario_revenda}

Obrigado pela parceria.
Um abraço,
Márcio

### [Cliente IPTV] Explicação IPTV
📺 IPTV na prática, sem complicação

Vou te explicar de forma simples: nosso serviço é a evolução da TV. Todo o entretenimento chega pela internet, sem cabos ou antenas, direto na sua Smart TV, celular, TV Box ou computador.

👉 Em vez de pagar várias assinaturas separadas, você acessa tudo em um único aplicativo.

💎 *O que você terá acesso:*
🔹 Canais ao vivo (abertos e fechados, esportes, filmes, Premiere, Combate, notícias, 🔞, entre outros)
🔹 Milhares de filmes e séries das maiores plataformas de streaming (Netflix, Prime Video, Disney+, Globoplay, entre outras)
🔹 Qualidade HD e 4K
🔹 Sem fidelidade, sem multa e instalação 100% remota

🆓 *Teste grátis antes de contratar:*
Você pode testar o serviço por algumas horas sem compromisso, com todo o conteúdo liberado.
🔞 Se não quiser canais adultos no teste, é só avisar antes de gerar o acesso.

📲 *Como funciona para assistir?*
Você utiliza um aplicativo reprodutor (player).
Cada TV tem sua própria loja de aplicativos.
👉 Em TVs Android, normalmente o app é gratuito.
👉 Em outras marcas, pode ser pago, geralmente cerca de R$ 30 por ano, pago direto ao desenvolvedor do aplicativo (não é pra gente, mas posso intermediar sem problemas).

💰 *Planos disponíveis:*
🔹 *NaTV* — R$ 40/mês (aplicativo não incluso)
🔹 *Fast* — R$ 45/mês (conteúdo nacional e internacional + aplicativo parceiro em alguns modelos de TV)
🔹 *Elite* — R$ 50/mês (tecnologia mais avançada + conteúdo nacional e internacional + aplicativo exclusivo gratuito)

_Se quiser, já posso gerar seu teste gratuito agora._

👉 Qual é a marca da sua TV?

### [Cliente IPTV] Teste - Boas-vindas
⏳ *{saudacao_tempo}* {nome_completo}, tudo bem?

Seu teste gratuito está ativo e você já pode explorar todo o conteúdo até às *{hora_vencimento}hs*. ⏳

👤 Usuário: {usuario_app}
🔑 Senha: {senha_app}
🖥️ Servidor: {servidor_nome}

Se gostar da experiência e quiser efetivar a assinatura, deixei tudo pronto no seu painel para concluir sua renovação!

🌐 *Portal:* {link_pagamento}
🔑 *Senha:* (_últimos 4 dígitos do WhatsApp_)

Aproveite sua programação e, se precisar de qualquer ajuda, estou à disposição!
Um abraço,
Márcio

### [Fidelidade] Pesquisa de satisfação
🌟 *{saudacao_tempo}* {nome_completo}, tudo bem?

Aqui é o Márcio. Estou passando para saber como tem sido sua experiência com nosso serviço nos últimos meses.

Sua opinião é fundamental para que eu possa continuar melhorando! Tem algo que você acha que poderia ser melhor, ou está tudo rodando perfeitamente por aí?

Qualquer feedback será muito bem-vindo. 😊
Um abraço!

### [Fidelidade] Pos venda 7 dias
Oi {nome_completo}, tudo bem? 😊

Aqui é o Márcio! Estou passando só para conferir como foi sua primeira semana com nosso serviço.
Conseguiu acessar tudo certinho? A qualidade está legal?

Qualquer dúvida ou ajuste que precisar no aplicativo, é só me chamar.
Um abraço!

### [Fidelidade] Fidelidade 5 anos
🏆 *{saudacao_tempo}* {nome_completo}, tudo bem?

Hoje o nosso sistema nos avisou de um marco incrível: estamos completando 5 anos de parceria! 🎉

Cinco anos é muito tempo, e ter você conosco por todo esse período nos enche de orgulho. Quero agradecer imensamente pela lealdade e confiança. Clientes como você são a base de tudo o que construímos.

Espero que possamos continuar levando entretenimento e qualidade para a sua casa por muitos anos ainda! 📺✨

Sigo sempre à disposição.
Um grande abraço,
Márcio

### [Fidelidade] Fidelidade 1 ano
🤝 *{saudacao_tempo}* {nome_completo}, tudo bem?

Hoje é um dia muito especial para nós: estamos comemorando um pouco mais de 1 ano desde que você iniciou sua jornada com a gente! 🥳

Queria passar pessoalmente para te agradecer pela confiança e pela parceria durante todos esses meses. Ter você como cliente por um ano inteiro é o que nos motiva a manter sempre a melhor qualidade e o melhor atendimento.

Espero que esse tenha sido um ano de muito entretenimento e bons momentos em frente à TV. Que venham muitos outros anos pela frente! 🎬✨

Como sempre, sigo à disposição para o que você precisar.

Um grande abraço e muito obrigado,
Márcio

### [Fidelidade] Fidelidade 3 anos
🥇 *{saudacao_tempo}* {nome_completo}, tudo bem?

Estou passando hoje para celebrar algo muito legal: acabamos de ultrapassar a marca de 3 anos da sua assinatura com a gente! 🚀

É uma alegria enorme saber que estamos presentes no entretenimento da sua casa há tanto tempo. Agradeço de verdade por continuar escolhendo o nosso serviço e pela confiança no nosso trabalho.

Que a nossa parceria continue rendendo ótimas maratonas de séries e filmes! 🍿📺

Qualquer coisa que precisar, você já sabe, é só chamar.
Um grande abraço,
Márcio

### [Manutenção] Reset Modem + TV
🔌 *Instruções de Reset (Modem e TV)*

Para estabilizar sua conexão, peço que faça o seguinte procedimento (é rápido e costuma resolver 90% dos casos de lentidão):

1️⃣ Tire da tomada o seu modem de internet e a sua TV (ou TV Box).
2️⃣ Aguarde *pelo menos 1 minuto* com os dois aparelhos fora da tomada.
3️⃣ Ligue o modem primeiro e espere as luzes estabilizarem (voltar a internet).
4️⃣ Depois, ligue a TV, abra o aplicativo e teste novamente.

Me avise se o problema continuar após o reset! 👍

### [Manutenção] Ajuste de DNS
🌐 *Ajuste de DNS na TV*

Muitas vezes, a sua provedora de internet cria um "caminho longo" até o nosso servidor, o que causa travamentos. Trocar o DNS ajuda a encontrar a rota mais rápida.

Siga estes passos na sua Smart TV (Samsung ou LG):
1️⃣ Vá em *Configurações* (engrenagem) > *Rede* > *Status da Rede*.
2️⃣ Clique em *Configuração de IP* ou *Configurações Avançadas*.
3️⃣ Desça até *Config. DNS* e mude de Automático para *Manual* ou *Digitar*.
4️⃣ Apague os números que estão lá e digite: *1.1.1.1* ou *8.8.8.8*.
5️⃣ Salve, reinicie a TV e teste novamente.

Me avise se melhorar!

### [Manutenção] Fast.com
🚀 *Teste de Conexão*

Para eu entender como está chegando o sinal de internet no seu aparelho, faça um teste rápido por favor:

1️⃣ Na sua TV ou celular conectado no mesmo Wi-Fi, abra o navegador de internet.
2️⃣ Digite e acesse o site: *fast.com*
3️⃣ Aguarde o teste terminar e me mande uma foto da tela com o resultado.

Isso nos ajuda a descartar problemas na rede! 👍

### [Manutenção] Problemas Cloudflare
⚠️ *Aviso Importante: Instabilidade Geral*

Identificamos que o serviço que gerencia a rota da internet até o nosso servidor (Cloudflare) está passando por uma instabilidade global neste momento. 

Isso está causando dificuldade para abrir os aplicativos (tela preta, erro de conexão, ou "loading" infinito) para muitos usuários de diversas operadoras.

A equipe técnica deles já está ciente e trabalhando na solução. A previsão é que tudo normalize em breve. Peço um pouco de paciência e, assim que estabilizar, eu aviso por aqui! 🙏

### [Manutenção] Problema resolvido
✅ *Tudo normalizado!*

O sistema já foi estabilizado e o sinal está funcionando perfeitamente de novo. 🚀

Por favor, feche totalmente o seu aplicativo e abra novamente para testar. Se ainda assim tiver alguma dificuldade, me avise!

Obrigado pela paciência. 🙏

### [Manutenção] Falha no Datacenter
⚠️ *Aviso de Manutenção*

O datacenter onde nosso servidor está alocado está passando por uma instabilidade técnica momentânea. A equipe de engenharia responsável já isolou o problema e está trabalhando para restaurar o serviço o mais rápido possível.

Pedimos desculpas pelo transtorno e agradecemos a sua paciência. Assim que o sinal for restabelecido, avisaremos imediatamente! 🙏

### [Vencimentos] Vence em 2 dias
⏳ *{saudacao_tempo}* {nome_completo}, tudo bem?

Passando para lembrar que sua assinatura vence em *2 dias* ({data_vencimento}).

Você já pode deixar tudo garantido de forma rápida e automática direto pelo seu portal! Sem precisar de intervenção manual:

🌐 *Acesse:* {link_pagamento}
🔑 *Senha:* (_últimos 4 dígitos do WhatsApp_)

Qualquer dúvida, estou à disposição.
Um abraço!

### [Vencimentos] Vence Hoje
⚠️ *{saudacao_tempo}* {nome_completo}, tudo bem?

Sua assinatura de TV vence *HOJE* ({data_vencimento})!

Para não ficar sem o seu acesso, você pode realizar a renovação automática agora mesmo, direto no seu portal:

🌐 *Acesse:* {link_pagamento}
🔑 *Senha:* (_últimos 4 dígitos do WhatsApp_)

Renovando por lá, não precisa mandar comprovante, o sistema já libera seu acesso na hora. ✅

Qualquer dificuldade, me avise.
Um abraço!

### [Vencimentos] Vencido há 7 dias
⚠️ *{saudacao_tempo}* {nome_completo}, tudo bem?

Sua assinatura encontra-se suspensa há *7 dias*. Sinto falta de ter você por aqui!

Ainda dá tempo de reativar o seu plano antigo. Basta acessar o seu portal e realizar o pagamento, que o sistema libera o acesso na mesma hora:

🌐 *Acesse:* {link_pagamento}
🔑 *Senha:* (_últimos 4 dígitos do WhatsApp_)

Caso tenha ocorrido algum imprevisto, ou não deseje mais o serviço, me avise, por favor.
Um abraço!

### [Vencimentos] Vencido há 15 dias
⚠️ *{saudacao_tempo}* {nome_completo}, tudo bem?

Estou vendo aqui que sua assinatura está pausada há 15 dias.

Sua conta e histórico continuam salvos no nosso sistema. Se desejar voltar a usar, basta regularizar pelo seu portal de acesso rápido:

🌐 *Acesse:* {link_pagamento}
🔑 *Senha:* (_últimos 4 dígitos do WhatsApp_)

Se precisar de ajuda ou de um novo teste para relembrar a qualidade, é só me chamar!
Um abraço.

### [Vencimentos] Vencido há 30 dias
⚠️ *Aviso de Exclusão de Conta*

*{saudacao_tempo}* {nome_completo}, tudo bem?

Já faz 30 dias que a sua assinatura está inativa. Como não tivemos mais contato, estarei excluindo o seu usuário do servidor hoje para liberar espaço.

Se quiser evitar a exclusão e voltar a assistir hoje mesmo, você ainda pode renovar acessando o seu portal:

🌐 *Acesse:* {link_pagamento}
🔑 *Senha:* (_últimos 4 dígitos do WhatsApp_)

Se realmente não quiser mais, não precisa fazer nada. Agradeço muito pelo tempo que esteve com a gente! 🙏

### [Vencimentos] Vencido 3 dias
⚠️ *{saudacao_tempo}* {nome_completo}, tudo bem?

Aviso rápido: sua assinatura venceu há *3 dias* e seu acesso já está pausado.

Para voltar a assistir agora mesmo, basta realizar o pagamento pelo seu portal (a liberação é automática):

🌐 *Acesse:* {link_pagamento}
🔑 *Senha:* (_últimos 4 dígitos do WhatsApp_)

Se precisar de alguma ajuda, só me avisar!
`;