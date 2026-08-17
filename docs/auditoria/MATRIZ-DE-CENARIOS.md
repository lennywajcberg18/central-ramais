# Matriz de cenários e testes

Central de Ramais — branch `fix/concorrencia-na-distribuicao`, três commits à frente
de `main` (`ff92f62`, `d2bd846`, `8ea8e0f`).

Este documento tem duas partes.

A **parte 1** é a matriz: para cada coisa que uma pessoa faz no produto, quais
situações podem acontecer, o que o sistema faz em cada uma delas hoje, e se
alguém verificou isso — dizendo com que ferramenta.

A **parte 2** é o estado dos testes: o que dá para executar hoje com um comando,
o que não existe, e a especificação da suíte que a auditoria escreveu para
alguém implementar depois.

O documento não diz que o sistema está seguro nem que está correto. Ele diz o
que foi olhado, como, e o que ficou de fora. Cada linha marcada como
**não verificado** é uma dívida real, não um detalhe de formatação.

---

## Como ler a coluna "verificado"

| Marca | Significa |
|---|---|
| `script` | Reproduzido por script executável, com várias rodadas — o mais forte que existe aqui |
| `HTTP` | Requisição de verdade contra a API no ar, durante a auditoria |
| `banco` | Experimento direto no Postgres (transação, migration, índice) |
| `navegador` | Exercitado na interface via Playwright, contra `web:3000` + `api:3001` |
| `leitura` | Só leitura de código. Ninguém executou |
| `manual (build)` | Testado à mão quando a task foi construída e marcado no `TASKS.md`; não foi refeito nesta auditoria |
| `não verificado` | Ninguém olhou este caminho, nem lendo nem executando |

`leitura` é o nível mais comum aqui, e é preciso entender o que ele vale: prova
que o código tem a intenção certa, não que ele funciona. Uma linha `leitura` é
uma hipótese bem fundamentada, não um fato.

### De onde vem a evidência

A auditoria que produziu isto foi 48 agentes em cinco ondas:

| Onda | O que fez | Resultado |
|---|---|---|
| 1 | 10 auditores independentes, só leitura | 128 achados brutos |
| 1b | 5 verificadores reabriram cada achado no código | 91 sobreviveram, 37 descartados |
| 2 | 11 lotes de implementação, um dono por arquivo | commit `d2bd846` — 58 arquivos, +2001/−504 |
| 3 | 7 red teams adversariais + 1 juiz | 62 achados brutos, 42 procedem, 5 descartados |
| 4 | 6 lotes de correção | commit `8ea8e0f` — 23 arquivos, +767/−157 |

Mais 21 achados adiados com justificativa escrita.

Duas checagens que rodei ao escrever este documento, e cujo resultado vale como
fato datado:

```
npx tsc --noEmit -p apps/api/tsconfig.scripts.json   → exit 0
npx tsc --noEmit -p apps/web/tsconfig.json           → exit 0
```

O primeiro cobre `src/`, `scripts/` e `prisma/seed.ts` do backend. `next build`
não foi executado (o servidor de desenvolvimento do dono estava de pé e as duas
coisas disputam a pasta `.next`).

---

# PARTE 1 — A matriz

---

## J1 — O externo manda a primeira mensagem

É a jornada mais crítica do produto: é aqui que o sistema decide se alguém de
fora pode ou não falar com o hospital.

| Cenário | O que o sistema faz hoje | Verificado | Como |
|---|---|---|---|
| Caminho feliz — código válido, link de perfil | Cria `external_contact` amarrado ao link, abre a conversa, manda o menu com os setores do link | sim | `HTTP` (curl 2 do `TASKS.md`) e `script` (o `check-corridas` usa o mesmo `handleInbound`) |
| Número novo, sem código | Responde "não identificamos seu acesso" e grava `access_attempt(no_code)` | sim | `HTTP` (curl 1) |
| Número novo, código inexistente | Mesma resposta, `access_attempt(invalid_code)` com o código tentado | sim | `leitura` (`access.service.ts:60-64`) + `manual (build)` |
| Código de link de **outro** hospital | `findByCode` filtra por `tenantId`; o código não é encontrado e vira `invalid_code`. Nenhum registro cai no outro hospital | parcial | `leitura`. O caso completo (nada gravado no tenant B) está especificado como **A8** e nunca foi executado |
| Link nominal livre, primeiro número | Cria o vínculo dentro de uma transação com a linha do link travada | sim | `HTTP` (curl 4) + `script` |
| Link nominal já usado, segundo número | Recusa, grava `access_attempt(nominal_taken)` fora da transação (rollback não pode apagar o alerta) | sim | `script` — `check-corridas` cenário 5, 6 rodadas |
| **Concorrência:** dois números novos reivindicando o mesmo link nominal no mesmo instante | Um vira dono, o outro é recusado e vira alerta. A trava é do banco, não da memória — atravessa instâncias e sobrevive a restart | sim | `script` — cenário 5, asserção "1 dono E 1 alerta" |
| **Duplicidade:** duas mensagens do mesmo número novo ao mesmo tempo, link de perfil | `createOrGet` faz a perdedora seguir no contato que a outra criou, em vez de estourar | sim | `leitura` + `banco` (o red team provou que `create()` devolve a linha existente em vez de lançar) |
| Contato conhecido, link ativo | Segue direto; o código nem precisa aparecer na mensagem — o vínculo é a fonte de verdade | sim | `HTTP` (curl 3) |
| **Link revogado**, contato conhecido | Encerra a conversa ativa com `access_revoked`, avisa "seu acesso foi encerrado", grava `access_attempt(revoked_link)`. Sem pergunta de nota | sim | `leitura` + `manual (build)` (aceite do MVP) |
| Contato **bloqueado** | Silêncio total — nenhuma resposta. Grava `access_attempt(blocked)` | sim | `leitura` + `script` (cenário 6 cobre o bloqueio com a mensagem em voo) |
| **Concorrência:** admin bloqueia o contato no mesmo instante em que a mensagem dele chega | O webhook relê o bloqueio depois de criar a conversa e a encerra; nenhuma conversa ativa sobra presa na fila | sim | `script` — cenário 6, 6 rodadas |
| **Recurso desativado:** o link existe mas todos os setores dele foram desativados | Responde que não há setor disponível e **não** abre conversa | sim | `leitura` (`conversation.service.ts:41-44`) |
| **Entrada inválida:** número fora do padrão E.164 | Descartado antes de tocar o banco, com log mascarado. Não cria contato nem `access_attempt` | sim | `leitura` (`webhook.service.ts:48-54`) |
| **Erro:** `To` desconhecido (número que não é de nenhum hospital) | Loga e devolve 200. Nada mais | sim | `HTTP` (um dos quatro casos rodados à mão pela frente de QA) |
| **Duplicidade:** o Twilio reentrega o mesmo `MessageSid` | Dois níveis: memória (janela de 6 h, teto de 20 mil SIDs — cobre recusa, bloqueio e revogação, que não viram linha em `messages`) e banco (`wa_message_id` UNIQUE). Duplicata é ignorada em silêncio, com 200. **Reinício do processo esquece a memória**, e a limitação está assumida por escrito no código | parcial | `leitura` (`utils/seenMessageIds.ts`). Os casos **D1–D3b** estão especificados e nunca foram executados |
| Anexo (foto, áudio) sem legenda | Grava um corpo legível no lugar do vazio, avisa que o hospital só lê texto, e **não** conta como escolha de menu | sim | `leitura` (`webhook.service.ts:127-138`) |
| **Provedor fora do ar** na hora de recusar | `sendLooseText` lança; o webhook loga em JSON com o `MessageSid` e responde 200. A pessoa **não recebe** a mensagem de recusa. O `access_attempt` já está gravado | sim | `leitura` (`messaging.service.ts:8-10`, `routes/webhook.ts:34-48`). Nunca executado com o provedor caindo |

**Não verificado nesta jornada:** o comportamento com o provedor real fora do ar
(só o mock foi usado); o caso A8 completo (código cruzado entre hospitais, com
asserção nos dois lados); a reentrega do Twilio de verdade — o dedupe foi lido,
não exercitado.

---

## J2 — O externo escolhe o setor

A segunda regra inegociável do `CLAUDE.md` vive aqui: a lista de setores vem
sempre do link, nunca do hospital.

| Cenário | O que o sistema faz hoje | Verificado | Como |
|---|---|---|---|
| Caminho feliz — digita um número da lista | Grava o setor, avisa que entrou na fila, chama o rodízio | sim | `HTTP` (curl 3) + `script` |
| Lista com **1 setor** | Pula o menu e entra direto em `open` | sim | `HTTP` (curl 6) |
| Lista com 2 ou mais | `awaiting_department` e mostra só os setores do link, na ordem de `sort_order` | sim | `HTTP` (curl 2) |
| **Permissão:** escolhe um número que corresponde a um setor que existe no hospital mas **não está no link** | Tratado como inválido. É falha de autorização, não de UX | sim | `HTTP` (curl 7, aceite do MVP) |
| **Entrada inválida:** texto, emoji de teclado (`1️⃣`), dígito de largura total (`１`), "2." | O parser normaliza NFKC, tira o seletor de variação e a pontuação final, e aceita. "falar com o 2º andar" **não** vira opção 2 | parcial | `leitura` (`conversation.service.ts:108-124`). Nenhum destes casos foi executado |
| Escolha inválida repetida | `menu_retries++` e reenvia o menu; na quarta, atribui ao **primeiro setor da lista do link** | sim | `leitura` + `manual (build)`. O caso **B11** (que garante "primeiro do link", não "primeiro do hospital") nunca foi executado |
| **Estado vazio:** todos os setores do link foram desativados enquanto a pessoa pensava | Avisa e encerra com `no_agent_available` | sim | `leitura` (`conversation.service.ts:165-176`) |
| **Recurso desativado:** um dos setores do menu é desativado no meio | Some do menu na próxima montagem, sem editar o link. A numeração encolhe | parcial | `leitura`. O caso **B7** está especificado e não foi executado |
| **Concorrência:** a pessoa responde "1" no mesmo instante em que o job de inatividade encerra a conversa | A escolha só vale se o status ainda for `awaiting_department` (estado no `WHERE`). Se perdeu, nada acontece e a próxima mensagem abre conversa nova. A conversa **não** ressuscita com `closed_at` gravado | sim | `script` — `check-corridas` cenário 4, 6 rodadas |
| **Timeout:** a pessoa recebe o menu e some | O job de inatividade encerra em 30 min com `close_reason=timeout`. Sem pergunta de nota, porque nunca chegou a ninguém | sim | `manual (build)` (`scripts/force-timeout.ts`) + `leitura` |
| **Duplicidade:** a mesma escolha chega duas vezes | O dedupe barra antes. Se passar (SIDs diferentes), a segunda cai em conversa já `open` e fica só registrada | parcial | `leitura` |

---

## J3 — O externo é atendido

| Cenário | O que o sistema faz hoje | Verificado | Como |
|---|---|---|---|
| Caminho feliz — o rodízio entrega a um atendente de plantão | `assigned_user_id`, `assigned_at` e `first_assigned_at` gravados; `first_assigned_at` é write-once | sim | `script` (`check-distribuicao`, rodada de controle) |
| **Estado vazio:** nenhum atendente de plantão no setor | A conversa fica em `open`, sem erro e sem aviso ao externo | sim | `leitura` + `script` |
| **A conversa em `open` nunca expira sozinha** | O job de inatividade varre só `assigned`, `awaiting_department` e `awaiting_menu_confirm`. Uma conversa na fila sem atendente fica lá até alguém entrar de plantão, responder, ou o admin agir | sim | `leitura` (`repositories/conversations.ts:370-378`) — confirmado por mim ao escrever este documento |
| **Concorrência:** dois externos escrevem ao mesmo tempo para o mesmo setor | A escolha do atendente é serializada **por setor**; cada conversa vai para um atendente diferente | sim | `script` — `check-distribuicao-concorrente`, 6 rodadas |
| **Concorrência:** o rodízio entrega a conversa no instante em que o escolhido encerra o plantão | O `UPDATE` exige plantão aberto e o setor certo. Se perdeu, a conversa volta para a fila em vez de ficar com quem saiu | sim | `script` — cenário 9, com rodada de controle |
| Atendente responde uma conversa que está na fila | Assume o atendimento (`assignTo`) e responde | sim | `navegador` + `HTTP` |
| **Concorrência:** dois atendentes abrem a mesma conversa da fila e respondem juntos | Quem chega primeiro fica com ela; a mensagem do segundo sai do mesmo jeito, porque ele já digitou | sim | `leitura` (`routes/agent.ts:96-102`). O `assignTo` deste caminho **não** tem transação nem checagem de plantão — está registrado como pendência adiada |
| **Permissão que mudou:** o atendente perde o plantão enquanto está com a conversa aberta na tela | `requireAuth` recusa na requisição seguinte; a interface desloga e leva para `/login?motivo=plantao` preservando o rascunho | sim | `navegador` |
| **Erro:** a conversa é encerrada pelo job enquanto o atendente escreve | 400 "esta conversa foi encerrada enquanto você escrevia". Nada sai pelo WhatsApp e `first_reply_at` continua nulo | sim | `leitura` (`routes/agent.ts:109-112`). O caso **C4** está especificado e não foi executado |
| **Permissão:** atendente de outro setor tenta ler a conversa | 404 (`findByIdForAgent` exige que a conversa seja dele ou de um setor dele) | sim | `HTTP` — o red team mediu a matriz: admin 404/404/200, dono 200/200/403, atendente de outro setor 404/404/403 |
| **Isolamento entre hospitais:** token do hospital A contra ID do hospital B | 404 em todos os endpoints com `:id` — nunca 403 | sim | `HTTP` — 27 requisições contra IDs de outro hospital, todas 404 |
| **Provedor fora do ar** na resposta do atendente | O envio acontece **antes** de persistir; se falha, nada é gravado e o atendente recebe 500. Não há retentativa | sim | `leitura` (`messaging.service.ts:21-29`). Nunca executado com o provedor caindo |
| **Volume alto:** fila grande na virada de turno | A distribuição da fila roda solta, fora da resposta do login (com 100 conversas paradas o login levava ~6,6 s antes disso) | sim | `HTTP` (medido pela auditoria) |

---

## J4 — O externo pede MENU

| Cenário | O que o sistema faz hoje | Verificado | Como |
|---|---|---|---|
| `MENU` em `assigned`, link com 2+ setores | Pergunta "deseja encerrar e voltar ao menu? SIM ou NÃO" | sim | `manual (build)` + `leitura` |
| `SIM` | Encerra com `user_switched`, pede a nota, e abre conversa nova já no menu **do link dele** | sim | `manual (build)`. O caso **B4** está especificado e não foi executado |
| `NÃO` | Volta para `assigned` com uma mensagem visível ao atendente | sim | `leitura` |
| Resposta inválida | Repete a pergunta uma vez; na segunda, assume `NÃO` | sim | `leitura` |
| **Link com 1 setor só, e a conversa está nele** | Responde que não há outro setor e mantém a conversa | sim | `leitura` (`lifecycle.service.ts:173-182`) |
| **Permissão que mudou:** link com 1 setor, mas a conversa está num setor que o link **não** permite mais | O MENU oferece a troca mesmo assim — senão a única saída da pessoa fecha justamente quando ela precisa dela | sim | `leitura` (`lifecycle.service.ts:171`) |
| **Concorrência:** `SIM` no instante em que o dono encerra o plantão | Se o encerramento não valeu, nenhuma conversa nova é aberta. Sem isso sobrariam duas ativas para o mesmo contato | sim | `leitura` (`lifecycle.service.ts:215-225`) + índice único parcial no banco |
| **Concorrência:** `MENU` no instante em que o job de inatividade encerra | A pergunta só é feita se a transição de `assigned` valer; caso contrário nada é enviado | sim | `leitura` (guarda de estado) + `script` (o cenário 1 exercita o encerramento duplo) |
| `MENU` com acento, minúscula, espaços | `normalizeKeyword` tira acento, espaço e caixa | sim | `leitura` (`utils/text.ts`) |
| **Bloqueio da transferência:** o atendente tenta encaminhar enquanto a pessoa responde SIM/NÃO | 400 — "espere a resposta dela". Sem isso o pedido morria sem ser atendido nem cancelado | sim | `leitura` (`transfer.service.ts:63-67`) |

---

## J5 — O externo é encaminhado para outro setor

| Cenário | O que o sistema faz hoje | Verificado | Como |
|---|---|---|---|
| Caminho feliz | A conversa continua sendo **uma só**, vira mensagem `system`, o externo é avisado, e ela volta para a fila do setor novo | sim | `navegador` + `HTTP` |
| Destinos oferecidos | Os setores do **link vigente do contato**, não os do hospital e não os do snapshot da conversa | sim | `leitura` (`transfer.service.ts:22-38`) + `HTTP` |
| **Permissão:** setor fora do link | 404 "setor não disponível para este contato" — mesmo tratamento que entre hospitais | sim | `HTTP` (red team). O caso **B9** completo (nada gravado, provedor não chamado) não foi executado |
| Quem encaminhou não recebe de volta | `exceptUserId` tira ele do rodízio daquela atribuição | sim | `leitura` (`routing.service.ts:38-40`) |
| **Concorrência:** dois atendentes encaminham a mesma conversa ao mesmo tempo | Exatamente um aviso chega ao externo; o perdedor vê na tela que o encaminhamento dele não valeu | sim | `script` — cenário 3, 6 rodadas |
| **Concorrência:** encaminhar no mesmo instante do job de inatividade | A conversa não vai para o setor novo já morta ("zumbi") | sim | `script` — cenário 2, 6 rodadas, com o job instrumentado para provar que ele realmente entra na corrida |
| Conversa já encerrada | 400 "esta conversa já foi encerrada" | sim | `leitura` |
| Contato bloqueado | 400 | sim | `leitura` |
| Mesmo setor de origem | 400 "a conversa já está neste setor" | sim | `leitura` |
| `first_assigned_at` sobrevive ao encaminhamento | Fica intacto — o externo esperou uma vez só | sim | `leitura` (`transfer.service.ts:88-90`). O caso **C3** não foi executado |

---

## J6 — O externo dá (ou não dá) a nota

| Cenário | O que o sistema faz hoje | Verificado | Como |
|---|---|---|---|
| Encerramento por atendente ou por MENU+SIM | Pergunta a nota sempre, se o hospital tiver CSAT ligado — inclusive quando o atendente resolveu por telefone e não digitou nada | sim | `leitura` (`lifecycle.service.ts:53-55`) |
| Encerramento por inatividade, conversa que **nunca** chegou a ninguém | **Não** pergunta. Nota de conversa abandonada pesaria igual na média | sim | `leitura` + `script` (o cenário 1 depende disso) |
| Encerramento por `access_revoked` | Nunca pergunta — quem teve o acesso cortado não consegue responder | sim | `leitura` |
| Número 0–10 | Vira `feedback.score`; "07" é aceito como 7 | sim | `manual (build)` (curl com "9") |
| Texto livre em até 10 min depois da nota | Vira `feedback.comment` e fecha o ciclo | sim | `manual (build)` |
| **Correção:** outro número dentro da janela | Substitui a nota e confirma ("sua nota foi atualizada"), em vez de virar comentário | sim | `leitura` (`lifecycle.service.ts:353-364`) |
| Ignorar | Aceitável. Sem insistência, sem lembrete | sim | `leitura` |
| Mensagem nova em vez de nota | Fecha sem nota e **abre conversa nova** | sim | `leitura` |
| `awaiting_feedback` não bloqueia conversa nova | Confirmado no índice único parcial do banco: o estado está fora da lista | sim | `banco` — `SELECT indexdef` conferido no Postgres |
| **Concorrência:** encerramento duplo (botão do atendente + job de inatividade) | Exatamente **uma** pergunta de nota é enviada, e o `close_reason` não vira sorteio | sim | `script` — cenário 1, 6 rodadas, asserção "nem 0 nem 2" |
| **Erro:** provedor fora do ar na hora de perguntar a nota | A conversa fica em `awaiting_feedback` sem que a pergunta tenha saído. A pessoa nunca vê o pedido; a taxa de resposta cai sem explicação | não | `leitura`. Nunca executado |

---

## J7 — O atendente entra de plantão

| Cenário | O que o sistema faz hoje | Verificado | Como |
|---|---|---|---|
| Caminho feliz — dentro da escala | Abre a sessão de plantão, marca `available`, o JWT carrega `shiftSessionId` e expira junto com o turno | sim | `HTTP` + `navegador` |
| **Fora da escala** | 403 explicando o motivo e dizendo quando é o próximo plantão | sim | `HTTP` (`agente3` de dia) |
| **Sem escala nenhuma** | 403 com mensagem específica, sem próxima janela | sim | `leitura`. O caso **F2** não foi executado |
| Sessão já aberta e válida | Reaproveita — celular e computador são o mesmo plantão | sim | `script` — cenário 7 |
| Sessão aberta mas vencida | Fecha e abre outra, em vez de recusar o login | sim | `leitura` + `script` (cenário 10 monta exatamente esse estado) |
| Plantão que atravessa a meia-noite (19:00–07:00) | Faixas viram intervalos absolutos na semana, replicados na semana anterior e seguinte | sim | `leitura` (`utils/shiftClock.ts:66-80`). Os 14 casos do grupo **E** não foram executados |
| Teto de 16 horas | Nem plantão de 24 h mantém o token vivo o dia inteiro; o teto conta do início da sessão, não da última edição da escala | sim | `leitura` |
| **Fuso horário:** o hospital em outro fuso | Toda conta de escala usa o `timezone` do tenant, não o do processo | parcial | `leitura`. Fuso inválido cai para UTC com aviso. **Virada de horário de verão não foi testada** (caso E13) |
| **Concorrência:** login pelo celular e pelo computador no mesmo instante | Uma sessão só. Duas fariam o job achar que o turno seguinte já começou e deixar de devolver as conversas de quem saiu | sim | `script` — cenário 7, 6 rodadas |
| **Concorrência:** o admin salva a escala no mesmo instante do login | A pessoa não entra de plantão com uma escala que acabou de sumir | sim | `script` — cenário 8, com rodada de controle |
| **Volume alto:** fila grande no momento do login | A distribuição roda solta e com `catch` próprio; falha nela não derruba o login | sim | `leitura` + `HTTP` (medição do tempo de login) |
| **Força bruta no login** | Dois baldes em memória (origem+e-mail: 10; conta: 20) por 15 min. Quem acerta a senha e é recusado por escala tem o balde perdoado | sim | `HTTP` (red team tentou furar; a contagem por conta não depende de header do cliente) |

---

## J8 — O atendente encerra e sai do plantão

| Cenário | O que o sistema faz hoje | Verificado | Como |
|---|---|---|---|
| Botão "encerrar plantão" | Fecha a sessão e solta as conversas na **mesma transação**, depois reoferece para quem continua de plantão | sim | `HTTP` + `script` |
| **A conversa devolvida** | Volta para `open` na fila do ramal; `first_assigned_at` é preservado | sim | `script` (cenário 9). O caso **F3** completo não foi executado |
| **Timeout do turno:** ninguém clica em nada | O job de 60 s encerra o plantão vencido. Ele varre **todos os hospitais** do banco, um por um | sim | `script` — cenário 10 roda a varredura de verdade |
| **Concorrência:** o job varre a sessão vencida no mesmo instante do clique em "encerrar plantão" | Nenhum dos dois lados leva deadlock (`40P01`). Todo caminho que encerra plantão trava a linha do usuário **primeiro** | sim | `script` — cenário 10, com o `console.error` espionado para pegar o deadlock que o job engole em silêncio |
| **Concorrência:** o admin estica a escala enquanto o job encerra | O `count` do fechamento decide; se a escala foi esticada, nada é solto | sim | `leitura` + `banco` (experimentos de lock do red team: 869 ms e 874 ms de espera medidos) |
| **Erro:** falha ao reoferecer | Não derruba o encerramento. A conversa já está `open`, à vista de todos | sim | `leitura` |
| Admin **desativa** o atendente ou tira ele de um setor | Solta as conversas dele. A reoferta por estes dois caminhos foi adicionada depois; conferir se está ativa é dívida | parcial | `leitura`. Registrado como pendência adiada |

---

## J9 — O admin cria, revoga e administra links

| Cenário | O que o sistema faz hoje | Verificado | Como |
|---|---|---|---|
| Criar link com 2+ setores | Gera `slug` (8 chars) e `entry_code` (4 chars, sem 0/O/1/I), monta o `prefill_text` | sim | `navegador` + `HTTP` |
| **Entrada inválida:** lista de setores vazia | Bloqueado na criação | sim | `leitura` + `manual (build)` |
| **Permissão:** `departmentIds` de outro hospital no corpo | 400 "a lista tem setor inexistente ou de outro hospital" | sim | `HTTP` — red team |
| `GET /c/:slug` | 302 para `wa.me`, incrementando `use_count` | sim | `HTTP` (curl do `TASKS.md`) |
| **Link revogado:** `/c/:slug` | 404 com página de aviso | sim | `HTTP` |
| **Revogar** | `active=false`, `revoked_at`, `revoked_by_user_id`, **e** encerra a conversa viva de cada contato vinculado, com `access_revoked` e sem CSAT | sim | `leitura` (`routes/admin.ts:510-536`) + `manual (build)` |
| Revogar link já revogado | 409, não 404 — o link está na tela | sim | `HTTP` |
| QR de link revogado | 409 — o papel impresso levaria a "Link indisponível" | sim | `leitura` |
| **Volume alto:** revogar link de perfil com muitos contatos | Duas queries por contato, dentro da requisição. Sem paginação | sim | `leitura`. Registrado como pendência adiada |
| **Sem rate limit em `/c/:slug`** | A rota é pública e incrementa `use_count` a cada acesso. Um robô de indexação infla o contador | sim | `leitura` (`app.ts` — só `/auth/login` tem limite). **Impacto nunca medido** |

---

## J10 — O admin bloqueia contato, reatribui link, edita escala

| Cenário | O que o sistema faz hoje | Verificado | Como |
|---|---|---|---|
| Bloquear contato | Marca `blocked` e encerra a conversa viva com `access_revoked`, sem CSAT | sim | `script` (cenário 6) + `navegador` |
| **Reatribuir** o contato a outro link | Vale na hora. Se a conversa em curso está num setor que o link novo não permite, ela é encerrada com `access_revoked` | sim | `leitura` (`lifecycle.service.ts:116-131`) |
| Reatribuir para link nominal já ocupado | 400, com a mesma trava de linha que o webhook usa — os dois caminhos disputam a posse | sim | `leitura` (`routes/admin.ts:606-614`) |
| Reatribuir para link revogado | 400 "reatribuir cortaria o acesso do contato" | sim | `leitura` |
| **Permissão:** contato ou link de outro hospital | 404 | sim | `HTTP` — red team |
| Editar a escala de um atendente | `replaceSchedule` troca a escala e reavalia o plantão em curso numa operação só | sim | `script` (cenário 8) |
| Encurtar a escala de quem está de plantão | Tira o acesso, mas **as conversas dele só voltam para a fila quando o job de 60 s roda** | sim | `leitura`. Registrado como pendência adiada |
| **Desativar um setor** | Some do menu de todos os links automaticamente **e** encerra as conversas vivas nele com `access_revoked` | sim | `leitura` (`lifecycle.service.ts:139-155`) |
| Desativar setor com mais de 1000 conversas vivas | O laço tem teto de 1000. Acima disso, sobram conversas vivas num setor desativado | sim | `leitura` (`MAX_CONVERSAS_VIVAS`). **Nunca exercitado** |
| **Setor desativado continua recebendo do rodízio** | `availableAgentsForDepartment` e `listOpenForDepartments` não olham `department.active` | sim | `leitura` — pendência adiada, severidade média |

---

## J11 — O gestor lê as métricas

| Cenário | O que o sistema faz hoje | Verificado | Como |
|---|---|---|---|
| Volume, FRT, tempo de atribuição, tempo de resolução | Calculados sobre as conversas criadas na janela | sim | `HTTP` + `navegador` |
| **Fuso horário:** filtro por data | A janela é montada no fuso do **tenant**. `from`/`to` aceitam `AAAA-MM-DD`; o sufixo de hora que o painel mandava é descartado | sim | `leitura` (`routes/admin.ts:657-682`). Antes disso, com o Node em UTC, três horas de todo dia caíam no relatório do dia seguinte |
| **Isolamento:** métricas de outro hospital | `department_id` de outro hospital devolve 200 com volume 0 e agregados nulos — não vaza nada | sim | `HTTP` — red team |
| Tentativas negadas por motivo | Só aparecem sem filtro de setor: `access_attempts` não tem `department_id`. O campo `attemptsScope` explica | sim | `leitura` |
| **%SLA** | Denominador = conversas com resposta **ou** já encerradas. Conversa encerrada sem nenhuma resposta conta como violação | sim | `leitura` + `banco`. **Está registrado como pendência:** o denominador inclui conversa que nunca chegou a escolher setor, e o card mostrou 0% num dia em que 17 conversas foram encerradas antes de qualquer setor |
| **Taxa de resposta do CSAT** | Numerador e denominador saem de conjuntos **diferentes**: o numerador conta qualquer conversa com nota; o denominador exige `first_reply_at` não nulo. Mas o sistema pergunta a nota quando `first_assigned_at` não é nulo — que não é a mesma coisa | não | `leitura` minha, ao escrever este documento (`lifecycle.service.ts:53-55` × `metrics.service.ts:52-59`). A auditoria descartou a hipótese de taxa acima de 100% para dados novos, mas a justificativa dela cita `first_reply_at` como condição de perguntar — condição que o código atual **não** exige. **Não reproduzi contra o banco.** É candidato a achado novo |
| Desligar o CSAT no hospital | A taxa de resposta some da tela para períodos passados cheios de notas, porque o denominador lê o flag no presente | sim | `leitura` — pendência adiada |
| **Volume alto:** período longo | `listForMetrics` traz as linhas do período para a memória e agrega em JavaScript. Sem paginação e sem teto | sim | `leitura`. **Nunca medido com volume alto** |

---

## J12 — Ramal interno (setor falando com setor)

| Cenário | O que o sistema faz hoje | Verificado | Como |
|---|---|---|---|
| Abrir conversa entre dois setores | Quem enxerga é quem está no setor de **origem ou destino** — o assunto é do ramal, não da pessoa | sim | `navegador` |
| A mensagem guarda o **lado**, não quem escreveu | A colega do mesmo setor lê a conversa do mesmo jeito; quem entra no plantão continua de onde pararam | sim | `leitura` + `navegador` |
| **Permissão:** setor que a pessoa não atende | 400 "você não atende este setor" | sim | `HTTP` — red team |
| **Isolamento:** thread de outro hospital | 404 | sim | `HTTP` — red team |
| Rascunho perdido no fim de plantão | O rascunho da conversa externa é salvo; **o do ramal interno não** | sim | `navegador` — pendência adiada |

---

## Cenários transversais

| Cenário | O que o sistema faz hoje | Verificado | Como |
|---|---|---|---|
| **O webhook sempre responde 200** | Dois níveis: `try/catch` no handler e um error handler do próprio router, que pega até o `PayloadTooLargeError` do body-parser | parcial | `HTTP` — quatro dos cinco casos rodados à mão. O quinto (serviço lançando exceção de dentro) **não foi testado** |
| **Assinatura do Twilio inválida** | 403 — intencionalmente não 200. Recusar quem não é o Twilio não é falha nossa | sim | `leitura`. O caso **D5** não foi executado |
| Validação de assinatura desligada | O boot recusa subir com `WHATSAPP_PROVIDER=twilio` e a validação desligada | sim | `leitura` + `HTTP` — red team tentou furar os três portões de boot e não conseguiu |
| **`/health`** | Faz `SELECT 1`; devolve 503 se o banco está fora. É o que faz o Render agir em vez de deixar o painel verde com o banco caído | sim | `HTTP` |
| **CORS** | Origem estrangeira não é refletida; a API usa Bearer, não cookie | sim | `HTTP` — red team |
| **Simulador** (`/admin/simulador`) | Passa pelo **mesmo** `handleInbound` do webhook, atrás de `requireAuth + requireRole('admin')`. Não é atalho anônimo | sim | `leitura` + `HTTP` |
| **Migrations num banco sujo** | Aplicaram num banco montado de propósito com três conversas ativas do mesmo contato e empate de `created_at` | sim | `banco` — o backfill fechou as sobrando e o índice nasceu |
| **Volume alto no webhook** | Não há limite de taxa no webhook. Correto (limitar faria o Twilio reentregar), mas nada protege o processo de um pico | sim | `leitura` + `HTTP`. **Nunca medido sob carga** |
| **Duas instâncias da API ao mesmo tempo** (janela de deploy) | O `keyedQueue` serializa só dentro de um processo; quem garante entre instâncias são as travas do banco e o índice único parcial | sim | `HTTP` — o red team exercitou contra duas instâncias |
| **Exaustão do pool do Prisma** | 60 transações concorrentes: 0 rejeitadas, 637 ms, 33 conexões | sim | `banco` |

---

## O que NÃO foi verificado — lista fechada

Isto não é o resumo dos "parcial" acima. É a lista do que ninguém executou nem
leu com atenção suficiente para afirmar qualquer coisa.

**Nunca exercitado por ninguém:**

1. O provedor de WhatsApp **de verdade**. Toda a auditoria rodou com o
   `MockProvider`. Nenhuma mensagem saiu para um telefone.
2. **Provedor fora do ar.** Nenhum dos caminhos de envio foi testado com o
   provedor falhando: recusa de acesso, pergunta de nota, aviso de
   encaminhamento e resposta do atendente. Em todos eles o envio acontece
   **antes** da persistência, e não há retentativa.
3. **Reentrega real do Twilio.** O dedupe foi lido, não exercitado com o
   provedor reentregando de verdade.
4. **Virada de horário de verão** no fuso do hospital (caso E13). Nenhum teste
   de fuso foi executado — nem os 14 casos do grupo E, que são puros e rodariam
   em milissegundos.
5. **Volume alto de verdade.** Nenhum teste de carga: nem no webhook, nem no
   `/admin/metrics` com período longo, nem no `/c/:slug` público.
6. **Mais de 1000 conversas vivas** num setor sendo desativado.
7. **Um hospital com fuso diferente do outro** operando ao mesmo tempo.
8. **Recuperação de desastre:** restaurar backup, subir com o banco a meio
   caminho de uma migration, reiniciar o processo com mensagens em voo.
9. **A taxa de resposta do CSAT acima de 100%** — identifiquei a divergência de
   critério por leitura e **não** consegui confirmá-la contra o banco.
10. **Nenhum dos 50 casos da suíte especificada** na parte 2. Nem um.

**Verificado só por leitura, sem nenhuma execução:** todo o grupo de parsing do
menu (emoji, largura total, pontuação), toda a máquina de retentativas do MENU,
toda a janela de comentário do CSAT, e o comportamento com lista de setores
vazia.

**Fora do alcance desta auditoria por completo:** acessibilidade além do que o
red team de front olhou; desempenho da interface; comportamento em telas
pequenas de verdade (só emulação); e qualquer coisa relacionada a dados de
saúde — o produto não guarda anexo, mas guarda o texto livre que a pessoa
escreve, e ninguém avaliou isso.

---

# PARTE 2 — Testes: o que existe e o que falta

---

## 2.1 O que dá para executar hoje

Duas coisas, as duas de concorrência, as duas contra o banco de desenvolvimento.

### `apps/api/scripts/check-corridas.ts`

```bash
npm run check:corridas -w api
```

Dez cenários, seis rodadas cada. Sai com código 1 se algum falhar. (O commit
`ff92f62` trouxe nove; o décimo — o deadlock do fim de plantão — entrou depois.
Contei os dez `registrar()` do arquivo hoje.)

| # | Cenário | O que a asserção garante |
|---|---|---|
| 1 | Encerramento duplo: botão do atendente × job de inatividade | **Exatamente uma** pergunta de nota — nem duas, nem zero |
| 2 | Encaminhar × job de inatividade | A conversa não vai para o setor novo já morta |
| 3 | Dois atendentes encaminhando a mesma conversa | Exatamente um aviso ao externo |
| 4 | Escolha do setor no menu × job de inatividade | A conversa não ressuscita com `closed_at` gravado |
| 5 | Dois números novos no mesmo link nominal | Um dono e um alerta `nominal_taken` |
| 6 | Bloquear o contato com a mensagem dele em voo | Nenhuma conversa ativa de contato bloqueado sobra |
| 7 | Login pelo celular e pelo computador ao mesmo tempo | Uma sessão de plantão só |
| 8 | Admin salvando a escala no instante do login | Ninguém entra de plantão sem escala. **Tem rodada de controle** |
| 9 | Rodízio × fim de plantão | A conversa não fica com quem já saiu. **Tem rodada de controle** |
| 10 | Job de plantão × "encerrar plantão" | Nenhum deadlock `40P01` dos dois lados (o do job é capturado espionando o `console.error`) |

Três coisas que quem for rodar precisa saber:

- **Cria dados no banco local.** Contatos, links e conversas de teste. Limpa no
  fim, inclusive quando estoura no meio.
- **Mexe na escala, na disponibilidade e nos plantões** de `agente1` e
  `agente2`, e devolve tudo num `finally`. Sem isso, o script imprimia PASSOU
  tendo deixado um atendente sem escala nenhuma — e o próximo login dele levava
  403 sem que ninguém desconfiasse do script.
- **O cenário 10 encerra sessões vencidas de todos os hospitais do banco.** É o
  que o job do servidor faz a cada 60 s, mas convém saber antes de rodar.

**Não rode contra produção.**

### `apps/api/scripts/check-distribuicao-concorrente.ts`

```bash
npm run check:distribuicao -w api
```

Seis rodadas. Duas pessoas de fora escrevem ao mesmo tempo para o mesmo setor,
com dois atendentes de plantão; a asserção exige donos **distintos** e nenhuma
conversa sem dono. Mexe na escala de `agente1` e `agente3` e restaura no fim.

A auditoria registrou que a asserção original era fraca (uma conversa sem dono
nenhum passava como sucesso) e ela foi apertada — hoje `semDono === 0` faz parte
da condição.

### O que existe e **não** é teste

| Arquivo | O que é |
|---|---|
| `scripts/force-timeout.ts` | Envelhece as conversas de um tenant em 31 min, para forçar o job. Exige o `tenantId` no argumento |
| `scripts/check-timeout.ts` | Diagnóstico. **Consulta sem `tenantId`** — contraria a regra do `CLAUDE.md`, e deveria ser corrigido antes de virar código de verdade |
| `scripts/inspect-db.ts` | Diagnóstico |
| `scripts/test-provider.ts` | Chama `sendText` no mock. É o teste manual da T1.1 |
| `scripts/seed-if-empty.ts` | Semeadura de demonstração; só roda com `ALLOW_DEMO_SEED=true` e banco vazio |
| Os 9 curls do `TASKS.md` | O roteiro manual de aceite. Cobrem entrada, menu, nominal e login |
| `/admin/simulador` | Interface que encena o lado de fora passando pelo **mesmo** `handleInbound` do webhook. É o jeito mais rápido de exercitar uma jornada inteira à mão |

### Checagem de tipos

```bash
npm run typecheck
```

Roda `tsc --noEmit` no backend (incluindo `scripts/` e `prisma/seed.ts`, via
`tsconfig.scripts.json`) e no frontend. Rodei os dois ao escrever este
documento: **exit 0** nos dois.

Isso não é teste. Prova que o código compila, não que ele faz a coisa certa.

---

## 2.2 O que não existe

Confirmei cada linha abaixo antes de escrever, com `ls`, `find` e leitura dos
quatro `package.json`:

| Falta | Confirmação |
|---|---|
| **Runner de teste** | Nenhum `jest`, `vitest`, `mocha` ou `node:test` nas dependências dos quatro pacotes |
| **Qualquer arquivo de teste** | `find apps packages -name "*.test.ts" -o -name "*.spec.ts"` → nada. A pasta `apps/api/test/` não existe |
| **Linter** | Nenhum `.eslintrc`, `eslint.config.*`, `biome.json` ou `.prettierrc` em lugar nenhum. `apps/web` não tem `next lint` |
| **CI** | A pasta `.github/` não existe. Nada roda sozinho em nenhum push |
| **Banco de teste** | Uma `DATABASE_URL` só. Os dois `check-*` rodam no banco de desenvolvimento — e isso já causou perda de dados real durante esta auditoria |

A consequência prática: **hoje, a única coisa que impede uma regressão de chegar
em `main` é alguém lembrar de rodar dois scripts.** Não há portão automático
nenhum. `npm run build` passa, `npm run typecheck` passa, e nada além disso é
verificado por máquina.

---

## 2.3 A suíte especificada — 50 casos em 6 grupos

A onda 1 produziu uma especificação pronta para implementação. Está reproduzida
aqui inteira porque é o que alguém vai executar depois, e vasculhar JSON de
auditoria para achá-la é fricção que não precisa existir.

**Runner recomendado: `node:test` + `tsx`.** Motivos, nesta ordem: `tsx` já é
dependência de `apps/api` (zero dependência nova numa árvore em que
`npm audit` ainda reporta 6 vulnerabilidades altas — número que conferi ao
escrever este documento); o Node é 22, fixado no `render.yaml`; a maior
parte do valor está em teste de **integração** contra o Postgres, onde o runner
quase não importa; e o principal diferencial do vitest (mock de módulo, jsdom)
não tem uso aqui — o projeto é CommonJS e a troca de provedor já é resolvida por
`WHATSAPP_PROVIDER=mock`.

```json
"test": "node --import tsx --test --test-concurrency=1 test/**/*.test.ts"
```

**Pré-requisito, e nada deve ser escrito antes dele:** banco
`central_ramais_test` no mesmo contêiner, `.env.test`, `config.ts` lendo
`process.env.ENV_FILE ?? '.env'`, e um guard em `test/setup.ts` que **recusa
rodar** se o nome do banco não terminar em `_test`. É a peça que teria evitado a
perda de dados desta sessão. Isolamento por
`TRUNCATE ... RESTART IDENTITY CASCADE` num `beforeEach`, mais fixtures. Serial,
porque o banco é compartilhado. Transação-com-rollback **não** serve: os
serviços usam o singleton exportado por `src/prisma.ts`, não um client injetado.

### Grupo A — isolamento entre hospitais (8 casos)

`test/cross-tenant.test.ts`. Fixture: hospital A e hospital B, cada um com
admin, atendente, setor, link e uma conversa.

| # | Caso | Asserção |
|---|---|---|
| A1 | `GET` mensagens de conversa de outro hospital | 404; corpo sem nenhum campo da conversa |
| A2 | `close` de outro hospital | 404 (nunca 403) **e** reler: status inalterado, `closed_at` nulo, `close_reason` nulo. A segunda metade é essencial — um handler que fechasse e só depois respondesse 404 passaria sem ela |
| A3 | Enviar mensagem em conversa de outro hospital | 404; contagem de mensagens inalterada; provedor com **zero** chamadas |
| A4 | `transfer` cruzado, nos dois sentidos | 404; `department_id` inalterado |
| A5 | `PATCH /admin/departments/:id` com token do outro admin | 404; nome do setor inalterado no banco |
| A6 | `GET /admin/entry-links/:id/contacts` cruzado | 404 |
| A7 | Métricas não vazam | 3 conversas em A, 5 em B: volume === 3; `byLink` só com links de A; `byDepartment` só com setores de A |
| A8 | Código de link do hospital B usado contra o número do hospital A | Nenhum contato criado; **1** `access_attempt` em A com `invalid_code`; **zero** em B |

### Grupo B — escopo do entry link (11 casos)

`test/entry-link-scope.test.ts`. Fixture: 5 setores ativos (Recepção 10,
Cardiologia 20, Enfermagem 30, Fisioterapia 40, Faturamento 50); link MEDX →
[Recepção, Cardiologia, Enfermagem]; link F4BX → [Enfermagem].

| # | Caso | Asserção |
|---|---|---|
| B1 | Menu inicial | Exatamente 3 opções, na ordem de `sort_order`; **não** contém Fisioterapia nem Faturamento |
| B2 | Escolha fora da lista, com o setor existindo no hospital | `department_id` continua nulo; `menu_retries === 1`; menu reenviado; nada atribuído à Fisioterapia |
| B3 | O índice é posicional **dentro do link**, não o `menu_key` global | Link → [Enfermagem(30), Recepção(10)]; digitar "1" cai na Recepção |
| B4 | MENU → SIM remonta o menu do link | Conversa anterior com `user_switched`; nova em `awaiting_department`; menu com os 3 setores do MEDX |
| B5 | Link de 1 setor pula o menu | Status `open` ou `assigned`; setor Enfermagem; **nenhuma** mensagem de menu enviada |
| B6 | MENU em link de 1 setor | Continua `assigned`; `closed_at` nulo; resposta informa que não há outro setor |
| B7 | Setor desativado some do menu sem editar o link | Menu com 2 opções; "3" passa a ser inválido |
| B8 | `transfer-targets` | Conjunto === setores ativos do link; sem Fisioterapia nem Faturamento |
| B9 | `transfer` para setor fora do link | 404; setor inalterado; nenhuma mensagem `system` criada; provedor com zero chamadas |
| B10 | Link revogado encerra e avisa | `access_revoked`; aviso enviado; **nenhuma** pergunta de nota |
| B11 | 4ª escolha inválida | Cai no primeiro setor **do link** por `sort_order` (Recepção), nunca no primeiro do hospital |

### Grupo C — write-once dos timestamps (6 casos)

`test/timestamps.test.ts`.

| # | Caso | Asserção |
|---|---|---|
| C1 | `first_reply_at` só na primeira do atendente | Igual ao instante da 1ª (tolerância 2 s), idêntico depois da 2ª e da 3ª |
| C2 | `system` e `customer` não gravam `first_reply_at` | Continua nulo |
| C3 | `first_assigned_at` sobrevive à devolução para a fila | Atribuída em T0, plantão encerrado, reatribuída em T0+10min: `first_assigned_at === T0`, `assigned_at === T0+10min`. É o que separa "quanto o externo esperou" de "quando trocou de dono" |
| C4 | `first_reply_at` nunca depois de `closed_at` | 400 "encerrada enquanto você escrevia"; `first_reply_at` continua nulo; provedor com zero chamadas |
| C5 | `closed_at` write-once | Encerrar duas vezes em sequência: `closed_at` não muda, `close_reason` continua `agent_closed`, **uma** pergunta de nota |
| C6 | `last_message_at` avança em inbound, outbound e system | Estritamente crescente nos três |

### Grupo D — idempotência do webhook (7 casos)

`test/webhook-idempotencia.test.ts`.

| # | Caso | Asserção |
|---|---|---|
| D1 | Mesmo `MessageSid` duas vezes | 1 mensagem; segunda resposta 200; nenhuma segunda conversa |
| D2 | Reentrega da mensagem que criou a conversa | Exatamente 1 conversa ativa para o contato |
| D3 | Reentrega de uma **recusa** | `access_attempts === 1`. Caminho coberto só pelo dedupe em memória — não há mensagem no banco para consultar |
| D3b | Reentrega **depois de reiniciar o processo** | `access_attempts === 2`. Fixa a limitação já assumida em `seenMessageIds.ts`, para que ninguém a "conserte" sem querer nem regrida além dela |
| D4 | Sempre 200 | Cinco casos: `To` desconhecido, sem `From`, corpo malformado, corpo acima do limite, e o serviço lançando exceção. Os quatro primeiros foram rodados à mão nesta auditoria; **o quinto nunca** |
| D5 | Assinatura inválida com validação ligada | 403 (intencionalmente não 200); 0 mensagens; 0 `access_attempts` |
| D6 | Dois inbounds **sem** `MessageSid` não colidem | 2 mensagens criadas. Protege o UNIQUE com NULL: hoje funciona porque o Postgres permite vários NULL; se alguém trocar `null` por string vazia, o segundo inbound passa a ser engolido em silêncio |

### Grupo E — matemática do plantão (14 casos, puros, sem banco)

`test/shift-clock.test.ts`. Rodam em milissegundos e cobrem a regra mais sutil
do Sprint 2. **É por onde começar.**

| # | Caso | Esperado |
|---|---|---|
| E1 | Faixa diurna simples `{seg, 480, 1080}`, agora seg 09:00 | 540 |
| E2 | Fora da faixa | `null` |
| E3 | Vira o dia `{seg, 1140, 420}` | seg 23:00 → 480; ter 06:00 → 60; ter 08:00 → `null` |
| E4 | Faixas encostadas se fundem `{07–13}` + `{13–19}`, agora 12:00 | 420, não 60 |
| E5 | Dobra sobreposta `{07–13}` + `{12–19}`, agora 12:30 | 390 |
| E6 | Escala 24/7 | Não entra em laço infinito; no máximo 7×1440 |
| E7 | Virada de domingo `{sáb, 1320, 120}`, agora dom 00:30 | 90 |
| E8 | `startMinute === endMinute` | Faixa vazia, ignorada |
| E9 | `describeNextWindow` só com sábado 07:00, agora sábado 20:00 | "sábado, 07:00" (a da semana seguinte, não `null`) |
| E10 | `describeNextWindow` mais tarde hoje / amanhã | "hoje, HH:MM" / "amanhã, HH:MM" |
| E11 | `localNow` respeita o fuso | Mesmo instante UTC: `America/Sao_Paulo` × `UTC` dão weekday/minuto diferentes |
| E12 | Fuso inválido | Cai para UTC sem lançar |
| E13 | **Virada do horário de verão** no fuso do hospital | Nem minuto negativo, nem `NaN` |
| E14 | `shiftEndsAt` | `=== at + minutesLeftInShift`; `null` fora da escala |

### Grupo F — plantão em integração (4 casos)

`test/plantao.test.ts`.

| # | Caso | Asserção |
|---|---|---|
| F1 | Login fora da escala | 403, motivo `off_shift`, próxima janela preenchida |
| F2 | Atendente **sem escala nenhuma** | 403, próxima janela nula, mensagem específica. É o estado em que o `check-corridas` deixava a atendente antes da correção |
| F3 | Fim de plantão devolve as conversas | `assigned_user_id` nulo, status `open`, `first_assigned_at` **preservado** |
| F4 | Rodízio não entrega para quem não está de plantão | Nem com `availability='available'` |

### Ordem de implementação, por valor decrescente

1. `test/setup.ts` com o **guard do nome do banco**. Nada mais antes disso.
2. Grupo **E** — puro, 14 casos, feedback instantâneo, cobre a regra mais sutil.
3. Grupo **A** — a regra que o `CLAUDE.md` chama de inegociável.
4. Grupo **B** — a segunda regra inegociável.
5. Grupos **C** e **D**.
6. Grupo **F**.
7. Migrar os dois `check-*` para `test/` como suíte de concorrência.
8. **Só então** o workflow de CI.

### Para o frontend, a recomendação é outra

Não vale escrever dezenas de testes de componente. Quatro ou cinco fluxos ponta
a ponta com Playwright valem mais: login, responder e encerrar, criar link com
setores, revogar link. O dono já usa Playwright em outro projeto.

---

## 2.4 Limites desta especificação

Três avisos que vieram junto com ela e que continuam valendo:

1. **A especificação assume que o comportamento atual está certo** onde o
   auditor verificou. Se um caso do grupo B ou C falhar na primeira execução,
   é achado de código novo, **não** erro do teste. Conferir contra o
   `PROJETO.md` antes de "consertar" o teste.
2. **Nenhum dos 50 casos foi executado.** A especificação foi escrita a partir
   de leitura de código. Ela é uma boa hipótese sobre o que testar, não uma
   suíte que já passou.
3. **A suíte não cobre**: interface, carga, provedor real, provedor fora do ar,
   migrations, recuperação de desastre, nem os 21 achados adiados. Ela cobre as
   duas regras inegociáveis e a matemática do plantão — que é onde o produto
   quebra em silêncio.
