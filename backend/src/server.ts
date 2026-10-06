import "dotenv/config";

import { Pool } from "pg";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    throw new Error("DATABASE_URL is required. Copy .env.example to .env.");
}

const pool = new Pool({ connectionString: databaseUrl });

async function start() {
    const client = await pool.connect();

    try {
        await client.query("SELECT 1");
    } finally {
        client.release();
    }

    const app = createApp();

    app.listen(port, () => {
        console.log(`Parking backend is running on http://localhost:${port}`);
    });
}

start().catch((error: unknown) => {
    console.error("Unable to start backend:", error);
    process.exit(1);
});
