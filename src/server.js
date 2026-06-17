import http from "node:http";
import { getConfig } from "./config.js";
import { GoogleSheetsClient } from "./googleSheets.js";
import { HolidayService } from "./holidayService.js";
import { LineClient, verifyLineSignature } from "./line.js";

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function send(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(body);
}

async function sendLineResult(line, event, result) {
  if (!result) return;

  if (typeof result === "string") {
    await line.replyText(event.replyToken, result);
    return;
  }

  if (result.type !== "privateReply") return;

  try {
    await line.pushText(result.to, result.text);
  } catch {
    if (result.fallbackReply) {
      await line.replyText(event.replyToken, result.fallbackReply);
    }
  }
}

async function main() {
  const config = getConfig();
  const line = new LineClient(config.line.channelAccessToken);
  const sheets = new GoogleSheetsClient(config.google);
  const holidayService = new HolidayService({ sheetsClient: sheets, config });

  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/") {
        send(response, 200, "LINE holiday bot is running.");
        return;
      }

      if (request.method !== "POST" || request.url !== "/webhook") {
        send(response, 404, "Not found");
        return;
      }

      const rawBody = await readRawBody(request);
      const signature = request.headers["x-line-signature"];

      if (!verifyLineSignature(config.line.channelSecret, rawBody, signature)) {
        send(response, 401, "Invalid signature");
        return;
      }

      const payload = JSON.parse(rawBody.toString("utf8"));
      send(response, 200, "OK");

      for (const event of payload.events || []) {
        if (event.type !== "message" || event.message?.type !== "text") continue;

        try {
          const profile = await line.getSourceProfile(event.source);
          const reply = await holidayService.handleTextMessage({
            text: event.message.text,
            source: event.source,
            displayName: profile?.displayName || "",
          });

          await sendLineResult(line, event, reply);
        } catch (error) {
          console.error("Event handling failed:", error);
          await line.replyText(
            event.replyToken,
            [
              `中文：系統處理失敗，請聯絡組長。錯誤：${error.message}`,
              `English: The system failed to process the request. Please contact the leader. Error: ${error.message}`,
              `Tiếng Việt: Hệ thống xử lý thất bại. Vui lòng liên hệ tổ trưởng. Lỗi: ${error.message}`,
            ].join("\n"),
          );
        }
      }
    } catch (error) {
      console.error("Webhook failed:", error);
      if (!response.headersSent) send(response, 500, "Internal server error");
    }
  });

  server.listen(config.port, () => {
    console.log(`LINE holiday bot listening on port ${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
