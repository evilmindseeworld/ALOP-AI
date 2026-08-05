-- 006_audit_retention.sql
--
-- Additive and re-runnable. Apply with
--   node scripts/run-migration.mjs 006_audit_retention.sql
--
-- Delete audit log rows older than 90 days.
--
-- WHY THIS EXISTS. audit_logs.ip_address is written on every audited action,
-- and nothing has ever deleted a row. An IP address is personal data under
-- GDPR and an identifier under the CCPA, so an audit table that grows forever
-- is a table of personal data retained forever.
--
-- GDPR Article 5(1)(e) — storage limitation — requires personal data to be kept
-- "no longer than is necessary" for the purpose it was collected for. The
-- purpose here is rate limiting and abuse investigation. That purpose is served
-- by weeks of history, not years: nobody investigates an abuse report from
-- eighteen months ago, and no rate limiter looks further back than its window.
--
-- The second reason is blunter. Data you do not hold cannot leak. An indefinite
-- log is a growing target whose only function, past a certain age, is to make a
-- future breach worse.
--
-- 90 days is the common choice for security logs: long enough to investigate an
-- incident found late, short enough to defend as proportionate. It is set in
-- one place, below, and stated in the privacy policy. If one changes the other
-- must change with it — a published retention period the database does not
-- honour is a false statement, which is worse than a long one honestly declared.

CREATE INDEX IF NOT EXISTS audit_logs_created_at ON audit_logs (created_at);

/*
 * Returns the number of rows removed, so a caller can log it and a human can
 * tell "the sweep ran and there was nothing to do" apart from "the sweep never
 * ran" — two states that otherwise look identical from the outside.
 *
 * The retention window is a parameter with a default rather than a literal, so
 * a one-off longer sweep during an investigation does not require editing and
 * redeploying a migration.
 */
CREATE OR REPLACE FUNCTION sweep_audit_logs(retain_days INTEGER DEFAULT 90)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  removed INTEGER;
BEGIN
  DELETE FROM audit_logs WHERE created_at < NOW() - (retain_days || ' days')::INTERVAL;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

-- One immediate pass, so applying this migration brings the table into line
-- with the policy rather than only affecting rows written from now on.
SELECT sweep_audit_logs(90);
