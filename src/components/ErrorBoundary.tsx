import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

// ── Stale-chunk self-heal (shared with main.tsx) ────────────────────────────
// After a deploy, tabs holding the old index.html request chunk hashes that
// no longer exist. Reload pulls the fresh index.html. The guard is
// time-based (not once-per-session) so the tab heals after EVERY deploy,
// while still preventing refresh loops when the failure is real.
const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Loading chunk \S+ failed|ChunkLoadError|Importing a module script failed/i;
const RELOAD_AT_KEY = 'bestly:chunk-reloaded-at';
const MIN_RELOAD_INTERVAL_MS = 15_000;

export function isStaleChunkError(reason: unknown): boolean {
  const msg = String((reason as Error | undefined)?.message ?? reason ?? '');
  return CHUNK_ERROR_RE.test(msg);
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
}

/**
 * Top-level error boundary. Prevents a component error from white-screening
 * the whole app. Keep this lean so it renders even if imports break.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
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
    this.setState({ hasError: false, error: null });
    if (typeof window !== 'undefined') window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
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
