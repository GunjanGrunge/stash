import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  onComplete: () => void;
  autoDismissMs?: number;
};

export function SplashScreen({ onComplete, autoDismissMs = 2500 }: Props) {
  const [progress, setProgress] = useState(0);
  const onCompleteRef = useRef(onComplete);
  const finishedRef = useRef(false);
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  const complete = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (timeoutRef.current !== undefined) window.clearTimeout(timeoutRef.current);
    onCompleteRef.current();
  }, []);

  useEffect(() => {
    const startTime = Date.now();
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, Math.round((elapsed / autoDismissMs) * 100));
      setProgress(pct);

      if (pct >= 100) {
        window.clearInterval(interval);
        timeoutRef.current = window.setTimeout(complete, 150);
      }
    }, 25);
    return () => {
      window.clearInterval(interval);
      if (timeoutRef.current !== undefined) window.clearTimeout(timeoutRef.current);
    };
  }, [autoDismissMs, complete]);

  return (
    <div className="splash-screen" role="dialog" aria-modal="true" aria-label="STASH Launch Splash Screen" tabIndex={-1}>
      <div className="splash-halo" aria-hidden="true" />
      
      <div className="splash-content">
        <div className="splash-logo-wrap">
          <svg className="splash-symbol" viewBox="0 0 1200 300" aria-label="STASH Logo">
            <defs>
              <linearGradient id="splash-g" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#38BDF8" />
                <stop offset="100%" stopColor="#7C3AED" />
              </linearGradient>
            </defs>
            <g transform="translate(15 20) scale(.255)">
              <polygon points="298,225 429,225 315,798 184,798" fill="url(#splash-g)" />
              <polygon points="486,225 617,225 503,798 372,798" fill="url(#splash-g)" />
              <polygon points="577,798 714,798 675,661" fill="url(#splash-g)" />
            </g>
            <text x="290" y="190" fill="#FFFFFF" fontFamily="Inter, Arial, sans-serif" fontSize="118" fontWeight="700" letterSpacing="14">
              STASH
            </text>
          </svg>
        </div>

        <p className="splash-tagline">Stash it. Find it. Use it anywhere.</p>
        <p className="splash-subline">Your creative assets. Always within reach.</p>

        <div className="splash-progress-bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="splash-progress-fill" style={{ width: `${progress}%` }} />
        </div>

        <button type="button" className="splash-skip-btn" onClick={complete}>
          Enter Studio &rarr;
        </button>
      </div>
    </div>
  );
}
