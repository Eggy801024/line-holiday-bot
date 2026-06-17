# Cloudflare Workers 部署

這份設定會把原本 Render 的 LINE Bot 搬到 Cloudflare Workers，網址會長這樣：

```text
https://line-holiday-bot.<你的帳號>.workers.dev/webhook
```

LINE Developers 的 Webhook URL 要填上面這個 `/webhook`，不要只填首頁 `/`。

## 需要設定的密鑰

在 `外籍` 資料夾執行以下指令，逐一貼上實際值：

```powershell
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put GOOGLE_SPREADSHEET_ID
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
```

`GOOGLE_SERVICE_ACCOUNT_JSON` 請貼整份 Google service account JSON 內容。Google Sheet 仍然要分享給該 service account email，權限要是 Editor。

## 測試與部署

```powershell
npm install -D wrangler@latest
npm run check
npm run deploy:worker
```

部署完成後，把 Workers 顯示的網址加上 `/webhook`，填回 LINE Developers 的 Messaging API Webhook URL。

## 本機測試

如需本機試跑，可建立 `.dev.vars`，內容放同樣的密鑰，然後執行：

```powershell
npm run dev:worker
```

本機測試網址會是：

```text
http://localhost:8787/webhook
```
