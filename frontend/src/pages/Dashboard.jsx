import { useEffect, useState } from 'react';
import './Login.css';

const TOKEN_KEY = 'easydca_token';

function Dashboard() {
  const [token, setToken] = useState(null);

  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_KEY));
  }, []);

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">EasyDCA</div>
        <div className="login-status">
          {token ? 'Dashboard (กำลังพัฒนา)' : 'กรุณาเข้าสู่ระบบก่อนใช้งาน'}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
