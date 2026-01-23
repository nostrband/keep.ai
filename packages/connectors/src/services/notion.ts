/**
 * Notion service definition.
 *
 * Notion OAuth is different from Google:
 * - Uses Basic auth for token exchange (not body params)
 * - Tokens don't expire (no refresh needed)
 * - Account ID is workspace_id (not email)
 * - Profile info is in token response (no separate fetch)
 */

import type { ServiceDefinition, TokenResponse } from "../types";

/**
 * Notion service definition.
 * Scopes: Notion doesn't use scopes in URL (defined at integration setup)
 */
export const notionService: ServiceDefinition = {
  id: "notion",
  name: "Notion",
  icon: "book-open", // Lucide icon for Notion-like appearance
  oauthConfig: {
    authUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [], // Notion doesn't use scopes in authorization URL
    extraAuthParams: {
      owner: "user", // Request user-level access
    },
    useBasicAuth: true, // Notion uses Basic auth for token exchange
  },
  supportsRefresh: false, // Notion tokens don't expire
  // No fetchProfile needed - workspace info is in token response
  async extractAccountId(tokenResponse: TokenResponse): Promise<string> {
    if (!tokenResponse.workspace_id) {
      throw new Error("Could not extract workspace_id from Notion token response");
    }
    return tokenResponse.workspace_id;
  },
  extractDisplayName(tokenResponse: TokenResponse): string | undefined {
    // Prefer workspace_name, fall back to workspace_id
    return (tokenResponse.workspace_name as string) || (tokenResponse.workspace_id as string);
  },
};
