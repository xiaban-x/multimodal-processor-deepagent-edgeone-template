/**
 * Model & Gateway configuration
 */

export function resolveModelName(): string {
  return '@pages/deepseek-v4-flash';
}

export function collectGatewayEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  if (process.env.AI_GATEWAY_API_KEY) {
    env.ANTHROPIC_API_KEY = process.env.AI_GATEWAY_API_KEY;
  }

  if (process.env.AI_GATEWAY_BASE_URL) {
    env.ANTHROPIC_BASE_URL = process.env.AI_GATEWAY_BASE_URL;
  }

  return env;
}
