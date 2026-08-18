-- Marca contatos que existem só para demonstração.
--
-- O simulador (`/admin/simulator`) encena o lado de fora: o admin digita um
-- número qualquer e o sistema responde como responderia a uma pessoa real. Com o
-- provider `mock` isso é inofensivo, porque nada sai da máquina.
--
-- Com a Twilio ligada, cada resposta que o sistema gera — menu, confirmação,
-- pergunta de nota — vira WhatsApp DE VERDADE para o número que a pessoa digitou.
-- Um número inventado pode ser de alguém, e esse alguém receberia mensagem de um
-- hospital. Pior: se o simulador criar uma conversa, o atendente respondendo pelo
-- painel também envia — então não bastava travar o simulador.
--
-- Por isso a marca vive no CONTATO e não na requisição: ela sobrevive à conversa,
-- ao encaminhamento, ao encerramento e à pergunta de satisfação que vem depois.
ALTER TABLE "external_contacts"
  ADD COLUMN "simulated" BOOLEAN NOT NULL DEFAULT false;

-- Consultado a cada envio, para decidir se a mensagem sai de verdade.
CREATE INDEX "external_contacts_simulated_idx"
  ON "external_contacts" ("tenant_id", "wa_number", "simulated");
