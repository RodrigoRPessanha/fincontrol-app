-- Operational provisioning, not an application migration. Apply explicitly to
-- staging first. Never place passwords in this file or grant app-role membership.
-- The operator sets an independent password and enables LOGIN after validation.
BEGIN;
CREATE ROLE backup_reader NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION BYPASSRLS CONNECTION LIMIT 2;
GRANT pg_read_all_data TO backup_reader;
GRANT CONNECT ON DATABASE postgres TO backup_reader;
ALTER ROLE backup_reader SET default_transaction_read_only = on;
ALTER ROLE backup_reader SET search_path = pg_catalog;
ALTER ROLE backup_reader SET statement_timeout = '10min';
ALTER ROLE backup_reader SET idle_in_transaction_session_timeout = '60s';
COMMIT;
