-- A parking spot can have only one car currently parked in it.
CREATE UNIQUE INDEX visits_one_active_visit_per_spot
    ON visits (spot_id)
    WHERE status = 'ACTIVE';