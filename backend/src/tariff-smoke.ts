import assert from "node:assert/strict";
import { calculateInvoiceAmount } from "./services/tariff.js";

const tariff = {
    dayRateSomPerMinute: 500,
    nightRateSomPerMinute: 300,
    dayStartsAt: "06:00",
    nightStartsAt: "22:00"
};

// Asia/Bishkek is UTC+6.
// 2026-10-09 15:59Z = 21:59 in Bishkek.
// The next billed minute starts at 22:00 and uses the night rate.
const dayToNight = calculateInvoiceAmount(
    new Date("2026-10-09T15:59:00.000Z"),
    new Date("2026-10-09T16:01:00.000Z"),
    tariff
);

assert.equal(dayToNight.durationMinutes, 2);
assert.equal(dayToNight.totalAmountSom, 800);

// 2026-10-09 23:59Z = 05:59 in Bishkek.
// The next billed minute starts at 06:00 and uses the day rate.
const nightToDay = calculateInvoiceAmount(
    new Date("2026-10-09T23:59:00.000Z"),
    new Date("2026-10-10T00:01:00.000Z"),
    tariff
);

assert.equal(nightToDay.durationMinutes, 2);
assert.equal(nightToDay.totalAmountSom, 800);

// Parking always costs at least one started minute.
const immediateExit = calculateInvoiceAmount(
    new Date("2026-10-09T10:00:00.000Z"),
    new Date("2026-10-09T10:00:00.000Z"),
    tariff
);

assert.equal(immediateExit.durationMinutes, 1);
assert.equal(immediateExit.totalAmountSom, 500);

console.log(
    "Tariff smoke check passed: day/night boundaries and minimum billing."
);
