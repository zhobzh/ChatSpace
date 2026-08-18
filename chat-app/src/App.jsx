import Chat from "./pages/chat";
import Auth from "./pages/Auth";
import { ChatProvider } from "./context/ChatContext";
import { AuthProvider, useAuth } from "./context/AuthContext";

function Gate() {
  const { user, loading } = useAuth();

  if (loading) return null; // 也可以换成一个 loading spinner

  return user ? (
    <ChatProvider>
      <Chat />
    </ChatProvider>
  ) : (
    <Auth />
  );
}

function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

export default App;
