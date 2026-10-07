import "dotenv/config";

import { randomUUID } from "node:crypto";
import { createApp } from "./app.js";
import { pool } from "./db.js";

const testEmail = `smoke-${randomUUID()}@example.test`;
const testPassword = "secure-test-password";
const testPlate = `T${Date.now().toString().slice(-8)}`;

const app = createApp(pool);

const server = app.listen(0, "127.0.0.1", async () => {
    try {
        const address = server.address();

        if (!address || typeof address === "string") {
            throw new Error("Could not determine test server address.");
        }

        const baseUrl = `http://127.0.0.1:${address.port}`;

        const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                email: testEmail,
                password: testPassword
            })
        });

        const registerBody = (await registerResponse.json()) as {
            token?: string;
            user?: { id?: string; email?: string };
        };

        if (
            registerResponse.status !== 201 ||
            !registerBody.token ||
            registerBody.user?.email !== testEmail
        ) {
            throw new Error(
                `Registration failed: ${registerResponse.status} ${JSON.stringify(registerBody)}`
            );
        }

        const token = registerBody.token;

        const profileResponse = await fetch(`${baseUrl}/api/account/profile`, {
            headers: { authorization: `Bearer ${token}` }
        });

        if (!profileResponse.ok) {
            throw new Error(`Profile request failed: ${profileResponse.status}`);
        }

        const vehicleResponse = await fetch(`${baseUrl}/api/account/vehicles`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({ plate: testPlate })
        });

        const vehicleBody = (await vehicleResponse.json()) as { plate?: string };

        if (vehicleResponse.status !== 201 || vehicleBody.plate !== testPlate) {
            throw new Error(
                `Vehicle creation failed: ${vehicleResponse.status} ${JSON.stringify(vehicleBody)}`
            );
        }

        const listResponse = await fetch(`${baseUrl}/api/account/vehicles`, {
            headers: { authorization: `Bearer ${token}` }
        });

        const listBody = (await listResponse.json()) as {
            vehicles?: Array<{ plate: string }>;
        };

        if (
            !listResponse.ok ||
            !listBody.vehicles?.some((vehicle) => vehicle.plate === testPlate)
        ) {
            throw new Error(`Vehicle list failed: ${JSON.stringify(listBody)}`);
        }

        console.log(
            "Auth smoke check passed: registration, profile, add vehicle, and list vehicles."
        );
    } finally {
        await pool.query("DELETE FROM users WHERE email = $1", [testEmail]);
        server.close();
        await pool.end();
    }
});
