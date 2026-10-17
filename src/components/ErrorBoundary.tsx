import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { OutageScreen } from '@/components/OutageScreen';

// ── Stale-chunk self-heal (shared with main.tsx) ────────────────────────────
// After a deploy, tabs holding the old index.html request chunk hashes that
// no longer exist. Reload pulls the fresh index.html. The guard is
// time-based (not once-per-session) so the tab heals after EVERY deploy,
// while still preventing refresh loops when the failure is real.
// Safari words a failed module import differently from Chrome, and when the
// import that failed was a React.lazy() payload the error surfaces from React's
// own internals as "undefined is not an object (evaluating 'e._result.default')"
// — no mention of a module at all. Matching only the Chrome wording let that one
// through to the generic error screen (seen on bestly.tech in Safari 2026-10-16).
const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Loading chunk \S+ failed|ChunkLoadError|Importing a module script failed|Unable to preload CSS|_result\.default|_result\s*\.\s*default/i;
const RELOAD_AT_KEY = 'bestly:chunk-reloaded-at';
const MIN_RELOAD_INTERVAL_MS = 15_000;

export function isStaleChunkError(reason: unknown): boolean {
  const msg = String((reason as Error | undefined)?.message ?? reason ?? '');
  return CHUNK_ERROR_RE.test(msg);
}

/** True when the 15s guard would let a reload through right now. Reads only. */
function reloadAllowedNow(): boolean {
  try {
    return Date.now() - Number(sessionStorage.getItem(RELOAD_AT_KEY) || 0) >= MIN_RELOAD_INTERVAL_MS;
  } catch {
    return true;
  }
}

/** Reload the tab (at most once per 15s). Returns true if a reload was started. */
export function reloadForStaleChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_AT_KEY) || 0);
    if (Date.now() - last < MIN_RELOAD_INTERVAL_MS) return false;
    sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()));
  } catch {
    // sessionStorage unavailable — still reload once.
  }
  window.location.reload();
  return true;
}

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  /** A stale-chunk reload is on its way, so render nothing rather than an error. */
  reloading: boolean;
}

/**
 * Top-level error boundary. Prevents a component error from white-screening
 * the whole app. Keep this lean so it renders even if imports break.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, reloading: false };

  static getDerivedStateFromError(error: Error): State {
    // Only stay silent when a reload will actually happen. If the guard would
    // swallow it, the reload already failed to fix this — show the real error.
    return { hasError: true, error, reloading: isStaleChunkError(error) && reloadAllowedNow() };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught:', error, info);
    // Stale chunk after a deploy: reload for the new bundle instead of
    // showing the error screen.
    if (isStaleChunkError(error)) reloadForStaleChunk();
  }

  handleReload = () => {
    // Clear error state and attempt a soft reload of the route.
    this.setState({ hasError: false, error: null, reloading: false });
    if (typeof window !== 'undefined') window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      if (this.state.reloading) {
        // A new version shipped while this tab was open; componentDidCatch already
        // fired the reload. Render nothing instead of a visible "error" card — the
        // reload lands well under a second, and a blank frame reads as an ordinary
        // navigation instead of a jarring crash-and-recover flash.
        return null;
      }
      // /admin and the partner portal get Scout's "we'll be right back" page with the last known reason.
      if (typeof window !== 'undefined' && /^\/(admin|partner)(\/|$)/.test(window.location.pathname)) {
        return <OutageScreen error={this.state.error} onRetry={this.handleReload} />;
      }
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-md w-full text-center space-y-4">
            <AlertTriangle className="w-12 h-12 text-destructive mx-auto" />
            <h1 className="text-2xl font-semibold">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              The page hit an unexpected error. Reloading usually fixes it. If it keeps
              happening, please let us know.
            </p>
            {this.state.error?.message && (
              <pre className="text-xs text-left bg-muted p-3 rounded overflow-auto max-h-40">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex gap-2 justify-center pt-2">
              <Button onClick={this.handleReload}>Reload</Button>
              <Button variant="outline" onClick={() => { window.location.href = '/'; }}>
                Back to home
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
