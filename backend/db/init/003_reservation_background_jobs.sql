-- Supports expiration scans without indexing cancelled/used reservations.
CREATE INDEX reservations_booked_ends_at_index
    ON reservations (ends_at)
    WHERE status = 'BOOKED';

-- Supports the reminder lookup and avoids indexing reminders already sent.
CREATE INDEX reservations_unsent_reminder_starts_at_index
    ON reservations (starts_at)
    WHERE status = 'BOOKED'
      AND reminder_sent_at IS NULL;
