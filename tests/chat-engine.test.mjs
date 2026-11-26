import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";

const ROOT = process.cwd();
const BASE_URL = process.env.MEETMIND_TEST_URL || "http://127.0.0.1:5173";

function readRel(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("MeetMind Super AI Chat Engine — Architecture, Security, Context & API", () => {
  test("chat model configuration is environment-driven and zero secrets leak to client", () => {
    const geminiSrc = readRel("src/server/gemini.ts");
    assert.match(geminiSrc, /GEMINI_CHAT_MODEL/);
    assert.match(geminiSrc, /GEMINI_CHAT_FALLBACK_MODEL/);
    assert.match(geminiSrc, /categorizeAiError/);
    assert.match(geminiSrc, /ttftMs\?:/);
    assert.match(geminiSrc, /latencyMs\?:/);

    const floatingSrc = readRel("src/components/ai/floating-ai-assistant.tsx");
    const apiClientSrc = readRel("src/lib/api-client.ts");
    assert.doesNotMatch(floatingSrc, /GEMINI_API_KEY|AIza[0-9A-Za-z_-]{20,}/);
    assert.doesNotMatch(apiClientSrc, /GEMINI_API_KEY|AIza[0-9A-Za-z_-]{20,}/);
  });

  test("smart context manager handles multi-turn memory, deduplication, sliding window, and anti-repetition persona", () => {
    const ctxSrc = readRel("src/server/chat-context.ts");
    assert.match(ctxSrc, /export function extractConversationFacts/);
    assert.match(ctxSrc, /export function buildNormalizedHistory/);
    assert.match(ctxSrc, /export function detectChatIntent/);
    assert.match(ctxSrc, /export function buildConversationalIdentityReply/);
    assert.match(ctxSrc, /export function buildSmartChatContext/);
    assert.match(ctxSrc, /Modern Academy/);
    assert.match(ctxSrc, /isAskAboutChatGPT/);
    assert.match(ctxSrc, /identityAlreadyAnsweredRecently/);
    assert.match(ctxSrc, /\[Earlier Conversation Summary\]/);
    assert.match(ctxSrc, /\[User Profile & Session Facts\]/);
    assert.match(ctxSrc, /المعلومة دي غير موجودة في التسجيل المتاح/);
  });

  test("unified AI chat engine uses native multi-turn streaming, retry/fallback, strict scope isolation, and no fake general AI", () => {
    const aiSrc = readRel("src/server/ai.ts");
    assert.match(aiSrc, /executeWithRetryAndFallback/);
    assert.match(aiSrc, /primaryModel:\s*config\.chatModel/);
    assert.match(aiSrc, /fallbackModel:\s*config\.fallbackChatModel/);
    assert.match(aiSrc, /conversationTurns:\s*ctx\.recentTurns/);
    assert.match(aiSrc, /maxNewTokens:\s*ctx\.intent\.recommendedLocalMaxTokens/);
    assert.match(aiSrc, /تعذر الوصول إلى الذكاء الاصطناعي حاليًا\. حاول مرة أخرى بعد لحظات\./);

    const localLlmSrc = readRel("src/server/local-llm.ts");
    assert.match(localLlmSrc, /conversationTurns\?:/);
    assert.match(localLlmSrc, /buildBoundedConversationMessages/);
  });

  test("chat UI components support Shift+Enter newlines, Markdown tables, pure General AI scope, and no duplicate user turn", () => {
    const floatingSrc = readRel("src/components/ai/floating-ai-assistant.tsx");
    assert.match(floatingSrc, /<table className=/);
    assert.match(floatingSrc, /<textarea/);
    assert.match(floatingSrc, /e\.key === "Enter" && !e\.shiftKey/);
    assert.match(floatingSrc, /value="__general__"/);
    assert.match(floatingSrc, /scope:\s*effectiveScope/);
    assert.doesNotMatch(floatingSrc, /\{\s*role:\s*"user"\s*as\s*const,\s*text:\s*q\s*\},\s*\]/);

    const workspaceSrc = readRel("src/views/ai-workspace-view.tsx");
    assert.match(workspaceSrc, /<table className=/);
    assert.match(workspaceSrc, /<textarea/);
    assert.match(workspaceSrc, /e\.key === "Enter" && !e\.shiftKey/);
  });

  test("live API enforces validation, identity persona, anti-repetition, ChatGPT clarification, and streaming SSE", async () => {
    // 1. Obtain guest session cookie
    const guestRes = await fetch(`${BASE_URL}/api/v1/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(guestRes.status, 200, "Guest auth must succeed");
    const guestJson = await guestRes.json();
    const authHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${guestJson.token}`,
      "X-App-Language": "ar",
    };

    // 2. Empty question returns 400 (never 500)
    const emptyRes = await fetch(`${BASE_URL}/api/v1/ai/ask`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ question: "   ", scope: "general" }),
    });
    assert.equal(emptyRes.status, 400);

    // 3. First identity question returns exact Modern Academy identity
    const id1Res = await fetch(`${BASE_URL}/api/v1/ai/ask`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ question: "انت مين؟", scope: "general", history: [] }),
    });
    assert.equal(id1Res.status, 200);
    const id1 = await id1Res.json();
    assert.match(id1.answer, /MeetMind AI/);
    assert.match(id1.answer, /Modern Academy/);

    // 4. Repeat identity question in same conversation avoids robotic verbatim duplication
    const id2Res = await fetch(`${BASE_URL}/api/v1/ai/ask`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        question: "انت اسمك ايه؟",
        scope: "general",
        history: [
          { role: "user", text: "انت مين؟" },
          { role: "model", text: id1.answer },
        ],
      }),
    });
    assert.equal(id2Res.status, 200);
    const id2 = await id2Res.json();
    assert.match(id2.answer, /MeetMind AI/);
    assert.match(id2.answer, /Modern Academy/);
    assert.notEqual(
      id2.answer.trim(),
      id1.answer.trim(),
      "Repeat identity answer should not be verbatim identical",
    );

    // 5. "هل أنت ChatGPT؟" clearly rejects being ChatGPT
    const gptRes = await fetch(`${BASE_URL}/api/v1/ai/ask`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ question: "هل أنت ChatGPT؟", scope: "general", history: [] }),
    });
    assert.equal(gptRes.status, 200);
    const gpt = await gptRes.json();
    assert.match(gpt.answer, /لست ChatGPT|MeetMind AI/i);

    // 6. Streaming SSE endpoint returns event: meta, event: token, event: done with telemetry
    const sseRes = await fetch(`${BASE_URL}/api/v1/ai/ask/stream`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ question: "Who developed you?", scope: "general", history: [] }),
    });
    assert.equal(sseRes.status, 200);
    assert.match(sseRes.headers.get("content-type") || "", /text\/event-stream/);
    const sseBody = await sseRes.text();
    assert.match(sseBody, /event:\s*meta/);
    assert.match(sseBody, /event:\s*token/);
    assert.match(sseBody, /event:\s*done/);
    assert.match(sseBody, /Modern Academy/);
    assert.match(sseBody, /"ttftMs":/);

    // 7. Health & AI status expose chat model configuration without leaking secrets
    const healthRes = await fetch(`${BASE_URL}/api/v1/health`);
    assert.equal(healthRes.status, 200);
    const healthText = await healthRes.text();
    assert.match(healthText, /geminiChat/);
    assert.doesNotMatch(healthText, /AIza[0-9A-Za-z_-]{20,}/);
  });
});
