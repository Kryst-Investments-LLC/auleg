# Dashboard Error & Empty-State Audit

Audit of how the React dashboard (`dashboard/src/*Page.js`) handles API failures
and empty data. Done as part of the launch-readiness pass.

## What's already good

- **Root render crashes** are caught by `ErrorBoundary` (wired in `index.js`),
  which now hides raw error text in production (dev still sees it).
- **Mutations / user actions** surface failures: the common pattern is
  `catch (err) { alert('Failed: ' + err.message); }`. Functional (if visually
  unpolished) — the user knows the action failed.
- **Critical-path empty states exist** and are covered by
  `e2e/error-states.spec.js`: auth errors (`.auth-error`), the empty audit list
  (`.empty-state` + upload CTA), and `components.js` empty states
  ("All required clauses detected", "No remediation needed").

## The gap — silent data-load failures

Initial data loads use `catch {}` (swallow). When a page's load fails (server
down, 500, network blip, expired session mid-session), the page renders **empty
with no feedback** — indistinguishable from "no data yet." The user cannot tell
"you have no webhooks" from "we failed to load your webhooks."

**33 silent `catch {}` blocks across 7 pages:**

| Page | Silent catches | Priority |
|------|---------------:|----------|
| `SettingsPage.js` | 14 | High (webhooks, templates, API keys, prefs, integrations) |
| `AdminPage.js` | 9 | High (stats, users, activity, audit logs) |
| `AuditPage.js` | 6 | Medium (the main page — some loads guarded, some not) |
| `OrgPage.js` | 1 | Medium |
| `BillingPage.js` | 1 | Medium (billing data silently empty is confusing) |
| `AnalyticsPage.js` | 1 | Low |
| `ApiExplorerPage.js` | 1 | Low |

## Recommended fix pattern

Give each page a load-error state and render a dismissible banner. Minimal,
per-page change:

```jsx
const [loadError, setLoadError] = useState(null);

useEffect(() => {
  (async () => {
    try {
      setLoadError(null);
      setData(await fetchX());
    } catch (e) {
      setLoadError(e.message || 'Failed to load. Please retry.');
    }
  })();
}, []);

// near the top of the page body:
{loadError && (
  <div className="error-banner" role="alert">
    {loadError} <button onClick={reload}>Retry</button>
  </div>
)}
```

A shared `<LoadError onRetry/>` component in `components.js` + a `.error-banner`
style would keep this consistent across pages.

## Why this wasn't auto-fixed in the isolation/hardening pass

The dashboard has **no unit tests** (Jest covers the server only; Playwright is a
pre-PR full-stack gate). Refactoring load/error state across 13 untested pages on
a live system risks white-screen regressions that nothing would catch
pre-deploy. The fix is mechanical but should be verified by running the dashboard
(or expanding `e2e/error-states.spec.js` to assert a load-error banner) before
shipping. Tracked here as a prioritized follow-up.

## Done in this pass

- `ErrorBoundary.js`: production no longer renders raw error messages to users
  (parity with the backend's "don't leak internal details" policy); dev keeps
  full messages for debugging.
