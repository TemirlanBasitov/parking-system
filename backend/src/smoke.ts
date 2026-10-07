import "dotenv/config";

import { createApp } from "./app.js";
import { pool } from "./db.js";

const app = createApp(pool);

const server = app.listen(0, "127.0.0.1", async () => {
    try {
        const address = server.address();

        if (!address || typeof address === "string") {
            throw new Error("Could not determine test server address.");
        }

        const response = await fetch(
            `http://127.0.0.1:${address.port}/api/health`
        );

        const body = (await response.json()) as { status?: string };

        if (!response.ok || body.status !== "ok") {
            throw new Error(`Unexpected health response: ${JSON.stringify(body)}`);
        }

        console.log("Smoke check passed: GET /api/health returned status=ok.");
    } finally {
        server.close();
        await pool.end();
    }
});
