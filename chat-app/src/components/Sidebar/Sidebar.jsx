import { useContext, useEffect, useState } from "react";
import { ChatContext } from "../../context/ChatContext";
import { addChannelMember, createChannel, fetchAllUsers, fetchChannelMembers, removeChannelMember, startDM } from "../../api/channels";
import "./Sidebar.css";
import { useAuth } from "../../context/AuthContext";
import { avatarUrl } from "../../api/profiles";
import ProfilePanel from "../Profile/ProfilePanel";
import ProfileViewer from "../Profile/ProfileViewer";

function Avatar({ userId, name, avatarVersion, status = "offline" }) {
  return (
    <span className="sidebar-avatar" aria-hidden="true">
      {avatarVersion ? <img src={avatarUrl(userId, avatarVersion)} alt="" /> : (name || "?").trim().slice(0, 1).toUpperCase()}
      <span className={`sidebar-presence ${status}`} />
    </span>
  );
}

export default function Sidebar({ onSwitchChannel, send }) {
  const { state, dispatch } = useContext(ChatContext);
  const { user, updateUser } = useAuth();
  const [allUsers, setAllUsers] = useState([]);
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [channelType, setChannelType] = useState("public");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [inviteChannelId, setInviteChannelId] = useState(null);
  const [inviteUserId, setInviteUserId] = useState("");
  const [channelMembers, setChannelMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const [viewingUserId, setViewingUserId] = useState(null);

  useEffect(() => {
    fetchAllUsers().then(setAllUsers).catch(console.error);
  }, []);

  useEffect(() => {
    setAllUsers((items) => items.map((item) => {
      const live = state.users.find((userItem) => userItem.id === item.id);
      return live ? { ...item, ...live } : item;
    }));
  }, [state.users]);

  const matches = (value) =>
    (value || "").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());

  const publicChannels = state.channels.filter(
    (channel) => channel.type !== "dm" && matches(channel.name)
  );
  const directChannels = state.channels.filter(
    (channel) => channel.type === "dm" && matches(channel.partner?.nickname)
  );
  const visibleUsers = allUsers.filter((user) => matches(user.nickname));

  const handleClickUser = async (targetUserId) => {
    try {
      const channel = await startDM(targetUserId);
      const normalizedChannel = {
        ...channel,
        partner: channel.partner || (channel.targetUser && {
          user_id: channel.targetUser.id,
          nickname: channel.targetUser.nickname,
        }),
      };
      dispatch({ type: "ADD_CHANNEL", payload: normalizedChannel });
      onSwitchChannel(channel.id);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    const name = channelName.trim();
    if (!name) return;
    setSubmitting(true);
    setError("");
    try {
      const channel = await createChannel(name, channelType);
      dispatch({ type: "ADD_CHANNEL", payload: channel });
      setChannelName("");
      setShowCreate(false);
      onSwitchChannel(channel.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleInvite = async (event) => {
    event.preventDefault();
    if (!inviteChannelId || !inviteUserId) return;
    setInviting(true);
    setError("");
    try {
      await addChannelMember(inviteChannelId, inviteUserId);
      const invited = allUsers.find((user) => user.id === inviteUserId);
      if (invited) setChannelMembers((members) => [...members, { ...invited, role: "member" }]);
      setNotice(`已添加 ${invited?.nickname || "该用户"}`);
      setInviteUserId("");
      window.setTimeout(() => setNotice(""), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setInviting(false);
    }
  };

  const toggleMembers = async (channelId) => {
    if (inviteChannelId === channelId) {
      setInviteChannelId(null);
      return;
    }
    setInviteChannelId(channelId);
    setInviteUserId("");
    setError("");
    setLoadingMembers(true);
    try { setChannelMembers(await fetchChannelMembers(channelId)); }
    catch (err) { setError(err.message); setChannelMembers([]); }
    finally { setLoadingMembers(false); }
  };

  const removeMember = async (member) => {
    if (!window.confirm(`确定将 ${member.nickname} 移出频道吗？`)) return;
    try {
      await removeChannelMember(inviteChannelId, member.id);
      setChannelMembers((members) => members.filter((item) => item.id !== member.id));
      setNotice(`已移除 ${member.nickname}`);
    } catch (err) { setError(err.message); }
  };

  const unreadBadge = (channelId) => {
    const count = state.unreadByChannel[channelId] || 0;
    return <>{state.mentionedByChannel[channelId] && <span className="sidebar-mention-badge">@</span>}{count > 0 && <span className="sidebar-unread">{count > 99 ? "99+" : count}</span>}</>;
  };

  return (
    <aside className="sidebar-panel">
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">C</div>
        <div><strong>Chatspace</strong><span>{state.count} 人在线</span></div>
      </div>

      <label className="sidebar-search">
        <span aria-hidden="true">⌕</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索频道或用户" aria-label="搜索频道或用户" />
      </label>

      <div className="sidebar-scroll">
        <section className="sidebar-section">
          <div className="sidebar-section-title">
            <span>频道</span>
            <button className="sidebar-icon-button" onClick={() => { setShowCreate((visible) => !visible); setError(""); }} aria-label="创建新频道" title="创建新频道">+</button>
          </div>

          {showCreate && (
            <form className="channel-create-card" onSubmit={handleCreate}>
              <div className="channel-create-heading">创建新频道</div>
              <input autoFocus maxLength={100} value={channelName} onChange={(event) => setChannelName(event.target.value)} placeholder="例如：产品讨论" />
              <div className="channel-type-switch" role="group" aria-label="频道类型">
                <button type="button" className={channelType === "public" ? "selected" : ""} onClick={() => setChannelType("public")}>公开</button>
                <button type="button" className={channelType === "private" ? "selected" : ""} onClick={() => setChannelType("private")}>私密</button>
              </div>
              <div className="channel-create-actions">
                <button type="button" onClick={() => setShowCreate(false)}>取消</button>
                <button className="primary" disabled={submitting || !channelName.trim()}>{submitting ? "创建中…" : "创建"}</button>
              </div>
            </form>
          )}

          {publicChannels.map((channel) => (
            <div className="sidebar-channel-row" key={channel.id}>
              <button className={`sidebar-item ${channel.id === state.currentChannelId ? "active" : ""}`} onClick={() => onSwitchChannel(channel.id)}>
                <span className="channel-symbol">{channel.type === "private" ? "⌁" : "#"}</span>
                <span className="sidebar-item-label">{channel.name}</span>
                {unreadBadge(channel.id)}
                {channel.type === "private" && <span className="sidebar-tag">私密</span>}
              </button>
              <button className="channel-invite-button" title="查看频道成员" aria-label={`查看 ${channel.name} 的成员`} onClick={() => toggleMembers(channel.id)}>♙</button>
            </div>
          ))}
          {inviteChannelId && (
            <div className="channel-invite-card">
              <div className="channel-members-heading"><strong>频道成员</strong><span>{channelMembers.length}</span></div>
              {loadingMembers ? <div className="sidebar-empty">正在加载…</div> : (
                <div className="channel-member-list">
                  {channelMembers.map((member) => (
                    <div className="channel-member" key={member.id}>
                      <Avatar userId={member.id} name={member.nickname} avatarVersion={member.avatarVersion} status={state.users.find((item) => item.id === member.id)?.status || "offline"} />
                      <span>{member.nickname}</span>{member.role === "admin" && <small>管理员</small>}
                      {state.channels.find((channel) => channel.id === inviteChannelId)?.type === "private" && state.channels.find((channel) => channel.id === inviteChannelId)?.role === "admin" && member.role !== "admin" && member.id !== user.id && <button className="member-remove-button" onClick={() => removeMember(member)}>移除</button>}
                    </div>
                  ))}
                </div>
              )}
              {state.channels.find((channel) => channel.id === inviteChannelId)?.role === "admin" && (() => {
                const memberIds = new Set(channelMembers.map((member) => member.id));
                const availableUsers = allUsers.filter((user) => !memberIds.has(user.id));
                return availableUsers.length > 0 ? (
                  <form className="channel-member-add" onSubmit={handleInvite}>
                    <div className="channel-create-heading">添加新成员</div>
                    <select value={inviteUserId} onChange={(event) => setInviteUserId(event.target.value)}>
                      <option value="">选择尚未加入的用户…</option>
                      {availableUsers.map((user) => <option key={user.id} value={user.id}>{user.nickname}</option>)}
                    </select>
                    <div className="channel-create-actions"><button type="button" onClick={() => setInviteChannelId(null)}>关闭</button><button className="primary" disabled={inviting || !inviteUserId}>{inviting ? "添加中…" : "添加"}</button></div>
                  </form>
                ) : <div className="all-members-added">所有用户都已在频道中</div>;
              })()}
            </div>
          )}
          {publicChannels.length === 0 && <div className="sidebar-empty">没有匹配的频道</div>}
        </section>

        <section className="sidebar-section">
          <div className="sidebar-section-title"><span>私聊</span></div>
          {directChannels.map((channel) => {
            const partner = channel.partner;
            return (
              <button key={channel.id} className={`sidebar-item ${channel.id === state.currentChannelId ? "active" : ""}`} onClick={() => onSwitchChannel(channel.id)}>
                <Avatar userId={partner?.user_id} name={partner?.nickname} avatarVersion={partner?.avatarVersion} status={state.users.find((item) => item.id === partner?.user_id)?.status || "offline"} />
                <span className="sidebar-item-label">{partner?.nickname || "私聊"}</span>
                {unreadBadge(channel.id)}
              </button>
            );
          })}
        </section>

        <section className="sidebar-section">
          <div className="sidebar-section-title"><span>联系人</span><span className="sidebar-count">{visibleUsers.length}</span></div>
          {visibleUsers.map((user) => (
            <div className="sidebar-contact-row" key={user.id}>
            <button className="sidebar-item" onClick={() => handleClickUser(user.id)}>
              <Avatar userId={user.id} name={user.nickname} avatarVersion={user.avatarVersion} status={state.users.find((item) => item.id === user.id)?.status || "offline"} />
              <span className="sidebar-item-label">{user.nickname}</span>
              <span className="sidebar-item-action">发消息</span>
            </button>
            <button className="contact-profile-button" onClick={() => setViewingUserId(user.id)}>资料</button>
            </div>
          ))}
        </section>
      </div>

      <button className="sidebar-profile-card" onClick={() => setShowProfile(true)}>
        <Avatar userId={user.id} name={user.nickname} avatarVersion={state.users.find((item) => item.id === user.id)?.avatarVersion} status={state.users.find((item) => item.id === user.id)?.status || "online"} />
        <span><strong>{user.nickname}</strong><small>查看个人资料</small></span><b>•••</b>
      </button>

      {notice && <div className="sidebar-notice" role="status">{notice}</div>}
      {error && <div className="sidebar-error" role="alert">{error}</div>}
      {showProfile && <ProfilePanel send={send} onClose={() => setShowProfile(false)} onUpdated={(profile) => { updateUser({ nickname: profile.nickname }); dispatch({ type: "PROFILE_UPDATED", payload: profile }); }} />}
      {viewingUserId && <ProfileViewer userId={viewingUserId} liveStatus={state.users.find((item) => item.id === viewingUserId)?.status || "offline"} onClose={() => setViewingUserId(null)} onMessage={handleClickUser} />}
    </aside>
  );
}
