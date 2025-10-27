import { Link, useParams } from "react-router-dom";
import { useAllChats } from "../hooks/dbChatReads";
import { Button } from "..//ui";

interface Chat {
  id: string;
  updated_at: string;
  first_message: string | null;
  first_message_time: string | null;
  read_at: string | null;
}

function formatTime(dateString: string | null): string {
  if (!dateString) return '';
  
  const date = new Date(dateString);
  const now = new Date();
  const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
  
  if (diffInHours < 24) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffInHours < 24 * 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}

function truncateMessage(message: string | null): string {
  if (!message) return 'New chat';
  return message.length > 50 ? message.substring(0, 50) + '...' : message;
}

export default function ChatSidebar() {
  const { id: currentChatId } = useParams<{ id: string }>();
  const { data: chats = [], isLoading } = useAllChats();
  
  if (isLoading) {
    return (
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col h-full">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">Chats</h2>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div>Loading...</div>
        </div>
      </div>
    );
  }

  // Check if current chat is in the saved chats list
  const isCurrentChatSaved = chats.some(chat => chat.id === currentChatId);
  
  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-800">Chats</h2>
        <Link to="/chat/new">
          <Button className="mt-2 block w-full text-center p-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors">
            + New Chat
          </Button>
        </Link>
      </div>
      
      {/* Chat List */}
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-1 p-2">
          {/* Show unsaved current chat at top if not in saved chats */}
          {!isCurrentChatSaved && currentChatId && currentChatId !== "new" && (
            <div className="block p-3 rounded-lg bg-blue-50 border-l-4 border-blue-500">
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">
                    New chat
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Current
                  </div>
                </div>
                <div className="w-2 h-2 bg-blue-500 rounded-full ml-2 flex-shrink-0"></div>
              </div>
            </div>
          )}
          
          {/* Saved chats */}
          {chats.length === 0 && isCurrentChatSaved ? (
            <div className="p-4 text-gray-500 text-sm text-center">
              No chats yet. Start a new conversation!
            </div>
          ) : (
            chats.map((chat) => (
              <Link
                key={chat.id}
                to={`/chat/${chat.id}`}
                className={`block p-3 rounded-lg hover:bg-gray-50 transition-colors ${
                  currentChatId === chat.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                }`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">
                      {truncateMessage(chat.first_message)}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {formatTime(chat.updated_at)}
                    </div>
                  </div>
                  {chat.read_at === null && (
                    <div className="w-2 h-2 bg-blue-500 rounded-full ml-2 flex-shrink-0"></div>
                  )}
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}