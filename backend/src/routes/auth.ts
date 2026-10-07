import bcrypt from "bcryptjs";
import type { Router } from "express";
import { z } from "zod";
import { createAccessToken } from "../auth.js";
import type { Pool } from "pg";

const credentialsSchema = z.object({
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(72)
});

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

export function registerAuthRoutes(router: Router, pool: Pool) {
    router.post("/register", async (request, response, next) => {
        try {
            const input = credentialsSchema.parse(request.body);
            const email = normalizeEmail(input.email);

            const passwordHash = await bcrypt.hash(input.password, 12);

            const result = await pool.query<{
                id: string;
                email: string;
                created_at: Date;
            }>(
                `
          INSERT INTO users (email, password_hash)
          VALUES ($1, $2)
          RETURNING id, email, created_at
        `,
                [email, passwordHash]
            );

            const user = result.rows[0];
            const token = createAccessToken({ userId: user.id, email: user.email });

            response.status(201).json({
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    createdAt: user.created_at
                }
            });
        } catch (error) {
            if (error instanceof z.ZodError) {
                response.status(400).json({
                    error: "VALIDATION_ERROR",
                    message: "Provide a valid email and a password of at least 8 characters."
                });
                return;
            }

            if (
                typeof error === "object" &&
                error !== null &&
                "code" in error &&
                error.code === "23505"
            ) {
                response.status(409).json({
                    error: "EMAIL_ALREADY_REGISTERED",
                    message: "An account with this email already exists."
                });
                return;
            }

            next(error);
        }
    });

    router.post("/login", async (request, response, next) => {
        try {
            const input = credentialsSchema.parse(request.body);
            const email = normalizeEmail(input.email);

            const result = await pool.query<{
                id: string;
                email: string;
                password_hash: string;
            }>(
                `
          SELECT id, email, password_hash
          FROM users
          WHERE email = $1
        `,
                [email]
            );

            const user = result.rows[0];
            const passwordMatches =
                user !== undefined &&
                (await bcrypt.compare(input.password, user.password_hash));

            if (!passwordMatches || !user) {
                response.status(401).json({
                    error: "INVALID_CREDENTIALS",
                    message: "Email or password is incorrect."
                });
                return;
            }

            const token = createAccessToken({ userId: user.id, email: user.email });

            response.status(200).json({
                token,
                user: {
                    id: user.id,
                    email: user.email
                }
            });
        } catch (error) {
            if (error instanceof z.ZodError) {
                response.status(400).json({
                    error: "VALIDATION_ERROR",
                    message: "Provide a valid email and a password of at least 8 characters."
                });
                return;
            }

            next(error);
        }
    });
}
