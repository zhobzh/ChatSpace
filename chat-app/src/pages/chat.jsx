import { useContext } from "react";
import { ChatContext } from "../context/ChatContext";
import { useAuth } from "../context/AuthContext";
import ChatWindow from "../components/ChatWindow/ChatWindow";
import Sidebar from "../components/Sidebar/Sidebar";
import useWebSocket from "../hooks/useWebSocket";
import "../styles/chat.css";
import ChannelHeader from "../components/ChannelHeader/ChannelHeader";

const DEFAULT_CHANNEL_ID = "00000000-0000-0000-0000-000000000001";

export default function Chat() {
  const { state, dispatch } = useContext(ChatContext);
  const { user, logout } = useAuth();

  const { send, connected } = useWebSocket(!!user, (data) => {
    if (data.type === "channels") {
      dispatch({ type: "SET_CHANNELS", payload: data.channels });
      // 连接建立、拿到频道列表后，默认自动打开"全体"频道，
      // 这样登录进来就有内容看，不用手动点一次
      const initialChannel =
        data.channels.find((channel) => channel.id === DEFAULT_CHANNEL_ID) ||
        data.channels[0];
      if (initialChannel) {
        send({ type: "join", channelId: initialChannel.id });
        dispatch({ type: "JOIN_CHANNEL", payload: initialChannel.id });
      }
    }
    if (data.type === "message") {
      dispatch({
        type: "NEW_MESSAGE",
        payload: { ...data, isMentioned: data.mentions?.some((mention) => mention.id === user.id) },
      });
    }
    if (data.type === "channel_added") {
      dispatch({ type: "ADD_CHANNEL", payload: data.channel });
    }
    if (data.type === "profile_updated") {
      dispatch({ type: "PROFILE_UPDATED", payload: data.profile });
    }
    if (data.type === "channel_updated") {
      dispatch({ type: "UPDATE_CHANNEL", payload: data.channel });
    }
    if (data.type === "channel_removed") {
      dispatch({ type: "REMOVE_CHANNEL", payload: data.channelId });
    }
    if (data.type === "history") {
      dispatch({
        type: data.prepend ? "PREPEND_HISTORY" : "SET_HISTORY",
        payload: { channelId: data.channelId, messages: data.messages, hasMore: data.hasMore },
      });
    }
    if (data.type === "users") {
      dispatch({ type: "USER_LIST", payload: data.users });
      dispatch({ type: "USER_COUNT", payload: data.count });
    }
    if (data.type === "typing") {
      dispatch({ type: "TYPING", payload: data });
    }
  });

  // 切换频道：发 join 消息给服务端，同时更新本地"当前频道"状态
  const switchChannel = (channelId) => {
    if (channelId === state.currentChannelId) return;
    send({ type: "join", channelId });
    dispatch({ type: "JOIN_CHANNEL", payload: channelId });
  };

  return (
    <div className="chat-layout">
      <Sidebar onSwitchChannel={switchChannel} send={send} />
      <div className="chat-main">
        <ChannelHeader user={user} logout={logout} />
        <ChatWindow send={send} connected={connected} />
      </div>
    </div>
  );
}
