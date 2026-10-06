CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE reservation_status AS ENUM (
  'BOOKED',
  'CANCELLED',
  'EXPIRED',
  'USED'
);

CREATE TYPE visit_status AS ENUM (
  'ACTIVE',
  'COMPLETED'
);

CREATE TABLE users (
                       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                       email TEXT NOT NULL UNIQUE,
                       password_hash TEXT NOT NULL,
                       created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vehicles (
                          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                          plate TEXT NOT NULL UNIQUE,
                          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                          CONSTRAINT vehicles_plate_not_empty CHECK (char_length(trim(plate)) > 0)
);

CREATE TABLE parking_spots (
                               id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                               number TEXT NOT NULL UNIQUE,
                               row_number INTEGER NOT NULL,
                               column_number INTEGER NOT NULL,
                               created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                               CONSTRAINT parking_spots_position_unique UNIQUE (row_number, column_number)
);

CREATE TABLE reservations (
                              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                              user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                              vehicle_id UUID NOT NULL REFERENCES vehicles(id),
                              spot_id UUID NOT NULL REFERENCES parking_spots(id),
                              starts_at TIMESTAMPTZ NOT NULL,
                              ends_at TIMESTAMPTZ NOT NULL,
                              status reservation_status NOT NULL DEFAULT 'BOOKED',
                              reminder_sent_at TIMESTAMPTZ,
                              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                              CONSTRAINT reservations_valid_interval CHECK (ends_at > starts_at),
                              CONSTRAINT reservations_no_overlap
                                  EXCLUDE USING gist (
      spot_id WITH =,
      tstzrange(starts_at, ends_at, '[)') WITH &&
    )
    WHERE (status = 'BOOKED')
);

CREATE TABLE visits (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        reservation_id UUID UNIQUE REFERENCES reservations(id),
                        spot_id UUID NOT NULL REFERENCES parking_spots(id),
                        vehicle_id UUID REFERENCES vehicles(id),
                        plate TEXT NOT NULL,
                        entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        exited_at TIMESTAMPTZ,
                        status visit_status NOT NULL DEFAULT 'ACTIVE',
                        total_amount_som INTEGER,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        CONSTRAINT visits_exit_after_entry CHECK (
                            exited_at IS NULL OR exited_at >= entered_at
                            ),
                        CONSTRAINT visits_completed_has_amount CHECK (
                            status = 'ACTIVE'
                                OR (exited_at IS NOT NULL AND total_amount_som IS NOT NULL)
                            )
);

-- A vehicle number may have only one active visit.
CREATE UNIQUE INDEX visits_one_active_visit_per_plate
    ON visits (upper(plate))
    WHERE status = 'ACTIVE';

CREATE TABLE tariff_settings (
                                 id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
                                 day_rate_som_per_minute INTEGER NOT NULL,
                                 night_rate_som_per_minute INTEGER NOT NULL,
                                 day_starts_at TIME NOT NULL DEFAULT '06:00',
                                 night_starts_at TIME NOT NULL DEFAULT '22:00',
                                 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                                 CONSTRAINT tariff_rates_non_negative CHECK (
                                     day_rate_som_per_minute >= 0
                                         AND night_rate_som_per_minute >= 0
                                     )
);

INSERT INTO tariff_settings (
    id,
    day_rate_som_per_minute,
    night_rate_som_per_minute
)
VALUES (1, 500, 300);

INSERT INTO parking_spots (number, row_number, column_number)
VALUES
    ('A1', 1, 1),
    ('A2', 1, 2),
    ('A3', 1, 3),
    ('A4', 1, 4),
    ('A5', 1, 5),
    ('B1', 2, 1),
    ('B2', 2, 2),
    ('B3', 2, 3),
    ('B4', 2, 4),
    ('B5', 2, 5);