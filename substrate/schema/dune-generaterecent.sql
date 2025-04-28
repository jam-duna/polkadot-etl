CREATE OR REPLACE VIEW `substrate-etl.dune_polkadot.identities` AS SELECT * FROM `substrate-etl.polkadot_analytics.identity`
CREATE OR REPLACE VIEW `substrate-etl.dune_polkadot.blocks` AS SELECT * FROM `substrate-etl.crypto_polkadot.blocks0` WHERE block_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 109 DAY);
CREATE OR REPLACE VIEW `substrate-etl.dune_polkadot.extrinsics` AS SELECT * FROM `substrate-etl.crypto_polkadot.extrinsics0` WHERE block_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 109 DAY) AND CONCAT(section, ":", method) NOT IN ("paraInherent:enter","imOnline:heartbeat","electionProviderMultiPhase:submit","parachainSystem:setValidationData","parachainSystem:enactAuthorizedUpgrade") ;
CREATE OR REPLACE VIEW `substrate-etl.dune_polkadot.events` AS SELECT * FROM `substrate-etl.crypto_polkadot.events0` WHERE block_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 109 DAY) AND CONCAT(section, ":", method) NOT IN ("paraInclusion:CandidateBacked","paraInclusion:CandidateIncluded") ;
CREATE OR REPLACE VIEW `substrate-etl.dune_polkadot.transfers` AS SELECT * FROM `substrate-etl.crypto_polkadot.transfers0` WHERE block_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 109 DAY);
CREATE OR REPLACE VIEW `substrate-etl.dune_polkadot.calls` AS SELECT * FROM `substrate-etl.crypto_polkadot.calls0` WHERE block_time >= TIMESTAMP("2023-09-11") AND CONCAT(call_section, ":", call_method) NOT IN ("paraInherent:enter","imOnline:heartbeat","electionProviderMultiPhase:submit","dappsStaking:claimStaker") ;
CREATE OR REPLACE VIEW `substrate-etl.dune_polkadot.balances` AS SELECT * FROM `substrate-etl.crypto_polkadot.balances0` WHERE ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 109 DAY);
CREATE OR REPLACE VIEW `substrate-etl.dune_polkadot.stakings` AS SELECT * FROM `substrate-etl.crypto_polkadot.stakings0` WHERE ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 109 DAY);




CREATE OR REPLACE Table `substrate-etl.dune_polkadot.cached_identities` AS SELECT * FROM `substrate-etl.polkadot_analytics.identity`
CREATE OR REPLACE TABLE `substrate-etl.dune_polkadot.cached_blocks` PARTITION BY DATE(block_time) AS SELECT * FROM `substrate-etl.crypto_polkadot.blocks0` WHERE block_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 109 DAY);
CREATE OR REPLACE TABLE `substrate-etl.dune_polkadot.cached_extrinsics` PARTITION BY DATE(block_time) AS SELECT * FROM `substrate-etl.crypto_polkadot.extrinsics0` WHERE block_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 109 DAY) AND CONCAT(section, ":", method) NOT IN ("paraInherent:enter","imOnline:heartbeat","electionProviderMultiPhase:submit","parachainSystem:setValidationData","parachainSystem:enactAuthorizedUpgrade") ;
CREATE OR REPLACE TABLE `substrate-etl.dune_polkadot.cached_events` PARTITION BY DATE(block_time) AS SELECT * FROM `substrate-etl.crypto_polkadot.events0` WHERE block_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 109 DAY) AND CONCAT(section, ":", method) NOT IN ("paraInclusion:CandidateBacked","paraInclusion:CandidateIncluded") ;
CREATE OR REPLACE TABLE `substrate-etl.dune_polkadot.cached_transfers` PARTITION BY DATE(block_time) AS SELECT * FROM `substrate-etl.crypto_polkadot.transfers0` WHERE block_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 109 DAY);
CREATE OR REPLACE TABLE `substrate-etl.dune_polkadot.cached_calls` PARTITION BY DATE(block_time) AS SELECT * FROM `substrate-etl.crypto_polkadot.calls0` WHERE block_time >= TIMESTAMP("2023-09-11") AND CONCAT(call_section, ":", call_method) NOT IN ("paraInherent:enter","imOnline:heartbeat","electionProviderMultiPhase:submit","dappsStaking:claimStaker") ;
CREATE OR REPLACE TABLE `substrate-etl.dune_polkadot.cached_balances` PARTITION BY DATE(ts) AS SELECT * FROM `substrate-etl.crypto_polkadot.balances0` WHERE ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 109 DAY);
CREATE OR REPLACE TABLE `substrate-etl.dune_polkadot.cached_stakings` PARTITION BY DATE(ts) AS SELECT * FROM `substrate-etl.crypto_polkadot.stakings0` WHERE ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 109 DAY);

