import { Department } from '@prisma/client';

export const MSG_NOT_IDENTIFIED =
  'Não identificamos seu acesso. Solicite um link ao hospital.';

export const MSG_ACCESS_REVOKED = 'Seu acesso foi encerrado. Procure o hospital.';

export const MSG_NO_DEPARTMENTS =
  'Nenhum setor disponível no momento. Tente novamente mais tarde.';

export function buildMenuText(departments: Department[]): string {
  const lines = departments.map((d, i) => `${i + 1} — ${d.name}`);
  return `Olá! Com quem deseja falar?\n${lines.join('\n')}\n\nDigite o número da opção.`;
}

export function buildQueueText(departmentName: string): string {
  return `Você será atendido por *${departmentName}*. Aguarde um momento.`;
}

export function buildTransferText(departmentName: string): string {
  return `Seu atendimento foi encaminhado para *${departmentName}*. Aguarde um momento.`;
}

export function buildMenuConfirmText(departmentName: string): string {
  return (
    `Você está falando com *${departmentName}*. Deseja encerrar e voltar ao menu?\n` +
    'Responda *SIM* ou *NÃO*.'
  );
}

export const MSG_SINGLE_DEPARTMENT_MENU =
  'Seu acesso tem um único setor disponível — você já está falando com ele.';

export const MSG_CSAT_QUESTION =
  'De 0 a 10, como foi o atendimento? (opcional)';
