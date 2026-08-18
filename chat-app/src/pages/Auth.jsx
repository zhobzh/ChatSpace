import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import "../styles/auth.css";

export default function Auth() {
  const { login, register, sendVerificationCode } = useAuth();
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [codeNotice, setCodeNotice] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(email, password, verificationCode);
      } else {
        await register(email, password, nickname, verificationCode);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function requestCode() {
    setError(""); setSendingCode(true);
    try {
      const data = await sendVerificationCode(email);
      setCodeNotice(data.devCode ? `开发验证码：${data.devCode}` : "验证码已发送，请检查邮箱");
      if (data.devCode) setVerificationCode(data.devCode);
    } catch (err) { setError(err.message); }
    finally { setSendingCode(false); }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>{mode === "login" ? "登录" : "注册"}</h1>

        <label>
          邮箱
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        {mode === "register" && (
          <>
          <label>
            昵称（可选）
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>
          </>
        )}

        <label>邮箱验证码<div className="auth-code-row"><input inputMode="numeric" maxLength={6} value={verificationCode} onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ""))} required /><button type="button" onClick={requestCode} disabled={sendingCode || !email}>{sendingCode ? "发送中" : "获取验证码"}</button></div></label>
        {codeNotice && <p className="auth-notice">{codeNotice}</p>}

        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>

        {error && <p className="auth-error">{error}</p>}

        <button type="submit" disabled={submitting}>
          {submitting ? "处理中..." : mode === "login" ? "登录" : "注册"}
        </button>

        <p className="auth-switch">
          {mode === "login" ? "还没有账号？" : "已经有账号？"}
          <button
            type="button"
            className="link-btn"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "去注册" : "去登录"}
          </button>
        </p>
      </form>
    </div>
  );
}
