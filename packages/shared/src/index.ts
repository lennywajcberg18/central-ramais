export type UserRole = 'admin' | 'agent';

export type Availability = 'available' | 'away' | 'offline';

export type ConversationStatus =
  | 'awaiting_department'
  | 'open'
  | 'assigned'
  | 'awaiting_menu_confirm'
  | 'awaiting_feedback'
  | 'closed';

export type CloseReason =
  | 'agent_closed'
  | 'timeout'
  | 'user_switched'
  | 'access_revoked'
  | 'no_agent_available';

export type EntryLinkKind = 'profile' | 'nominal';

export type AccessAttemptReason =
  | 'no_code'
  | 'invalid_code'
  | 'revoked_link'
  | 'nominal_taken'
  | 'blocked';

export type MessageDirection = 'inbound' | 'outbound';

export type SenderType = 'customer' | 'agent' | 'system';

// Estados que contam como "conversa ativa" — bloqueiam abrir outra
export const ACTIVE_STATUSES: ConversationStatus[] = [
  'awaiting_department',
  'open',
  'assigned',
  'awaiting_menu_confirm',
];

export interface AuthUserDTO {
  id: string;
  tenantId: string;
  role: UserRole;
  name: string;
  email: string;
  availability: Availability;
}

// Plantão: a escala cadastrada e a sessão que está acontecendo.
export type ShiftEndReason = 'manual' | 'schedule' | 'admin';

export interface ShiftDTO {
  id: string;
  userId: string;
  weekday: number; // 0=domingo … 6=sábado
  startMinute: number; // minutos desde 00:00, no fuso do hospital
  endMinute: number; // menor que startMinute = plantão que vira o dia
}

export interface ShiftSessionDTO {
  startedAt: string;
  endsAt: string;
}

export interface LoginResponseDTO {
  token: string;
  user: AuthUserDTO;
  shift: ShiftSessionDTO | null;
}

export interface MessageDTO {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  senderType: SenderType;
  body: string;
  createdAt: string;
}

export interface ConversationListItemDTO {
  id: string;
  status: ConversationStatus;
  departmentName: string | null;
  entryLinkLabelSnapshot: string;
  contactNumber: string;
  assignedUserId: string | null;
  lastMessageAt: string;
  createdAt: string;
  unread?: boolean;
}
