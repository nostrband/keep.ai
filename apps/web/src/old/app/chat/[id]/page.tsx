import { loadChat, getAllChats, readChat } from '@/lib/server/chat-store';
import ChatInterface from './chat-interface';
import ChatSidebar from './chat-sidebar';
import { USER_ID } from '@/lib/const';

interface ChatPageProps {
  params: Promise<{ id: string }>;
}

export default async function ChatPage({ params }: ChatPageProps) {
  const { id } = await params;
  const [messages, chats] = await Promise.all([
    loadChat(USER_ID, id),
    getAllChats()
  ]);
  
  // Mark chat as read when page is rendered
  try {
    await readChat(USER_ID, id);
  } catch (error) {
    // Ignore error if chat doesn't exist yet (new chat)
    console.warn('Could not mark chat as read:', error);
  }
  
  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar with chat list */}
      <ChatSidebar initialChats={chats} currentChatId={id} />
      
      {/* Main chat area */}
      <div className="flex-1">
        <ChatInterface id={id} initialMessages={messages} />
      </div>
    </div>
  );
}
