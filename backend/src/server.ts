import "dotenv/config";

import { createApp } from "./app.js";
import { pool } from "./db.js";
import { startReservationJobs } from "./services/reservation-jobs.js";

const port = Number(process.env.PORT ?? 3000);

async function start() {
    await pool.query("SELECT 1");

    const app = createApp(pool);
    const stopReservationJobs = startReservationJobs(pool);

    const server = app.listen(port, () => {
        console.log(`Parking backend is running on http://localhost:${port}`);
    });

    const shutdown = (signal: string) => {
        console.log(`${signal} received; stopping backend.`);

        stopReservationJobs();

        server.close(() => {
            void pool.end().finally(() => {
                process.exit(0);
            });
        });
    };

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((error: unknown) => {
    console.error("Unable to start backend:", error);
    process.exit(1);
});
