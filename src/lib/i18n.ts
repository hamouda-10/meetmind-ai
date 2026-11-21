import { create } from "zustand";

export type LanguageCode = "EN" | "AR";

export interface Translations {
  // Brand & Tagline
  brandName: string;
  tagline: string;

  // Nav Groups & Items
  nav_workspace: string;
  nav_ai: string;
  nav_insights: string;
  nav_system: string;

  nav_dashboard: string;
  nav_meetings: string;
  nav_lectures: string;
  nav_calendar: string;
  nav_ai_workspace: string;
  nav_transcripts: string;
  nav_mind_maps: string;
  nav_flashcards: string;
  nav_quiz: string;
  nav_reports: string;
  nav_analytics: string;
  nav_notifications: string;
  nav_search: string;
  nav_users: string;
  nav_settings: string;
  nav_profile: string;
  nav_admin: string;

  // Header / Topbar
  searchPlaceholder: string;
  askAi: string;
  newRecording: string;
  proUpgrade: string;
  proDesc: string;
  upgradeBtn: string;
  language: string;
  theme: string;
  notifications: string;
  settings: string;
  profile: string;
  logout: string;
  recordAudioBtn: string;
  aiActiveBadge: string;
  calendarSchedule: string;
  accountMenu: string;
  guestUser: string;
  guestSessionNotice: string;
  signInOrCreate: string;
  signOutAction: string;
  signingOutState: string;

  // Dashboard
  briefingReady: string;
  welcomeTitle: string;
  welcomeSubtitle: string;
  startRecording: string;
  uploadFile: string;
  viewAiWorkspace: string;
  todaysFocus: string;
  meetingsThisWeek: string;
  lecturesRecorded: string;
  aiActionsExtracted: string;
  hoursSaved: string;
  recentMeetings: string;
  recentLectures: string;
  upcomingSessions: string;
  aiInsights: string;
  weeklyActivity: string;
  pendingTasks: string;
  viewAll: string;
  noMeetingsRecorded: string;
  noLecturesRecorded: string;
  noUpcomingEvents: string;
  noAiInsightsYet: string;
  noRecentActivity: string;
  noTasksPending: string;
  tasksWidgetTitle: string;
  tasksWidgetDesc: string;
  addTask: string;
  calendarWidgetTitle: string;
  calendarWidgetDesc: string;
  weeklyAnalyticsTitle: string;
  weeklyAnalyticsDesc: string;
  activityWidgetTitle: string;
  notificationsWidgetTitle: string;
  noNotifications: string;
  allTranscriptsLink: string;
  clickForLiveMic: string;
  liveMicCoreTitle: string;

  // Meetings & Lectures
  allMeetings: string;
  allLectures: string;
  searchMeetings: string;
  searchLectures: string;
  filterByStatus: string;
  statusCompleted: string;
  statusProcessing: string;
  statusQueued: string;
  statusFailed: string;
  courseCode: string;
  instructor: string;
  host: string;
  duration: string;
  participants: string;
  studyNotes: string;
  keyConcepts: string;
  examHighlights: string;
  viewTranscript: string;
  openSummary: string;
  generateQuiz: string;
  studyFlashcards: string;
  noRecordingsFound: string;
  deleteAll: string;
  deleteRecordingConfirm: string;

  // Transcripts & Audio Player
  transcriptViewer: string;
  searchInTranscript: string;
  speakers: string;
  copyTranscript: string;
  exportPdf: string;
  exportTxt: string;
  exportVtt: string;
  exportSrt: string;
  translateTranscript: string;
  showingOriginal: string;
  showingTranslated: string;
  translationNotice: string;
  jumpToTimestamp: string;
  editTranscript: string;
  saveEdits: string;
  audioPlayerReady: string;
  audioPlayerUnavailable: string;
  totalDuration: string;
  downloadAudio: string;
  playbackSpeed: string;
  speed: string;
  retryAnalysisBtn: string;
  visualizer3D: string;
  continuousView: string;
  segmentsView: string;
  filterBySpeaker: string;
  allSpeakers: string;
  analysisUnavailableNotice: string;
  analysisProcessingNotice: string;
  analysisFailedNotice: string;

  // AI & Q&A
  askAiQuestion: string;
  aiQuestionPlaceholder: string;
  askButton: string;
  groundedAnswer: string;
  citations: string;
  noCitations: string;
  activeContext: string;
  noRecordingSelected: string;
  selectSessionPlaceholder: string;
  aiToolsTitle: string;
  generateSummaryTool: string;
  generateAnalysisTool: string;
  generateQuizTool: string;
  generateFlashcardsTool: string;
  generateMindMapTool: string;
  askQuestionTool: string;
  clearChat: string;
  scopeAll: string;

  // Quiz & Flashcards
  quizTitle: string;
  quizSubtitle: string;
  startQuiz: string;
  submitQuiz: string;
  score: string;
  retakeQuiz: string;
  explanation: string;
  question: string;
  of: string;
  correct: string;
  incorrect: string;
  questionNeedsReview: string;
  questionNumberPrefix: string;
  selectQuizLecture: string;
  attemptsHistory: string;
  generateNewQuizBtn: string;
  noQuizzesYet: string;
  noQuizzesDesc: string;
  attemptNumber: string;
  noAttemptsRecorded: string;
  trueOption: string;
  falseOption: string;
  fillBlankPlaceholder: string;
  approvedAnswer: string;
  shortAnswerPlaceholder: string;
  modelAnswer: string;
  groundedEvidence: string;
  difficultyEasy: string;
  difficultyMedium: string;
  difficultyHard: string;
  typeMcq: string;
  typeTrueFalse: string;
  typeFillBlank: string;
  typeShortAnswer: string;

  flashcardsTitle: string;
  flashcardsSubtitle: string;
  clickToFlip: string;
  markMastered: string;
  needsReview: string;
  resetProgress: string;
  deckComplete: string;

  // Mind Maps
  mindMapsTitle: string;
  mindMapsSubtitle: string;
  centralTopic: string;
  subtopics: string;
  zoomIn: string;
  zoomOut: string;
  resetView: string;
  rootConcept: string;

  // Recording & Upload Modal
  uploadAudioTitle: string;
  uploadAudioDesc: string;
  selectAudioFile: string;
  dragDropAudio: string;
  browseFiles: string;
  supportedFormats: string;
  maxFileSize: string;
  uploadProgress: string;
  uploadedStatus: string;
  processingAudio: string;
  transcribingAudio: string;
  analyzingAudio: string;
  generatingQuizStatus: string;
  jobCompletedStatus: string;
  jobFailedStatus: string;
  retryJobAction: string;
  cancelJobAction: string;
  liveRecordingModalTitle: string;
  liveRecordingModalDesc: string;
  sessionTitleLabel: string;
  meetingCategoryLabel: string;
  lectureCategoryLabel: string;
  startMicRecording: string;
  pauseMicRecording: string;
  resumeMicRecording: string;
  stopSaveRecording: string;
  micActiveIndicator: string;
  audioInputDevice: string;
  permissionDeniedError: string;
  listenToRecording: string;

  // Reports & Analytics
  reportsTitle: string;
  reportsSubtitle: string;
  analyticsTitle: string;
  analyticsSubtitle: string;
  audioMinutesProcessed: string;
  taskCompletionRate: string;
  totalDecisions: string;
  exportCsv: string;

  // Settings & Profile
  settingsTitle: string;
  settingsSubtitle: string;
  appearanceTab: string;
  notificationsTab: string;
  aiTab: string;
  securityTab: string;
  dataTab: string;
  profileTitle: string;
  profileSubtitle: string;
  editProfile: string;
  saveProfile: string;
  fullName: string;
  emailAddress: string;
  passwordLabel: string;
  bioLabel: string;
  jobTitleLabel: string;
  departmentLabel: string;
  organizationLabel: string;
  uploadPhoto: string;
  changePassword: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  systemResetTitle: string;
  systemResetDesc: string;
  deleteAllRecordingsTitle: string;
  deleteAllRecordingsDesc: string;

  // Common Actions & Form Controls
  cancel: string;
  save: string;
  delete: string;
  confirm: string;
  close: string;
  loading: string;
  processing: string;
  success: string;
  error: string;
  back: string;
  next: string;
  actions: string;
  date: string;
  priority: string;
  priorityHigh: string;
  priorityMedium: string;
  priorityLow: string;
  completed: string;
  pending: string;
  copySuccess: string;
  savingChanges: string;
}

export const translations: Record<LanguageCode, Translations> = {
  EN: {
    brandName: "MeetMind AI",
    tagline: "Your Meetings. Smarter Outcomes.",

    nav_workspace: "Workspace",
    nav_ai: "AI Studio",
    nav_insights: "Insights",
    nav_system: "System",

    nav_dashboard: "Dashboard",
    nav_meetings: "Meetings",
    nav_lectures: "Lectures",
    nav_calendar: "Calendar",
    nav_ai_workspace: "AI Workspace",
    nav_transcripts: "Transcripts",
    nav_mind_maps: "Mind Maps",
    nav_flashcards: "Flashcards",
    nav_quiz: "Quiz Generator",
    nav_reports: "Reports",
    nav_analytics: "Analytics",
    nav_notifications: "Notifications",
    nav_search: "Search",
    nav_users: "Users",
    nav_settings: "Settings",
    nav_profile: "Profile",
    nav_admin: "Admin",

    searchPlaceholder: "Search meetings, lectures, people…",
    askAi: "Ask AI",
    newRecording: "New Recording",
    proUpgrade: "Upgrade to Pro",
    proDesc: "Unlimited AI summaries & quizzes",
    upgradeBtn: "Upgrade",
    language: "Language",
    theme: "Theme",
    notifications: "Notifications",
    settings: "Settings",
    profile: "Profile",
    logout: "Sign out",
    recordAudioBtn: "+ Record Audio",
    aiActiveBadge: "AI v3.5 Active",
    calendarSchedule: "Calendar & Schedule",
    accountMenu: "Account menu",
    guestUser: "Guest",
    guestSessionNotice: "Temporary isolated guest session",
    signInOrCreate: "Sign in or Create Account",
    signOutAction: "Sign out",
    signingOutState: "Signing out…",

    briefingReady: "AI briefing ready",
    welcomeTitle: "Welcome to MeetMind AI",
    welcomeSubtitle:
      "Record meetings and educational lectures into structured transcripts, verifiable action items, comprehensive lecture notes, interactive flashcards, and quizzes automatically.",
    startRecording: "Start recording",
    uploadFile: "Upload File",
    viewAiWorkspace: "View AI workspace",
    todaysFocus: "Today's focus",
    meetingsThisWeek: "Meetings this week",
    lecturesRecorded: "Lectures recorded",
    aiActionsExtracted: "AI actions extracted",
    hoursSaved: "Hours saved",
    recentMeetings: "Recent Meetings",
    recentLectures: "Recent Lectures",
    upcomingSessions: "Upcoming Sessions",
    aiInsights: "AI Insights",
    weeklyActivity: "Weekly Activity",
    pendingTasks: "Pending Tasks",
    viewAll: "View all",
    noMeetingsRecorded: "No meetings recorded yet. Click 'Upload File' to record or upload.",
    noLecturesRecorded: "No lectures recorded yet. Start a recording or upload one.",
    noUpcomingEvents: "No upcoming events scheduled.",
    noAiInsightsYet: "No AI insights generated yet. Record or upload audio to generate insights.",
    noRecentActivity: "No activity logged yet.",
    noTasksPending: "No tasks pending. Actions extracted from meetings will appear here.",
    tasksWidgetTitle: "Tasks",
    tasksWidgetDesc: "Extracted from your meetings and lectures",
    addTask: "Add",
    calendarWidgetTitle: "Calendar",
    calendarWidgetDesc: "Jump to a day",
    weeklyAnalyticsTitle: "Weekly analytics",
    weeklyAnalyticsDesc: "Meetings & lectures this week",
    activityWidgetTitle: "Live Activity Log",
    notificationsWidgetTitle: "Notifications & Alerts",
    noNotifications: "No new notifications.",
    allTranscriptsLink: "All Transcripts",
    clickForLiveMic: "Click for Live Mic",
    liveMicCoreTitle: "AI Speech Intelligence Core — Click to start live speech processing",

    allMeetings: "All Meetings",
    allLectures: "All Educational Lectures",
    searchMeetings: "Search meetings by title, host or topic…",
    searchLectures: "Search lectures by course code, professor or topic…",
    filterByStatus: "Filter by status",
    statusCompleted: "Completed",
    statusProcessing: "Processing",
    statusQueued: "Queued",
    statusFailed: "Failed",
    courseCode: "Course Code",
    instructor: "Instructor",
    host: "Host",
    duration: "Duration",
    participants: "Participants",
    studyNotes: "Study Notes",
    keyConcepts: "Key Concepts",
    examHighlights: "Exam Highlights",
    viewTranscript: "View Transcript",
    openSummary: "AI Summary",
    generateQuiz: "Generate Quiz",
    studyFlashcards: "Study Flashcards",
    noRecordingsFound: "No recordings found matching your query.",
    deleteAll: "Delete All",
    deleteRecordingConfirm: "Are you sure you want to delete this recording and its outputs?",

    transcriptViewer: "Audio Transcript & Speaker Diarization",
    searchInTranscript: "Search in transcript…",
    speakers: "Speakers",
    copyTranscript: "Copy text",
    exportPdf: "Export PDF",
    exportTxt: "Export TXT",
    exportVtt: "Captions VTT",
    exportSrt: "Captions SRT",
    translateTranscript: "Translate to Arabic",
    showingOriginal: "Showing Original Transcript (English)",
    showingTranslated: "Showing AI Translated Transcript (Arabic)",
    translationNotice:
      "AI translation generated for convenience. Grounded citations reference original timestamps.",
    jumpToTimestamp: "Seek to",
    editTranscript: "Edit text",
    saveEdits: "Save changes",
    audioPlayerReady: "Audio file ready for playback and sync",
    audioPlayerUnavailable: "Audio file unavailable (transcript only)",
    totalDuration: "Total Duration",
    downloadAudio: "Download Audio",
    playbackSpeed: "Speed",
    speed: "Speed",
    retryAnalysisBtn: "Retry AI Analysis Now",
    visualizer3D: "3D Waveform Visualizer",
    continuousView: "Continuous View",
    segmentsView: "Segment Cards",
    filterBySpeaker: "Filter by speaker",
    allSpeakers: "All Speakers",
    analysisUnavailableNotice:
      "AI servers are experiencing high demand (HTTP 503). Transcript and audio are 100% saved.",
    analysisProcessingNotice:
      "AI analysis and structured insights are processing in the background…",
    analysisFailedNotice:
      "AI analysis failed, but your audio and transcript are permanently saved.",

    askAiQuestion: "Ask MeetMind AI",
    aiQuestionPlaceholder:
      "Ask anything about this meeting or lecture (e.g. 'What decisions were made about latency?')...",
    askButton: "Ask AI",
    groundedAnswer: "Grounded Answer",
    citations: "Verified Citations",
    noCitations: "No matching transcript citation found.",
    activeContext: "Active Context",
    noRecordingSelected: "No recording selected",
    selectSessionPlaceholder: "Select session or lecture…",
    aiToolsTitle: "AI Productivity Suite",
    generateSummaryTool: "Executive Summary",
    generateAnalysisTool: "Structured Analysis & Study Notes",
    generateQuizTool: "Interactive Quiz",
    generateFlashcardsTool: "Study Flashcards",
    generateMindMapTool: "Concept Mind Map",
    askQuestionTool: "Ask Grounded Question",
    clearChat: "Clear Chat",
    scopeAll: "All Recordings (Global Assistant)",

    quizTitle: "Knowledge Check & Quiz Generator",
    quizSubtitle:
      "Practice questions auto-generated from your lecture transcripts and textbook concepts.",
    startQuiz: "Take Quiz",
    submitQuiz: "Submit Answers",
    score: "Final Score",
    retakeQuiz: "Retake Quiz",
    explanation: "Explanation",
    question: "Question",
    of: "of",
    correct: "Correct!",
    incorrect: "Incorrect",
    questionNeedsReview: "Answer needs review",
    questionNumberPrefix: "Question",
    selectQuizLecture: "Select Lecture:",
    attemptsHistory: "Attempt History",
    generateNewQuizBtn: "Generate New Questions",
    noQuizzesYet: "No quizzes generated yet",
    noQuizzesDesc: "Record or upload a lecture to automatically generate practice quizzes.",
    attemptNumber: "Attempt",
    noAttemptsRecorded: "No previous attempts recorded for this quiz.",
    trueOption: "True",
    falseOption: "False",
    fillBlankPlaceholder: "Type missing term or concept here…",
    approvedAnswer: "Approved Answer:",
    shortAnswerPlaceholder: "Type your analytical answer based on the lecture...",
    modelAnswer: "Academic Model Answer:",
    groundedEvidence: "Grounded Evidence from Transcript:",
    difficultyEasy: "Easy",
    difficultyMedium: "Medium",
    difficultyHard: "Hard",
    typeMcq: "Multiple Choice (MCQ)",
    typeTrueFalse: "True / False",
    typeFillBlank: "Fill in the Blank",
    typeShortAnswer: "Short Answer & Analysis",

    flashcardsTitle: "Interactive Study Flashcards",
    flashcardsSubtitle:
      "Spaced-repetition flashcards synthesized directly from lecture discussions and definitions.",
    clickToFlip: "Click card to flip",
    markMastered: "Mark as Mastered",
    needsReview: "Needs Review",
    resetProgress: "Reset Deck",
    deckComplete: "You've reviewed all cards in this deck!",

    mindMapsTitle: "Concept & Mind Maps",
    mindMapsSubtitle:
      "Hierarchical visualization of lecture topics, sub-themes, and architectural dependencies.",
    centralTopic: "Central Topic",
    subtopics: "Subtopics",
    zoomIn: "Zoom In",
    zoomOut: "Zoom Out",
    resetView: "Reset View",
    rootConcept: "Root Concept",

    uploadAudioTitle: "Upload & Transcribe Audio",
    uploadAudioDesc: "Select or drag any audio file for immediate transcription and AI analysis.",
    selectAudioFile: "Select audio file",
    dragDropAudio: "Drag and drop your audio file here, or click to browse",
    browseFiles: "Browse files",
    supportedFormats: "Supported: MP3, WAV, M4A, WEBM, OGG, AAC, FLAC (up to 500 MB)",
    maxFileSize: "Max size: 500 MB",
    uploadProgress: "Uploading…",
    uploadedStatus: "Uploaded",
    processingAudio: "Processing audio…",
    transcribingAudio: "Transcribing audio with Whisper ASR…",
    analyzingAudio: "Analyzing content with Gemini AI…",
    generatingQuizStatus: "Generating interactive quiz questions…",
    jobCompletedStatus: "Completed successfully!",
    jobFailedStatus: "Processing failed.",
    retryJobAction: "Retry Processing",
    cancelJobAction: "Cancel Processing",
    liveRecordingModalTitle: "Live Speech Recording & Diarization",
    liveRecordingModalDesc: "Capture speech in real-time with continuous transcription.",
    sessionTitleLabel: "Session Title",
    meetingCategoryLabel: "Business Meeting",
    lectureCategoryLabel: "Academic Lecture",
    startMicRecording: "Start Recording",
    pauseMicRecording: "Pause",
    resumeMicRecording: "Resume",
    stopSaveRecording: "Stop & Save",
    micActiveIndicator: "Microphone Active",
    audioInputDevice: "Microphone Device",
    permissionDeniedError: "Microphone permission was denied. Please allow mic access.",
    listenToRecording: "Listen to Recording",

    reportsTitle: "Executive & Academic Reports",
    reportsSubtitle:
      "Export comprehensive meeting digests, lecture syntheses, and operational compliance logs.",
    analyticsTitle: "System Analytics & Productivity",
    analyticsSubtitle:
      "Track hours saved, transcription accuracy, task completion velocity, and knowledge retention.",
    audioMinutesProcessed: "Audio Minutes Processed",
    taskCompletionRate: "Task Completion Rate",
    totalDecisions: "Decisions Recorded",
    exportCsv: "Export CSV",

    settingsTitle: "Account & System Settings",
    settingsSubtitle: "Manage your preferences, security, and workspaces.",
    appearanceTab: "Appearance",
    notificationsTab: "Notifications",
    aiTab: "AI Preferences",
    securityTab: "Security & Sessions",
    dataTab: "Data & Reset",
    profileTitle: "User Profile",
    profileSubtitle: "View and edit your personal details and workspaces.",
    editProfile: "Edit Profile",
    saveProfile: "Save Profile",
    fullName: "Full Name",
    emailAddress: "Email Address",
    passwordLabel: "Password",
    bioLabel: "Bio",
    jobTitleLabel: "Job Title",
    departmentLabel: "Department",
    organizationLabel: "Organization",
    uploadPhoto: "Upload Photo",
    changePassword: "Change Password",
    currentPassword: "Current Password",
    newPassword: "New Password",
    confirmPassword: "Confirm Password",
    systemResetTitle: "Reset System Demo Data",
    systemResetDesc: "Delete synthetic demo data and restore initial clean workspace.",
    deleteAllRecordingsTitle: "Delete All Recordings",
    deleteAllRecordingsDesc: "Permanently delete all audio files, transcripts, quizzes, and tasks.",

    cancel: "Cancel",
    save: "Save",
    delete: "Delete",
    confirm: "Confirm",
    close: "Close",
    loading: "Loading…",
    processing: "Processing…",
    success: "Success",
    error: "Error",
    back: "Back",
    next: "Next",
    actions: "Actions",
    date: "Date",
    priority: "Priority",
    priorityHigh: "High",
    priorityMedium: "Medium",
    priorityLow: "Low",
    completed: "Completed",
    pending: "Pending",
    copySuccess: "Copied to clipboard",
    savingChanges: "Saving changes…",
  },

  AR: {
    brandName: "ميت مايند AI",
    tagline: "اجتماعاتك بذكاء. نتائج أسرع.",

    nav_workspace: "مساحة العمل",
    nav_ai: "استوديو الذكاء الاصطناعي",
    nav_insights: "التحليلات والرؤى",
    nav_system: "النظام والإعدادات",

    nav_dashboard: "لوحة التحكم",
    nav_meetings: "الاجتماعات",
    nav_lectures: "المحاضرات",
    nav_calendar: "التقويم",
    nav_ai_workspace: "مساحة الذكاء الاصطناعي",
    nav_transcripts: "النصوص والتفريغ",
    nav_mind_maps: "الخرائط الذهنية",
    nav_flashcards: "بطاقات الاستذكار",
    nav_quiz: "منشئ الاختبارات",
    nav_reports: "التقارير",
    nav_analytics: "الإحصائيات",
    nav_notifications: "الإشعارات",
    nav_search: "البحث",
    nav_users: "المستخدمون",
    nav_settings: "الإعدادات",
    nav_profile: "الملف الشخصي",
    nav_admin: "لوحة الإدارة",

    searchPlaceholder: "ابحث في الاجتماعات، المحاضرات، الأشخاص…",
    askAi: "اسأل الذكاء الاصطناعي",
    newRecording: "تسجيل جديد",
    proUpgrade: "الترقية إلى برو",
    proDesc: "ملخصات واختبارات ذكية غير محدودة",
    upgradeBtn: "ترقية",
    language: "اللغة",
    theme: "المظهر",
    notifications: "الإشعارات",
    settings: "الإعدادات",
    profile: "الملف الشخصي",
    logout: "تسجيل الخروج",
    recordAudioBtn: "+ تسجيل صوتي",
    aiActiveBadge: "الذكاء الاصطناعي v3.5 نشط",
    calendarSchedule: "الجدول والتقويم",
    accountMenu: "حساب المستخدم",
    guestUser: "ضيف",
    guestSessionNotice: "جلسة ضيف مؤقتة ومعزولة",
    signInOrCreate: "تسجيل الدخول أو إنشاء حساب",
    signOutAction: "تسجيل الخروج",
    signingOutState: "جارٍ تسجيل الخروج…",

    briefingReady: "الموجز الذكي جاهز",
    welcomeTitle: "مرحباً بك في ميت مايند AI",
    welcomeSubtitle:
      "تسجيل الاجتماعات والمحاضرات وتحويلها آلياً إلى تفريغ نصي دقيق، ومهام تنفيذية محددة، وملاحظات دراسية، وبطاقات استذكار، واختبارات تفاعلية.",
    startRecording: "بدء التسجيل",
    uploadFile: "رفع ملف",
    viewAiWorkspace: "فتح مساحة العمل الذكية",
    todaysFocus: "تركيز اليوم",
    meetingsThisWeek: "اجتماعات هذا الأسبوع",
    lecturesRecorded: "محاضرات مسجلة",
    aiActionsExtracted: "مهام مستخرجة بالذكاء الاصطناعي",
    hoursSaved: "ساعات عمل موفرة",
    recentMeetings: "أحدث الاجتماعات",
    recentLectures: "أحدث المحاضرات",
    upcomingSessions: "الجلسات القادمة",
    aiInsights: "رؤى الذكاء الاصطناعي",
    weeklyActivity: "النشاط الأسبوعي",
    pendingTasks: "المهام المعلقة",
    viewAll: "عرض الكل",
    noMeetingsRecorded: "لا توجد اجتماعات مسجلة بعد. اضغط «رفع ملف» لبدء تسجيل أو رفع جلسة.",
    noLecturesRecorded: "لا توجد محاضرات مسجلة بعد. ابدأ تسجيلاً أو ارفع ملف محاضرة.",
    noUpcomingEvents: "لا توجد جلسات مجدولة قادمة.",
    noAiInsightsYet: "لا توجد رؤى اصطناعية بعد. قم بتسجيل أو رفع ملف صوتي لاستخلاص الرؤى مباشرة.",
    noRecentActivity: "لا يوجد نشاط مسجل حتى الآن.",
    noTasksPending: "لا توجد مهام معلقة. ستظهر المهام المستخرجة من الجلسات هنا.",
    tasksWidgetTitle: "المهام والتكليفات",
    tasksWidgetDesc: "مستخرجة آلياً من الاجتماعات والمحاضرات",
    addTask: "إضافة",
    calendarWidgetTitle: "التقويم والجدول",
    calendarWidgetDesc: "الانتقال إلى يوم محدد",
    weeklyAnalyticsTitle: "التحليلات الأسبوعية",
    weeklyAnalyticsDesc: "الاجتماعات والمحاضرات لهذا الأسبوع",
    activityWidgetTitle: "سجل النشاط المباشر",
    notificationsWidgetTitle: "الإشعارات والتنبيهات",
    noNotifications: "لا توجد إشعارات جديدة.",
    allTranscriptsLink: "سجل التفريغ الصوتي",
    clickForLiveMic: "اضغط للتسجيل الحي",
    liveMicCoreTitle: "نواة معالجة الكلام الذكية — اضغط لبدء التفريغ الصوتي الحي",

    allMeetings: "جميع الاجتماعات",
    allLectures: "جميع المحاضرات الأكاديمية",
    searchMeetings: "ابحث عن اجتماع بالعنوان، المضيف أو الموضوع…",
    searchLectures: "ابحث عن محاضرة برمز المادة، اسم المحاضر أو الموضوع…",
    filterByStatus: "تصفية حسب الحالة",
    statusCompleted: "مكتمل",
    statusProcessing: "قيد المعالجة",
    statusQueued: "في قائمة الانتظار",
    statusFailed: "تعذر المعالجة",
    courseCode: "رمز المقرر",
    instructor: "المحاضر",
    host: "المضيف",
    duration: "المدة",
    participants: "المشاركون",
    studyNotes: "ملاحظات دراسية",
    keyConcepts: "المفاهيم الأساسية",
    examHighlights: "نقاط هامة للاختبار",
    viewTranscript: "عرض النص المفرغ",
    openSummary: "الملخص الذكي",
    generateQuiz: "إنشاء اختبار",
    studyFlashcards: "مراجعة البطاقات",
    noRecordingsFound: "لم يتم العثور على تسجيلات تطابق استعلامك.",
    deleteAll: "حذف الكل",
    deleteRecordingConfirm: "هل أنت متأكد من رغبتك في حذف هذا التسجيل وجميع مخرجاته نهائياً؟",

    transcriptViewer: "التفريغ الصوتي وتحديد المتحدثين",
    searchInTranscript: "ابحث داخل التفريغ النصي…",
    speakers: "المتحدثون",
    copyTranscript: "نسخ النص",
    exportPdf: "تصدير PDF",
    exportTxt: "تصدير نصي TXT",
    exportVtt: "ترجمة VTT",
    exportSrt: "ترجمة SRT",
    translateTranscript: "الترجمة إلى الإنجليزية",
    showingOriginal: "عرض النص الأصلي (العربية)",
    showingTranslated: "عرض النص المترجم بالذكاء الاصطناعي",
    translationNotice: "تم إنشاء الترجمة الآلية للتسهيل؛ وتستند الاقتباسات إلى التوقيت الأصلي.",
    jumpToTimestamp: "الانتقال إلى",
    editTranscript: "تعديل النص",
    saveEdits: "حفظ التعديلات",
    audioPlayerReady: "الملف الصوتي جاهز للبث والمزامنة",
    audioPlayerUnavailable: "الملف الصوتي غير متاح (تفريغ نصي فقط)",
    totalDuration: "المدة الإجمالية",
    downloadAudio: "تنزيل الصوت",
    playbackSpeed: "السرعة",
    speed: "السرعة",
    retryAnalysisBtn: "إعادة محاولة التحليل الذكي الآن",
    visualizer3D: "مجسم 3D للموجات الصوتية",
    continuousView: "عرض مستمر",
    segmentsView: "بطاقات المقاطع",
    filterBySpeaker: "تصفية حسب المتحدث",
    allSpeakers: "جميع المتحدثين",
    analysisUnavailableNotice:
      "خوادم الذكاء الاصطناعي تشهد ضغطاً مؤقتاً (503). النص والتسجيل محفوظان بنسبة 100%.",
    analysisProcessingNotice: "جاري معالجة واستخراج التحليلات الذكية في الخلفية بواسطة Gemini AI…",
    analysisFailedNotice: "تعذر إتمام التحليل الذكي، ولكن التسجيل الصوتي والتفريغ محفوظان بأمان.",

    askAiQuestion: "اسأل ميت مايند AI",
    aiQuestionPlaceholder:
      "اسأل أي سؤال عن هذا الاجتماع أو المحاضرة (مثال: 'ما هي القرارات التي تم اتخاذها بخصوص الأداء؟')...",
    askButton: "إرسال السؤال",
    groundedAnswer: "الإجابة المستندة للنص",
    citations: "الاقتباسات الموثقة",
    noCitations: "لا توجد اقتباسات مطابقة في النص.",
    activeContext: "السياق النشط",
    noRecordingSelected: "لم يتم تحديد أي تسجيل",
    selectSessionPlaceholder: "اختر جلسة أو محاضرة…",
    aiToolsTitle: "حزمة أدوات الذكاء الاصطناعي",
    generateSummaryTool: "الملخص التنفيذي",
    generateAnalysisTool: "التحليل المهيكل والملاحظات",
    generateQuizTool: "الاختبار التفاعلي",
    generateFlashcardsTool: "بطاقات الاستذكار",
    generateMindMapTool: "الخريطة الذهنية",
    askQuestionTool: "طرح سؤال موثق",
    clearChat: "مسح المحادثة",
    scopeAll: "مساعد ذكي شامل (جميع التسجيلات)",

    quizTitle: "اختبار الفهم ومنشئ الأسئلة",
    quizSubtitle: "أسئلة تدريبية يتم إنشاؤها تلقائياً من نصوص المحاضرات والمفاهيم الرئيسية.",
    startQuiz: "بدء الاختبار",
    submitQuiz: "تسليم الإجابات",
    score: "النتيجة النهائية",
    retakeQuiz: "إعادة الاختبار",
    explanation: "التفسير والشرح",
    question: "السؤال",
    of: "من",
    correct: "إجابة صحيحة!",
    incorrect: "إجابة خاطئة",
    questionNeedsReview: "إجابة تحتاج مراجعة",
    questionNumberPrefix: "السؤال",
    selectQuizLecture: "اختر المحاضرة:",
    attemptsHistory: "سجل المحاولات",
    generateNewQuizBtn: "توليد أسئلة جديدة مختلفة",
    noQuizzesYet: "لا توجد اختبارات منشأة بعد",
    noQuizzesDesc: "قم بتسجيل أو رفع محاضرة أو اجتماع لإنشاء اختبار تقييمي شامل تلقائياً.",
    attemptNumber: "المحاولة",
    noAttemptsRecorded: "لا توجد محاولات سابقة مسجلة لهذا الاختبار بعد.",
    trueOption: "صح (صواب)",
    falseOption: "خطأ",
    fillBlankPlaceholder: "اكتب الإجابة أو المصطلح الناقص هنا…",
    approvedAnswer: "الإجابة المعتمدة:",
    shortAnswerPlaceholder: "اكتب استنتاجك أو إجابتك التحليلية استناداً إلى شرح المحاضر…",
    modelAnswer: "نموذج الإجابة الأكاديمي:",
    groundedEvidence: "التوثيق الاستدلالي من نص المحاضرة:",
    difficultyEasy: "سهل",
    difficultyMedium: "متوسط",
    difficultyHard: "متقدم",
    typeMcq: "اختيار من متعدد (MCQ)",
    typeTrueFalse: "صح / خطأ",
    typeFillBlank: "أكمل الفراغ",
    typeShortAnswer: "سؤال مقالي واستنتاجي",

    flashcardsTitle: "بطاقات الاستذكار التفاعلية",
    flashcardsSubtitle: "بطاقات تكرار متباعد مستخلصة مباشرة من نقاشات المحاضرة وتعريفاتها.",
    clickToFlip: "انقر لقلب البطاقة",
    markMastered: "تم الحفظ بنجاح",
    needsReview: "تحتاج إلى مراجعة",
    resetProgress: "إعادة ضبط البطاقات",
    deckComplete: "أحسنت! لقد راجعت جميع بطاقات هذه المجموعة.",

    mindMapsTitle: "الخرائط الذهنية والمفاهيمية",
    mindMapsSubtitle: "عرض تسلسلي بصري لموضوعات المحاضرة، التفرعات الفرعية، والترابط الهندسي.",
    centralTopic: "الموضوع الرئيسي",
    subtopics: "الموضوعات الفرعية",
    zoomIn: "تكبير",
    zoomOut: "تصغير",
    resetView: "إعادة ضبط العرض",
    rootConcept: "المفهوم الجذري",

    uploadAudioTitle: "رفع وتفريغ الملف الصوتي",
    uploadAudioDesc: "اختر أو اسحب أي ملف صوتي للتفريغ الفوري والتحليل الذكي الشامل.",
    selectAudioFile: "اختر ملف صوتي",
    dragDropAudio: "اسحب وأفلت الملف الصوتي هنا، أو اضغط للتصفح",
    browseFiles: "تصفح الملفات",
    supportedFormats: "الصيغ المدعومة: MP3, WAV, M4A, WEBM, OGG, AAC, FLAC (حتى 500 ميغابايت)",
    maxFileSize: "أقصى حجم: 500 ميغابايت",
    uploadProgress: "جاري الرفع…",
    uploadedStatus: "تم الرفع بنجاح",
    processingAudio: "جاري معالجة الصوت…",
    transcribingAudio: "جاري استخراج النص بالذكاء الاصطناعي Whisper ASR…",
    analyzingAudio: "جاري التحليل الذكي واستخراج المهام عبر Gemini AI…",
    generatingQuizStatus: "جاري إنشاء أسئلة الاختبار التفاعلي…",
    jobCompletedStatus: "اكتملت المعالجة بنجاح!",
    jobFailedStatus: "فشلت المعالجة.",
    retryJobAction: "إعادة محاولة المعالجة",
    cancelJobAction: "إلغاء المعالجة",
    liveRecordingModalTitle: "التسجيل الصوتي الحي والتفريغ الفوري",
    liveRecordingModalDesc: "التقاط الصوت من الميكروفون مع التفريغ المستمر وتحديد المتحدثين.",
    sessionTitleLabel: "عنوان الجلسة",
    meetingCategoryLabel: "اجتماع عمل",
    lectureCategoryLabel: "محاضرة جامعية",
    startMicRecording: "بدء التسجيل",
    pauseMicRecording: "إيقاف مؤقت",
    resumeMicRecording: "استئناف",
    stopSaveRecording: "إيقاف وحفظ",
    micActiveIndicator: "الميكروفون نشط",
    audioInputDevice: "جهاز الميكروفون",
    permissionDeniedError: "تم رفض إذن الوصول للميكروفون. يرجى تفعيله من إعدادات المتصفح.",
    listenToRecording: "الاستماع للتسجيل",

    reportsTitle: "التقارير التنفيذية والأكاديمية",
    reportsSubtitle: "تصدير ملخصات الاجتماعات الشاملة، ومخرجات المحاضرات وسجلات التدقيق.",
    analyticsTitle: "إحصائيات النظام والإنتاجية",
    analyticsSubtitle: "متابعة ساعات العمل الموفرة، دقة التفريغ، وسرعة إنجاز المهام.",
    audioMinutesProcessed: "دقائق الصوت المعالجة",
    taskCompletionRate: "نسبة إنجاز المهام",
    totalDecisions: "القرارات المسجلة",
    exportCsv: "تصدير CSV",

    settingsTitle: "إعدادات الحساب والنظام",
    settingsSubtitle: "إدارة تفضيلات العرض والذكاء الاصطناعي والأمان.",
    appearanceTab: "المظهر والسمة",
    notificationsTab: "الإشعارات",
    aiTab: "تفضيلات الذكاء الاصطناعي",
    securityTab: "الأمان والجلسات",
    dataTab: "البيانات وإعادة الضبط",
    profileTitle: "الملف الشخصي",
    profileSubtitle: "عرض وتعديل بياناتك الشخصية ومساحة العمل.",
    editProfile: "تعديل الملف الشخصي",
    saveProfile: "حفظ التعديلات",
    fullName: "الاسم الكامل",
    emailAddress: "البريد الإلكتروني",
    passwordLabel: "كلمة المرور",
    bioLabel: "النبذة التعريفية",
    jobTitleLabel: "المسمى الوظيفي",
    departmentLabel: "القسم",
    organizationLabel: "المؤسسة / الجامعة",
    uploadPhoto: "تغيير الصورة",
    changePassword: "تغيير كلمة المرور",
    currentPassword: "كلمة المرور الحالية",
    newPassword: "كلمة المرور الجديدة",
    confirmPassword: "تأكيد كلمة المرور",
    systemResetTitle: "إعادة ضبط البيانات التجريبية",
    systemResetDesc: "مسح البيانات التجريبية وإعادة النظام لحالته الأولية النظيفة.",
    deleteAllRecordingsTitle: "حذف جميع التسجيلات",
    deleteAllRecordingsDesc: "حذف جميع الملفات الصوتية والنصوص والاختبارات نهائياً.",

    cancel: "إلغاء",
    save: "حفظ",
    delete: "حذف",
    confirm: "تأكيد",
    close: "إغلاق",
    loading: "جاري التحميل…",
    processing: "جاري المعالجة…",
    success: "تم بنجاح",
    error: "خطأ",
    back: "رجوع",
    next: "التالي",
    actions: "الإجراءات",
    date: "التاريخ",
    priority: "الأولوية",
    priorityHigh: "عالية",
    priorityMedium: "متوسطة",
    priorityLow: "منخفضة",
    completed: "مكتمل",
    pending: "معلق",
    copySuccess: "تم النسخ إلى الحافظة",
    savingChanges: "جاري حفظ التغييرات…",
  },
};

export const LANG_STORAGE_KEY = "meetmind-lang";

interface I18nStore {
  language: LanguageCode;
  hydrated: boolean;
  hydrateLanguage: () => void;
  setLanguage: (lang: LanguageCode) => void;
  toggleLanguage: () => void;
}

export const useI18nStore = create<I18nStore>((set, get) => ({
  language: "EN",
  hydrated: false,
  hydrateLanguage: () => {
    try {
      if (typeof window === "undefined") return;
      const stored = localStorage.getItem(LANG_STORAGE_KEY) as LanguageCode | null;
      if (stored === "AR" || stored === "EN") {
        set({ language: stored, hydrated: true });
        if (typeof document !== "undefined") {
          document.documentElement.dir = stored === "AR" ? "rtl" : "ltr";
          document.documentElement.lang = stored === "AR" ? "ar" : "en";
        }
      } else {
        set({ hydrated: true });
      }
    } catch {
      set({ hydrated: true });
    }
  },
  setLanguage: (language: LanguageCode) => {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, language);
    } catch {
      // ignore
    }
    if (typeof document !== "undefined") {
      document.documentElement.dir = language === "AR" ? "rtl" : "ltr";
      document.documentElement.lang = language === "AR" ? "ar" : "en";
    }
    set({ language });
  },
  toggleLanguage: () => {
    const next = get().language === "AR" ? "EN" : "AR";
    get().setLanguage(next);
  },
}));

export function useTranslation() {
  const language = useI18nStore((s) => s.language);
  const setLanguage = useI18nStore((s) => s.setLanguage);
  const toggleLanguage = useI18nStore((s) => s.toggleLanguage);
  const isRtl = language === "AR";

  const t = (key: keyof Translations): string => {
    const current = translations[language];
    if (current && current[key]) {
      return current[key];
    }
    return translations.EN[key] || String(key);
  };

  const formatDate = (
    date: string | number | Date,
    options?: Intl.DateTimeFormatOptions,
  ): string => {
    try {
      const d = new Date(date);
      if (isNaN(d.getTime())) return String(date);
      return new Intl.DateTimeFormat(
        language === "AR" ? "ar-EG" : "en-US",
        options || {
          year: "numeric",
          month: "short",
          day: "numeric",
        },
      ).format(d);
    } catch {
      return String(date);
    }
  };

  const formatDateTime = (date: string | number | Date): string => {
    try {
      const d = new Date(date);
      if (isNaN(d.getTime())) return String(date);
      return new Intl.DateTimeFormat(language === "AR" ? "ar-EG" : "en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(d);
    } catch {
      return String(date);
    }
  };

  const formatNumber = (num: number): string => {
    try {
      return new Intl.NumberFormat(language === "AR" ? "ar-EG" : "en-US").format(num);
    } catch {
      return String(num);
    }
  };

  const formatTime = (seconds: number): string => {
    if (!Number.isFinite(seconds) || isNaN(seconds) || seconds < 0) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return {
    t,
    language,
    isRtl,
    setLanguage,
    toggleLanguage,
    formatDate,
    formatDateTime,
    formatNumber,
    formatTime,
  };
}
