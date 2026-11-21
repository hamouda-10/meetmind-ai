import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDataDir, getDbFilePath, getRecordingsDir } from "./storage";

const DATA_DIR = getDataDir();
const DB_FILE = getDbFilePath();
const RECORDINGS_DIR = getRecordingsDir();

function getModuleDir(): string {
  try {
    if (typeof import.meta !== "undefined" && import.meta.url) {
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch {
    // fallback to process.cwd()
  }
  return process.cwd();
}

// Ensure data directories exist
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch {
  // best effort in serverless environments
}

try {
  if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  }
} catch {
  // best effort in serverless environments
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: "admin" | "member" | "student" | "instructor" | "guest";
  authProvider?: "local" | "guest";
  emailVerified?: boolean;
  isGuest?: boolean;
  avatarUrl?: string;
  avatarFileName?: string;
  bio?: string;
  jobTitle?: string;
  department?: string;
  organization?: string;
  nameCustomized?: boolean;
  avatarCustomized?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface AuthSessionRecord {
  id: string;
  userId: string;
  refreshTokenHash: string;
  isGuest: boolean;
  rememberMe: boolean;
  userAgent?: string;
  ipAddress?: string;
  expiresAt: string;
  revokedAt?: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface PasswordResetTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt?: string;
  createdAt: string;
}

export interface RevokedTokenRecord {
  jti: string;
  exp: number;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  plan: "enterprise" | "pro" | "team";
  createdAt: string;
}

export interface TranscriptSegment {
  id: string;
  speaker: string;
  startTime: number; // in seconds
  endTime: number;
  text: string;
  confidence?: number;
  language?: string;
  isPartial?: boolean;
  chunkIndex?: number;
  sequenceNumber?: number;
  chunkId?: string;
}

export interface KeywordItem {
  term: string;
  frequency: number;
  importance: number;
  segmentIds?: string[];
  context?: string;
  timestamp?: string;
}

export interface HighlightItem {
  quote: string;
  context?: string;
  speaker?: string;
  timestamp?: string;
  category: string;
  priority: string;
}

export interface ActionItemRecord {
  id: string;
  userId?: string;
  meetingId?: string;
  lectureId?: string;
  title: string;
  ownerName?: string;
  dueDate?: string;
  deadlineText?: string;
  sourceTimestamp?: string;
  priority: "high" | "medium" | "low";
  completed: boolean;
  createdAt: string;
}

export interface MeetingRecord {
  id: string;
  workspaceId: string;
  title: string;
  hostName: string;
  hostId: string;
  date: string;
  durationSeconds: number;
  participantsCount: number;
  status: "Completed" | "Processing" | "Queued" | "Failed";
  transcriptionStatus?: "Completed" | "Processing" | "Failed";
  analysisStatus?: "Completed" | "Processing" | "Unavailable" | "Failed";
  analysisError?: string;
  analysisRetryable?: boolean;
  analyzedAt?: string;
  language?: string;
  appLanguage?: "en" | "ar";
  recordingPath?: string;
  recordingFileName?: string;
  fileSha256?: string;
  fileSize?: number;
  mimeType?: string;
  audioUrl?: string;
  summary?: string;
  executiveSummary?: string;
  detailedSummary?: string;
  keyPoints?: string[];
  decisions?: string[];
  topics?: string[];
  keywords?: KeywordItem[];
  highlights?: HighlightItem[];
  analysis?: {
    topics: string[];
    keywords: string[];
    definitions: Array<{ term: string; definition: string; timestamp?: string }>;
    questionsAsked: Array<{ question: string; answer?: string; timestamp?: string }>;
    actionItems: Array<{ task: string; owner?: string; deadline?: string }>;
    emphasizedPoints: string[];
    reviewAreas: string[];
  };
  fullText?: string;
  segments: TranscriptSegment[];
  createdAt: string;
  updatedAt: string;
}

export interface LectureRecord {
  id: string;
  workspaceId: string;
  title: string;
  courseCode: string;
  instructorName: string;
  instructorId: string;
  date: string;
  durationSeconds: number;
  status: "Completed" | "Processing" | "Queued" | "Failed";
  transcriptionStatus?: "Completed" | "Processing" | "Failed";
  analysisStatus?: "Completed" | "Processing" | "Unavailable" | "Failed";
  analysisError?: string;
  analysisRetryable?: boolean;
  analyzedAt?: string;
  language?: string;
  appLanguage?: "en" | "ar";
  recordingPath?: string;
  recordingFileName?: string;
  fileSha256?: string;
  fileSize?: number;
  mimeType?: string;
  audioUrl?: string;
  studyNotes?: string;
  summary?: string;
  executiveSummary?: string;
  detailedSummary?: string;
  keyConcepts?: { term: string; definition: string }[];
  examHighlights?: string[];
  topics?: string[];
  keywords?: KeywordItem[];
  highlights?: HighlightItem[];
  analysis?: {
    topics: string[];
    keywords: string[];
    definitions: Array<{ term: string; definition: string; timestamp?: string }>;
    questionsAsked: Array<{ question: string; answer?: string; timestamp?: string }>;
    actionItems: Array<{ task: string; owner?: string; deadline?: string }>;
    emphasizedPoints: string[];
    reviewAreas: string[];
  };
  fullText?: string;
  segments: TranscriptSegment[];
  createdAt: string;
  updatedAt: string;
}

export interface RecordingSessionRecord {
  id: string;
  userId?: string;
  type: "meeting" | "lecture";
  title: string;
  courseCode?: string;
  speakerName?: string;
  language?: string;
  status:
    "Recording" | "Paused" | "Interrupted" | "Recovering" | "Processing" | "Completed" | "Failed";
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  segmentsCount: number;
  lastSequenceNumber?: number;
  receivedChunkIds?: string[];
  durationSeconds?: number;
  errorMessage?: string;
}

export interface QuizQuestionRecord {
  id: string;
  question: string;
  type?: "multiple_choice" | "true_false" | "short_answer" | "fill_in_the_blank";
  options: string[];
  correctOptionIndex: number;
  correctAnswerText?: string;
  acceptableAnswers?: string[];
  explanation: string;
  difficulty?: "easy" | "medium" | "hard";
  sectionRef?: string;
  timestampRef?: string;
  sourceReference?: string;
  sourceTranscriptSegment?: string;
  groundingVerified?: boolean;
}

export interface QuizAttemptRecord {
  id: string;
  quizId: string;
  lectureId?: string;
  userId: string;
  scorePercent: number;
  correctCount: number;
  totalQuestions: number;
  answers: Record<string, string | number>;
  submittedAt: string;
}

export interface QuizRecord {
  id: string;
  lectureId?: string;
  meetingId?: string;
  title: string;
  courseCode?: string;
  questions: QuizQuestionRecord[];
  attemptsCount: number;
  lastScore?: number;
  createdAt: string;
}

export interface FlashcardRecord {
  id: string;
  deckId: string;
  deckTitle: string;
  lectureId?: string;
  meetingId?: string;
  front: string;
  back: string;
  sourceReference?: string;
  topic?: string;
  difficulty?: "easy" | "medium" | "hard";
  mastered: boolean;
  reviewCount: number;
  createdAt: string;
}

export interface ChatMessageRecord {
  id: string;
  userId: string;
  resourceId?: string;
  role: "user" | "assistant";
  content: string;
  evidenceFound?: boolean;
  citations?: { speaker: string; timestamp: string; quote: string }[];
  createdAt: string;
}

export interface MindMapNode {
  id: string;
  label: string;
  description?: string;
  children?: MindMapNode[];
}

export interface MindMapRecord {
  id: string;
  title: string;
  lectureId?: string;
  meetingId?: string;
  rootNode: MindMapNode;
  createdAt: string;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  title: string;
  body: string;
  targetUrl: string;
  read: boolean;
  type: "summary" | "task" | "mention" | "quiz" | "alert";
  createdAt: string;
}

export interface CalendarEventRecord {
  id: string;
  title: string;
  date: string; // ISO format or YYYY-MM-DD
  time: string;
  kind: "meeting" | "lecture" | "task" | "deadline";
  referenceId?: string;
  attendeesCount?: number;
}

export type JobStatus =
  | "Uploaded"
  | "Validating"
  | "ExtractingAudio"
  | "Queued"
  | "Transcribing"
  | "Translating"
  | "Merging"
  | "Analyzing"
  | "Generating Quiz"
  | "Completed"
  | "Failed"
  | "Cancelled";

export interface JobRecord {
  id: string;
  userId?: string;
  correlationId?: string;
  idempotencyKey?: string;
  type: "transcription" | "analysis" | "quiz_generation";
  status: JobStatus;
  stage?: string;
  progressPercent: number;
  resourceType: "meeting" | "lecture";
  resourceId: string;
  fileName: string;
  filePath?: string;
  originalFilename?: string;
  fileSha256?: string;
  language?: string;
  appLanguage?: "en" | "ar";
  retryCount?: number;
  maxRetries?: number;
  failureCategory?: string;
  failureTimestamp?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditRecord {
  id: string;
  userId: string;
  action: string;
  resource: string;
  timestamp: string;
}

export interface DatabaseSchema {
  users: UserRecord[];
  authSessions: AuthSessionRecord[];
  passwordResetTokens: PasswordResetTokenRecord[];
  revokedTokens: RevokedTokenRecord[];
  workspaces: WorkspaceRecord[];
  meetings: MeetingRecord[];
  lectures: LectureRecord[];
  actionItems: ActionItemRecord[];
  quizzes: QuizRecord[];
  quizAttempts: QuizAttemptRecord[];
  flashcards: FlashcardRecord[];
  mindMaps: MindMapRecord[];
  chatMessages: ChatMessageRecord[];
  notifications: NotificationRecord[];
  calendarEvents: CalendarEventRecord[];
  jobs: JobRecord[];
  auditLogs: AuditRecord[];
  recordingSessions: RecordingSessionRecord[];
  deletedResourceIds: string[];
}

function getInitialData(): DatabaseSchema {
  const now = new Date().toISOString();
  return {
    users: [
      {
        id: "usr_admin",
        email: "alex.kim@acme.edu",
        name: "Alex Kim",
        passwordHash:
          "scrypt$35b75f75bde6e6f373d4ab7130f99501$bb9d3f5c35cbcf8088b31a7bb69e3ee5a36d14e8de12a9f1772f7fa7ea32e0cc989aa04ad20df44a2dd09d639f231ab9170bc2d7dfb71b8744c5613add401276",
        role: "admin",
        authProvider: "local",
        emailVerified: true,
        isGuest: false,
        department: "Computer Science & Engineering",
        createdAt: "2026-10-29T22:54:01.857Z",
      },
      {
        id: "usr_demo",
        email: "demo@meetmind.ai",
        name: "Demo Member",
        passwordHash:
          "scrypt$2d6745e189b7ad4cd9e751afdb955b28$50872c2f3c6579459ee2fb37f06507a10f5e611de5123848b460d1b441b62e14fff6d0b4d4e0b424ed4364b67d55c8fba0f75e6655b9f48c154a717c0e1abf74",
        role: "member",
        authProvider: "local",
        emailVerified: true,
        isGuest: false,
        department: "Engineering",
        createdAt: "2026-11-20T00:00:00.000Z",
      },
      {
        id: "usr_mwof27f2_63af8ce1b051",
        email: "hamoudaabdo689@gmail.com",
        name: "ABDELRAHMAN HAMOUDA",
        passwordHash:
          "scrypt$17f31f77b6d36588068e20e636d362fe$2e81e530e8970e0fb0c2b6107634f77ee317f7ad098976ec7dac2eeaa96466689767098a921c3753ef609ce45dd34df5b0fbbd9838126040e50d5e475acae851",
        role: "member",
        authProvider: "local",
        emailVerified: true,
        isGuest: false,
        department: "Computer Science",
        createdAt: "2026-11-20T03:25:30.254Z",
      },
    ],
    authSessions: [],
    passwordResetTokens: [],
    revokedTokens: [],
    workspaces: [
      {
        id: "ws_default",
        name: "MeetMind AI Workspace",
        slug: "meetmind-workspace",
        ownerId: "system",
        plan: "enterprise",
        createdAt: now,
      },
    ],
    meetings: [],
    lectures: [],
    actionItems: [],
    quizzes: [],
    quizAttempts: [],
    flashcards: [],
    mindMaps: [],
    chatMessages: [],
    notifications: [],
    calendarEvents: [],
    jobs: [],
    recordingSessions: [],
    deletedResourceIds: [],
    auditLogs: [
      {
        id: `aud_${Date.now()}`,
        userId: "usr_admin",
        action: "SYSTEM_INITIALIZED",
        resource: "System",
        timestamp: now,
      },
    ],
  };
}

class DatabaseManager {
  private data: DatabaseSchema;

  constructor() {
    this.data = this.load();
  }

  private ensureSchemaArrays(parsed: Partial<DatabaseSchema>): DatabaseSchema {
    if (!Array.isArray(parsed.users)) parsed.users = [];
    if (!Array.isArray(parsed.authSessions)) parsed.authSessions = [];
    if (!Array.isArray(parsed.passwordResetTokens)) parsed.passwordResetTokens = [];
    if (!Array.isArray(parsed.revokedTokens)) parsed.revokedTokens = [];
    if (!Array.isArray(parsed.workspaces)) parsed.workspaces = [];
    if (!Array.isArray(parsed.meetings)) parsed.meetings = [];
    if (!Array.isArray(parsed.lectures)) parsed.lectures = [];
    if (!Array.isArray(parsed.actionItems)) parsed.actionItems = [];
    if (!Array.isArray(parsed.quizzes)) parsed.quizzes = [];
    if (!Array.isArray(parsed.quizAttempts)) parsed.quizAttempts = [];
    if (!Array.isArray(parsed.flashcards)) parsed.flashcards = [];
    if (!Array.isArray(parsed.mindMaps)) parsed.mindMaps = [];
    if (!Array.isArray(parsed.chatMessages)) parsed.chatMessages = [];
    if (!Array.isArray(parsed.notifications)) parsed.notifications = [];
    if (!Array.isArray(parsed.calendarEvents)) parsed.calendarEvents = [];
    if (!Array.isArray(parsed.jobs)) parsed.jobs = [];
    if (!Array.isArray(parsed.recordingSessions)) parsed.recordingSessions = [];
    if (!Array.isArray(parsed.deletedResourceIds)) parsed.deletedResourceIds = [];
    if (!Array.isArray(parsed.auditLogs)) parsed.auditLogs = [];

    // Ensure default seeded admin always exists
    const adminExists = parsed.users.some(
      (u) => u.email.toLowerCase() === "alex.kim@acme.edu" || u.id === "usr_admin",
    );
    if (!adminExists) {
      const initial = getInitialData();
      parsed.users.unshift(initial.users[0]);
    }

    return parsed as DatabaseSchema;
  }

  private load(): DatabaseSchema {
    // 1. Try DB_FILE (active writable storage path)
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, "utf-8");
        const parsed: Partial<DatabaseSchema> = JSON.parse(raw);
        if (Array.isArray(parsed.users) && parsed.users.length > 0) {
          return this.ensureSchemaArrays(parsed);
        }
      }
    } catch (err) {
      console.error("Failed to read primary database file, searching candidate sources:", err);
    }

    // 2. Try candidate bundled seed files (essential for Vercel Serverless / Lambda cold starts)
    const moduleDir = getModuleDir();
    const candidates = [
      path.resolve(process.cwd(), "data", "meetmind_db.json"),
      path.resolve(process.cwd(), "meetmind_db.json"),
      path.resolve(moduleDir, "../../data/meetmind_db.json"),
      path.resolve(moduleDir, "../data/meetmind_db.json"),
      path.resolve(moduleDir, "data/meetmind_db.json"),
      path.resolve(moduleDir, "meetmind_db.json"),
      path.resolve("/var/task/data/meetmind_db.json"),
      path.resolve("/var/task/meetmind_db.json"),
    ];

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).size > 20) {
          const raw = fs.readFileSync(candidate, "utf-8");
          const parsed: Partial<DatabaseSchema> = JSON.parse(raw);
          if (Array.isArray(parsed.users) && parsed.users.length > 0) {
            const verified = this.ensureSchemaArrays(parsed);
            this.saveData(verified);
            return verified;
          }
        }
      } catch {
        // continue to next candidate
      }
    }

    // 3. Fallback to rich embedded initial schema with verified scrypt hashes
    const initial = getInitialData();
    this.saveData(initial);
    return initial;
  }

  private syncRemoteKV(data: DatabaseSchema): void {
    const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim();
    const token = (
      process.env.KV_REST_API_TOKEN ||
      process.env.UPSTASH_REDIS_REST_TOKEN ||
      ""
    ).trim();
    if (!url || !token) return;

    try {
      const endpoint = `${url.replace(/\/$/, "")}/set/meetmind_db`;
      void fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(JSON.stringify(data)),
      }).catch((err) => {
        console.warn("Vercel KV async sync warning:", err);
      });
    } catch {
      // ignore sync errors
    }
  }

  private saveData(data: DatabaseSchema) {
    try {
      const dir = path.dirname(DB_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to persist database file", err);
    }
    this.syncRemoteKV(data);
  }

  public get<K extends keyof DatabaseSchema>(key: K): DatabaseSchema[K] {
    return this.data[key];
  }

  public update<K extends keyof DatabaseSchema>(
    key: K,
    updater: (current: DatabaseSchema[K]) => DatabaseSchema[K],
  ): DatabaseSchema[K] {
    this.data[key] = updater(this.data[key]);
    this.saveData(this.data);
    return this.data[key];
  }

  public full(): DatabaseSchema {
    return this.data;
  }

  public backupData(): DatabaseSchema {
    return JSON.parse(JSON.stringify(this.data));
  }

  public resetData(): DatabaseSchema {
    const clean = getInitialData();
    this.data = clean;
    this.saveData(clean);
    return clean;
  }

  public restoreData(backup: DatabaseSchema): DatabaseSchema {
    this.data = backup;
    this.saveData(backup);
    return backup;
  }
}

export const db = new DatabaseManager();
