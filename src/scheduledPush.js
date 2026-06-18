import { quoteSheetName, singleCellA1 } from "./a1.js";

const HEADERS = ["啟用", "月份", "日期", "時間", "群組ID", "訊息內容", "最後發送月份", "備註"];

const FIRST_MESSAGE = [
  "@所有人 下個月例行性休假開始登記，請同仁輸入「工號 日期」",
  'English: @everyone Routine holiday registration for next month has started. Please enter "worker ID date".',
  'Tiếng Việt: @mọi người Bắt đầu đăng ký ngày nghỉ định kỳ của tháng sau. Vui lòng nhập "mã nhân viên ngày".',
].join("\n");

const SECOND_MESSAGE = [
  "@所有人 請尚未登記例行性休假的同仁，於下班前完成登記",
  "English: @everyone If you have not registered your routine holiday yet, please complete it before the end of work today.",
  "Tiếng Việt: @mọi người Những bạn chưa đăng ký ngày nghỉ định kỳ, vui lòng hoàn tất trước khi tan ca hôm nay.",
].join("\n");

const DEFAULT_ROWS = [
  ["TRUE", "1,2,3,7,8,9", "14", "20:30", "", FIRST_MESSAGE, "", "第一則"],
  ["TRUE", "1,2,3,7,8,9", "15", "06:30", "", SECOND_MESSAGE, "", "第二則"],
  ["TRUE", "4,5,6,10,11,12", "14", "08:30", "", FIRST_MESSAGE, "", "第一則"],
  ["TRUE", "4,5,6,10,11,12", "14", "18:30", "", SECOND_MESSAGE, "", "第二則"],
];

function cleanText(value) {
  return String(value ?? "").trim();
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getDateTimeParts(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestamp));
  const value = (type) => Number(parts.find((part) => part.type === type).value);

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}

function isEnabled(value) {
  return !["", "false", "no", "n", "0", "停用"].includes(cleanText(value).toLowerCase());
}

function parseMonths(value) {
  return cleanText(value)
    .split(/[,，、\s]+/)
    .map((month) => Number(month))
    .filter((month) => month >= 1 && month <= 12);
}

function normalizeTime(value) {
  if (typeof value === "number") {
    const minutes = Math.round(value * 24 * 60) % (24 * 60);
    return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
  }

  const match = cleanText(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "";
  return `${pad2(Number(match[1]))}:${pad2(Number(match[2]))}`;
}

function parseGroupIds(value) {
  return cleanText(value)
    .split(/[\s,，、]+/)
    .map((groupId) => cleanText(groupId))
    .filter(Boolean);
}

function isBlankRow(row) {
  return row.every((cell) => cleanText(cell) === "");
}

async function ensureScheduleRows(sheets, sheetName) {
  await sheets.ensureSheet(sheetName, HEADERS);
  const rows = await sheets.getValues(`${quoteSheetName(sheetName)}!A2:H100`);

  if (rows.length === 0 || rows.every(isBlankRow)) {
    await sheets.appendValues(`${quoteSheetName(sheetName)}!A:H`, DEFAULT_ROWS);
    return DEFAULT_ROWS;
  }

  return rows;
}

export class ScheduledPushService {
  constructor({ sheetsClient, lineClient, config }) {
    this.sheets = sheetsClient;
    this.line = lineClient;
    this.config = config;
  }

  async run(scheduledTime = Date.now()) {
    const sheetName = this.config.sheets.scheduledPushSheetName;
    const rows = await ensureScheduleRows(this.sheets, sheetName);
    const now = getDateTimeParts(scheduledTime, this.config.timeZone);
    const currentTime = `${pad2(now.hour)}:${pad2(now.minute)}`;
    const sentKey = `${now.year}-${pad2(now.month)}`;
    let sentCount = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!isEnabled(row[0])) continue;
      if (!parseMonths(row[1]).includes(now.month)) continue;
      if (Number(row[2]) !== now.day) continue;
      if (normalizeTime(row[3]) !== currentTime) continue;
      if (cleanText(row[6]) === sentKey) continue;

      const groupIds = parseGroupIds(row[4]);
      const message = cleanText(row[5]);
      if (groupIds.length === 0 || !message) continue;

      for (const groupId of groupIds) {
        await this.line.pushText(groupId, message, { mentionAll: true });
        sentCount += 1;
      }
      await this.sheets.updateValues(singleCellA1(sheetName, index + 1, 6), [[sentKey]]);
    }

    return { sentCount };
  }
}
