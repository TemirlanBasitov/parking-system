import type { Pool } from "pg";
import {
    sendReservationReminderEmail,
    type ReservationReminderEmail
} from "./email.js";

const DEFAULT_JOB_INTERVAL_MS = 60_000;
const DEFAULT_REMINDER_LEAD_TIME_MS = 60 * 60 * 1000;
const REMINDER_BATCH_SIZE = 100;

type JobOptions = {
    now?: Date;
    reminderLeadTimeMs?: number;
    sendReminder?: (
        reminder: ReservationReminderEmail
    ) => Promise<void>;
};

type JobResult = {
    expiredReservations: number;
    sentReminders: number;
};

function positiveEnvironmentNumber(
    value: string | undefined,
    fallback: number
): number {
    const parsed = Number(value);

    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Expires unused reservations that have ended, then atomically claims and
 * notifies reservations starting within the configured reminder window.
 *
 * `FOR UPDATE SKIP LOCKED` means parallel backend instances cannot claim the
 * same reminder row concurrently. `reminder_sent_at` prevents repeat emails.
 */
export async function processReservationJobs(
    pool: Pool,
    options: JobOptions = {}
): Promise<JobResult> {
    const now = options.now ?? new Date();
    const reminderLeadTimeMs =
        options.reminderLeadTimeMs ?? DEFAULT_REMINDER_LEAD_TIME_MS;
    const reminderUntil = new Date(now.getTime() + reminderLeadTimeMs);
    const sendReminder =
        options.sendReminder ?? sendReservationReminderEmail;

    const client = await pool.connect();

    let expiredReservations = 0;
    let reminders: ReservationReminderEmail[] = [];

    try {
        await client.query("BEGIN");

        const expiredResult = await client.query<{ id: string }>(
            `
            UPDATE reservations
            SET status = 'EXPIRED'
            WHERE status = 'BOOKED'
              AND ends_at <= $1
            RETURNING id
            `,
            [now]
        );

        expiredReservations = expiredResult.rowCount ?? 0;

        const reminderResult = await client.query<{
            reservation_id: string;
            email: string;
            plate: string;
            spot_number: string;
            starts_at: Date;
            ends_at: Date;
        }>(
            `
            WITH due_reservations AS (
                SELECT reservation.id
                FROM reservations reservation
                WHERE reservation.status = 'BOOKED'
                  AND reservation.reminder_sent_at IS NULL
                  AND reservation.starts_at > $1
                  AND reservation.starts_at <= $2
                ORDER BY reservation.starts_at
                FOR UPDATE SKIP LOCKED
                LIMIT ${REMINDER_BATCH_SIZE}
            ),
            claimed_reservations AS (
                UPDATE reservations reservation
                SET reminder_sent_at = $1
                FROM due_reservations due
                WHERE reservation.id = due.id
                RETURNING
                    reservation.id,
                    reservation.vehicle_id,
                    reservation.spot_id,
                    reservation.starts_at,
                    reservation.ends_at
            )
            SELECT
                claimed.id AS reservation_id,
                user_account.email,
                vehicle.plate,
                spot.number AS spot_number,
                claimed.starts_at,
                claimed.ends_at
            FROM claimed_reservations claimed
            JOIN reservations original ON original.id = claimed.id
            JOIN users user_account ON user_account.id = original.user_id
            JOIN vehicles vehicle ON vehicle.id = claimed.vehicle_id
            JOIN parking_spots spot ON spot.id = claimed.spot_id
            `,
            [now, reminderUntil]
        );

        reminders = reminderResult.rows.map((row) => ({
            to: row.email,
            reservationId: row.reservation_id,
            plate: row.plate,
            spotNumber: row.spot_number,
            startsAt: row.starts_at,
            endsAt: row.ends_at
        }));

        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }

    for (const reminder of reminders) {
        try {
            await sendReminder(reminder);
        } catch (error) {
            // Do not stop other reminders because one email provider call failed.
            // This local stub does not throw, but future provider failures are logged.
            console.error(
                "Unable to send reservation reminder email:",
                error
            );
        }
    }

    return {
        expiredReservations,
        sentReminders: reminders.length
    };
}

export function startReservationJobs(pool: Pool): () => void {
    const intervalMs = positiveEnvironmentNumber(
        process.env.RESERVATION_JOBS_INTERVAL_MS,
        DEFAULT_JOB_INTERVAL_MS
    );

    let running = false;

    const run = async () => {
        if (running) {
            return;
        }

        running = true;

        try {
            const result = await processReservationJobs(pool);

            if (
                result.expiredReservations > 0 ||
                result.sentReminders > 0
            ) {
                console.log("Reservation background tasks completed:", result);
            }
        } catch (error) {
            console.error("Reservation background tasks failed:", error);
        } finally {
            running = false;
        }
    };

    void run();

    const timer = setInterval(() => {
        void run();
    }, intervalMs);

    return () => clearInterval(timer);
}
