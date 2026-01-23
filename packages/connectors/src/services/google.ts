/**
 * Google services (Gmail, Drive, Sheets, Docs) definitions.
 *
 * Gmail is the reference implementation. Other Google services follow the same pattern.
 */

import type { ServiceDefinition, TokenResponse } from "../types";

/**
 * Google user profile from userinfo endpoint.
 */
export interface GoogleProfile {
  id: string;
  email: string;
  verified_email: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

/**
 * Shared Google OAuth configuration.
 */
export const googleOAuthBase = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  extraAuthParams: {
    access_type: "offline",
    prompt: "consent", // Force refresh token on every auth
  },
};

/**
 * Fetch Google user profile from userinfo endpoint.
 */
export async function fetchGoogleProfile(
  accessToken: string
): Promise<GoogleProfile> {
  const response = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch Google profile: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Gmail service definition.
 * Scopes: gmail.modify (read + write access)
 */
export const gmailService: ServiceDefinition = {
  id: "gmail",
  name: "Gmail",
  icon: "mail",
  oauthConfig: {
    ...googleOAuthBase,
    scopes: ["https://www.googleapis.com/auth/gmail.modify"],
  },
  supportsRefresh: true,
  fetchProfile: fetchGoogleProfile,
  async extractAccountId(
    _tokenResponse: TokenResponse,
    profile?: unknown
  ): Promise<string> {
    const googleProfile = profile as GoogleProfile | undefined;
    if (!googleProfile?.email) {
      throw new Error("Could not extract email from Google profile");
    }
    return googleProfile.email;
  },
  extractDisplayName(
    _tokenResponse: TokenResponse,
    profile?: unknown
  ): string | undefined {
    const googleProfile = profile as GoogleProfile | undefined;
    return googleProfile?.email;
  },
};

/**
 * Google Drive service definition.
 * Scopes: drive (full access)
 */
export const gdriveService: ServiceDefinition = {
  id: "gdrive",
  name: "Google Drive",
  icon: "folder",
  oauthConfig: {
    ...googleOAuthBase,
    scopes: ["https://www.googleapis.com/auth/drive"],
  },
  supportsRefresh: true,
  fetchProfile: fetchGoogleProfile,
  async extractAccountId(
    _tokenResponse: TokenResponse,
    profile?: unknown
  ): Promise<string> {
    const googleProfile = profile as GoogleProfile | undefined;
    if (!googleProfile?.email) {
      throw new Error("Could not extract email from Google profile");
    }
    return googleProfile.email;
  },
  extractDisplayName(
    _tokenResponse: TokenResponse,
    profile?: unknown
  ): string | undefined {
    const googleProfile = profile as GoogleProfile | undefined;
    return googleProfile?.email;
  },
};

/**
 * Google Sheets service definition.
 * Scopes: spreadsheets (full access to Sheets)
 */
export const gsheetsService: ServiceDefinition = {
  id: "gsheets",
  name: "Google Sheets",
  icon: "table",
  oauthConfig: {
    ...googleOAuthBase,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  },
  supportsRefresh: true,
  fetchProfile: fetchGoogleProfile,
  async extractAccountId(
    _tokenResponse: TokenResponse,
    profile?: unknown
  ): Promise<string> {
    const googleProfile = profile as GoogleProfile | undefined;
    if (!googleProfile?.email) {
      throw new Error("Could not extract email from Google profile");
    }
    return googleProfile.email;
  },
  extractDisplayName(
    _tokenResponse: TokenResponse,
    profile?: unknown
  ): string | undefined {
    const googleProfile = profile as GoogleProfile | undefined;
    return googleProfile?.email;
  },
};

/**
 * Google Docs service definition.
 * Scopes: documents (full access to Docs)
 */
export const gdocsService: ServiceDefinition = {
  id: "gdocs",
  name: "Google Docs",
  icon: "file-text",
  oauthConfig: {
    ...googleOAuthBase,
    scopes: ["https://www.googleapis.com/auth/documents"],
  },
  supportsRefresh: true,
  fetchProfile: fetchGoogleProfile,
  async extractAccountId(
    _tokenResponse: TokenResponse,
    profile?: unknown
  ): Promise<string> {
    const googleProfile = profile as GoogleProfile | undefined;
    if (!googleProfile?.email) {
      throw new Error("Could not extract email from Google profile");
    }
    return googleProfile.email;
  },
  extractDisplayName(
    _tokenResponse: TokenResponse,
    profile?: unknown
  ): string | undefined {
    const googleProfile = profile as GoogleProfile | undefined;
    return googleProfile?.email;
  },
};

/**
 * All Google services for easy registration.
 */
export const googleServices = [
  gmailService,
  gdriveService,
  gsheetsService,
  gdocsService,
] as const;
