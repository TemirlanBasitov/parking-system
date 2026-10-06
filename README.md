# Parking with billing

An educational client-server application for paid parking.

Drivers will be able to manage vehicle numbers, reserve places, enter and exit
through a simulated barrier, and view parking visits and invoices.

## Stack

- Backend: Node.js, TypeScript, Express
- Database: PostgreSQL
- Local database: Docker Compose
- Frontend: planned — React or Vue
- Real-time updates: planned — Socket.IO

## Current project state

Implemented:

- PostgreSQL Docker Compose configuration;
- initial database schema;
- ten seeded parking spaces;
- backend database connection check;
- `GET /api/health`;
- TypeScript and HTTP smoke checks.

Not implemented yet:

- authentication and driver profile;
- vehicle-management endpoints;
- reservation endpoints;
- barrier simulator;
- tariff and invoice calculation;
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

Install dependencies and create local environment configuration:

cd backend
npm install
cp .env.example .env

Run validation:

npm run typecheck
npm run smoke

Start the backend:
npm run dev