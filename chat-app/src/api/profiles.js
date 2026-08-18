const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

async function parse(res) {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "操作失败");
  return data;
}

export const avatarUrl = (userId, version) =>
  `${API_BASE}/profiles/${userId}/avatar${version ? `?v=${version}` : ""}`;

export async function fetchMyProfile() {
  return parse(await fetch(`${API_BASE}/profiles/me`, { credentials: "include" }));
}

export async function fetchProfile(userId) {
  return parse(await fetch(`${API_BASE}/profiles/${userId}`, { credentials: "include" }));
}

export async function updateMyProfile(payload) {
  return parse(await fetch(`${API_BASE}/profiles/me`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    credentials: "include", body: JSON.stringify(payload),
  }));
}

export async function uploadAvatar(file) {
  return parse(await fetch(`${API_BASE}/profiles/me/avatar`, {
    method: "POST", headers: { "Content-Type": file.type }, credentials: "include", body: file,
  }));
}
