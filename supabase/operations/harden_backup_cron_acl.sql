-- Run as a role authorized to revoke this grant in the selected Cloud project.
-- Does not remove logs or modify jobs. Existing postgres/admin grants remain.
BEGIN;
REVOKE DELETE ON TABLE cron.job_run_details FROM PUBLIC;
DO $$
BEGIN
  IF has_table_privilege('backup_reader', 'cron.job_run_details', 'DELETE') THEN
    RAISE EXCEPTION 'PUBLIC cron DELETE could not be revoked; backup reader must remain NOLOGIN';
  END IF;
END;
$$;
COMMIT;
