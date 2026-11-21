import { useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Eye, EyeOff, Loader2, AlertCircle, ArrowRight, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth/auth-shell";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/lib/i18n";
import { storeBrowserPasswordCredential } from "@/lib/credential-manager";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function getSafeRedirect(searchStr: string): string {
  const params = new URLSearchParams(searchStr || "");
  const target = params.get("redirect");
  if (!target || !target.startsWith("/") || target.startsWith("//")) return "/";
  if (target === "/login" || target === "/register") return "/";
  return target;
}

function LoginPage() {
  const navigate = useNavigate();
  const searchStr = useRouterState({ select: (r) => r.location.searchStr });
  const { language } = useTranslation();

  const login = useAuthStore((s) => s.login);
  const sessionNotice = useAuthStore((s) => s.sessionNotice);
  const clearSessionNotice = useAuthStore((s) => s.clearSessionNotice);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState<"credentials" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAccountNotFound, setIsAccountNotFound] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  const isAr = language === "AR";
  const isBusy = submitting !== null;

  const validateFields = (): boolean => {
    const errors: { email?: string; password?: string } = {};
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      errors.email = isAr ? "البريد الإلكتروني مطلوب." : "Email address is required.";
    } else if (!EMAIL_REGEX.test(trimmedEmail)) {
      errors.email = isAr
        ? "يرجى إدخال بريد إلكتروني صحيح."
        : "Please enter a valid email address.";
    }
    if (!password) {
      errors.password = isAr ? "كلمة المرور مطلوبة." : "Password is required.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMessage(null);
    setIsAccountNotFound(false);
    clearSessionNotice();

    if (!validateFields()) return;

    setSubmitting("credentials");
    try {
      const normalizedEmail = email.trim();
      const user = await login({ email: normalizedEmail, password, rememberMe });
      void storeBrowserPasswordCredential({
        email: normalizedEmail,
        password,
        name: user.name,
      });
      toast.success(isAr ? `مرحباً بعودتك، ${user.name}` : `Welcome back, ${user.name}`);
      const destination = getSafeRedirect(searchStr);
      void navigate({ to: destination as never, replace: true });
    } catch (err: unknown) {
      const errorObj = err as Error & { code?: string };
      const rawMsg = errorObj?.message || "";
      const isNotFound =
        errorObj?.code === "ACCOUNT_NOT_FOUND" ||
        rawMsg.includes("Account not found") ||
        rawMsg.includes("حساب غير موجود");

      if (isNotFound) {
        setIsAccountNotFound(true);
        setErrorMessage(
          isAr
            ? "الحساب غير موجود. يرجى إنشاء حساب جديد أولاً."
            : "Account not found. Please create an account first.",
        );
      } else {
        const msg =
          rawMsg ||
          (isAr
            ? "تعذر تسجيل الدخول. يرجى المحاولة مرة أخرى."
            : "Unable to sign in. Please try again.");
        setErrorMessage(msg);
      }
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <AuthShell
      title={isAr ? "تسجيل الدخول إلى MeetMind AI" : "Sign in to MeetMind AI"}
      subtitle={
        isAr
          ? "أدخل بيانات حسابك للوصول إلى اجتماعاتك ومحاضراتك وملخصاتك الذكية."
          : "Enter your credentials to access your meetings, lectures, and AI workspace."
      }
      footer={
        <div className="flex items-center justify-center gap-1.5 text-sm">
          <span className="text-zinc-400">
            {isAr ? "ليس لديك حساب بعد؟" : "Don't have an account?"}
          </span>
          <Link
            to={"/register" as never}
            className="font-bold text-amber-400 transition-colors hover:text-amber-300 underline-offset-4 hover:underline"
          >
            {isAr ? "إنشاء حساب" : "Create account"}
          </Link>
        </div>
      }
    >
      {/* Session expired notice */}
      {sessionNotice && !errorMessage && (
        <div
          role="status"
          aria-live="polite"
          className="mb-5 flex items-start gap-2.5 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3.5 py-3 text-xs leading-relaxed text-amber-200 animate-in fade-in slide-in-from-top-1 duration-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <span>{sessionNotice}</span>
        </div>
      )}

      {/* Real backend or validation error banner */}
      {errorMessage && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-5 rounded-xl border border-red-500/40 bg-red-950/60 p-3.5 text-xs leading-relaxed text-red-200 animate-in fade-in slide-in-from-top-1 duration-200"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <div className="flex-1 space-y-2">
              <p className="font-medium">{errorMessage}</p>
              {isAccountNotFound && (
                <div className="pt-1">
                  <Link
                    to={"/register" as never}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-400 to-amber-500 px-3 py-1.5 text-xs font-bold text-zinc-950 shadow-[0_4px_16px_rgba(212,175,55,0.4)] transition-all hover:from-amber-300 hover:to-amber-400 active:scale-[0.98]"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    <span>{isAr ? "إنشاء حساب الآن" : "Create account"}</span>
                    <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <form method="post" onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Email / Username */}
        <div className="auth-field-group">
          <label
            htmlFor="login-email"
            className="mb-1.5 block text-xs font-semibold tracking-wide text-zinc-200"
          >
            {isAr ? "البريد الإلكتروني" : "Email address"}
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
            required
            disabled={isBusy}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined }));
              if (errorMessage) {
                setErrorMessage(null);
                setIsAccountNotFound(false);
              }
            }}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
            placeholder="name@company.com"
            className="auth-input h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950/90 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none disabled:opacity-60"
          />
          {fieldErrors.email && (
            <p id="login-email-error" className="mt-1.5 text-xs text-red-400">
              {fieldErrors.email}
            </p>
          )}
        </div>

        {/* Password */}
        <div className="auth-field-group">
          <label
            htmlFor="login-password"
            className="mb-1.5 block text-xs font-semibold tracking-wide text-zinc-200"
          >
            {isAr ? "كلمة المرور" : "Password"}
          </label>
          <div className="relative">
            <input
              id="login-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              disabled={isBusy}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined }));
                if (errorMessage) {
                  setErrorMessage(null);
                  setIsAccountNotFound(false);
                }
              }}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
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
          {fieldErrors.password && (
            <p id="login-password-error" className="mt-1.5 text-xs text-red-400">
              {fieldErrors.password}
            </p>
          )}
        </div>

        {/* Remember me */}
        <div className="flex items-center justify-between pt-0.5">
          <label className="group inline-flex items-center gap-2.5 text-xs font-medium text-zinc-300 transition-colors hover:text-zinc-100 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberMe}
              disabled={isBusy}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-amber-400 accent-amber-400 transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
            />
            <span>{isAr ? "تذكرني على هذا الجهاز" : "Remember me on this device"}</span>
          </label>
        </div>

        {/* Submit Login */}
        <button
          type="submit"
          disabled={isBusy}
          className="auth-btn-primary mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 px-4 text-sm font-bold text-zinc-950 shadow-[0_8px_30px_-8px_rgba(212,175,55,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-65 cursor-pointer"
        >
          {submitting === "credentials" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{isAr ? "جارٍ تسجيل الدخول..." : "Signing in..."}</span>
            </>
          ) : (
            <>
              <span>{isAr ? "تسجيل الدخول" : "Sign in"}</span>
              <ArrowRight className="h-4 w-4 rtl:rotate-180" />
            </>
          )}
        </button>
      </form>
    </AuthShell>
  );
}
