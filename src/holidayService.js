import { cellA1, rangeA1, singleCellA1 } from "./a1.js";
import {
  formatDateForReply,
  formatDateForSheet,
  normalizeDateValue,
  parseDateFromText,
} from "./dateParser.js";
import { padTable, wholeSheetRange } from "./googleSheets.js";
import { RULES_TEXT } from "./rulesText.js";

const LOG_HEADERS = [
  "時間",
  "狀態",
  "工號",
  "姓名",
  "組別",
  "登記日期",
  "LINE名稱",
  "LINE userId",
  "LINE groupId",
  "原始訊息",
  "備註",
];

const BINDING_HEADERS = [
  "LINE userId",
  "工號",
  "姓名",
  "組別",
  "LINE名稱",
  "LINE groupId",
  "建立時間",
  "更新時間",
];

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeWorkerId(value) {
  return cleanText(value).toUpperCase();
}

function textIncludes(value, keyword) {
  return cleanText(value).includes(keyword);
}

function nowText(timeZone) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function multiLang({ zh, en, vi }) {
  return [`中文：${zh}`, `English: ${en}`, `Tiếng Việt: ${vi}`].join("\n");
}

function dateInputHasMonth(text) {
  return /(\d)\s*(\/|-|\.|月)/.test(cleanText(text));
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function findHeaderRows(values) {
  const headers = [];

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    const idCol = row.findIndex((cell) => cleanText(cell) === "工號");
    const nameCol = row.findIndex((cell) => cleanText(cell) === "姓名");
    const groupCol = row.findIndex(
      (cell) => textIncludes(cell, "組別") || textIncludes(cell, "群組"),
    );

    if (idCol >= 0 && nameCol >= 0 && groupCol >= 0) {
      headers.push({ rowIndex, idCol, nameCol, groupCol });
    }
  }

  return headers;
}

function findOriginalHolidayColumn(values, groupCol) {
  let best = -1;

  for (const row of values) {
    for (let colIndex = groupCol + 1; colIndex < row.length; colIndex += 1) {
      if (
        textIncludes(row[colIndex], "原本休假") ||
        textIncludes(row[colIndex], "原休") ||
        textIncludes(row[colIndex], "原例休") ||
        textIncludes(row[colIndex], "異動前")
      ) {
        if (best === -1 || colIndex < best) best = colIndex;
      }
    }
  }

  return best;
}

function discoverRoster(values, config) {
  const headers = findHeaderRows(values);
  const employees = [];
  const blocks = [];

  for (let i = 0; i < headers.length; i += 1) {
    const header = headers[i];
    const nextHeaderRow = headers[i + 1]?.rowIndex ?? values.length;
    const originalCol = findOriginalHolidayColumn(values, header.groupCol);
    const dateStartCol = header.groupCol + 1;
    const dateEndCol =
      originalCol >= dateStartCol
        ? originalCol
        : dateStartCol + config.rules.maxDateColumnsWithoutOriginal - 1;

    const block = {
      ...header,
      firstDataRow: header.rowIndex + 1,
      lastDataRow: nextHeaderRow - 1,
      originalCol,
      dateStartCol,
      dateEndCol,
    };
    blocks.push(block);

    for (
      let rowIndex = block.firstDataRow;
      rowIndex <= block.lastDataRow && rowIndex < values.length;
      rowIndex += 1
    ) {
      const row = values[rowIndex] || [];
      const workerId = normalizeWorkerId(row[header.idCol]);
      if (!workerId || !config.rules.workerIdPattern.test(workerId)) continue;

      employees.push({
        workerId,
        name: cleanText(row[header.nameCol]),
        team: cleanText(row[header.groupCol]),
        rowIndex,
        block,
      });
    }
  }

  return { headers, blocks, employees };
}

function extractWorkerId(text, config) {
  const match = cleanText(text).match(config.rules.workerIdPattern);
  return match ? normalizeWorkerId(match[0]) : null;
}

function getGroupId(source) {
  return source?.groupId || source?.roomId || "";
}

function statusText(status) {
  return {
    ACCEPTED: "登記成功",
    REJECTED_FULL: "名額已滿",
    REJECTED_DUPLICATE: "已登記過",
    REJECTED_UNKNOWN_WORKER: "查無工號",
    REJECTED_WRONG_GROUP: "群組不符",
    NEED_WORKER_ID: "需要工號",
    NEED_DATE: "需要日期",
  }[status] || status;
}

export class HolidayService {
  constructor({ sheetsClient, config }) {
    this.sheets = sheetsClient;
    this.config = config;
    this.mainSheetName = null;
    this.messageQueue = Promise.resolve();
  }

  async resolveMainSheetName() {
    if (this.mainSheetName) return this.mainSheetName;

    const preferred = this.config.sheets.mainSheetName;
    const spreadsheet = await this.sheets.getSpreadsheet();
    const sheets = spreadsheet.sheets.map((sheet) => sheet.properties.title);

    if (sheets.includes(preferred)) {
      this.mainSheetName = preferred;
      return this.mainSheetName;
    }

    const supportSheets = new Set([
      this.config.sheets.logSheetName,
      this.config.sheets.bindingSheetName,
    ]);
    const fallback = sheets.find((sheetName) => !supportSheets.has(sheetName));

    if (!fallback) {
      throw new Error(`找不到主表分頁：${preferred}`);
    }

    console.warn(`Main sheet "${preferred}" not found. Using "${fallback}" instead.`);
    this.mainSheetName = fallback;
    return this.mainSheetName;
  }

  async ensureSupportSheets() {
    await this.sheets.ensureSheet(this.config.sheets.logSheetName, LOG_HEADERS);
    await this.sheets.ensureSheet(this.config.sheets.bindingSheetName, BINDING_HEADERS);
  }

  async loadMainSheet() {
    const sheetName = await this.resolveMainSheetName();
    const range = wholeSheetRange(sheetName);
    const values = padTable(await this.sheets.getValues(range));
    const roster = discoverRoster(values, this.config);

    if (roster.employees.length === 0) {
      throw new Error(`找不到人員資料，請確認 ${sheetName} 有工號 / 姓名 / 組別欄位。`);
    }

    return { sheetName, values, roster };
  }

  async loadBindings() {
    await this.ensureSupportSheets();
    const rows = await this.sheets.getValues(
      `'${this.config.sheets.bindingSheetName}'!A2:H500`,
    );

    return rows.map((row, index) => ({
      rowIndex: index + 1,
      userId: cleanText(row[0]),
      workerId: normalizeWorkerId(row[1]),
      name: cleanText(row[2]),
      team: cleanText(row[3]),
      displayName: cleanText(row[4]),
      groupId: cleanText(row[5]),
    }));
  }

  async findBindingByUserId(userId) {
    if (!userId) return null;
    const bindings = await this.loadBindings();
    return bindings.find((binding) => binding.userId === userId) || null;
  }

  async upsertBinding({ userId, employee, displayName, groupId }) {
    if (!userId) return;

    const bindings = await this.loadBindings();
    const existing = bindings.find((binding) => binding.userId === userId);
    const createdAt = existing ? undefined : nowText(this.config.timeZone);
    const updatedAt = nowText(this.config.timeZone);

    const row = [
      userId,
      employee.workerId,
      employee.name,
      employee.team,
      displayName || "",
      groupId || "",
      createdAt || "",
      updatedAt,
    ];

    if (existing) {
      const range = rangeA1(
        this.config.sheets.bindingSheetName,
        existing.rowIndex,
        0,
        existing.rowIndex,
        BINDING_HEADERS.length - 1,
      );
      await this.sheets.updateValues(range, [row]);
      return;
    }

    await this.sheets.appendValues(`'${this.config.sheets.bindingSheetName}'!A:H`, [row]);
  }

  async appendLog({ status, employee, dateIso, displayName, source, text, note }) {
    await this.ensureSupportSheets();
    await this.sheets.appendValues(`'${this.config.sheets.logSheetName}'!A:K`, [
      [
        nowText(this.config.timeZone),
        statusText(status),
        employee?.workerId || "",
        employee?.name || "",
        employee?.team || "",
        dateIso ? formatDateForReply(dateIso) : "",
        displayName || "",
        source?.userId || "",
        getGroupId(source),
        text || "",
        note || "",
      ],
    ]);
  }

  collectDateColumns(snapshot) {
    const dates = [];

    for (const block of snapshot.roster.blocks) {
      for (let colIndex = block.dateStartCol; colIndex <= block.dateEndCol; colIndex += 1) {
        const iso = this.getDateIsoAtColumn(snapshot, block, colIndex);
        if (!iso) continue;

        const [, month, day] = iso.split("-").map(Number);
        dates.push({ colIndex, iso, month, day });
      }
    }

    return uniqueBy(dates, (date) => `${date.colIndex}:${date.iso}`).sort((a, b) =>
      a.iso.localeCompare(b.iso),
    );
  }

  getDateIsoAtColumn(snapshot, block, colIndex) {
    const sameRow = normalizeDateValue(
      snapshot.values[block.rowIndex]?.[colIndex],
      this.config.timeZone,
    );
    if (sameRow) return sameRow;

    return normalizeDateValue(
      snapshot.values[block.rowIndex + 1]?.[colIndex],
      this.config.timeZone,
    );
  }

  resolveDateColumn(parsedDate, text, snapshot) {
    const dates = this.collectDateColumns(snapshot);
    const exact = dates.find((date) => date.iso === parsedDate.iso);
    if (exact) return exact;

    const sameMonthDay = dates.filter(
      (date) => date.month === parsedDate.month && date.day === parsedDate.day,
    );
    if (sameMonthDay.length === 1) return sameMonthDay[0];

    if (!dateInputHasMonth(text)) {
      const sameDay = dates.filter((date) => date.day === parsedDate.day);
      if (sameDay.length === 1) return sameDay[0];
    }

    return null;
  }

  formatAvailableDateRange(snapshot) {
    const dates = this.collectDateColumns(snapshot);
    if (dates.length === 0) return "";

    const first = formatDateForReply(dates[0].iso);
    const last = formatDateForReply(dates[dates.length - 1].iso);
    return first === last ? first : `${first}-${last}`;
  }

  async writeDateHeaderToBlocks(sheetName, blocks, colIndex, dateIso) {
    const data = blocks.map((block) => ({
      range: singleCellA1(sheetName, block.rowIndex, colIndex),
      values: [[formatDateForSheet(dateIso)]],
    }));

    await this.sheets.batchUpdateValues(data);
  }

  findEmployee(snapshot, workerId) {
    return (
      snapshot.roster.employees.find(
        (employee) => employee.workerId === normalizeWorkerId(workerId),
      ) || null
    );
  }

  findExistingSelection(snapshot, employee) {
    const row = snapshot.values[employee.rowIndex] || [];
    const block = employee.block;

    for (let colIndex = block.dateStartCol; colIndex <= block.dateEndCol; colIndex += 1) {
      if (cleanText(row[colIndex]).toUpperCase() !== this.config.rules.newMark) continue;

      const iso = this.getDateIsoAtColumn(snapshot, block, colIndex);
      return {
        colIndex,
        iso,
        label: iso ? formatDateForReply(iso) : cellA1(employee.rowIndex, colIndex),
      };
    }

    return null;
  }

  countForDate(snapshot, team, colIndex) {
    return snapshot.roster.employees.filter((employee) => {
      if (employee.team !== team) return false;
      const value = cleanText(snapshot.values[employee.rowIndex]?.[colIndex]).toUpperCase();
      return value === this.config.rules.newMark;
    }).length;
  }

  async writeAcceptedSelection(snapshot, employee, colIndex) {
    const updates = [];
    const row = snapshot.values[employee.rowIndex] || [];
    const block = employee.block;
    const sheetName = snapshot.sheetName;

    if (this.config.rules.allowChange) {
      for (let c = block.dateStartCol; c <= block.dateEndCol; c += 1) {
        if (c !== colIndex && cleanText(row[c]).toUpperCase() === this.config.rules.newMark) {
          updates.push({
            range: singleCellA1(sheetName, employee.rowIndex, c),
            values: [[""]],
          });
        }
      }
    }

    updates.push({
      range: singleCellA1(sheetName, employee.rowIndex, colIndex),
      values: [[this.config.rules.newMark]],
    });

    await this.sheets.batchUpdateValues(updates);
  }

  async handleTextMessage(message) {
    const queued = this.messageQueue.then(() => this.processTextMessage(message));
    this.messageQueue = queued.catch(() => {});
    return queued;
  }

  async processTextMessage({ text, source, displayName }) {
    const normalizedText = cleanText(text);
    const groupId = getGroupId(source);

    if (!normalizedText) return null;

    if (/^(規則|說明|help|rule|rules|huong dan|hướng dẫn)$/i.test(normalizedText)) {
      return RULES_TEXT;
    }

    if (/^(群組資料|groupid|group id|ma nhom|mã nhóm)$/i.test(normalizedText)) {
      const mappedTeam = this.config.rules.groupTeamMap[groupId] || "未設定";
      return multiLang({
        zh: `groupId：${groupId || "無群組 ID"}\n對應組別：${mappedTeam}`,
        en: `groupId: ${groupId || "No group ID"}\nMapped team: ${mappedTeam}`,
        vi: `groupId: ${groupId || "Không có mã nhóm"}\nNhóm tương ứng: ${mappedTeam}`,
      });
    }

    const parsedDate = parseDateFromText(normalizedText, this.config.timeZone);
    const workerIdInText = extractWorkerId(normalizedText, this.config);
    const isStatusQuery = /^(查詢|狀態|status|query|kiem tra|kiểm tra)/i.test(
      normalizedText,
    );

    if (!parsedDate && isStatusQuery) {
      return multiLang({
        zh: "請輸入要查詢的日期，例如：查詢 6/3",
        en: "Please enter the date to check, for example: status 6/3",
        vi: "Vui lòng nhập ngày cần kiểm tra, ví dụ: kiem tra 6/3",
      });
    }

    if (!parsedDate) {
      return null;
    }

    const snapshot = await this.loadMainSheet();
    const matchedDate = this.resolveDateColumn(parsedDate, normalizedText, snapshot);
    if (!matchedDate) {
      const rangeText = this.formatAvailableDateRange(snapshot) || "目前表格日期範圍";
      await this.appendLog({
        status: "NEED_DATE",
        dateIso: parsedDate.iso,
        displayName,
        source,
        text,
        note: "輸入日期不在表格指定範圍內",
      });
      return multiLang({
        zh: `此日期不在表格指定範圍內，請依照表格日期輸入。目前可登記日期：${rangeText}`,
        en: `This date is not in the sheet date range. Please enter a date shown in the sheet. Available dates: ${rangeText}`,
        vi: `Ngày này không nằm trong phạm vi ngày của bảng. Vui lòng nhập ngày có trong bảng. Ngày có thể đăng ký: ${rangeText}`,
      });
    }

    let workerId = workerIdInText;

    if (!workerId && source?.userId) {
      const binding = await this.findBindingByUserId(source.userId);
      workerId = binding?.workerId || null;
    }

    if (isStatusQuery) {
      return this.buildDateStatusReply(snapshot, matchedDate.iso, matchedDate.colIndex);
    }

    if (!workerId) {
      await this.appendLog({
        status: "NEED_WORKER_ID",
        dateIso: matchedDate.iso,
        displayName,
        source,
        text,
        note: "輸入日期但缺少工號",
      });
      return multiLang({
        zh: `請輸入工號和日期，例如：BA179 ${formatDateForReply(parsedDate.iso)}。完成第一次登記後，下次可只輸入日期。`,
        en: `Please enter your worker ID and date, for example: BA179 ${formatDateForReply(parsedDate.iso)}. After the first registration, you can enter only the date next time.`,
        vi: `Vui lòng nhập mã nhân viên và ngày, ví dụ: BA179 ${formatDateForReply(parsedDate.iso)}. Sau lần đăng ký đầu tiên, lần sau chỉ cần nhập ngày.`,
      });
    }

    const employee = this.findEmployee(snapshot, workerId);
    if (!employee) {
      await this.appendLog({
        status: "REJECTED_UNKNOWN_WORKER",
        dateIso: matchedDate.iso,
        displayName,
        source,
        text,
        note: `查無工號 ${workerId}`,
      });
      return multiLang({
        zh: `查無工號 ${workerId}，請確認工號是否正確。`,
        en: `Worker ID ${workerId} was not found. Please check the worker ID.`,
        vi: `Không tìm thấy mã nhân viên ${workerId}. Vui lòng kiểm tra lại mã nhân viên.`,
      });
    }

    const mappedTeam = this.config.rules.groupTeamMap[groupId];
    if (mappedTeam && mappedTeam !== employee.team) {
      await this.appendLog({
        status: "REJECTED_WRONG_GROUP",
        employee,
        dateIso: matchedDate.iso,
        displayName,
        source,
        text,
        note: `群組設定為 ${mappedTeam}，人員組別為 ${employee.team}`,
      });
      return multiLang({
        zh: `${employee.name} 屬於 ${employee.team}，此群組設定為 ${mappedTeam}，請到正確群組登記。`,
        en: `${employee.name} belongs to ${employee.team}. This group is set to ${mappedTeam}. Please register in the correct group.`,
        vi: `${employee.name} thuộc nhóm ${employee.team}. Nhóm này được đặt là ${mappedTeam}. Vui lòng đăng ký đúng nhóm.`,
      });
    }

    const existingBinding = source?.userId ? await this.findBindingByUserId(source.userId) : null;
    if (
      existingBinding &&
      existingBinding.workerId &&
      existingBinding.workerId !== employee.workerId
    ) {
      await this.appendLog({
        status: "REJECTED_UNKNOWN_WORKER",
        employee,
        dateIso: matchedDate.iso,
        displayName,
        source,
        text,
        note: `LINE帳號已綁定 ${existingBinding.workerId}`,
      });
      return multiLang({
        zh: `此 LINE 帳號已綁定工號 ${existingBinding.workerId}，如需變更請聯絡組長。`,
        en: `This LINE account is already linked to worker ID ${existingBinding.workerId}. Please contact the leader if it needs to be changed.`,
        vi: `Tài khoản LINE này đã liên kết với mã nhân viên ${existingBinding.workerId}. Nếu cần thay đổi, vui lòng liên hệ tổ trưởng.`,
      });
    }

    const colIndex = matchedDate.colIndex;
    const dateSnapshot = snapshot;
    const refreshedEmployee = this.findEmployee(dateSnapshot, employee.workerId);
    const existingSelection = this.findExistingSelection(dateSnapshot, refreshedEmployee);

    if (existingSelection && !this.config.rules.allowChange) {
      await this.appendLog({
        status: "REJECTED_DUPLICATE",
        employee: refreshedEmployee,
        dateIso: matchedDate.iso,
        displayName,
        source,
        text,
        note: `已登記 ${existingSelection.label}`,
      });
      return multiLang({
        zh: `${refreshedEmployee.name} 已登記 ${existingSelection.label}，如需變更請聯絡組長。`,
        en: `${refreshedEmployee.name} is already registered for ${existingSelection.label}. Please contact the leader if it needs to be changed.`,
        vi: `${refreshedEmployee.name} đã đăng ký ngày ${existingSelection.label}. Nếu cần thay đổi, vui lòng liên hệ tổ trưởng.`,
      });
    }

    const count = this.countForDate(dateSnapshot, refreshedEmployee.team, colIndex);
    const isSameCell = existingSelection && existingSelection.colIndex === colIndex;
    if (!isSameCell && count >= this.config.rules.maxPerDate) {
      await this.appendLog({
        status: "REJECTED_FULL",
        employee: refreshedEmployee,
        dateIso: matchedDate.iso,
        displayName,
        source,
        text,
        note: `${formatDateForReply(matchedDate.iso)} 已有 ${count} 人`,
      });
      return multiLang({
        zh: `${formatDateForReply(matchedDate.iso)} 已有 ${count} 人登記，名額已滿，請改選其他日期。`,
        en: `${formatDateForReply(matchedDate.iso)} already has ${count} people registered. The limit is full. Please choose another date.`,
        vi: `Ngày ${formatDateForReply(matchedDate.iso)} đã có ${count} người đăng ký, đã hết chỗ. Vui lòng chọn ngày khác.`,
      });
    }

    await this.writeAcceptedSelection(dateSnapshot, refreshedEmployee, colIndex);
    await this.upsertBinding({
      userId: source?.userId,
      employee: refreshedEmployee,
      displayName,
      groupId,
    });
    await this.appendLog({
      status: "ACCEPTED",
      employee: refreshedEmployee,
      dateIso: matchedDate.iso,
      displayName,
      source,
      text,
      note: existingSelection ? `由 ${existingSelection.label} 改為新日期` : "",
    });

    const remaining = Math.max(0, this.config.rules.maxPerDate - (isSameCell ? count : count + 1));
    return multiLang({
      zh: `${refreshedEmployee.name} 已成功登記 ${formatDateForReply(matchedDate.iso)}。\n${refreshedEmployee.team} 剩餘名額：${remaining}`,
      en: `${refreshedEmployee.name} has successfully registered for ${formatDateForReply(matchedDate.iso)}.\nRemaining slots for ${refreshedEmployee.team}: ${remaining}`,
      vi: `${refreshedEmployee.name} đã đăng ký thành công ngày ${formatDateForReply(matchedDate.iso)}.\nSố chỗ còn lại của ${refreshedEmployee.team}: ${remaining}`,
    });
  }

  buildDateStatusReply(snapshot, dateIso, colIndex) {
    const lines = [
      multiLang({
        zh: `${formatDateForReply(dateIso)} 登記狀況`,
        en: `${formatDateForReply(dateIso)} registration status`,
        vi: `Tình trạng đăng ký ngày ${formatDateForReply(dateIso)}`,
      }),
    ];
    const byTeam = new Map();

    for (const employee of snapshot.roster.employees) {
      if (this.getDateIsoAtColumn(snapshot, employee.block, colIndex) !== dateIso) continue;

      const cell = cleanText(snapshot.values[employee.rowIndex]?.[colIndex]).toUpperCase();
      if (cell !== this.config.rules.newMark) continue;

      if (!byTeam.has(employee.team)) byTeam.set(employee.team, []);
      byTeam.get(employee.team).push(`${employee.name}(${employee.workerId})`);
    }

    for (const block of snapshot.roster.blocks) {
      const teamNames = snapshot.roster.employees
        .filter((employee) => employee.block === block)
        .map((employee) => employee.team)
        .filter(Boolean);
      const team = teamNames[0];
      if (!team || lines.some((line) => line.startsWith(`${team}:`))) continue;
      if (this.getDateIsoAtColumn(snapshot, block, colIndex) !== dateIso) continue;

      const names = byTeam.get(team) || [];
      lines.push(
        `${team}: ${names.length}/${this.config.rules.maxPerDate}` +
          (names.length ? ` - ${names.join(", ")}` : ""),
      );
    }

    return lines.join("\n");
  }
}
