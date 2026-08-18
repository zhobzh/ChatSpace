const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

// 所有其他注册用户，用于"点击某人发起私聊"这个列表
export async function fetchAllUsers() {
  const res = await fetch(`${API_BASE}/users`, { credentials: "include" });
  if (!res.ok) throw new Error("获取用户列表失败");
  return res.json();
}

// 点击某个用户发起私聊：后端会找到已有的私聊频道，没有就新建一个
export async function startDM(targetUserId) {
  const res = await fetch(`${API_BASE}/channels/dm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ targetUserId }),
  });
  if (!res.ok) throw new Error("发起私聊失败");
  return res.json();
}

export async function createChannel(name, type = "public") {
  const res = await fetch(`${API_BASE}/channels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name, type }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "创建频道失败");
  return data;
}

export async function addChannelMember(channelId, userId) {
  const res = await fetch(`${API_BASE}/channels/${channelId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ userId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "添加成员失败");
  return data;
}

export async function fetchMentionableUsers(channelId) {
  const res = await fetch(`${API_BASE}/channels/${channelId}/mentionable-users`, { credentials: "include" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "获取频道成员失败");
  return data;
}

export async function fetchChannelMembers(channelId) {
  const res = await fetch(`${API_BASE}/channels/${channelId}/members`, { credentials: "include" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "获取频道成员失败");
  return data;
}

export async function updateChannel(channelId, payload) {
  const res = await fetch(`${API_BASE}/channels/${channelId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    credentials: "include", body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "更新频道失败");
  return data;
}

export async function removeChannelMember(channelId, userId) {
  const res = await fetch(`${API_BASE}/channels/${channelId}/members/${userId}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "移除成员失败");
  }
}

export async function searchChannelMessages(channelId, query) {
  const res = await fetch(`${API_BASE}/channels/${channelId}/messages/search?q=${encodeURIComponent(query)}`, { credentials: "include" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "搜索失败");
  return data;
}
