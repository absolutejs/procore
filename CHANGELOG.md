# Changelog

## 0.2.0 — 2026-10-07

- Require `timeHour` and `timeMinute` when creating delivery logs, matching Procore requirements. Callers upgrading from 0.1 must supply the reviewed local delivery time.
- Add upload IDs to delivery payloads, attachment receipt identities without signed URLs, and bounded direct file uploads without forwarding OAuth credentials.
- Add caller cancellation for API and storage requests.

## 0.1.0 — 2026-10-07

- Add typed Procore catalogs and delivery-log reads/creation.
- Bound transport and pagination, preserve company/project scoping, and report uncertain writes without automatic retries.
