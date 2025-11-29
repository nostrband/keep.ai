/**
 * Utility to collect browser and OS information for device identification
 */

interface BrowserInfo {
  browserName: string;
  browserVersion: string;
  osName: string;
  osVersion: string;
}

/**
 * Get browser information from user agent string
 */
function getBrowserInfo(): { name: string; version: string } {
  const ua = navigator.userAgent;
  
  // Chrome
  if (ua.includes('Chrome/') && !ua.includes('Edg/') && !ua.includes('OPR/')) {
    const match = ua.match(/Chrome\/(\d+\.\d+)/);
    return { name: 'Chrome', version: match ? match[1] : 'Unknown' };
  }
  
  // Edge
  if (ua.includes('Edg/')) {
    const match = ua.match(/Edg\/(\d+\.\d+)/);
    return { name: 'Edge', version: match ? match[1] : 'Unknown' };
  }
  
  // Firefox
  if (ua.includes('Firefox/')) {
    const match = ua.match(/Firefox\/(\d+\.\d+)/);
    return { name: 'Firefox', version: match ? match[1] : 'Unknown' };
  }
  
  // Safari
  if (ua.includes('Safari/') && !ua.includes('Chrome/') && !ua.includes('Chromium/')) {
    const match = ua.match(/Version\/(\d+\.\d+)/);
    return { name: 'Safari', version: match ? match[1] : 'Unknown' };
  }
  
  // Opera
  if (ua.includes('OPR/')) {
    const match = ua.match(/OPR\/(\d+\.\d+)/);
    return { name: 'Opera', version: match ? match[1] : 'Unknown' };
  }
  
  return { name: 'Unknown', version: 'Unknown' };
}

/**
 * Get OS information from user agent string and platform
 */
function getOSInfo(): { name: string; version: string } {
  const ua = navigator.userAgent;
  const platform = navigator.platform;
  
  // Windows
  if (ua.includes('Windows NT')) {
    const match = ua.match(/Windows NT (\d+\.\d+)/);
    const version = match ? match[1] : 'Unknown';
    const versionMap: { [key: string]: string } = {
      '10.0': '10/11',
      '6.3': '8.1',
      '6.2': '8',
      '6.1': '7',
      '6.0': 'Vista',
      '5.1': 'XP'
    };
    return { name: 'Windows', version: versionMap[version] || version };
  }
  
  // macOS
  if (ua.includes('Mac OS X') || platform.includes('Mac')) {
    const match = ua.match(/Mac OS X (\d+[._]\d+[._]?\d*)/);
    if (match) {
      const version = match[1].replace(/_/g, '.');
      return { name: 'macOS', version };
    }
    return { name: 'macOS', version: 'Unknown' };
  }
  
  // Linux
  if (ua.includes('Linux') || platform.includes('Linux')) {
    return { name: 'Linux', version: 'Unknown' };
  }
  
  // iOS
  if (ua.includes('iPhone OS') || ua.includes('OS ') && platform.includes('iPhone')) {
    const match = ua.match(/OS (\d+[._]\d+[._]?\d*)/);
    if (match) {
      const version = match[1].replace(/_/g, '.');
      return { name: 'iOS', version };
    }
    return { name: 'iOS', version: 'Unknown' };
  }
  
  // Android
  if (ua.includes('Android')) {
    const match = ua.match(/Android (\d+\.\d+)/);
    return { name: 'Android', version: match ? match[1] : 'Unknown' };
  }
  
  return { name: 'Unknown', version: 'Unknown' };
}

/**
 * Get complete browser and OS information
 */
export function getBrowserAndOSInfo(): BrowserInfo {
  const browser = getBrowserInfo();
  const os = getOSInfo();
  
  return {
    browserName: browser.name,
    browserVersion: browser.version,
    osName: os.name,
    osVersion: os.version
  };
}

/**
 * Format browser and OS info as a device name string
 */
export function getDeviceInfo(): string {
  const info = getBrowserAndOSInfo();
  return `${info.browserName} ${info.browserVersion} on ${info.osName} ${info.osVersion}`;
}