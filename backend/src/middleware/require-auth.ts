import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken, type AuthTokenPayload } from "../auth.js";

export type AuthenticatedRequest = Request & {
    auth?: AuthTokenPayload;
};

export function requireAuth(
    request: AuthenticatedRequest,
    response: Response,
    next: NextFunction
) {
    const authorization = request.header("authorization");

    if (!authorization?.startsWith("Bearer ")) {
        response.status(401).json({
            error: "UNAUTHORIZED",
            message: "A Bearer access token is required."
        });
        return;
    }

    try {
        request.auth = verifyAccessToken(authorization.slice("Bearer ".length));
        next();
    } catch {
        response.status(401).json({
            error: "UNAUTHORIZED",
            message: "The access token is invalid or expired."
        });
    }
}