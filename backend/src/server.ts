import "dotenv/config";

import { createApp } from "./app.js";
import { pool } from "./db.js";

const port = Number(process.env.PORT ?? 3000);

async function start() {
    await pool.query("SELECT 1");

    const app = createApp(pool);

    app.listen(port, () => {
        console.log(`Parking backend is running on http://localhost:${port}`);
    });
}

start().catch((error: unknown) => {
    console.error("Unable to start backend:", error);
    process.exit(1);
});
