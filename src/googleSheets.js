import crypto from "node:crypto";
import { rangeA1, quoteSheetName } from "./a1.js";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_ROOT = "https://sheets.googleapis.com/v4/spreadsheets";

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function normalizeRow(row, width) {
  const output = [...row];
  while (output.length < width) output.push("");
  return output;
}

export class GoogleSheetsClient {
  constructor({ spreadsheetId, serviceAccountEmail, privateKey }) {
    this.spreadsheetId = spreadsheetId;
    this.serviceAccountEmail = serviceAccountEmail;
    this.privateKey = privateKey;
    this.cachedToken = null;
  }

  async getAccessToken() {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedToken && this.cachedToken.expiresAt - 60 > now) {
      return this.cachedToken.token;
    }

    const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = base64Url(
      JSON.stringify({
        iss: this.serviceAccountEmail,
        scope: SHEETS_SCOPE,
        aud: TOKEN_URL,
        exp: now + 3600,
        iat: now,
      }),
    );
    const unsigned = `${header}.${claim}`;
    const signature = crypto
      .createSign("RSA-SHA256")
      .update(unsigned)
      .sign(this.privateKey, "base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const assertion = `${unsigned}.${signature}`;

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });

    if (!response.ok) {
      throw new Error(`Google token request failed: ${response.status} ${await response.text()}`);
    }

    const body = await response.json();
    this.cachedToken = {
      token: body.access_token,
      expiresAt: now + Number(body.expires_in || 3600),
    };

    return this.cachedToken.token;
  }

  async request(path, options = {}) {
    const token = await this.getAccessToken();
    const response = await fetch(`${API_ROOT}/${this.spreadsheetId}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Google Sheets request failed: ${response.status} ${await response.text()}`);
    }

    if (response.status === 204) return null;
    return response.json();
  }

  async getSpreadsheet() {
    return this.request("?fields=sheets.properties");
  }

  async getSheetProperties(sheetName) {
    const spreadsheet = await this.getSpreadsheet();
    return spreadsheet.sheets
      .map((sheet) => sheet.properties)
      .find((properties) => properties.title === sheetName);
  }

  async ensureSheet(sheetName, headerRow = []) {
    const existing = await this.getSheetProperties(sheetName);
    if (!existing) {
      await this.batchUpdate({
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName,
              },
            },
          },
        ],
      });
    }

    if (headerRow.length > 0) {
      const values = await this.getValues(`${quoteSheetName(sheetName)}!A1:Z1`);
      const firstRow = values[0] || [];
      const hasHeader = headerRow.every((header, index) => firstRow[index] === header);

      if (!hasHeader) {
        await this.updateValues(`${quoteSheetName(sheetName)}!A1`, [headerRow]);
      }
    }
  }

  async getValues(a1Range) {
    const params = new URLSearchParams({
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "SERIAL_NUMBER",
    });
    const body = await this.request(
      `/values/${encodeURIComponent(a1Range)}?${params.toString()}`,
    );
    return body.values || [];
  }

  async getCells(a1Range) {
    const body = await this.request(
      `?includeGridData=true&ranges=${encodeURIComponent(a1Range)}&fields=sheets.data.rowData.values(effectiveValue,formattedValue,effectiveFormat(backgroundColor,backgroundColorStyle))`,
    );
    const rowData = body.sheets?.[0]?.data?.[0]?.rowData || [];

    return rowData.map((row) =>
      (row.values || []).map((cell) => ({
        value: cell.effectiveValue?.stringValue ??
          cell.effectiveValue?.numberValue ??
          cell.effectiveValue?.boolValue ??
          cell.formattedValue ??
          "",
        backgroundColor:
          cell.effectiveFormat?.backgroundColor ||
          cell.effectiveFormat?.backgroundColorStyle?.rgbColor ||
          null,
      })),
    );
  }

  async updateValues(a1Range, values) {
    const params = new URLSearchParams({ valueInputOption: "USER_ENTERED" });
    return this.request(`/values/${encodeURIComponent(a1Range)}?${params.toString()}`, {
      method: "PUT",
      body: JSON.stringify({
        range: a1Range,
        majorDimension: "ROWS",
        values,
      }),
    });
  }

  async appendValues(a1Range, values) {
    const params = new URLSearchParams({
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
    });
    return this.request(
      `/values/${encodeURIComponent(a1Range)}:append?${params.toString()}`,
      {
        method: "POST",
        body: JSON.stringify({
          range: a1Range,
          majorDimension: "ROWS",
          values,
        }),
      },
    );
  }

  async batchUpdateValues(data) {
    const params = new URLSearchParams({ valueInputOption: "USER_ENTERED" });
    return this.request(`/values:batchUpdate?${params.toString()}`, {
      method: "POST",
      body: JSON.stringify({ data }),
    });
  }

  async batchUpdate(body) {
    return this.request(":batchUpdate", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async updateCellBackground(sheetName, rowIndex, colIndex, backgroundColor) {
    const properties = await this.getSheetProperties(sheetName);
    if (!properties) throw new Error(`Sheet not found: ${sheetName}`);

    return this.batchUpdate({
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: properties.sheetId,
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: colIndex,
              endColumnIndex: colIndex + 1,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor,
              },
            },
            fields: "userEnteredFormat.backgroundColor",
          },
        },
      ],
    });
  }

  async insertColumnBefore(sheetName, columnIndex) {
    const properties = await this.getSheetProperties(sheetName);
    if (!properties) throw new Error(`Sheet not found: ${sheetName}`);

    await this.batchUpdate({
      requests: [
        {
          insertDimension: {
            range: {
              sheetId: properties.sheetId,
              dimension: "COLUMNS",
              startIndex: columnIndex,
              endIndex: columnIndex + 1,
            },
            inheritFromBefore: true,
          },
        },
      ],
    });
  }
}

export function padTable(values) {
  const width = Math.max(0, ...values.map((row) => row.length));
  return values.map((row) => normalizeRow(row, width));
}

export function wholeSheetRange(sheetName, maxRows = 300, maxCols = 200) {
  return rangeA1(sheetName, 0, 0, maxRows - 1, maxCols - 1);
}
