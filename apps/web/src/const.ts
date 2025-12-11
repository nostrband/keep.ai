export const DB_FILE = "keepai.db"

// Check for environment variables from electron preload or use default
export const API_ENDPOINT = (() => {
  // Check if we're in electron and have access to window.env
  if (typeof window !== 'undefined' && (window as any).env && (window as any).env.API_ENDPOINT) {
    return (window as any).env.API_ENDPOINT;
  }
  // Default to relative path for web builds
  return "/api";
})();
