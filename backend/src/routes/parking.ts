import type { Router } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import {
    requireAuth,
    type AuthenticatedRequest
} from "../middleware/require-auth.js";

const reservationInputSchema = z.object({
    vehicleId: z.string().uuid(),
    spotId: z.string().uuid(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true })
});

const idSchema = z.string().uuid();

function postgresErrorCode(error: unknown): string | undefined {
    if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
    ) {
        return error.code;
    }

    return undefined;
}

function formatReservation(reservation: {
    id: string;
    vehicle_id: string;
    plate: string;
    spot_id: string;
    spot_number: string;
    starts_at: Date;
    ends_at: Date;
    status: string;
    created_at: Date;
}) {
    return {
        id: reservation.id,
        vehicleId: reservation.vehicle_id,
        plate: reservation.plate,
        spotId: reservation.spot_id,
        spotNumber: reservation.spot_number,
        startsAt: reservation.starts_at,
        endsAt: reservation.ends_at,
        status: reservation.status,
        createdAt: reservation.created_at
    };
}

export function registerParkingRoutes(router: Router, pool: Pool) {
    router.get(
        "/map",
        requireAuth,
        async (request: AuthenticatedRequest, response, next) => {
            try {
                const atValue = request.query.at;
                const at =
                    typeof atValue === "string" ? new Date(atValue) : new Date();

                if (Number.isNaN(at.getTime())) {
                    response.status(400).json({
                        error: "VALIDATION_ERROR",
                        message: "The optional 'at' query parameter must be a valid ISO timestamp."
                    });
                    return;
                }

                const result = await pool.query<{
                    id: string;
                    number: string;
                    row_number: number;
                    column_number: number;
                    is_reserved: boolean;
                    is_occupied: boolean;
                }>(
                    `
                    SELECT
                        spot.id,
                        spot.number,
                        spot.row_number,
                        spot.column_number,
                        EXISTS (
                            SELECT 1
                            FROM reservations reservation
                            WHERE reservation.spot_id = spot.id
                              AND reservation.status = 'BOOKED'
                              AND tstzrange(
                                  reservation.starts_at,
                                  reservation.ends_at,
                                  '[)'
                              ) @> $1::timestamptz
                        ) AS is_reserved,
                        EXISTS (
                            SELECT 1
                            FROM visits visit
                            WHERE visit.spot_id = spot.id
                              AND visit.status = 'ACTIVE'
                        ) AS is_occupied
                    FROM parking_spots spot
                    ORDER BY spot.row_number, spot.column_number
                    `,
                    [at]
                );

                response.status(200).json({
                    at,
                    spots: result.rows.map((spot) => ({
                        id: spot.id,
                        number: spot.number,
                        row: spot.row_number,
                        column: spot.column_number,
                        status: spot.is_occupied
                            ? "OCCUPIED"
                            : spot.is_reserved
                                ? "RESERVED"
                                : "AVAILABLE"
                    }))
                });
            } catch (error) {
                next(error);
            }
        }
    );

    router.get(
        "/reservations",
        requireAuth,
        async (request: AuthenticatedRequest, response, next) => {
            try {
                const result = await pool.query<{
                    id: string;
                    vehicle_id: string;
                    plate: string;
                    spot_id: string;
                    spot_number: string;
                    starts_at: Date;
                    ends_at: Date;
                    status: string;
                    created_at: Date;
                }>(
                    `
                    SELECT
                        reservation.id,
                        reservation.vehicle_id,
                        vehicle.plate,
                        reservation.spot_id,
                        spot.number AS spot_number,
                        reservation.starts_at,
                        reservation.ends_at,
                        reservation.status,
                        reservation.created_at
                    FROM reservations reservation
                    JOIN vehicles vehicle ON vehicle.id = reservation.vehicle_id
                    JOIN parking_spots spot ON spot.id = reservation.spot_id
                    WHERE reservation.user_id = $1
                    ORDER BY reservation.starts_at DESC, reservation.created_at DESC
                    `,
                    [request.auth!.userId]
                );

                response.status(200).json({
                    reservations: result.rows.map(formatReservation)
                });
            } catch (error) {
                next(error);
            }
        }
    );

    router.post(
        "/reservations",
        requireAuth,
        async (request: AuthenticatedRequest, response, next) => {
            try {
                const input = reservationInputSchema.parse(request.body);
                const startsAt = new Date(input.startsAt);
                const endsAt = new Date(input.endsAt);

                if (endsAt <= startsAt) {
                    response.status(400).json({
                        error: "VALIDATION_ERROR",
                        message: "'endsAt' must be after 'startsAt'."
                    });
                    return;
                }

                if (startsAt <= new Date()) {
                    response.status(400).json({
                        error: "VALIDATION_ERROR",
                        message: "'startsAt' must be in the future."
                    });
                    return;
                }

                const result = await pool.query<{
                    id: string;
                    vehicle_id: string;
                    plate: string;
                    spot_id: string;
                    spot_number: string;
                    starts_at: Date;
                    ends_at: Date;
                    status: string;
                    created_at: Date;
                }>(
                    `
                    WITH created_reservation AS (
                        INSERT INTO reservations (
                            user_id,
                            vehicle_id,
                            spot_id,
                            starts_at,
                            ends_at
                        )
                        SELECT
                            $1,
                            vehicle.id,
                            $3,
                            $4,
                            $5
                        FROM vehicles vehicle
                        WHERE vehicle.id = $2
                          AND vehicle.user_id = $1
                        RETURNING *
                    )
                    SELECT
                        reservation.id,
                        reservation.vehicle_id,
                        vehicle.plate,
                        reservation.spot_id,
                        spot.number AS spot_number,
                        reservation.starts_at,
                        reservation.ends_at,
                        reservation.status,
                        reservation.created_at
                    FROM created_reservation reservation
                    JOIN vehicles vehicle ON vehicle.id = reservation.vehicle_id
                    JOIN parking_spots spot ON spot.id = reservation.spot_id
                    `,
                    [
                        request.auth!.userId,
                        input.vehicleId,
                        input.spotId,
                        startsAt,
                        endsAt
                    ]
                );

                const reservation = result.rows[0];

                if (!reservation) {
                    response.status(404).json({
                        error: "VEHICLE_OR_SPOT_NOT_FOUND",
                        message: "The vehicle does not belong to your account or the parking spot does not exist."
                    });
                    return;
                }

                response.status(201).json(formatReservation(reservation));
            } catch (error) {
                if (error instanceof z.ZodError) {
                    response.status(400).json({
                        error: "VALIDATION_ERROR",
                        message: "Provide valid vehicleId, spotId, startsAt, and endsAt fields."
                    });
                    return;
                }

                if (postgresErrorCode(error) === "23P01") {
                    response.status(409).json({
                        error: "RESERVATION_OVERLAP",
                        message: "This parking spot is already reserved for part of that interval."
                    });
                    return;
                }

                if (postgresErrorCode(error) === "23503") {
                    response.status(404).json({
                        error: "SPOT_NOT_FOUND",
                        message: "The selected parking spot was not found."
                    });
                    return;
                }

                next(error);
            }
        }
    );

    router.post(
        "/reservations/:reservationId/cancel",
        requireAuth,
        async (request: AuthenticatedRequest, response, next) => {
            try {
                const reservationId = idSchema.parse(request.params.reservationId);

                const result = await pool.query<{
                    id: string;
                    status: string;
                }>(
                    `
                    UPDATE reservations
                    SET status = 'CANCELLED'
                    WHERE id = $1
                      AND user_id = $2
                      AND status = 'BOOKED'
                      AND starts_at > now()
                    RETURNING id, status
                    `,
                    [reservationId, request.auth!.userId]
                );

                const reservation = result.rows[0];

                if (!reservation) {
                    response.status(409).json({
                        error: "RESERVATION_NOT_CANCELLABLE",
                        message: "The reservation was not found, is not yours, or can no longer be cancelled."
                    });
                    return;
                }

                response.status(200).json({
                    id: reservation.id,
                    status: reservation.status
                });
            } catch (error) {
                if (error instanceof z.ZodError) {
                    response.status(400).json({
                        error: "VALIDATION_ERROR",
                        message: "Reservation id must be a UUID."
                    });
                    return;
                }

                next(error);
            }
        }
    );

    router.get(
        "/visits",
        requireAuth,
        async (request: AuthenticatedRequest, response, next) => {
            try {
                const result = await pool.query<{
                    id: string;
                    reservation_id: string | null;
                    plate: string;
                    spot_number: string;
                    entered_at: Date;
                    exited_at: Date | null;
                    status: string;
                    total_amount_som: number | null;
                }>(
                    `
                    SELECT
                        visit.id,
                        visit.reservation_id,
                        visit.plate,
                        spot.number AS spot_number,
                        visit.entered_at,
                        visit.exited_at,
                        visit.status,
                        visit.total_amount_som
                    FROM visits visit
                    JOIN parking_spots spot ON spot.id = visit.spot_id
                    LEFT JOIN vehicles vehicle ON vehicle.id = visit.vehicle_id
                    LEFT JOIN reservations reservation ON reservation.id = visit.reservation_id
                    WHERE vehicle.user_id = $1
                       OR reservation.user_id = $1
                    ORDER BY visit.entered_at DESC
                    `,
                    [request.auth!.userId]
                );

                response.status(200).json({
                    visits: result.rows.map((visit) => ({
                        id: visit.id,
                        reservationId: visit.reservation_id,
                        plate: visit.plate,
                        spotNumber: visit.spot_number,
                        enteredAt: visit.entered_at,
                        exitedAt: visit.exited_at,
                        status: visit.status,
                        totalAmountSom: visit.total_amount_som
                    }))
                });
            } catch (error) {
                next(error);
            }
        }
    );
}
