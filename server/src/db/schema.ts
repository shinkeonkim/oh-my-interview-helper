import { createHash } from "node:crypto"

export type Migration = { readonly id: string; readonly sql: string }

const schemaSql = `
CREATE TABLE blobs (sha256 TEXT PRIMARY KEY CHECK(length(sha256)=64 AND sha256 GLOB '[0-9a-f]*' AND sha256 NOT GLOB '*[^0-9a-f]*'), byte_size INTEGER NOT NULL CHECK(byte_size>=0), media_type TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE documents (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('resume','portfolio','cover_letter','supporting')), title TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('active','archived','deleted')) DEFAULT 'active', current_version_id TEXT REFERENCES document_versions(id) ON DELETE RESTRICT, created_at TEXT NOT NULL, archived_at TEXT, deleted_at TEXT);
CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT, version_number INTEGER NOT NULL CHECK(version_number>0), blob_hash TEXT NOT NULL REFERENCES blobs(sha256) ON DELETE RESTRICT, created_at TEXT NOT NULL, UNIQUE(document_id,version_number));
CREATE TABLE job_posts (id TEXT PRIMARY KEY, title TEXT NOT NULL, company_name TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('active','archived','deleted')) DEFAULT 'active', canonical_url TEXT UNIQUE, current_version_id TEXT REFERENCES job_post_versions(id) ON DELETE RESTRICT, created_at TEXT NOT NULL, archived_at TEXT, deleted_at TEXT);
CREATE TABLE job_post_versions (id TEXT PRIMARY KEY, job_post_id TEXT NOT NULL REFERENCES job_posts(id) ON DELETE RESTRICT, version_number INTEGER NOT NULL CHECK(version_number>0), source_kind TEXT NOT NULL CHECK(source_kind IN ('manual','file','url')), body_blob_hash TEXT REFERENCES blobs(sha256) ON DELETE RESTRICT, structured_content TEXT NOT NULL CHECK(json_valid(structured_content)), created_at TEXT NOT NULL, UNIQUE(job_post_id,version_number));
CREATE TABLE applications (id TEXT PRIMARY KEY, job_post_id TEXT REFERENCES job_posts(id) ON DELETE SET NULL, status TEXT NOT NULL CHECK(status IN ('saved','applied','interviewing','offered','rejected','withdrawn')), idempotency_key TEXT UNIQUE, created_at TEXT NOT NULL, archived_at TEXT);
CREATE TABLE application_events (id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE RESTRICT, sequence INTEGER NOT NULL CHECK(sequence>0), event_kind TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), created_at TEXT NOT NULL, UNIQUE(application_id,sequence));
CREATE INDEX document_versions_document_idx ON document_versions(document_id,version_number DESC);
CREATE INDEX job_post_versions_post_idx ON job_post_versions(job_post_id,version_number DESC);
CREATE INDEX application_events_application_idx ON application_events(application_id,sequence);
CREATE TRIGGER documents_current_version_parent_insert BEFORE INSERT ON documents WHEN NEW.current_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM document_versions WHERE id=NEW.current_version_id AND document_id=NEW.id) BEGIN SELECT RAISE(ABORT,'document version parent mismatch'); END;
CREATE TRIGGER documents_current_version_parent BEFORE UPDATE OF current_version_id ON documents WHEN NEW.current_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM document_versions WHERE id=NEW.current_version_id AND document_id=NEW.id) BEGIN SELECT RAISE(ABORT,'document version parent mismatch'); END;
CREATE TRIGGER job_posts_current_version_parent_insert BEFORE INSERT ON job_posts WHEN NEW.current_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM job_post_versions WHERE id=NEW.current_version_id AND job_post_id=NEW.id) BEGIN SELECT RAISE(ABORT,'job post version parent mismatch'); END;
CREATE TRIGGER job_posts_current_version_parent BEFORE UPDATE OF current_version_id ON job_posts WHEN NEW.current_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM job_post_versions WHERE id=NEW.current_version_id AND job_post_id=NEW.id) BEGIN SELECT RAISE(ABORT,'job post version parent mismatch'); END;
`

const provenanceSql = `
CREATE TABLE provider_runs (id TEXT PRIMARY KEY, provider_kind TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')), request_hash TEXT NOT NULL UNIQUE CHECK(length(request_hash)=64 AND request_hash GLOB '[0-9a-f]*' AND request_hash NOT GLOB '*[^0-9a-f]*'), usage_json TEXT NOT NULL CHECK(json_valid(usage_json)), created_at TEXT NOT NULL, completed_at TEXT);
CREATE TABLE artifacts (id TEXT PRIMARY KEY, artifact_type TEXT NOT NULL CHECK(artifact_type IN ('cover_letter','resume','interview_brief','application_answer')), state TEXT NOT NULL CHECK(state IN ('draft','archived','deleted')), provider_run_id TEXT REFERENCES provider_runs(id) ON DELETE SET NULL, body_blob_hash TEXT REFERENCES blobs(sha256) ON DELETE RESTRICT, structured_output TEXT NOT NULL CHECK(json_valid(structured_output)), version_number INTEGER NOT NULL CHECK(version_number>0), created_at TEXT NOT NULL, archived_at TEXT, deleted_at TEXT, UNIQUE(artifact_type,version_number));
CREATE TABLE artifact_inputs (artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT, input_kind TEXT NOT NULL CHECK(input_kind IN ('document_version','job_post_version','research_record','source_hash')), document_version_id TEXT REFERENCES document_versions(id) ON DELETE RESTRICT, job_post_version_id TEXT REFERENCES job_post_versions(id) ON DELETE RESTRICT, research_record_id TEXT REFERENCES research_records(id) ON DELETE RESTRICT, source_hash TEXT CHECK(source_hash IS NULL OR (length(source_hash)=64 AND source_hash GLOB '[0-9a-f]*' AND source_hash NOT GLOB '*[^0-9a-f]*')), created_at TEXT NOT NULL, PRIMARY KEY(artifact_id,input_kind), CHECK((input_kind='document_version' AND document_version_id IS NOT NULL AND job_post_version_id IS NULL AND research_record_id IS NULL AND source_hash IS NULL) OR (input_kind='job_post_version' AND document_version_id IS NULL AND job_post_version_id IS NOT NULL AND research_record_id IS NULL AND source_hash IS NULL) OR (input_kind='research_record' AND document_version_id IS NULL AND job_post_version_id IS NULL AND research_record_id IS NOT NULL AND source_hash IS NULL) OR (input_kind='source_hash' AND document_version_id IS NULL AND job_post_version_id IS NULL AND research_record_id IS NULL AND source_hash IS NOT NULL)));
CREATE TABLE research_records (id TEXT PRIMARY KEY, job_post_id TEXT REFERENCES job_posts(id) ON DELETE SET NULL, kind TEXT NOT NULL CHECK(length(trim(kind))>0), status TEXT NOT NULL CHECK(status IN ('active','stale','archived')), content_blob_hash TEXT REFERENCES blobs(sha256) ON DELETE RESTRICT, created_at TEXT NOT NULL, archived_at TEXT);
CREATE TABLE research_sources (id TEXT PRIMARY KEY, research_record_id TEXT NOT NULL REFERENCES research_records(id) ON DELETE RESTRICT, canonical_url TEXT NOT NULL CHECK(canonical_url GLOB 'http://*' OR canonical_url GLOB 'https://*'), title TEXT NOT NULL CHECK(length(trim(title))>0), content_hash TEXT NOT NULL CHECK(length(content_hash)=64 AND content_hash GLOB '[0-9a-f]*' AND content_hash NOT GLOB '*[^0-9a-f]*'), excerpt TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('available','failed','archived')), body_blob_hash TEXT REFERENCES blobs(sha256) ON DELETE RESTRICT, retrieved_at TEXT NOT NULL, UNIQUE(research_record_id,canonical_url));
CREATE TABLE conversations (id TEXT PRIMARY KEY, application_id TEXT REFERENCES applications(id) ON DELETE SET NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, archived_at TEXT);
CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT, sequence INTEGER NOT NULL CHECK(sequence>0), role TEXT NOT NULL CHECK(role IN ('system','user','assistant','tool')), body TEXT NOT NULL CHECK(json_valid(body)), body_blob_hash TEXT REFERENCES blobs(sha256) ON DELETE RESTRICT, provider_run_id TEXT REFERENCES provider_runs(id) ON DELETE SET NULL, created_at TEXT NOT NULL, UNIQUE(conversation_id,sequence));
CREATE INDEX artifacts_provider_run_idx ON artifacts(provider_run_id,created_at DESC);
CREATE INDEX research_sources_record_idx ON research_sources(research_record_id,retrieved_at DESC);
CREATE INDEX messages_conversation_idx ON messages(conversation_id,sequence);
`

const executionSql = `
CREATE TABLE durable_jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(length(trim(kind))>0), state TEXT NOT NULL CHECK(state IN ('queued','leased','running','succeeded','failed','cancelled')), idempotency_key TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), lease_owner TEXT, lease_expires_at TEXT, error_code TEXT CHECK(error_code IS NULL OR (length(error_code)>0 AND error_code GLOB '[a-z0-9_]*' AND error_code NOT GLOB '*[^a-z0-9_]*')), error_message TEXT CHECK(error_message IS NULL OR (length(error_message)>0 AND length(error_message)<=1024)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, CHECK((state IN ('leased','running') AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND error_code IS NULL AND error_message IS NULL) OR (state='failed' AND lease_owner IS NULL AND lease_expires_at IS NULL AND error_code IS NOT NULL AND error_message IS NOT NULL) OR (state IN ('queued','succeeded','cancelled') AND lease_owner IS NULL AND lease_expires_at IS NULL AND error_code IS NULL AND error_message IS NULL)));
CREATE TABLE durable_job_events (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES durable_jobs(id) ON DELETE RESTRICT, sequence INTEGER NOT NULL CHECK(sequence>0), event_kind TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL, UNIQUE(job_id,sequence));
CREATE TABLE provider_settings (provider_kind TEXT PRIMARY KEY, selected_model TEXT, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), capability_json TEXT NOT NULL CHECK(json_valid(capability_json)), updated_at TEXT NOT NULL);
CREATE TABLE outbound_disclosures (id TEXT PRIMARY KEY, request_hash TEXT NOT NULL UNIQUE CHECK(length(request_hash)=64 AND request_hash GLOB '[0-9a-f]*' AND request_hash NOT GLOB '*[^0-9a-f]*'), provider_kind TEXT NOT NULL REFERENCES provider_settings(provider_kind) ON DELETE RESTRICT, destination TEXT NOT NULL CHECK(destination GLOB 'http://*' OR destination GLOB 'https://*'), action TEXT NOT NULL CHECK(length(trim(action))>0), action_at TEXT NOT NULL, selected_input_hashes TEXT NOT NULL CHECK(json_valid(selected_input_hashes) AND json_type(selected_input_hashes)='array'));
CREATE TABLE runner_registrations (id TEXT PRIMARY KEY, runner_name TEXT NOT NULL UNIQUE CHECK(length(trim(runner_name))>0), token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64 AND token_hash GLOB '[0-9a-f]*' AND token_hash NOT GLOB '*[^0-9a-f]*'), capability_json TEXT NOT NULL CHECK(json_valid(capability_json)), status TEXT NOT NULL CHECK(status IN ('active','revoked')), registered_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT, CHECK((status='active' AND revoked_at IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL)));
CREATE INDEX durable_jobs_state_idx ON durable_jobs(state,created_at);
CREATE INDEX durable_job_events_job_idx ON durable_job_events(job_id,sequence);
CREATE INDEX disclosures_provider_action_idx ON outbound_disclosures(provider_kind,action_at DESC);
CREATE INDEX runner_registrations_status_idx ON runner_registrations(status,last_seen_at DESC);
CREATE TRIGGER outbound_disclosures_input_hashes_insert BEFORE INSERT ON outbound_disclosures WHEN EXISTS (SELECT 1 FROM json_each(NEW.selected_input_hashes) WHERE json_each.type!='text' OR length(json_each.value)!=64 OR json_each.value GLOB '*[^0-9a-f]*') BEGIN SELECT RAISE(ABORT,'disclosure input hash invalid'); END;
CREATE TRIGGER outbound_disclosures_input_hashes_update BEFORE UPDATE OF selected_input_hashes ON outbound_disclosures WHEN EXISTS (SELECT 1 FROM json_each(NEW.selected_input_hashes) WHERE json_each.type!='text' OR length(json_each.value)!=64 OR json_each.value GLOB '*[^0-9a-f]*') BEGIN SELECT RAISE(ABORT,'disclosure input hash invalid'); END;
CREATE TRIGGER outbound_disclosures_input_hashes_nonempty_insert BEFORE INSERT ON outbound_disclosures WHEN json_array_length(NEW.selected_input_hashes)=0 OR EXISTS (SELECT value FROM json_each(NEW.selected_input_hashes) GROUP BY value HAVING count(*)>1) BEGIN SELECT RAISE(ABORT,'disclosure input hashes must be nonempty and unique'); END;
CREATE TRIGGER outbound_disclosures_input_hashes_nonempty_update BEFORE UPDATE OF selected_input_hashes ON outbound_disclosures WHEN json_array_length(NEW.selected_input_hashes)=0 OR EXISTS (SELECT value FROM json_each(NEW.selected_input_hashes) GROUP BY value HAVING count(*)>1) BEGIN SELECT RAISE(ABORT,'disclosure input hashes must be nonempty and unique'); END;
CREATE TRIGGER runner_registrations_revoked_immutable BEFORE UPDATE ON runner_registrations WHEN OLD.status='revoked' BEGIN SELECT RAISE(ABORT,'revoked runner registration is immutable'); END;
`

const jobSchedulingSql = `
ALTER TABLE durable_jobs ADD COLUMN retry_class TEXT NOT NULL DEFAULT 'local' CHECK(retry_class IN ('local','external'));
ALTER TABLE durable_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0);
ALTER TABLE durable_jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 1 CHECK(max_attempts>0);
ALTER TABLE durable_jobs ADD COLUMN next_attempt_at TEXT;
ALTER TABLE durable_jobs ADD COLUMN cancellation_requested_at TEXT;
ALTER TABLE durable_jobs ADD COLUMN last_error_code TEXT CHECK(last_error_code IS NULL OR (length(last_error_code)>0 AND last_error_code GLOB '[a-z0-9_]*' AND last_error_code NOT GLOB '*[^a-z0-9_]*'));
ALTER TABLE durable_jobs ADD COLUMN last_error_message TEXT CHECK(last_error_message IS NULL OR (length(last_error_message)>0 AND length(last_error_message)<=1024));
CREATE INDEX durable_jobs_claim_idx ON durable_jobs(state,next_attempt_at,created_at);
CREATE TRIGGER durable_jobs_terminal_immutable BEFORE UPDATE ON durable_jobs WHEN OLD.state IN ('succeeded','failed','cancelled') BEGIN SELECT RAISE(ABORT,'terminal durable job is immutable'); END;
CREATE TRIGGER durable_job_events_immutable_update BEFORE UPDATE ON durable_job_events BEGIN SELECT RAISE(ABORT,'durable job events are immutable'); END;
CREATE TRIGGER durable_job_events_immutable_delete BEFORE DELETE ON durable_job_events BEGIN SELECT RAISE(ABORT,'durable job events are immutable'); END;
`

const jobRetentionSql = `
DROP TRIGGER durable_job_events_immutable_delete;
CREATE TRIGGER durable_job_events_audit_immutable_delete BEFORE DELETE ON durable_job_events WHEN OLD.event_kind!='progress' BEGIN SELECT RAISE(ABORT,'durable job audit event is immutable'); END;
`

const jobEventCursorSql = `
CREATE TABLE durable_job_event_cursors (job_id TEXT PRIMARY KEY REFERENCES durable_jobs(id) ON DELETE RESTRICT, next_sequence INTEGER NOT NULL CHECK(next_sequence>0));
CREATE TABLE durable_job_event_replay_watermarks (job_id TEXT PRIMARY KEY REFERENCES durable_jobs(id) ON DELETE RESTRICT, minimum_resume_sequence INTEGER NOT NULL CHECK(minimum_resume_sequence>0));
INSERT INTO durable_job_event_cursors (job_id,next_sequence) SELECT j.id,COALESCE(MAX(e.sequence),0)+1 FROM durable_jobs j LEFT JOIN durable_job_events e ON e.job_id=j.id GROUP BY j.id;
CREATE TRIGGER durable_job_events_cursor_insert AFTER INSERT ON durable_job_events BEGIN INSERT INTO durable_job_event_cursors (job_id,next_sequence) VALUES (NEW.job_id,NEW.sequence+1) ON CONFLICT(job_id) DO UPDATE SET next_sequence=MAX(next_sequence,NEW.sequence+1); END;
CREATE TRIGGER durable_job_events_terminal_consistency BEFORE INSERT ON durable_job_events WHEN EXISTS (SELECT 1 FROM durable_jobs WHERE id=NEW.job_id AND state IN ('succeeded','failed','cancelled')) BEGIN SELECT CASE WHEN NEW.event_kind!=(SELECT state FROM durable_jobs WHERE id=NEW.job_id) THEN RAISE(ABORT,'terminal event does not match job state') END; SELECT CASE WHEN EXISTS (SELECT 1 FROM durable_job_events WHERE job_id=NEW.job_id AND event_kind IN ('succeeded','failed','cancelled')) THEN RAISE(ABORT,'terminal event already exists') END; END;
`

const jobExecutionTargetSql = `
ALTER TABLE durable_jobs ADD COLUMN execution_target TEXT NOT NULL DEFAULT 'app' CHECK(execution_target IN ('app','runner'));
CREATE INDEX durable_jobs_target_claim_idx ON durable_jobs(execution_target,state,next_attempt_at,created_at);
`

const providerRunTransitionsSql = `
CREATE TRIGGER provider_runs_terminal_immutable BEFORE UPDATE ON provider_runs WHEN OLD.status IN ('succeeded','failed','cancelled') BEGIN SELECT RAISE(ABORT,'terminal provider run is immutable'); END;
CREATE TRIGGER provider_runs_running_transition BEFORE UPDATE ON provider_runs WHEN OLD.status='running' AND NEW.status NOT IN ('succeeded','failed','cancelled') BEGIN SELECT RAISE(ABORT,'provider run transition invalid'); END;
`

const consentArtifactsSql = `
CREATE TABLE disclosure_confirmations (id TEXT PRIMARY KEY, nonce TEXT NOT NULL UNIQUE, provider_id TEXT NOT NULL, provider_mode TEXT NOT NULL CHECK(provider_mode IN ('api','runner','test')), model TEXT NOT NULL, action TEXT NOT NULL, capability TEXT NOT NULL CHECK(capability IN ('generation','structured_output','cited_research')), research_enabled INTEGER NOT NULL CHECK(research_enabled IN (0,1)), request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash GLOB '[0-9a-f]*' AND request_hash NOT GLOB '*[^0-9a-f]*'), provider_fingerprint TEXT NOT NULL CHECK(length(provider_fingerprint)=64 AND provider_fingerprint GLOB '[0-9a-f]*' AND provider_fingerprint NOT GLOB '*[^0-9a-f]*'), input_manifest_json TEXT NOT NULL CHECK(json_valid(input_manifest_json)), input_hashes_json TEXT NOT NULL CHECK(json_valid(input_hashes_json)), manifest_hash TEXT NOT NULL CHECK(length(manifest_hash)=64 AND manifest_hash GLOB '[0-9a-f]*' AND manifest_hash NOT GLOB '*[^0-9a-f]*'), confirmed_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, bound_run_id TEXT UNIQUE);
CREATE INDEX disclosure_confirmations_active_idx ON disclosure_confirmations(provider_id,expires_at,consumed_at);
CREATE TABLE draft_artifact_series (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('cover_letter','resume','interview_brief','application_answer')), status TEXT NOT NULL CHECK(status IN ('draft','archived','deleted')), created_at TEXT NOT NULL, archived_at TEXT, deleted_at TEXT);
 CREATE TABLE draft_artifact_revisions (id TEXT PRIMARY KEY, series_id TEXT NOT NULL REFERENCES draft_artifact_series(id) ON DELETE RESTRICT, revision_number INTEGER NOT NULL CHECK(revision_number>0), provider_run_id TEXT REFERENCES provider_runs(id) ON DELETE SET NULL, disclosure_id TEXT REFERENCES disclosure_confirmations(id) ON DELETE SET NULL, provider_id TEXT NOT NULL, provider_mode TEXT NOT NULL CHECK(provider_mode IN ('api','runner','test')), provider_model TEXT NOT NULL, provider_capability_revision TEXT NOT NULL CHECK(length(provider_capability_revision)=64 AND provider_capability_revision GLOB '[0-9a-f]*' AND provider_capability_revision NOT GLOB '*[^0-9a-f]*'), prompt_template_id TEXT NOT NULL, prompt_template_revision TEXT NOT NULL, content_hash TEXT NOT NULL CHECK(length(content_hash)=64 AND content_hash GLOB '[0-9a-f]*' AND content_hash NOT GLOB '*[^0-9a-f]*'), content_json TEXT NOT NULL CHECK(json_valid(content_json)), created_at TEXT NOT NULL, UNIQUE(series_id,revision_number));
CREATE TABLE draft_artifact_inputs (revision_id TEXT NOT NULL REFERENCES draft_artifact_revisions(id) ON DELETE RESTRICT, input_kind TEXT NOT NULL, input_ref_json TEXT NOT NULL CHECK(json_valid(input_ref_json)), source_hash TEXT NOT NULL CHECK(length(source_hash)=64 AND source_hash GLOB '[0-9a-f]*' AND source_hash NOT GLOB '*[^0-9a-f]*'), source_label TEXT NOT NULL, source_version INTEGER, parent_current_id TEXT, PRIMARY KEY(revision_id,input_kind,input_ref_json));
CREATE INDEX draft_artifact_revisions_series_idx ON draft_artifact_revisions(series_id,revision_number DESC);
CREATE TRIGGER disclosure_confirmations_immutable BEFORE UPDATE ON disclosure_confirmations WHEN OLD.consumed_at IS NOT NULL OR NEW.provider_id!=OLD.provider_id OR NEW.provider_mode!=OLD.provider_mode OR NEW.model!=OLD.model OR NEW.action!=OLD.action OR NEW.capability!=OLD.capability OR NEW.request_hash!=OLD.request_hash OR NEW.input_manifest_json!=OLD.input_manifest_json OR NEW.input_hashes_json!=OLD.input_hashes_json OR NEW.manifest_hash!=OLD.manifest_hash BEGIN SELECT RAISE(ABORT,'disclosure confirmation is immutable'); END;
CREATE TRIGGER draft_artifact_revisions_immutable BEFORE UPDATE ON draft_artifact_revisions BEGIN SELECT RAISE(ABORT,'draft artifact revision is immutable'); END;
CREATE TRIGGER draft_artifact_revisions_no_delete BEFORE DELETE ON draft_artifact_revisions BEGIN SELECT RAISE(ABORT,'draft artifact revision is immutable'); END;
CREATE TRIGGER draft_artifact_inputs_immutable_update BEFORE UPDATE ON draft_artifact_inputs BEGIN SELECT RAISE(ABORT,'draft artifact input is immutable'); END;
CREATE TRIGGER draft_artifact_inputs_immutable_delete BEFORE DELETE ON draft_artifact_inputs BEGIN SELECT RAISE(ABORT,'draft artifact input is immutable'); END;
`

const consentArtifactIntegritySql = `
DROP TRIGGER disclosure_confirmations_immutable;
CREATE TRIGGER disclosure_confirmations_immutable BEFORE UPDATE ON disclosure_confirmations WHEN NOT (OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL AND OLD.bound_run_id IS NULL AND NEW.bound_run_id IS NOT NULL AND NEW.nonce=OLD.nonce AND NEW.provider_id=OLD.provider_id AND NEW.provider_mode=OLD.provider_mode AND NEW.model=OLD.model AND NEW.action=OLD.action AND NEW.capability=OLD.capability AND NEW.research_enabled=OLD.research_enabled AND NEW.request_hash=OLD.request_hash AND NEW.provider_fingerprint=OLD.provider_fingerprint AND NEW.input_manifest_json=OLD.input_manifest_json AND NEW.input_hashes_json=OLD.input_hashes_json AND NEW.manifest_hash=OLD.manifest_hash AND NEW.confirmed_at=OLD.confirmed_at AND NEW.expires_at=OLD.expires_at) BEGIN SELECT RAISE(ABORT,'disclosure confirmation is immutable'); END;
CREATE TABLE draft_artifact_content_hashes (content_hash TEXT PRIMARY KEY CHECK(length(content_hash)=64 AND content_hash GLOB '[0-9a-f]*' AND content_hash NOT GLOB '*[^0-9a-f]*'), content_json TEXT NOT NULL CHECK(json_valid(content_json)), UNIQUE(content_hash,content_json));
CREATE TRIGGER draft_artifact_series_lifecycle BEFORE UPDATE OF status ON draft_artifact_series WHEN OLD.status='deleted' OR (OLD.status='draft' AND NEW.status NOT IN ('archived','deleted')) OR (OLD.status='archived' AND NEW.status!='deleted') BEGIN SELECT RAISE(ABORT,'draft artifact series lifecycle is immutable'); END;
CREATE TRIGGER draft_artifact_revisions_active_series BEFORE INSERT ON draft_artifact_revisions WHEN NOT EXISTS (SELECT 1 FROM draft_artifact_series WHERE id=NEW.series_id AND status='draft') BEGIN SELECT RAISE(ABORT,'draft artifact series unavailable'); END;
CREATE TRIGGER draft_artifact_revisions_content_hash BEFORE INSERT ON draft_artifact_revisions WHEN NOT EXISTS (SELECT 1 FROM draft_artifact_content_hashes WHERE content_hash=NEW.content_hash AND content_json=NEW.content_json) BEGIN SELECT RAISE(ABORT,'draft artifact content hash invalid'); END;
`

const documentLibrarySql = `
ALTER TABLE document_versions ADD COLUMN display_name TEXT;
ALTER TABLE document_versions ADD COLUMN media_type TEXT;
ALTER TABLE document_versions ADD COLUMN byte_size INTEGER CHECK(byte_size IS NULL OR byte_size>=0);
ALTER TABLE document_versions ADD COLUMN extraction_status TEXT NOT NULL DEFAULT 'completed' CHECK(extraction_status IN ('completed','failed'));
ALTER TABLE document_versions ADD COLUMN extraction_error TEXT CHECK(extraction_error IS NULL OR length(extraction_error)<=64);
ALTER TABLE document_versions ADD COLUMN extracted_text TEXT;
CREATE TABLE profile_document_selections (document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE RESTRICT, selected_at TEXT NOT NULL);
CREATE INDEX profile_document_selections_selected_idx ON profile_document_selections(selected_at,document_id);
`

const applicationPipelineSql = `
ALTER TABLE job_posts ADD COLUMN team_name TEXT;
ALTER TABLE job_posts ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json));
CREATE TABLE pipeline_stages (id TEXT PRIMARY KEY, stage_key TEXT NOT NULL UNIQUE CHECK(length(trim(stage_key))>0), name TEXT NOT NULL CHECK(length(trim(name))>0), position INTEGER NOT NULL UNIQUE CHECK(position>0), outcome TEXT CHECK(outcome IS NULL OR outcome IN ('offered','rejected','withdrawn')), is_system INTEGER NOT NULL DEFAULT 0 CHECK(is_system IN (0,1)), created_at TEXT NOT NULL);
INSERT INTO pipeline_stages (id,stage_key,name,position,outcome,is_system,created_at) VALUES
  ('00000000-0000-4000-8000-000000000001','saved','Saved',1,NULL,1,datetime('now')),
  ('00000000-0000-4000-8000-000000000002','applied','Applied',2,NULL,1,datetime('now')),
  ('00000000-0000-4000-8000-000000000003','interviewing','Interviewing',3,NULL,1,datetime('now')),
  ('00000000-0000-4000-8000-000000000004','offered','Offered',4,'offered',1,datetime('now')),
  ('00000000-0000-4000-8000-000000000005','rejected','Rejected',5,'rejected',1,datetime('now')),
  ('00000000-0000-4000-8000-000000000006','withdrawn','Withdrawn',6,'withdrawn',1,datetime('now'));
ALTER TABLE applications ADD COLUMN current_stage_id TEXT REFERENCES pipeline_stages(id) ON DELETE RESTRICT;
ALTER TABLE applications ADD COLUMN applied_at TEXT;
ALTER TABLE applications ADD COLUMN outcome_at TEXT;
UPDATE applications SET current_stage_id=(SELECT id FROM pipeline_stages WHERE stage_key=applications.status);
CREATE TABLE application_interviews (id TEXT PRIMARY KEY,application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,scheduled_at TEXT NOT NULL,ended_at TEXT,interview_kind TEXT NOT NULL CHECK(length(trim(interview_kind))>0),location TEXT,notes TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,CHECK(ended_at IS NULL OR ended_at>=scheduled_at));
CREATE INDEX application_interviews_application_idx ON application_interviews(application_id,scheduled_at,id);
CREATE TRIGGER pipeline_stages_no_delete_in_use BEFORE DELETE ON pipeline_stages WHEN EXISTS (SELECT 1 FROM applications WHERE current_stage_id=OLD.id) BEGIN SELECT RAISE(ABORT,'pipeline stage in use'); END;
CREATE TRIGGER application_events_immutable_update BEFORE UPDATE ON application_events BEGIN SELECT RAISE(ABORT,'application events are immutable'); END;
CREATE TRIGGER application_events_immutable_delete BEFORE DELETE ON application_events BEGIN SELECT RAISE(ABORT,'application events are immutable'); END;
CREATE TRIGGER job_post_versions_immutable_update BEFORE UPDATE ON job_post_versions BEGIN SELECT RAISE(ABORT,'job post versions are immutable'); END;
CREATE TRIGGER job_post_versions_immutable_delete BEFORE DELETE ON job_post_versions BEGIN SELECT RAISE(ABORT,'job post versions are immutable'); END;
`

const citedResearchSql = `
ALTER TABLE research_records ADD COLUMN subject_type TEXT CHECK(subject_type IS NULL OR subject_type IN ('company','executive','team_lead','team_member'));
ALTER TABLE research_records ADD COLUMN subject_name TEXT;
ALTER TABLE research_records ADD COLUMN parent_record_id TEXT REFERENCES research_records(id) ON DELETE RESTRICT;
ALTER TABLE research_records ADD COLUMN identity_status TEXT CHECK(identity_status IS NULL OR identity_status IN ('confirmed','ambiguous','not_found'));
ALTER TABLE research_records ADD COLUMN identity_candidates_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(identity_candidates_json) AND json_type(identity_candidates_json)='array');
ALTER TABLE research_records ADD COLUMN analysis_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(analysis_json) AND json_type(analysis_json)='object');
CREATE TABLE research_claims (id TEXT PRIMARY KEY,research_record_id TEXT NOT NULL REFERENCES research_records(id) ON DELETE RESTRICT,statement TEXT NOT NULL CHECK(length(trim(statement))>0),classification TEXT NOT NULL CHECK(classification IN ('fact','inference','advisory','unverified')),source_ids_json TEXT NOT NULL CHECK(json_valid(source_ids_json) AND json_type(source_ids_json)='array'),confidence TEXT NOT NULL CHECK(confidence IN ('high','medium','low')),created_at TEXT NOT NULL);
CREATE INDEX research_claims_record_idx ON research_claims(research_record_id,created_at,id);
CREATE TRIGGER research_claims_sources_valid BEFORE INSERT ON research_claims WHEN EXISTS (SELECT 1 FROM json_each(NEW.source_ids_json) entry WHERE entry.type!='text' OR NOT EXISTS (SELECT 1 FROM research_sources source WHERE source.id=entry.value AND source.research_record_id=NEW.research_record_id AND source.status='available')) BEGIN SELECT RAISE(ABORT,'research claim source missing'); END;
CREATE TRIGGER research_claims_fact_cited BEFORE INSERT ON research_claims WHEN NEW.classification='fact' AND json_array_length(NEW.source_ids_json)=0 BEGIN SELECT RAISE(ABORT,'research fact requires citation'); END;
CREATE TRIGGER research_claims_immutable_update BEFORE UPDATE ON research_claims BEGIN SELECT RAISE(ABORT,'research claims are immutable'); END;
CREATE TRIGGER research_claims_immutable_delete BEFORE DELETE ON research_claims BEGIN SELECT RAISE(ABORT,'research claims are immutable'); END;
CREATE TRIGGER research_records_analysis_immutable BEFORE UPDATE OF subject_type,subject_name,parent_record_id,identity_status,identity_candidates_json,analysis_json ON research_records BEGIN SELECT RAISE(ABORT,'research analysis is immutable'); END;
`

export const migrations: readonly Migration[] = [
  { id: "0001_core", sql: schemaSql },
  { id: "0002_provenance", sql: provenanceSql },
  { id: "0003_execution", sql: executionSql },
  { id: "0004_job_scheduling", sql: jobSchedulingSql },
  { id: "0005_job_retention", sql: jobRetentionSql },
  { id: "0006_job_event_cursors", sql: jobEventCursorSql },
  { id: "0007_job_execution_target", sql: jobExecutionTargetSql },
  { id: "0008_provider_run_transitions", sql: providerRunTransitionsSql },
  { id: "0009_consent_artifacts", sql: consentArtifactsSql },
  { id: "0010_consent_artifact_integrity", sql: consentArtifactIntegritySql },
  { id: "0011_document_library", sql: documentLibrarySql },
  { id: "0012_application_pipeline", sql: applicationPipelineSql },
  { id: "0013_cited_research", sql: citedResearchSql }
]

export const migrationChecksum = (migration: Migration): string =>
  createHash("sha256").update(migration.id).update("\0").update(migration.sql).digest("hex")
