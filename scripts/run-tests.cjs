const { spawn, spawnSync } = require("child_process");
const http = require("http");

function probe(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const req = http.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname + (u.search || ""),
          method: "GET",
          timeout: timeoutMs,
        },
        (res) => {
          res.resume();
          resolve(res.statusCode < 500);
        },
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    } catch {
      resolve(false);
    }
  });
}

async function waitForServer(url, maxWaitMs = 35000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await probe(url)) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

async function main() {
  const isPort3000Ready = await probe("http://127.0.0.1:3000/api/v1/auth/config");
  const isPort5173Ready = await probe("http://127.0.0.1:5173/api/v1/auth/config");

  let serverProcess = null;
  let testUrl = "http://127.0.0.1:3000";

  if (isPort3000Ready) {
    testUrl = "http://127.0.0.1:3000";
    console.log("Found active server on http://127.0.0.1:3000");
  } else if (isPort5173Ready) {
    testUrl = "http://127.0.0.1:5173";
    console.log("Found active server on http://127.0.0.1:5173");
  } else {
    console.log("Starting test server on http://127.0.0.1:5173...");
    testUrl = "http://127.0.0.1:5173";
    serverProcess = spawn("cmd.exe", ["/c", "npx vite --port 5173 --host 127.0.0.1"], {
      stdio: "pipe",
      env: {
        ...process.env,
        NODE_ENV: "test",
      },
    });

    serverProcess.stderr.on("data", (d) => {
      const msg = d.toString();
      if (!msg.includes("vite-tsconfig-paths") && !msg.includes("DeprecationWarning")) {
        process.stderr.write(msg);
      }
    });

    const ready = await waitForServer("http://127.0.0.1:5173/api/v1/auth/config", 35000);
    if (!ready) {
      console.error("Test server failed to start within timeout.");
      try {
        serverProcess.kill();
      } catch {}
      process.exit(1);
    }
    // Warm up SSR and API health routes before parallel tests hit Vite dev server
    await probe("http://127.0.0.1:5173/api/v1/health", 10000);
    await probe("http://127.0.0.1:5173/login", 10000);
    console.log("Test server ready on http://127.0.0.1:5173");
  }

  const testFiles =
    process.argv.slice(2).length > 0
      ? process.argv.slice(2)
      : [
          "tests/i18n.test.mjs",
          "tests/auth.test.mjs",
          "tests/theme.test.mjs",
          "tests/chat-engine.test.mjs",
          "tests/n8n-assemblyai-integration.test.mjs",
        ];

  console.log(`Running tests against ${testUrl}: ${testFiles.join(", ")}`);

  const testRun = spawnSync("node", ["--test", ...testFiles], {
    stdio: "inherit",
    env: {
      ...process.env,
      MEETMIND_TEST_URL: testUrl,
    },
  });

  if (serverProcess) {
    try {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(serverProcess.pid), "/T", "/F"]);
      } else {
        serverProcess.kill();
      }
    } catch {
      // safe cleanup
    }
  }

  process.exit(testRun.status ?? 0);
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
