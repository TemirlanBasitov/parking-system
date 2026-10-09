# Parking with billing

An educational client-server application for paid parking.

Drivers can manage vehicle numbers, reserve places, enter and exit through a
simulated barrier, and view parking visits and invoices.

## Stack

- Backend: Node.js, TypeScript, Express
- Database: PostgreSQL
- Local database: Docker Compose
- Frontend: planned — React or Vue
- Real-time updates: planned — Socket.IO
- Authentication: email/password and JWT Bearer tokens

## Current project state

Implemented:

- PostgreSQL Docker Compose configuration;
- initial database schema and ten seeded parking spaces;
- backend health endpoint: `GET /api/health`;
- driver registration: `POST /api/auth/register`;
- driver login: `POST /api/auth/login`;
- authenticated profile endpoint: `GET /api/account/profile`;
- authenticated add/list vehicle endpoints:
  `POST /api/account/vehicles` and `GET /api/account/vehicles`;
- password hashing with bcrypt;
- JWT access tokens;
- TypeScript and HTTP smoke checks.
- - parking map endpoint: `GET /api/parking/map`;
- authenticated reservation list/create/cancel endpoints;
- PostgreSQL exclusion constraint preventing overlapping booked reservations;
- barrier simulator entry with reserved-space claim or automatic allocation;
- barrier simulator exit with day/night tariff invoice calculation;
- authenticated parking visit and invoice history endpoint;
- active-visit uniqueness safeguards for both vehicle plates and parking spots;

Not implemented yet:

- reservation expiration and email reminder;
- real-time updates;
- frontend.

## Prerequisites

- Node.js 22+
- npm
- Docker Desktop

## Local startup

Start PostgreSQL from the repository root:

```zsh
docker compose up -d
