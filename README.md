# A.U.R.A

A.U.R.A is a local **Asset Unveiling & Reconnaissance Automation** dashboard for authorized bug bounty and security research scopes.

The project is intentionally scoped to recon for now. Agentic analysis, triage, reporting, and LLM-assisted reasoning will be added later as separate layers.

## What It Does

- Manage domain recon targets from the web UI.
- Run recon in three modes:
  - `single`: one domain.
  - `list`: a user-provided list of domains.
  - `full`: seed domains plus provider discovery, passive sources, brute force, HTTP probing, URL mining, and screenshots.
- Persist discovered data in local SQLite:
  - domains and subdomains
  - asset leads
  - archived URLs, paths, and parameters
  - HTTP services, status codes, titles, servers, technologies
  - screenshot run outputs
  - API key metadata
  - wordlist metadata
- Restore the selected target and latest saved run after a browser refresh.
- Pause, resume, or cancel long-running recon runs from the browser.
- Export collected run data as JSON, CSV, or Markdown.
- Automatically compact duplicate observations in UI views, topology, exports,
  and generated wordlists while preserving source evidence.
- Inspect current run activity, tool heartbeats, and topology node details from
  the Web UI.
- Run WSL/Kali tools through an allowlisted command runner.
- Generate small derived wordlists from the local DB instead of storing large wordlist contents in SQLite.
- Generate smart domain wordlists from observed subdomain naming patterns.

## Quick Start

```powershell
npm test
npm run web
```

A.U.R.A requires Node.js 24 or newer.

Open:

```text
http://127.0.0.1:31338
```

Start from `Settings > Environment` to check the Linux runtime, install
OpenCode, and install/update recon tools. Create domain targets from the
`Recon` tab in the browser. Target setup, scope edits, API keys, wordlists,
recon runs, and results are all managed from the Web UI.

Targets can be deleted from the `Recon` tab. Deleting a target removes its local
target config, runs, observations, leads, and run artifact folders.

Recommended first run:

1. Open `Settings > Environment` and run `Install / Update Tools`.
2. Add optional keys in `Settings > API Keys`.
3. Confirm authorized scope when you are allowed to enumerate the target.
4. Create a target in `Recon`.
5. A.U.R.A automatically starts a target bootstrap run:
   - Domains and wildcards such as `*.example.com` are normalized to root
     domains.
   - An intel phase expands likely alternate TLDs for the same registrable
     label.
   - RDAP/WHOIS is inspected for target-related terms.
   - Associated RDAP domains such as target-owned nameservers are collected.
   - Useful Reverse WHOIS terms and associated domains are proposed in the run
     log; if none are found, A.U.R.A says so explicitly.
   - Brand terms from the root domains are used as fallback Reverse WHOIS terms
     when RDAP does not provide useful organization data.
   - WhoisXMLAPI Reverse WHOIS expansion runs when an active API key exists.
   - Out-of-scope domains are filtered out.
   - The resulting root, alternate-TLD, RDAP, and provider-discovered seeds feed
     the enumeration pipeline when authorized scope is confirmed.
6. Review `Runs & Logs`, `Results`, `Search`, and `Topology`.

Browser refreshes do not discard run results. When the Web UI reloads, A.U.R.A
selects the last active target when possible and reloads that target's latest
saved run, including events, domains, HTTP services, artifacts, and topology.
Topology controls redraw the latest loaded run data instead of discarding the
current graph state.

Run controls are cooperative. Pause and cancel requests are honored between
recon phases and tool invocations; a tool process that is already running may
finish before the run stops.

Exports are available from the `Results` tab for the loaded run. The topology
view supports zoom controls and node inspection for domains, HTTP services,
URLs, and screenshot artifacts.

If authorized scope is not confirmed, A.U.R.A still performs passive RDAP/WHOIS
bootstrap checks but does not start active enumeration.

The Web UI requires login. The first local user defaults to:

```text
locu / locu
```

The user is stored locally in SQLite with a password hash. To override the
initial password before the first server start, set:

```powershell
$env:AURA_WEB_PASSWORD="change-me"
npm run web
```

The server binds to `127.0.0.1` by default. Use `--host 0.0.0.0` only when you
intentionally expose it on a trusted network, and change the default login first.

## Project Layout

```text
public/web/              Web dashboard HTML/CSS/JS
scripts/                 Web server entrypoint
src/core/                JSON IO and target config validation
src/db/                  SQLite store
src/recon/               Recon engine, parsers, WSL tool runner, wordlist generation
src/recon/providers/     External recon providers such as WhoisXMLAPI
src/web/                 Local HTTP server and API routes
tests/                   Node test suite
data/                    Local DB and generated artifacts, ignored by Git
targets/                 Local target configs and per-target state
```

## Recon Modes

### Single Domain

Use this when you want a controlled scan against exactly one domain.

### Domain List

Use this for known in-scope domains pasted into the UI.

### Full Recon

Full recon currently performs:

1. Seed domain normalization.
2. Optional provider discovery, starting with RDAP/WHOIS term suggestions and WhoisXMLAPI Reverse WHOIS, and designed for Censys, Shodan, Rapid7, JavaScript, endpoint, history, and parameter adapters.
3. Certificate transparency and passive sources.
4. Passive subdomain enumeration via tools such as `subfinder` and `amass`.
5. Optional brute force with `shuffle-dns` using the active `domains` wordlist.
6. DNS validation with `dnsx` / `puredns`.
7. URL mining with `gau`.
8. HTTP probing and tech detection with `httpx`.
9. Screenshot collection with `aquatone` or `EyeWitness`.

## WSL/Kali Tools

When A.U.R.A runs on Windows, it uses the selected WSL distro. When A.U.R.A runs
inside WSL/Linux, setup and tool checks run natively in that Linux environment.

The environment setup lives in `Settings > Environment`. It installs system
prerequisites first, then OpenCode, then recon tools declared in the tool
registry. Install stdout and stderr are shown in the setup log so failed tool
bootstrap steps can be debugged from the browser.

Linux prerequisites installed by setup include:

- `ca-certificates`
- `curl`
- `git`
- build tools
- `unzip`
- `tar`
- `jq`
- Go
- Node.js 24 on apt-based systems
- DNS utilities
- SecLists when available from the package manager

The initial tool registry includes:

- `subfinder`
- `dnsx`
- `gau`
- `httpx`
- `katana`
- `naabu`
- `nuclei`
- `gowitness`

The default distro name is `kali-linux`, configurable from the UI.

## API Keys

API keys are optional, stored locally in SQLite, and masked in API/UI responses.

Current providers:

- `openrouter` for AI chat when `Settings > AI Agent` selects OpenRouter.
- `shodan` for host intelligence when provider enrichment is enabled.
- `censys` for internet intelligence when provider enrichment is enabled.
- `securitytrails` for DNS intelligence when configured.
- `chaos` for ProjectDiscovery Chaos subdomain data when configured.
- `github` for code search when configured.
- `whoisxmlapi` for Reverse WHOIS.

The runtime selects the first active key for the provider whose usage is below its configured limit.

`Settings > AI Agent` can use OpenCode, Codex CLI, Claude Code CLI, OpenRouter,
or a direct local OpenAI-compatible endpoint such as Ollama. The page shows
runtime availability and the current redacted OpenCode config when it can be
read from the selected Linux environment. The OpenRouter model preset list is
loaded from OpenRouter's model metadata when available and falls back to bundled
free presets if the network request fails.

## Wordlists

Large wordlists are not stored in the DB. A.U.R.A stores only metadata:

- name
- category
- filesystem path
- status
- notes

Supported categories:

- `domains`
- `technologies`
- `payloads`
- `paths`
- `params`

Generated wordlists are written to:

```text
data/wordlists/generated/
```

The `smart-domains` generated category uses collected subdomains to infer likely
environment, service, and region naming patterns. It is intended for later
controlled subdomain permutation or brute-force phases.

and that directory is ignored by Git.

After environment setup, A.U.R.A registers default SecLists metadata when those
paths are available in the Linux environment:

- `/usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt`
- `/usr/share/seclists/Discovery/Web-Content/common.txt`
- `/usr/share/seclists/Discovery/Web-Content/raft-small-words.txt`

## Current Commands

Check the runtime first:

```powershell
node --version
```

Use Node.js 24 or newer.

```powershell
npm test
npm run web
```

## Safety Model

A.U.R.A is for authorized scopes only. The UI requires explicit authorization confirmation before starting recon or provider discovery.

Keep target scope current in the `Recon` tab before running scans.
