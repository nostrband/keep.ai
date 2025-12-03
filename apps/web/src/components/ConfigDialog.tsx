import { useState, FormEvent, useEffect } from "react";
import { API_ENDPOINT } from "../const";
import { Button } from "../ui";
import { SUPPORTED_LANGUAGES, getBrowserLanguage, getLanguageDisplayName } from "../lib/language-utils";

// Logo component with "K" design (same as SharedHeader)
const AssistantIcon = () => (
  <div className="w-8 h-8 border-2 rounded flex items-center justify-center" style={{ borderColor: '#D6A642' }}>
    <span className="font-bold text-lg">K</span>
  </div>
);

interface ConfigDialogProps {
  onConfigured: () => void;
}

export function ConfigDialog({ onConfigured }: ConfigDialogProps) {
  const [apiKey, setApiKey] = useState("");
  const [language, setLanguage] = useState("en");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Initialize language from browser
  useEffect(() => {
    setLanguage(getBrowserLanguage());
  }, []);

  const handleSubmit = async (e: FormEvent) => {
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

      // If validation passes, send to our server
      const response = await fetch(`${API_ENDPOINT}/set_config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          OPENROUTER_API_KEY: apiKey,
          LANG: language,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to save configuration');
        return;
      }

      // Success! Check config again to confirm
      const checkResponse = await fetch(`${API_ENDPOINT}/check_config`);
      const checkData = await checkResponse.json();
      
      if (checkData.ok) {
        onConfigured();
      } else {
        setError('Configuration saved but validation failed');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-md p-8 max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center mb-6">
          <AssistantIcon />
          <h1 className="text-xl font-semibold text-gray-900 ml-3">Keep.AI</h1>
        </div>

        {/* Configuration Form */}
        <div>
          <h2 className="text-lg font-medium text-gray-900 mb-4">Please configure the Assistant</h2>
          
          <form onSubmit={handleSubmit} className="space-y-4">
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

            <Button
              type="submit"
              disabled={isSubmitting}
              variant="outline"
              size="sm"
              className="w-full cursor-pointer"
            >
              {isSubmitting ? 'Configuring...' : 'Save Configuration'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}