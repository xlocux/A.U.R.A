# Automated Proxy Import Workflow

A.U.R.A proxy setup for `https://github.com/xlocux/A.U.R.A.git` separates two different concepts:

- **Proxy pool automation**: import, test, clean, and quality-rank proxy candidates.
- **Upstream proxy routing**: decide whether recon tools should actually route through the selected proxy route.

This separation keeps the UI clear: building a healthy pool is not the same as enabling proxy routing for recon tools.

## UI flow

1. Open `Settings > Proxy`.
2. Use the `Proxy pool automation` area and click `Import to Pool`.
3. Either paste proxies manually or click `Import from Proxifly` to load the Proxifly list into the textarea.
4. Review or edit the textarea.
5. Click `Import and Preflight`.

A.U.R.A then automatically runs:

```text
import list -> protocol preflight -> cleanup failed/slow proxies -> rank best pool -> enable top route for recon runs
```

The old separate setup steps were removed because they caused redundant clicks and could trigger duplicate preflight runs.

## Upstream proxy routing

The `Upstream proxy routing` section shows the current selected route and the enable switch for recon tools. It is separate from the import/preflight pool controls.

After the automated workflow completes, A.U.R.A writes the top-ranked healthy proxy into the upstream routing fields and enables it for runs. The full ranked pool remains in the server-side proxy store and is used by runtime proxy rotation.

## Best pool behavior

`Use best` no longer means only one proxy exists. The UI enables the top route for visibility and local settings, while the runtime builds a quality-ranked pool from the best healthy proxies.

The runtime ranks by:

1. preferred configured route, when valid;
2. success rate;
3. latency.

During recon, A.U.R.A starts with the top-ranked route and rotates to the next route in the ranked pool when a proxy/network failure is detected.

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

The proxy workflow is intentionally explicit about state transitions so the AI assistant and operator can understand whether A.U.R.A is importing, preflighting, cleaning, ranking, selecting, enabling routing, or rotating at runtime. This keeps proxy setup observable without adding manual steps.
