/**
 * Configured Lark/Feishu OpenAPI client.
 *
 * Uses tenant_access_token (self-built app) auth. The SDK acquires, caches and
 * refreshes the token automatically from the App ID + App Secret, so no token
 * handling is needed here. Created lazily so the server boots without Lark env.
 */

import * as lark from '@larksuiteoapi/node-sdk';

let client: lark.Client | null = null;

export function getLarkClient(): lark.Client {
  if (!client) {
    const appId = process.env.LARK_APP_ID;
    const appSecret = process.env.LARK_APP_SECRET;
    if (!appId || !appSecret) {
      throw new Error('LARK_APP_ID and LARK_APP_SECRET are required');
    }

    // Default to Lark International (https://open.larksuite.com).
    const domain = process.env.LARK_DOMAIN || lark.Domain.Lark;

    client = new lark.Client({
      appId,
      appSecret,
      appType: lark.AppType.SelfBuild,
      domain,
    });
  }
  return client;
}
