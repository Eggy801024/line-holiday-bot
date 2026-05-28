import crypto from "node:crypto";

const LINE_API_ROOT = "https://api.line.me/v2/bot";

export function verifyLineSignature(channelSecret, rawBody, signature) {
  if (!signature) return false;

  const expected = crypto
    .createHmac("sha256", channelSecret)
    .update(rawBody)
    .digest("base64");

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export class LineClient {
  constructor(channelAccessToken) {
    this.channelAccessToken = channelAccessToken;
  }

  async request(path, options = {}) {
    const response = await fetch(`${LINE_API_ROOT}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.channelAccessToken}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      throw new Error(`LINE request failed: ${response.status} ${await response.text()}`);
    }

    if (response.status === 204) return null;
    return response.json();
  }

  async replyText(replyToken, text) {
    if (!replyToken || replyToken === "00000000000000000000000000000000") return;

    await this.request("/message/reply", {
      method: "POST",
      body: JSON.stringify({
        replyToken,
        messages: [
          {
            type: "text",
            text,
          },
        ],
      }),
    });
  }

  async getSourceProfile(source) {
    if (!source?.userId) return null;

    try {
      if (source.type === "group" && source.groupId) {
        return await this.request(`/group/${source.groupId}/member/${source.userId}`);
      }

      if (source.type === "room" && source.roomId) {
        return await this.request(`/room/${source.roomId}/member/${source.userId}`);
      }

      if (source.type === "user") {
        return await this.request(`/profile/${source.userId}`);
      }
    } catch {
      return null;
    }

    return null;
  }
}
