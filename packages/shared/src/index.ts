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

export interface LoginResponseDTO {
  token: string;
  user: AuthUserDTO;
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
