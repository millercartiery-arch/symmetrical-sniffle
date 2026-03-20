import React from 'react';
import { useRouteError, isRouteErrorResponse, useNavigate } from 'react-router-dom';
import { Button } from 'antd';

/**
 * 路由级错误展示（React Router errorElement）
 * 当路由加载或渲染抛错时显示，便于商业环境排查与恢复。
 */
const RouteErrorFallback: React.FC = () => {
  const error = useRouteError();
  const navigate = useNavigate();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`.trim() || error.data?.message || '请求失败'
    : error instanceof Error
      ? error.message
      : String(error);

  return (
    <div
      style={{
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 560,
        margin: '40px auto',
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
      }}
    >
      <h2 style={{ color: '#c00', marginTop: 0 }}>页面加载出错</h2>
      <p style={{ color: '#475569' }}>请刷新重试，或返回首页。若问题持续，请联系管理员并附上下方信息。</p>
      <pre
        style={{
          background: '#f5f5f5',
          padding: 12,
          overflow: 'auto',
          fontSize: 12,
          border: '1px solid #eee',
          borderRadius: 8,
        }}
      >
        {message}
      </pre>
      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <Button type="primary" onClick={() => navigate('/')}>
          返回首页
        </Button>
        <Button onClick={() => window.location.reload()}>刷新页面</Button>
      </div>
    </div>
  );
};

export default RouteErrorFallback;
