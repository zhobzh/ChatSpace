import { useContext, useEffect, useState } from "react";
import { ChatContext } from "../../context/ChatContext";
import { searchChannelMessages, updateChannel } from "../../api/channels";
import "./ChannelHeader.css";

export default function ChannelHeader({ user, logout }) {
  const { state, dispatch } = useContext(ChatContext);
  const channel = state.channels.find((item) => item.id === state.currentChannelId);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", announcement: "" });
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    if (channel) setForm({ name: channel.name || "", description: channel.description || "", announcement: channel.announcement || "" });
  }, [channel]);

  if (!channel) return <header className="channel-header"><span>选择一个频道</span><button onClick={logout}>退出登录</button></header>;
  const label = channel.type === "dm" ? channel.partner?.nickname || "私聊" : channel.name;

  const save = async (event) => {
    event.preventDefault(); setError("");
    try { const updated = await updateChannel(channel.id, form); dispatch({ type: "UPDATE_CHANNEL", payload: updated }); setEditing(false); }
    catch (err) { setError(err.message); }
  };

  const search = async (event) => {
    event.preventDefault(); setSearchError(""); setHasSearched(false);
    if (searchQuery.trim().length < 2) return setSearchError("至少输入 2 个字符");
    setSearchLoading(true);
    try { setSearchResults(await searchChannelMessages(channel.id, searchQuery.trim())); setHasSearched(true); }
    catch (err) { setSearchError(err.message); }
    finally { setSearchLoading(false); }
  };

  return (
    <>
      <header className="channel-header">
        <div className="channel-heading"><div><strong>{channel.type === "dm" ? "" : "# "}{label}</strong>{channel.description && <span>{channel.description}</span>}</div>
          {channel.role === "admin" && channel.type !== "dm" && <button className="channel-settings" onClick={() => setEditing(true)}>编辑频道</button>}
        </div>
        <button className={`channel-search-button ${searching ? "active" : ""}`} onClick={() => setSearching((value) => !value)}>搜索记录</button>
        <div className="channel-account"><span>{user.nickname}</span><button onClick={logout}>退出</button></div>
      </header>
      {channel.announcement && <div className="channel-announcement"><b>公告</b><span>{channel.announcement}</span></div>}
      {searching && <aside className="channel-search-panel" aria-label="搜索聊天记录">
        <div className="channel-search-title"><strong>搜索聊天记录</strong><button onClick={() => setSearching(false)} aria-label="关闭搜索">×</button></div>
        <form onSubmit={search}><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索当前频道消息…" /><button disabled={searchLoading}>{searchLoading ? "搜索中" : "搜索"}</button></form>
        {searchError && <div className="channel-search-error">{searchError}</div>}
        <div className="channel-search-results">{searchResults.map((result) => <div key={result.id}><strong>{result.nickname}</strong><time>{new Date(result.timestamp).toLocaleString("zh-CN")}</time><p>{result.text}</p></div>)}{hasSearched && !searchError && searchResults.length === 0 && <span>没有搜索结果</span>}</div>
      </aside>}
      {editing && <div className="channel-edit-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setEditing(false)}>
        <form className="channel-edit-modal" onSubmit={save}>
          <div className="channel-edit-title"><strong>频道资料</strong><button type="button" onClick={() => setEditing(false)}>×</button></div>
          <label>频道名称<input maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>频道描述<input maxLength={300} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="简要说明频道用途" /><small>{form.description.length}/300</small></label>
          <label>频道公告<textarea rows={4} maxLength={1000} value={form.announcement} onChange={(event) => setForm({ ...form, announcement: event.target.value })} placeholder="向频道成员发布重要信息…" /><small>{form.announcement.length}/1000</small></label>
          {error && <div className="channel-edit-error">{error}</div>}
          <div className="channel-edit-actions"><button type="button" onClick={() => setEditing(false)}>取消</button><button className="primary" disabled={!form.name.trim()}>保存</button></div>
        </form>
      </div>}
    </>
  );
}
