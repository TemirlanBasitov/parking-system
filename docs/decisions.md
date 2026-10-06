# Architecture decisions

## 2026-10-06 — Monorepo

The frontend and backend will live in one Git repository, but in separate
`frontend/` and `backend/` directories. They remain separate applications and
communicate only through HTTP and Socket.IO.

## 2026-10-06 — Backend stack

The backend uses Node.js, TypeScript and Express. TypeScript reduces errors in
date, tariff and payment calculations; Express is intentionally minimal for a
small educational service.

## 2026-10-06 — PostgreSQL

PostgreSQL is used as the relational database. In addition to transactions, it
supports an exclusion constraint that prevents overlapping reservations at the
database level, including simultaneous requests from two browser clients.

## 2026-10-06 — Money and time

All timestamps are stored as `TIMESTAMPTZ`. All money is stored as integer
kopeks, never as floating-point values. This prevents lost fractional amounts
when calculating invoices across day/night tariff boundaries.

## 2026-10-06 — External email service

Email reminders will be emulated by a local notification stub that writes a
message to the backend log. No external mail provider is required for local
development.