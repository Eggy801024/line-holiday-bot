import assert from "node:assert/strict";
import test from "node:test";
import { formatDateForReply, formatDateForSheet, parseDateFromText } from "../src/dateParser.js";

const today = { year: 2026, month: 5, day: 29 };

test("parses month/day formats", () => {
  assert.equal(parseDateFromText("BA179 6/3", "Asia/Taipei", today).iso, "2026-06-03");
  assert.equal(parseDateFromText("06/03", "Asia/Taipei", today).iso, "2026-06-03");
  assert.equal(parseDateFromText("6月3日", "Asia/Taipei", today).iso, "2026-06-03");
  assert.equal(parseDateFromText("2026-6-3", "Asia/Taipei", today).iso, "2026-06-03");
});

test("parses full width digits", () => {
  assert.equal(parseDateFromText("ＢＡ179 ６／３", "Asia/Taipei", today).iso, "2026-06-03");
});

test("formats date for sheet and reply", () => {
  assert.equal(formatDateForSheet("2026-06-03"), "6/3");
  assert.equal(formatDateForReply("2026-06-03"), "6/3");
});
