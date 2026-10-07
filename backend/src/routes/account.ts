import type { Router } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import {
    requireAuth,
    type AuthenticatedRequest
} from "../middleware/require-auth.js";

const vehicleSchema = z.object({
    plate: z.string().trim().min(2).max(16)
});

function normalizePlate(plate: string): string {
    return plate.trim().toUpperCase().replace(/\s+/g, " ");
}

export function registerAccountRoutes(router: Router, pool: Pool) {
    router.get(
        "/profile",
        requireAuth,
        async (request: AuthenticatedRequest, response, next) => {
            try {
                const result = await pool.query<{
                    id: string;
                    email: string;
                    created_at: Date;
                }>(
                    `
            SELECT id, email, created_at
            FROM users
            WHERE id = $1
          `,
                    [request.auth!.userId]
                );

                const user = result.rows[0];

                if (!user) {
                    response.status(404).json({
                        error: "USER_NOT_FOUND",
                        message: "Driver account was not found."
                    });
                    return;
                }

                response.status(200).json({
                    id: user.id,
                    email: user.email,
                    createdAt: user.created_at
                });
            } catch (error) {
                next(error);
            }
        }
    );

    router.get(
        "/vehicles",
        requireAuth,
        async (request: AuthenticatedRequest, response, next) => {
            try {
                const result = await pool.query<{
                    id: string;
                    plate: string;
                    created_at: Date;
                }>(
                    `
            SELECT id, plate, created_at
            FROM vehicles
            WHERE user_id = $1
            ORDER BY created_at ASC
          `,
                    [request.auth!.userId]
                );

                response.status(200).json({
                    vehicles: result.rows.map((vehicle) => ({
                        id: vehicle.id,
                        plate: vehicle.plate,
                        createdAt: vehicle.created_at
                    }))
                });
            } catch (error) {
                next(error);
            }
        }
    );

    router.post(
        "/vehicles",
        requireAuth,
        async (request: AuthenticatedRequest, response, next) => {
            try {
                const input = vehicleSchema.parse(request.body);
                const plate = normalizePlate(input.plate);

                const result = await pool.query<{
                    id: string;
                    plate: string;
                    created_at: Date;
                }>(
                    `
            INSERT INTO vehicles (user_id, plate)
            VALUES ($1, $2)
            RETURNING id, plate, created_at
          `,
                    [request.auth!.userId, plate]
                );

                const vehicle = result.rows[0];

                response.status(201).json({
                    id: vehicle.id,
                    plate: vehicle.plate,
                    createdAt: vehicle.created_at
                });
            } catch (error) {
                if (error instanceof z.ZodError) {
                    response.status(400).json({
                        error: "VALIDATION_ERROR",
                        message: "Vehicle plate must contain 2 to 16 characters."
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
                        error: "PLATE_ALREADY_REGISTERED",
                        message: "This vehicle plate is already registered."
                    });
                    return;
                }

                next(error);
            }
        }
    );
}
