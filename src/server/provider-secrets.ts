import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "./storage";

export type SupportedProviderSecretKey =
  "ASSEMBLYAI_API_KEY" | "GEMINI_API_KEY" | "N8N_WEBHOOK_URL" | "N8N_WEBHOOK_SECRET";

interface RuntimeSecretsFileSchema {
  ASSEMBLYAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  N8N_WEBHOOK_URL?: string;
  N8N_WEBHOOK_SECRET?: string;
  updatedAt?: string;
}

let cachedSecrets: RuntimeSecretsFileSchema | null = null;
let cachedMtimeMs = 0;

function getSecretsFilePath(): string {
  return path.join(getDataDir(), ".provider_secrets.json");
}

function loadRuntimeSecrets(): RuntimeSecretsFileSchema {
  try {
    const filePath = getSecretsFilePath();
    if (!fs.existsSync(filePath)) {
      cachedSecrets = {};
      cachedMtimeMs = 0;
      return cachedSecrets;
    }
    const stat = fs.statSync(filePath);
    if (cachedSecrets && stat.mtimeMs === cachedMtimeMs) {
      return cachedSecrets;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as RuntimeSecretsFileSchema;
    cachedSecrets = parsed && typeof parsed === "object" ? parsed : {};
    cachedMtimeMs = stat.mtimeMs;
    return cachedSecrets;
  } catch {
    return cachedSecrets || {};
  }
}

export function getProviderSecret(key: SupportedProviderSecretKey): string {
  const fromEnv = (process.env[key] || "").trim();
  if (fromEnv) return fromEnv;
  const runtime = loadRuntimeSecrets();
  const val = runtime[key];
  return typeof val === "string" ? val.trim() : "";
}

export function updateProviderSecrets(
  patch: Partial<Record<SupportedProviderSecretKey, string | null>>,
): void {
  const current = { ...loadRuntimeSecrets() };
  for (const [k, v] of Object.entries(patch) as Array<
    [SupportedProviderSecretKey, string | null | undefined]
  >) {
    if (v === null) {
      delete current[k];
    } else if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed) {
        current[k] = trimmed;
      } else {
        delete current[k];
      }
    }
  }
  current.updatedAt = new Date().toISOString();
  const filePath = getSecretsFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(current, null, 2), { encoding: "utf8", mode: 0o600 });
  cachedSecrets = current;
  try {
    cachedMtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    cachedMtimeMs = Date.now();
  }
}

function maskSecretHint(val: string): string {
  if (!val || val.length < 8) return "";
  return `••••${val.slice(-4)}`;
}

export function getProviderSecretsPublicStatus(): Record<
  SupportedProviderSecretKey,
  { configured: boolean; source: "env" | "runtime" | "none"; hint: string }
> {
  const keys: SupportedProviderSecretKey[] = [
    "ASSEMBLYAI_API_KEY",
    "GEMINI_API_KEY",
    "N8N_WEBHOOK_URL",
    "N8N_WEBHOOK_SECRET",
  ];
  const runtime = loadRuntimeSecrets();
  const out = {} as Record<
    SupportedProviderSecretKey,
    { configured: boolean; source: "env" | "runtime" | "none"; hint: string }
  >;
  for (const k of keys) {
    const envVal = (process.env[k] || "").trim();
    const runVal = typeof runtime[k] === "string" ? runtime[k]!.trim() : "";
    if (envVal) {
      out[k] = {
        configured: true,
        source: "env",
        hint: k === "N8N_WEBHOOK_URL" ? envVal.replace(/\/[^/]*$/, "/•••") : maskSecretHint(envVal),
      };
    } else if (runVal) {
      out[k] = {
        configured: true,
        source: "runtime",
        hint: k === "N8N_WEBHOOK_URL" ? runVal.replace(/\/[^/]*$/, "/•••") : maskSecretHint(runVal),
      };
    } else {
      out[k] = { configured: false, source: "none", hint: "" };
    }
  }
  return out;
}
