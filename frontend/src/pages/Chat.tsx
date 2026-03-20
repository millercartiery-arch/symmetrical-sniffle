import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Drawer,
  Form,
  Input,
  List,
  Select,
  Space,
  Tag,
  Typography,
  message,
  Dropdown,
  theme,
  Spin,
} from "antd";
import {
  EditOutlined,
  MessageOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SendOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  TranslationOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { readTenantScopeObject, writeTenantScope } from "../utils/tenantScope";

const { TextArea } = Input;
const { Text, Title } = Typography;
const { useToken } = theme;

type ChatMessage = {
  id: number;
  peer_phone: string;
  direction: "inbound" | "outbound";
  content: string;
  status: string;
  created_at: string;
};

type ChatItem = {
  id: string;
  name: string;
  phone: string;
  lastMessage?: string;
  time?: string;
  status?: string;
  unreadCount?: number;
  banned?: boolean;
  pinned?: boolean;
};

type ChatRemark = {
  displayName: string;
  company: string;
  tags: string[];
  notes: string;
  updatedAt?: string;
};

const REMARKS_STORAGE_KEY = "cm-chat-remarks-v1";
const emptyRemark: ChatRemark = { displayName: "", company: "", tags: [], notes: "" };

const formatTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
};

const getAccountStatusKind = (status: string | undefined): "normal" | "paused" | "busy" | "banned" => {
  const next = String(status ?? "").trim().toLowerCase();
  if (next === "ready" || next === "normal") return "normal";
  if (next === "cooldown") return "paused";
  if (next === "busy") return "busy";
  if (next === "dead" || next === "locked") return "banned";
  return "banned";
};

const formatMessageStatus = (
  status: string | undefined,
  direction: "inbound" | "outbound",
  t: (key: string, options?: any) => string
) => {
  const next = String(status ?? "").trim();
  if (!next) return "-";
  const lower = next.toLowerCase();
  if (direction === "inbound") return lower === "received" ? t("chat.received_status", { defaultValue: "Received" }) : next;
  if (lower === "sent") return t("chat.delivered", { defaultValue: "Delivered" });
  if (lower === "pending" || lower === "sending") return t("chat.sending", { defaultValue: "Sending" });
  if (lower === "failed") return t("chat.send_failed", { defaultValue: "Send failed" });
  if (/delivered|成功|sent/i.test(next)) return t("chat.delivered", { defaultValue: "Delivered" });
  return next;
};

const formatPhoneNumber = (phone: string) => {
  if (!phone) return phone;
  const cleaned = `${phone}`.replace(/\D/g, "");
  const match10 = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
  if (match10) return `+1 (${match10[1]}) ${match10[2]}-${match10[3]}`;
  const match11 = cleaned.match(/^1(\d{3})(\d{3})(\d{4})$/);
  if (match11) return `+1 (${match11[1]}) ${match11[2]}-${match11[3]}`;
  return phone;
};

const loadRemarkStore = (): Record<string, ChatRemark> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(REMARKS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const saveRemarkStore = (value: Record<string, ChatRemark>) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(REMARKS_STORAGE_KEY, JSON.stringify(value));
};

const Chat: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token } = useToken();
  const tenantScope = readTenantScopeObject();
  const [tenantId, setTenantId] = useState<string>(tenantScope.tenantId);
  const [tenantNumber, setTenantNumber] = useState<string>(tenantScope.tenantNumber);
  const [conversations, setConversations] = useState<ChatItem[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedChat, setSelectedChat] = useState<ChatItem | null>(null);
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusTab, setStatusTab] = useState<"all" | "normal" | "paused" | "busy" | "banned">("all");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [remarkStore, setRemarkStore] = useState<Record<string, ChatRemark>>(() => loadRemarkStore());
  const [remarkDraft, setRemarkDraft] = useState<ChatRemark>(emptyRemark);
  const [translateEnabled, setTranslateEnabled] = useState(false);
  const [translateTarget, setTranslateTarget] = useState<"zh" | "en">("en");
  const [translatedDraft, setTranslatedDraft] = useState("");
  const [detectedLanguage, setDetectedLanguage] = useState("");
  const [translationError, setTranslationError] = useState("");
  const [translating, setTranslating] = useState(false);
  const [sendMode, setSendMode] = useState<"original" | "translated">("translated");
  const [draft, setDraft] = useState("");

  const msgListRef = useRef<HTMLDivElement>(null);
  const translateTimer = useRef<number | null>(null);
  const translateSeqRef = useRef(0);

  const selectedRemark = selectedChat ? remarkStore[selectedChat.id] ?? emptyRemark : emptyRemark;
  const selectedDisplayName = selectedRemark.displayName || selectedChat?.name || (selectedChat ? formatPhoneNumber(selectedChat.phone) : "");

  const filteredConversations = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    return conversations.filter((conversation) => {
      const remark = remarkStore[conversation.id];
      const searchable = [
        conversation.name,
        conversation.phone,
        conversation.lastMessage,
        remark?.displayName,
        remark?.company,
        remark?.notes,
        ...(remark?.tags ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (keyword && !searchable.includes(keyword)) return false;
      if (statusTab === "all") return true;
      return getAccountStatusKind(conversation.status) === statusTab;
    });
  }, [conversations, remarkStore, searchTerm, statusTab]);

  const chatStats = useMemo(
    () => [
      {
        label: t("chat.total_conversations", { defaultValue: "Total Conversations" }),
        value: conversations.length,
        meta: t("chat.total_conversations_meta", { defaultValue: "Live routed threads" }),
      },
      {
        label: t("chat.unread_signals", { defaultValue: "Unread Signals" }),
        value: conversations.reduce((sum, item) => sum + (item.unreadCount ?? 0), 0),
        meta: t("chat.unread_signals_meta", { defaultValue: "Requires operator attention" }),
      },
      {
        label: t("chat.restricted_threads", { defaultValue: "Restricted Threads" }),
        value: conversations.filter((item) => item.banned).length,
        meta: t("chat.restricted_threads_meta", { defaultValue: "Blocked or flagged contacts" }),
      },
      {
        label: t("chat.remarked_contacts", { defaultValue: "Remarked Contacts" }),
        value: Object.keys(remarkStore).length,
        meta: t("chat.remarked_contacts_meta", { defaultValue: "Contacts with saved notes" }),
      },
    ],
    [conversations, remarkStore, t]
  );

  const conversationFocus = useMemo(() => {
    const unreadSignals = conversations.reduce((sum, item) => sum + (item.unreadCount ?? 0), 0);
    const restricted = conversations.filter((item) => item.banned).length;
    if (unreadSignals > 0) {
      return {
        title: t("chat.focus.unread_title", { defaultValue: "Operator replies need attention" }),
        copy: t("chat.focus.unread_copy", { defaultValue: "Unread signals are active in the queue. Review high-intent threads before creating more outbound work." }),
        action: t("chat.focus.review_queue", { defaultValue: "Review queue" }),
        onClick: () => setStatusTab("normal"),
      };
    }
    if (restricted > 0) {
      return {
        title: t("chat.focus.restricted_title", { defaultValue: "Restricted contacts are shaping the queue" }),
        copy: t("chat.focus.restricted_copy", { defaultValue: "Some threads are blocked or flagged. Keep the workspace clean by isolating restricted contacts from live operators." }),
        action: t("chat.focus.filter_restricted", { defaultValue: "Filter restricted" }),
        onClick: () => setStatusTab("banned"),
      };
    }
    return {
      title: t("chat.focus.clear_title", { defaultValue: "Conversation desk is clear for execution" }),
      copy: t("chat.focus.clear_copy", { defaultValue: "No urgent chat alarms are visible. This is the right state for agents to triage new replies, apply remarks and prepare translated responses." }),
      action: t("chat.focus.open_settings", { defaultValue: "Open settings" }),
      onClick: () => setSettingsOpen(true),
    };
  }, [conversations, t]);

  const selectedConversationHealth = selectedChat
    ? getAccountStatusKind(selectedChat.status)
    : "normal";
  const selectedConversationHealthLabel = t(`status.account.${selectedConversationHealth}`, {
    defaultValue: selectedConversationHealth,
  });

  const scrollToBottom = useCallback(() => {
    const element = msgListRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, []);

  const clearTranslationState = useCallback(() => {
    setTranslatedDraft("");
    setDetectedLanguage("");
    setTranslationError("");
    setTranslating(false);
    setSendMode("translated");
  }, []);

  const fetchConversations = useCallback(async () => {
    if (!tenantId) return;
    setLoadingConvs(true);
    try {
      const res: any = await api.get("/user/chat/conversations", { params: { limit: 200 } });
      const data = Array.isArray(res?.data) ? res.data : [];
      setConversations(
        data
          .filter((row: any) => row && row.phone)
          .map((row: any) => ({
            id: String(row.phone),
            name: formatPhoneNumber(String(row.phone)),
            phone: String(row.phone),
            lastMessage: row.last_message ?? "",
            time: row.last_activity ? formatTime(String(row.last_activity)) : "",
            status: row.account_status ?? undefined,
            pinned: Boolean(row.pinned),
            banned: Boolean(row.banned),
            unreadCount: Number(row.unread_count || 0) || 0,
          }))
      );
    } catch (error) {
      console.error(error);
      message.error(t("chat.fetch_conversations_failed", { defaultValue: "Failed to load conversations" }));
    } finally {
      setLoadingConvs(false);
    }
  }, [tenantId, t]);

  const fetchMessages = useCallback(
    async (chatId: string) => {
      if (!tenantId) return;
      setLoadingMsgs(true);
      try {
        const res: any = await api.get("/user/chat/messages", { params: { peerPhone: chatId, limit: 200 } });
        setMessages(Array.isArray(res?.data) ? res.data : []);
        window.setTimeout(scrollToBottom, 100);
      } catch (error) {
        console.error(error);
        message.error(t("chat.fetch_messages_failed", { defaultValue: "Failed to load messages" }));
      } finally {
        setLoadingMsgs(false);
      }
    },
    [scrollToBottom, tenantId, t]
  );

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    if (!selectedChat) {
      setMessages([]);
      return;
    }
    fetchMessages(selectedChat.id);
  }, [fetchMessages, selectedChat]);

  useEffect(() => {
    setRemarkDraft(selectedChat ? remarkStore[selectedChat.id] ?? emptyRemark : emptyRemark);
  }, [remarkStore, selectedChat]);

  const requestTranslation = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!translateEnabled || trimmed.length < 2) {
        clearTranslationState();
        return;
      }

      const seq = ++translateSeqRef.current;
      setTranslating(true);
      setTranslationError("");

      try {
        const res: any = await api.post("/translate", { text: trimmed, targetLanguage: translateTarget });
        if (seq !== translateSeqRef.current) return;
        const translated = String(res?.translatedText ?? res?.data?.translatedText ?? "").trim();
        const detected = String(res?.detectedLanguage ?? res?.data?.detectedLanguage ?? "").trim();
        setTranslatedDraft(translated);
        setDetectedLanguage(detected);
        setSendMode(translated && translated !== trimmed ? "translated" : "original");
      } catch (error: any) {
        if (seq !== translateSeqRef.current) return;
        setTranslationError(error?.response?.data?.error || error?.message || t("chat.translation_preview_failed", { defaultValue: "Translation preview failed" }));
        setTranslatedDraft("");
        setSendMode("original");
      } finally {
        if (seq === translateSeqRef.current) setTranslating(false);
      }
    },
    [clearTranslationState, translateEnabled, translateTarget]
  );

  useEffect(() => {
    if (translateTimer.current) window.clearTimeout(translateTimer.current);
    if (!translateEnabled || !draft.trim()) {
      clearTranslationState();
      return;
    }
    translateTimer.current = window.setTimeout(() => {
      void requestTranslation(draft);
    }, 700);
    return () => {
      if (translateTimer.current) window.clearTimeout(translateTimer.current);
    };
  }, [clearTranslationState, draft, requestTranslation, translateEnabled]);

  const markRead = useCallback(async (id: string) => {
    try {
      await api.post(`/user/chat/conversations/${encodeURIComponent(id)}/read`, {});
    } catch {}
  }, []);

  const togglePin = useCallback(async (id: string, pinned: boolean) => {
    try {
      await api.post(`/user/chat/conversations/${encodeURIComponent(id)}/pin`, { pinned });
      message.success(t("chat.action_success", { defaultValue: "Operation successful" }));
      fetchConversations();
    } catch {
      message.error(t("chat.action_failed", { defaultValue: "Operation failed" }));
    }
  }, [fetchConversations, t]);

  const toggleBan = useCallback(async (id: string, banned: boolean) => {
    try {
      await api.post(`/user/chat/conversations/${encodeURIComponent(id)}/ban`, { banned });
      message.success(t("chat.action_success", { defaultValue: "Operation successful" }));
      fetchConversations();
    } catch {
      message.error(t("chat.action_failed", { defaultValue: "Operation failed" }));
    }
  }, [fetchConversations, t]);

  const deleteChat = useCallback(async (id: string) => {
    try {
      await api.post(`/user/chat/conversations/${encodeURIComponent(id)}/delete`, { deleted: true });
      message.success(t("chat.deleted", { defaultValue: "Deleted" }));
      if (selectedChat?.id === id) setSelectedChat(null);
      fetchConversations();
    } catch {
      message.error(t("chat.delete_failed", { defaultValue: "Delete failed" }));
    }
  }, [fetchConversations, selectedChat?.id, t]);

  const saveTenantSettings = useCallback(() => {
    writeTenantScope({ tenantId: tenantId.trim(), tenantNumber: tenantNumber.trim() });
    message.success(t("chat.settings_saved", { defaultValue: "Settings saved" }));
    setSettingsOpen(false);
    fetchConversations();
  }, [fetchConversations, t, tenantId, tenantNumber]);

  const saveRemark = useCallback(() => {
    if (!selectedChat) return;
    const nextValue: ChatRemark = {
      displayName: remarkDraft.displayName.trim(),
      company: remarkDraft.company.trim(),
      tags: remarkDraft.tags.map((item) => item.trim()).filter(Boolean),
      notes: remarkDraft.notes.trim(),
      updatedAt: new Date().toISOString(),
    };
    const nextStore = { ...remarkStore, [selectedChat.id]: nextValue };
    setRemarkStore(nextStore);
    saveRemarkStore(nextStore);
    setRemarkOpen(false);
    message.success(t("chat.remark_saved", { defaultValue: "Remark saved" }));
  }, [remarkDraft, remarkStore, selectedChat, t]);

  const handleSendMessage = useCallback(async () => {
    if (!selectedChat) return;
    const trimmed = draft.trim();
    if (!trimmed) return;
    const payload = translateEnabled && sendMode === "translated" && translatedDraft ? translatedDraft : trimmed;
    setSending(true);
    try {
      await api.post("/user/chat/send", { peerPhone: selectedChat.phone, content: payload });
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          peer_phone: selectedChat.phone,
          direction: "outbound",
          content: payload,
          status: "sent",
          created_at: new Date().toISOString(),
        },
      ]);
      setDraft("");
      clearTranslationState();
      window.setTimeout(scrollToBottom, 60);
    } catch (error) {
      console.error(error);
      message.error(t("chat.send_message_failed", { defaultValue: "Send message failed" }));
    } finally {
      setSending(false);
    }
  }, [clearTranslationState, draft, scrollToBottom, selectedChat, sendMode, translateEnabled, translatedDraft, t]);

  const contextMenuItems = useCallback((chat: ChatItem) => [
    { key: "pin", label: chat.pinned ? t("chat.unpin", { defaultValue: "Unpin" }) : t("chat.pin", { defaultValue: "Pin" }), onClick: () => togglePin(chat.id, !chat.pinned) },
    { key: "ban", label: chat.banned ? t("chat.unblock", { defaultValue: "Unblock" }) : t("chat.block", { defaultValue: "Block" }), onClick: () => toggleBan(chat.id, !chat.banned), danger: !chat.banned },
    { key: "remark", label: t("chat.edit_remark", { defaultValue: "Edit remark" }), onClick: () => { setSelectedChat(chat); setRemarkOpen(true); } },
    { key: "read", label: t("chat.mark_read", { defaultValue: "Mark read" }), onClick: () => markRead(chat.id).then(fetchConversations) },
    { type: "divider" as const },
    { key: "delete", label: t("chat.delete_conversation", { defaultValue: "Delete conversation" }), danger: true, onClick: () => deleteChat(chat.id) },
  ], [deleteChat, fetchConversations, markRead, t, toggleBan, togglePin]);

  const handleSelectConversation = async (chat: ChatItem) => {
    setSelectedChat(chat);
    if ((chat.unreadCount ?? 0) > 0) {
      await markRead(chat.id);
      fetchConversations();
    }
  };

  return (
    <div className="cm-page" style={{ padding: 16 }}>
      <div className="cm-page-header">
        <div>
          <Text className="cm-kpi-eyebrow">{t("chat.page_eyebrow", { defaultValue: "Message Management" })}</Text>
          <Title level={2} className="cm-page-title cm-brand-title">{t("chat.page_title", { defaultValue: "Conversation Center" })}</Title>
          <Text className="cm-page-subtitle">{t("chat.page_subtitle", { defaultValue: "Remarks, translation assist and live reply handling now sit inside one operator-facing workspace with fewer dead ends." })}</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={fetchConversations}>{t("common.refresh", { defaultValue: "Refresh" })}</Button>
      </div>

      <div className="cm-hero-band">
        <div className="cm-hero-panel">
          <div className="cm-kpi-eyebrow">{t("chat.conversation_command", { defaultValue: "Conversation Command" })}</div>
          <Title level={3} className="cm-page-title" style={{ marginTop: 8 }}>
            {conversationFocus.title}
          </Title>
          <Text className="cm-page-subtitle" style={{ display: "block", marginTop: 8 }}>
            {conversationFocus.copy}
          </Text>
          <div className="cm-priority-actions">
            <Button type="primary" className="cm-primary-button" onClick={conversationFocus.onClick}>
              {conversationFocus.action}
            </Button>
            <Button onClick={() => navigate("/admin/dashboard")}>{t("chat.open_dashboard", { defaultValue: "Open dashboard" })}</Button>
            <Button onClick={() => setRemarkOpen(true)} disabled={!selectedChat}>{t("chat.edit_remark", { defaultValue: "Edit remark" })}</Button>
          </div>
          <div className="cm-hero-metrics">
            {chatStats.map((item) => (
              <div key={item.label} className="cm-mini-stat">
                <div className="cm-kpi-eyebrow">{item.label}</div>
                <strong>{item.value}</strong>
                <span>{item.meta}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="cm-hero-panel">
          <div className="cm-kpi-eyebrow">{t("chat.queue_guidance", { defaultValue: "Queue Guidance" })}</div>
          <div className="cm-signal-list" style={{ marginTop: 16 }}>
            <div className="cm-signal-item">
              <div>
                <strong>{t("chat.guidance_search_title", { defaultValue: "Search before switching tabs" })}</strong>
                <span>{t("chat.guidance_search_copy", { defaultValue: "Use phone, remark, company and tags as the primary retrieval path for active operator work." })}</span>
              </div>
              <Button size="small" onClick={() => setStatusTab("all")}>{t("chat.show_all", { defaultValue: "Show all" })}</Button>
            </div>
            <div className="cm-signal-item">
              <div>
                <strong>{t("chat.guidance_translation_title", { defaultValue: "Keep translation optional, not mandatory" })}</strong>
                <span>{t("chat.guidance_translation_copy", { defaultValue: "Operators should see the translation preview as support for reply quality, not as the only path to send." })}</span>
              </div>
              <Button size="small" onClick={() => setTranslateEnabled((prev) => !prev)}>
                {translateEnabled ? t("chat.disable", { defaultValue: "Disable" }) : t("chat.enable", { defaultValue: "Enable" })}
              </Button>
            </div>
            <div className="cm-signal-item">
              <div>
                <strong>{t("chat.selected_thread_health", { defaultValue: "Selected thread health" })}</strong>
                <span>{selectedChat ? t("chat.selected_thread_health_copy", { defaultValue: "{{name}} is currently marked as {{status}}.", name: selectedDisplayName, status: selectedConversationHealthLabel }) : t("chat.select_thread_prompt", { defaultValue: "Select a live thread to inspect message history and reply status." })}</span>
              </div>
              <Button size="small" onClick={() => selectedChat && void handleSelectConversation(selectedChat)} disabled={!selectedChat}>
                {t("chat.refresh_thread", { defaultValue: "Refresh thread" })}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="cm-chat-shell">
        <div className="cm-chat-sidebar" style={{ padding: 14 }}>
          <div style={{ marginBottom: 16 }}>
            <Text className="cm-kpi-eyebrow">{t("chat.conversations", { defaultValue: "Conversations" })}</Text>
            <Title level={4} style={{ margin: "6px 0 4px", color: "var(--cm-text-primary)" }}>{t("chat.queue_filters", { defaultValue: "Queue & Filters" })}</Title>
            <Text style={{ color: "var(--cm-text-secondary)" }}>{t("chat.queue_filters_copy", { defaultValue: "Search phone, remark, company or tags to reach a contact faster." })}</Text>
          </div>
          <Input placeholder={t("chat.search_placeholder", { defaultValue: "Search phone / remark / company" })} prefix={<SearchOutlined />} value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} allowClear style={{ marginBottom: 12 }} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            {[
              { value: "all", label: t("chat.filter_all", { defaultValue: "All" }) },
              { value: "normal", label: t("chat.filter_normal", { defaultValue: "Normal" }) },
              { value: "paused", label: t("chat.filter_paused", { defaultValue: "Cooldown" }) },
              { value: "busy", label: t("chat.filter_busy", { defaultValue: "Busy" }) },
              { value: "banned", label: t("chat.filter_banned", { defaultValue: "Restricted" }) },
            ].map((option) => (
              <Button key={option.value} size="small" type={statusTab === option.value ? "primary" : "default"} className={statusTab === option.value ? "cm-primary-button" : undefined} onClick={() => setStatusTab(option.value as typeof statusTab)}>{option.label}</Button>
            ))}
          </div>

          {loadingConvs ? (
            <Spin style={{ marginTop: 30 }} />
          ) : filteredConversations.length === 0 ? (
            <div className="cm-empty-state">
              <div className="cm-empty-hero">
                <div className="cm-empty-badge"><MessageOutlined /></div>
                <Title level={4} style={{ color: "var(--cm-text-primary)", marginBottom: 8 }}>{t("chat.empty_title", { defaultValue: "No Conversations Yet" })}</Title>
                <Text style={{ color: "var(--cm-text-secondary)" }}>{t("chat.empty_copy", { defaultValue: "Configure tenant routing or create the first task to start filling this queue." })}</Text>
                <Space style={{ marginTop: 16 }}>
                  <Button type="primary" className="cm-primary-button" icon={<PlusOutlined />} onClick={() => navigate("/admin/dashboard")}>{t("chat.create_first_task", { defaultValue: "Create First Task" })}</Button>
                  <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>{t("common.settings", { defaultValue: "Settings" })}</Button>
                </Space>
              </div>
            </div>
          ) : (
            <List
              dataSource={filteredConversations}
              style={{ overflow: "auto", flex: 1 }}
              renderItem={(chat) => {
                const remark = remarkStore[chat.id] ?? emptyRemark;
                const displayName = remark.displayName || chat.name || formatPhoneNumber(chat.phone);
                const notePreview = remark.notes || chat.lastMessage || t("chat.no_messages_preview", { defaultValue: "No messages yet" });
                const statusKind = getAccountStatusKind(chat.status);
                const statusTone: Record<string, string> = { normal: "green", paused: "gold", busy: "blue", banned: "red" };
                const statusLabel = t(`status.account.${statusKind}`, { defaultValue: statusKind });
                const active = selectedChat?.id === chat.id;
                return (
                  <Dropdown key={chat.id} trigger={["contextMenu"]} menu={{ items: contextMenuItems(chat) }}>
                    <List.Item onClick={() => void handleSelectConversation(chat)} style={{ background: active ? "rgba(85, 97, 108, 0.10)" : "transparent", borderRadius: 16, border: active ? "1px solid rgba(85, 97, 108, 0.22)" : "1px solid transparent", marginBottom: 8, padding: "10px 12px", cursor: "pointer" }}>
                      <List.Item.Meta
                        avatar={<Badge dot={Boolean(chat.unreadCount)} offset={[-4, 4]}><Avatar style={{ backgroundColor: token.colorPrimary }}>{displayName?.[0]?.toUpperCase() ?? "?"}</Avatar></Badge>}
                        title={<Space wrap><Text strong style={{ color: "var(--cm-text-primary)" }}>{displayName}</Text>{remark.company ? <Tag color="blue" style={{ borderRadius: 999 }}>{remark.company}</Tag> : null}<Tag color={statusTone[statusKind]} style={{ borderRadius: 999, marginLeft: "auto" }}>{statusLabel}</Tag></Space>}
                        description={<div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><Text type="secondary" ellipsis style={{ maxWidth: 180 }}>{notePreview}</Text><Text type="secondary">{chat.time ?? ""}</Text></div>}
                      />
                    </List.Item>
                  </Dropdown>
                );
              }}
            />
          )}
        </div>

        <div className="cm-chat-pane" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: "14px 14px 0", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <Text className="cm-kpi-eyebrow">{t("chat.live_thread", { defaultValue: "Live Thread" })}</Text>
              <Title level={4} style={{ margin: "6px 0 4px", color: "var(--cm-text-primary)" }}>{selectedChat ? selectedDisplayName : t("chat.workspace_title", { defaultValue: "Conversation Workspace" })}</Title>
              <Text style={{ color: "var(--cm-text-secondary)" }}>{selectedChat ? selectedRemark.notes || formatPhoneNumber(selectedChat.phone) : t("chat.workspace_copy", { defaultValue: "Select a conversation to review messages, notes and translation preview." })}</Text>
            </div>
            <Space wrap>
              <Button icon={<EditOutlined />} onClick={() => setRemarkOpen(true)} disabled={!selectedChat}>{t("chat.remark", { defaultValue: "Remark" })}</Button>
              <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>{t("common.settings", { defaultValue: "Settings" })}</Button>
            </Space>
          </div>

            <div ref={msgListRef} style={{ flex: 1, overflowY: "auto", padding: 12, margin: 14, borderRadius: 16, background: "linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(249, 244, 241, 0.98))" }}>
            {loadingMsgs ? (
              <Spin />
            ) : !selectedChat ? (
              <div className="cm-empty-state"><div className="cm-empty-hero"><div className="cm-empty-badge"><ThunderboltOutlined /></div><Title level={3} style={{ color: "var(--cm-text-primary)", marginBottom: 8 }}>{t("chat.workspace_standby_title", { defaultValue: "Conversation workspace is standing by" })}</Title><Text style={{ color: "var(--cm-text-secondary)" }}>{t("chat.workspace_standby_copy", { defaultValue: "Choose a live thread from the left to review message history, add a commercial note and prepare the next response." })}</Text><Space style={{ marginTop: 16 }}><Button type="primary" className="cm-primary-button" onClick={() => setStatusTab("normal")}>{t("chat.focus_active_queue", { defaultValue: "Focus active queue" })}</Button><Button onClick={() => setSettingsOpen(true)}>{t("chat.workspace_settings", { defaultValue: "Workspace settings" })}</Button></Space></div></div>
            ) : messages.length === 0 ? (
              <div className="cm-empty-state"><div className="cm-empty-hero"><div className="cm-empty-badge"><MessageOutlined /></div><Title level={4} style={{ color: "var(--cm-text-primary)", marginBottom: 8 }}>{t("chat.thread_empty_title", { defaultValue: "Thread is connected but still empty" })}</Title><Text style={{ color: "var(--cm-text-secondary)" }}>{t("chat.thread_empty_copy", { defaultValue: "Use this space to store context first, then send the opening reply with translation support if required." })}</Text><Space style={{ marginTop: 16 }}><Button type="primary" className="cm-primary-button" onClick={() => setRemarkOpen(true)}>{t("chat.add_commercial_note", { defaultValue: "Add commercial note" })}</Button><Button onClick={() => document.querySelector('textarea')?.focus()}>{t("chat.draft_first_reply", { defaultValue: "Draft first reply" })}</Button></Space></div></div>
            ) : (
              messages.map((msg) => {
                const isMine = msg.direction === "outbound";
                return (
                  <div key={msg.id} style={{ display: "flex", justifyContent: isMine ? "flex-end" : "flex-start", marginBottom: 12 }}>
                    <div style={{ maxWidth: "72%", padding: "10px 14px", borderRadius: 16, background: isMine ? "linear-gradient(135deg, var(--cm-brand-color), var(--cm-brand-color-strong))" : "var(--cm-surface)", color: isMine ? "#fff" : "var(--cm-text-primary)", border: isMine ? "none" : "1px solid var(--cm-border)" }}>
                      <div>{msg.content}</div>
                      <div style={{ fontSize: 10, textAlign: "right", marginTop: 4, color: isMine ? "rgba(255,255,255,0.72)" : "var(--cm-text-tertiary)" }}>{formatTime(msg.created_at)} · {formatMessageStatus(msg.status, msg.direction, t)}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div style={{ padding: "0 14px 14px" }}>
            <div className="cm-section-card" style={{ padding: 12 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                <Button size="small" type={translateEnabled ? "primary" : "default"} className={translateEnabled ? "cm-primary-button" : undefined} icon={<TranslationOutlined />} onClick={() => { setTranslateEnabled((prev) => !prev); if (translateEnabled) clearTranslationState(); }}>{translateEnabled ? t("chat.translation_on", { defaultValue: "Translation enabled" }) : t("chat.translation_off", { defaultValue: "Enable translation" })}</Button>
                <Select size="small" value={translateTarget} onChange={(value) => setTranslateTarget(value)} style={{ width: 140 }} disabled={!translateEnabled} options={[{ value: "en", label: t("chat.translate_to_en", { defaultValue: "Translate to English" }) }, { value: "zh", label: t("chat.translate_to_zh", { defaultValue: "Translate to Chinese" }) }]} />
                {translateEnabled ? (
                  <>
                    <Button size="small" type={sendMode === "original" ? "primary" : "default"} onClick={() => setSendMode("original")}>{t("chat.send_original", { defaultValue: "Send original" })}</Button>
                    <Button size="small" type={sendMode === "translated" ? "primary" : "default"} onClick={() => setSendMode("translated")} disabled={!translatedDraft}>{t("chat.send_translation", { defaultValue: "Send translation" })}</Button>
                  </>
                ) : null}
              </div>

              <TextArea placeholder={t("chat.message_placeholder", { defaultValue: "Type a message, Enter to send, Shift + Enter for newline" })} autoSize={{ minRows: 2, maxRows: 5 }} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void handleSendMessage(); } }} disabled={sending || !selectedChat} />

              {translateEnabled ? (
                <div style={{ marginTop: 10, padding: 10, borderRadius: 12, border: `1px solid ${token.colorBorder}`, background: "var(--cm-surface-elevated)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <Text type="secondary">{translating ? t("chat.translating", { defaultValue: "Translating..." }) : translationError ? translationError : translatedDraft ? t("chat.detected_language", { defaultValue: "Detected language: {{lang}}", lang: detectedLanguage || "auto" }) : t("chat.translation_hint", { defaultValue: "Enter two or more characters to generate a preview" })}</Text>
                    {translatedDraft ? <Tag color="blue" style={{ borderRadius: 999 }}>{sendMode === "translated" ? t("chat.current_send_translation", { defaultValue: "Sending translation" }) : t("chat.current_send_original", { defaultValue: "Sending original" })}</Tag> : null}
                  </div>
                  {translatedDraft ? <div style={{ marginTop: 8, whiteSpace: "pre-wrap", color: "var(--cm-text-primary)" }}>{translatedDraft}</div> : null}
                </div>
              ) : null}

              <div style={{ textAlign: "right", marginTop: 10 }}>
                <Button type="primary" className="cm-primary-button" icon={<SendOutlined />} loading={sending} onClick={() => void handleSendMessage()} disabled={!draft.trim() || sending || !selectedChat}>
                  {translateEnabled && sendMode === "translated" && translatedDraft ? t("chat.send_translation_button", { defaultValue: "Send translation" }) : t("chat.send_message_button", { defaultValue: "Send message" })}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Drawer title={t("chat.settings_title", { defaultValue: "Conversation settings" })} placement="right" open={settingsOpen} onClose={() => setSettingsOpen(false)} width={340}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Text strong>{t("chat.tenant_info", { defaultValue: "Tenant information" })}</Text>
          <Input addonBefore={t("chat.tenant_id", { defaultValue: "Tenant ID" })} value={tenantId} onChange={(event) => setTenantId(event.target.value)} placeholder={t("chat.tenant_id_placeholder", { defaultValue: "Enter your Tenant ID..." })} />
          <Input addonBefore={t("chat.tenant_number", { defaultValue: "Tenant number" })} value={tenantNumber} onChange={(event) => setTenantNumber(event.target.value)} placeholder={t("chat.tenant_number_placeholder", { defaultValue: "Enter your Tenant Number..." })} />
          <Button type="primary" className="cm-primary-button" onClick={saveTenantSettings}>{t("common.save", { defaultValue: "Save" })}</Button>
        </Space>
      </Drawer>

      <Drawer title={selectedChat ? t("chat.remark_for", { defaultValue: "{{name}}'s remark", name: selectedDisplayName }) : t("chat.contact_remark", { defaultValue: "Contact remark" })} placement="right" open={remarkOpen} onClose={() => setRemarkOpen(false)} width={380}>
        {selectedChat ? (
          <Form layout="vertical">
            <Form.Item label={t("chat.remark_name", { defaultValue: "Display name" })}><Input value={remarkDraft.displayName} onChange={(event) => setRemarkDraft((prev) => ({ ...prev, displayName: event.target.value }))} placeholder={t("chat.remark_name_placeholder", { defaultValue: "e.g. New York client / channel A" })} /></Form.Item>
            <Form.Item label={t("chat.remark_company", { defaultValue: "Company / source" })}><Input value={remarkDraft.company} onChange={(event) => setRemarkDraft((prev) => ({ ...prev, company: event.target.value }))} placeholder={t("chat.remark_company_placeholder", { defaultValue: "e.g. Agency West" })} /></Form.Item>
            <Form.Item label={t("chat.remark_tags", { defaultValue: "Tags" })}><Select mode="tags" value={remarkDraft.tags} onChange={(value) => setRemarkDraft((prev) => ({ ...prev, tags: value }))} tokenSeparators={[","]} placeholder={t("chat.remark_tags_placeholder", { defaultValue: "Press Enter after typing" })} /></Form.Item>
            <Form.Item label={t("chat.remark_notes", { defaultValue: "Notes" })}><TextArea autoSize={{ minRows: 5, maxRows: 10 }} value={remarkDraft.notes} onChange={(event) => setRemarkDraft((prev) => ({ ...prev, notes: event.target.value }))} placeholder={t("chat.remark_notes_placeholder", { defaultValue: "Record preferences, status, blocked words or follow-up requirements" })} /></Form.Item>
            <Text type="secondary">{selectedRemark.updatedAt ? t("chat.remark_updated_at", { defaultValue: "Last updated: {{time}}", time: new Date(selectedRemark.updatedAt).toLocaleString() }) : t("chat.remark_empty", { defaultValue: "No remark saved yet" })}</Text>
            <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
              <Button onClick={() => setRemarkOpen(false)}>{t("common.cancel", { defaultValue: "Cancel" })}</Button>
              <Button type="primary" className="cm-primary-button" onClick={saveRemark}>{t("chat.save_remark", { defaultValue: "Save remark" })}</Button>
            </div>
          </Form>
        ) : (
          <Text type="secondary">{t("chat.remark_hint", { defaultValue: "Select a conversation on the left before editing remarks." })}</Text>
        )}
      </Drawer>
    </div>
  );
};

export default Chat;
