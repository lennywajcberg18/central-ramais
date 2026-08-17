# Roadmap de produto — Central de Ramais

Escrito em 17/08/2026, a partir da auditoria da branch `fix/concorrencia-na-distribuicao`.

## O que este documento é

A auditoria deste projeto passou por cinco ondas e 48 agentes. A onda 1 teve 10
auditores independentes, só de leitura, que levantaram 128 achados; a onda 1b teve 5
verificadores que reabriram cada um deles no código — 91 sobreviveram e 37 foram
descartados. A onda 2 corrigiu o que dava para corrigir (commit `d2bd846`, 58
arquivos). A onda 3 pôs 7 times adversariais mais um juiz em cima do resultado: 62
achados novos, 42 procedentes. A onda 4 corrigiu outra rodada (commit `8ea8e0f`, 23
arquivos) e deixou 21 itens registrados para depois, com justificativa.

Uma das dez frentes da onda 1 era **produto**, não defeito: 11 itens sobre o que o
sistema não faz, e não sobre o que ele faz errado. Vários achados de outras frentes
também são, no fundo, funcionalidade que falta. Este documento junta isso com o que
já está combinado com o dono e responde a uma pergunta só:

> Dado o que existe hoje, o que fazer primeiro?

**O que este documento não faz:** não propõe de novo o que já está decidido. Os oito
itens que o dono já combinou — mensagens automáticas configuráveis por tenant, limite
de atendentes de plantão por setor, identificar o contato externo, relatório de quem
atendeu e quem não atendeu, integração Twilio, integração Evolution API no projeto
Replit do Dr. Marcelo, migração para Supabase e deploy fora do Render — entram aqui
com prioridade relativa e com o custo real de cada um, não como sugestão.

**O que foi verificado:** cada afirmação de código neste documento foi conferida no
repositório, com arquivo e linha. Nenhum comando `git`, nenhuma migration, nenhum
`build` e nada tocado em produção. Onde eu não consegui confirmar, está escrito.

---

## Como a prioridade foi decidida

Quatro critérios, nesta ordem. Um item só sobe de faixa se passa por um critério mais
alto que o do item acima.

1. **Alguém de fora sai machucado hoje?** Um familiar de paciente que escreve às 3h e
   nunca recebe resposta é dano real, num hospital, com nome na porta. Isso vem antes
   de tudo.
2. **Existe prazo que não depende de nós?** O Postgres gratuito do Render expira em
   13/09/2026. Prazo externo não negocia.
3. **O item multiplica os outros?** Avisar quem está de plantão que chegou mensagem
   melhora tempo de resposta, SLA, satisfação e abandono de uma vez só. Vale mais que
   um item que melhora uma coisa só.
4. **Custa pouco e já está pago?** Dado que já está no banco e ninguém mostra é o
   melhor negócio que existe — vale mais que funcionalidade nova de mesmo valor.

O que **não** é critério: estar bonito, estar na moda, ser interessante de programar.

E um aviso de honestidade: se tudo fosse prioridade alta, este documento não serviria
para nada. São 19 itens; **2** estão na faixa mais alta.

---

## O quadro geral

| # | Item | Faixa | Classificação | Esforço |
|---|---|---|---|---|
| 1 | Fila sem atendente: dar saída para quem espera | P0 | MVP | 1 a 2 dias |
| 2 | Onde o banco vai viver depois de 13/09 (Supabase) | P0 | MVP | 1 a 2 dias |
| 3 | Provedor de WhatsApp de verdade (Twilio) | P1 | MVP | 1 dia nosso + aprovação externa |
| 4 | Avisar quem está de plantão que chegou mensagem | P1 | quick win | 2 a 3 horas |
| 5 | Hospedagem que não hiberna (inclui "sair do Render") | P1 | MVP | meio dia + decisão de custo |
| 6 | `holder_note` na tela de quem atende | P1 | quick win | 1 a 2 horas |
| 7 | Trancar o simulador | P1 | quick win | 2 a 4 horas |
| 8 | Alerta de link nominal usado por outro número | P2 | MVP | 2h a 1 dia, por degrau |
| 9 | A nota depois do MENU → SIM | P2 | MVP | meio dia |
| 10 | Métricas por setor e tempo até alguém assumir | P2 | MVP | meio dia |
| 11 | Relatório de quem atendeu e quem não atendeu | P2 | próxima versão | 2 a 3 dias |
| 12 | Mensagens automáticas configuráveis por tenant | P2 | próxima versão | 2 dias |
| 13 | Editar um link já emitido | P2 | próxima versão | meio dia |
| 14 | Comentários do CSAT numa tela só | P2 | próxima versão | 3 a 4 horas |
| 15 | Limite de atendentes de plantão por setor | P2 | próxima versão | 1 a 2 dias + regra a definir |
| 16 | Nome do contato externo | P3 | próxima versão | 1 dia + decisão de produto |
| 17 | Aplicativo de loja (PWA → push → App Store) | P3 | futuro | semanas |
| 18 | Receber áudio e foto de verdade | P3 | futuro | 1 semana + LGPD |
| 19 | Evolution API no projeto Replit do Dr. Marcelo | P3 | futuro | não estimável daqui |

Esforço é estimativa de quem escreveu, em dias de trabalho de uma pessoa. Onde a
auditoria já tinha estimado, usei a estimativa dela.

---

# P0 — antes de qualquer pessoa de verdade usar

## 1. Fila sem atendente: dar saída para quem espera

**O problema.** Quando ninguém do setor está de plantão, a conversa fica no estado
`open` e morre ali. Verifiquei os três pontos:

- `apps/api/src/services/conversation.service.ts:84` e `:153` chamam `tryAssign` e
  jogam fora o resultado. A pessoa recebe *"Você será atendido por Enfermagem.
  Aguarde um momento."* e, se não havia ninguém, nunca mais nada.
- `apps/api/src/services/webhook.service.ts:204` trata `open` com um `return` mudo:
  quem digita MENU na fila não recebe resposta. MENU existe exatamente para a pessoa
  não ficar presa, e é o único estado em que ele não funciona.
- `apps/api/src/repositories/conversations.ts:370` varre só
  `assigned`, `awaiting_department` e `awaiting_menu_confirm`. `open` fica fora do job
  de inatividade — a conversa nunca encerra, nunca vira abandono, nunca entra no SLA.

Somando: a pessoa não é atendida, não consegue sair, não consegue abrir outra conversa
(a regra de conversa única bloqueia) e o painel do gestor não registra nada disso. O
mesmo acontece quando um plantão acaba sem sucessor: as conversas voltam para a fila e
ficam imunes ao relógio.

**Quem se beneficia.** O externo, que para de ser abandonado em silêncio. O gestor,
que passa a enxergar a fila. Quem atende, que para de herdar conversa de horas atrás
sem contexto.

**Valor:** o mais alto do documento. É a única falha auditada que produz dano
reputacional direto num hospital, e é exatamente o cenário do "um sai e o outro entra"
que dominou a reunião de 14/08.

**Como fazer, em três peças de risco crescente:**

1. Usar o `false` que o `tryAssign` já devolve para mandar a verdade em vez de
   "Aguarde um momento" — cerca de 15 linhas, risco zero.
2. Encerrar a conversa parada em `open` com `close_reason='no_agent_available'`. O
   motivo já existe no enum e hoje é gravado por um caminho completamente diferente
   (`conversation.service.ts:174`, quando o link ficou sem setor ativo). A janela
   precisa ser decidida: sugestão da auditoria é 20 minutos, menor que os 30 do
   timeout, porque quem está na fila nunca falou com ninguém.
3. Aceitar MENU em `open`, e um cartão "esperando na fila há mais de X" no painel do
   gestor. O endpoint `/admin/conversations?situacao=fila` já responde isso.

**Esforço:** peça 1, 1 a 2 horas. Peças 2 e 3, meio dia cada.
**Depende de:** nada. Tudo que a correção usa já existe.
**Risco de fazer:** incluir `open` no WHERE do job de inatividade contraria o SQL
escrito no `PROJETO.md`. Por isso a peça 2 usa janela e motivo próprios, que respeitam
a spec e usam um enum que ela mesma criou.
**Complexidade operacional:** baixa. Só a janela de tempo é decisão de produto.
**Classificação:** peça 1 é quick win; peças 2 e 3 são MVP. Não dá para pôr isso num
hospital de verdade sem elas.

## 2. Onde o banco vai viver depois de 13/09/2026

**O problema.** O `render.yaml` sobe os três serviços no plano gratuito, e o Postgres
gratuito do Render expira em **13/09/2026** — 27 dias a partir de hoje. Quando expirar,
o banco some.

**Sendo honesto sobre o tamanho disso:** hoje esse banco só tem dados de demonstração,
gerados pelo seed. Perder é perder a demonstração, não perder atendimento de paciente.
O que torna o item P0 não é o dano de hoje — é que **nenhum piloto pode começar num
banco com data de morte marcada**, e o item 3 (provedor de verdade) fica atrás deste.
Se a ordem inverter, o hospital começa a usar e o banco expira no meio.

**Quem se beneficia.** Todo mundo, indiretamente. É infraestrutura.

**Sobre o Supabase, que já é a escolha combinada:** é Postgres, então o Prisma continua
funcionando e o schema vai inteiro. Três pontos a conferir antes de virar a chave, que
eu não testei:

- O Prisma pede uma segunda URL de conexão direta para rodar migration quando a
  aplicação usa o pooler do Supabase. Confirmar na documentação vigente antes de
  apontar a `DATABASE_URL`.
- A garantia de "uma conversa aberta por contato" é um **índice parcial** que vive só
  no SQL de uma migration (`apps/api/prisma/schema.prisma:372-374` explica por quê: o
  Prisma não modela índice parcial). Restaurar o banco por dump, ou por qualquer
  caminho que não seja `prisma migrate deploy`, pode deixar o índice para trás sem
  nenhum aviso — e aí o produto volta em silêncio a abrir duas conversas por contato.
  Conferir a existência do índice depois da migração é obrigatório.
- A política de suspensão por inatividade do plano gratuito do Supabase muda com o
  tempo. Confirmar antes, senão o problema apenas troca de nome.

**Esforço:** 1 a 2 dias, a maior parte em ensaio e conferência, não em digitar.
**Depende de:** decisão do dono sobre onde e quanto pagar.
**Risco de fazer:** o `startCommand` do Render roda `prisma migrate deploy` a cada
start (`render.yaml:25-28`). Migration que falhe no banco novo trava todo start
seguinte. Ensaiar num banco descartável antes.
**Complexidade operacional:** média. Uma janela de indisponibilidade combinada, um
dump, um restore, e a conferência do índice.
**Classificação:** MVP.

---

# P1 — o que faz o piloto acontecer

## 3. Provedor de WhatsApp de verdade

**O problema.** O `render.yaml:41-42` fixa `WHATSAPP_PROVIDER=mock`. A instância
publicada não manda mensagem nenhuma: ela loga no console e devolve um id falso. É uma
demonstração convincente de um produto que ainda não fala com o mundo.

**A boa notícia** é que a maior parte do trabalho de código já está feita. O
`TwilioProvider` existe e é o único arquivo do projeto que importa o SDK
(`apps/api/src/providers/twilio.ts`); o `config.ts` recusa o boot se alguém ligar o
Twilio sem a validação de assinatura do webhook; o `render.yaml:43-61` já documenta as
três variáveis que precisam ser ligadas juntas. O que falta é de fora: conta, número
aprovado e a URL do webhook apontada para o deploy.

**Três coisas a confirmar antes de prometer data**, nenhuma delas verificável daqui:

- O **sandbox** da Twilio exige que cada pessoa mande um código de adesão antes de
  qualquer mensagem. Isso mata a regra 7 do `CLAUDE.md` (zero fricção) durante o
  piloto. Um número aprovado de verdade não tem esse problema, mas tem prazo de
  aprovação da Meta.
- A **janela de 24 horas** do WhatsApp Business: mensagem enviada muito depois da
  última mensagem da pessoa exige template aprovado. O `PROJETO.md` põe templates
  fora do escopo do MVP de propósito. As conversas aqui são curtas e as mensagens
  automáticas saem no ato, então o risco parece baixo — mas é preciso conferir, e não
  supor.
- **Custo por mensagem.** Cada aviso automático que o produto manda é dinheiro. Isso
  muda a conta do item 8 (alerta por WhatsApp) e do item 1 (avisos de fila).

**Um detalhe de arquitetura que vale registrar:** a saída de mensagem está bem isolada
atrás da interface `WhatsAppProvider`, mas a **entrada não está**. A rota
`apps/api/src/routes/webhook.ts` é 100% Twilio: caminho, formato do corpo, nomes dos
campos (`From`, `To`, `Body`, `MessageSid`, `NumMedia`) e o middleware de assinatura.
Trocar de provedor um dia custa uma rota nova e um adaptador de entrada, não uma
reescrita — mas custa mais do que trocar o valor de uma variável. E a escolha do
provedor hoje é **global**, não por hospital: `apps/api/src/providers/index.ts` lê a
variável de ambiente, e a coluna `whatsapp_numbers.provider`, que existe no banco,
nunca é lida por ninguém.

**Esforço:** 1 dia do nosso lado, mais o tempo de aprovação que não controlamos.
**Depende de:** item 2 (não ligar um piloto num banco que expira) e item 5 (não ligar
um piloto num serviço que hiberna).
**Risco de fazer:** ligar o provedor real com o simulador destrancado (item 7) faz o
sistema mandar WhatsApp de verdade para qualquer número digitado numa tela de
demonstração.
**Complexidade operacional:** média-alta, quase toda ela burocrática.
**Classificação:** MVP.

## 4. Avisar quem está de plantão que chegou mensagem

**O problema.** A lista de conversas atualiza sozinha a cada 5 segundos, mas nada mais
acontece: procurei em `apps/web/app` por `document.title`, `Notification` e
`AudioContext` e não existe nenhum dos três. Nada muda no título da aba, nada toca,
nada pisca.

A Beatriz é enfermeira de plantão, não operadora de call center. Ela está com um
paciente e o navegador atrás de outra janela. Ela descobre a mensagem quando volta ao
computador — e o indicador "Respondidos em 5 minutos" que o Dr. Marcelo vai olhar mede,
na prática, com que frequência alguém estava encarando a tela.

**Quem se beneficia.** Quem atende (para de perder mensagem), o externo (é respondido),
o gestor (o SLA passa a medir o hospital, e não a aba do navegador).

**Valor:** alto, e é o item que mais multiplica os outros. Todos os indicadores de
tempo do painel dependem dele.

**Como fazer:** front-end puro, cerca de 30 linhas. Contagem de pendentes no título da
aba; um bipe curto gerado por código, sem arquivo de áudio; e permissão de notificação
do navegador atrás de um botão opcional, com silêncio quando negada.

**Esforço:** 2 a 3 horas.
**Depende de:** nada.
**Risco de fazer:** som em ambiente hospitalar incomoda. O bipe precisa ser
desligável, e a notificação tem que ser opcional por escolha de quem usa.
**Complexidade operacional:** nenhuma.
**Classificação:** quick win. Notificação de verdade no celular com a tela apagada é o
item 17, e é outra conversa.

## 5. Hospedagem que não hiberna

**O problema.** Os três serviços do `render.yaml` estão no plano gratuito, que hiberna
depois de 15 minutos sem acesso — o próprio comentário no topo do arquivo diz isso. A
auditoria classificou como severidade alta: a primeira mensagem depois do silêncio
pode estourar o tempo de resposta que o provedor espera e se perder. Num produto em
que a mensagem chega às 3h da manhã depois de horas de silêncio, esse é o caso comum,
não o raro.

Este é o item que o dono chamou de "deploy fora do Render". São duas saídas, e a
diferença entre elas é preço e trabalho:

- **Plano pago no Render.** Zero trabalho de migração, resolve a hibernação, mantém o
  blueprint que já existe e já está testado.
- **Sair para outro lugar.** Mais controle e talvez mais barato no fim, mas é reescrever
  o deploy dos dois serviços e refazer as variáveis de ambiente.

Minha leitura: para o piloto, o plano pago é a escolha certa, porque troca dinheiro por
tempo num momento em que tempo é o recurso escasso. Sair do Render é decisão de médio
prazo, e faz mais sentido depois que o produto tiver um dono operacional definido.

**Esforço:** meio dia se for o plano pago; alguns dias se for mudança de casa.
**Depende de:** decisão de custo do dono. Conversa junto com o item 2 — a mesma
decisão, o mesmo dia.
**Risco de fazer:** nenhum no caminho do plano pago.
**Complexidade operacional:** baixa.
**Classificação:** MVP.

## 6. `holder_note` na tela de quem atende

**O problema.** Quando o admin emite um link, ele preenche um campo livre chamado
`holder_note` com exatamente o que faria falta depois: "CRM 12345", "filha do paciente
do leito 4B". Procurei esse campo em todo o código: ele aparece na criação do link, na
API de admin e na tela `/admin/links` — **e em nenhum lugar do aplicativo de quem
atende**. Às 3h da manhã a enfermeira vê "Médico Externo" e não faz ideia de com quem
está falando, então gasta as duas primeiras mensagens perguntando quem é a pessoa.

**Por que isto importa mais do que parece:** o `TASKS.md:289` registra "nome e celular
de quem é de fora no primeiro acesso" no backlog da reunião, marcado como bloqueado por
contradizer a regra 7 (zero fricção). O impasse existe porque ninguém percebeu que
metade do valor já está no banco, digitada pelo hospital, sem custar uma pergunta a
ninguém. Fazer este item antes de discutir o item 16 pode esvaziar o item 16.

**Como fazer:** incluir `holderNote` no que o repositório de conversas já traz do link,
devolver no payload do agente, mostrar como segunda linha do cabeçalho do chat. Usar o
valor **atual** do link, não um snapshot: diferente do rótulo, isto é anotação
operacional viva. O rótulo tem snapshot para proteger o histórico do relatório, não o
contexto de quem atende agora.

**Esforço:** 1 a 2 horas.
**Depende de:** nada.
**Risco de fazer:** privacidade. "Filha do paciente 4B" liga uma pessoa a uma
internação. Mostrar para quem atende aquela conversa é legítimo e é o propósito do
campo; mostrar para o hospital inteiro não seria. Hoje só quem tem a conversa a
enxerga, então o comportamento já está certo — mas isso precisa continuar verdadeiro
quando o item 11 (relatórios) for feito.
**Complexidade operacional:** nenhuma.
**Classificação:** quick win.

## 7. Trancar o simulador

**O problema.** O `apps/api/src/app.ts` monta o router do simulador sempre, sem
nenhuma condição de ambiente. O simulador injeta mensagens pelo mesmo caminho do
webhook — decisão consciente e boa, porque garante que a demonstração é fiel. O efeito
colateral é que tudo que a demonstração produz é real: contatos, conversas, mensagens e
tentativas de acesso entram nas mesmas tabelas que o painel soma. A demonstração de
sexta-feira vira volume, CSAT e tentativas negadas no relatório do mês, e nada marca a
origem para separar depois.

Com o provedor real ligado (item 3), fica pior: um número digitado na tela de
demonstração recebe WhatsApp de verdade do hospital.

**Como fazer, do mais barato ao mais completo:** uma variável de ambiente que monte o
router só quando ligada; ou marcar a origem (`origin`) em conversas e tentativas e
excluir a origem simulada das métricas; ou, no mínimo, forçar o provedor falso para
tudo que venha do simulador.

**Esforço:** 2 a 4 horas para a trava por ambiente. Um dia para a marcação de origem.
**Depende de:** nada, mas precisa estar pronto **antes** do item 3.
**Risco de fazer:** desligar o simulador na instância de demonstração tira uma das
melhores ferramentas de venda do produto. Por isso a trava é uma variável de ambiente,
e não uma remoção.
**Complexidade operacional:** baixa.
**Classificação:** quick win.

---

# P2 — o que faz o painel valer a abertura

## 8. Alerta de link nominal usado por outro número

**O problema.** O `PROJETO.md` diz que as tentativas de acesso negadas são "a métrica
que mais importa para segurança", e a tabela de decisão manda "registra
`access_attempt`, **alerta o admin**". O registro acontece. O alerta não existe: existe
um cartão vermelho numa tela que só aparece se alguém abrir o navegador e escolher o
período certo. Num hospital, ninguém abre.

E quando abre, a tela `/admin/acessos` é somente leitura — conferi: ela tem filtros por
motivo, atalhos de período e um botão de recarregar, e nenhuma ação. O admin vê o mesmo
número tentando doze vezes e não consegue bloqueá-lo nem emitir um link para ele dali.
Pior: o número nem está em `/admin/contatos`, porque quem foi recusado nunca virou
contato.

**Três degraus, escolher pelo apetite:**

1. Contador de recusas não vistas no menu do admin, alimentado pelas últimas 24 horas,
   com destaque para `nominal_taken` (2 a 3 horas).
2. Ações na própria linha: "emitir link para este número" e "registrar como bloqueado"
   (meio dia).
3. Alerta de verdade, mandado pelo canal que o produto já tem — WhatsApp — para um
   número de admin configurado por hospital (um dia).

**Depende de:** o degrau 3 precisa de uma coluna nova em `tenants` e do item 3 (custo
por mensagem passa a existir).
**Risco de fazer:** o degrau 3 introduz mensagem saindo sem conversa. Precisa de
agrupamento por janela — no máximo um alerta por link por hora — senão um link vazado
que é tentado cem vezes vira cem mensagens pagas.
**Complexidade operacional:** baixa nos degraus 1 e 2; média no 3.
**Classificação:** degrau 1 é quick win, degrau 2 é MVP, degrau 3 é próxima versão.

## 9. A nota depois do MENU → SIM

**O problema.** Quando a pessoa digita MENU e confirma SIM, o sistema encerra a
conversa, pergunta a nota e — no mesmo instante — cria a conversa nova e manda o menu
(`lifecycle.service.ts:215-224`). Chegam duas mensagens coladas no celular dela. Se
responder "9" achando que está dando a nota, o webhook procura primeiro a conversa
ativa (`webhook.service.ts:131`) e só depois a que espera nota (`:143`) — o "9" é lido
como escolha de setor inválida. A nota nunca é gravada, e a conversa antiga fica
esperando uma nota que não pode chegar.

A onda 4 já corrigiu o defeito vizinho (a conversa fantasma quando o encerramento perde
a corrida) e ajustou o critério de quando perguntar. O que sobrou é a decisão de
produto que a auditoria não podia tomar sozinha.

**Duas saídas, escolher uma:** não pedir nota no `user_switched` (quem troca de setor
não está saindo, está continuando) — ou adiar o menu, mantendo a pergunta de nota e
deixando a próxima mensagem abrir a conversa nova, ao custo de uma ida e volta a mais.

**Esforço:** meio dia em qualquer das duas.
**Depende de:** decisão do dono.
**Risco de fazer:** qualquer das duas muda o denominador de "quantos avaliaram" no
painel. O número exibido vai mudar de um dia para o outro, e o Dr. Marcelo precisa ser
avisado — senão a correção parece piora.
**Classificação:** MVP.

## 10. Métricas por setor e tempo até alguém assumir

**O problema.** O painel responde "quanto" e nunca "onde dói". Conferi o
`metrics.service.ts:61-67`: o recorte por setor acumula **volume e nada mais**. Tempo
de primeira resposta, SLA, duração e satisfação existem só como número único do
hospital inteiro. A pergunta seguinte de qualquer gestor — "qual setor está
demorando?" — não tem resposta na tela.

E tem um caso pior, quase cômico: o `assignAvgMinutes` (quanto a pessoa esperou até
cair com alguém) é calculado na API, viaja pela rede, está declarado na interface do
dashboard em `apps/web/app/admin/dashboard/page.tsx:22` — e não é desenhado em cartão
nenhum. O número é produzido e descartado a cada requisição. É justamente o indicador
que mede a escala de plantão, que é a decisão que este produto deveria embasar.

**Como fazer:** tudo sai da consulta que já roda. Enriquecer o recorte por setor com
tempo de resposta, SLA, satisfação e abandono é um segundo agrupamento sobre os mesmos
dados, sem consulta nova. O cartão do tempo até assumir é literalmente colocar na tela
um número que já chega nela.

**Esforço:** meio dia.
**Depende de:** nada.
**Risco de fazer:** nenhum relevante. O custo da consulta não muda.
**Complexidade operacional:** nenhuma.
**Classificação:** o cartão é quick win; o recorte por setor é MVP.

## 11. Relatório de quem atendeu e quem não atendeu

Este é um dos itens já combinados, e é o mais barato dos quatro do backlog da
reunião — mas não é de graça, e o motivo importa.

**O que já existe:** `assigned_at`, `first_assigned_at`, `first_reply_at`, `closed_at`
e `assigned_user_id` estão gravados e corretos. As sessões de plantão sabem quem estava
disponível. "Quem atendeu" é agregação sobre dado existente.

**O que não existe:** "quem **não** atendeu" precisa de dado que hoje é apagado.
Conferi o `releaseFromUser` em `conversations.ts:102-111`: quando um plantão acaba ou
um atendente é remanejado, o `assigned_user_id` volta a nulo. Não há tabela de
histórico de atribuição no schema. Depois que a conversa troca de mãos, ninguém sabe
que ela passou pela primeira pessoa. Fazer este relatório direito exige uma tabela nova
que registre cada oferta e cada devolução.

**Valor:** alto para o gestor — é o item que responde "a escala noturna está
funcionando?".

**Quem se beneficia.** O gestor. Quem atende, não necessariamente: é preciso decidir,
com o Dr. Marcelo, se "quem não atendeu" é métrica de gestão ou de constrangimento.
Num hospital, essa diferença é política, e a decisão precisa vir antes do código.

**Esforço:** 2 a 3 dias, sendo a maior parte a tabela nova e a migration.
**Depende de:** decisão do dono sobre o uso do número.
**Risco de fazer:** um relatório que expõe pessoas por nome muda o comportamento de
quem é medido. Vale começar por setor e por turno, e só depois por pessoa, se ainda
fizer sentido.
**Complexidade operacional:** média.
**Classificação:** próxima versão.

## 12. Mensagens automáticas configuráveis por tenant

**O problema.** Todos os textos automáticos do produto vivem em
`apps/api/src/services/texts.ts` — 42 linhas, um conjunto só, igual para todos os
hospitais. "Não identificamos seu acesso", "Você será atendido por X", a pergunta de
nota, o aviso de anexo. Um hospital que queira dizer as coisas do seu jeito hoje
precisa de um deploy.

**Por que este item ganha prioridade no meio do roadmap, e não no fim:** as correções
do item 1 e do item 7 acrescentam textos novos. É mais barato eles nascerem
configuráveis do que hard-coded para depois migrar. Se este item ficar para depois de
tudo, a migração fica mais cara do que se ele viesse agora.

Ao mesmo tempo, é o item mais fácil de superdimensionar. Sugestão de recorte mínimo:
uma tabela de textos por hospital com fallback para o texto padrão, editável no painel,
sem editor rico, sem versionamento, sem pré-visualização. Se dois hospitais nunca
divergirem, o item nem se paga.

**Esforço:** 2 dias no recorte mínimo.
**Depende de:** ter mais de um hospital de verdade, ou uma exigência concreta de um.
**Risco de fazer:** texto editável por usuário é texto que pode ser apagado, ficar
vazio ou perder um marcador de substituição. Precisa de validação e de fallback.
**Complexidade operacional:** média — vira uma tela de configuração a mais para o
admin manter.
**Classificação:** próxima versão.

## 13. Editar um link já emitido

**O problema.** O `PROJETO.md` lista `GET/POST/PATCH /admin/entry-links`. Conferi as
rotas: existem GET, POST, `POST /:id/revoke`, `GET /:id/qrcode` e `GET /:id/contacts`.
**PATCH não existe.**

Consequência concreta: o hospital emitiu "Médico Externo" com Cardiologia, Enfermagem e
Recepção, imprimiu o QR e distribuiu para dezenas de médicos. Agora quer acrescentar a
Fisioterapia, ou o rótulo saiu com erro de digitação. A única saída é revogar e emitir
outro — todo QR impresso morre, e cada contato já vinculado perde o acesso e precisa ser
reatribuído um a um. Isso contradiz exatamente a promessa que o `PROJETO.md` faz sobre o
redirect no domínio próprio: "permite trocar o número, revogar o acesso ou medir uso sem
reemitir nada para quem já recebeu o link".

**Como fazer:** rota com `label`, `holderNote` e a lista de setores, reusando a
resolução de setores que já existe. `slug`, `entry_code` e o tipo (perfil/nominal)
ficam imutáveis — mudar qualquer um quebraria QR impresso e vínculo já criado.

**Esforço:** meio dia com a tela.
**Depende de:** nada.
**Risco de fazer:** tirar um setor da lista tem efeito imediato no menu de quem já está
vinculado. É o comportamento certo, mas o formulário precisa avisar quantos contatos
são afetados — o endpoint que conta isso já existe.
**Classificação:** próxima versão. Sobe de prioridade na hora em que o primeiro link
for impresso em papel de verdade.

## 14. Comentários do CSAT numa tela só

**O problema.** O produto captura texto livre depois da nota e guarda em
`feedback.comment`. É a única coisa no sistema inteiro em que alguém de fora diz, com
palavras, o que achou. Para ler, o gestor precisa abrir conversa por conversa e torcer
para acertar as que têm comentário — não há filtro, não há lista, não há nada no
painel. Na prática esse dado nunca vai ser lido, e uma nota 2 com o comentário "liguei
três vezes e ninguém atendeu" morre no banco.

**Como fazer:** um bloco no painel com os últimos comentários do período, cada um com a
nota, o setor e o rótulo do link. Os dados já saem da mesma consulta das métricas.
Segundo passo barato: destacar as notas baixas e ordenar por nota crescente, para o
gestor ler primeiro o que dói.

**Esforço:** 3 a 4 horas.
**Depende de:** nada.
**Valor:** baixo hoje, pela base pequena; alto quando o volume crescer. E é o tipo de
tela que vende o produto numa demonstração.
**Classificação:** próxima versão, ou MVP se sair junto do item 10 — mesmo arquivo,
mesma consulta.

## 15. Limite de atendentes de plantão por setor

Item já combinado, vindo direto da reunião: "no CT são três; chegou o quarto, um tem
que sair".

**O que já existe:** as sessões de plantão sabem quem está de plantão agora e a que
setores a pessoa pertence — o endpoint `/admin/shift-sessions` já devolve isso. Contar
quantos estão de plantão num setor é uma consulta.

**O que falta é a regra, não o código.** Três perguntas que precisam de resposta antes
de qualquer linha:

1. Quem sai quando o quarto entra? O mais antigo, o que tem menos conversas abertas, ou
   o admin escolhe?
2. O quarto que tentou entrar fica em que estado — recusado, em espera, ou entra e
   derruba alguém?
3. O que acontece com as conversas de quem sai? O caminho de devolver para a fila já
   existe, mas "fui expulso do plantão porque chegou outra pessoa" é uma experiência
   muito diferente de "encerrei meu plantão".

**Esforço:** 1 a 2 dias depois de a regra estar decidida.
**Depende de:** conversa com o Dr. Marcelo. Este item é 80% decisão e 20% código.
**Risco de fazer:** implementar a regra errada aqui derruba gente do sistema no meio de
um atendimento. É o item deste roadmap com maior chance de causar dano se for feito
sem alinhar antes.
**Complexidade operacional:** média-alta.
**Classificação:** próxima versão.

---

# P3 — próxima versão e futuro

## 16. Nome do contato externo

Item já combinado, e o mais delicado dos oito, porque contradiz uma regra escrita:
`external_contacts` não tem coluna de nome (conferi em `schema.prisma:297-313`), e a
regra 7 do `CLAUDE.md` diz "zero fricção para o externo: sem cadastro, nome, e-mail ou
confirmação".

**Recomendação:** fazer o item 6 primeiro e reavaliar. Boa parte do valor de "saber com
quem estou falando" aparece sem custar uma pergunta a ninguém, porque o hospital já
digitou a informação ao emitir o link.

Se ainda for necessário depois disso, as duas formas menos danosas são: perguntar o
nome **depois** do primeiro atendimento, nunca antes; ou deixar quem atende registrar o
nome no contato, o que é fricção zero para quem está de fora e resolve o caso real
("quem é esse número que já falou comigo três vezes?").

**Esforço:** 1 dia de código, depois da decisão.
**Depende de:** item 6 e decisão explícita do dono de flexibilizar a regra 7.
**Classificação:** próxima versão.

## 17. Aplicativo de loja

A UI é mobile-first porque o plano é o app virar aplicativo de App Store. Registrando o
ponto de partida real, que eu conferi: **não existe** pasta `public` em `apps/web`, nem
manifesto, nem service worker. O único ícone é um SVG embutido no layout. Não há nada
instalável hoje, e não há notificação com a tela apagada — que é o motivo pelo qual um
aplicativo de verdade importa neste produto, e não um detalhe de embalagem.

**Caminho sugerido, do barato ao caro:**

1. Manifesto e ícones — torna instalável na tela inicial do celular. Horas de trabalho.
2. Service worker com notificação push — é aqui que mora o valor. Resolve o item 4
   para o celular no bolso de quem está de plantão. Dias de trabalho, mais uma decisão
   de infraestrutura de push.
3. Empacotar para as lojas — semanas, e envolve conta de desenvolvedor, revisão da
   Apple, e a discussão de o que acontece com o token guardado no navegador.

**Depende de:** o produto estar em uso de verdade. Loja antes de piloto é ordem errada.
**Risco de fazer:** notificação push num app de hospital que toca no meio da noite para
a pessoa errada é pior que não ter notificação. A configuração de silêncio precisa
existir desde a primeira versão.
**Classificação:** o passo 1 é próxima versão; os passos 2 e 3 são futuro.

## 18. Receber áudio e foto de verdade

A onda 2 já resolveu a parte mais grave e mais barata: anexo sem legenda deixou de
virar bolha vazia (persiste com um marcador legível), a pessoa recebe um aviso de que o
canal só lê texto, e mídia não gasta mais tentativa do menu — ou seja, mandar três
áudios não joga mais ninguém num setor sorteado.

**O que falta é receber de verdade:** baixar o arquivo do provedor, guardar, exibir para
quem atende. Mandar foto de exame é o comportamento mais natural do mundo nesse
contexto, então o valor é alto — mas imagem de exame é **dado de saúde**, e isso puxa
decisões que não são de engenharia: onde guardar, por quanto tempo, quem pode ver,
como apagar. A auditoria também registrou que o produto hoje não tem retenção, exclusão
nem exportação de dado pessoal de espécie alguma.

**Esforço:** uma semana de código, mais o tempo da decisão jurídica.
**Depende de:** item 3 (sem provedor real não há mídia real) e de uma posição sobre
LGPD.
**Classificação:** futuro.

## 19. Evolution API no projeto Replit do Dr. Marcelo

Item já combinado, e o único deste roadmap sobre o qual **eu não verifiquei nada** — o
projeto está fora deste repositório e eu não o abri. O que posso dizer é o que custa do
nosso lado:

- **Sair mensagem:** barato. A interface `WhatsAppProvider` tem um método só
  (`sendText`), e um `EvolutionProvider` ao lado do `TwilioProvider` resolve.
- **Entrar mensagem:** não é barato. A rota de webhook é Twilio da primeira à última
  linha — caminho, formato do corpo, nomes dos campos e validação de assinatura. Um
  provedor novo precisa de rota nova e de um adaptador que traduza o formato dele para
  o `InboundMessage` que o resto do sistema entende.
- **Dois provedores ao mesmo tempo:** não é possível hoje. A escolha é uma variável de
  ambiente global. A coluna `whatsapp_numbers.provider` existe no banco e nunca é lida
  — ligá-la é o caminho para um hospital usar Twilio e outro usar Evolution.

Também vale registrar a diferença de natureza: a Twilio é um provedor oficial com
contrato; a Evolution API é uma ponte não oficial para o WhatsApp. As duas funcionam,
mas o risco de bloqueio de número e a posição diante do hospital não são os mesmos, e
isso é decisão do dono, não recomendação técnica.

**Esforço:** não estimável daqui.
**Depende de:** ver o projeto do Replit e saber o que ele já faz.
**Classificação:** futuro.

---

## O que ficou de fora de propósito

Coisas boas que a auditoria levantou e que eu **não** coloquei no roadmap, para o
documento continuar servindo:

| Item | Por que não agora |
|---|---|
| Reatribuir contato e a conversa em curso | A onda 4 já fechou o caso: conversa viva fora do escopo do link novo é encerrada. Não sobrou item de produto |
| Coluna "esperando há" e ordenação por espera no painel do gestor | Vale pouco sozinho; entra de carona na peça 3 do item 1 |
| Os 21 itens adiados das ondas 3 e 4 | São dívida técnica, não produto. Vivem no relatório da auditoria, não aqui |
| Ramal-pessoa, contexto de origem (quarto/leito), caso de uso hotel | O `PROJETO.md` já os coloca na V2. Continuam na V2 — nada nesta auditoria mudou a prioridade deles |
| Mensagem de voz e ligação | Backlog da reunião. O degrau zero (saber que a mídia existiu) já foi feito na onda 2; o resto depende do item 18 |

---

## Os próximos 30 dias

Hoje é 17/08/2026. O Postgres gratuito do Render expira em **13/09/2026** — 27 dias.
Isso não permite fazer tudo. Permite fazer o seguinte, nesta ordem:

**Semana 1 (18 a 24/08) — o que dá para fazer sem decisão de ninguém**

- Peça 1 do item 1: parar de dizer "Aguarde um momento" para quem não tem quem atenda.
  Uma tarde de trabalho, risco zero, e é a diferença entre silêncio e honestidade.
- Item 6: `holder_note` na tela de quem atende. Uma tarde.
- Item 4: título da aba, bipe e notificação opcional. Uma tarde.
- Em paralelo, a conversa com o dono sobre o item 2 e o item 5 — as duas são a mesma
  decisão de custo e precisam sair juntas.

**Semana 2 (25 a 31/08) — o banco**

- Subir o banco novo, restaurar um dump de ensaio, conferir que o índice parcial
  sobreviveu, e só então virar a chave. Se algo der errado, sobram duas semanas de
  folga antes do prazo — que é exatamente o motivo de fazer isso agora e não no dia 10.
- Peças 2 e 3 do item 1: encerrar a fila órfã com motivo próprio e aceitar MENU em
  `open`.

**Semana 3 (01 a 07/09) — preparar o piloto**

- Item 5: hospedagem que não hiberna.
- Item 7: trancar o simulador. **Antes** de ligar o provedor real, não depois.
- Item 3: começar a burocracia da Twilio, que é a parte que não depende de nós e por
  isso precisa começar cedo.

**Semana 4 (08 a 13/09) — folga**

- Deixada de propósito para o que atrasar. Se nada atrasar: degrau 1 do item 8
  (contador de recusas) e o cartão do item 10, que são horas de trabalho e melhoram o
  que o Dr. Marcelo vê quando abre o painel.

**Se só uma coisa for feita nestes 30 dias**, que seja tirar o banco do plano que
expira. Não porque seja o item mais valioso — não é, o item 1 é —, mas porque é o único
com data marcada por outra pessoa.

**Se duas coisas forem feitas**, a segunda é o item 1. Um familiar de paciente
esperando resposta às 3h da manhã é a única coisa neste documento que machuca alguém de
verdade.

---

## Limites desta leitura

Para ser útil, um roadmap precisa dizer onde não enxerga.

- **Não conversei com nenhum usuário.** Tudo aqui vem de código, do `PROJETO.md`, do
  `TASKS.md` e do que a auditoria registrou. A ordem entre os itens P2 pode mudar
  inteira depois de uma conversa de vinte minutos com quem vai atender de verdade.
- **Os esforços são estimativas**, não compromissos. Onde a auditoria já tinha estimado,
  usei o número dela; o resto é leitura minha do tamanho da mudança.
- **Não testei nada em produção**, não rodei migration, não rodei `build` e não abri o
  navegador. As afirmações sobre a instância publicada vêm do `render.yaml` e do
  código, não da instância viva.
- **Não verifiquei nada sobre o projeto Replit do Dr. Marcelo** nem sobre a Evolution
  API. O item 19 fala do custo do nosso lado e só.
- **Não confirmei três coisas externas** que mudam o item 2 e o item 3: a exigência de
  URL direta do Prisma com o pooler do Supabase, a política atual de suspensão do plano
  gratuito do Supabase, e o comportamento do sandbox da Twilio quanto ao código de
  adesão. As três estão marcadas no texto como "confirmar".
- **Este documento não diz que o sistema está seguro nem que está pronto.** Ele diz o
  que foi verificado, o que sobrou, e em que ordem eu atacaria o que sobrou.
