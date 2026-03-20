import React from "react";
import { Card, Typography } from "antd";

const { Title, Paragraph } = Typography;

const ChildrenPrivacy: React.FC = () => {
  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: 16 }}>
      <Card bordered style={{ borderRadius: 12 }}>
        <Title level={3} style={{ marginTop: 0 }}>
          Children’s Privacy
        </Title>
        <Paragraph>
          This page is a placeholder to prevent 404s from the in-app privacy dialog. If your product
          is not intended for children under 13, clearly state that and describe your practices.
        </Paragraph>
        <Paragraph>
          If you believe a child has provided personal information, provide a contact method here
          and describe how you handle deletion requests.
        </Paragraph>
      </Card>
    </div>
  );
};

export default ChildrenPrivacy;
