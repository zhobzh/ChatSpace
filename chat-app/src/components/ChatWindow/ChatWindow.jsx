import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import "./ChatWindow.css";

export default function ChatWindow({ send, connected }) {
  return (
    <div className="chat-window">
      <MessageList send={send} />
      <MessageInput send={send} connected={connected} />
    </div>
  );
}
