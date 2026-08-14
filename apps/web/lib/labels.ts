// Um único lugar traduz o vocabulário do banco para o que o hospital entende.
// Status cru em inglês na tela é bug de produto, não detalhe estético.

export const CONVERSATION_STATUS: Record<string, { label: string; tone: Tone }> = {
  awaiting_department: { label: 'Escolhendo o setor', tone: 'neutral' },
  open: { label: 'Esperando atendente', tone: 'warning' },
  assigned: { label: 'Em atendimento', tone: 'success' },
  awaiting_menu_confirm: { label: 'Confirmando troca de setor', tone: 'neutral' },
  awaiting_feedback: { label: 'Aguardando avaliação', tone: 'neutral' },
  closed: { label: 'Encerrada', tone: 'muted' },
};

export const AVAILABILITY: Record<string, { label: string; tone: Tone }> = {
  available: { label: 'Disponível', tone: 'success' },
  away: { label: 'Ausente', tone: 'warning' },
  offline: { label: 'Fora do ar', tone: 'muted' },
};

export const ATTEMPT_REASON: Record<string, { label: string; explain: string; tone: Tone }> = {
  no_code: {
    label: 'Sem link de acesso',
    explain: 'Alguém escreveu para o hospital sem ter recebido um link.',
    tone: 'muted',
  },
  invalid_code: {
    label: 'Código que não existe',
    explain: 'O código da mensagem não corresponde a nenhum link deste hospital.',
    tone: 'warning',
  },
  revoked_link: {
    label: 'Link já encerrado',
    explain: 'O acesso dessa pessoa foi revogado e ela tentou usar de novo.',
    tone: 'warning',
  },
  nominal_taken: {
    label: 'Link pessoal repassado',
    explain: 'Um segundo número tentou usar um link que é de uma pessoa só. Sinal de vazamento.',
    tone: 'danger',
  },
  blocked: {
    label: 'Número bloqueado',
    explain: 'Um contato bloqueado tentou escrever. O sistema não respondeu nada.',
    tone: 'danger',
  },
};

export const LINK_KIND: Record<string, { label: string; explain: string }> = {
  profile: {
    label: 'Perfil',
    explain: 'Vale para várias pessoas do mesmo tipo — “Médico Externo”, “Convênio”.',
  },
  nominal: {
    label: 'Pessoal',
    explain: 'Vale para um número só. O segundo que tentar usar é recusado e vira alerta.',
  },
};

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'muted';

export const CLOSE_REASON: Record<string, string> = {
  agent_closed: 'Encerrada pelo atendente',
  timeout: 'Encerrada por inatividade',
  user_switched: 'A pessoa trocou de setor',
  access_revoked: 'Acesso revogado',
  no_agent_available: 'Sem atendente disponível',
};

// "há 3 min", "ontem" — data absoluta em lista de conversa é ruído.
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

// +5521998887766 → +55 21 99888-7766
export function formatPhone(raw: string): string {
  const m = raw.match(/^\+(\d{2})(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+${m[1]} ${m[2]} ${m[3]}-${m[4]}` : raw;
}
