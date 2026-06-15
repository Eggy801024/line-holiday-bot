import assert from "node:assert/strict";
import test from "node:test";
import { HolidayService } from "../src/holidayService.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function delay(ms = 2) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RED = { red: 1, green: 0, blue: 0 };
const ORANGE = { red: 1, green: 0.75, blue: 0 };
const GREEN = { red: 0, green: 0.5, blue: 0 };

function colToIndex(label) {
  let value = 0;
  for (const char of label) {
    value = value * 26 + (char.charCodeAt(0) - 64);
  }
  return value - 1;
}

function parseSingleCell(range) {
  const match = range.match(/!([A-Z]+)(\d+)$/);
  if (!match) throw new Error(`Unsupported range: ${range}`);
  return {
    rowIndex: Number(match[2]) - 1,
    colIndex: colToIndex(match[1]),
  };
}

class FakeSheetsClient {
  constructor(values, backgrounds = []) {
    this.values = values;
    this.backgrounds = backgrounds;
    this.logs = [];
  }

  async getSpreadsheet() {
    return { sheets: [{ properties: { title: "例休" } }] };
  }

  async ensureSheet() {}

  async getValues(range) {
    await delay();
    if (range.includes("Line綁定")) return [];
    return clone(this.values);
  }

  async getCells(range) {
    await delay();
    if (range.includes("Line綁定")) return [];

    return this.values.map((row, rowIndex) =>
      row.map((value, colIndex) => ({
        value,
        backgroundColor: this.backgrounds[rowIndex]?.[colIndex] || null,
      })),
    );
  }

  async appendValues(range, rows) {
    await delay();
    this.logs.push({ range, rows });
  }

  async updateValues(range, values) {
    await delay();
    const { rowIndex, colIndex } = parseSingleCell(range);
    this.values[rowIndex][colIndex] = values[0][0];
  }

  async batchUpdateValues(data) {
    await delay();
    for (const update of data) {
      const { rowIndex, colIndex } = parseSingleCell(update.range);
      this.values[rowIndex][colIndex] = update.values[0][0];
    }
  }

  async updateCellBackground(sheetName, rowIndex, colIndex, backgroundColor) {
    await delay();
    if (!this.backgrounds[rowIndex]) this.backgrounds[rowIndex] = [];
    this.backgrounds[rowIndex][colIndex] = backgroundColor;
  }
}

class ThrowingSheetsClient {
  async getSpreadsheet() {
    throw new Error("Sheets should not be read for ignored messages");
  }

  async ensureSheet() {
    throw new Error("Sheets should not be read for ignored messages");
  }

  async getValues() {
    throw new Error("Sheets should not be read for ignored messages");
  }

  async getCells() {
    throw new Error("Sheets should not be read for ignored messages");
  }

  async appendValues() {
    throw new Error("Ignored messages should not be logged");
  }
}

function makeConfig() {
  return {
    timeZone: "Asia/Taipei",
    sheets: {
      mainSheetName: "例休",
      logSheetName: "例休回覆紀錄",
      bindingSheetName: "Line綁定",
    },
    rules: {
      maxPerDate: 2,
      allowChange: false,
      workerIdPattern: /[A-Z]{1,3}\d{3,4}/i,
      groupTeamMap: {},
      newMark: "X",
      selectedBackgroundColor: RED,
      workdayLabel: "AD3",
      workdayBackgroundColor: ORANGE,
      oldMark: "O",
      maxDateColumnsWithoutOriginal: 31,
    },
  };
}

function makeSheetValues() {
  const values = [
    ["", "", "", "異動日期", "", "", "", "", "", "原例休日"],
    ["工號", "姓名", "班別\n 日期\n 群組", "A", "A", "B", "B", "A", "A", "B"],
    ["", "", "", "6/7", "6/8", "6/9", "6/10", "6/11", "6/12", "6/13"],
  ];

  for (let i = 1; i <= 50; i += 1) {
    values.push([
      `BA${String(i).padStart(3, "0")}`,
      `人員${i}`,
      "AN_A",
      "AD3",
      "AD3",
      "AD3",
      "AD3",
      "AD3",
      "AD3",
      "AD3",
    ]);
  }

  return values;
}

function makeBackgrounds(values) {
  return values.map((row, rowIndex) =>
    row.map((_, colIndex) => {
      if (rowIndex >= 3 && colIndex >= 3) return colIndex === 9 ? GREEN : ORANGE;
      return null;
    }),
  );
}

test("ignores date-only messages instead of replying from LINE binding", async () => {
  const service = new HolidayService({
    sheetsClient: new ThrowingSheetsClient(),
    config: makeConfig(),
  });

  const reply = await service.handleTextMessage({
    text: "6/8",
    source: { type: "group", groupId: "G1", userId: "U1" },
    displayName: "user-1",
  });

  assert.equal(reply, null);
});

test("ignores normal group chat that happens to mention a date", async () => {
  const service = new HolidayService({
    sheetsClient: new ThrowingSheetsClient(),
    config: makeConfig(),
  });

  const reply = await service.handleTextMessage({
    text: "大家 6/8 要開會",
    source: { type: "group", groupId: "G1", userId: "U1" },
    displayName: "user-1",
  });

  assert.equal(reply, null);
});

test("serializes concurrent registrations so max per date is not exceeded", async () => {
  const values = makeSheetValues();
  const sheets = new FakeSheetsClient(values, makeBackgrounds(values));
  const service = new HolidayService({ sheetsClient: sheets, config: makeConfig() });

  const messages = Array.from({ length: 50 }, (_, index) =>
    service.handleTextMessage({
      text: `BA${String(index + 1).padStart(3, "0")} 8`,
      source: { type: "group", groupId: "G1" },
      displayName: `user-${index + 1}`,
    }),
  );

  const replies = await Promise.all(messages);
  const accepted = replies.filter((reply) => reply.includes("已成功登記")).length;
  const full = replies.filter((reply) => reply.includes("名額已滿")).length;
  const selectedCount = sheets.values
    .slice(3, 53)
    .filter((row, index) => {
      const color = sheets.backgrounds[index + 3]?.[4];
      return color?.red === 1 && color?.green === 0 && color?.blue === 0;
    }).length;

  assert.equal(accepted, 2);
  assert.equal(full, 48);
  assert.equal(selectedCount, 2);
});

test("marks selected date red and changes original green holiday to orange AD3", async () => {
  const values = makeSheetValues();
  const sheets = new FakeSheetsClient(values, makeBackgrounds(values));
  const service = new HolidayService({ sheetsClient: sheets, config: makeConfig() });

  const reply = await service.handleTextMessage({
    text: "BA001 6/8",
    source: { type: "group", groupId: "G1" },
    displayName: "user-1",
  });

  assert.match(reply, /已成功登記/);
  const selectedCol = sheets.backgrounds[3].findIndex(
    (color) => color?.red === 1 && color?.green === 0 && color?.blue === 0,
  );
  assert.equal(selectedCol, 4);
  assert.equal(sheets.values[3][selectedCol], "");
  assert.equal(sheets.values[3][9], "AD3");
  assert.deepEqual(sheets.backgrounds[3][9], ORANGE);
});
