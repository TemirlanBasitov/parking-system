import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { registerAccountRoutes } from "./routes/account.js";
import { registerAuthRoutes } from "./routes/auth.js";

export function createApp(pool: Pool) {
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

    const authRouter = express.Router();
    registerAuthRoutes(authRouter, pool);
    app.use("/api/auth", authRouter);

    const accountRouter = express.Router();
    registerAccountRoutes(accountRouter, pool);
    app.use("/api/account", accountRouter);

    app.use(
        (
            error: unknown,
            _request: Request,
            response: Response,
            _next: NextFunction
        ) => {
            console.error("Unhandled request error:", error);

            response.status(500).json({
                error: "INTERNAL_SERVER_ERROR",
                message: "An unexpected server error occurred."
            });
        }
    );

    return app;
}