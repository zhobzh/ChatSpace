import { useContext, useEffect, useRef, useState } from "react";
import { ChatContext } from "../../context/ChatContext";
import { deleteAttachment, uploadAttachment } from "../../api/uploads";
import { fetchMentionableUsers } from "../../api/channels";

const MAX_LENGTH = 2000;
const EMOJI_GROUPS = [
  { label: "常用", emojis: ["😀", "😂", "😊", "😍", "🥰", "😎", "🤔", "😭", "😅", "🥳", "😴", "🙃"] },
  { label: "手势", emojis: ["👍", "👎", "👏", "🙌", "🙏", "💪", "👌", "✌️", "🤝", "👋", "🫶", "🤞"] },
  { label: "符号", emojis: ["❤️", "🔥", "✨", "🎉", "💯", "✅", "❌", "⭐", "💡", "🚀", "👀", "💬"] },
];

export default function MessageInput({ send, connected }) {
  const [text, setText] = useState("");
  const [sendError, setSendError] = useState("");
  const { state } = useContext(ChatContext);
  const textareaRef = useRef(null);
  const typingTimerRef = useRef(null);
  const composingRef = useRef(false);
  const fileInputRef = useRef(null);
  const activeChannelRef = useRef(state.currentChannelId);
  const [attachments, setAttachments] = useState([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [mentionableUsers, setMentionableUsers] = useState([]);
  const [mentionQuery, setMentionQuery] = useState(null);
  const [mentionStart, setMentionStart] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [selectedMentions, setSelectedMentions] = useState([]);
  const composerRef = useRef(null);

  const hasReadyAttachments = attachments.some((item) => item.status === "ready");
  const isUploading = attachments.some((item) => item.status === "uploading");
  const canSend = connected && !!state.currentChannelId && (!!text.trim() || hasReadyAttachments) && !isUploading;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
  }, [text]);

  useEffect(() => () => window.clearTimeout(typingTimerRef.current), []);

  useEffect(() => {
    if (!showEmojiPicker) return;
    const closePicker = (event) => {
      if (event.key === "Escape") setShowEmojiPicker(false);
    };
    const closeOnOutsideClick = (event) => {
      if (!composerRef.current?.contains(event.target)) setShowEmojiPicker(false);
    };
    document.addEventListener("keydown", closePicker);
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => {
      document.removeEventListener("keydown", closePicker);
      document.removeEventListener("pointerdown", closeOnOutsideClick);
    };
  }, [showEmojiPicker]);

  useEffect(() => {
    activeChannelRef.current = state.currentChannelId;
    setAttachments((items) => {
      items.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        if (item.id) deleteAttachment(item.id).catch(() => {});
      });
      return [];
    });
  }, [state.currentChannelId]);

  useEffect(() => {
    if (!state.currentChannelId) return setMentionableUsers([]);
    fetchMentionableUsers(state.currentChannelId).then(setMentionableUsers).catch(() => setMentionableUsers([]));
    setMentionQuery(null);
    setSelectedMentions([]);
  }, [state.currentChannelId]);

  const notifyTyping = () => {
    if (!connected || !state.currentChannelId) return;
    send({ type: "typing", typing: true, channelId: state.currentChannelId });
    window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      send({ type: "typing", typing: false, channelId: state.currentChannelId });
    }, 1200);
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if ((!trimmed && !hasReadyAttachments) || !state.currentChannelId || !connected || isUploading) return;
    const sent = send({
      type: "message",
      text: trimmed,
      channelId: state.currentChannelId,
      attachmentIds: attachments.filter((item) => item.status === "ready").map((item) => item.id),
      mentionIds: selectedMentions.filter((mention) => text.includes(`@${mention.nickname}`)).map((mention) => mention.id),
    });
    if (!sent) {
      setSendError("连接暂时不可用，消息已为你保留");
      return;
    }
    window.clearTimeout(typingTimerRef.current);
    send({ type: "typing", typing: false, channelId: state.currentChannelId });
    setText("");
    setSelectedMentions([]);
    setMentionQuery(null);
    attachments.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
    setAttachments([]);
    setSendError("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleFiles = (fileList) => {
    const available = Math.max(0, 5 - attachments.length);
    const files = Array.from(fileList).slice(0, available);
    files.forEach((file) => {
      if (file.size > 20 * 1024 * 1024) {
        setSendError(`${file.name} 超过 20 MB`);
        return;
      }
      if (file.type.startsWith("video/")) {
        setSendError("暂不支持视频文件");
        return;
      }
      const localId = crypto.randomUUID();
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      setAttachments((items) => [...items, { localId, file, previewUrl, status: "uploading", progress: 0 }]);
      uploadAttachment(file, state.currentChannelId, (progress) => {
        setAttachments((items) => items.map((item) => item.localId === localId ? { ...item, progress } : item));
      }).then((uploaded) => {
        if (activeChannelRef.current !== uploaded.channelId) {
          deleteAttachment(uploaded.id).catch(() => {});
          return;
        }
        setAttachments((items) => items.map((item) => item.localId === localId ? { ...item, ...uploaded, status: "ready", progress: 100 } : item));
      }).catch((error) => {
        setAttachments((items) => items.map((item) => item.localId === localId ? { ...item, status: "error", error: error.message } : item));
      });
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (item) => {
    if (item.id) deleteAttachment(item.id).catch(() => {});
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setAttachments((items) => items.filter((candidate) => candidate.localId !== item.localId));
  };

  const insertEmoji = (emoji) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? text.length;
    const end = textarea?.selectionEnd ?? text.length;
    const nextText = `${text.slice(0, start)}${emoji}${text.slice(end)}`.slice(0, MAX_LENGTH);
    setText(nextText);
    setSendError("");
    notifyTyping();
    requestAnimationFrame(() => {
      const cursor = Math.min(start + emoji.length, nextText.length);
      textarea?.focus();
      textarea?.setSelectionRange(cursor, cursor);
    });
  };

  const handleKeyDown = (event) => {
    if (mentionQuery !== null && filteredMentions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setMentionIndex((index) => (index + direction + filteredMentions.length) % filteredMentions.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        insertMention(filteredMentions[mentionIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault(); setMentionQuery(null); return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !composingRef.current) {
      event.preventDefault();
      handleSend();
    }
  };

  const filteredMentions = mentionQuery === null ? [] : mentionableUsers
    .filter((item) => item.nickname.toLocaleLowerCase().includes(mentionQuery.toLocaleLowerCase()))
    .slice(0, 6);

  const detectMention = (value, cursor) => {
    const beforeCursor = value.slice(0, cursor);
    const match = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/u);
    if (!match) return setMentionQuery(null);
    setMentionQuery(match[1]);
    setMentionStart(cursor - match[1].length - 1);
    setMentionIndex(0);
  };

  const insertMention = (user) => {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? text.length;
    const insertion = `@${user.nickname} `;
    const nextText = `${text.slice(0, mentionStart)}${insertion}${text.slice(cursor)}`.slice(0, MAX_LENGTH);
    setText(nextText);
    setSelectedMentions((items) => items.some((item) => item.id === user.id) ? items : [...items, user]);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const nextCursor = Math.min(mentionStart + insertion.length, nextText.length);
      textarea?.focus(); textarea?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const placeholder = !state.currentChannelId
    ? "先选择一个频道"
    : connected
      ? "输入消息…"
      : "正在连接，仍可先输入消息…";

  return (
    <div className="composer-area" ref={composerRef}>
      <div className={`message-composer ${canSend ? "ready" : ""}`}>
        {mentionQuery !== null && filteredMentions.length > 0 && (
          <div className="mention-menu" role="listbox" aria-label="可提及用户">
            <div className="mention-menu-title">提及频道成员</div>
            {filteredMentions.map((member, index) => (
              <button type="button" role="option" aria-selected={index === mentionIndex} className={index === mentionIndex ? "selected" : ""} key={member.id} onMouseDown={(event) => event.preventDefault()} onClick={() => insertMention(member)}>
                <span>{member.nickname.slice(0, 1).toUpperCase()}</span><strong>{member.nickname}</strong><small>@{member.nickname}</small>
              </button>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="attachment-preview-list">
            {attachments.map((item) => (
              <div className={`attachment-preview ${item.status}`} key={item.localId}>
                {item.previewUrl ? <img src={item.previewUrl} alt="" /> : <span className="attachment-file-icon">↗</span>}
                <div className="attachment-preview-info">
                  <strong>{item.file.name}</strong>
                  <span>{item.status === "uploading" ? `上传中 ${item.progress}%` : item.status === "error" ? item.error : `${(item.file.size / 1024).toFixed(0)} KB`}</span>
                </div>
                <button type="button" onClick={() => removeAttachment(item)} aria-label={`移除 ${item.file.name}`}>×</button>
                {item.status === "uploading" && <i style={{ width: `${item.progress}%` }} />}
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          rows={1}
          maxLength={MAX_LENGTH}
          disabled={!state.currentChannelId}
          placeholder={placeholder}
          aria-label="消息内容"
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onKeyDown={handleKeyDown}
          onChange={(event) => {
            setText(event.target.value);
            detectMention(event.target.value, event.target.selectionStart);
            setSendError("");
            notifyTyping();
          }}
        />

        <div className="composer-toolbar">
          <input ref={fileInputRef} className="visually-hidden" type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp,.pdf,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx" onChange={(event) => handleFiles(event.target.files)} />
          <button className="attach-button" type="button" disabled={!state.currentChannelId || attachments.length >= 5} onClick={() => fileInputRef.current?.click()} aria-label="添加图片或文件" title="添加图片或文件">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 12 5.2-5.2a3 3 0 0 1 4.2 4.2l-7.7 7.7a5 5 0 0 1-7.1-7.1l7.8-7.8" /></svg>
          </button>
          <div className="emoji-control">
            <button className={`emoji-button ${showEmojiPicker ? "active" : ""}`} type="button" disabled={!state.currentChannelId} onClick={() => setShowEmojiPicker((visible) => !visible)} aria-label="添加表情" aria-expanded={showEmojiPicker} title="添加表情">☺</button>
            {showEmojiPicker && (
              <div className="emoji-picker" role="dialog" aria-label="选择表情">
                <div className="emoji-picker-header"><strong>表情</strong><span>点击即可插入</span></div>
                {EMOJI_GROUPS.map((group) => (
                  <div className="emoji-group" key={group.label}>
                    <div className="emoji-group-label">{group.label}</div>
                    <div className="emoji-grid">
                      {group.emojis.map((emoji) => <button type="button" key={emoji} onClick={() => insertEmoji(emoji)} aria-label={`插入 ${emoji}`}>{emoji}</button>)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="composer-meta">
            <span className={`connection-dot ${connected ? "online" : ""}`} />
            <span>{connected ? "Enter 发送 · Shift + Enter 换行" : "连接中，内容不会丢失"}</span>
            {text.length > MAX_LENGTH * 0.8 && <span className="composer-count">{text.length}/{MAX_LENGTH}</span>}
          </div>
          <button className="send-button" type="button" onClick={handleSend} disabled={!canSend} aria-label="发送消息" title="发送消息 (Enter)">
            <span>发送</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12 20 4l-5.2 16-3.1-6.1L4 12Zm7.7 1.9L20 4" />
            </svg>
          </button>
        </div>
      </div>
      {sendError && <div className="composer-error" role="alert">{sendError}</div>}
    </div>
  );
}
