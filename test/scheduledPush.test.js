import assert from "node:assert/strict";
import test from "node:test";
import { ScheduledPushService } from "../src/scheduledPush.js";

class FakeSheetsClient {
  constructor(rows = []) {
    this.rows = rows;
    this.appendedRows = [];
    this.updates = [];
  }

  async ensureSheet() {}

  async getValues() {
    return this.rows;
  }

  async appendValues(range, rows) {
    this.appendedRows.push({ range, rows });
    this.rows = rows;
  }

  async updateValues(range, values) {
    this.updates.push({ range, values });
    const match = range.match(/!G(\d+)$/);
    if (match) this.rows[Number(match[1]) - 2][6] = values[0][0];
  }
}

class FakeLineClient {
  constructor() {
    this.messages = [];
  }

  async pushText(to, text) {
    this.messages.push({ to, text });
  }
}

function makeService(rows) {
  const sheets = new FakeSheetsClient(rows);
  const line = new FakeLineClient();
  const service = new ScheduledPushService({
    sheetsClient: sheets,
    lineClient: line,
    config: {
      timeZone: "Asia/Taipei",
      sheets: { scheduledPushSheetName: "scheduled" },
    },
  });
  return { service, sheets, line };
}

test("creates default scheduled push rows when the sheet is empty", async () => {
  const { service, sheets, line } = makeService([]);
  await service.run(Date.UTC(2026, 0, 14, 12, 30));

  assert.equal(sheets.appendedRows.length, 1);
  assert.equal(sheets.rows.length, 4);
  assert.equal(line.messages.length, 0);
});

test("sends matching monthly push once and marks the row as sent", async () => {
  const { service, sheets, line } = makeService([
    ["TRUE", "1,2,3,7,8,9", "14", 0.8541666666666666, "Cgroup", "message", "", "first"],
  ]);

  const scheduledTime = Date.UTC(2026, 0, 14, 12, 30);
  const first = await service.run(scheduledTime);
  const second = await service.run(scheduledTime);

  assert.equal(first.sentCount, 1);
  assert.equal(second.sentCount, 0);
  assert.equal(line.messages.length, 1);
  assert.equal(line.messages[0].to, "Cgroup");
  assert.equal(sheets.rows[0][6], "2026-01");
});

test("supports multiple group IDs in one cell separated by new lines", async () => {
  const { service, sheets, line } = makeService([
    ["TRUE", "1,2,3,7,8,9", "14", "20:30", "CgroupA\nCgroupB", "message", "", "first"],
  ]);

  const result = await service.run(Date.UTC(2026, 0, 14, 12, 30));

  assert.equal(result.sentCount, 2);
  assert.deepEqual(
    line.messages.map((message) => message.to),
    ["CgroupA", "CgroupB"],
  );
  assert.equal(sheets.rows[0][6], "2026-01");
});

test("supports multiple group IDs in one cell separated by commas", async () => {
  const { service, line } = makeService([
    ["TRUE", "1,2,3,7,8,9", "14", "20:30", "CgroupA,CgroupB", "message", "", "first"],
  ]);

  const result = await service.run(Date.UTC(2026, 0, 14, 12, 30));

  assert.equal(result.sentCount, 2);
  assert.deepEqual(
    line.messages.map((message) => message.to),
    ["CgroupA", "CgroupB"],
  );
});
