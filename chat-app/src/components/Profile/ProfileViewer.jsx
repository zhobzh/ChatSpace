import { useEffect, useState } from "react";
import { avatarUrl, fetchProfile } from "../../api/profiles";
import "./ProfilePanel.css";

const statusLabel = { online: "在线", busy: "忙碌", away: "离开", offline: "离线" };

export default function ProfileViewer({ userId, liveStatus = "offline", onClose, onMessage }) {
  const [profile, setProfile] = useState(null);
  useEffect(() => { fetchProfile(userId).then(setProfile); }, [userId]);
  return (
    <div className="profile-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="profile-panel profile-viewer" role="dialog" aria-modal="true" aria-label="员工资料">
        <button className="profile-close" onClick={onClose} aria-label="关闭">×</button><div className="profile-cover" />
        {!profile ? <div className="profile-loading">正在加载个人资料…</div> : <div className="profile-view-content">
          <div className="profile-avatar-large">{profile.avatarVersion ? <img src={avatarUrl(profile.userId, profile.avatarVersion)} alt={`${profile.nickname}的头像`} /> : profile.nickname.slice(0,1)}<span className={`profile-status-dot ${liveStatus}`} /></div>
          <h2>{profile.nickname}</h2><div className="profile-real-name">{profile.fullName || "尚未填写姓名"}</div>
          <div className={`profile-live-status ${liveStatus}`}><i />{statusLabel[liveStatus]}</div>
          <blockquote>{profile.bio || "这个人还没有填写个性签名。"}</blockquote>
          <button className="profile-save" onClick={() => { onMessage(userId); onClose(); }}>发送消息</button>
        </div>}
      </section>
    </div>
  );
}
