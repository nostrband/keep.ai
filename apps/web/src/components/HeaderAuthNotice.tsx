import { useState } from "react";
import { useNeedAuth } from "../hooks/useNeedAuth";
import { AuthPopup } from "./AuthPopup";
import { ClerkAuthProvider } from "./ClerkAuthProvider";
import { CLERK_PUBLISHABLE_KEY } from "../constants/auth";

declare const __SERVERLESS__: boolean;

interface HeaderAuthNoticeProps {
  className?: string;
}

/**
 * Shows a warning button in the header when authentication is required.
 * When clicked, opens the AuthPopup modal.
 */
export function HeaderAuthNotice({ className = "" }: HeaderAuthNoticeProps) {
  const { needAuth, isFirstLaunch, isLoaded, isServerError, refresh } = useNeedAuth();
  const [showAuthPopup, setShowAuthPopup] = useState(false);

  // Show notice when auth is needed OR server error (in non-serverless mode)
  const showServerError = isServerError && !__SERVERLESS__;
  const shouldShow = isLoaded && (needAuth || showServerError);

  // Determine the button text based on state
  const getButtonText = () => {
    if (showServerError) {
      return 'Server error';
    }
    return isFirstLaunch ? 'Sign up' : 'Sign in';
  };

  const handleAuthenticated = () => {
    setShowAuthPopup(false);
    refresh();
  };

  const handleClick = () => {
    if (showServerError) {
      // For server errors, retry the config check instead of showing auth popup
      refresh();
      return;
    }
    setShowAuthPopup(true);
  };

  if (!shouldShow) {
    return null;
  }

  // Use red styling for server errors, amber for auth issues
  const buttonClass = showServerError
    ? `flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded-md transition-colors ${className}`
    : `flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-md transition-colors ${className}`;

  return (
    <>
      <button
        onClick={handleClick}
        className={buttonClass}
        aria-label={showServerError ? "Server error" : "Authentication required"}
      >
        {/* Warning icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
        {getButtonText()}
      </button>

      {showAuthPopup && CLERK_PUBLISHABLE_KEY && (
        <ClerkAuthProvider clerkPublishableKey={CLERK_PUBLISHABLE_KEY}>
          <AuthPopup
            isOpen={showAuthPopup}
            onClose={() => setShowAuthPopup(false)}
            onAuthenticated={handleAuthenticated}
            clerkPublishableKey={CLERK_PUBLISHABLE_KEY}
            mode={isFirstLaunch ? 'signup' : 'signin'}
            canDismiss={true}
          />
        </ClerkAuthProvider>
      )}

      {showAuthPopup && !CLERK_PUBLISHABLE_KEY && (
        <AuthPopup
          isOpen={showAuthPopup}
          onClose={() => setShowAuthPopup(false)}
          onAuthenticated={handleAuthenticated}
          canDismiss={true}
        />
      )}
    </>
  );
}
