import { useState, useEffect } from "react";
import { useNeedAuth } from "../hooks/useNeedAuth";
import { useConfig } from "../hooks/useConfig";
import { AuthPopup } from "./AuthPopup";
import { ClerkAuthProvider } from "./ClerkAuthProvider";
import { CLERK_PUBLISHABLE_KEY } from "../constants/auth";

interface AuthEventItemProps {
  autoShowPopup?: boolean;
}

/**
 * Shows an in-chat notification when authentication is required.
 * Appears as a yellow card at the bottom of the chat interface.
 */
export function AuthEventItem({ autoShowPopup = true }: AuthEventItemProps) {
  const { needAuth, reason, isLoaded: needAuthLoaded, refresh: refreshNeedAuth } = useNeedAuth();
  const { isConfigValid, isLoading: configLoading, recheckConfig } = useConfig();
  const [showAuthPopup, setShowAuthPopup] = useState(false);
  const [hasAutoDismissed, setHasAutoDismissed] = useState(false);

  // Determine if we need to show the item
  const shouldShow = needAuthLoaded && !configLoading && (needAuth || isConfigValid === false);

  // Determine if this is first launch (signup) or returning user (signin)
  const isFirstLaunch = reason === 'api_key_missing' || isConfigValid === false;

  // Auto-show popup on first occurrence (only once)
  useEffect(() => {
    if (autoShowPopup && shouldShow && !hasAutoDismissed) {
      setShowAuthPopup(true);
    }
  }, [shouldShow, autoShowPopup, hasAutoDismissed]);

  const handleAuthenticated = () => {
    setShowAuthPopup(false);
    setHasAutoDismissed(true);
    recheckConfig();
    refreshNeedAuth();
  };

  const handleClose = () => {
    setShowAuthPopup(false);
    setHasAutoDismissed(true);
  };

  if (!shouldShow) {
    return null;
  }

  return (
    <>
      <div className="my-4 mx-2">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            {/* Warning icon */}
            <div className="flex-shrink-0 mt-0.5">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 text-amber-600"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            </div>

            <div className="flex-1">
              <h3 className="text-sm font-medium text-amber-800">
                {isFirstLaunch ? 'Sign up to access AI' : 'Authentication required'}
              </h3>
              <p className="mt-1 text-sm text-amber-700">
                {isFirstLaunch
                  ? 'Get free daily credits to run your automations'
                  : 'Please sign in again to continue running your automations'}
              </p>

              <button
                onClick={() => setShowAuthPopup(true)}
                className="mt-3 inline-flex items-center px-3 py-1.5 text-sm font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-md transition-colors"
              >
                {isFirstLaunch ? 'Sign up' : 'Sign in'}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="ml-1.5 h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {showAuthPopup && CLERK_PUBLISHABLE_KEY && (
        <ClerkAuthProvider clerkPublishableKey={CLERK_PUBLISHABLE_KEY}>
          <AuthPopup
            isOpen={showAuthPopup}
            onClose={handleClose}
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
          onClose={handleClose}
          onAuthenticated={handleAuthenticated}
          canDismiss={true}
        />
      )}
    </>
  );
}
