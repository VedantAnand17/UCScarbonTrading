INSERT INTO "EmissionFactor" ("id", "version", "kgPerKwh", "source", "validFrom")
VALUES ('factor_cea_v20', 'CEA-v20', 0.710, 'Central Electricity Authority CO2 Baseline Database v20', '1970-01-01 00:00:00');

CREATE FUNCTION reject_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'LedgerEntry is append-only';
END;
$$;

CREATE TRIGGER ledger_is_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON "LedgerEntry"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_ledger_mutation();
