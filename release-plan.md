# Live Band App — Release Plan

**Version:** 1.0  
**Owner:** App Admin  
**Last updated:** 2025-08-17

## Roadmap Overview
- **MVP (v0.1):** Search + Vote + Band Console (Locked Top‑2), manual `songs.json`.
- **v0.9 RC:** Power Automate catalog pipeline; basic analytics; polish UI.
- **v1.0:** Public PWA launch; docs complete; stability improvements.
- **Post‑v1:** Optional OneDrive automation (move/copy files), moderation tools.

---

## MVP (v0.1) — Scope & Acceptance
**Scope**
- Static PWA on Cloudflare Pages.
- `songs.json` loaded client‑side.
- Three search modes (song/artist/keywords) via Fuse.js.
- Firestore `votes` write; client ranking w/ Locked Top‑2.
- Band console to mark `played` and promote next.
- Basic Governance docs and `.gitignore` in repo.

**Acceptance Criteria**
- Search returns expected results under 300 ms on mid‑range phone.
- Locked Top‑2 never changes due to late votes.
- Marking played updates UI within 1 second.
- No PII stored; Firestore rules deployed.
- Lighthouse PWA score ≥ 90.

**Risks**
- Catalog drift: manual updates required in early phase.
- Vote spam: UI throttling only.

---

## v0.9 Release Candidate — Scope & Acceptance
**Scope**
- Power Automate (or GitHub Action) builds `songs.json` from OneDrive.
- Excel override sheet for display names/tags.
- “Popular now” and simple charts (client‑side aggregation).
- Error toasts for broken PPSX links.

**Acceptance Criteria**
- New PPSX appears in app within 5 minutes.
- Catalog validation passes (uniqueness, required fields).
- Charts render under 500 ms on mid‑range phone.

**Risks**
- Free‑tier automation limits; add retry/backoff.

---

## v1.0 — Public Launch
**Scope**
- Docs complete (Governance, Design, Dictionary, Release Plan).
- Analytics (privacy‑safe) and error logging.
- Theming/polish, install prompts, icon set.

**Acceptance Criteria**
- Zero critical errors during a live 2‑hour set.
- PWA install tested on iOS and Android.
- Page weight under 200 KB (gzip) excluding JSON.

**Risks**
- Unexpected traffic spikes: verify Firestore quotas; implement basic caching for catalog.

---

## Change Management & Versioning
- Semantic versions (vMAJOR.MINOR.PATCH).
- `CHANGELOG.md` updated per release.
- Tag releases and keep Pages deployments for rollback.

## Rollback Plan
- Revert to prior commit on Cloudflare Pages.
- Restore previous `songs.json` version.
- Disable voting (feature flag) if needed.

## Post‑v1 Enhancements (Backlog)
- Band PIN / role‑based UI.
- Moderator review queue.
- “Set duration remaining” estimate.
- Offline vote queue for patchy connectivity.
- Optional Cloudflare Worker to aggregate votes server‑side.
