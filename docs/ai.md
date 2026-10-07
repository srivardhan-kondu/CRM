# AI layer

Not implemented — scheduled for **Phase 10**, after the permissioned data model is stable.

Guardrails that Phase 0–9 code must preserve so the AI layer can be added safely:

- Authorization happens **before retrieval**: AI retrieval will call the same domain repositories (which take the
  session and apply scope) — never raw tables.
- Projections strip hidden fields before data leaves the server; AI context will be built from projections.
- Risk is already explainable (factor + rule + timestamp), so AI explanations can cite factors rather than invent.
- No AI write path to official records; any AI-proposed action becomes a draft in a human-approved workflow.
- Provider abstraction, prompt templates, rate limits, logging, evaluation set and grounding tests per PRD §13 / Phase 10.
