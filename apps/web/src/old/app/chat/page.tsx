import { redirect } from 'next/navigation';
import { generateId } from 'ai';

export default async function ChatPage() {
  // This page is now only used as a fallback for direct /chat access
  // Generate a new chat ID and redirect
  const id = generateId();
  redirect(`/chat/${id}`);
}
