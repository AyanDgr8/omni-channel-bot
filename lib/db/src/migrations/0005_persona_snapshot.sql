-- Denormalised persona snapshot columns on `calls`. These capture the persona
-- name and trait version at call-start so the Call Log stays accurate even if
-- the persona is later renamed or deleted.

ALTER TABLE `calls`
  ADD COLUMN `persona_name` varchar(255) NULL,
  ADD COLUMN `persona_version` int NULL;
