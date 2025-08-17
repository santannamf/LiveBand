# Live Band App — Data Governance Policy

**Version:** 1.0  
**Owner:** Data Owner (App owner/developer)  
**Steward:** App Admin (App owner/developer)
**Approved by:** App creator/owner/developer
**Last updated:** 2025-08-17

## 1. Purpose & Scope
This policy governs the data used by the Live Band App, a Progressive Web App (PWA) that enables audience song requests, ranking, and band set management in near real time. It applies to all datasets, environments, and processes described in the System Design Doc and Data Dictionary.

---

## 2. Roles & Accountability
- **Data Owner (App owner/developer):** ultimate accountability for the song catalog, vote/played records, retention and disclosure decisions.
- **Data Steward (App owner/developer):** day‑to‑day data quality oversight, catalog curation, access provisioning, configuration of Firebase rules, and incident response.
- **Developers/Maintainers:** implement controls, fixes, and enhancements under change management.
- **End Users (Audience):** select songs, submit votes; do not provide personal data; respect fair‑use.
- **Band Members:** mark songs as played; optionally manage locks (Top‑2).

---

## 3. Data Classification - Data Security, Privacy
- **Public:** Static catalog metadata (`songs.json`): song IDs, titles, artists, keywords, PPSX links intended for public consumption.
- **Internal (Operational):** Firestore collections (`votes`, `played`, `state/locks`, `settings`). Contains event timestamps and song IDs. No PII is collected by default.
- **Confidential (if enabled):** Any optional identifiers (e.g., hashed anonymous IDs, band PINs). Avoid storing emails/IPs; if collected, treat as Confidential and minimize/obfuscate.

**PII Principle:** The app should operate **without PII**. If a future feature needs PII, a DPIA (privacy impact assessment) must be performed.

---

## 4. Data Architecture & Integration
- **Authoritative sources:**
  - **Catalog:** `songs.json` (public, versioned). Optionally generated via Power Automate from OneDrive folder contents + Excel overrides.
  - **Operational Events:** Firestore (`votes`, `played`) with optional `state/locks` doc.
- **External systems:** OneDrive (PPSX storage), Cloudflare Pages (hosting), optional Power Automate (folder watch / catalog generation).
- **Interfaces:** Client reads `songs.json`, writes votes/played to Firestore. Optional flows update `songs.json` upon PPSX changes.

---

## 5. Data Quality
**Dimensions & Targets**
- **Completeness:** Every PPSX must have a catalog record (ID, title, artist, link). Target: 100%.
- **Consistency:** Filenames and IDs are slugified (lowercase, `_`, no accents); titles retain accents for display. Target: 100%.
- **Validity:** Links resolve to existing PPSX files. Target: 99.9%.
- **Timeliness:** New PPSX reflected in `songs.json` within 5 minutes of upload. Target: 95%.
- **Uniqueness:** One record per PPSX ID. Target: 100%.

**Controls**
- Catalog build pipeline validates required fields.
- Lint script for slugs/accents before publish.
- Broken link check (periodic).

---

## 6. Metadata & Reference Data
- **Metadata:** keywords, tags, genre, era are maintained as part of the catalog; documented in the Data Dictionary.
- **Master data:** Song titles/artists are treated as master attributes—canonical across UI, votes, and played logs.

---

## 7. Security & Access
- **Catalog (`songs.json`):** public read; write restricted to Owners/Stewards via CI/Power Automate.
- **Firestore:**
  - `votes`: public create; read for aggregation; no update/delete.
  - `played`: restricted create via band console; read for status.
  - `state/locks`, `settings`: write restricted to Steward; read for clients.
- **Secrets:** Only client‑safe Firebase keys in the app. No service accounts committed to Git. No secrets in repo (enforced by `.gitignore`).

---

## 8. Lifecycle & Retention
- **Catalog:** versioned indefinitely (lightweight JSON).
- **Votes:** keep rolling 90 days for analytics; aggregate counts may be retained longer; raw events older than 90 days can be purged. App owner may reset it.
- **Played:** retain 5 years for set history and 'most popular songs' analytics; older entries may be archived or purged.
- **Backups:** Firestore export optional for monthly snapshots if critical.

---

## 9. Monitoring & Incident Management
- **Monitoring:** Client metrics (errors), periodic catalog link checks.
- **Incidents:** Steward triages. For broken links or ranking anomalies, rollback to last known good `songs.json` or disable voting temporarily.
- **Change freeze:** On live shows, feature toggles lock Top‑2 to prevent reordering.

---

## 10. Change Management
- GitHub Pull Requests, code review, tagged releases.
- Versioned `songs.json`; changes logged in `CHANGELOG.md`.
- Emergency fixes follow hotfix branches and post‑mortem review.

---

## 11. Compliance & Auditability
- No PII by default; therefore, low regulatory impact.
- If PII is introduced, apply privacy notice, consent, minimization and retention rules; document lawful basis.
    - In case audience wants to share their names, they'll be prompted to accept a personal data sharing agreement for the sole use of app usage. A separate permission (optional) for personal data shared (audience names) in social media may also be presented to the users for acceptance or rejection.
- Audit fields: timestamps in `votes`/`played`; commit history for catalog.

---

## 12. Policy Review
- Reviewed upon material change (architecture, data collection, or hosting). 
- Steward proposes updates; Owner approves.
