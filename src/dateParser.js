const FULL_WIDTH_DIGITS = "０１２３４５６７８９";

function toHalfWidth(input) {
  return String(input).replace(/[０-９]/g, (char) =>
    String(FULL_WIDTH_DIGITS.indexOf(char)),
  );
}

function getTodayParts(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const value = (type) => Number(parts.find((part) => part.type === type).value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
  };
}

function isValidDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function resolveYear(month, day, today) {
  let year = today.year;
  if (month < today.month || (month === today.month && day < today.day)) {
    year += 1;
  }
  return year;
}

function resolveMonth(day, today) {
  let year = today.year;
  let month = today.month;

  if (day < today.day) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return { year, month };
}

function normalizeText(text) {
  return toHalfWidth(text)
    .replace(/[／]/g, "/")
    .replace(/[－—–]/g, "-")
    .replace(/[．。]/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDateValue(value, timeZone = "Asia/Taipei") {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(
      value.getDate(),
    )}`;
  }

  if (typeof value === "number") {
    // Google Sheets serial date, based on the 1899-12-30 epoch.
    const epoch = Date.UTC(1899, 11, 30);
    const date = new Date(epoch + Math.round(value) * 86400000);
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
      date.getUTCDate(),
    )}`;
  }

  const parsed = parseDateFromText(String(value), timeZone);
  return parsed?.iso || null;
}

export function parseDateFromText(text, timeZone = "Asia/Taipei", todayOverride = null) {
  const normalized = normalizeText(text);
  const today = todayOverride || getTodayParts(timeZone);

  const fullDate = normalized.match(
    /(?:^|[^\dA-Za-z])((?:20|19)\d{2})\s*(?:年|\/|-|\.)\s*(1[0-2]|0?[1-9])\s*(?:月|\/|-|\.)\s*(3[01]|[12]?\d|0?[1-9])\s*(?:日|號|号)?(?=$|[^\dA-Za-z])/,
  );
  if (fullDate) {
    const year = Number(fullDate[1]);
    const month = Number(fullDate[2]);
    const day = Number(fullDate[3]);
    if (!isValidDate(year, month, day)) return null;
    return toDateResult(year, month, day);
  }

  const monthDay = normalized.match(
    /(?:^|[^\dA-Za-z])(1[0-2]|0?[1-9])\s*(?:月|\/|-|\.)\s*(3[01]|[12]?\d|0?[1-9])\s*(?:日|號|号)?(?=$|[^\dA-Za-z])/,
  );
  if (monthDay) {
    const month = Number(monthDay[1]);
    const day = Number(monthDay[2]);
    const year = resolveYear(month, day, today);
    if (!isValidDate(year, month, day)) return null;
    return toDateResult(year, month, day);
  }

  const dayOnly = normalized.match(
    /(?:^|[^\dA-Za-z])(3[01]|[12]?\d|0?[1-9])\s*(?:日|號|号)?(?=$|[^\dA-Za-z])/,
  );
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    const { year, month } = resolveMonth(day, today);
    if (!isValidDate(year, month, day)) return null;
    return toDateResult(year, month, day);
  }

  return null;
}

export function formatDateForSheet(iso) {
  const [, , month, day] = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return `${Number(month)}/${Number(day)}`;
}

export function formatDateForReply(iso) {
  const [, , month, day] = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return `${Number(month)}/${Number(day)}`;
}

function toDateResult(year, month, day) {
  return {
    iso: `${year}-${pad2(month)}-${pad2(day)}`,
    year,
    month,
    day,
  };
}
