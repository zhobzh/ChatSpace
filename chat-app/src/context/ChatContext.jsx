import { createContext, useReducer } from "react";

export const ChatContext = createContext();

const initialState = {
  channels: [],           // 我能看到的频道列表（含"全体" + 我的私聊频道）
  currentChannelId: null, // 当前正打开的频道
  messagesByChannel: {},  // { [channelId]: [消息, ...] } —— 按频道分开存，切频道不会串消息
  historyHasMore: {},
  unreadByChannel: {},
  mentionedByChannel: {},
  users: [],               // 在线用户（全站共享，跟频道无关）
  count: 0,
  typing: {},
};

function reducer(state, action) {
  switch (action.type) {
    case "SET_CHANNELS":
      return {
        ...state,
        channels: action.payload,
        unreadByChannel: Object.fromEntries(action.payload.map((channel) => [channel.id, Number(channel.unread_count || 0)])),
        mentionedByChannel: Object.fromEntries(action.payload.map((channel) => [channel.id, !!channel.has_mention])),
      };

    case "ADD_CHANNEL": {
      const channel = action.payload;
      if (state.channels.some((item) => item.id === channel.id)) return state;
      return { ...state, channels: [...state.channels, channel] };
    }

    case "JOIN_CHANNEL":
      return {
        ...state,
        currentChannelId: action.payload,
        unreadByChannel: { ...state.unreadByChannel, [action.payload]: 0 },
        mentionedByChannel: { ...state.mentionedByChannel, [action.payload]: false },
      };

    case "SET_HISTORY": {
      const { channelId, messages, hasMore } = action.payload;
      const current = state.messagesByChannel[channelId] || [];
      const byId = new Map();
      [...messages, ...current].forEach((message) => byId.set(message.id, message));
      return {
        ...state,
        messagesByChannel: {
          ...state.messagesByChannel,
          [channelId]: Array.from(byId.values()).sort(
            (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
          ),
        },
        historyHasMore: { ...state.historyHasMore, [channelId]: !!hasMore },
      };
    }

    case "PREPEND_HISTORY": {
      const { channelId, messages, hasMore } = action.payload;
      const existing = state.messagesByChannel[channelId] || [];
      const byId = new Map([...messages, ...existing].map((message) => [message.id, message]));
      return {
        ...state,
        messagesByChannel: { ...state.messagesByChannel, [channelId]: Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp) },
        historyHasMore: { ...state.historyHasMore, [channelId]: !!hasMore },
      };
    }

    case "NEW_MESSAGE": {
      const msg = action.payload;
      const existing = state.messagesByChannel[msg.channelId] || [];
      if (existing.some((item) => item.id === msg.id)) return state;
      return {
        ...state,
        unreadByChannel: {
          ...state.unreadByChannel,
          [msg.channelId]: msg.channelId === state.currentChannelId
            ? 0
            : (state.unreadByChannel[msg.channelId] || 0) + 1,
        },
        mentionedByChannel: {
          ...state.mentionedByChannel,
          [msg.channelId]: msg.channelId === state.currentChannelId
            ? false
            : state.mentionedByChannel[msg.channelId] || !!msg.isMentioned,
        },
        messagesByChannel: {
          ...state.messagesByChannel,
          [msg.channelId]: [...existing, msg],
        },
      };
    }

    case "USER_LIST":
      return { ...state, users: action.payload };

    case "USER_COUNT":
      return { ...state, count: action.payload };

    case "PROFILE_UPDATED": {
      const profile = action.payload;
      return {
        ...state,
        users: state.users.map((item) => item.id === profile.userId ? { ...item, ...profile, id: item.id } : item),
        channels: state.channels.map((channel) => channel.partner?.user_id === profile.userId
          ? { ...channel, partner: { ...channel.partner, nickname: profile.nickname, avatarVersion: profile.avatarVersion } }
          : channel),
        messagesByChannel: Object.fromEntries(Object.entries(state.messagesByChannel).map(([id, messages]) => [id, messages.map((message) => message.userId === profile.userId ? { ...message, nickname: profile.nickname, avatarVersion: profile.avatarVersion } : message)])),
      };
    }

    case "UPDATE_CHANNEL":
      return { ...state, channels: state.channels.map((channel) => channel.id === action.payload.id ? { ...channel, ...action.payload } : channel) };

    case "REMOVE_CHANNEL":
      return { ...state, channels: state.channels.filter((channel) => channel.id !== action.payload), currentChannelId: state.currentChannelId === action.payload ? null : state.currentChannelId };

    case "TYPING":
      return { ...state, typing: action.payload };

    default:
      return state;
  }
}

export function ChatProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <ChatContext.Provider value={{ state, dispatch }}>
      {children}
    </ChatContext.Provider>
  );
}
