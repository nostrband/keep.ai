/**
 * Safe localStorage/sessionStorage utilities that gracefully handle
 * unavailable storage (private/incognito mode, quota exceeded, disabled storage)
 */

/**
 * Safely get an item from localStorage, returning null if access fails
 */
export function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    // localStorage unavailable (private mode, disabled, etc.)
    console.debug(`localStorage.getItem('${key}') failed:`, e);
    return null;
  }
}

/**
 * Safely set an item in localStorage, silently failing if access fails
 */
export function safeLocalStorageSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    // localStorage unavailable or quota exceeded
    console.debug(`localStorage.setItem('${key}') failed:`, e);
    return false;
  }
}

/**
 * Safely remove an item from localStorage, silently failing if access fails
 */
export function safeLocalStorageRemove(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (e) {
    console.debug(`localStorage.removeItem('${key}') failed:`, e);
    return false;
  }
}

/**
 * Safely get an item from sessionStorage, returning null if access fails
 */
export function safeSessionStorageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch (e) {
    console.debug(`sessionStorage.getItem('${key}') failed:`, e);
    return null;
  }
}

/**
 * Safely set an item in sessionStorage, silently failing if access fails
 */
export function safeSessionStorageSet(key: string, value: string): boolean {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.debug(`sessionStorage.setItem('${key}') failed:`, e);
    return false;
  }
}
