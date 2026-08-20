-- ────────────────────────────────────────────────────────────────────────────
-- 0001_session_store.sql  (MySQL)
--
-- Table backing `express-mysql-session` (the express-session store).
--
-- It is declared here rather than left to the library's own
-- `createDatabaseTable` option: that helper reads its `schema.sql` from disk
-- relative to __dirname, which does not survive esbuild bundling the server
-- into dist/index.mjs — the read fails and the error is swallowed, leaving
-- every authenticated request to fail with "Table 'sessions' doesn't exist".
--
-- Column names and types match express-mysql-session's own schema.sql exactly.
-- The store is configured with `createDatabaseTable: false` in app.ts.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `sessions` (
  `session_id` varchar(128) COLLATE utf8mb4_bin NOT NULL,
  `expires` int unsigned NOT NULL,
  `data` mediumtext COLLATE utf8mb4_bin,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB;
