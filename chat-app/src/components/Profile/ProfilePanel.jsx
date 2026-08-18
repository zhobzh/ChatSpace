import { useEffect, useRef, useState } from "react";
import { avatarUrl, fetchMyProfile, updateMyProfile, uploadAvatar } from "../../api/profiles";
import "./ProfilePanel.css";

const statusOptions = [
  ["online", "在线"], ["busy", "忙碌"], ["away", "离开"],
];

export default function ProfilePanel({ onClose, onUpdated, send }) {
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ nickname: "", fullName: "", bio: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    fetchMyProfile().then((data) => { setProfile(data); setForm(data); }).catch((err) => setError(err.message));
    const close = (event) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  const save = async (event) => {
    event.preventDefault(); setSaving(true); setError("");
    try { const data = await updateMyProfile(form); setProfile(data); onUpdated(data); }
    catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const changeAvatar = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setError("头像不能超过 5 MB");
    try { const data = await uploadAvatar(file); setProfile(data); onUpdated(data); }
    catch (err) { setError(err.message); }
    if (fileRef.current) fileRef.current.value = "";
  };

  const changeStatus = (status) => {
    setProfile((current) => ({ ...current, preferredStatus: status, status }));
    send({ type: "presence", status });
  };

  return (
    <div className="profile-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="profile-panel" role="dialog" aria-modal="true" aria-label="个人资料">
        <button className="profile-close" onClick={onClose} aria-label="关闭">×</button>
        <div className="profile-cover" />
        {!profile ? <div className="profile-loading">正在加载个人资料…</div> : (
          <form onSubmit={save}>
            <div className="profile-avatar-wrap">
              <div className="profile-avatar-large">
                {profile.avatarVersion ? <img src={avatarUrl(profile.userId, profile.avatarVersion)} alt="我的头像" /> : profile.nickname.slice(0, 1).toUpperCase()}
                <span className={`profile-status-dot ${profile.status}`} />
              </div>
              <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(event) => changeAvatar(event.target.files[0])} />
              <button type="button" className="profile-avatar-edit" onClick={() => fileRef.current?.click()}>更换头像</button>
            </div>

            <div className="profile-title"><h2>{profile.nickname}</h2><span>{profile.email}</span></div>
            <div className="profile-status-picker">
              {statusOptions.map(([value, label]) => <button type="button" key={value} className={profile.preferredStatus === value ? "selected" : ""} onClick={() => changeStatus(value)}><i className={value} />{label}</button>)}
            </div>

            <label>显示昵称<input maxLength={100} value={form.nickname} onChange={(event) => setForm({ ...form, nickname: event.target.value })} /></label>
            <label>姓名<input maxLength={100} value={form.fullName || ""} onChange={(event) => setForm({ ...form, fullName: event.target.value })} placeholder="填写真实姓名" /></label>
            <label>个性签名<textarea maxLength={160} rows={3} value={form.bio || ""} onChange={(event) => setForm({ ...form, bio: event.target.value })} placeholder="介绍一下自己…" /><small>{(form.bio || "").length}/160</small></label>
            {error && <div className="profile-error">{error}</div>}
            <button className="profile-save" disabled={saving || !form.nickname.trim()}>{saving ? "保存中…" : "保存资料"}</button>
          </form>
        )}
      </section>
    </div>
  );
}
