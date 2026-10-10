export type ReservationReminderEmail = {
    to: string;
    reservationId: string;
    plate: string;
    spotNumber: string;
    startsAt: Date;
    endsAt: Date;
};

/**
 * Development-only mail transport.
 *
 * Replace this function with an external provider later. Its interface keeps
 * background jobs independent from a particular email provider.
 */
export async function sendReservationReminderEmail(
    email: ReservationReminderEmail
): Promise<void> {
    console.log("[email stub] reservation reminder", {
        to: email.to,
        reservationId: email.reservationId,
        plate: email.plate,
        spotNumber: email.spotNumber,
        startsAt: email.startsAt.toISOString(),
        endsAt: email.endsAt.toISOString()
    });
}
