import React from "react";
import { Alert, Card, Typography } from "antd";

const { Title, Paragraph, Text } = Typography;

const DoNotSell: React.FC = () => {
  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: 16 }}>
      <Card bordered style={{ borderRadius: 12 }}>
        <Title level={3} style={{ marginTop: 0 }}>
          Do Not Sell / Share My Personal Information
        </Title>
        <Alert
          type="info"
          showIcon
          message="Request received"
          description="If you selected “Do Not Sell My Info” in the app, we record your preference."
          style={{ marginBottom: 16, borderRadius: 12 }}
        />
        <Paragraph>
          This page is a placeholder to avoid broken links. Replace with your official disclosure
          and instructions for submitting a request (email, in-app form, or support portal).
        </Paragraph>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Tip: include your support contact, expected response time, and verification steps.
          <br />
          <Text code>support@example.com</Text>
        </Paragraph>
      </Card>
    </div>
  );
};

export default DoNotSell;
