import { ClerkProvider } from '@clerk/clerk-react';
import { ReactNode } from 'react';

// Clerk configuration will be loaded from the central server

interface ClerkAuthProviderProps {
  children: ReactNode;
  clerkPublishableKey?: string;
}

export function ClerkAuthProvider({ children, clerkPublishableKey }: ClerkAuthProviderProps) {
  if (!clerkPublishableKey || clerkPublishableKey === 'your_clerk_publishable_key_here') {
    // Return children without Clerk wrapper if not configured
    return <>{children}</>;
  }

  return (
    <ClerkProvider 
      publishableKey={clerkPublishableKey}
      afterSignOutUrl="/"
    >
      {children}
    </ClerkProvider>
  );
}