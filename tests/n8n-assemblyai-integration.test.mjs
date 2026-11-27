import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";

const ROOT = process.cwd();
const BASE_URL = process.env.MEETMIND_TEST_URL || "http://127.0.0.1:5173";

function readRel(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("MeetMind AI — n8n, AssemblyAI, Grounded Quiz, Security & Observability Suite", () => {
  test("never hard-codes localhost:5678 or API keys in frontend/backend code or workflow template", () => {
    const filesToCheck = [
      "src/server/n8n-integration.ts",
      "src/server/assemblyai.ts",
      "src/server/jobs.ts",
      "src/server/routes.ts",
      "src/components/common/upload-recording-dialog.tsx",
      "src/lib/api-client.ts",
      "n8n/meetmind-workflow.production.json",
    ];

    for (const rel of filesToCheck) {
      const content = readRel(rel);
      assert.doesNotMatch(content, /localhost:5678/, `${rel} must not hardcode localhost:5678`);
      assert.doesNotMatch(content, /8c9ebbf2272/, `${rel} must not contain raw AssemblyAI key`);
      assert.doesNotMatch(content, /AQ\.Ab8RN6/, `${rel} must not contain raw Gemini key`);
      assert.doesNotMatch(
        content,
        /AIza[0-9A-Za-z_-]{20,}/,
        `${rel} must not contain raw Google API key`,
      );
    }

    const envExample = readRel(".env.example");
    assert.match(envExample, /^N8N_WEBHOOK_URL=/m);
    assert.match(envExample, /^ASSEMBLYAI_API_KEY=/m);
    assert.match(envExample, /^GEMINI_API_KEY=/m);
    assert.match(envExample, /^DATABASE_URL=/m);
  });

  test("enforces Vercel localhost protection, universal n8n contract adapter, and single-source-of-truth pipeline", () => {
    const n8nSrc = readRel("src/server/n8n-integration.ts");
    assert.match(n8nSrc, /process\.env\.N8N_WEBHOOK_URL/);
    assert.match(n8nSrc, /isProductionVercel && local/);
    assert.match(n8nSrc, /export function parseN8nWorkflowResponse/);
    assert.match(n8nSrc, /export async function executeN8nAudioWorkflow/);
    assert.match(n8nSrc, /form\.append\("audio"/);

    const aaiSrc = readRel("src/server/assemblyai.ts");
    assert.match(aaiSrc, /https:\/\/api\.assemblyai\.com\/v2/);
    assert.match(aaiSrc, /speaker_labels:\s*true/);
    assert.match(aaiSrc, /process\.env\.ASSEMBLYAI_API_KEY/);
    assert.match(aaiSrc, /\[2000,\s*3000,\s*5000,\s*8000,\s*10000\]/);

    const n8nWorkflow = readRel("n8n/meetmind-workflow.production.json");
    assert.match(n8nWorkflow, /\[2,\s*3,\s*5,\s*8,\s*10\]/);
    assert.doesNotMatch(n8nWorkflow, /Style Report|Create HTML File/);
    assert.match(n8nWorkflow, /maxOutputTokens\\?":\s*4096/);

    const cacheSrc = readRel("src/server/pipeline-cache.ts");
    assert.match(cacheSrc, /getCachedTranscriptByAudioHash/);
    assert.match(cacheSrc, /setCachedTranscriptByAudioHash/);

    const jobsSrc = readRel("src/server/jobs.ts");
    assert.match(jobsSrc, /persistN8nWorkflowResult/);
    assert.match(jobsSrc, /executeN8nAudioWorkflow/);
    assert.match(jobsSrc, /transcribeAudioWithAssemblyAi/);
    assert.match(jobsSrc, /getCachedTranscriptByAudioHash/);
    assert.match(jobsSrc, /logStageTiming/);
    assert.match(jobsSrc, /if \(!n8nConfig\.fallbackToDirect\)/);
  });

  test("enforces strict grounded MCQ (4 unique options) + True/False (2 options) max 20 quiz and bilingual Quiz UI", () => {
    const aiSrc = readRel("src/server/ai.ts");
    assert.match(aiSrc, /Math\.min\(20,\s*requestedCount\)/);
    assert.match(aiSrc, /uniqueOpts\.length < 4/);
    assert.match(aiSrc, /quiz_generation_started/);
    assert.match(aiSrc, /quiz_generation_completed/);

    const quizUi = readRel("src/views/quiz-view.tsx");
    assert.match(quizUi, /السؤال \$\{qIndex \+ 1\}/);
    assert.match(quizUi, /Question \$\{qIndex \+ 1\}/);
    assert.match(quizUi, /rose-500/);
    assert.match(quizUi, /dir=\{isQuestionArabic \? "rtl" : "ltr"\}/);
    assert.match(quizUi, /value="20"/);
  });

  test("defines exact Modern Academy graduation project AI identity in Arabic and English", () => {
    const ctxSrc = readRel("src/server/chat-context.ts");
    assert.match(
      ctxSrc,
      /I was developed by a group of software engineering students from the Computer Science Department at Modern Academy as part of the MeetMind AI graduation project\./,
    );
    assert.match(
      ctxSrc,
      /تم تطويري بواسطة مجموعة من طلاب هندسة البرمجيات من قسم علوم الحاسب في Modern Academy كجزء من مشروع التخرج MeetMind AI\./,
    );
  });

  test("live API exposes n8n & AssemblyAI readiness without secrets and rejects invalid audio gracefully", async () => {
    const healthRes = await fetch(`${BASE_URL}/api/v1/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.status, "healthy");
    assert.equal(typeof health.n8n?.configured, "boolean");
    assert.equal(typeof health.assemblyAiConfigured, "boolean");
    assert.doesNotMatch(JSON.stringify(health), /8c9ebbf2272|AQ\.Ab8RN6|AIza[0-9A-Za-z_-]{20,}/);

    const statusRes = await fetch(`${BASE_URL}/api/v1/ai/status`);
    assert.equal(statusRes.status, 200);
    const statusJson = await statusRes.json();
    assert.equal(typeof statusJson.n8n?.configured, "boolean");
    assert.equal(typeof statusJson.assemblyAiConfigured, "boolean");

    // Auth as guest and upload an unsupported .txt file -> must fail cleanly with 400 (Test 9)
    const guestRes = await fetch(`${BASE_URL}/api/v1/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(guestRes.status, 200);
    const guest = await guestRes.json();

    const badForm = new FormData();
    badForm.append("type", "lecture");
    badForm.append("title", "Invalid File Test");
    badForm.append(
      "file",
      new Blob(["hello plain text not audio"], { type: "text/plain" }),
      "notes.txt",
    );

    const uploadRes = await fetch(`${BASE_URL}/api/v1/recordings/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${guest.token}` },
      body: badForm,
    });
    assert.ok(
      uploadRes.status === 400 || uploadRes.status === 422,
      `Unsupported .txt file must be rejected with HTTP 400/422, got ${uploadRes.status}`,
    );
    const uploadErr = await uploadRes.json();
    assert.equal(typeof uploadErr.error, "string");
    assert.doesNotMatch(uploadErr.error, /at Object\.|node_modules|Error:\s*\n/i);

    // Empty file must also be rejected cleanly with HTTP 400
    const emptyForm = new FormData();
    emptyForm.append("type", "meeting");
    emptyForm.append("title", "Empty Audio");
    emptyForm.append("file", new Blob([], { type: "audio/mpeg" }), "empty.mp3");
    const emptyRes = await fetch(`${BASE_URL}/api/v1/recordings/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${guest.token}` },
      body: emptyForm,
    });
    assert.equal(emptyRes.status, 400, "Empty 0-byte audio file must be rejected with HTTP 400");

    // Verify internal Performance Telemetry Dashboard endpoint & AssemblyAI webhook endpoint
    const perfRes = await fetch(`${BASE_URL}/api/v1/system/performance`, {
      headers: { Authorization: `Bearer ${guest.token}` },
    });
    assert.equal(perfRes.status, 200, "Performance telemetry endpoint must return HTTP 200");
    const perfJson = await perfRes.json();
    assert.equal(typeof perfJson.config?.pipelineMode, "string");
    assert.equal(typeof perfJson.config?.localWhisperWorkers, "number");
    assert.equal(typeof perfJson.averages?.avgTotalMs, "number");
    assert.ok(Array.isArray(perfJson.recentJobs));

    const hookRes = await fetch(`${BASE_URL}/api/v1/webhooks/assemblyai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript_id: "tr_test_hook_123", status: "completed" }),
    });
    assert.equal(
      hookRes.status,
      200,
      "AssemblyAI webhook callback endpoint must accept completion events",
    );
    const hookJson = await hookRes.json();
    assert.equal(hookJson.received, true);
  });

  test("enforces direct-first architecture, unified single-call Gemini JSON, parallel Whisper pool & parallel chunk upload", () => {
    const aiSrc = fs.readFileSync(path.join(ROOT, "src", "server", "ai.ts"), "utf8");
    assert.match(aiSrc, /export async function generateUnifiedRecordingAnalysis/);
    assert.match(aiSrc, /maxOutputTokens:\s*4096/);
    assert.match(aiSrc, /responseMimeType:\s*"application\/json"/);

    const whisperSrc = fs.readFileSync(path.join(ROOT, "src", "server", "whisper-asr.ts"), "utf8");
    assert.match(whisperSrc, /node:worker_threads/);
    assert.match(whisperSrc, /getOrCreateWhisperWorkerPool/);
    assert.match(whisperSrc, /getWhisperPoolDiagnostics/);

    const mediaSrc = fs.readFileSync(path.join(ROOT, "src", "lib", "media-processor.ts"), "utf8");
    assert.match(mediaSrc, /maxConcurrency\s*=\s*Math\.min\(4/);
  });

  test("enforces high-accuracy Arabic ASR config, zero LLM-as-ASR fallback, raw/processed storage, UTF-8 safety, and honest Live vs Verified UI", () => {
    const aaiSrc = fs.readFileSync(path.join(ROOT, "src", "server", "assemblyai.ts"), "utf8");
    assert.match(aaiSrc, /assemblyai-stt-3-7/);
    assert.match(aaiSrc, /universal-2/);
    assert.match(aaiSrc, /speech_models:/);
    assert.match(aaiSrc, /language_code:\s*"ar"/);
    assert.match(aaiSrc, /code_switching:\s*true/);
    assert.match(aaiSrc, /charset=utf-8/i);
    assert.doesNotMatch(
      aaiSrc,
      /Speaker \$\{\(idx % 2\) \+ 1\}/,
      "Must NEVER fabricate alternating speaker labels",
    );

    const whisperSrc = fs.readFileSync(path.join(ROOT, "src", "server", "whisper-asr.ts"), "utf8");
    assert.match(whisperSrc, /FAST_LONG_AUDIO_WHISPER_MODEL\s*=\s*"Xenova\/whisper-small"/);
    assert.doesNotMatch(
      whisperSrc,
      /\(segments\.length % 2\) \+ 1/,
      "Local Whisper must NEVER fabricate alternating speakers",
    );

    const jobsSrc = fs.readFileSync(path.join(ROOT, "src", "server", "jobs.ts"), "utf8");
    assert.match(
      jobsSrc,
      /const shouldTryGeminiAsr = false;/,
      "Generic Gemini LLM must NEVER replace dedicated ASR",
    );
    assert.match(jobsSrc, /transcriptStatus:\s*"final_verified"/);
    assert.match(jobsSrc, /rawTranscript/);
    assert.match(jobsSrc, /processedTranscript/);

    const fmtSrc = fs.readFileSync(
      path.join(ROOT, "src", "server", "transcript-format.ts"),
      "utf8",
    );
    assert.match(fmtSrc, /export function formatTranscriptNonDestructive/);
    assert.match(fmtSrc, /export function normalizeSpeakerLabel/);
    assert.match(fmtSrc, /export function buildTranscriptArtifacts/);
    assert.doesNotMatch(
      fmtSrc,
      /\.replace\(\/\[أإآ/,
      "Non-destructive display formatter must NEVER alter Arabic letters أ إ آ ة ى ؤ ئ ء",
    );

    const dialogSrc = fs.readFileSync(
      path.join(ROOT, "src", "components", "common", "upload-recording-dialog.tsx"),
      "utf8",
    );
    assert.match(dialogSrc, /Live Transcript \(In Progress — Preliminary\)/);
    assert.match(dialogSrc, /Final Verified Transcript/);

    const viewSrc = fs.readFileSync(path.join(ROOT, "src", "views", "transcript-view.tsx"), "utf8");
    assert.match(viewSrc, /RAW ASR TRANSCRIPT/);
    assert.match(viewSrc, /FINAL DISPLAY TRANSCRIPT/);
    assert.match(viewSrc, /Live Transcript \(In Progress/);
    assert.match(viewSrc, /Final Verified Transcript/);
  });

  test("enforces progressive AssemblyAI slicing, parallel per-stage telemetry, SSE status API, and live processing dashboard modal", () => {
    const aaiSrc = readRel("src/server/assemblyai.ts");
    assert.match(aaiSrc, /splitAudioAtSilencesForAssemblyAi/);
    assert.match(aaiSrc, /onPartialTranscript/);

    const jobsSrc = readRel("src/server/jobs.ts");
    for (const stage of [
      "UPLOAD",
      "ASSEMBLYAI_UPLOAD",
      "TRANSCRIPTION_STARTED",
      "TRANSCRIPTION_PROCESSING",
      "TRANSCRIPTION_COMPLETED",
      "TRANSCRIPT_RECEIVED",
      "AI_ANALYSIS_STARTED",
      "SUMMARY_COMPLETED",
      "KEYWORDS_COMPLETED",
      "TASKS_COMPLETED",
      "QUIZ_COMPLETED",
      "FLASHCARDS_COMPLETED",
      "DATABASE_SAVED",
      "JOB_COMPLETED",
    ]) {
      assert.match(jobsSrc, new RegExp(stage), `jobs.ts must instrument stage ${stage}`);
    }
    assert.match(jobsSrc, /finalTranscript/);

    const routesSrc = readRel("src/server/routes.ts");
    assert.match(routesSrc, /\/api\/v1\/recordings/);
    assert.match(routesSrc, /\/status/);
    assert.match(routesSrc, /\/stream/);
    assert.match(routesSrc, /text\/event-stream/);

    const dialogSrc = readRel("src/components/common/upload-recording-dialog.tsx");
    assert.match(dialogSrc, /Auto-scroll/);
    assert.match(dialogSrc, /Continue in Background/);
    assert.match(dialogSrc, /Real Processing Telemetry/);
    assert.match(dialogSrc, /Retry transcription/);
  });
});
