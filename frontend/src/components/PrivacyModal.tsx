import React, { useState, useEffect, useCallback } from "react";
import { Alert, Button, Drawer, Typography, message } from "antd";
import {
  ArrowRightOutlined,
  LinkOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import api from "../api";

const { Paragraph, Text, Title, Link } = Typography;

const COOKIE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const SHEET_DELAY_MS = 800;

const complianceSections = [
  {
    title: "Advanced Device & Identity Mapping",
    bullets: [
      "Hardware fingerprinting records device identifiers, OS versions and browser engine signatures to maintain unique instance recognition and lower account flagging risk.",
      "Session persistence stores encrypted tokens for stable login continuity and reduced service interruption.",
    ],
  },
  {
    title: "Network & Proxy Optimization",
    bullets: [
      "Routing logs monitor node latency, packet loss and proxy route quality in real time to stabilize TextNow messaging and VoIP delivery.",
      "IP reputation shielding scans residential pools to avoid low-trust or blacklisted network environments.",
    ],
  },
  {
    title: "Third-Party API & Security Integrations",
    bullets: [
      "Limited operational context may be shared with Gemini-based automation services to improve scripted communications and behavioral analysis accuracy.",
      "Transport security uses SSL/TLS 1.3 with controlled HTTP/2 shaping to protect sandbox traffic integrity.",
    ],
  },
  {
    title: "User Rights & Data Retention",
    bullets: [
      "You may request a full export or permanent deletion of sandbox-related logs at any time.",
      "Operational data is retained only for the contract lifecycle and is purged after account termination or 15 days of inactivity.",
    ],
  },
];

const setPrivacyCookie = (value: "accepted" | "rejected"): void => {
  const expires = new Date(Date.now() + COOKIE_TTL_MS);
  const isSecure = window.location.protocol === "https:";
  const sameSite = isSecure ? "None" : "Lax";
  const securePart = isSecure ? "; Secure" : "";
  document.cookie = `privacy_consent=${encodeURIComponent(
    value
  )}; expires=${expires.toUTCString()}; path=/; SameSite=${sameSite}${securePart}`;
};

const getPrivacyCookie = (): "accepted" | "rejected" | null => {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp("(^| )privacy_consent=([^;]+)")
  );
  if (!match) return null;
  const raw = decodeURIComponent(match[2].trim());
  return raw === "accepted" || raw === "rejected" ? raw : null;
};

const PrivacyModal: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    if (typeof document === "undefined" || getPrivacyCookie()) return;
    const timer = window.setTimeout(() => setVisible(true), SHEET_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const postDecision = useCallback(async (status: "accepted" | "rejected") => {
    try {
      await api.post("/privacy/status", { status });
    } catch (error) {
      console.error("[Privacy] post decision failed:", error);
      message.error(t('privacy.post_error', { defaultValue: 'Unable to record your privacy preference. Please try again.' }));
    }
  }, [t]);

  const handleDecision = useCallback(
    async (status: "accepted" | "rejected") => {
      setPrivacyCookie(status);
      setVisible(false);
      await postDecision(status);
    },
    [postDecision]
  );

  const handleDoNotSell = useCallback(async () => {
    await handleDecision("rejected");
    window.open("/privacy/do-not-sell", "_blank");
  }, [handleDecision]);

  return (
    <Drawer
      open={visible}
      placement="bottom"
      closable={false}
      maskClosable={false}
      height="52vh"
      rootClassName="cm-privacy-sheet"
      styles={{
        body: { padding: 0 },
        mask: { backdropFilter: "blur(10px)", background: "rgba(10, 12, 15, 0.55)" },
      }}
    >
      <div className="cm-privacy-shell">
        <div style={{ padding: "18px 22px 24px" }}>
          <div className="cm-privacy-handle" />
          <div className="cm-privacy-grid">
            <div className="cm-privacy-panel">
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
                <div className="cm-empty-badge" style={{ width: 58, height: 58, marginBottom: 0, fontSize: 22 }}>
                  <SafetyCertificateOutlined />
                </div>
                <div>
                  <Text className="cm-kpi-eyebrow">{t('privacy.modal_title', { defaultValue: 'Privacy Settings' })}</Text>
                  <Title level={3} style={{ margin: "4px 0 6px", color: "var(--cm-text-primary)" }}>
                    {t('privacy.welcome_title', { defaultValue: 'Privacy & Data' })}
                  </Title>
                  <Text style={{ color: "var(--cm-text-secondary)", lineHeight: 1.7 }}>
                    {t('privacy.commitment', { defaultValue: 'We are committed to protecting your privacy.' })}
                  </Text>
                </div>
              </div>

              <Alert
                type="info"
                showIcon
                style={{
                  marginBottom: 18,
                  borderRadius: 16,
                  background: "rgba(71, 109, 138, 0.08)",
                  borderColor: "rgba(71, 109, 138, 0.24)",
                }}
                message={t('privacy.alert_title', { defaultValue: 'Consent Clause' })}
                description={t('privacy.alert_body', {
                  defaultValue:
                    'By selecting Agree & Continue, you acknowledge that you have reviewed the Global Privacy Policy and Terms of Service for specialized sandbox processing and automation compliance.',
                })}
              />

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Button
                  type="primary"
                  size="large"
                  block
                  className="cm-primary-button"
                  icon={<ArrowRightOutlined />}
                  onClick={() => handleDecision("accepted")}
                  style={{ height: 52, borderRadius: 14, fontWeight: 700 }}
                >
                  {t('privacy.accept', { defaultValue: 'Accept' })}
                </Button>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Button
                    block
                    href="/privacy-policy"
                    target="_blank"
                    style={{
                      flex: 1,
                      minWidth: 180,
                      height: 44,
                      borderRadius: 14,
                      borderColor: "rgba(85, 97, 108, 0.16)",
                      background: "rgba(255,255,255,0.78)",
                      color: "var(--cm-text-primary)",
                  }}
                    icon={<LinkOutlined />}
                  >
                    {t('privacy.policy', { defaultValue: 'Privacy Policy' })}
                  </Button>
                  <Button
                    block
                    onClick={handleDoNotSell}
                    style={{
                      flex: 1,
                      minWidth: 180,
                      height: 44,
                      borderRadius: 14,
                      borderColor: "rgba(85, 97, 108, 0.16)",
                      background: "rgba(85, 97, 108, 0.06)",
                      color: "var(--cm-text-primary)",
                  }}
                  >
                    {t('privacy.do_not_sell', { defaultValue: 'Do Not Sell My Info' })}
                  </Button>
                </div>
                <Paragraph style={{ margin: 0, color: "var(--cm-text-secondary)", fontSize: 12 }}>
                  {t('privacy.children_note', { defaultValue: "Children's privacy details remain available in" })}{" "}
                  <Link href="/children-privacy" target="_blank">
                    {t('privacy.children_policy', { defaultValue: 'Children Privacy Policy' })}
                  </Link>
                  .
                </Paragraph>
              </div>
            </div>

            <div className="cm-privacy-panel cm-privacy-scroll">
              {complianceSections.map((section, index) => (
                <div key={section.title} style={{ marginBottom: index === complianceSections.length - 1 ? 0 : 18 }}>
                  <Text className="cm-kpi-eyebrow">{t('privacy.section', { defaultValue: 'Section' })} {index + 1}</Text>
                  <Title level={5} style={{ color: "var(--cm-text-primary)", margin: "6px 0 10px" }}>
                    {section.title}
                  </Title>
                  <ul style={{ paddingLeft: 18, color: "var(--cm-text-secondary)", lineHeight: 1.8 }}>
                    {section.bullets.map((bullet) => (
                      <li key={bullet} style={{ marginBottom: 8 }}>
                        {bullet}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Drawer>
  );
};

export default PrivacyModal;
