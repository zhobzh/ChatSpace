const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

export function attachmentUrl(id) {
  return `${API_BASE}/uploads/${id}/content`;
}

export function uploadAttachment(file, channelId, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/uploads`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("X-Channel-Id", channelId);
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || "上传失败"));
    };
    xhr.onerror = () => reject(new Error("网络错误，上传失败"));
    xhr.send(file);
  });
}

export async function deleteAttachment(id) {
  await fetch(`${API_BASE}/uploads/${id}`, { method: "DELETE", credentials: "include" });
}
