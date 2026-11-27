import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";

const ROOT = process.cwd();
const BASE_URL = process.env.MEETMIND_TEST_URL || "http://127.0.0.1:5173";

function readRel(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("MeetMind AI — Static Audio Player, University Quiz Engine, Language Isolation & Repo Cleanup", () => {
  test("Part 1: Audio player removes decorative playback animation while preserving all audio controls & sync", () => {
    const transcriptView = readRel("src/views/transcript-view.tsx");

    // Decorative animations removed from transcript audio player
    assert.doesNotMatch(
      transcriptView,
      /gold-card-animated-border/,
      "Transcript audio player must not use spinning gold-card-animated-border",
    );
    assert.doesNotMatch(
      transcriptView,
      /AudioOrb3D|show3DVisualizer/,
      "Transcript audio player must not render 3D visualizer animation behind controls",
    );

    // Essential audio player controls & synchronization preserved
    assert.match(transcriptView, /togglePlay/, "Play/Pause handler must be preserved");
    assert.match(transcriptView, /handleSeek/, "Seek handler must be preserved");
    assert.match(
      transcriptView,
      /formatTime\(currentTime\)/,
      "Current time display must be preserved",
    );
    assert.match(
      transcriptView,
      /formatTime\(effectiveDuration\)/,
      "Duration display must be preserved",
    );
    assert.match(transcriptView, /handleVolumeChange/, "Volume control must be preserved");
    assert.match(transcriptView, /handleSpeedChange/, "Playback speed control must be preserved");
    assert.match(transcriptView, /download=/, "Download Audio action must be preserved");
    assert.match(
      transcriptView,
      /lastScrolledSegIdRef/,
      "Transcript audio synchronization must be preserved",
    );
  });

  test("Part 16: Quiz UI enforces Question X / N, Difficulty badges, Options/Correct Answer/Explanation, and strict RTL/LTR", () => {
    const quizView = readRel("src/views/quiz-view.tsx");
    assert.match(quizView, /السؤال \$\{qIndex \+ 1\} \/ \$\{totalCount\}/);
    assert.match(quizView, /Question \$\{qIndex \+ 1\} \/ \$\{totalCount\}/);
    assert.match(quizView, /Difficulty: Hard/);
    assert.match(quizView, /المستوى: صعب/);
    assert.match(quizView, /الإجابة الصحيحة:/);
    assert.match(quizView, /Correct Answer:/);
    assert.match(quizView, /الشرح:/);
    assert.match(quizView, /Explanation:/);
    assert.match(quizView, /dir=\{isQuestionArabic \? "rtl" : "ltr"\}/);
  });

  test("Parts 2–17: English lecture generates 100% academic English quiz & summary even when UI header is Arabic (zero translation drift)", async () => {
    const guestRes = await fetch(`${BASE_URL}/api/v1/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(guestRes.status, 200);
    const { token } = await guestRes.json();

    const englishSegments = [
      {
        id: "seg_en_1",
        speaker: "Prof. Miller",
        startTime: 0,
        endTime: 25,
        text: "Distributed database replication means maintaining consistent copies of data across multiple independent storage nodes to guarantee fault tolerance.",
      },
      {
        id: "seg_en_2",
        speaker: "Prof. Miller",
        startTime: 25,
        endTime: 55,
        text: "Synchronous replication waits for acknowledgement from at least 3 replica nodes before committing a write transaction because strong consistency prevents lost updates.",
      },
      {
        id: "seg_en_3",
        speaker: "Prof. Miller",
        startTime: 55,
        endTime: 85,
        text: "Asynchronous replication commits locally in 5 milliseconds whereas synchronous replication incurs higher network round-trip latency across regions.",
      },
      {
        id: "seg_en_4",
        speaker: "Prof. Miller",
        startTime: 85,
        endTime: 115,
        text: "If a primary leader node crashes during network partitioning, then the Raft consensus protocol elects a new leader within 150 milliseconds.",
      },
      {
        id: "seg_en_5",
        speaker: "Prof. Miller",
        startTime: 115,
        endTime: 145,
        text: "Write-ahead logging is defined as appending every state mutation to durable sequential storage prior to modifying in-memory B-tree pages.",
      },
      {
        id: "seg_en_6",
        speaker: "Prof. Miller",
        startTime: 145,
        endTime: 180,
        text: "When read traffic exceeds 10000 queries per second, horizontal read replicas distribute analytical workloads without blocking primary write transactions.",
      },
      {
        id: "seg_en_7",
        speaker: "Prof. Miller",
        startTime: 180,
        endTime: 215,
        text: "Snapshot isolation prevents dirty reads and non-repeatable reads because each transaction observes a consistent multiversioned commit timestamp.",
      },
      {
        id: "seg_en_8",
        speaker: "Prof. Miller",
        startTime: 215,
        endTime: 250,
        text: "Unlike two-phase locking which blocks readers behind writers, multiversion concurrency control allows concurrent read operations without lock contention.",
      },
    ];

    const createRes = await fetch(`${BASE_URL}/api/v1/lectures`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: "Distributed Systems & Consensus Architecture",
        courseCode: "CS451",
        instructorName: "Prof. Miller",
        durationMinutes: 25,
        segments: englishSegments,
      }),
    });
    assert.equal(createRes.status, 201);
    const lecture = await createRes.json();

    try {
      // Deliberately send X-App-Language: ar — English lecture MUST remain in English!
      const quizRes = await fetch(`${BASE_URL}/api/v1/ai/generate-quiz`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-App-Language": "ar",
        },
        body: JSON.stringify({
          resourceId: lecture.id,
          type: "lecture",
          numQuestions: 10,
        }),
      });
      assert.equal(quizRes.status, 200);
      const quizBody = await quizRes.json();
      assert.equal(quizBody.success, true);
      const quiz = quizBody.quiz;

      assert.equal(quiz.language, "en", "English lecture quiz language must be 'en'");
      assert.equal(quiz.transcriptLanguage, "en", "transcriptLanguage must be 'en'");
      assert.ok(
        quiz.questions.length >= 4 && quiz.questions.length <= 10,
        `Expected 4..10 grounded questions, got ${quiz.questions.length}`,
      );

      const normQuestions = new Set();
      const referencedSegments = new Set();

      for (const q of quiz.questions) {
        assert.ok(
          q.type === "multiple_choice" || q.type === "true_false",
          `Disallowed question type: ${q.type}`,
        );
        assert.doesNotMatch(
          q.question,
          /[\u0600-\u06FF]/,
          `English lecture question must contain zero Arabic characters: ${q.question}`,
        );
        assert.doesNotMatch(
          q.explanation,
          /[\u0600-\u06FF]/,
          `English lecture explanation must contain zero Arabic characters: ${q.explanation}`,
        );

        const normQ = q.question.toLowerCase().trim();
        assert.equal(normQuestions.has(normQ), false, `Duplicate question detected: ${q.question}`);
        normQuestions.add(normQ);

        if (q.type === "multiple_choice") {
          assert.equal(q.options.length, 4, "MCQ must have exactly 4 options");
          assert.equal(new Set(q.options).size, 4, "MCQ options must be 4 distinct choices");
          assert.ok(q.correctOptionIndex >= 0 && q.correctOptionIndex < 4);
        } else {
          assert.deepEqual(q.options, ["True", "False"]);
          assert.equal(typeof q.correctAnswer, "boolean");
        }

        assert.ok(
          Array.isArray(q.sourceSegmentIds) && q.sourceSegmentIds.length > 0,
          "Each question must include grounded sourceSegmentIds",
        );
        for (const sid of q.sourceSegmentIds) referencedSegments.add(sid);
      }

      // Whole-lecture coverage check: must cover both first half (1..4) and second half (5..8)
      const coversFirstHalf = [...referencedSegments].some((id) =>
        ["seg_en_1", "seg_en_2", "seg_en_3", "seg_en_4"].includes(id),
      );
      const coversSecondHalf = [...referencedSegments].some((id) =>
        ["seg_en_5", "seg_en_6", "seg_en_7", "seg_en_8"].includes(id),
      );
      assert.equal(coversFirstHalf, true, "Quiz must cover early sections of the lecture");
      assert.equal(coversSecondHalf, true, "Quiz must cover later sections of the lecture");

      // Summary language check: English lecture must produce English summary even when UI is Arabic
      const sumRes = await fetch(`${BASE_URL}/api/v1/ai/generate-summary`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-App-Language": "ar",
        },
        body: JSON.stringify({ resourceId: lecture.id, type: "lecture" }),
      });
      assert.equal(sumRes.status, 200);
      const sumBody = await sumRes.json();
      assert.doesNotMatch(
        sumBody.executiveSummary || "",
        /[\u0600-\u06FF]/,
        "English lecture executiveSummary must remain in English",
      );
    } finally {
      await fetch(`${BASE_URL}/api/v1/lectures/${lecture.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  });

  test("Parts 8–15: Arabic lecture generates academic MSA Arabic quiz across all sections even when UI header is English + respects short-transcript cap", async () => {
    const guestRes = await fetch(`${BASE_URL}/api/v1/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(guestRes.status, 200);
    const { token } = await guestRes.json();

    const arabicSegments = [
      {
        id: "seg_ar_1",
        speaker: "د. أحمد",
        startTime: 0,
        endTime: 30,
        text: "تعريف الشبكات العصبية الالتفافية هو معمارية تعلم عميق متخصصة في استخلاص السمات المكانية الهرمية من الصور الرقمية بكفاءة عالية.",
      },
      {
        id: "seg_ar_2",
        speaker: "د. أحمد",
        startTime: 30,
        endTime: 65,
        text: "تستخدم طبقة التجميع الأقصى تقليص أبعاد خرائط السمات إلى النصف لأن ذلك يقلل عدد المعاملات الحسابية ويمنع فرط التخصيص.",
      },
      {
        id: "seg_ar_3",
        speaker: "د. أحمد",
        startTime: 65,
        endTime: 100,
        text: "تعتمد دالة التنشيط ReLU على تصفير القيم السالبة بسرعة عالية بينما تعاني دالة Sigmoid من تلاشي التدرجات في الشبكات العميقة.",
      },
      {
        id: "seg_ar_4",
        speaker: "د. أحمد",
        startTime: 100,
        endTime: 135,
        text: "إذا زاد معدل التعلم عن 0.1 أثناء التدريب، فإن دالة الخسارة تتذبذب بشدة وتفشل الخوارزمية في التقارب نحو الحل الأمثل.",
      },
      {
        id: "seg_ar_5",
        speaker: "د. أحمد",
        startTime: 135,
        endTime: 175,
        text: "تُعرَّف تقنية التنظيم Dropout بأنها تعطيل عشوائي لنسبة 20 بالمائة من الخلايا العصبية في كل دورة تدريبية لتعزيز التعميم.",
      },
      {
        id: "seg_ar_6",
        speaker: "د. أحمد",
        startTime: 175,
        endTime: 215,
        text: "يُجري تطبيع الدفعات Batch Normalization موازنة لتوزيع المدخلات داخل كل طبقة بسبب تسريع استقرار التدريب عبر 50 حقبة متتالية.",
      },
    ];

    const createRes = await fetch(`${BASE_URL}/api/v1/lectures`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: "معماريات التعلم العميق والشبكات الالتفافية",
        courseCode: "AI402",
        instructorName: "د. أحمد",
        durationMinutes: 20,
        segments: arabicSegments,
      }),
    });
    assert.equal(createRes.status, 201);
    const arLecture = await createRes.json();

    // Also create a very short 1-segment lecture to verify we NEVER force 20 fabricated questions
    const shortRes = await fetch(`${BASE_URL}/api/v1/lectures`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: "ملاحظة موجزة",
        courseCode: "AI101",
        instructorName: "د. أحمد",
        durationMinutes: 1,
        segments: [
          {
            id: "seg_short_1",
            speaker: "د. أحمد",
            startTime: 0,
            endTime: 12,
            text: "موعد تسليم المشروع النهائي هو يوم الخميس القادم الساعة 10 صباحاً.",
          },
        ],
      }),
    });
    assert.equal(shortRes.status, 201);
    const shortLecture = await shortRes.json();

    try {
      // Deliberately send X-App-Language: en — Arabic lecture MUST remain in Modern Standard Arabic!
      const quizRes = await fetch(`${BASE_URL}/api/v1/ai/generate-quiz`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-App-Language": "en",
        },
        body: JSON.stringify({
          resourceId: arLecture.id,
          type: "lecture",
          numQuestions: 10,
        }),
      });
      assert.equal(quizRes.status, 200);
      const { quiz } = await quizRes.json();

      assert.equal(quiz.language, "ar", "Arabic lecture quiz language must be 'ar'");
      assert.equal(quiz.transcriptLanguage, "ar", "transcriptLanguage must be 'ar'");
      assert.ok(quiz.questions.length >= 4 && quiz.questions.length <= 10);

      const answersPayload = {};
      for (const q of quiz.questions) {
        assert.match(q.question, /[\u0600-\u06FF]/, "Arabic quiz question must be in Arabic");
        assert.match(q.explanation, /[\u0600-\u06FF]/, "Arabic quiz explanation must be in Arabic");
        if (q.type === "true_false") {
          assert.deepEqual(q.options, ["صح", "خطأ"]);
          answersPayload[q.id] = q.correctAnswer; // test boolean submission support
        } else {
          assert.equal(q.options.length, 4);
          answersPayload[q.id] = q.correctOptionIndex;
        }
      }

      // Verify attempt grading achieves 100% when submitting exact correct answers
      const attemptRes = await fetch(`${BASE_URL}/api/v1/quizzes/${quiz.id}/attempt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ answers: answersPayload }),
      });
      assert.equal(attemptRes.status, 200);
      const attempt = await attemptRes.json();
      assert.equal(attempt.scorePercent, 100);

      // Verify short transcript requested with numQuestions: 20 does NOT fabricate 20 questions
      const shortQuizRes = await fetch(`${BASE_URL}/api/v1/ai/generate-quiz`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          resourceId: shortLecture.id,
          type: "lecture",
          numQuestions: 20,
        }),
      });
      assert.equal(shortQuizRes.status, 200);
      const shortQuizBody = await shortQuizRes.json();
      assert.ok(
        shortQuizBody.quiz.questions.length <= 5,
        `Short 1-sentence transcript must not force 20 questions (got ${shortQuizBody.quiz.questions.length})`,
      );
    } finally {
      await fetch(`${BASE_URL}/api/v1/lectures/${arLecture.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetch(`${BASE_URL}/api/v1/lectures/${shortLecture.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  });

  test("Parts 18–21: Repository cleanup & .gitignore exclude secrets, caches, bytecode, and temp chunks", () => {
    const gitignore = readRel(".gitignore");
    assert.match(gitignore, /^\.env$/m, ".gitignore must exclude .env");
    assert.match(gitignore, /^data\/\.jwt_secret$/m, ".gitignore must exclude data/.jwt_secret");
    assert.match(
      gitignore,
      /^data\/ai_analysis_cache\.json$/m,
      ".gitignore must exclude data/ai_analysis_cache.json",
    );
    assert.match(gitignore, /^__pycache__\/$/m, ".gitignore must exclude __pycache__/");

    // Verify unused/unsafe files are removed from the workspace
    assert.equal(
      fs.existsSync(path.join(ROOT, "firebase-applet-config.json")),
      false,
      "firebase-applet-config.json (containing hardcoded API key) must be removed",
    );
    assert.equal(
      fs.existsSync(path.join(ROOT, "scripts/generate_ambient_video.py")),
      false,
      "Unused scripts/generate_ambient_video.py must be removed",
    );
    assert.equal(
      fs.existsSync(path.join(ROOT, "favicon.ico")),
      false,
      "Duplicate root favicon.ico must be removed (public/favicon.ico is canonical)",
    );
    assert.equal(
      fs.existsSync(path.join(ROOT, "services/ai_service/__pycache__")),
      false,
      "Python __pycache__ directory must be removed",
    );

    const chunkFiles = fs
      .readdirSync(path.join(ROOT, "data/chunks"))
      .filter((f) => f !== ".gitkeep");
    assert.equal(
      chunkFiles.length,
      0,
      `data/chunks must contain no leftover temp audio files, found: ${chunkFiles.join(", ")}`,
    );

    const trackedFiles = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    assert.equal(
      trackedFiles.includes("firebase-applet-config.json"),
      false,
      "firebase-applet-config.json must not be tracked in Git",
    );
    assert.equal(
      trackedFiles.includes("data/.jwt_secret"),
      false,
      "data/.jwt_secret must not be tracked in Git",
    );
    assert.equal(
      trackedFiles.includes("data/ai_analysis_cache.json"),
      false,
      "data/ai_analysis_cache.json must not be tracked in Git",
    );
    assert.equal(
      trackedFiles.some((f) => /^\.env($|\.)/.test(f) && f !== ".env.example"),
      false,
      "Real .env files must never be tracked in Git",
    );
  });
});
