# Relatório da auditoria — Central de Ramais

Branch `fix/concorrencia-na-distribuicao`, três commits à frente de `main`.
Documento escrito em 17/08/2026.

Este é o documento principal. Quem quiser só o essencial pode parar no fim da
seção 1. O que ficou por fazer está em [PENDENCIAS.md](PENDENCIAS.md).

---

## 1. Resumo executivo

O sistema é uma central de atendimento hospitalar por WhatsApp, multi-tenant.
Uma pessoa de fora recebe um link, o link diz quais setores ela pode acessar, e
o hospital atende pelo painel. Duas regras sustentam o produto: **um hospital
nunca enxerga o dado do outro**, e **o link é a credencial** — ele define, e
limita, o que a pessoa de fora alcança.

A auditoria testou essas duas regras e tudo que as cerca. O escopo foi o código
inteiro: 45 endpoints HTTP, 16 tabelas, 9 migrations, 5.657 linhas de
TypeScript na API e 9.226 no painel.

O que aconteceu, em números:

| | |
|---|---|
| Achados brutos da primeira leitura | 128 |
| Sobreviveram à verificação adversarial | 91 (37 descartados) |
| Corrigidos no primeiro mutirão | 50 |
| Achados do red team contra as próprias correções | 62 brutos, 42 procedem |
| Corrigidos no segundo mutirão | 21 |
| Ficaram para depois, com justificativa escrita | 21 |
| Agentes envolvidos | 48 |

Somando os três commits: **63 arquivos alterados, +3.398 linhas, -418**.

**O que foi encontrado que importa de verdade.** Sete problemas mereciam
correção imediata e a tiveram:

1. **O webhook do WhatsApp aceitava mensagem de qualquer origem.** A validação
   de assinatura da Twilio nascia desligada e nada no deploy a ligava. Quem
   soubesse o endereço podia escrever dentro da conversa de um paciente se
   passando por ele.
2. **Qualquer atendente agia em qualquer setor.** Cinco endpoints filtravam só
   pelo hospital. Com o identificador de uma conversa — um print, uma URL colada
   no grupo da equipe — um atendente da Recepção lia o histórico de um paciente
   da Cardiologia, respondia pelo WhatsApp do hospital e tirava a conversa da
   fila de quem devia atender.
3. **Encaminhar usava o link congelado na conversa, não o link atual da
   pessoa.** Se o administrador trocasse o acesso de alguém no meio de um
   atendimento, o botão "Encaminhar" continuava oferecendo os setores antigos —
   e mandava a pessoa para um setor que o link dela já não autorizava.
4. **O health check mentia.** Eram três linhas que respondiam 200 sem nunca
   tocar o banco. Com o Postgres fora do ar o painel do Render ficava verde,
   nada reiniciava, nada fazia rollback, e todo atendente recebia erro.
5. **O limite de tentativas de login era decorativo.** A chave usava o endereço
   IP, que atrás do proxy vem de um cabeçalho que o próprio atacante escreve.
   Bastava incrementar um número a cada tentativa para o contador nunca encher.
6. **Um deadlock no banco derrubava a troca de turno.** Duas transações
   travavam as mesmas duas tabelas em ordem invertida. 17 quedas em 30 rodadas,
   e a vítima era quase sempre o atendente entrando ou saindo do plantão.
7. **Falha interna no webhook virava um 200 mudo.** A mensagem do paciente
   sumia sem deixar rastro e a Twilio, tendo recebido 200, não reentregava.

**O que sobrou.** 21 itens adiados, nenhum de severidade alta: 4 médios, 14
baixos, 3 informativos. O maior deles é o mais desconfortável: **não existe um
único teste automatizado no repositório**. Existem dois scripts de checagem de
concorrência (10 cenários) e nada mais — sem runner, sem CI, sem linter. As
duas regras que o `CLAUDE.md` chama de inegociáveis são hoje sustentadas por
revisão humana e por convenção de código, não por teste.

Nada aqui diz que o sistema está seguro. Diz o que foi verificado, como, e o
que continua sem verificação.

---

## 2. Como a auditoria foi feita

Cinco ondas. A ideia central: **nenhum agente confirma o próprio trabalho.**
Quem acha não verifica, quem verifica não corrige, quem corrige não julga se a
correção prestou.

| Onda | O que fez | Agentes | Saída |
|---|---|---|---|
| 1 | Leitura do código, sem escrever nada. 10 frentes independentes (produto, autorização, backend, frontend, infra, testes, secrets, arquitetura, bugs, pentest) | 10 | 128 achados brutos |
| 1b | Reabriram cada achado no código para confirmar ou derrubar | 5 | 91 confirmados, 37 descartados |
| 2 | Implementação, em 11 lotes com propriedade exclusiva de arquivo | 11 | commit `d2bd846` |
| 3 | Red team adversarial contra as correções da onda 2, mais um juiz | 7 + 1 | 62 achados, 42 procedem |
| 4 | Implementação do que o juiz mandou corrigir agora, em 6 lotes | 6 | commit `8ea8e0f` |

São 48 agentes concluídos e 49 lançados — o consolidador da onda 1 falhou ao
tentar emitir os 128 achados num único JSON e estourou o limite de saída, o que
deu origem à onda 1b, que refez a consolidação em cinco blocos. A soma por onda:
11 + 6 + 11 + 8 + 6 + 7.

### Por que verificação adversarial

Um agente que lê código e é pago em achados vai achar. A onda 1b existe para
separar "isto é um defeito" de "isto me pareceu um defeito". Trinta e sete dos
128 caíram — 29%. E a onda 3 existe porque uma correção pode estar errada de
três jeitos diferentes: não fechar o problema, fechá-lo pela metade, ou abrir
um problema novo. Os três aconteceram.

### Três descartes que valeu a pena fazer

O descarte não é a auditoria falhando. É a auditoria funcionando: cada item que
cai é uma decisão que ninguém vai tomar em cima de informação falsa.

**"O segredo de assinatura de produção está publicado no repositório público."**
Foi levantado como incidente, e um agente chegou a demonstrar que forjou um
token de administrador e a API aceitou. Caiu. O `render.yaml` usa
`generateValue: true` para o `JWT_SECRET` — o Render gera o segredo e não o
versiona. O valor publicado é um marcador de exemplo, com o texto
"troque-em-producao" dentro dele. Não há nada a rotacionar, e a demonstração não
prova nada além do óbvio: quem tem a chave assina token. O defeito real, muito
menor, sobreviveu rebaixado: o arquivo de exemplo trazia uma chave que
*funcionava*, e o README mandava copiá-lo. Isso foi corrigido com um portão no
boot.

**"`GET /admin/conversations` lista sem limite."** Falso no código. O
repositório tem `take: filter.limit` e a rota valida o limite com teto de 200 e
padrão de 100. Sobreviveu só metade do achado — a falta de índice para a
ordenação —, com a severidade rebaixada por causa disso.

**"A conversa presa na fila é invisível no painel."** Parcialmente falso. A
conversa em `open` aparece na lista do atendente, no filtro "esperando
atendente" do gestor, e é puxada no login. O que era verdade — e sobreviveu — é
que a pessoa do outro lado fica sem resposta, sem timeout e sem saída pelo MENU
até alguém logar. O achado foi mantido, mas rebaixado de crítico para alto: a
mensagem não se perde, a pessoa é que espera.

Classificando os 37 descartes pelo motivo declarado: 12 eram duplicatas
fundidas (o mesmo defeito visto por até sete frentes diferentes), 9 eram fatos
que não se confirmaram no código, 13 eram severidade ou enquadramento
exagerados — reclassificados como dívida de configuração, preferência de estilo
ou decisão do dono — e 3 eram correções propostas trocadas por outras menos
arriscadas. Alguns itens caem em mais de uma categoria; contei pelo motivo
principal.

O red team perdeu 5 dos 62 pela mesma lógica. Um exemplo: alegou-se que a taxa
de resposta do CSAT podia passar de 100%. O juiz demonstrou que, para dados
criados depois da correção, é impossível por construção — o conjunto de quem
deu nota é subconjunto de quem foi perguntado. Sobreviveu apenas a outra metade
do achado (a taxa some da tela quando o gestor desliga o CSAT), que está entre
as pendências.

### O que os red teams tentaram e não conseguiram

Isto vale tanto quanto os achados, e os relatórios registram 21 tentativas
frustradas. Entre elas:

- **Isolamento entre hospitais.** 27 requisições cruzadas contra todos os
  endpoints com identificador na URL. Todas devolveram 404, nunca 403 — o que
  significa que quem não pode ver nem recebe confirmação de que o registro
  existe. Nenhum time furou.
- **Portões de boot.** Os três guardas de configuração rodam no carregamento do
  módulo, importado por todos os pontos de entrada. Não foi achado caminho para
  subir a API contornando-os.
- **Efeito externo dentro de transação.** Auditadas as 8 transações do código.
  Nenhuma envia WhatsApp de dentro de uma, que é o erro clássico que deixa
  mensagem duplicada quando a transação é refeita.
- **Trava de foco nos diálogos.** Testada no navegador com Tab e Shift+Tab. A
  trava funciona nos dois diálogos que usam o hook.
- **O índice único parcial.** Comparado caractere a caractere com a lista de
  status ativos do código, em três lugares. Bate.

---

## 3. O que foi encontrado

### Por severidade

| Severidade | Onda 1 (bruto) | Onda 1 (confirmado) | Onda 3 (procede) |
|---|---|---|---|
| Crítica | 7 | 2 | 0 |
| Alta | 40 | 19 | 3 |
| Média | 50 | 33 | 22 |
| Baixa | 25 | 33 | 14 |
| Informativa | 6 | 4 | 3 |
| **Total** | **128** | **91** | **42** |

A severidade sobe e desce entre as colunas porque a verificação também
reclassifica. Baixa subiu de 25 para 33 porque itens rebaixados de alta e média
caíram ali; crítica caiu de 7 para 2 porque cinco dos sete eram enquadramento
exagerado ou duplicata.

### Por categoria (os 91 confirmados)

| Categoria | Quantos |
|---|---|
| Segurança | 14 |
| Qualidade de código | 13 |
| Produto (regra do `PROJETO.md` não cumprida) | 11 |
| Consistência de dados | 10 |
| Experiência de uso | 9 |
| Autorização | 7 |
| Acessibilidade | 7 |
| Bug | 5 |
| Desempenho | 5 |
| Observabilidade | 5 |
| Privacidade | 2 |
| Confiabilidade, integridade, infraestrutura | 3 |

### Por natureza (os 42 do red team)

O red team olhou só para as correções da onda 2. A distribuição diz muito sobre
o que dá errado quando se corrige código:

| Natureza | Quantos |
|---|---|
| Correção incompleta — fecha uma metade do problema | 15 |
| Problema novo — a correção criou algo que não existia | 14 |
| Preexistente — nada a ver com a onda 2, achado de passagem | 7 |
| Regressão — quebrou algo que funcionava | 6 |

**Trinta e cinco dos 42 são sobre as correções, não sobre o código original.**
É o argumento mais forte a favor de ter feito a onda 3.

### Os que importam, um a um

**Webhook sem assinatura** (crítica, segurança). `TWILIO_VALIDATE_WEBHOOK`
tinha `false` como padrão e o arquivo de deploy não a declarava. O único campo
que identifica o hospital numa mensagem entrante é o número de destino, que é
público por desenho — sai no redirecionamento do link e no QR code. Sem
assinatura, dava para forjar mensagem dentro da conversa viva de um paciente e
para chutar códigos de acesso até entrar num setor sem nunca ter recebido link.
Sete frentes independentes acharam o mesmo defeito.

**Webhook engole erro e perde mensagem** (crítica, confiabilidade). A regra 6 do
`CLAUDE.md` manda o webhook responder sempre 200, porque um 500 faz a Twilio
reentregar em loop. A implementação cumpria a letra e perdia o espírito: erro
interno virava um 200 silencioso, sem log, e a mensagem do paciente
desaparecia — a Twilio já a tinha marcado como entregue. Hoje continua 200, mas
com log estruturado carregando o identificador da mensagem, que é o que permite
reprocessar à mão.

**Atendente age em setor alheio** (alta, autorização). Quatro frentes acharam
independentemente. Cinco endpoints — ler mensagens, responder, encerrar, listar
destinos de encaminhamento e encaminhar — chamavam uma busca que só filtrava por
hospital. A correção é uma consulta só, no repositório: a conversa tem que ser
minha ou do meu setor. Devolve 404, nunca 403, pela mesma razão que vale entre
hospitais.

**Encaminhamento pelo link congelado** (alta, autorização). A conversa guarda
uma cópia do rótulo do link, de propósito, para o histórico não virar mentira.
O código estava usando essa cópia para *autorizar*, e não só para relatar. O
comentário do próprio arquivo já dizia a regra certa — "o link é o vigente do
contato" — mas a aplicava apenas à lista de destinos. Um mesmo achado foi
relatado três vezes com severidades diferentes e fundido num só.

**Health check que mentia** (média, depois de rebaixado de crítica). Três linhas
que respondiam 200 sem tocar o banco, apontadas pelo `healthCheckPath` do
deploy. O achado foi rebaixado porque o health check não *causa* a queda — ele
deixa de detectá-la. Corrigido mesmo assim: são seis linhas e risco zero.

**Rate limit decorativo** (alta, correção incompleta). Este é o caso mais
instrutivo do relatório, porque o limite de tentativas de login foi *criado* na
onda 2 e nasceu contornável. A configuração de proxy estava em `true`, o que faz
o Express ler o endereço IP da entrada mais à esquerda do cabeçalho
`X-Forwarded-For` — dado que o cliente escreve. Quatro times mediram a mesma
coisa, separadamente: com o cabeçalho fixo, 429 a partir da 11ª tentativa; com o
cabeçalho rotativo, 40 tentativas em 40 sem um único bloqueio.

**Deadlock 40P01 na troca de turno** (alta, problema novo). Detalhado na seção 5.

---

## 4. O que foi corrigido, commit a commit

### `ff92f62` — nove corridas de concorrência

15 arquivos, +967/-94.

Este commit é anterior à auditoria propriamente dita e a motivou. Partiu de uma
observação do dono do projeto — duas mensagens simultâneas caindo no mesmo
atendente — e a caça que saiu dali achou mais oito corridas do mesmo tipo.

O padrão é sempre o mesmo: ler o estado, decidir, e gravar sem levar o estado
lido na condição da escrita. E a correção também: `updateMany` com a precondição
no filtro e checagem de quantas linhas mudaram.

| Corrida | Sintoma |
|---|---|
| Link nominal reivindicado por dois números | Os dois entravam, e o alerta de vazamento não era gravado |
| Encerramento sem guarda | A pessoa recebia a pergunta de nota duas vezes; o motivo do encerramento virava sorteio |
| Encaminhar contra encerrar | A conversa chegava ao setor novo já morta, e ninguém a via na fila |
| Dois atendentes encaminhando junto | Dois avisos contraditórios para a pessoa de fora |
| Escolha no menu contra encerrar | Conversa ressuscitada |
| Bloqueio contra mensagem em voo | Mensagem atendida depois do bloqueio |
| Login duplo | Duas sessões de plantão para a mesma pessoa |
| Escala contra login | Plantão órfão |
| Rodízio contra fim de plantão | Conversa presa em quem já saiu |

Todas foram reproduzidas por script *antes* da correção. O script
(`npm run check:corridas -w api`) ficou no repositório e hoje cobre 10 cenários
— o décimo foi acrescentado na onda 4.

### `d2bd846` — 50 achados da auditoria

58 arquivos, +2001/-504. Onze lotes, cada um dono exclusivo dos seus arquivos,
rodando em paralelo sem se atropelar.

| Lote | O que fechou |
|---|---|
| Borda e boot | Portões de configuração (assinatura da Twilio, chave de assinatura, origem do painel), `.gitignore`, encerramento limpo do processo, health check de verdade |
| Conversa no banco | Índice único que impede duas conversas ativas para o mesmo contato; índices que faltavam; a checagem de setor do atendente |
| Entrada da mensagem | Webhook que loga em vez de engolir; mídia; menu aceitando emoji e dígito de largura dupla; validação de telefone |
| Links e métricas | Revogar link encerra a conversa em curso; encaminhamento passa a ler o link vigente; fuso horário do hospital nas métricas; SLA para de esconder quem nunca foi respondido |
| Ciclo de vida e CSAT | Pergunta de nota deixa de ir para quem nunca foi atendido; correção de nota dentro da janela; conversa fantasma do "SIM" |
| Login e contas | Limite de tentativas; hash de senha fora da thread principal; remanejamento de setor devolve conversas |
| Scripts de checagem | O script de corridas deixara de restaurar a escala e a asserção de distribuição era fraca |
| Tela do atendente | Foco nos diálogos, rascunho perdido, cabeçalho em tela estreita, leitura por leitor de tela |
| Navegação do atendente | Confirmação ao encerrar ramal, campo de 14px que provocava zoom no iPhone, contraste, movimento reduzido |
| Painel do gestor | Gaveta de conversa com diálogo e Escape, atualização automática, foco visível |
| Plantão e ferramental | Teto de faixas por dia na escala, expiração do token acompanhando o plantão |

Os relatos dos lotes registram 53 itens fechados, contra os 50 do plano: quatro
problemas apareceram durante a implementação e foram corrigidos junto, e um lote
numerou os próprios itens em vez de usar os identificadores do plano. Não
reconciliei item a item.

### `8ea8e0f` — 21 achados do red team

23 arquivos, +767/-157. Seis lotes.

| Lote | O que fechou |
|---|---|
| Plantão e rodízio | O deadlock (A02); o rodízio que não conferia setor nem papel (A20); o login que segurava a resposta distribuindo a fila inteira (A21) |
| Link na conversa viva | Reatribuir contato ou desativar setor passa a encerrar a conversa que ficou fora do escopo (A03); o MENU passa a olhar se o setor atual está no link, não só o tamanho da lista (A04); o segundo menu do índice único (A11); o botão Encerrar que respondia sucesso sem encerrar (A05) |
| Front | Foco nos diálogos (A14); trava de Tab na gaveta do gestor (A15); Escape durante o envio (A16); contraste de um neutro que reprovava (A17); aviso quando a conversa sai da mão do atendente (A18) |
| Deploy e webhook | Validação de assinatura declarada junto com o provedor errado (A09); seed de demonstração publicado no blueprint (A10); boot derrubado por qualquer erro de banco (A19) |
| Rate limit | O contorno pelo cabeçalho de proxy (A01); recusa por fim de plantão deixando de gastar o limite (A13) |
| Posse do link | Guarda de conflito no caminho de link de perfil (A12); CSAT (A07); mensagem numérica na janela de comentário (A08) |

---

## 5. As três correções que criaram problema novo

Esta é a parte mais valiosa do relatório. Se a auditoria tivesse parado na onda
2, os três teriam ido para `main` como melhorias.

### 5.1 O deadlock ABBA

**O que a onda 2 fez.** Para fechar a nona corrida — conversa presa em quem já
saiu do plantão —, envolveu duas rotinas em transações: `endShift` (o atendente
clica em "meu plantão acabou") e `expireDueShifts` (o trabalho automático que
roda a cada 60 segundos e fecha plantão vencido).

**O que isso quebrou.** As duas transações mexem nas mesmas duas tabelas, em
ordem invertida. `endShift` trava `users` e depois `shift_sessions`.
`expireDueShifts` travava `shift_sessions` e depois `users`. É o ciclo ABBA
clássico: cada uma segura o que a outra quer, e o Postgres mata uma das duas com
o erro 40P01.

Antes da correção o ciclo era impossível — os dois caminhos eram comandos soltos,
sem transação longa. **A correção criou o deadlock.**

O red team reproduziu 17 quedas em 30 rodadas, com atraso natural de 0 a 6
milissegundos entre as duas. Em 15 das 17, a vítima foi o lado da pessoa: erro
500 ao encerrar o plantão ou ao fazer login. O momento é o pior possível — a
troca de turno é exatamente quando os dois caminhos rodam juntos. E quando o
outro lado era o administrador desativando um atendente, a desativação
simplesmente não acontecia: o admin recebia 500 numa ação de corte de acesso e
a pessoa continuava ativa.

**O que quase deu errado de novo.** O red team sugeriu uma correção: adiantar a
gravação de "offline" para o começo da transação, o que resolveria a ordem dos
locks. O juiz rejeitou. Quem decide se há conversa a soltar é a contagem de
linhas do fechamento da sessão — gravar "offline" antes marcaria fora do ar
justamente quem o administrador acabou de esticar o plantão.

**A correção que ficou.** Um `SELECT ... FOR UPDATE` na linha do atendente como
primeiro comando da transação. Trava sem escrever. Não guarda nenhuma regra de
negócio — existe só para pôr as duas transações na mesma ordem de travas. Está
no código com um comentário de 15 linhas explicando por quê, e virou o décimo
cenário do script de corridas.

### 5.2 A guarda de CSAT

**O que a onda 2 fez.** Um achado legítimo: a pergunta de satisfação estava
sendo enviada para quem nunca falou com ninguém do hospital. Conversa que morre
no menu, o trabalho automático encerra por inatividade, e a pessoa recebe "de 0
a 10, como foi o atendimento?" — de um atendimento que não existiu, com a nota
pesando igual na média. A correção passou a exigir `firstReplyAt`, o carimbo da
primeira resposta digitada por um atendente.

**O que isso quebrou.** `firstReplyAt` mede "alguém digitou", não "alguém
atendeu". O atendente que assume a conversa da fila, resolve por telefone ou no
balcão e clica em Encerrar sem escrever nada deixa o campo nulo — e a pesquisa
não era enviada. O `PROJETO.md` é explícito no sentido contrário: encerramento
feito por gente pergunta sempre, "inclusive quando o atendente resolveu por
telefone e não digitou nada". E a própria tela do atendente prometia a pesquisa
em dois lugares diferentes.

**A correção que ficou.** Trocar o critério: pergunta-se a nota quando a
conversa **chegou a alguém** (`firstAssignedAt`, que é gravado na atribuição,
não na digitação) **ou** quando foi gente que a encerrou — o atendente pelo
botão, a pessoa de fora pelo MENU. Fica de fora só o caso que motivou a regra
original: a conversa que morreu no menu e o trabalho automático encerrou.

### 5.3 O hook de diálogo

**O que a onda 2 fez.** Criou um hook para os diálogos modais: prende o Tab
dentro da caixa, escuta Escape e devolve o foco ao elemento de origem quando
fecha. Corrigia uma falha real de acessibilidade.

**O que isso quebrou, em dois lugares.**

O hook captura o elemento em foco dentro de um efeito. Mas o React aplica
`autoFocus` na fase de layout, *antes* dos efeitos. Em dois dos três diálogos, o
que o hook guardava como "elemento de origem" já era um botão de dentro da
própria caixa — que, ao fechar, sai do DOM, e mandar foco para ele não faz nada.
O foco caía no corpo da página e o Tab seguinte recomeçava do topo. Exatamente o
que o comentário do hook prometia impedir. No celular o mecanismo era outro e o
resultado o mesmo: o item de menu que abre o diálogo é desmontado no mesmo
instante em que o diálogo monta.

E o mesmo commit criou um quarto diálogo — a gaveta de conversa do gestor — com
`role="dialog"` e `aria-modal="true"`, mas **sem** usar o hook. Dois Tabs
bastavam para o foco sair da gaveta e cair na navegação lateral, atrás da máscara
escura, com o leitor de tela informando que o resto da página não existia. Havia
ainda um segundo defeito: durante o carregamento, Escape e clique fora não
faziam nada, e a gaveta reabria sozinha segundos depois com o histórico de um
paciente que o gestor já tinha desistido de ver.

**A correção que ficou.** Os chamadores passam explicitamente a referência do
elemento de origem, em vez de deixar o hook adivinhar. E a gaveta do gestor
passou a usar o mesmo hook dos outros.

### O padrão, e o que aprender com ele

Os três casos têm a mesma forma: **uma correção correta na intenção, aplicada
onde o problema era visível, sem varrer os outros lugares onde ela mudava o
comportamento.** O deadlock veio de envolver duas rotinas em transação sem
comparar a ordem dos locks. O CSAT veio de escolher um carimbo de tempo próximo
sem checar se ele mede a mesma coisa. O hook veio de resolver dois dos três
chamadores e criar um quarto sem ele.

O juiz encontrou o mesmo padrão em outra forma, e batizou de "correções que
parecem fechar e não fecham" — 15 dos 42 achados. O botão Encerrar do atendente
passou a devolver um booleano dizendo se encerrou de verdade, e a rota jogava o
booleano fora, respondendo sucesso sempre. Uma lista de conversas soltas ganhou
cinco linhas de comentário definindo um contrato que nenhum chamador cumpria. Um
comentário de CSS afirmava conformidade de contraste que, recalculada, não
batia (3,65:1 contra 4,5 exigidos).

**Comentário que promete e código que não cumpre é pior que comentário
nenhum** — porque o próximo leitor confia nele e não vai conferir.

---

## 6. O que não foi corrigido

Vinte e um achados foram adiados com justificativa escrita, item a item, em
[PENDENCIAS.md](PENDENCIAS.md). Distribuição:

| Severidade | Quantos |
|---|---|
| Média | 4 |
| Baixa | 14 |
| Informativa | 3 |

Três razões predominam.

**Editar migration já aplicada quebraria o deploy.** Dois achados são sobre as
migrations recém-criadas. Ambos procedem — há uma janela real entre o
preenchimento retroativo e a criação do índice, e o critério que escolhe qual
conversa duplicada sobrevive pode matar justamente a que estava em atendimento.
Mas as duas migrations já rodaram: mudar o arquivo muda a soma de verificação e
faz o `migrate deploy` recusar com erro P3006. Corrigir aqui quebraria o deploy
em vez de consertá-lo. Se houver conserto, é migration nova.

**O custo passa do benefício na escala do MVP.** Exemplo: revogar um link de
perfil percorre todos os contatos vinculados com duas consultas cada, dentro da
requisição. É lento com muitos contatos, mas o MVP não tem muitos contatos, e a
correção certa envolve trabalho assíncrono que o projeto ainda não tem.

**A decisão é do dono, não da auditoria.** Dezenove achados foram marcados
assim. Política de senha mínima, esconder as credenciais de demonstração da tela
de login, o que fazer com dados de paciente que hoje nunca são apagados, se o
`packages/shared` continua existindo sem ser importado por ninguém. São escolhas
de produto, e escrever código sem elas seria adivinhar.

A pendência que merece mais atenção não é técnica: **não há teste automatizado,
runner, linter ou integração contínua no repositório.** A regra "nenhuma query
chega ao banco sem tenant_id" e a regra "a lista de setores vem do link" são
hoje verificadas por leitura. Isso funcionou nesta auditoria — 48 agentes lendo
o mesmo código encontram bastante coisa. Não funciona na quinta alteração que
alguém fizer sozinho numa terça-feira.

---

## 7. Limitações da análise

Esta seção existe porque um relatório que não diz onde parou é pior que nenhum.

**Não foi possível verificar o que está configurado no Render.** A auditoria
leu o `render.yaml`, que é versionado, e não o painel — tocar em produção estava
proibido. O blueprint declara `WHATSAPP_PROVIDER: mock`, `plan: free` nos três
serviços, e não publica o portão do seed de demonstração. Se alguém definiu
variáveis pelo painel, a auditoria não sabe. Duas alegações do red team foram
descartadas exatamente por isso — nem confirmadas, nem desmentidas.

**Comportamento com duas instâncias não foi testado.** O `render.yaml` declara
plano gratuito, que roda uma instância só. Três achados dependem disso: a posse
do link nominal, a unicidade da conversa ativa e o limite de tentativas de login
são garantidos por estruturas em memória, que valem por processo. Os dois
primeiros ganharam garantia no banco na onda 2 (índice único e trava de linha);
o terceiro continua em memória. A janela onde isso importa hoje é estreita — a
sobreposição de deploy, em que a instância antiga ainda drena enquanto a nova já
atende. Se o serviço escalar, vira problema imediato.

**O encerramento limpo por SIGTERM não foi exercitado.** O código está escrito e
foi lido — para os trabalhos periódicos, drena as conexões e tem teto de 20
segundos. Mas o Windows não entrega SIGTERM como o Linux, e testar em produção
estava fora. Está verificado por leitura, não por execução.

**`npm run build` do painel não foi rodado.** O servidor de desenvolvimento do
dono estava de pé, e `next build` disputa a mesma pasta. O que ficou sem
cobertura é justamente o que só o empacotador acusa: erro de pré-renderização,
importação de módulo de servidor dentro de componente cliente, limites de
`'use client'`. O que **foi** verificado: `tsc --noEmit` passa nos dois
aplicativos, sem erro. Rodei os dois agora, para escrever isto.

**Não existe teste automatizado para verificar contra.** Procurei arquivos
`.test.ts`, `.spec.ts` e `.test.tsx` no repositório inteiro. Zero. Existem dois
scripts de checagem de concorrência, com 10 cenários, e o próprio red team
apontou que 7 dos 9 cenários originais não têm um controle — não distinguem "a
guarda segurou" de "a guarda nem chegou a ser chamada". Toda afirmação deste
relatório sobre comportamento vem de leitura de código, de experimento manual
feito por um agente, ou de medição registrada por ele. Nenhuma vem de uma suíte
que alguém possa rodar de novo amanhã.

**Uma nuance sobre a regra do `tenant_id`.** Verifiquei pessoalmente: nenhuma
consulta a tabela do Prisma acontece fora da camada de repositórios (as únicas
duas chamadas ao Prisma fora dela são o `SELECT 1` do health check e o
encerramento do pool no desligamento), e todas as buscas diretas por chave única
sem filtro de hospital usam chave única *global* — `slug`, `wa_message_id`,
`email` — ou chave composta que já inclui o hospital. Cada uma tem comentário
justificando. Mas há um detalhe que a regra não cobre:
**as tabelas `messages` e `feedback` não têm coluna `tenant_id`.** O isolamento
delas é transitivo, pela conversa — que sempre é resolvida com o hospital antes.
Funciona, e é o desenho declarado no `PROJETO.md`. Mas significa que a regra
"nenhuma query chega ao banco sem `tenant_id`" tem duas tabelas onde ela é
impossível de cumprir ao pé da letra, e onde a proteção depende de a conversa ter
sido carregada corretamente antes. Nenhum time achou um caminho em que isso
falhe. Nenhum teste garante que continuará assim.

**O que esta auditoria não olhou.** Não houve teste de carga. Não houve análise
do custo de mensagens da Twilio em cenário de abuso. Não houve revisão jurídica
sobre dado de saúde — o sistema guarda telefone de paciente e o conteúdo de
conversas com o hospital, nunca apaga nada, e não tem rota de exportação nem de
exclusão. Isso está registrado como pendência, não como achado, porque a decisão
é do dono e provavelmente de um advogado.

---

## 8. Nível de confiança e risco residual

### Onde a confiança é alta

- **Isolamento entre hospitais.** Sete frentes atacaram, incluindo um pentest com
  a API no ar. 27 requisições cruzadas, todas 404. A disciplina de camadas ajuda:
  o Prisma só é chamado dentro de `repositories/`, e o `tenantId` é o primeiro
  parâmetro de toda função de lá. É a parte mais bem verificada do sistema.
- **O escopo do link no que a pessoa de fora vê e escolhe.** Menu inicial,
  resposta ao MENU, validação da escolha numérica e destinos de encaminhamento
  vêm todos da lista do link, e depois da onda 4 vêm do link *vigente*, não do
  congelado.
- **As nove corridas de concorrência do `ff92f62`.** Reproduzidas antes da
  correção, e o script continua no repositório.

### Onde a confiança é média

- **O ciclo de vida da conversa.** Muitos caminhos encerram a mesma conversa —
  trabalho automático, botão do atendente, MENU+SIM, revogação, desativação de
  setor. A onda 2 e a onda 4 fecharam vários furos aí, e o red team continuou
  achando. É a área com mais achados de "correção incompleta".
- **O frontend.** Testado no navegador, com Playwright, por um agente que achou
  14 itens. Mas o empacotador nunca rodou, e não há teste de interface.

### Onde a confiança é baixa

- **Comportamento sob concorrência real, com duas instâncias.** Não testado, e
  três garantias dependem disso.
- **Comportamento em produção.** O que está configurado no Render é
  desconhecido. O plano gratuito hiberna após 15 minutos, e a primeira mensagem
  depois do silêncio pode estourar o tempo de espera da Twilio e se perder — este
  achado está aberto, marcado como decisão do dono, porque a solução é pagar por
  um plano que não hiberna.
- **Qualquer alteração feita a partir de agora.** Sem teste e sem integração
  contínua, nada impede que a próxima mudança reabra qualquer um dos 71 achados
  corrigidos. É o risco residual mais importante deste documento.

### O que não se pode dizer

Não se pode dizer que o sistema está seguro. Pode-se dizer que:

- 128 problemas foram levantados, 91 confirmados no código, e 71 corrigidos em
  três commits;
- as correções foram atacadas por sete times adversariais, que acharam 42
  problemas nelas — 21 corrigidos, 21 adiados com justificativa;
- nenhum time conseguiu furar o isolamento entre hospitais nem burlar o escopo
  do link nas telas e nas escolhas da pessoa de fora;
- três correções criaram problemas novos, e os três foram encontrados e
  fechados;
- e nada disso está preso por teste automatizado, o que significa que a garantia
  vale para o código de hoje e não para o de depois de amanhã.

Para uma avaliação técnica, isso é bastante. Para um hospital de verdade
atendendo paciente, o primeiro item da lista de próximos passos é uma suíte de
testes que amarre as duas regras inegociáveis — e o segundo é sair do plano
gratuito.
