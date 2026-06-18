import crypto from "node:crypto";

const LINE_API_ROOT = "https://api.line.me/v2/bot";

function escapeTextV2Text(text) {
  return text.replaceAll("{", "{{").replaceAll("}", "}}");
}

function buildTextMessage(text, options = {}) {
  if (!options.mentionAll) {
    return {
      type: "text",
      text,
    };
  }

  const messageText = escapeTextV2Text(text).replace(/^@(?:所有人|all|everyone)\s*/i, "");

  return {
    type: "textV2",
    text: `{all}\n${messageText}`,
    substitution: {
      all: {
        type: "mention",
        mentionee: {
          type: "all",
        },
      },
    },
  };
}

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

  async replyText(replyToken, text, options = {}) {
    if (!replyToken || replyToken === "00000000000000000000000000000000") return;

    await this.request("/message/reply", {
      method: "POST",
      body: JSON.stringify({
        replyToken,
        messages: [buildTextMessage(text, options)],
      }),
    });
  }

  async pushText(to, text, options = {}) {
    if (!to) return;

    await this.request("/message/push", {
      method: "POST",
      body: JSON.stringify({
        to,
        messages: [buildTextMessage(text, options)],
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
