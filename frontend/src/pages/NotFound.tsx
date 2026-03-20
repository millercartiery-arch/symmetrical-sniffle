import React from "react";
import { Result, Button } from "antd";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

const NotFound: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <Result
      status="404"
      title="404"
      subTitle={t("common.not_found", { defaultValue: "页面不存在" })}
      extra={
        <Button type="primary" onClick={() => navigate("/")}>
          {t("common.back", { defaultValue: "返回首页" })}
        </Button>
      }
    />
  );
};

export default NotFound;
