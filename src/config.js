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

function getRequired(name, env = process.env) {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseServiceAccountJsonContent(content, sourceName) {
  const parsed = JSON.parse(content);

  if (parsed.type !== "service_account") {
    throw new Error(`${sourceName} is not a service account JSON file`);
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(`${sourceName} is missing client_email or private_key`);
  }

  return {
    serviceAccountEmail: parsed.client_email,
    privateKey: parsed.private_key,
  };
}

function parseServiceAccountJson(filePath) {
  return parseServiceAccountJsonContent(fs.readFileSync(filePath, "utf8"), filePath);
}

function getPrivateKey(env = process.env) {
  if (env.GOOGLE_PRIVATE_KEY) {
    return env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
  }

  if (env.GOOGLE_PRIVATE_KEY_PATH) {
    const content = fs.readFileSync(env.GOOGLE_PRIVATE_KEY_PATH, "utf8");

    if (content.trim().startsWith("{")) {
      const parsed = JSON.parse(content);
      if (parsed.private_key) return parsed.private_key;
    }

    return content;
  }

  throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_PRIVATE_KEY, GOOGLE_PRIVATE_KEY_PATH, or GOOGLE_SERVICE_ACCOUNT_JSON_PATH in environment");
}

function parseJsonMap(name, env = process.env) {
  const raw = env[name] || "{}";
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${name} must be valid JSON`);
  }
}

export function buildConfig(env = process.env) {
  const serviceAccount = env.GOOGLE_SERVICE_ACCOUNT_JSON
    ? parseServiceAccountJsonContent(env.GOOGLE_SERVICE_ACCOUNT_JSON, "GOOGLE_SERVICE_ACCOUNT_JSON")
    : env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH
    ? parseServiceAccountJson(env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH)
    : null;

  return {
    port: Number(env.PORT || 3000),
    timeZone: env.TIME_ZONE || "Asia/Taipei",
    line: {
      channelSecret: getRequired("LINE_CHANNEL_SECRET", env),
      channelAccessToken: getRequired("LINE_CHANNEL_ACCESS_TOKEN", env),
    },
    google: {
      spreadsheetId: getRequired("GOOGLE_SPREADSHEET_ID", env),
      serviceAccountEmail:
        env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
        serviceAccount?.serviceAccountEmail ||
        getRequired("GOOGLE_SERVICE_ACCOUNT_EMAIL", env),
      privateKey: serviceAccount?.privateKey || getPrivateKey(env),
    },
    sheets: {
      mainSheetName: env.SHEET_NAME || "例休",
      logSheetName: env.LOG_SHEET_NAME || "例休回覆紀錄",
      bindingSheetName: env.BINDING_SHEET_NAME || "Line綁定",
      scheduledPushSheetName: env.SCHEDULED_PUSH_SHEET_NAME || "定時推播",
    },
    rules: {
      maxPerDate: Number(env.MAX_PER_DATE || 2),
      allowChange: String(env.ALLOW_CHANGE || "false").toLowerCase() ===
        "true",
      workerIdPattern: new RegExp(
        env.WORKER_ID_PATTERN || "[A-Z]{1,3}\\d{3,4}",
        "i",
      ),
      groupTeamMap: parseJsonMap("GROUP_TEAM_MAP_JSON", env),
      newMark: "X",
      selectedBackgroundColor: { red: 1, green: 0, blue: 0 },
      workdayLabel: "AD3",
      workdayBackgroundColor: { red: 1, green: 0.75, blue: 0 },
      oldMark: "O",
      maxDateColumnsWithoutOriginal: 31,
    },
  };
}

export function getConfig() {
  loadEnvFile();
  return buildConfig(process.env);
}
