# Render 雲端部署

這個專案可部署到 Render Web Service。部署後你的電腦不用持續開機，LINE webhook 會打到 Render 的網址。

## 需要準備

- GitHub 帳號
- Render 帳號
- LINE Developers 的 `Channel secret`
- LINE Developers 的 `Channel access token`
- Google Sheet ID
- Google service account 的 `client_email`
- Google service account 的 `private_key`

## 先確認 Google Sheet 權限

把 service account 的 `client_email` 加到 Google Sheet 共用名單，權限設為編輯者。

## 上傳到 GitHub

把這個資料夾建立成 GitHub repository。不要上傳 `.env` 和 `eggy-495601-c5d063f48805.json`，這兩個已經在 `.gitignore` 內。

## Render 建立服務

1. 到 Render 新增 `Web Service`
2. 連接你的 GitHub repository
3. Render 會讀到 `render.yaml`
4. 建立服務後，到 Environment 補上下面變數

## Render 環境變數

| 名稱 | 說明 |
|---|---|
| `LINE_CHANNEL_SECRET` | LINE Developers 的 Channel secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers 的 Channel access token |
| `GOOGLE_SPREADSHEET_ID` | Google Sheet 網址中 `/d/` 後面的那串 ID |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | service account JSON 裡的 `client_email` |
| `GOOGLE_PRIVATE_KEY` | service account JSON 裡的 `private_key`，保留 `-----BEGIN PRIVATE KEY-----` 到 `-----END PRIVATE KEY-----` |
| `TIME_ZONE` | `Asia/Taipei` |
| `SHEET_NAME` | 主表分頁名稱 |
| `LOG_SHEET_NAME` | 登記紀錄分頁名稱 |
| `BINDING_SHEET_NAME` | LINE 綁定分頁名稱 |
| `MAX_PER_DATE` | 每日每組可登記人數，預設 `2` |
| `ALLOW_CHANGE` | 是否允許改日期，預設 `false` |
| `WORKER_ID_PATTERN` | 工號格式，預設 `[A-Z]{1,3}\\d{3,4}` |
| `GROUP_TEAM_MAP_JSON` | 群組對班別限制，沒有就填 `{}` |

## LINE webhook 設定

Render 部署完成後會給你一個網址，例如：

```text
https://line-holiday-bot.onrender.com
```

到 LINE Developers，把 Webhook URL 設成：

```text
https://line-holiday-bot.onrender.com/webhook
```

然後打開：

- Use webhook: 開啟
- Auto-reply messages: 關閉
- Greeting messages: 可自行決定

## 測試

部署完成後先打開 Render 網址首頁，如果看到：

```text
LINE holiday bot is running.
```

代表服務已啟動。接著在 LINE 傳：

```text
help
```

或傳：

```text
BA179 6/3
```

確認機器人有回覆並寫入 Google Sheet。

## 注意

Render 免費方案閒置一段時間後會休眠，第一則訊息可能會慢幾十秒。正式產線使用建議改付費方案，穩定度會比較好。
