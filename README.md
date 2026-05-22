# A.U.R.A

A.U.R.A is a local **Recon & Discovery** dashboard for authorized bug bounty and security research scopes.

The project is intentionally scoped to recon for now. Agentic analysis, triage, reporting, and LLM-assisted reasoning will be added later as separate layers.

## What It Does

- Manage target configuration from the web UI.
- Run recon in three modes:
  - `single`: one domain.
  - `list`: a user-provided list of domains.
  - `full`: seed domains plus asset discovery, passive sources, brute force, HTTP probing, URL mining, and screenshots.
- Persist discovered data in local SQLite:
  - domains and subdomains
  - asset leads
  - archived URLs, paths, and parameters
  - HTTP services, status codes, titles, servers, technologies
  - screenshot run outputs
  - API key metadata
  - wordlist metadata
- Run WSL/Kali tools through an allowlisted command runner.
- Generate small derived wordlists from the local DB instead of storing large wordlist contents in SQLite.

## Quick Start

```powershell
npm test
npm run web
```

Open:

```text
http://127.0.0.1:31338
```

Create targets from the `Target` tab in the browser. Target setup, scope edits,
API keys, wordlists, recon runs, and results are all managed from the Web UI.

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
2. Optional Reverse WHOIS asset discovery.
3. Certificate transparency and passive sources.
4. Passive subdomain enumeration via tools such as `subfinder` and `amass`.
5. Optional brute force with `shuffle-dns` using the active `domains` wordlist.
6. DNS validation with `dnsx` / `puredns`.
7. URL mining with `gau`.
8. HTTP probing and tech detection with `httpx`.
9. Screenshot collection with `aquatone` or `EyeWitness`.

## WSL/Kali Tools

The WSL runner only allows known recon tools:

- `subfinder`
- `amass`
- `dnsx`
- `puredns`
- `shuffle-dns`
- `gau`
- `httpx`
- `aquatone`
- `eyewitness`

The default distro name is `kali-linux`, configurable from the UI.

## API Keys

API keys are stored locally in SQLite and masked in API/UI responses.

Current provider:

- `whoisxmlapi` for Reverse WHOIS.

The runtime selects the first active key for the provider whose usage is below its configured limit.

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

and that directory is ignored by Git.

## Current Commands

```powershell
npm test
npm run web
```

## Safety Model

A.U.R.A is for authorized scopes only. The UI requires explicit authorization confirmation before starting recon or asset discovery.

Keep target scope current in the `Target` tab before running scans.
