import * as entryLinks from '../repositories/entryLinks';
import * as externalContacts from '../repositories/externalContacts';
import * as simulatorRepo from '../repositories/simulator';
import * as whatsappNumbers from '../repositories/whatsappNumbers';
import { MSG_ACCESS_REVOKED, MSG_NOT_IDENTIFIED } from './texts';

export interface SimulatorSetup {
  whatsappNumber: string | null;
  links: {
    id: string;
    entryCode: string;
    label: string;
    kind: string;
    prefillText: string;
    departments: string[];
  }[];
}

export async function getSetup(tenantId: string): Promise<SimulatorSetup> {
  const number = await whatsappNumbers.findActiveForTenant(tenantId);
  const links = await entryLinks.list(tenantId);
  return {
    whatsappNumber: number?.phoneNumber ?? null,
    // ordem de criação: os exemplos aparecem na mesma sequência em que o hospital
    // os emitiu, que é a ordem em que fazem sentido numa demonstração
    links: links
      .filter((l) => l.active)
      .slice()
      .reverse()
      .map((l) => ({
        id: l.id,
        entryCode: l.entryCode,
        label: l.label,
        kind: l.kind,
        prefillText: l.prefillText,
        departments: l.departments.map((d) => d.department.name),
      })),
  };
}

export interface TimelineEntry {
  id: string;
  at: Date;
  // do ponto de vista de quem está de fora: 'sent' é o que a pessoa mandou
  side: 'sent' | 'received';
  kind: 'text' | 'automatic' | 'refused';
  body: string;
}

// A recusa não vira mensagem no banco (não há conversa); o texto exibido aqui é
// o mesmo que o serviço de acesso enviou de verdade.
const REFUSAL_TEXT: Record<string, string | null> = {
  no_code: MSG_NOT_IDENTIFIED,
  invalid_code: MSG_NOT_IDENTIFIED,
  nominal_taken: MSG_NOT_IDENTIFIED,
  revoked_link: MSG_ACCESS_REVOKED,
  blocked: null, // contato bloqueado é silêncio total
};

export async function getTimeline(tenantId: string, waNumber: string): Promise<TimelineEntry[]> {
  const contact = await externalContacts.findByWaNumber(tenantId, waNumber);
  const entries: TimelineEntry[] = [];

  if (contact) {
    const messages = await simulatorRepo.listMessagesForContact(tenantId, contact.id);
    for (const m of messages) {
      entries.push({
        id: m.id,
        at: m.createdAt,
        side: m.direction === 'inbound' ? 'sent' : 'received',
        kind: m.senderType === 'system' ? 'automatic' : 'text',
        body: m.body,
      });
    }
  }

  const attempts = await simulatorRepo.listAttemptsForNumber(tenantId, waNumber);
  for (const a of attempts) {
    const text = REFUSAL_TEXT[a.reason];
    if (!text) continue;
    entries.push({
      id: a.id,
      at: a.createdAt,
      side: 'received',
      kind: 'refused',
      body: text,
    });
  }

  return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
}
