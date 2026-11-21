import { useState, useEffect, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  Check,
  X,
  ArrowRight,
  Compass,
  Sparkles,
  User,
  Mail,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth/auth-shell";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/lib/i18n";
import { storeBrowserPasswordCredential } from "@/lib/credential-manager";

export const Route = createFileRoute("/register")({
  component: RegisterPage,
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface PasswordRule {
  key: string;
  labelEn: string;
  labelAr: string;
  passed: boolean;
}

function getPasswordRules(password: string): PasswordRule[] {
  return [
    {
      key: "length",
      labelEn: "At least 8 characters",
      labelAr: "8 أحرف على الأقل",
      passed: password.length >= 8,
    },
    {
      key: "upper",
      labelEn: "One uppercase letter (A-Z)",
      labelAr: "حرف كبير واحد (A-Z)",
      passed: /[A-Z]/.test(password),
    },
    {
      key: "lower",
      labelEn: "One lowercase letter (a-z)",
      labelAr: "حرف صغير واحد (a-z)",
      passed: /[a-z]/.test(password),
    },
    {
      key: "number",
      labelEn: "One number (0-9)",
      labelAr: "رقم واحد (0-9)",
      passed: /[0-9]/.test(password),
    },
    {
      key: "special",
      labelEn: "One special character (!@#$...)",
      labelAr: "رمز خاص واحد (!@#$...)",
      passed: /[^A-Za-z0-9]/.test(password),
    },
  ];
}

function RegisterPage() {
  const navigate = useNavigate();
  const searchStr = useRouterState({ select: (r) => r.location.searchStr });
  const { language } = useTranslation();

  const register = useAuthStore((s) => s.register);
  const loginAsGuest = useAuthStore((s) => s.loginAsGuest);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [submitting, setSubmitting] = useState<"register" | "guest" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
  }>({});

  const isAr = language === "AR";
  const isBusy = submitting !== null;
  const rules = getPasswordRules(password);
  const passedCount = rules.filter((r) => r.passed).length;
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;

  // Prefill email if passed in query string (e.g. from Account Not Found on login page)
  useEffect(() => {
    const params = new URLSearchParams(searchStr || "");
    const queryEmail = params.get("email");
    if (queryEmail) {
      setEmail((prev) => (prev ? prev : queryEmail.trim()));
    }
  }, [searchStr]);

  const validateFields = (): boolean => {
    const errors: {
      name?: string;
      email?: string;
      password?: string;
      confirmPassword?: string;
    } = {};

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName || trimmedName.length < 2) {
      errors.name = isAr
        ? "يجب أن يتكون الاسم الكامل من حرفين على الأقل."
        : "Full name must be at least 2 characters long.";
    }
    if (!trimmedEmail) {
      errors.email = isAr ? "البريد الإلكتروني مطلوب." : "Email address is required.";
    } else if (!EMAIL_REGEX.test(trimmedEmail)) {
      errors.email = isAr
        ? "يرجى إدخال بريد إلكتروني صحيح."
        : "Please enter a valid email address.";
    }
    if (passedCount < rules.length) {
      errors.password = isAr
        ? "يرجى استيفاء جميع شروط قوة كلمة المرور أدناه."
        : "Please satisfy all password strength requirements below.";
    }
    if (!confirmPassword) {
      errors.confirmPassword = isAr ? "يرجى تأكيد كلمة المرور." : "Please confirm your password.";
    } else if (password !== confirmPassword) {
      errors.confirmPassword = isAr ? "كلمتا المرور غير متطابقتين." : "Passwords do not match.";
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMessage(null);

    if (!validateFields()) return;

    setSubmitting("register");
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const user = await register({
        name: name.trim(),
        email: normalizedEmail,
        password,
        confirmPassword,
      });
      void storeBrowserPasswordCredential({
        email: normalizedEmail,
        password,
        name: user.name,
      });
      toast.success(
        isAr
          ? `تم إنشاء الحساب بنجاح! مرحباً بك، ${user.name}`
          : `Account created successfully! Welcome, ${user.name}`,
      );
      void navigate({ to: "/" as never, replace: true });
    } catch (err: unknown) {
      const rawMsg = (err as Error)?.message || "";
      const isDuplicate =
        rawMsg.includes("already registered") ||
        rawMsg.includes("already exists") ||
        rawMsg.includes("مسجل مسبقاً");

      if (isDuplicate) {
        setErrorMessage(
          isAr
            ? "هذا البريد الإلكتروني مسجل مسبقاً. يرجى تسجيل الدخول أو استخدام بريد آخر."
            : "This email is already registered. Please sign in or use another email.",
        );
      } else {
        setErrorMessage(
          rawMsg ||
            (isAr
              ? "تعذر إنشاء الحساب. يرجى مراجعة البيانات والمحاولة مرة أخرى."
              : "Unable to create account. Please check your information and try again."),
        );
      }
    } finally {
      setSubmitting(null);
    }
  };

  const handleGuestLogin = async () => {
    if (isBusy) return;
    setErrorMessage(null);
    setSubmitting("guest");

    try {
      await loginAsGuest();
      toast.success(
        isAr ? "مرحباً بك في وضع الاستكشاف كضيف!" : "Welcome to MeetMind AI Guest Mode!",
      );
      void navigate({ to: "/" as never, replace: true });
    } catch (err: unknown) {
      const rawMsg = (err as Error)?.message || "";
      toast.error(
        rawMsg ||
          (isAr
            ? "تعذر بدء جلسة الضيف. يرجى المحاولة مرة أخرى."
            : "Could not initialize guest session. Please try again."),
      );
    } finally {
      setSubmitting(null);
    }
  };

  // Progress percentage
  const strengthPercent = Math.round((passedCount / rules.length) * 100);
  const strengthColor =
    passedCount <= 2 ? "bg-red-500" : passedCount <= 4 ? "bg-amber-400" : "bg-emerald-400";
  const strengthLabel =
    passedCount <= 2
      ? isAr
        ? "ضعيفة"
        : "Weak"
      : passedCount <= 4
        ? isAr
          ? "متوسطة"
          : "Medium"
        : isAr
          ? "قوية"
          : "Strong";

  return (
    <AuthShell
      title={isAr ? "إنشاء حساب MeetMind AI" : "Create MeetMind AI account"}
      subtitle={
        isAr
          ? "ابدأ بتوثيق وتلخيص اجتماعاتك ومحاضراتك مع أحدث تقنيات الذكاء الاصطناعي."
          : "Start transcribing, summarizing, and studying your meetings and lectures with AI."
      }
      footer={
        <div className="flex items-center justify-center gap-1.5 text-sm">
          <span className="text-zinc-400">
            {isAr ? "لديك حساب بالفعل؟" : "Already have an account?"}
          </span>
          <Link
            to={"/login" as never}
            search={{ email: email.trim() || undefined } as never}
            className="font-bold text-amber-400 transition-colors hover:text-amber-300 underline-offset-4 hover:underline"
          >
            {isAr ? "تسجيل الدخول" : "Sign in"}
          </Link>
        </div>
      }
    >
      {/* Error alert banner */}
      {errorMessage && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-5 rounded-xl border border-red-500/40 bg-red-950/60 p-3.5 text-xs leading-relaxed text-red-200 animate-in fade-in slide-in-from-top-1 duration-200"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <div className="flex-1">
              <p className="font-medium">{errorMessage}</p>
              {errorMessage.includes("already registered") && (
                <div className="mt-2">
                  <Link
                    to={"/login" as never}
                    search={{ email: email.trim() } as never}
                    className="inline-flex items-center gap-1 font-bold text-amber-300 hover:text-amber-200 underline"
                  >
                    <span>{isAr ? "الانتقال إلى صفحة الدخول" : "Go to Sign in page"}</span>
                    <ArrowRight className="h-3 w-3 rtl:rotate-180" />
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <form method="post" onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Full Name */}
        <div className="auth-field-group">
          <label
            htmlFor="register-name"
            className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-zinc-200"
          >
            <User className="h-3.5 w-3.5 text-amber-400/80" />
            <span>{isAr ? "الاسم الكامل" : "Full name"}</span>
          </label>
          <input
            id="register-name"
            name="name"
            type="text"
            autoComplete="name"
            required
            disabled={isBusy}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (fieldErrors.name) setFieldErrors((p) => ({ ...p, name: undefined }));
              if (errorMessage) setErrorMessage(null);
            }}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? "register-name-error" : undefined}
            placeholder={isAr ? "أدخل اسمك الكامل" : "Enter your full name"}
            className="auth-input h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950/90 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none disabled:opacity-60"
          />
          {fieldErrors.name && (
            <p id="register-name-error" className="mt-1 text-xs text-red-400">
              {fieldErrors.name}
            </p>
          )}
        </div>

        {/* Email */}
        <div className="auth-field-group">
          <label
            htmlFor="register-email"
            className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-zinc-200"
          >
            <Mail className="h-3.5 w-3.5 text-amber-400/80" />
            <span>{isAr ? "البريد الإلكتروني" : "Email address"}</span>
          </label>
          <input
            id="register-email"
            name="email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="email"
            required
            disabled={isBusy}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined }));
              if (errorMessage) setErrorMessage(null);
            }}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "register-email-error" : undefined}
            placeholder="name@company.com"
            className="auth-input h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950/90 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none disabled:opacity-60"
          />
          {fieldErrors.email && (
            <p id="register-email-error" className="mt-1 text-xs text-red-400">
              {fieldErrors.email}
            </p>
          )}
        </div>

        {/* Password */}
        <div className="auth-field-group">
          <label
            htmlFor="register-password"
            className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-zinc-200"
          >
            <Lock className="h-3.5 w-3.5 text-amber-400/80" />
            <span>{isAr ? "كلمة المرور" : "Password"}</span>
          </label>
          <div className="relative">
            <input
              id="register-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              disabled={isBusy}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined }));
                if (errorMessage) setErrorMessage(null);
              }}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby="register-password-rules"
              placeholder="••••••••"
              className="auth-input h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950/90 px-3.5 pe-11 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none disabled:opacity-60"
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowPassword((prev) => !prev)}
              disabled={isBusy}
              aria-pressed={showPassword}
              aria-label={
                showPassword
                  ? isAr
                    ? "إخفاء كلمة المرور"
                    : "Hide password"
                  : isAr
                    ? "إظهار كلمة المرور"
                    : "Show password"
              }
              className="absolute inset-y-0 end-0 flex items-center px-3.5 text-zinc-400 transition-colors hover:text-amber-300 focus-visible:outline-none focus-visible:text-amber-300 cursor-pointer"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {/* Password strength progress meter */}
          {password.length > 0 && (
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-400">
                  {isAr ? "قوة كلمة المرور:" : "Password strength:"}
                </span>
                <span className="font-semibold text-zinc-200">{strengthLabel}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full transition-all duration-300 ${strengthColor}`}
                  style={{ width: `${strengthPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Password rules checklist */}
          <div
            id="register-password-rules"
            className="mt-2.5 rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-3"
          >
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-zinc-300">
              <ShieldCheck className="h-3.5 w-3.5 text-amber-400" />
              <span>{isAr ? "متطلبات كلمة المرور:" : "Password requirements:"}</span>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
              {rules.map((rule) => (
                <li
                  key={rule.key}
                  className={`flex items-center gap-1.5 transition-colors ${
                    rule.passed ? "text-emerald-400" : "text-zinc-400"
                  }`}
                >
                  {rule.passed ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  ) : (
                    <X className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                  )}
                  <span>{isAr ? rule.labelAr : rule.labelEn}</span>
                </li>
              ))}
            </ul>
          </div>

          {fieldErrors.password && (
            <p id="register-password-error" className="mt-1 text-xs text-red-400">
              {fieldErrors.password}
            </p>
          )}
        </div>

        {/* Confirm Password */}
        <div className="auth-field-group">
          <label
            htmlFor="register-confirm-password"
            className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-zinc-200"
          >
            <Lock className="h-3.5 w-3.5 text-amber-400/80" />
            <span>{isAr ? "تأكيد كلمة المرور" : "Confirm password"}</span>
          </label>
          <div className="relative">
            <input
              id="register-confirm-password"
              name="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              disabled={isBusy}
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (fieldErrors.confirmPassword)
                  setFieldErrors((p) => ({ ...p, confirmPassword: undefined }));
                if (errorMessage) setErrorMessage(null);
              }}
              aria-invalid={Boolean(fieldErrors.confirmPassword)}
              aria-describedby={fieldErrors.confirmPassword ? "register-confirm-error" : undefined}
              placeholder="••••••••"
              className="auth-input h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950/90 px-3.5 pe-11 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none disabled:opacity-60"
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowConfirmPassword((prev) => !prev)}
              disabled={isBusy}
              aria-pressed={showConfirmPassword}
              aria-label={
                showConfirmPassword
                  ? isAr
                    ? "إخفاء تأكيد كلمة المرور"
                    : "Hide confirm password"
                  : isAr
                    ? "إظهار تأكيد كلمة المرور"
                    : "Show confirm password"
              }
              className="absolute inset-y-0 end-0 flex items-center px-3.5 text-zinc-400 transition-colors hover:text-amber-300 focus-visible:outline-none focus-visible:text-amber-300 cursor-pointer"
            >
              {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {fieldErrors.confirmPassword ? (
            <p id="register-confirm-error" className="mt-1 text-xs text-red-400">
              {fieldErrors.confirmPassword}
            </p>
          ) : confirmPassword.length > 0 && password.length > 0 ? (
            <p
              className={`mt-1 text-[11px] transition-colors ${
                passwordsMatch ? "text-emerald-400" : "text-amber-300"
              }`}
            >
              {passwordsMatch
                ? isAr
                  ? "كلمتا المرور متطابقتان"
                  : "Passwords match"
                : isAr
                  ? "كلمتا المرور غير متطابقتين بعد"
                  : "Passwords do not match yet"}
            </p>
          ) : null}
        </div>

        {/* Create Account Submit */}
        <button
          type="submit"
          disabled={isBusy}
          className="auth-btn-primary mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 px-4 text-sm font-bold text-zinc-950 shadow-[0_8px_30px_-8px_rgba(212,175,55,0.55)] transition-all hover:scale-[1.01] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-65 cursor-pointer"
        >
          {submitting === "register" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{isAr ? "جارٍ إنشاء حسابك..." : "Creating account..."}</span>
            </>
          ) : (
            <>
              <span>{isAr ? "إنشاء الحساب" : "Create account"}</span>
              <ArrowRight className="h-4 w-4 rtl:rotate-180" />
            </>
          )}
        </button>

        {/* OR Divider */}
        <div className="relative my-4 flex items-center justify-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-zinc-800" />
          </div>
          <span className="relative bg-[#0a0a0f] px-3 text-xs uppercase tracking-wider text-zinc-500 font-medium">
            {isAr ? "أو" : "or"}
          </span>
        </div>

        {/* Continue as Guest Button */}
        <button
          type="button"
          disabled={isBusy}
          onClick={handleGuestLogin}
          className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 text-sm font-semibold text-amber-200 transition-all hover:border-amber-400/60 hover:bg-amber-500/10 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 disabled:opacity-60 cursor-pointer"
        >
          {submitting === "guest" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
              <span>{isAr ? "جارٍ الدخول كضيف..." : "Entering guest mode..."}</span>
            </>
          ) : (
            <>
              <Compass className="h-4 w-4 text-amber-400" />
              <span>{isAr ? "المتابعة كضيف" : "Continue as Guest"}</span>
              <Sparkles className="h-3.5 w-3.5 text-amber-400/80" />
            </>
          )}
        </button>
      </form>
    </AuthShell>
  );
}
