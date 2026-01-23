import { useState, useEffect, FormEvent } from "react";
import { API_ENDPOINT } from "../const";
import SharedHeader from "./SharedHeader";
import { Button } from "../ui";
import { SUPPORTED_LANGUAGES, getBrowserLanguage, getLanguageDisplayName } from "../lib/language-utils";
import { safeLocalStorageGet, safeLocalStorageSet, safeLocalStorageRemove } from "../lib/safe-storage";
import ConnectionsSection from "./ConnectionsSection";
// import { DEFAULT_AGENT_MODEL } from "@app/agent";

interface OpenRouterModel {
  id: string;
  canonical_slug: string;
  name: string;
  created: number;
  pricing: {
    prompt: string;
    completion: string;
    request: string;
    image: string;
  };
  context_length: number;
  architecture: {
    modality: string;
    input_modalities: string[];
    output_modalities: string[];
    tokenizer: string;
    instruct_type: string;
  };
  top_provider: {
    is_moderated: boolean;
    context_length: number;
    max_completion_tokens: number;
  };
  per_request_limits: {
    prompt_tokens: number;
    completion_tokens: number;
  };
  supported_parameters: string[];
  default_parameters: {
    temperature: number;
    top_p: number;
    frequency_penalty: number;
  };
  description: string;
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

interface ConfigData {
  env: {
    OPENROUTER_API_KEY?: string;
    AGENT_MODEL?: string;
    LANG?: string;
    EXA_API_KEY?: string;
    EXTRA_SYSTEM_PROMPT?: string;
    DESKTOP_NOTIFICATIONS?: string;
  };
}

export default function SettingsPage() {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [debugMode, setDebugMode] = useState(() =>
    safeLocalStorageGet("keep-ai-debug-mode") === "true"
  );

  const [formData, setFormData] = useState({
    OPENROUTER_API_KEY: "",
    AGENT_MODEL: "",
    LANG: "en",
    EXA_API_KEY: "",
    EXTRA_SYSTEM_PROMPT: "",
    DESKTOP_NOTIFICATIONS: "on",
  });

  // Load current config
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch(`${API_ENDPOINT}/get_config`);
        if (!response.ok) {
          throw new Error("Failed to fetch configuration");
        }
        const data: ConfigData = await response.json();
        setConfig(data);

        // Set form data with current values
        setFormData({
          OPENROUTER_API_KEY: data.env.OPENROUTER_API_KEY || "",
          AGENT_MODEL: data.env.AGENT_MODEL || "anthropic/claude-sonnet-4", //DEFAULT_AGENT_MODEL,
          LANG: data.env.LANG || getBrowserLanguage(),
          EXA_API_KEY: data.env.EXA_API_KEY || "",
          EXTRA_SYSTEM_PROMPT: data.env.EXTRA_SYSTEM_PROMPT || "",
          DESKTOP_NOTIFICATIONS: data.env.DESKTOP_NOTIFICATIONS || "on",
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load configuration"
        );
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, []);

  // Load OpenRouter models when API key is available
  useEffect(() => {
    const loadModels = async () => {
      // if (!config?.env.OPENROUTER_API_KEY) return;

      setModelsLoading(true);
      try {
        const response = await fetch("https://openrouter.ai/api/v1/models", {
          // headers: {
          //   Authorization: `Bearer ${config.env.OPENROUTER_API_KEY}`,
          // },
        });

        if (!response.ok) {
          throw new Error("Failed to fetch OpenRouter models");
        }

        const data: OpenRouterModelsResponse = await response.json();
        setModels(
          data.data
            .filter(
              (model) =>
                model.architecture.input_modalities.includes("text") &&
                model.architecture.output_modalities.includes("text")
            )
            .sort((a, b) =>
              a.id < b.id
                ? -1
                : a.id > b.id
                ? 1
                : 0
            )
        );
      } catch (err) {
        console.error("Failed to load models:", err);
        // Don't show error to user as this is optional
        setModels([]);
      } finally {
        setModelsLoading(false);
      }
    };

    loadModels();
  }, [config]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");

    if (
      !formData.OPENROUTER_API_KEY.trim()
      // formData.OPENROUTER_API_KEY === "••••••••••••••••••••"
    ) {
      setError("OpenRouter API key is required");
      return;
    }

    if (!formData.AGENT_MODEL.trim()) {
      setError("Agent model is required");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`${API_ENDPOINT}/set_config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          OPENROUTER_API_KEY: formData.OPENROUTER_API_KEY,
          AGENT_MODEL: formData.AGENT_MODEL,
          LANG: formData.LANG,
          EXA_API_KEY: formData.EXA_API_KEY,
          EXTRA_SYSTEM_PROMPT: formData.EXTRA_SYSTEM_PROMPT,
          DESKTOP_NOTIFICATIONS: formData.DESKTOP_NOTIFICATIONS,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save configuration");
      }

      setSuccessMessage("Configuration saved successfully");
      // Reload config to get updated values
      const configResponse = await fetch(`${API_ENDPOINT}/get_config`);
      if (configResponse.ok) {
        const updatedConfig: ConfigData = await configResponse.json();
        setConfig(updatedConfig);
        // Update form with saved values
        setFormData({
          OPENROUTER_API_KEY: updatedConfig.env.OPENROUTER_API_KEY || "",
          AGENT_MODEL:
            updatedConfig.env.AGENT_MODEL || "anthropic/claude-sonnet-4",
          LANG: updatedConfig.env.LANG || getBrowserLanguage(),
          EXA_API_KEY: updatedConfig.env.EXA_API_KEY || "",
          EXTRA_SYSTEM_PROMPT: updatedConfig.env.EXTRA_SYSTEM_PROMPT || "",
          DESKTOP_NOTIFICATIONS: updatedConfig.env.DESKTOP_NOTIFICATIONS || "on",
        });
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save configuration"
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SharedHeader title="Settings" />
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="flex items-center justify-center">
            <div>Loading configuration...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader title="Settings" />
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">
            Assistant Configuration
          </h2>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="language"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Language
              </label>
              <select
                id="language"
                value={formData.LANG}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    LANG: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={saving}
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {getLanguageDisplayName(lang.code)}
                  </option>
                ))}
              </select>
              <p className="text-sm text-gray-500 mt-1">
                Select your preferred language for the assistant interface.
              </p>
            </div>

            <div>
              <label
                htmlFor="apiKey"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                OpenRouter API Key *
              </label>
              <input
                type="password"
                id="apiKey"
                value={formData.OPENROUTER_API_KEY}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    OPENROUTER_API_KEY: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter your OpenRouter API key"
                disabled={saving}
                required
              />
              <p className="text-sm text-gray-500 mt-1">
                Your OpenRouter API key for accessing AI models. Get one at{" "}
                <a
                  href="https://openrouter.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-500"
                >
                  openrouter.ai
                </a>
              </p>
            </div>

            <div>
              <label
                htmlFor="exaApiKey"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Exa.ai API Key
              </label>
              <input
                type="password"
                id="exaApiKey"
                value={formData.EXA_API_KEY}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    EXA_API_KEY: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter your Exa.ai API key (optional)"
                disabled={saving}
              />
              <p className="text-sm text-gray-500 mt-1">
                Optional Exa.ai API key for enhanced search capabilities. Get one at{" "}
                <a
                  href="https://exa.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-500"
                >
                  exa.ai
                </a>
              </p>
            </div>

            <div>
              <label
                htmlFor="model"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Agent Model *
              </label>
              {modelsLoading ? (
                <div className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500">
                  Loading available models...
                </div>
              ) : models.length > 0 ? (
                <select
                  id="model"
                  value={formData.AGENT_MODEL}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      AGENT_MODEL: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={saving}
                  required
                >
                  {models.map((model) => (
                    <option
                      key={model.id}
                      value={model.id}
                    >
                      {model.id} - {model.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  id="model"
                  value={formData.AGENT_MODEL}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      AGENT_MODEL: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g. anthropic/claude-sonnet-4"
                  disabled={saving}
                  required
                />
              )}
              <p className="text-sm text-gray-500 mt-1">
                The AI model to use for the assistant.
              </p>
            </div>

            <div>
              <label
                htmlFor="extraSystemPrompt"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Extra System Prompt
              </label>
              <textarea
                id="extraSystemPrompt"
                value={formData.EXTRA_SYSTEM_PROMPT}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    EXTRA_SYSTEM_PROMPT: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter additional system prompts or instructions for the AI assistant..."
                disabled={saving}
                rows={4}
              />
              <p className="text-sm text-gray-500 mt-1">
                Optional additional system prompt to customize the AI assistant's behavior. This will be added to the system instructions.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label
                  htmlFor="desktopNotifications"
                  className="text-sm font-medium text-gray-700"
                >
                  Desktop Notifications
                </label>
                <input
                  type="checkbox"
                  id="desktopNotifications"
                  checked={formData.DESKTOP_NOTIFICATIONS === "on"}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      DESKTOP_NOTIFICATIONS: e.target.checked ? "on" : "off",
                    }))
                  }
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  disabled={saving}
                />
              </div>
              <p className="text-sm text-gray-500 mt-1">
                Enable or disable desktop notifications for new messages (separate from web push notifications).
              </p>
            </div>

            <div className="border-t border-gray-200 pt-6 mt-6">
              <h3 className="text-sm font-medium text-gray-700 mb-4">Advanced</h3>
              <div>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="debugMode"
                    className="text-sm font-medium text-gray-700"
                  >
                    Debug Mode
                  </label>
                  <input
                    type="checkbox"
                    id="debugMode"
                    checked={debugMode}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      setDebugMode(enabled);
                      if (enabled) {
                        safeLocalStorageSet("keep-ai-debug-mode", "true");
                      } else {
                        safeLocalStorageRemove("keep-ai-debug-mode");
                      }
                    }}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    disabled={saving}
                  />
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Enable verbose debug output in the browser console. Requires page refresh to take effect.
                </p>
                {debugMode && (
                  <p className="text-xs text-amber-600 mt-1">
                    Debug mode is enabled. Refresh the page to see debug output in the console.
                  </p>
                )}
              </div>
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 p-3 rounded-md border border-red-200">
                {error}
              </div>
            )}

            {successMessage && (
              <div className="text-sm text-green-600 bg-green-50 p-3 rounded-md border border-green-200">
                {successMessage}
              </div>
            )}

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={saving}
                variant="outline"
                size="sm"
                className="cursor-pointer"
              >
                {saving ? "Saving..." : "Save Configuration"}
              </Button>
            </div>
          </form>
        </div>

        {/* Service Connections Section */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mt-6">
          <ConnectionsSection />
        </div>
      </div>
    </div>
  );
}
