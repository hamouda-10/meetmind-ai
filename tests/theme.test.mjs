import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";

const ROOT = process.cwd();
const BASE_URL = process.env.MEETMIND_TEST_URL || "http://127.0.0.1:5173";

function readRel(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("MeetMind AI — 3-Mode Color Theme System Verification", () => {
  test("defines Black & Gold (default), Pure White, and Sky Blue with exact user-facing labels", () => {
    const src = readRel("src/lib/theme.ts");
    assert.match(src, /export const DEFAULT_THEME:\s*ThemeId\s*=\s*"black-gold"/);
    assert.match(src, /id:\s*"black-gold"/);
    assert.match(src, /id:\s*"pure-white"/);
    assert.match(src, /id:\s*"sky-blue"/);
    assert.match(src, /label:\s*"Black & Gold"/);
    assert.match(src, /label:\s*"Pure White"/);
    assert.match(src, /label:\s*"Sky Blue"/);
    // Must not expose technical or AI-branded theme names to users
    assert.doesNotMatch(src, /label:\s*"(AI Neon|AI Mode|Dark Mode|Theme 3)"/);
    assert.match(src, /export function normalizeTheme/);
  });

  test("defines centralized CSS design tokens for Black & Gold, Pure White, and Sky Blue", () => {
    const css = readRel("src/styles.css");
    const requiredTokens = [
      "--bg-primary:",
      "--bg-secondary:",
      "--surface:",
      "--surface-elevated:",
      "--text-primary:",
      "--text-secondary:",
      "--text-muted:",
      "--border:",
      "--primary:",
      "--primary-hover:",
      "--accent:",
      "--success:",
      "--warning:",
      "--error:",
      "--info:",
      "--shadow:",
      "--glow:",
    ];
    for (const token of requiredTokens) {
      const matches = css.match(new RegExp(token.replace(/-/g, "\\-"), "g")) || [];
      assert.ok(
        matches.length >= 3,
        `Expected token ${token} in all 3 theme blocks, found ${matches.length}`,
      );
    }

    // Theme 1 — Black & Gold (Default)
    assert.match(css, /html\[data-theme="black-gold"\]/);
    assert.match(css, /#d4af37/i);

    // Theme 2 — Pure White exact palette
    assert.match(css, /html\[data-theme="pure-white"\]/);
    assert.match(css, /--bg-primary:\s*#ffffff/i);
    assert.match(css, /--bg-secondary:\s*#f7f8fa/i);
    assert.match(css, /--surface-elevated:\s*#f3f4f6/i);
    assert.match(css, /--text-primary:\s*#111111/i);
    assert.match(css, /--text-secondary:\s*#4b5563/i);
    assert.match(css, /--text-muted:\s*#6b7280/i);
    assert.match(css, /--border:\s*#e5e7eb/i);

    // Theme 3 — Light Sky Blue exact palette
    assert.match(css, /html\[data-theme="sky-blue"\]/);
    assert.match(css, /--bg-primary:\s*#f4faff/i);
    assert.match(css, /--bg-secondary:\s*#eaf6ff/i);
    assert.match(css, /--surface-elevated:\s*#f8fcff/i);
    assert.match(css, /--primary:\s*#0284c7/i);
    assert.match(css, /--primary-hover:\s*#0369a1/i);
    assert.match(css, /#38bdf8/i);
    assert.match(css, /--accent:\s*#06b6d4/i);
    assert.match(css, /--text-primary:\s*#0f172a/i);
    assert.match(css, /--text-secondary:\s*#334155/i);
    assert.match(css, /--text-muted:\s*#64748b/i);
    assert.match(css, /--border:\s*#bae6fd/i);
  });

  test("serves synchronous zero-FOUC 3-mode theme init script in SSR HTML", async () => {
    const res = await fetch(`${BASE_URL}/login`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /meetmind-theme/);
    assert.match(html, /black-gold/);
    assert.match(html, /pure-white/);
    assert.match(html, /sky-blue/);
    assert.match(html, /dataset\.theme/);
  });

  test("exposes accessible Theme Selector (Black & Gold, Pure White, Sky Blue) in Navbar, Settings, and Command Palette", () => {
    const switcher = readRel("src/components/topbar/theme-toggle.tsx");
    assert.match(switcher, /role="menu"/);
    assert.match(switcher, /role="menuitemradio"/);
    assert.match(switcher, /aria-checked/);
    assert.match(switcher, /THEME_OPTIONS/);
    assert.doesNotMatch(switcher, /AI Neon|AI Mode/);

    const settings = readRel("src/views/settings-view.tsx");
    assert.match(settings, /THEME_OPTIONS/);
    assert.match(settings, /data-settings-theme/);
    assert.match(settings, /aria-pressed/);

    const cmd = readRel("src/components/command/command-palette.tsx");
    assert.match(cmd, /Black &amp; Gold/);
    assert.match(cmd, /Pure White/);
    assert.match(cmd, /Sky Blue/);
  });

  test("adapts Logo, AmbientBackground, AI Speech Core, 3D Orb, Radar, Studio Hub, and AuthShell to all 3 themes", () => {
    const files = [
      "src/components/common/ambient-background.tsx",
      "src/components/dashboard/central-mic-core.tsx",
      "src/components/3d/audio-orb-3d.tsx",
      "src/components/dashboard/ai-radar-3d-card.tsx",
      "src/components/dashboard/audio-center-card.tsx",
      "src/components/auth/auth-shell.tsx",
    ];
    for (const file of files) {
      const content = readRel(file);
      assert.match(content, /resolvedTheme/, `${file} must react to resolvedTheme`);
      assert.match(content, /sky-blue/, `${file} must handle sky-blue theme`);
      assert.match(content, /pure-white/, `${file} must handle pure-white theme`);
    }
  });
});
