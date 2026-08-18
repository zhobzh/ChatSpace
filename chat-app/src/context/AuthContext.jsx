import { createContext, useContext, useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

export const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // 页面刷新时，靠 cookie 去问后端“我是谁”
  useEffect(() => {
    fetch(`${API_BASE}/auth/me`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUser(data))
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password, verificationCode) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password, verificationCode }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "登录失败");
    setUser(data);
    return data;
  }

  async function register(email, password, nickname, verificationCode) {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password, nickname, verificationCode }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "注册失败");
    setUser(data);
    return data;
  }

  async function sendVerificationCode(email) {
    const res = await fetch(`${API_BASE}/auth/send-verification-code`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "验证码发送失败");
    return data;
  }

  async function logout() {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    setUser(null);
  }

  function updateUser(changes) {
    setUser((current) => current ? { ...current, ...changes } : current);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, sendVerificationCode, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
