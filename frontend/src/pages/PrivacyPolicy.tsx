import React from "react";
import { Card, Typography } from "antd";

const { Title, Paragraph, Text } = Typography;

const PrivacyPolicy: React.FC = () => {
  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: 16 }}>
      <Card bordered style={{ borderRadius: 12 }}>
        <Title level={3} style={{ marginTop: 0 }}>
          Privacy Policy
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          Last updated: <Text strong>TBD</Text>
        </Paragraph>

        <Paragraph>
          This page is provided to avoid broken links from the in-app privacy dialog. Replace this
          content with your official privacy policy before release.
        </Paragraph>

        <Title level={5}>What we collect</Title>
        <Paragraph>
          Account information, operational logs, and device/environment information necessary to
          provide the service.
        </Paragraph>

        <Title level={5}>How we use data</Title>
        <Paragraph>
          To operate the product, maintain security, troubleshoot issues, and improve reliability.
        </Paragraph>

        <Title level={5}>Your rights</Title>
        <Paragraph>
          You may request access, deletion, or correction of your personal information subject to
          applicable laws.
        </Paragraph>
      </Card>
    </div>
  );
};

export default PrivacyPolicy;
