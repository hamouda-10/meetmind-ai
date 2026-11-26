import { memo, useState } from "react";
import { useUIStore } from "@/stores/ui-store";

/**
 * AmbientBackground
 * - Black & Gold (default): Cinematic Matte Black (#070709) + Official Gold Waveform Background
 * - Pure White: Crisp White (#FFFFFF) + Subtle Neutral Gray (#F7F8FA) Architectural Grid & Waveform
 * - Sky Blue: Fresh Light Sky Blue (#F4FAFF / #EAF6FF) + Clean Cyan/Sky (#0284C7 -> #38BDF8) Waves
 */
export const AmbientBackground = memo(function AmbientBackground() {
  const resolvedTheme = useUIStore((s) => s.resolvedTheme);
  const [imageLoaded, setImageLoaded] = useState(true);
  const [hasError, setHasError] = useState(false);

  if (resolvedTheme === "sky-blue") {
    return (
      <div
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none bg-[#F4FAFF] transform-gpu"
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-gradient-to-b from-[#F4FAFF] via-[#F8FCFF] to-[#EAF6FF]" />
        {/* Soft fresh sky-blue ambient radiance */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 980px 560px at 18% 0%, rgba(56, 189, 248, 0.14) 0%, transparent 62%), radial-gradient(ellipse 840px 520px at 85% 12%, rgba(6, 182, 212, 0.10) 0%, transparent 60%)",
          }}
        />
        {/* Crisp Light Sky Blue Flowing Soundwave SVG */}
        <svg
          className="absolute inset-0 h-full w-full opacity-65 pointer-events-none transform-gpu"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 1440 900"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <linearGradient id="bgSkyWave1" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#0284C7" stopOpacity="0" />
              <stop offset="30%" stopColor="#0284C7" stopOpacity="0.16" />
              <stop offset="68%" stopColor="#38BDF8" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#06B6D4" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="bgSkyWave2" x1="100%" y1="0%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#06B6D4" stopOpacity="0" />
              <stop offset="45%" stopColor="#38BDF8" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#0284C7" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0 310 Q 180 220, 360 310 T 720 310 T 1080 310 T 1440 310"
            fill="none"
            stroke="url(#bgSkyWave1)"
            strokeWidth="2"
            className="waveform-wave-1"
          />
          <path
            d="M0 360 Q 200 430, 400 360 T 800 360 T 1200 360 T 1440 360"
            fill="none"
            stroke="url(#bgSkyWave2)"
            strokeWidth="1.5"
            className="waveform-wave-2"
          />
        </svg>
        {/* Subtle Architectural Sky Grid */}
        <div
          className="absolute inset-0 opacity-[0.16] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(to right, #BAE6FD 1px, transparent 1px), linear-gradient(to bottom, #BAE6FD 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />
      </div>
    );
  }

  if (resolvedTheme === "pure-white") {
    return (
      <div
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none bg-white transform-gpu"
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-white" />
        <svg
          className="absolute inset-0 h-full w-full opacity-55 pointer-events-none transform-gpu"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 1440 900"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <linearGradient id="bgMonoWave1" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#09090b" stopOpacity="0" />
              <stop offset="30%" stopColor="#09090b" stopOpacity="0.09" />
              <stop offset="70%" stopColor="#52525b" stopOpacity="0.07" />
              <stop offset="100%" stopColor="#09090b" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="bgMonoWave2" x1="100%" y1="0%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#18181b" stopOpacity="0" />
              <stop offset="45%" stopColor="#18181b" stopOpacity="0.07" />
              <stop offset="100%" stopColor="#18181b" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0 320 Q 180 230, 360 320 T 720 320 T 1080 320 T 1440 320"
            fill="none"
            stroke="url(#bgMonoWave1)"
            strokeWidth="2"
            className="waveform-wave-1"
          />
          <path
            d="M0 350 Q 200 420, 400 350 T 800 350 T 1200 350 T 1440 350"
            fill="none"
            stroke="url(#bgMonoWave2)"
            strokeWidth="1.5"
            className="waveform-wave-2"
          />
        </svg>
        <div
          className="absolute inset-0 opacity-[0.035] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(to right, #09090b 1px, transparent 1px), linear-gradient(to bottom, #09090b 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 1200px 700px at 50% 0%, rgba(9, 9, 11, 0.03) 0%, transparent 70%)",
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none bg-[#070709] transform-gpu"
      aria-hidden="true"
    >
      {/* 1. Deep Matte Dark Base Layer (#070709) */}
      <div className="absolute inset-0 bg-[#070709]" />

      {/* 2. Official High-Resolution MeetMind AI Audio Background Image */}
      {!hasError && (
        <picture>
          <source srcSet="/assets/meetmind_bg.webp" type="image/webp" />
          <img
            src="/assets/aistudio/_________________________________________________-1_a701650f.png"
            alt="MeetMind AI Workspace Background"
            onLoad={() => setImageLoaded(true)}
            onError={() => setHasError(true)}
            className={`absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-700 ${
              imageLoaded ? "opacity-90" : "opacity-0"
            }`}
            style={{ willChange: "opacity" }}
            loading="eager"
            decoding="async"
          />
        </picture>
      )}

      {/* 3. Smooth 60fps Ambient Audio Waveform SVG Overlay (Pure CSS/GPU, 0 Network Weight) */}
      <svg
        className="absolute inset-0 h-full w-full opacity-40 mix-blend-screen pointer-events-none transform-gpu"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="bgGoldWave1" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#d4af37" stopOpacity="0" />
            <stop offset="30%" stopColor="#d4af37" stopOpacity="0.35" />
            <stop offset="70%" stopColor="#fffbe0" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#d4af37" stopOpacity="0" />
          </linearGradient>

          <linearGradient id="bgGoldWave2" x1="100%" y1="0%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#d4af37" stopOpacity="0" />
            <stop offset="40%" stopColor="#e5c158" stopOpacity="0.3" />
            <stop offset="80%" stopColor="#d4af37" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#d4af37" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Primary Audio Frequency Wave */}
        <path
          d="M0 320 Q 180 230, 360 320 T 720 320 T 1080 320 T 1440 320"
          fill="none"
          stroke="url(#bgGoldWave1)"
          strokeWidth="2"
          className="waveform-wave-1"
        />

        {/* Harmonic Wave */}
        <path
          d="M0 350 Q 200 420, 400 350 T 800 350 T 1200 350 T 1440 350"
          fill="none"
          stroke="url(#bgGoldWave2)"
          strokeWidth="1.5"
          className="waveform-wave-2"
        />
      </svg>

      {/* 4. Elegant Vignette & Dark Overlay for Crisp Content Contrast */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 1300px 850px at 50% 10%, rgba(212, 175, 55, 0.04) 0%, rgba(7, 7, 9, 0.65) 60%, #070709 100%)",
        }}
      />

      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "linear-gradient(to bottom, rgba(7, 7, 9, 0.3) 0%, rgba(7, 7, 9, 0.75) 100%)",
        }}
      />

      {/* 5. Subtle Tech Grid Overlay */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(to right, #d4af37 1px, transparent 1px), linear-gradient(to bottom, #d4af37 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />
    </div>
  );
});
