import { DurableObject } from "cloudflare:workers";
import { buildConfig } from "./config.js";
import { GoogleSheetsClient } from "./googleSheets.js";
import { HolidayService } from "./holidayService.js";
import { LineClient, verifyLineSignature } from "./line.js";
import { ScheduledPushService } from "./scheduledPush.js";

function textResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function createRuntime(env) {
  const config = buildConfig(env);
  const line = new LineClient(config.line.channelAccessToken);
  const sheets = new GoogleSheetsClient(config.google);
  const holidayService = new HolidayService({ sheetsClient: sheets, config });
  const scheduledPushService = new ScheduledPushService({
    sheetsClient: sheets,
    lineClient: line,
    config,
  });
  return { line, holidayService, scheduledPushService };
}

async function processPayload(env, payload) {
  const { line, holidayService } = createRuntime(env);

  for (const event of payload.events || []) {
    if (event.type !== "message" || event.message?.type !== "text") continue;

    try {
      const profile = await line.getSourceProfile(event.source);
      const reply = await holidayService.handleTextMessage({
        text: event.message.text,
        source: event.source,
        displayName: profile?.displayName || "",
      });

      if (reply) {
        await line.replyText(event.replyToken, reply);
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "Event handling failed",
          error: error.message,
          source: event.source,
          text: event.message?.text || "",
        }),
      );

      if (event.replyToken) {
        await line.replyText(
          event.replyToken,
          [
            `中文：系統處理失敗，請聯絡管理者。錯誤：${error.message}`,
            `English: The system failed to process the request. Please contact the leader. Error: ${error.message}`,
            `Tiếng Việt: Hệ thống xử lý thất bại. Vui lòng liên hệ trưởng nhóm. Lỗi: ${error.message}`,
          ].join("\n"),
        );
      }
    }
  }
}

export class HolidayBotQueue extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.queue = Promise.resolve();
  }

  async processWebhook(payload) {
    const task = this.queue.then(() => processPayload(this.env, payload));
    this.queue = task.catch(() => {});
    await task;
    return { ok: true };
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/webhook")) {
      return textResponse("LINE holiday bot is running on Cloudflare Workers.");
    }

    if (request.method !== "POST" || url.pathname !== "/webhook") {
      return textResponse("Not found", 404);
    }

    const rawBody = await request.text();
    const signature = request.headers.get("x-line-signature");
    const config = buildConfig(env);

    if (!verifyLineSignature(config.line.channelSecret, rawBody, signature)) {
      return textResponse("Invalid signature", 401);
    }

    const payload = JSON.parse(rawBody);
    const stub = env.HOLIDAY_BOT_QUEUE.getByName("main");
    ctx.waitUntil(
      stub.processWebhook(payload).catch((error) => {
        console.error(JSON.stringify({ message: "Webhook queue failed", error: error.message }));
      }),
    );

    return textResponse("OK");
  },
  async scheduled(controller, env, ctx) {
    const { scheduledPushService } = createRuntime(env);

    ctx.waitUntil(
      scheduledPushService.run(controller.scheduledTime).catch((error) => {
        console.error(
          JSON.stringify({ message: "Scheduled push failed", error: error.message }),
        );
      }),
    );
  },
};
