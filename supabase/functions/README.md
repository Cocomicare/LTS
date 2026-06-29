# Supabase Edge Functions — source backup

These two functions are deployed directly to Supabase (project ref
`osasglxowihoygidhgwc`) and were **not previously tracked in this repo** —
this folder exists purely as a version-controlled source-of-truth backup.

| Function            | Used by                                                              |
|----------------------|-----------------------------------------------------------------------|
| `extract-labs`       | Generic Anthropic proxy. Called by `labs.html`, `medications.html` (list extraction), and `clinical_assistant.html` (uploaded document summarization). |
| `clinical-assistant` | Powers the Clinical Assistant chat. Read-only — gathers recent rows across every tracking table and forwards the question to Anthropic. |

Both functions share the same `ANTHROPIC_API_KEY` secret — no new secret
needed when adding either one.

## Deploying

```bash
supabase functions deploy extract-labs --project-ref osasglxowihoygidhgwc
supabase functions deploy clinical-assistant --project-ref osasglxowihoygidhgwc
```

## Keeping this folder in sync

There is currently no CI step that pushes from Supabase → this repo, or
this repo → Supabase. If you edit a function in the Supabase Dashboard's
inline editor, **copy the change back into this folder manually** (or vice
versa if you edit here and deploy via CLI) — otherwise this backup will
drift out of date silently.
