import jwt from "jsonwebtoken";

export type AuthTokenPayload = {
    userId: string;
    email: string;
};

function getJwtSecret(): string {
    const secret = process.env.JWT_SECRET;

    if (!secret) {
        throw new Error("JWT_SECRET is required. Copy .env.example to .env.");
    }

    return secret;
}

export function createAccessToken(payload: AuthTokenPayload): string {
    return jwt.sign(payload, getJwtSecret(), {
        algorithm: "HS256",
        expiresIn: "7d"
    });
}

export function verifyAccessToken(token: string): AuthTokenPayload {
    const payload = jwt.verify(token, getJwtSecret(), {
        algorithms: ["HS256"]
    });

    if (
        typeof payload === "string" ||
        typeof payload.userId !== "string" ||
        typeof payload.email !== "string"
    ) {
        throw new Error("Invalid access token payload.");
    }

    return {
        userId: payload.userId,
        email: payload.email
    };
}
