# LINE 例休登記機器人

這套機器人會接收 LINE 群組訊息，把同仁回覆的例休日期同步到 Google Sheets。

## 同仁怎麼回覆

第一次要輸入工號加日期：

```text
BA179 6/3
```

綁定成功後，同一個 LINE 帳號之後可以只輸入日期：

```text
6/4
```

支援格式：

```text
6/3
06/03
6月3日
2026/6/3
3日
3號
```

可用指令：

```text
規則
查詢
群組資訊
```

## 規則

- 同一個日期最多登記 2 位同仁。
- 以 LINE 訊息進來的時間為優先順序。
- 已滿的日期會直接拒絕，不會寫入主表。
- 若已經登記過，預設不允許自行改日期；要改就私訊組長處理。
- 未在期限內回覆者，可依現場人力需求安排。
- 最後仍需配合產線人力、機況與公司規定。

## Google Sheets 格式

主分頁名稱預設是 `例休`，可在 `.env` 的 `SHEET_NAME` 修改。

主表需要有同仁區塊，標題列至少包含：

```text
工號 | 姓名 | 班別/日期/群組
```

機器人會找每個同仁的工號、姓名、班別，並把日期欄位中的對應格填上 `X`。

如果日期欄位不夠，且表內有 `原例休日` 欄位，機器人會在 `原例休日` 前面新增日期欄。

另外會自動建立兩張分頁：

- `例休回覆紀錄`：每次回覆的處理紀錄
- `Line綁定`：LINE 使用者和工號的綁定表

## 啟用步驟

1. 把 Google Sheet 的分頁名稱改成 `例休`，或把 `.env` 的 `SHEET_NAME` 改成實際分頁名。
2. 到 Google Cloud 建立 service account，開啟 Google Sheets API。
3. 把目標 Google Sheet 分享給 service account email，權限給編輯者。
4. 複製 `.env.example` 成 `.env`，填入 LINE 與 Google 設定。若有下載 service account JSON，填 `GOOGLE_SERVICE_ACCOUNT_JSON_PATH` 即可。
5. 啟動：

```powershell
node src/server.js
```

6. LINE Developers 的 Webhook URL 設為：

```text
https://你的公開網址/webhook
```

本機測試時需要公開 HTTPS，例如 ngrok 或 Cloudflare Tunnel。

## 兩個外籍群組

把機器人加入兩個群組後，在群組輸入：

```text
群組資訊
```

機器人會回覆 groupId。再把 `.env` 裡的 `GROUP_TEAM_MAP_JSON` 改成類似：

```text
{"Cxxx":"AN_A","Cyyy":"AN_B"}
```

這樣可以避免 AN_A 同仁在 AN_B 群組登記。
