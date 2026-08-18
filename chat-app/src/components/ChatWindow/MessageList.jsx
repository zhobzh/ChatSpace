import { useContext } from "react";
import { ChatContext } from "../../context/ChatContext";
import { attachmentUrl } from "../../api/uploads";
import { avatarUrl } from "../../api/profiles";

const formatSize = (bytes) => bytes >= 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function renderMessageText(message) {
  if (!message.mentions?.length) return message.text;
  const names = message.mentions.map((item) => item.nickname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(@(?:${names.join("|")}))`, "gu");
  return message.text.split(pattern).map((part, index) =>
    part.startsWith("@") && message.mentions.some((item) => `@${item.nickname}` === part)
      ? <span className="message-mention" key={`${part}-${index}`}>{part}</span>
      : part
  );
}

export default function MessageList({ send }) {
  const { state } = useContext(ChatContext);
  const messages = state.messagesByChannel[state.currentChannelId] || [];
  const formatTime = (timestamp) => new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(timestamp);
  const formatDate = (timestamp) => new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(timestamp);

  return (
    <div className="message-list">
      {state.historyHasMore[state.currentChannelId] && messages[0] && (
        <button className="load-history-button" onClick={() => send({ type: "load_history", channelId: state.currentChannelId, before: messages[0].timestamp })}>加载更早的聊天记录</button>
      )}
      {messages.map((msg, index) => (
        <div key={msg.id}>
        {(index === 0 || new Date(messages[index - 1].timestamp).toDateString() !== new Date(msg.timestamp).toDateString()) && (
          <div className="message-date-separator"><span>{formatDate(msg.timestamp)}</span></div>
        )}
        <div key={msg.id} className="message-item">
          <div className="message-avatar">{msg.avatarVersion ? <img src={avatarUrl(msg.userId, msg.avatarVersion)} alt="" /> : (msg.nickname || "?").slice(0, 1).toUpperCase()}</div>
          <div className="message-body">
          <div className="message-author">{msg.nickname}<time dateTime={new Date(msg.timestamp).toISOString()}>{formatTime(msg.timestamp)}</time></div>
          {msg.text && <div className="message-text">{renderMessageText(msg)}</div>}
          {msg.attachments?.length > 0 && (
            <div className="message-attachments">
              {msg.attachments.map((attachment) => attachment.kind === "image" ? (
                <a className="message-image" key={attachment.id} href={attachmentUrl(attachment.id)} target="_blank" rel="noreferrer">
                  <img src={attachmentUrl(attachment.id)} alt={attachment.originalName} loading="lazy" />
                </a>
              ) : (
                <a className="message-file" key={attachment.id} href={attachmentUrl(attachment.id)}>
                  <span className="message-file-icon">↧</span>
                  <span><strong>{attachment.originalName}</strong><small>{formatSize(attachment.size)}</small></span>
                  <span className="message-file-download">下载</span>
                </a>
              ))}
            </div>
          )}
          </div>
        </div>
        </div>
      ))}
    </div>
  );
}
