import cors from "cors";
import express from "express";

export function createApp() {
    const app = express();

    app.use(cors());
    app.use(express.json());

    app.get("/api/health", (_request, response) => {
        response.status(200).json({
            status: "ok",
            service: "parking-backend",
            timestamp: new Date().toISOString()
        });
    });

    return app;
}
