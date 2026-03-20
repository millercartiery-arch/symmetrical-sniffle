// Chat 类型定义

export type ChatMessage = {
  id: number;
  peer_phone: string;
  direction: "inbound" | "outbound";
  content: string;
  status: string;
  created_at: string;
};

export type ChatItem = {
  id: string;
  name: string;
  phone: string;
  avatar?: string;
  lastMessage?: string;
  time?: string;
  online?: boolean;
  status?: string;
  sentCount?: number;
  receivedCount?: number;
  lastDir?: "inbound" | "outbound";
  unreadCount?: number;
  delivered?: boolean;
  banned?: boolean;
  pinned?: boolean;
  deleted?: boolean;
  senderPhone?: string;
};

export type AccountStatusKind = "normal" | "paused" | "busy" | "banned";

export type MessageDirection = "inbound" | "outbound";
