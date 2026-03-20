import React, { useState } from 'react';

export default function App() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = () => {
    if(code.length !== 4) {
      alert('验证码必须是4位！');
      return;
    }
    alert(`账号: ${username}\n密码: ${password}\n验证码: ${code}`);
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Cartier & Miller</h1>
      <div style={styles.form}>
        <input
          style={styles.input}
          type="text"
          placeholder="账号"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <div style={{ position: 'relative', width: '100%' }}>
          <input
            style={{ ...styles.input, paddingRight: '40px' }}
            type={showPassword ? 'text' : 'password'}
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span
            style={styles.showPassword}
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? '🙈' : '👁️'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            style={{ ...styles.input, flex: 1 }}
            type="text"
            maxLength={4}
            placeholder="验证码"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} // 只允许数字
          />
          <div style={styles.captcha}>
            {generateCaptcha()}
          </div>
        </div>
        <button style={styles.button} onClick={handleLogin}>
          登录
        </button>
      </div>
    </div>
  );
}

// 随机生成4位数字验证码（每次渲染刷新）
function generateCaptcha() {
  const code = Math.floor(1000 + Math.random() * 9000);
  return code;
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    width: '100%',
    padding: '40px',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: '12px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  title: {
    marginBottom: '30px',
    fontSize: '28px',
    fontWeight: 700,
    color: '#333',
  },
  form: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  input: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: '8px',
    border: '1px solid #ccc',
    fontSize: '16px',
  },
  button: {
    width: '100%',
    padding: '12px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#6C63FF',
    color: '#fff',
    fontSize: '16px',
    cursor: 'pointer',
    marginTop: '10px',
  },
  showPassword: {
    position: 'absolute',
    right: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    cursor: 'pointer',
    fontSize: '18px',
  },
  captcha: {
    padding: '12px 16px',
    backgroundColor: '#f0f0f0',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 700,
    userSelect: 'none',
  },
};