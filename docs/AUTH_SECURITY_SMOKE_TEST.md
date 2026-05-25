# Auth and Security Smoke Test

This checklist covers the current cookie-based Web UI authentication flow and the Security/Topology/Logs smoke checks after auth-related changes.

## Scope

A.U.R.A uses a local Web UI control plane for authorized recon workflows. The UI must keep the AI-assisted recon context aware of current target/run state while avoiding client-side session secret exposure.

## Auth expectations

- `/api/auth/login` sets the `aura_session` cookie with `HttpOnly`, `SameSite=Lax`, `Path=/`, and a bounded `Max-Age`.
- `/api/auth/login` returns only non-secret JSON such as `authenticated` and `username`.
- The login page uses `login-cookie.js` and does not store a session token in `localStorage`.
- `auth-persistence.js` must not depend on `localStorage` for authentication.
- `/api/auth/status` should rely on the cookie/session lookup and keep the UI login persistence stable across reloads.
- `/api/auth/logout` clears the cookie and removes the stored session.

## Manual smoke checks

1. Run the Web UI locally:

   ```powershell
   npm run web
   ```

2. Open `http://127.0.0.1:31338` and log in with the configured local account.
3. In browser developer tools, confirm the login response JSON does not contain `sessionKey`.
4. Confirm the response includes a `Set-Cookie` header for `aura_session` with `HttpOnly`.
5. Reload the page and confirm the authenticated UI persists through `/api/auth/status`.
6. Confirm `localStorage` does not contain `aura.authToken` after login.
7. Open `Settings > Security` and verify the Security tab click target works.
8. Open `Topology` and verify stable chart sub-tabs render without breaking the surrounding recon context.
9. Open `Runs & Logs` and verify unified logs render current run events, warnings, retries, and completion state.
10. Ask the AI assistant about the current target/run context and verify it answers from available A.U.R.A context instead of inventing target facts.
11. Log out and confirm authenticated API routes return `Authentication required` or redirect back to login as expected.

## Notes

- This is a smoke checklist, not a replacement for `npm test`.
- Active recon remains gated by explicit authorization.
- Candidate assets remain review leads until the operator adds them to authorized scope.
