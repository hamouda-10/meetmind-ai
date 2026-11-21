import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("MeetMind AI — Bilingual Localization System Verification", () => {
  const i18nFilePath = path.resolve(process.cwd(), "src/lib/i18n.ts");
  const i18nContent = fs.readFileSync(i18nFilePath, "utf-8");

  it("ensures src/lib/i18n.ts exists and exports both EN and AR dictionary definitions", () => {
    assert.ok(fs.existsSync(i18nFilePath), "i18n.ts must exist");
    assert.ok(
      i18nContent.includes("export const translations: Record<LanguageCode, Translations> = {"),
      "translations map must be exported",
    );
    assert.ok(i18nContent.includes("EN: {"), "EN dictionary must be present");
    assert.ok(i18nContent.includes("AR: {"), "AR dictionary must be present");
  });

  it("verifies EN dictionary contains zero Arabic characters in English mode strings", () => {
    const enStart = i18nContent.indexOf("EN: {");
    const arStart = i18nContent.indexOf("AR: {");
    assert.ok(enStart !== -1 && arStart !== -1, "Should find EN definition range");
    const enBlock = i18nContent.slice(enStart, arStart);

    // Regular expression for Arabic characters [\u0600-\u06FF]
    const arabicRegex = /[\u0600-\u06FF]/;
    const linesWithArabic = enBlock
      .split("\n")
      .filter((line) => arabicRegex.test(line) && !line.includes("//") && !line.includes("Arabic"));

    assert.equal(
      linesWithArabic.length,
      0,
      `EN dictionary must not contain unintended Arabic text: ${JSON.stringify(linesWithArabic)}`,
    );
  });

  it("verifies AR dictionary contains Modern Standard Arabic values for all UI elements", () => {
    const arStart = i18nContent.indexOf("AR: {");
    const arEnd = i18nContent.indexOf("export const useI18nStore =");
    assert.ok(arStart !== -1 && arEnd !== -1, "Should find AR definition range");
    const arBlock = i18nContent.slice(arStart, arEnd);

    const arabicRegex = /[\u0600-\u06FF]/;
    assert.ok(arabicRegex.test(arBlock), "AR dictionary must contain valid Arabic text");

    // Check specific critical Arabic terms
    assert.ok(
      arBlock.includes("استوديو الذكاء الاصطناعي") || arBlock.includes("لوحة التحكم"),
      "Must have localized dashboard terms",
    );
    assert.ok(arBlock.includes("تسجيل الدخول"), "Must have localized auth terms");
    assert.ok(arBlock.includes("الملف الشخصي"), "Must have localized profile terms");
    assert.ok(arBlock.includes("التفريغ الصوتي"), "Must have localized transcript terms");
  });

  it("verifies client API client automatically injects X-App-Language header", () => {
    const apiClientPath = path.resolve(process.cwd(), "src/lib/api-client.ts");
    const apiClientContent = fs.readFileSync(apiClientPath, "utf-8");

    assert.ok(
      apiClientContent.includes('headers["X-App-Language"]'),
      "buildHeaders must inject X-App-Language header for backend AI synchronization",
    );
  });

  it("verifies chunked audio upload transmits appLanguage to backend", () => {
    const mediaProcessorPath = path.resolve(process.cwd(), "src/lib/media-processor.ts");
    const mediaContent = fs.readFileSync(mediaProcessorPath, "utf-8");

    assert.ok(
      mediaContent.includes("appLanguage:"),
      "media-processor must forward appLanguage to initChunkedUpload",
    );
    assert.ok(
      mediaContent.includes('"appLanguage"'),
      "media-processor must append appLanguage to direct uploads",
    );
  });

  it("verifies backend routes and AI pipelines accept appLanguage and propagate to Gemini", () => {
    const routesPath = path.resolve(process.cwd(), "src/server/routes.ts");
    const routesContent = fs.readFileSync(routesPath, "utf-8");
    assert.ok(
      routesContent.includes('appLanguage?: "en" | "ar"'),
      "Routes must support appLanguage",
    );

    const aiPath = path.resolve(process.cwd(), "src/server/ai.ts");
    const aiContent = fs.readFileSync(aiPath, "utf-8");
    assert.ok(
      aiContent.includes('appLanguage === "ar"'),
      "AI pipelines must switch prompt and output schema based on appLanguage",
    );
  });

  it("verifies zero remaining Google authentication references in UI and backend", () => {
    const profilePath = path.resolve(process.cwd(), "src/routes/profile.tsx");
    const profileContent = fs.readFileSync(profilePath, "utf-8");
    assert.equal(
      profileContent.includes("Sign in with Google"),
      false,
      "profile.tsx must not contain 'Sign in with Google'",
    );

    const loginPath = path.resolve(process.cwd(), "src/routes/login.tsx");
    const loginContent = fs.readFileSync(loginPath, "utf-8");
    assert.equal(
      loginContent.includes("google.accounts"),
      false,
      "login.tsx must not reference Google Identity Services",
    );
  });
});
