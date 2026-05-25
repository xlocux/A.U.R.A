# Linux Runtime

A.U.R.A is expected to run on a Linux host. Environment checks, tool installation, AI CLI checks, recon tools, screenshots, proxy-aware runs, and follow-up runs execute local Linux commands directly.

## Start

```bash
npm test
npm run web
```

Open `http://127.0.0.1:31338`.

## Notes

- Use `Settings > Environment` to check and install local tools.
- Legacy runtime fields may still exist in API payloads for compatibility, but they should resolve to the local Linux runtime.
- Tool stdout and stderr are still stored as evidence artifacts before parsing.
