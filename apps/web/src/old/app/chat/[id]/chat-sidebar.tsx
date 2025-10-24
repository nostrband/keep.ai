"use client";

import Link from 'next/link';
import NewChatButton from '@/components/new-chat-button';
import { useChatEvents } from '@/lib/client/sse-hub';
import { useState, useEffect, useRef } from 'react';

interface Chat {
  id: string;
  updated_at: string;
  first_message: string | null;
  first_message_time: string | null;
  read_at: string | null;
}

interface ChatSidebarProps {
  initialChats: Chat[];
  currentChatId: string;
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

function isUnread(chat: Chat): boolean {
  if (!chat.read_at) return true; // Never read
  return new Date(chat.updated_at) > new Date(chat.read_at);
}

export default function ChatSidebar({ initialChats, currentChatId }: ChatSidebarProps) {
  const [chats, setChats] = useState<Chat[]>(initialChats);
  const lastProcessedMessageId = useRef<number>(0);
  
  // Subscribe to chat message events
  const chatStore = useChatEvents();
  
  // Handle new chat messages
  useEffect(() => {
    if (chatStore.messages.length === 0) return;
    
    // Get the latest message
    const latestMessage = chatStore.messages[chatStore.messages.length - 1];
    if (!latestMessage?.data) return;
    
    // Skip if we've already processed this message
    if (latestMessage.id <= lastProcessedMessageId.current) return;
    
    console.log("Processing new chat message:", latestMessage.id);
    lastProcessedMessageId.current = latestMessage.id;
    
    try {
      const messageData = latestMessage.data;
      
      if (!messageData.chatId) return;
      
      // Find the first user message to use as chat title
      let firstMessageContent: string | null = null;
      if (messageData.messages && Array.isArray(messageData.messages)) {
        const firstMessage = messageData.messages[0];
        firstMessageContent = firstMessage?.parts
          ?.filter((part: { type: string; text?: string }) => part.type === 'text')
          ?.map((part: { type: string; text?: string }) => part.text)
          ?.join('') || null;
      }
      
      setChats(prevChats => {
        const existingChatIndex = prevChats.findIndex(chat => chat.id === messageData.chatId);
        
        if (existingChatIndex >= 0) {
          // Update existing chat - move to top and update timestamp
          const updatedChats = [...prevChats];
          const existingChat = updatedChats[existingChatIndex];
          updatedChats.splice(existingChatIndex, 1);
          
          const updatedChat = {
            ...existingChat,
            updated_at: messageData.timestamp,
            // Update first message if we have new content and the chat doesn't have one yet
            first_message: existingChat.first_message || firstMessageContent,
          };
          
          return [updatedChat, ...updatedChats];
        } else {
          // Add new chat at the top
          const newChat: Chat = {
            id: messageData.chatId,
            updated_at: messageData.timestamp,
            first_message: firstMessageContent,
            first_message_time: messageData.timestamp,
            read_at: null,
          };
          
          return [newChat, ...prevChats];
        }
      });
    } catch (error) {
      console.error('Error processing chat message event:', error);
    }
  }, [chatStore.lastId]);
  
  // Check if current chat is in the saved chats list
  const isCurrentChatSaved = chats.some(chat => chat.id === currentChatId);
  
  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-800">Chats</h2>
        <NewChatButton noChats={!chats.length} className="mt-2 block w-full text-center p-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors">
          + New Chat
        </NewChatButton>
      </div>
      
      {/* Chat List */}
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-1 p-2">
          {/* Show unsaved current chat at top if not in saved chats */}
          {!isCurrentChatSaved && (
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
            chats.map((chatItem) => (
              <Link
                key={chatItem.id}
                href={`/chat/${chatItem.id}`}
                className={`block p-3 rounded-lg hover:bg-gray-50 transition-colors ${
                  currentChatId === chatItem.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                }`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">
                      {truncateMessage(chatItem.id === "main" ? "MAIN" : chatItem.first_message)}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {formatTime(chatItem.updated_at)}
                    </div>
                  </div>
                  {isUnread(chatItem) && (
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
