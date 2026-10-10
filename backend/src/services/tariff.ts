export const PARKING_TIME_ZONE = "Asia/Bishkek";

export type TariffSettings = {
    dayRateSomPerMinute: number;
    nightRateSomPerMinute: number;
    dayStartsAt: string;
    nightStartsAt: string;
};

export type InvoiceCalculation = {
    durationMinutes: number;
    totalAmountSom: number;
};

function normalizeTime(value: string): string {
    return value.slice(0, 5);
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

/**
 * Returns whether `time` is in the configured daytime interval.
 *
 * It supports both:
 * - normal daytime: 06:00 to 22:00
 * - wrapping daytime: 22:00 to 06:00
 */
function isInDayPeriod(
    time: string,
    dayStartsAt: string,
    nightStartsAt: string
): boolean {
    if (dayStartsAt === nightStartsAt) {
        throw new Error(
            "dayStartsAt and nightStartsAt must be different tariff boundaries."
        );
    }

    if (dayStartsAt < nightStartsAt) {
        return time >= dayStartsAt && time < nightStartsAt;
    }

    return time >= dayStartsAt || time < nightStartsAt;
}

/**
 * Billing policy: charge at least one started minute. Each billed minute uses
 * the rate active at the beginning of that minute in Asia/Bishkek time.
 */
export function calculateInvoiceAmount(
    enteredAt: Date,
    exitedAt: Date,
    tariff: TariffSettings
): InvoiceCalculation {
    const durationMs = Math.max(0, exitedAt.getTime() - enteredAt.getTime());

    const durationMinutes = Math.max(1, Math.ceil(durationMs / 60_000));
    const dayStartsAt = normalizeTime(tariff.dayStartsAt);
    const nightStartsAt = normalizeTime(tariff.nightStartsAt);

    let totalAmountSom = 0;

    for (let minute = 0; minute < durationMinutes; minute += 1) {
        const billedMinute = new Date(
            enteredAt.getTime() + minute * 60_000
        );

        const isDayRate = isInDayPeriod(
            getLocalTime(billedMinute),
            dayStartsAt,
            nightStartsAt
        );

        totalAmountSom += isDayRate
            ? tariff.dayRateSomPerMinute
            : tariff.nightRateSomPerMinute;
    }

    return {
        durationMinutes,
        totalAmountSom
    };
}
