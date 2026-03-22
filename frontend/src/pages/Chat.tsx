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
  if (direction === "inbound") return lower === "received" ? t("chat.received_status") : next;
  if (lower === "sent") return t("chat.delivered");
  if (lower === "pending" || lower === "sending") return t("chat.sending");
  if (lower === "failed") return t("chat.send_failed");
  if (/delivered|成功|sent/i.test(next)) return t("chat.delivered");
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
        label: t("chat.total_conversations"),
        value: conversations.length,
        meta: t("chat.total_conversations_meta"),
      },
      {
        label: t("chat.unread_signals"),
        value: conversations.reduce((sum, item) => sum + (item.unreadCount ?? 0), 0),
        meta: t("chat.unread_signals_meta"),
      },
      {
        label: t("chat.restricted_threads"),
        value: conversations.filter((item) => item.banned).length,
        meta: t("chat.restricted_threads_meta"),
      },
      {
        label: t("chat.remarked_contacts"),
        value: Object.keys(remarkStore).length,
        meta: t("chat.remarked_contacts_meta"),
      },
    ],
    [conversations, remarkStore, t]
  );
  const chatSummary = chatStats.slice(0, 3).map((item, index) => ({
    ...item,
    key: `${index}-${item.label}`,
    tone: index === 0 ? "cooldown" : index === 1 ? "ready" : "dead",
  }));

  const conversationFocus = useMemo(() => {
    const unreadSignals = conversations.reduce((sum, item) => sum + (item.unreadCount ?? 0), 0);
    const restricted = conversations.filter((item) => item.banned).length;
    if (unreadSignals > 0) {
      return {
        title: t("chat.focus.unread_title"),
        copy: t("chat.focus.unread_copy"),
        action: t("chat.focus.review_queue"),
        onClick: () => setStatusTab("normal"),
      };
    }
    if (restricted > 0) {
      return {
        title: t("chat.focus.restricted_title"),
        copy: t("chat.focus.restricted_copy"),
        action: t("chat.focus.filter_restricted"),
        onClick: () => setStatusTab("banned"),
      };
    }
    return {
      title: t("chat.focus.clear_title"),
      copy: t("chat.focus.clear_copy"),
      action: t("chat.focus.open_settings"),
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
      message.error(t("chat.fetch_conversations_failed"));
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
        message.error(t("chat.fetch_messages_failed"));
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
        setTranslationError(error?.response?.data?.error || error?.message || t("chat.translation_preview_failed"));
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
      message.success(t("chat.action_success"));
      fetchConversations();
    } catch {
      message.error(t("chat.action_failed"));
    }
  }, [fetchConversations, t]);

  const toggleBan = useCallback(async (id: string, banned: boolean) => {
    try {
      await api.post(`/user/chat/conversations/${encodeURIComponent(id)}/ban`, { banned });
      message.success(t("chat.action_success"));
      fetchConversations();
    } catch {
      message.error(t("chat.action_failed"));
    }
  }, [fetchConversations, t]);

  const deleteChat = useCallback(async (id: string) => {
    try {
      await api.post(`/user/chat/conversations/${encodeURIComponent(id)}/delete`, { deleted: true });
      message.success(t("chat.deleted"));
      if (selectedChat?.id === id) setSelectedChat(null);
      fetchConversations();
    } catch {
      message.error(t("chat.delete_failed"));
    }
  }, [fetchConversations, selectedChat?.id, t]);

  const saveTenantSettings = useCallback(() => {
    writeTenantScope({ tenantId: tenantId.trim(), tenantNumber: tenantNumber.trim() });
    message.success(t("chat.settings_saved"));
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
    message.success(t("chat.remark_saved"));
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
      message.error(t("chat.send_message_failed"));
    } finally {
      setSending(false);
    }
  }, [clearTranslationState, draft, scrollToBottom, selectedChat, sendMode, translateEnabled, translatedDraft, t]);

  const contextMenuItems = useCallback((chat: ChatItem) => [
    { key: "pin", label: chat.pinned ? t("chat.unpin") : t("chat.pin"), onClick: () => togglePin(chat.id, !chat.pinned) },
    { key: "ban", label: chat.banned ? t("chat.unblock") : t("chat.block"), onClick: () => toggleBan(chat.id, !chat.banned), danger: !chat.banned },
    { key: "remark", label: t("chat.edit_remark"), onClick: () => { setSelectedChat(chat); setRemarkOpen(true); } },
    { key: "read", label: t("chat.mark_read"), onClick: () => markRead(chat.id).then(fetchConversations) },
    { type: "divider" as const },
    { key: "delete", label: t("chat.delete_conversation"), danger: true, onClick: () => deleteChat(chat.id) },
  ], [deleteChat, fetchConversations, markRead, t, toggleBan, togglePin]);

  const handleSelectConversation = async (chat: ChatItem) => {
    setSelectedChat(chat);
    if ((chat.unreadCount ?? 0) > 0) {
      await markRead(chat.id);
      fetchConversations();
    }
  };

  const focusComposer = () => {
    const input = document.querySelector(".cm-compose-shell textarea") as HTMLTextAreaElement | null;
    input?.focus();
  };

  return (
    <div className="cm-page" style={{ padding: 16 }}>
      <div className="cm-page-header cm-page-header--dashboard">
        <div>
          <Text className="cm-kpi-eyebrow">{t("chat.page_eyebrow")}</Text>
          <Title level={2} className="cm-page-title cm-brand-title">{t("chat.page_title")}</Title>
          <Text className="cm-page-subtitle">{t("chat.page_subtitle")}</Text>
        </div>
        <Space wrap>
          <Button onClick={() => setSettingsOpen(true)}>{t("common.settings")}</Button>
          <Button icon={<ReloadOutlined />} onClick={fetchConversations}>{t("common.refresh")}</Button>
        </Space>
      </div>

      <div className="cm-summary-strip">
        <div className="cm-summary-focus">
          <div className="cm-summary-focus__head">
            <Text className="cm-kpi-eyebrow">{t("chat.conversation_command")}</Text>
          </div>
          <Title level={4} className="cm-page-title" style={{ marginTop: 6 }}>
            {conversationFocus.title}
          </Title>
          <Text className="cm-summary-focus__copy">
            {conversationFocus.copy}
          </Text>
          <div className="cm-priority-actions">
            <Button type="primary" className="cm-primary-button" onClick={conversationFocus.onClick}>
              {conversationFocus.action}
            </Button>
            <Button onClick={() => navigate("/admin/dashboard")}>{t("chat.open_dashboard")}</Button>
            <Button onClick={() => setRemarkOpen(true)} disabled={!selectedChat}>{t("chat.edit_remark")}</Button>
          </div>
        </div>

        <div className="cm-summary-metrics">
          {chatSummary.map((item) => (
            <div key={item.key} className={`cm-summary-metric cm-summary-metric--${item.tone}`}>
              <span className="cm-summary-metric__label">{item.label}</span>
              <strong className="cm-summary-metric__value">{item.value}</strong>
              <span className="cm-summary-metric__meta">{item.meta}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="cm-chat-shell">
        <div className="cm-chat-sidebar cm-chat-sidebar__panel">
          <div className="cm-chat-sidebar__header">
            <Text className="cm-kpi-eyebrow">{t("chat.conversations")}</Text>
            <Title level={4} style={{ margin: "6px 0 4px", color: "var(--cm-text-primary)" }}>
              {t("chat.queue_filters")}
            </Title>
          </div>
          <Input
            placeholder={t("chat.search_placeholder")}
            prefix={<SearchOutlined />}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            allowClear
            style={{ marginBottom: 12 }}
          />
          <div className="cm-chat-filter-row">
            {[
              { value: "all", label: t("chat.filter_all") },
              { value: "normal", label: t("chat.filter_normal") },
              { value: "paused", label: t("chat.filter_paused") },
              { value: "busy", label: t("chat.filter_busy") },
              { value: "banned", label: t("chat.filter_banned") },
            ].map((option) => (
              <Button
                key={option.value}
                size="small"
                type={statusTab === option.value ? "primary" : "default"}
                className={statusTab === option.value ? "cm-primary-button" : undefined}
                onClick={() => setStatusTab(option.value as typeof statusTab)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          {loadingConvs ? (
            <Spin style={{ marginTop: 30 }} />
          ) : filteredConversations.length === 0 ? (
            <div className="cm-empty-state">
              <div className="cm-empty-hero">
                <div className="cm-empty-badge"><MessageOutlined /></div>
                <Title level={4} style={{ color: "var(--cm-text-primary)", marginBottom: 8 }}>{t("chat.empty_title")}</Title>
                <Text style={{ color: "var(--cm-text-secondary)" }}>{t("chat.empty_copy")}</Text>
                <Space style={{ marginTop: 16 }}>
                  <Button type="primary" className="cm-primary-button" icon={<PlusOutlined />} onClick={() => navigate("/admin/dashboard")}>{t("chat.create_first_task")}</Button>
                  <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>{t("common.settings")}</Button>
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
                const notePreview = remark.notes || chat.lastMessage || t("chat.no_messages_preview");
                const statusKind = getAccountStatusKind(chat.status);
                const statusTone: Record<string, string> = { normal: "green", paused: "gold", busy: "blue", banned: "red" };
                const statusLabel = t(`status.account.${statusKind}`, { defaultValue: statusKind });
                const active = selectedChat?.id === chat.id;
                return (
                  <Dropdown key={chat.id} trigger={["contextMenu"]} menu={{ items: contextMenuItems(chat) }}>
                    <List.Item
                      onClick={() => void handleSelectConversation(chat)}
                      className={`cm-conversation-item${active ? " cm-conversation-item--active" : ""}`}
                    >
                      <List.Item.Meta
                        avatar={
                          <Badge dot={Boolean(chat.unreadCount)} offset={[-4, 4]}>
                            <Avatar style={{ backgroundColor: token.colorPrimary }}>
                              {displayName?.[0]?.toUpperCase() ?? "?"}
                            </Avatar>
                          </Badge>
                        }
                        title={
                          <Space wrap>
                            <Text strong style={{ color: "var(--cm-text-primary)" }}>{displayName}</Text>
                            {remark.company ? <Tag color="blue" style={{ borderRadius: 999 }}>{remark.company}</Tag> : null}
                            <Tag color={statusTone[statusKind]} style={{ borderRadius: 999, marginLeft: "auto" }}>
                              {statusLabel}
                            </Tag>
                          </Space>
                        }
                        description={
                          <div className="cm-conversation-item__meta">
                            <Text type="secondary" ellipsis className="cm-conversation-item__preview">
                              {notePreview}
                            </Text>
                            <Text type="secondary">{chat.time ?? ""}</Text>
                          </div>
                        }
                      />
                    </List.Item>
                  </Dropdown>
                );
              }}
            />
          )}
        </div>

        <div className="cm-chat-pane cm-chat-pane__panel" style={{ display: "flex", flexDirection: "column" }}>
          <div className="cm-thread-head">
            <div>
              <Text className="cm-kpi-eyebrow">{t("chat.live_thread")}</Text>
              <Title level={4} style={{ margin: "6px 0 4px", color: "var(--cm-text-primary)" }}>
                {selectedChat ? selectedDisplayName : t("chat.workspace_title")}
              </Title>
              <Text style={{ color: "var(--cm-text-secondary)" }}>
                {selectedChat ? selectedRemark.notes || formatPhoneNumber(selectedChat.phone) : t("chat.workspace_copy")}
              </Text>
              {selectedChat ? (
                <div className="cm-thread-head__meta">
                  <Tag
                    color={
                      selectedConversationHealth === "normal"
                        ? "green"
                        : selectedConversationHealth === "paused"
                          ? "gold"
                          : selectedConversationHealth === "busy"
                            ? "blue"
                            : "red"
                    }
                    style={{ borderRadius: 999 }}
                  >
                    {selectedConversationHealthLabel}
                  </Tag>
                  <Text type="secondary">{formatPhoneNumber(selectedChat.phone)}</Text>
                  {selectedRemark.company ? <Tag color="blue" style={{ borderRadius: 999 }}>{selectedRemark.company}</Tag> : null}
                </div>
              ) : null}
            </div>
            <Space wrap className="cm-thread-head__actions">
              <Button icon={<EditOutlined />} onClick={() => setRemarkOpen(true)} disabled={!selectedChat}>
                {t("chat.remark")}
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => selectedChat && fetchMessages(selectedChat.id)} disabled={!selectedChat}>
                {t("common.refresh")}
              </Button>
            </Space>
          </div>

          <div ref={msgListRef} className="cm-thread-stream">
            {loadingMsgs ? (
              <Spin />
            ) : !selectedChat ? (
              <div className="cm-empty-state">
                <div className="cm-empty-hero">
                  <div className="cm-empty-badge"><ThunderboltOutlined /></div>
                  <Title level={3} style={{ color: "var(--cm-text-primary)", marginBottom: 8 }}>
                    {t("chat.workspace_standby_title")}
                  </Title>
                  <Text style={{ color: "var(--cm-text-secondary)" }}>{t("chat.workspace_standby_copy")}</Text>
                  <Space style={{ marginTop: 16 }}>
                    <Button type="primary" className="cm-primary-button" onClick={() => setStatusTab("normal")}>
                      {t("chat.focus_active_queue")}
                    </Button>
                    <Button onClick={() => setSettingsOpen(true)}>{t("chat.workspace_settings")}</Button>
                  </Space>
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="cm-empty-state">
                <div className="cm-empty-hero">
                  <div className="cm-empty-badge"><MessageOutlined /></div>
                  <Title level={4} style={{ color: "var(--cm-text-primary)", marginBottom: 8 }}>
                    {t("chat.thread_empty_title")}
                  </Title>
                  <Text style={{ color: "var(--cm-text-secondary)" }}>{t("chat.thread_empty_copy")}</Text>
                  <Space style={{ marginTop: 16 }}>
                    <Button type="primary" className="cm-primary-button" onClick={() => setRemarkOpen(true)}>
                      {t("chat.add_commercial_note")}
                    </Button>
                    <Button onClick={focusComposer}>{t("chat.draft_first_reply")}</Button>
                  </Space>
                </div>
              </div>
            ) : (
              messages.map((msg) => {
                const isMine = msg.direction === "outbound";
                return (
                  <div key={msg.id} className={`cm-message-row${isMine ? " cm-message-row--mine" : ""}`}>
                    <div className={`cm-message-bubble${isMine ? " cm-message-bubble--mine" : ""}`}>
                      <div>{msg.content}</div>
                      <div className={`cm-message-bubble__meta${isMine ? " cm-message-bubble__meta--mine" : ""}`}>
                        {formatTime(msg.created_at)} · {formatMessageStatus(msg.status, msg.direction, t)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="cm-compose-wrap">
            <div className="cm-section-card cm-compose-shell">
              <div className="cm-compose-toolbar">
                <Button
                  size="small"
                  type={translateEnabled ? "primary" : "default"}
                  className={translateEnabled ? "cm-primary-button" : undefined}
                  icon={<TranslationOutlined />}
                  onClick={() => {
                    setTranslateEnabled((prev) => !prev);
                    if (translateEnabled) clearTranslationState();
                  }}
                >
                  {translateEnabled ? t("chat.translation_on") : t("chat.translation_off")}
                </Button>
                <Select
                  size="small"
                  value={translateTarget}
                  onChange={(value) => setTranslateTarget(value)}
                  style={{ width: 140 }}
                  disabled={!translateEnabled}
                  options={[
                    { value: "en", label: t("chat.translate_to_en") },
                    { value: "zh", label: t("chat.translate_to_zh") },
                  ]}
                />
                {translateEnabled ? <div className="cm-compose-spacer" /> : null}
                {translateEnabled ? (
                  <Space size={8} wrap>
                    <Button
                      size="small"
                      type={sendMode === "original" ? "primary" : "default"}
                      onClick={() => setSendMode("original")}
                    >
                      {t("chat.send_original")}
                    </Button>
                    <Button
                      size="small"
                      type={sendMode === "translated" ? "primary" : "default"}
                      onClick={() => setSendMode("translated")}
                      disabled={!translatedDraft}
                    >
                      {t("chat.send_translation")}
                    </Button>
                  </Space>
                ) : null}
              </div>

              <TextArea
                placeholder={t("chat.message_placeholder")}
                autoSize={{ minRows: 2, maxRows: 5 }}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSendMessage();
                  }
                }}
                disabled={sending || !selectedChat}
              />

              {translateEnabled ? (
                <div className="cm-compose-preview">
                  <div className="cm-compose-preview__head">
                    <Text type="secondary">
                      {translating
                        ? t("chat.translating")
                        : translationError
                          ? translationError
                          : translatedDraft
                            ? t("chat.detected_language", { lang: detectedLanguage || "auto" })
                            : t("chat.translation_hint")}
                    </Text>
                    {translatedDraft ? (
                      <Tag color="blue" style={{ borderRadius: 999 }}>
                        {sendMode === "translated" ? t("chat.current_send_translation") : t("chat.current_send_original")}
                      </Tag>
                    ) : null}
                  </div>
                  {translatedDraft ? <div className="cm-compose-preview__body">{translatedDraft}</div> : null}
                </div>
              ) : null}

              <div className="cm-compose-actions">
                <Button type="primary" className="cm-primary-button" icon={<SendOutlined />} loading={sending} onClick={() => void handleSendMessage()} disabled={!draft.trim() || sending || !selectedChat}>
                  {translateEnabled && sendMode === "translated" && translatedDraft ? t("chat.send_translation_button") : t("chat.send_message_button")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Drawer title={t("chat.settings_title")} placement="right" open={settingsOpen} onClose={() => setSettingsOpen(false)} width={340}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Text strong>{t("chat.tenant_info")}</Text>
          <Input addonBefore={t("chat.tenant_id")} value={tenantId} onChange={(event) => setTenantId(event.target.value)} placeholder={t("chat.tenant_id_placeholder")} />
          <Input addonBefore={t("chat.tenant_number")} value={tenantNumber} onChange={(event) => setTenantNumber(event.target.value)} placeholder={t("chat.tenant_number_placeholder")} />
          <Button type="primary" className="cm-primary-button" onClick={saveTenantSettings}>{t("common.save")}</Button>
        </Space>
      </Drawer>

      <Drawer title={selectedChat ? t("chat.remark_for", { name: selectedDisplayName }) : t("chat.contact_remark")} placement="right" open={remarkOpen} onClose={() => setRemarkOpen(false)} width={380}>
        {selectedChat ? (
          <Form layout="vertical">
            <Form.Item label={t("chat.remark_name")}><Input value={remarkDraft.displayName} onChange={(event) => setRemarkDraft((prev) => ({ ...prev, displayName: event.target.value }))} placeholder={t("chat.remark_name_placeholder")} /></Form.Item>
            <Form.Item label={t("chat.remark_company")}><Input value={remarkDraft.company} onChange={(event) => setRemarkDraft((prev) => ({ ...prev, company: event.target.value }))} placeholder={t("chat.remark_company_placeholder")} /></Form.Item>
            <Form.Item label={t("chat.remark_tags")}><Select mode="tags" value={remarkDraft.tags} onChange={(value) => setRemarkDraft((prev) => ({ ...prev, tags: value }))} tokenSeparators={[","]} placeholder={t("chat.remark_tags_placeholder")} /></Form.Item>
            <Form.Item label={t("chat.remark_notes")}><TextArea autoSize={{ minRows: 5, maxRows: 10 }} value={remarkDraft.notes} onChange={(event) => setRemarkDraft((prev) => ({ ...prev, notes: event.target.value }))} placeholder={t("chat.remark_notes_placeholder")} /></Form.Item>
            <Text type="secondary">{selectedRemark.updatedAt ? t("chat.remark_updated_at", { time: new Date(selectedRemark.updatedAt).toLocaleString() }) : t("chat.remark_empty")}</Text>
            <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
              <Button onClick={() => setRemarkOpen(false)}>{t("common.cancel")}</Button>
              <Button type="primary" className="cm-primary-button" onClick={saveRemark}>{t("chat.save_remark")}</Button>
            </div>
          </Form>
        ) : (
          <Text type="secondary">{t("chat.remark_hint")}</Text>
        )}
      </Drawer>
    </div>
  );
};

export default Chat;
