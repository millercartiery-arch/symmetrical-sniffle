import React from 'react';

type State = { hasError: boolean; error: Error | null };

export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[AppErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <div
          style={{
            padding: 24,
            fontFamily: 'system-ui, sans-serif',
            maxWidth: 640,
            margin: '40px auto',
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
          }}
        >
          <h2 style={{ color: '#c00', marginTop: 0 }}>页面加载出错</h2>
          <p style={{ color: '#475569' }}>请刷新重试。若仍白屏，请按 F12 打开控制台查看报错。</p>
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
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              cursor: 'pointer',
              borderRadius: 8,
              border: '1px solid #ddd',
              background: '#fff',
            }}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
