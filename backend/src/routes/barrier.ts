import type { Router } from "express";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import {
    requireAuth,
    type AuthenticatedRequest
} from "../middleware/require-auth.js";

const plateSchema = z.object({
    plate: z.string().trim().min(2).max(16)
});

const PARKING_TIME_ZONE = "Asia/Bishkek";

function normalizePlate(plate: string): string {
    return plate.trim().toUpperCase().replace(/\s+/g, " ");
}

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

function getLocalTime(date: Date): string {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: PARKING_TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).formatToParts(date);

    const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
    const minute = parts.find((part) => part.type === "minute")?.value ?? "00";

    return `${hour}:${minute}`;
}

function calculateInvoiceAmount(
    enteredAt: Date,
    exitedAt: Date,
    dayRateSomPerMinute: number,
    nightRateSomPerMinute: number,
    dayStartsAt: string,
    nightStartsAt: string
): { durationMinutes: number; totalAmountSom: number } {
    const durationMs = Math.max(0, exitedAt.getTime() - enteredAt.getTime());

    // Parking charges at least one started minute.
    const durationMinutes = Math.max(1, Math.ceil(durationMs / 60_000));

    let totalAmountSom = 0;

    for (let minute = 0; minute < durationMinutes; minute += 1) {
        const currentMinute = new Date(enteredAt.getTime() + minute * 60_000);
        const localTime = getLocalTime(currentMinute);

        const isDayRate =
            localTime >= dayStartsAt && localTime < nightStartsAt;

        totalAmountSom += isDayRate
            ? dayRateSomPerMinute
            : nightRateSomPerMinute;
    }

    return {
        durationMinutes,
        totalAmountSom
    };
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
    try {
        await client.query("ROLLBACK");
    } catch {
        // Preserve the original error.
    }
}

export function registerBarrierRoutes(router: Router, pool: Pool) {
    router.post(
        "/entry",
        requireAuth,
        async (request: AuthenticatedRequest, response, next) => {
            const client = await pool.connect();

            try {
                const input = plateSchema.parse(request.body);
                const plate = normalizePlate(input.plate);

                await client.query("BEGIN");

                const activeVisit = await client.query<{ id: string }>(
                    `
                    SELECT id
                    FROM visits
                    WHERE upper(plate) = upper($1)
                      AND status = 'ACTIVE'
                    FOR UPDATE
                    `,
                    [plate]
                );

                if (activeVisit.rowCount && activeVisit.rowCount > 0) {
                    await client.query("ROLLBACK");

                    response.status(409).json({
                        error: "VEHICLE_ALREADY_INSIDE",
                        message: "This vehicle already has an active parking visit."
                    });
                    return;
                }

                const vehicleResult = await client.query<{
                    id: string;
                    user_id: string;
                }>(
                    `
                    SELECT id, user_id
                    FROM vehicles
                    WHERE upper(plate) = upper($1)
                    FOR UPDATE
                    `,
                    [plate]
                );

                const vehicle = vehicleResult.rows[0];

                const reservationResult = vehicle
                    ? await client.query<{
                        id: string;
                        spot_id: string;
                        spot_number: string;
                    }>(
                        `
                        SELECT
                            reservation.id,
                            reservation.spot_id,
                            spot.number AS spot_number
                        FROM reservations reservation
                        JOIN parking_spots spot ON spot.id = reservation.spot_id
                        WHERE reservation.vehicle_id = $1
                          AND reservation.status = 'BOOKED'
                          AND reservation.starts_at <= now()
                          AND reservation.ends_at > now()
                        ORDER BY reservation.starts_at
                        LIMIT 1
                        FOR UPDATE OF reservation, spot
                        `,
                        [vehicle.id]
                    )
                    : { rows: [] };

                const reservation = reservationResult.rows[0];

                let spotId: string;
                let spotNumber: string;
                let reservationId: string | null = null;

                if (reservation) {
                    const occupiedReservationSpot = await client.query<{ id: string }>(
                        `
                        SELECT id
                        FROM visits
                        WHERE spot_id = $1
                          AND status = 'ACTIVE'
                        FOR UPDATE
                        `,
                        [reservation.spot_id]
                    );

                    if (
                        occupiedReservationSpot.rowCount &&
                        occupiedReservationSpot.rowCount > 0
                    ) {
                        await client.query("ROLLBACK");

                        response.status(409).json({
                            error: "RESERVED_SPOT_OCCUPIED",
                            message: "The reserved parking spot is unexpectedly occupied."
                        });
                        return;
                    }

                    await client.query(
                        `
                        UPDATE reservations
                        SET status = 'USED'
                        WHERE id = $1
                        `,
                        [reservation.id]
                    );

                    spotId = reservation.spot_id;
                    spotNumber = reservation.spot_number;
                    reservationId = reservation.id;
                } else {
                    const availableSpotResult = await client.query<{
                        id: string;
                        number: string;
                    }>(
                        `
                        SELECT spot.id, spot.number
                        FROM parking_spots spot
                        WHERE NOT EXISTS (
                            SELECT 1
                            FROM visits visit
                            WHERE visit.spot_id = spot.id
                              AND visit.status = 'ACTIVE'
                        )
                        AND NOT EXISTS (
                            SELECT 1
                            FROM reservations reservation
                            WHERE reservation.spot_id = spot.id
                              AND reservation.status = 'BOOKED'
                              AND reservation.starts_at <= now()
                              AND reservation.ends_at > now()
                        )
                        ORDER BY spot.row_number, spot.column_number
                        FOR UPDATE OF spot SKIP LOCKED
                        LIMIT 1
                        `
                    );

                    const availableSpot = availableSpotResult.rows[0];

                    if (!availableSpot) {
                        await client.query("ROLLBACK");

                        response.status(409).json({
                            error: "PARKING_FULL",
                            message: "There are no currently available parking spots."
                        });
                        return;
                    }

                    spotId = availableSpot.id;
                    spotNumber = availableSpot.number;
                }

                const visitResult = await client.query<{
                    id: string;
                    entered_at: Date;
                }>(
                    `
                    INSERT INTO visits (
                        reservation_id,
                        spot_id,
                        vehicle_id,
                        plate
                    )
                    VALUES ($1, $2, $3, $4)
                    RETURNING id, entered_at
                    `,
                    [reservationId, spotId, vehicle?.id ?? null, plate]
                );

                await client.query("COMMIT");

                const visit = visitResult.rows[0];

                response.status(201).json({
                    barrier: "OPEN",
                    visit: {
                        id: visit.id,
                        reservationId,
                        plate,
                        spot: {
                            id: spotId,
                            number: spotNumber
                        },
                        enteredAt: visit.entered_at
                    }
                });
            } catch (error) {
                await rollbackQuietly(client);

                if (error instanceof z.ZodError) {
                    response.status(400).json({
                        error: "VALIDATION_ERROR",
                        message: "Provide a vehicle plate containing 2 to 16 characters."
                    });
                    return;
                }

                if (postgresErrorCode(error) === "23505") {
                    response.status(409).json({
                        error: "VEHICLE_OR_SPOT_ALREADY_ACTIVE",
                        message: "The vehicle or selected parking spot already has an active visit."
                    });
                    return;
                }

                next(error);
            } finally {
                client.release();
            }
        }
    );

    router.post(
        "/exit",
        requireAuth,
        async (request: AuthenticatedRequest, response, next) => {
            const client = await pool.connect();

            try {
                const input = plateSchema.parse(request.body);
                const plate = normalizePlate(input.plate);

                await client.query("BEGIN");

                const visitResult = await client.query<{
                    id: string;
                    plate: string;
                    spot_number: string;
                    entered_at: Date;
                }>(
                    `
                    SELECT
                        visit.id,
                        visit.plate,
                        spot.number AS spot_number,
                        visit.entered_at
                    FROM visits visit
                    JOIN parking_spots spot ON spot.id = visit.spot_id
                    WHERE upper(visit.plate) = upper($1)
                      AND visit.status = 'ACTIVE'
                    FOR UPDATE OF visit
                    `,
                    [plate]
                );

                const visit = visitResult.rows[0];

                if (!visit) {
                    await client.query("ROLLBACK");

                    response.status(404).json({
                        error: "ACTIVE_VISIT_NOT_FOUND",
                        message: "This vehicle does not have an active parking visit."
                    });
                    return;
                }

                const tariffResult = await client.query<{
                    day_rate_som_per_minute: number;
                    night_rate_som_per_minute: number;
                    day_starts_at: string;
                    night_starts_at: string;
                }>(
                    `
                    SELECT
                        day_rate_som_per_minute,
                        night_rate_som_per_minute,
                        day_starts_at::text,
                        night_starts_at::text
                    FROM tariff_settings
                    WHERE id = 1
                    FOR UPDATE
                    `
                );

                const tariff = tariffResult.rows[0];

                if (!tariff) {
                    throw new Error("Tariff settings row is missing.");
                }

                const exitedAt = new Date();

                const invoice = calculateInvoiceAmount(
                    visit.entered_at,
                    exitedAt,
                    tariff.day_rate_som_per_minute,
                    tariff.night_rate_som_per_minute,
                    tariff.day_starts_at.slice(0, 5),
                    tariff.night_starts_at.slice(0, 5)
                );

                await client.query(
                    `
                    UPDATE visits
                    SET
                        exited_at = $2,
                        status = 'COMPLETED',
                        total_amount_som = $3
                    WHERE id = $1
                    `,
                    [visit.id, exitedAt, invoice.totalAmountSom]
                );

                await client.query("COMMIT");

                response.status(200).json({
                    barrier: "OPEN",
                    invoice: {
                        visitId: visit.id,
                        plate: visit.plate,
                        spotNumber: visit.spot_number,
                        enteredAt: visit.entered_at,
                        exitedAt,
                        durationMinutes: invoice.durationMinutes,
                        totalAmountSom: invoice.totalAmountSom
                    }
                });
            } catch (error) {
                await rollbackQuietly(client);

                if (error instanceof z.ZodError) {
                    response.status(400).json({
                        error: "VALIDATION_ERROR",
                        message: "Provide a vehicle plate containing 2 to 16 characters."
                    });
                    return;
                }

                next(error);
            } finally {
                client.release();
            }
        }
    );
}
