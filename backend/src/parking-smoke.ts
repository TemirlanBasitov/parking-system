import "dotenv/config";

import { randomUUID } from "node:crypto";
import { createApp } from "./app.js";
import { pool } from "./db.js";

type RegisteredUser = {
    token?: string;
    user?: {
        id?: string;
        email?: string;
    };
};

type Vehicle = {
    id?: string;
    plate?: string;
};

type ParkingMap = {
    spots?: Array<{
        id: string;
        number: string;
        status: "AVAILABLE" | "RESERVED" | "OCCUPIED";
    }>;
};

type Reservation = {
    id?: string;
    status?: string;
};

type EntryResponse = {
    visit?: {
        id?: string;
        plate?: string;
        spot?: {
            id?: string;
            number?: string;
        };
    };
};

type ExitResponse = {
    invoice?: {
        visitId?: string;
        totalAmountSom?: number;
        durationMinutes?: number;
    };
};

type VisitHistory = {
    visits?: Array<{
        id: string;
        status: string;
        totalAmountSom: number | null;
    }>;
};

async function readJson<T>(response: Response): Promise<T> {
    return (await response.json()) as T;
}

const testEmail = `parking-smoke-${randomUUID()}@example.test`;
const testPassword = "secure-test-password";
const testPlate = `SMK${randomUUID()
    .replaceAll("-", "")
    .slice(0, 13)
    .toUpperCase()}`;
const app = createApp(pool);

const server = app.listen(0, "127.0.0.1", async () => {
    let testUserId: string | undefined;

    try {
        const address = server.address();

        if (!address || typeof address === "string") {
            throw new Error("Could not determine test server address.");
        }

        const baseUrl = `http://127.0.0.1:${address.port}`;

        const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
            method: "POST",
            headers: {
                "content-type": "application/json"
            },
            body: JSON.stringify({
                email: testEmail,
                password: testPassword
            })
        });

        const registerBody = await readJson<RegisteredUser>(registerResponse);

        if (
            registerResponse.status !== 201 ||
            !registerBody.token ||
            !registerBody.user?.id
        ) {
            throw new Error(
                `Registration failed: ${registerResponse.status} ${JSON.stringify(registerBody)}`
            );
        }

        const token = registerBody.token;
        testUserId = registerBody.user.id;

        const authHeaders = {
            authorization: `Bearer ${token}`
        };

        const jsonAuthHeaders = {
            ...authHeaders,
            "content-type": "application/json"
        };

        const vehicleResponse = await fetch(`${baseUrl}/api/account/vehicles`, {
            method: "POST",
            headers: jsonAuthHeaders,
            body: JSON.stringify({
                plate: testPlate
            })
        });

        const vehicle = await readJson<Vehicle>(vehicleResponse);

        if (
            vehicleResponse.status !== 201 ||
            !vehicle.id ||
            vehicle.plate !== testPlate
        ) {
            throw new Error(
                `Vehicle creation failed: ${vehicleResponse.status} ${JSON.stringify(vehicle)}`
            );
        }

        const mapResponse = await fetch(`${baseUrl}/api/parking/map`, {
            headers: authHeaders
        });

        const parkingMap = await readJson<ParkingMap>(mapResponse);

        if (!mapResponse.ok || !parkingMap.spots) {
            throw new Error(
                `Parking map request failed: ${mapResponse.status} ${JSON.stringify(parkingMap)}`
            );
        }

        const availableSpot = parkingMap.spots.find(
            (spot) => spot.status === "AVAILABLE"
        );

        if (!availableSpot) {
            throw new Error(
                "Parking smoke check requires at least one currently available spot."
            );
        }

        const startsAt = new Date(Date.now() + 60 * 60 * 1000);
        const endsAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

        const reservationPayload = {
            vehicleId: vehicle.id,
            spotId: availableSpot.id,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString()
        };

        const reservationResponse = await fetch(
            `${baseUrl}/api/parking/reservations`,
            {
                method: "POST",
                headers: jsonAuthHeaders,
                body: JSON.stringify(reservationPayload)
            }
        );

        const reservation = await readJson<Reservation>(reservationResponse);

        if (
            reservationResponse.status !== 201 ||
            !reservation.id ||
            reservation.status !== "BOOKED"
        ) {
            throw new Error(
                `Reservation creation failed: ${reservationResponse.status} ${JSON.stringify(reservation)}`
            );
        }

        const overlappingReservationResponse = await fetch(
            `${baseUrl}/api/parking/reservations`,
            {
                method: "POST",
                headers: jsonAuthHeaders,
                body: JSON.stringify(reservationPayload)
            }
        );

        if (overlappingReservationResponse.status !== 409) {
            const body = await readJson<unknown>(overlappingReservationResponse);

            throw new Error(
                `Overlapping reservation should return 409, received ${overlappingReservationResponse.status}: ${JSON.stringify(body)}`
            );
        }

        const cancellationResponse = await fetch(
            `${baseUrl}/api/parking/reservations/${reservation.id}/cancel`,
            {
                method: "POST",
                headers: authHeaders
            }
        );

        const cancelledReservation = await readJson<Reservation>(cancellationResponse);

        if (
            cancellationResponse.status !== 200 ||
            cancelledReservation.status !== "CANCELLED"
        ) {
            throw new Error(
                `Reservation cancellation failed: ${cancellationResponse.status} ${JSON.stringify(cancelledReservation)}`
            );
        }

        const entryResponse = await fetch(`${baseUrl}/api/barrier/entry`, {
            method: "POST",
            headers: jsonAuthHeaders,
            body: JSON.stringify({
                plate: testPlate
            })
        });

        const entry = await readJson<EntryResponse>(entryResponse);

        if (
            entryResponse.status !== 201 ||
            !entry.visit?.id ||
            entry.visit.plate !== testPlate ||
            !entry.visit.spot?.id
        ) {
            throw new Error(
                `Barrier entry failed: ${entryResponse.status} ${JSON.stringify(entry)}`
            );
        }

        const secondEntryResponse = await fetch(`${baseUrl}/api/barrier/entry`, {
            method: "POST",
            headers: jsonAuthHeaders,
            body: JSON.stringify({
                plate: testPlate
            })
        });

        if (secondEntryResponse.status !== 409) {
            const body = await readJson<unknown>(secondEntryResponse);

            throw new Error(
                `Second barrier entry should return 409, received ${secondEntryResponse.status}: ${JSON.stringify(body)}`
            );
        }

        const exitResponse = await fetch(`${baseUrl}/api/barrier/exit`, {
            method: "POST",
            headers: jsonAuthHeaders,
            body: JSON.stringify({
                plate: testPlate
            })
        });

        const exit = await readJson<ExitResponse>(exitResponse);

        if (
            exitResponse.status !== 200 ||
            exit.invoice?.visitId !== entry.visit.id ||
            typeof exit.invoice.totalAmountSom !== "number" ||
            exit.invoice.totalAmountSom < 0 ||
            !exit.invoice.durationMinutes ||
            exit.invoice.durationMinutes < 1
        ) {
            throw new Error(
                `Barrier exit failed: ${exitResponse.status} ${JSON.stringify(exit)}`
            );
        }

        const historyResponse = await fetch(`${baseUrl}/api/parking/visits`, {
            headers: authHeaders
        });

        const history = await readJson<VisitHistory>(historyResponse);

        const completedVisit = history.visits?.find(
            (visit) =>
                visit.id === entry.visit?.id &&
                visit.status === "COMPLETED" &&
                visit.totalAmountSom === exit.invoice?.totalAmountSom
        );

        if (!historyResponse.ok || !completedVisit) {
            throw new Error(
                `Visit history failed: ${historyResponse.status} ${JSON.stringify(history)}`
            );
        }

        console.log(
            "Parking smoke check passed: map, reservation overlap, cancellation, barrier entry, exit invoice, and visit history."
        );
    } finally {
        if (testUserId) {
            // `visits.vehicle_id` has no ON DELETE CASCADE, so delete visits first.
            await pool.query(
                `
                DELETE FROM visits
                WHERE vehicle_id IN (
                    SELECT id
                    FROM vehicles
                    WHERE user_id = $1
                )
                `,
                [testUserId]
            );

            await pool.query(
                `
                DELETE FROM reservations
                WHERE user_id = $1
                `,
                [testUserId]
            );

            await pool.query(
                `
                DELETE FROM users
                WHERE id = $1
                `,
                [testUserId]
            );
        }

        await new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });

        await pool.end();
    }
});
