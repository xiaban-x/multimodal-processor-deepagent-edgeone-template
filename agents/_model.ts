/**
 * Model & Gateway configuration
 * Follows the same pattern as other EdgeOne Agent SDK templates.
 */

export function resolveModelName(): string {
  return process.env.AI_MODEL || 'claude-sonnet-4-20250514';
}

export function collectGatewayEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  if (process.env.AI_GATEWAY_API_KEY) {
    env.ANTHROPIC_API_KEY = process.env.AI_GATEWAY_API_KEY;
  }

  if (process.env.AI_GATEWAY_BASE_URL) {
    // Strip trailing /v1 — SDK appends it automatically
    let baseURL = process.env.AI_GATEWAY_BASE_URL;
    baseURL = baseURL.replace(/\/v1\/?$/, '');
    env.ANTHROPIC_BASE_URL = baseURL;
  }

  return env;
}
