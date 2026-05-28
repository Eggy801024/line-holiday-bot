import { cellA1, rangeA1, singleCellA1 } from "./a1.js";
import { formatDateForReply, formatDateForSheet, normalizeDateValue, parseDateFromText } from "./dateParser.js";
import { padTable, wholeSheetRange } from "./googleSheets.js";
import { RULES_TEXT } from "./rulesText.js";

const LOG_HEADERS = [
  "處理時間",
  "狀態",
  "工號",
  "姓名",
  "班別",
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
  "班別",
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

function findHeaderRows(values) {
  const headers = [];

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    const idCol = row.findIndex((cell) => cleanText(cell) === "工號");
    const nameCol = row.findIndex((cell) => cleanText(cell) === "姓名");
    const groupCol = row.findIndex(
      (cell) => textIncludes(cell, "班別") || textIncludes(cell, "群組"),
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
      if (textIncludes(row[colIndex], "原例休日")) {
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
      originalCol > dateStartCol
        ? originalCol - 1
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
    ACCEPTED: "已登記",
    REJECTED_FULL: "已額滿",
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
      throw new Error(`找不到主表分頁，請建立 ${preferred} 分頁`);
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
      throw new Error(
        `找不到人員清單，請確認 ${sheetName} 分頁有「工號 / 姓名 / 班別」標題`,
      );
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

  async ensureDateColumn(dateIso, snapshot) {
    const { values, roster } = snapshot;
    const sheetName = snapshot.sheetName;

    for (const block of roster.blocks) {
      for (let colIndex = block.dateStartCol; colIndex <= block.dateEndCol; colIndex += 1) {
        const headerDate = normalizeDateValue(values[block.rowIndex]?.[colIndex], this.config.timeZone);
        if (headerDate === dateIso) return { colIndex, snapshot };
      }
    }

    const firstBlock = roster.blocks[0];
    for (
      let colIndex = firstBlock.dateStartCol;
      colIndex <= firstBlock.dateEndCol;
      colIndex += 1
    ) {
      const isBlankInEveryBlock = roster.blocks.every(
        (block) => !cleanText(values[block.rowIndex]?.[colIndex]),
      );

      if (isBlankInEveryBlock) {
        await this.writeDateHeaderToBlocks(sheetName, roster.blocks, colIndex, dateIso);
        const updatedSnapshot = await this.loadMainSheet();
        return { colIndex, snapshot: updatedSnapshot };
      }
    }

    if (firstBlock.originalCol > firstBlock.dateStartCol) {
      await this.sheets.insertColumnBefore(sheetName, firstBlock.originalCol);
      const afterInsert = await this.loadMainSheet();
      const insertedCol = afterInsert.roster.blocks[0].originalCol - 1;
      await this.writeDateHeaderToBlocks(afterInsert.sheetName, afterInsert.roster.blocks, insertedCol, dateIso);
      const updatedSnapshot = await this.loadMainSheet();
      return { colIndex: insertedCol, snapshot: updatedSnapshot };
    }

    throw new Error("日期欄位已滿，且找不到「原例休日」欄位可新增日期欄");
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

      const headerValue = snapshot.values[block.rowIndex]?.[colIndex];
      const iso = normalizeDateValue(headerValue, this.config.timeZone);
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

  async handleTextMessage({ text, source, displayName }) {
    const normalizedText = cleanText(text);
    const groupId = getGroupId(source);

    if (!normalizedText) return null;

    if (/^(規則|說明|help)$/i.test(normalizedText)) {
      return RULES_TEXT;
    }

    if (/^(群組資訊|groupid|group id)$/i.test(normalizedText)) {
      const mappedTeam = this.config.rules.groupTeamMap[groupId] || "未設定";
      return [`groupId: ${groupId || "非群組訊息"}`, `對應班別: ${mappedTeam}`].join("\n");
    }

    const parsedDate = parseDateFromText(normalizedText, this.config.timeZone);
    const workerIdInText = extractWorkerId(normalizedText, this.config);

    if (!parsedDate && /^(查詢|狀態)$/i.test(normalizedText)) {
      return "請輸入要查詢的日期，例如：查詢 6/3";
    }

    if (!parsedDate) {
      return null;
    }

    const snapshot = await this.loadMainSheet();
    let workerId = workerIdInText;

    if (!workerId && source?.userId) {
      const binding = await this.findBindingByUserId(source.userId);
      workerId = binding?.workerId || null;
    }

    if (/^(查詢|狀態)/i.test(normalizedText)) {
      const { colIndex, snapshot: dateSnapshot } = await this.ensureDateColumn(
        parsedDate.iso,
        snapshot,
      );
      return this.buildDateStatusReply(dateSnapshot, parsedDate.iso, colIndex);
    }

    if (!workerId) {
      await this.appendLog({
        status: "NEED_WORKER_ID",
        dateIso: parsedDate.iso,
        displayName,
        source,
        text,
        note: "首次登記需要工號",
      });
      return `請輸入「工號 日期」，例如：BA179 ${formatDateForReply(parsedDate.iso)}。綁定後下次可以只輸入日期。`;
    }

    const employee = this.findEmployee(snapshot, workerId);
    if (!employee) {
      await this.appendLog({
        status: "REJECTED_UNKNOWN_WORKER",
        dateIso: parsedDate.iso,
        displayName,
        source,
        text,
        note: `查無工號 ${workerId}`,
      });
      return `查不到工號 ${workerId}，請確認工號是否正確。`;
    }

    const mappedTeam = this.config.rules.groupTeamMap[groupId];
    if (mappedTeam && mappedTeam !== employee.team) {
      await this.appendLog({
        status: "REJECTED_WRONG_GROUP",
        employee,
        dateIso: parsedDate.iso,
        displayName,
        source,
        text,
        note: `群組設定為 ${mappedTeam}，同仁班別為 ${employee.team}`,
      });
      return `${employee.name} 是 ${employee.team}，這個群組設定為 ${mappedTeam}，請到正確群組登記。`;
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
        dateIso: parsedDate.iso,
        displayName,
        source,
        text,
        note: `LINE帳號已綁定 ${existingBinding.workerId}`,
      });
      return `這個 LINE 帳號已綁定 ${existingBinding.workerId}，要更換請私訊組長處理。`;
    }

    const { colIndex, snapshot: dateSnapshot } = await this.ensureDateColumn(
      parsedDate.iso,
      snapshot,
    );
    const refreshedEmployee = this.findEmployee(dateSnapshot, employee.workerId);
    const existingSelection = this.findExistingSelection(dateSnapshot, refreshedEmployee);

    if (existingSelection && !this.config.rules.allowChange) {
      await this.appendLog({
        status: "REJECTED_DUPLICATE",
        employee: refreshedEmployee,
        dateIso: parsedDate.iso,
        displayName,
        source,
        text,
        note: `已登記 ${existingSelection.label}`,
      });
      return `${refreshedEmployee.name} 已登記 ${existingSelection.label}。要更改請私訊組長。`;
    }

    const count = this.countForDate(dateSnapshot, refreshedEmployee.team, colIndex);
    const isSameCell =
      existingSelection && existingSelection.colIndex === colIndex;
    if (!isSameCell && count >= this.config.rules.maxPerDate) {
      await this.appendLog({
        status: "REJECTED_FULL",
        employee: refreshedEmployee,
        dateIso: parsedDate.iso,
        displayName,
        source,
        text,
        note: `${formatDateForReply(parsedDate.iso)} 已有 ${count} 人`,
      });
      return `${formatDateForReply(parsedDate.iso)} 已經有 ${count} 位同仁登記，請改選其他日期。`;
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
      dateIso: parsedDate.iso,
      displayName,
      source,
      text,
      note: existingSelection ? `由 ${existingSelection.label} 改為此日期` : "",
    });

    const remaining = Math.max(0, this.config.rules.maxPerDate - (isSameCell ? count : count + 1));
    return [
      `${refreshedEmployee.name} 已登記 ${formatDateForReply(parsedDate.iso)}。`,
      `目前 ${refreshedEmployee.team} 這天剩 ${remaining} 個名額。`,
    ].join("\n");
  }

  buildDateStatusReply(snapshot, dateIso, colIndex) {
    const lines = [`${formatDateForReply(dateIso)} 登記狀態：`];
    const byTeam = new Map();

    for (const employee of snapshot.roster.employees) {
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

      const names = byTeam.get(team) || [];
      lines.push(
        `${team}: ${names.length}/${this.config.rules.maxPerDate}` +
          (names.length ? ` - ${names.join("、")}` : ""),
      );
    }

    return lines.join("\n");
  }
}
