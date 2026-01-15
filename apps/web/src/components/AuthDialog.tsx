import { useState, useEffect } from "react";
import { 
  SignIn, 
  SignUp, 
  SignedIn, 
  SignedOut, 
  useAuth,
  UserButton,
  ClerkLoaded,
  ClerkLoading
} from "@clerk/clerk-react";
import { API_ENDPOINT } from "../const";
import { Button } from "../ui";
import { SUPPORTED_LANGUAGES, getBrowserLanguage, getLanguageDisplayName } from "../lib/language-utils";
import { API_ENDPOINTS, AUTH_STATES, type AuthState } from "../constants/auth";

// Logo component with "K" design (same as SharedHeader)
const AssistantIcon = () => (
  <div className="w-8 h-8 border-2 rounded flex items-center justify-center" style={{ borderColor: '#D6A642' }}>
    <span className="font-bold text-lg">K</span>
  </div>
);

interface AuthDialogProps {
  onAuthenticated: () => void;
  clerkPublishableKey?: string;
}

type AuthMode = 'signin' | 'signup' | 'advanced';

export function AuthDialog({ onAuthenticated, clerkPublishableKey }: AuthDialogProps) {
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [authState, setAuthState] = useState<AuthState>(AUTH_STATES.LOADING);
  const [apiKey, setApiKey] = useState("");
  const [language, setLanguage] = useState("en");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { isSignedIn, userId, getToken } = useAuth();

  // Initialize language from browser
  useEffect(() => {
    setLanguage(getBrowserLanguage());
  }, []);

  // Handle Clerk authentication state changes
  useEffect(() => {
    if (isSignedIn && userId && authMode !== 'advanced') {
      // User is signed in with Clerk, fetch API key from backend
      fetchApiKeyFromBackend();
    } else if (authMode === 'advanced') {
      // Advanced mode with custom API key
      setAuthState(AUTH_STATES.ADVANCED_MODE);
    } else if (!clerkPublishableKey) {
      // No Clerk configuration, use advanced mode
      setAuthState(AUTH_STATES.ADVANCED_MODE);
    } else {
      // Clerk is available but user not signed in
      setAuthState(AUTH_STATES.UNAUTHENTICATED);
    }
  }, [isSignedIn, userId, authMode, clerkPublishableKey]);

  const fetchApiKeyFromBackend = async () => {
    if (!userId) return;
    
    setIsSubmitting(true);
    setError("");

    try {
      // Get JWT token from Clerk
      const token = await getToken();
      
      if (!token) {
        setError('Failed to get authentication token');
        return;
      }

      // Use local server to call backend with JWT token
      const response = await fetch(`${API_ENDPOINT}/fetch_api_key_from_backend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jwtToken: token,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to fetch API key from server');
        return;
      }

      const data = await response.json();
      
      if (data.success) {
        // Configuration is already saved by the server endpoint
        setAuthState(AUTH_STATES.AUTHENTICATED);
        onAuthenticated();
      } else {
        setError('Failed to configure API key');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to authenticate with server');
    } finally {
      setIsSubmitting(false);
    }
  };

  const setApiKeyInLocalServer = async (key: string, baseUrl?: string) => {
    const config: any = {
      OPENROUTER_API_KEY: key,
      LANG: language,
    };

    if (baseUrl) {
      config.OPENROUTER_BASE_URL = baseUrl;
    }

    const response = await fetch(`${API_ENDPOINT}/set_config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      throw new Error('Failed to save configuration to local server');
    }
  };

  const handleAdvancedSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!apiKey.trim()) {
      setError("OpenRouter API key is required");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      // Test the OpenRouter API key first
      const testResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages: [
            {
              role: 'user',
              content: 'ping',
            },
          ],
        }),
      });

      if (!testResponse.ok) {
        const errorData = await testResponse.text();
        setError(`Invalid OpenRouter API key: ${errorData}`);
        return;
      }

      // Save to local server
      await setApiKeyInLocalServer(apiKey);

      // Success! Check config again to confirm
      const checkResponse = await fetch(`${API_ENDPOINT}/check_config`);
      const checkData = await checkResponse.json();
      
      if (checkData.ok) {
        setAuthState(AUTH_STATES.AUTHENTICATED);
        onAuthenticated();
      } else {
        setError('Configuration saved but validation failed');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show loading state
  if (authState === AUTH_STATES.LOADING) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-md p-8 max-w-md w-full mx-4">
          <div className="flex items-center mb-6">
            <AssistantIcon />
            <h1 className="text-xl font-semibold text-gray-900 ml-3">Keep.AI</h1>
          </div>
          <div className="text-center">Loading...</div>
        </div>
      </div>
    );
  }

  // Advanced mode with custom API key
  if (authState === AUTH_STATES.ADVANCED_MODE) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-md p-8 max-w-md w-full mx-4">
          {/* Header */}
          <div className="flex items-center mb-6">
            <AssistantIcon />
            <h1 className="text-xl font-semibold text-gray-900 ml-3">Keep.AI</h1>
          </div>

          {/* Advanced Configuration Form */}
          <div>
            <h2 className="text-lg font-medium text-gray-900 mb-4">Advanced Configuration</h2>
            
            <form onSubmit={handleAdvancedSubmit} className="space-y-4">
              <div>
                <label htmlFor="language" className="block text-sm font-medium text-gray-700 mb-2">
                  Language
                </label>
                <select
                  id="language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={isSubmitting}
                >
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {getLanguageDisplayName(lang.code)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700 mb-2">
                  OpenRouter API Key
                </label>
                <input
                  type="password"
                  id="apiKey"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter your OpenRouter API key"
                  disabled={isSubmitting}
                />
              </div>

              {error && (
                <div className="text-sm text-red-600 bg-red-50 p-3 rounded-md">
                  {error}
                </div>
              )}

              <div className="flex space-x-3">
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  variant="outline"
                  size="sm"
                  className="flex-1 cursor-pointer"
                >
                  {isSubmitting ? 'Configuring...' : 'Save Configuration'}
                </Button>
                
                {clerkPublishableKey && (
                  <Button
                    type="button"
                    disabled={isSubmitting}
                    variant="ghost"
                    size="sm"
                    className="cursor-pointer"
                    onClick={() => setAuthState(AUTH_STATES.UNAUTHENTICATED)}
                  >
                    Back to Sign In
                  </Button>
                )}
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Clerk authentication
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-md p-8 max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center mb-6">
          <AssistantIcon />
          <h1 className="text-xl font-semibold text-gray-900 ml-3">Keep.AI</h1>
        </div>

        {isSubmitting && (
          <div className="text-center py-4">
            <div className="text-sm text-gray-600">Authenticating and setting up...</div>
          </div>
        )}

        {error && (
          <div className="text-sm text-red-600 bg-red-50 p-3 rounded-md mb-4">
            {error}
          </div>
        )}

        <ClerkLoaded>
          <SignedIn>
            <div className="text-center">
              <UserButton />
              <p className="mt-4 text-sm text-gray-600">Setting up your environment...</p>
            </div>
          </SignedIn>
          
          <SignedOut>
            {authMode === 'signin' ? (
              <div>
                <h2 className="text-lg font-medium text-gray-900 mb-4">Sign In</h2>
                <SignIn 
                  routing="hash"
                />
              </div>
            ) : (
              <div>
                <h2 className="text-lg font-medium text-gray-900 mb-4">Sign Up</h2>
                <SignUp 
                  routing="hash"
                />
              </div>
            )}

            <div className="mt-6 space-y-3">
              <div className="text-center">
                <button
                  type="button"
                  className="text-sm text-blue-600 hover:text-blue-500"
                  onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}
                >
                  {authMode === 'signin' ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
                </button>
              </div>
              
              <div className="text-center">
                <button
                  type="button"
                  className="text-sm text-gray-600 hover:text-gray-500"
                  onClick={() => setAuthState(AUTH_STATES.ADVANCED_MODE)}
                >
                  Use your own OpenRouter API key
                </button>
              </div>
            </div>
          </SignedOut>
        </ClerkLoaded>
      </div>
    </div>
  );
}