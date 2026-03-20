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
        setTranslationError(error?.response?.data?.error || error?.message || "Translation preview failed");
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
      message.success("操作成功");
      fetchConversations();
    } catch {
      message.error("操作失败");
    }
  }, [fetchConversations]);

  const toggleBan = useCallback(async (id: string, banned: boolean) => {
    try {
      await api.post(`/user/chat/conversations/${encodeURIComponent(id)}/ban`, { banned });
      message.success("操作成功");
      fetchConversations();
    } catch {
      message.error("操作失败");
    }
  }, [fetchConversations]);

  const deleteChat = useCallback(async (id: string) => {
    try {
      await api.post(`/user/chat/conversations/${encodeURIComponent(id)}/delete`, { deleted: true });
      message.success("已删除");
      if (selectedChat?.id === id) setSelectedChat(null);
      fetchConversations();
    } catch {
      message.error("删除失败");
    }
  }, [fetchConversations, selectedChat?.id]);

  const saveTenantSettings = useCallback(() => {
    writeTenantScope({ tenantId: tenantId.trim(), tenantNumber: tenantNumber.trim() });
    message.success("设置已保存");
    setSettingsOpen(false);
    fetchConversations();
  }, [fetchConversations, tenantId, tenantNumber]);

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
    message.success("备注已保存");
  }, [remarkDraft, remarkStore, selectedChat]);

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
      message.error("发送消息失败");
    } finally {
      setSending(false);
    }
  }, [clearTranslationState, draft, scrollToBottom, selectedChat, sendMode, translateEnabled, translatedDraft]);

  const contextMenuItems = useCallback((chat: ChatItem) => [
    { key: "pin", label: chat.pinned ? "取消置顶" : "置顶", onClick: () => togglePin(chat.id, !chat.pinned) },
    { key: "ban", label: chat.banned ? "解除封禁" : "封禁", onClick: () => toggleBan(chat.id, !chat.banned), danger: !chat.banned },
    { key: "remark", label: "编辑备注", onClick: () => { setSelectedChat(chat); setRemarkOpen(true); } },
    { key: "read", label: "标记已读", onClick: () => markRead(chat.id).then(fetchConversations) },
    { type: "divider" as const },
    { key: "delete", label: "删除会话", danger: true, onClick: () => deleteChat(chat.id) },
  ], [deleteChat, fetchConversations, markRead, toggleBan, togglePin]);

  const handleSelectConversation = async (chat: ChatItem) => {
    setSelectedChat(chat);
    if ((chat.unreadCount ?? 0) > 0) {
      await markRead(chat.id);
      fetchConversations();
    }
  };

  return (
    <div className="cm-page" style={{ padding: 20 }}>
      <div className="cm-page-header">
        <div>
          <Text className="cm-kpi-eyebrow">Message Management</Text>
          <Title level={2} className="cm-page-title cm-brand-title">Conversation Center</Title>
          <Text className="cm-page-subtitle">备注窗体、翻译流程和消息工作区已经合并成一套更顺手的会话操作面板。</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={fetchConversations}>{t("common.refresh", { defaultValue: "刷新" })}</Button>
      </div>

      <div className="cm-kpi-grid" style={{ marginBottom: 18 }}>
        {chatStats.map((item) => (
          <div key={item.label} className="cm-kpi-card" style={{ minHeight: 140 }}>
            <div className="cm-kpi-eyebrow">{item.label}</div>
            <strong className="cm-kpi-value">{item.value}</strong>
            <div className="cm-kpi-meta" style={{ marginTop: 12 }}>{item.meta}</div>
          </div>
        ))}
      </div>

      <div className="cm-chat-shell">
        <div className="cm-chat-sidebar" style={{ padding: 18 }}>
          <div style={{ marginBottom: 16 }}>
            <Text className="cm-kpi-eyebrow">Conversations</Text>
            <Title level={4} style={{ margin: "6px 0 4px", color: "#f7ece8" }}>Queue & Filters</Title>
            <Text style={{ color: "#b9a19a" }}>Search phone, remark, company or tags to reach a contact faster.</Text>
          </div>
          <Input placeholder="搜索号码 / 备注 / 公司" prefix={<SearchOutlined />} value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} allowClear style={{ marginBottom: 12 }} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            {[
              { value: "all", label: "全部" },
              { value: "normal", label: "正常" },
              { value: "paused", label: "冷却" },
              { value: "busy", label: "忙碌" },
              { value: "banned", label: "封禁" },
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
                <Title level={4} style={{ color: "#f7ece8", marginBottom: 8 }}>No Conversations Yet</Title>
                <Text style={{ color: "#b9a19a" }}>Configure tenant routing or create the first task to start filling this queue.</Text>
                <Space style={{ marginTop: 16 }}>
                  <Button type="primary" className="cm-primary-button" icon={<PlusOutlined />} onClick={() => navigate("/admin/dashboard")}>Create First Task</Button>
                  <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>Settings</Button>
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
                const notePreview = remark.notes || chat.lastMessage || "暂无消息";
                const statusKind = getAccountStatusKind(chat.status);
                const statusTone: Record<string, string> = { normal: "#52c41a", paused: "#faad14", busy: "#3f69ff", banned: "#f5222d" };
                const active = selectedChat?.id === chat.id;
                return (
                  <Dropdown key={chat.id} trigger={["contextMenu"]} menu={{ items: contextMenuItems(chat) }}>
                    <List.Item onClick={() => void handleSelectConversation(chat)} style={{ background: active ? "rgba(139, 0, 0, 0.16)" : "transparent", borderRadius: 16, border: active ? "1px solid rgba(178, 34, 34, 0.34)" : "1px solid transparent", marginBottom: 8, padding: "10px 12px", cursor: "pointer" }}>
                      <List.Item.Meta
                        avatar={<Badge dot={Boolean(chat.unreadCount)} offset={[-4, 4]}><Avatar style={{ backgroundColor: token.colorPrimary }}>{displayName?.[0]?.toUpperCase() ?? "?"}</Avatar></Badge>}
                        title={<Space wrap><Text strong style={{ color: "#f7ece8" }}>{displayName}</Text>{remark.company ? <Tag color="blue" style={{ borderRadius: 999 }}>{remark.company}</Tag> : null}<Tag color={statusTone[statusKind]} style={{ borderRadius: 999, marginLeft: "auto" }}>{statusKind}</Tag></Space>}
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
          <div style={{ padding: "18px 18px 0", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <Text className="cm-kpi-eyebrow">Live Thread</Text>
              <Title level={4} style={{ margin: "6px 0 4px", color: "#f7ece8" }}>{selectedChat ? selectedDisplayName : "Conversation Workspace"}</Title>
              <Text style={{ color: "#b9a19a" }}>{selectedChat ? selectedRemark.notes || formatPhoneNumber(selectedChat.phone) : "Select a conversation to review messages, notes and translation preview."}</Text>
            </div>
            <Space wrap>
              <Button icon={<EditOutlined />} onClick={() => setRemarkOpen(true)} disabled={!selectedChat}>备注</Button>
              <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>Settings</Button>
            </Space>
          </div>

          <div ref={msgListRef} style={{ flex: 1, overflowY: "auto", padding: 16, margin: 18, borderRadius: 18, background: "linear-gradient(180deg, rgba(24, 24, 24, 0.98), rgba(12, 12, 12, 0.98))" }}>
            {loadingMsgs ? (
              <Spin />
            ) : !selectedChat ? (
              <div className="cm-empty-state"><div className="cm-empty-hero"><div className="cm-empty-badge"><ThunderboltOutlined /></div><Title level={3} style={{ color: "#f7ece8", marginBottom: 8 }}>Conversation space is ready</Title><Text style={{ color: "#b9a19a" }}>Pick a thread to inspect messages, save a counterpart remark and translate replies with more control.</Text></div></div>
            ) : messages.length === 0 ? (
              <div className="cm-empty-state"><div className="cm-empty-hero"><div className="cm-empty-badge"><MessageOutlined /></div><Title level={4} style={{ color: "#f7ece8", marginBottom: 8 }}>No Messages Yet</Title><Text style={{ color: "#b9a19a" }}>This thread is connected but still empty. Save notes first or send the opening message now.</Text></div></div>
            ) : (
              messages.map((msg) => {
                const isMine = msg.direction === "outbound";
                return (
                  <div key={msg.id} style={{ display: "flex", justifyContent: isMine ? "flex-end" : "flex-start", marginBottom: 12 }}>
                    <div style={{ maxWidth: "72%", padding: "10px 14px", borderRadius: 16, background: isMine ? "linear-gradient(135deg, #8B0000, #B22222)" : "rgba(255,255,255,0.04)", color: isMine ? "#fff" : "#f4e8e4", border: isMine ? "none" : "1px solid rgba(255,255,255,0.06)" }}>
                      <div>{msg.content}</div>
                      <div style={{ fontSize: 10, textAlign: "right", marginTop: 4, color: isMine ? "#eed6d6" : token.colorTextSecondary }}>{formatTime(msg.created_at)} · {formatMessageStatus(msg.status, msg.direction, t)}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div style={{ padding: "0 18px 18px" }}>
            <div className="cm-section-card" style={{ padding: 16 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                <Button size="small" type={translateEnabled ? "primary" : "default"} className={translateEnabled ? "cm-primary-button" : undefined} icon={<TranslationOutlined />} onClick={() => { setTranslateEnabled((prev) => !prev); if (translateEnabled) clearTranslationState(); }}>{translateEnabled ? "实时翻译已开启" : "开启实时翻译"}</Button>
                <Select size="small" value={translateTarget} onChange={(value) => setTranslateTarget(value)} style={{ width: 140 }} disabled={!translateEnabled} options={[{ value: "en", label: "翻译成英文" }, { value: "zh", label: "翻译成中文" }]} />
                {translateEnabled ? (
                  <>
                    <Button size="small" type={sendMode === "original" ? "primary" : "default"} onClick={() => setSendMode("original")}>发送原文</Button>
                    <Button size="small" type={sendMode === "translated" ? "primary" : "default"} onClick={() => setSendMode("translated")} disabled={!translatedDraft}>发送译文</Button>
                  </>
                ) : null}
              </div>

              <TextArea placeholder="输入消息，Enter 发送，Shift + Enter 换行" autoSize={{ minRows: 2, maxRows: 5 }} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void handleSendMessage(); } }} disabled={sending || !selectedChat} />

              {translateEnabled ? (
                <div style={{ marginTop: 12, padding: 12, borderRadius: 14, border: `1px solid ${token.colorBorder}`, background: "rgba(255,255,255,0.03)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <Text type="secondary">{translating ? "翻译中..." : translationError ? translationError : translatedDraft ? `检测语言: ${detectedLanguage || "auto"}` : "输入两字以上后自动生成译文预览"}</Text>
                    {translatedDraft ? <Tag color="blue" style={{ borderRadius: 999 }}>{sendMode === "translated" ? "当前发送译文" : "当前发送原文"}</Tag> : null}
                  </div>
                  {translatedDraft ? <div style={{ marginTop: 8, whiteSpace: "pre-wrap", color: "#f4e8e4" }}>{translatedDraft}</div> : null}
                </div>
              ) : null}

              <div style={{ textAlign: "right", marginTop: 12 }}>
                <Button type="primary" className="cm-primary-button" icon={<SendOutlined />} loading={sending} onClick={() => void handleSendMessage()} disabled={!draft.trim() || sending || !selectedChat}>
                  {translateEnabled && sendMode === "translated" && translatedDraft ? "发送译文" : "发送消息"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Drawer title="会话设置" placement="right" open={settingsOpen} onClose={() => setSettingsOpen(false)} width={340}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Text strong>租户信息</Text>
          <Input addonBefore="租户ID" value={tenantId} onChange={(event) => setTenantId(event.target.value)} placeholder="Enter your Tenant ID..." />
          <Input addonBefore="租户号" value={tenantNumber} onChange={(event) => setTenantNumber(event.target.value)} placeholder="Enter your Tenant Number..." />
          <Button type="primary" className="cm-primary-button" onClick={saveTenantSettings}>保存设置</Button>
        </Space>
      </Drawer>

      <Drawer title={selectedChat ? `${selectedDisplayName} 的备注` : "联系人备注"} placement="right" open={remarkOpen} onClose={() => setRemarkOpen(false)} width={380}>
        {selectedChat ? (
          <Form layout="vertical">
            <Form.Item label="显示备注名"><Input value={remarkDraft.displayName} onChange={(event) => setRemarkDraft((prev) => ({ ...prev, displayName: event.target.value }))} placeholder="例如：纽约客户 / 渠道 A" /></Form.Item>
            <Form.Item label="公司 / 来源"><Input value={remarkDraft.company} onChange={(event) => setRemarkDraft((prev) => ({ ...prev, company: event.target.value }))} placeholder="例如：Agency West" /></Form.Item>
            <Form.Item label="标签"><Select mode="tags" value={remarkDraft.tags} onChange={(value) => setRemarkDraft((prev) => ({ ...prev, tags: value }))} tokenSeparators={[","]} placeholder="输入后回车" /></Form.Item>
            <Form.Item label="备注内容"><TextArea autoSize={{ minRows: 5, maxRows: 10 }} value={remarkDraft.notes} onChange={(event) => setRemarkDraft((prev) => ({ ...prev, notes: event.target.value }))} placeholder="记录偏好、状态、禁忌词或后续跟进要求" /></Form.Item>
            <Text type="secondary">{selectedRemark.updatedAt ? `上次更新：${new Date(selectedRemark.updatedAt).toLocaleString()}` : "还没有保存过备注"}</Text>
            <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
              <Button onClick={() => setRemarkOpen(false)}>取消</Button>
              <Button type="primary" className="cm-primary-button" onClick={saveRemark}>保存备注</Button>
            </div>
          </Form>
        ) : (
          <Text type="secondary">先在左侧选择一个对话，再编辑备注。</Text>
        )}
      </Drawer>
    </div>
  );
};

export default Chat;
