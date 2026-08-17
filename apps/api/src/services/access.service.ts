import { EntryLink, ExternalContact } from '@prisma/client';
import * as accessAttempts from '../repositories/accessAttempts';
import * as entryLinks from '../repositories/entryLinks';
import * as externalContacts from '../repositories/externalContacts';
import { runSerialized } from '../utils/keyedQueue';
import { extractEntryCode } from '../utils/text';

// Quem disputa a posse de um link nominal — o webhook e o painel do admin —
// entra nesta fila. Chave por link, não por contato: são justamente contatos
// diferentes que corriam um contra o outro.
export function claimKey(tenantId: string, entryLinkId: string): string {
  return `claim:${tenantId}:${entryLinkId}`;
}

// Tabela de decisão do webhook (PROJETO.md), implementada linha por linha.
export type AccessResult =
  // contato autorizado — segue para o fluxo de conversa
  | { outcome: 'authorized'; contact: ExternalContact; link: EntryLink }
  // contato conhecido com link revogado — avisa e encerra conversa aberta
  | { outcome: 'revoked'; contact: ExternalContact }
  // contato bloqueado — silêncio total
  | { outcome: 'blocked' }
  // não identificado (sem código, código inválido, nominal já usado…)
  | { outcome: 'denied' };

export async function resolveAccess(
  tenantId: string,
  waNumber: string,
  body: string
): Promise<AccessResult> {
  const contact = await externalContacts.findByWaNumber(tenantId, waNumber);

  if (contact) {
    if (contact.blocked) {
      await accessAttempts.create(tenantId, { waNumber, reason: 'blocked' });
      return { outcome: 'blocked' };
    }

    const link = await entryLinks.findById(tenantId, contact.entryLinkId);
    if (!link || !link.active) {
      await accessAttempts.create(tenantId, { waNumber, reason: 'revoked_link' });
      return { outcome: 'revoked', contact };
    }

    // O vínculo é a fonte de verdade — o código nem precisa aparecer na mensagem.
    return { outcome: 'authorized', contact, link };
  }

  // Número novo: só entra com código válido.
  const code = extractEntryCode(body);
  if (!code) {
    await accessAttempts.create(tenantId, { waNumber, reason: 'no_code' });
    return { outcome: 'denied' };
  }

  // Código de outro tenant não é encontrado aqui — tratado como inválido.
  const link = await entryLinks.findByCode(tenantId, code);
  if (!link) {
    await accessAttempts.create(tenantId, { waNumber, entryCodeTried: code, reason: 'invalid_code' });
    return { outcome: 'denied' };
  }

  if (!link.active) {
    await accessAttempts.create(tenantId, { waNumber, entryCodeTried: code, reason: 'revoked_link' });
    return { outcome: 'denied' };
  }

  if (link.kind === 'nominal') {
    // A reivindicação do link nominal é serializada POR LINK. A fila do webhook é
    // por CONTATO, e dois números novos são contatos diferentes: os dois liam
    // "link livre" e os dois criavam vínculo. Depois disso o vínculo é a fonte de
    // verdade (regra 8) e o número que entrou de carona fica autorizado para
    // sempre, sem nenhum `nominal_taken` para o admin ver (regra 9).
    return runSerialized(claimKey(tenantId, link.id), async () => {
      // relê DENTRO da fila: enquanto esperávamos a vez, outro número pode ter
      // reivindicado este link
      const taken = await externalContacts.existsForLink(tenantId, link.id);
      if (taken) {
        // Segundo número num link nominal: recusa e alerta — é assim que o admin
        // descobre que o link vazou.
        await accessAttempts.create(tenantId, { waNumber, entryCodeTried: code, reason: 'nominal_taken' });
        return { outcome: 'denied' };
      }
      const claimed = await externalContacts.create(tenantId, { waNumber, entryLinkId: link.id });
      return { outcome: 'authorized', contact: claimed, link };
    });
  }

  const created = await externalContacts.create(tenantId, { waNumber, entryLinkId: link.id });
  return { outcome: 'authorized', contact: created, link };
}
