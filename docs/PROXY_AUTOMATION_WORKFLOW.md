# Automated Proxy Import Workflow

A.U.R.A proxy setup for `https://github.com/xlocux/A.U.R.A.git` is now a one-click workflow after the operator provides a proxy list.

## UI flow

1. Open `Settings > Proxy`.
2. Click `Import to Pool`.
3. Either paste proxies manually or click `Import from Proxifly` to load the Proxifly list into the textarea.
4. Review or edit the textarea.
5. Click `Import and Preflight`.

A.U.R.A then automatically runs:

```text
import list -> protocol preflight -> cleanup failed/slow proxies -> select best healthy proxy -> enable for recon runs
```

The old separate setup steps were removed because they caused redundant clicks and could trigger duplicate preflight runs.

## Accepted formats

The proxy parser accepts entries with or without a scheme:

```text
192.252.209.155:14455
http://192.0.2.10:8080
socks4://192.0.2.11:1080
socks5://192.0.2.12:1080
```

Entries without a scheme are inferred from known ports where possible and default to HTTP otherwise.

## Proxifly source

The modal button `Import from Proxifly` loads:

```text
https://github.com/proxifly/free-proxy-list/blob/main/proxies/all/data.txt
```

into the textarea only. It does not immediately import or preflight. This gives the operator a chance to review or edit the list before running the automated setup pipeline.

## Visual feedback

During preflight, the UI shows an active proxy workflow card and rotates through submitted candidates with messages such as:

```text
Testing proxy candidate 12/500: socks5://example:1080
```

This is a client-side progress indicator while the server performs protocol-aware batch preflight and cleanup.

## AI-aware behavior

The proxy workflow is intentionally explicit about state transitions so the AI assistant and operator can understand whether A.U.R.A is importing, preflighting, cleaning, selecting, or enabling proxy routing. This keeps proxy setup observable without adding manual steps.
