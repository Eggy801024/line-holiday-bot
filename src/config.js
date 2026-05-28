import fs from "node:fs";
import path from "node:path";

function parseDotEnv(content) {
  const env = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value.replace(/\\n/g, "\n");
  }

  return env;
}

export function loadEnvFile(filePath = path.resolve(".env")) {
  if (!fs.existsSync(filePath)) return;
  const parsed = parseDotEnv(fs.readFileSync(filePath, "utf8"));

  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function getRequired(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseServiceAccountJson(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));

  if (parsed.type !== "service_account") {
    throw new Error(`${filePath} is not a service account JSON file`);
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(`${filePath} is missing client_email or private_key`);
  }

  return {
    serviceAccountEmail: parsed.client_email,
    privateKey: parsed.private_key,
  };
}

function getPrivateKey() {
  if (process.env.GOOGLE_PRIVATE_KEY) {
    return process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
  }

  if (process.env.GOOGLE_PRIVATE_KEY_PATH) {
    const content = fs.readFileSync(process.env.GOOGLE_PRIVATE_KEY_PATH, "utf8");

    if (content.trim().startsWith("{")) {
      const parsed = JSON.parse(content);
      if (parsed.private_key) return parsed.private_key;
    }

    return content;
  }

  throw new Error("Missing GOOGLE_PRIVATE_KEY, GOOGLE_PRIVATE_KEY_PATH, or GOOGLE_SERVICE_ACCOUNT_JSON_PATH in environment");
}

function parseJsonMap(name) {
  const raw = process.env[name] || "{}";
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${name} must be valid JSON`);
  }
}

export function getConfig() {
  loadEnvFile();
  const serviceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH
    ? parseServiceAccountJson(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH)
    : null;

  return {
    port: Number(process.env.PORT || 3000),
    timeZone: process.env.TIME_ZONE || "Asia/Taipei",
    line: {
      channelSecret: getRequired("LINE_CHANNEL_SECRET"),
      channelAccessToken: getRequired("LINE_CHANNEL_ACCESS_TOKEN"),
    },
    google: {
      spreadsheetId: getRequired("GOOGLE_SPREADSHEET_ID"),
      serviceAccountEmail:
        process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
        serviceAccount?.serviceAccountEmail ||
        getRequired("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
      privateKey: serviceAccount?.privateKey || getPrivateKey(),
    },
    sheets: {
      mainSheetName: process.env.SHEET_NAME || "例休",
      logSheetName: process.env.LOG_SHEET_NAME || "例休回覆紀錄",
      bindingSheetName: process.env.BINDING_SHEET_NAME || "Line綁定",
    },
    rules: {
      maxPerDate: Number(process.env.MAX_PER_DATE || 2),
      allowChange: String(process.env.ALLOW_CHANGE || "false").toLowerCase() ===
        "true",
      workerIdPattern: new RegExp(
        process.env.WORKER_ID_PATTERN || "[A-Z]{1,3}\\d{3,4}",
        "i",
      ),
      groupTeamMap: parseJsonMap("GROUP_TEAM_MAP_JSON"),
      newMark: "X",
      oldMark: "O",
      maxDateColumnsWithoutOriginal: 31,
    },
  };
}
