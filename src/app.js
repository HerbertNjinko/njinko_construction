/**
 * Application configuration service
 * Exposes environment-based app configuration like APP_URL
 */

/**
 * Normalizes and validates a URL string
 * @param {string} value - The URL value to normalize
 * @param {string} fallback - Fallback URL if value is invalid
 * @returns {string} Normalized URL
 */
function normalizeUrl(value, fallback) {
  const normalized = String(value ?? "").trim();

  try {
    return new URL(normalized).href;
  } catch {
    return fallback;
  }
}

/**
 * Gets the application's public URL
 * @returns {string} The APP_URL from environment
 */
export function getAppUrl() {
  const appUrl = process.env.APP_URL;

  if (!appUrl) {
    throw new Error("APP_URL environment variable is not set");
  }

  return normalizeUrl(appUrl, "https://investors.njinkofarm.com/");
}

/**
 * Gets the application configuration object
 * @returns {Object} Application configuration
 */
export function getAppConfig() {
  return {
    url: getAppUrl(),
    port: process.env.PORT || 4173,
    environment: process.env.NODE_ENV || "development",
  };
}
