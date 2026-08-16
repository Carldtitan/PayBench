alter table public.scout_tasks
  add column if not exists task_token_ciphertext text,
  add column if not exists expires_at timestamptz,
  add column if not exists visible_price_text text,
  add column if not exists visible_terms_text text,
  add column if not exists terac_submission_hmac text,
  add column if not exists submission_fingerprint_hash text,
  add column if not exists retry_request_id text;

update public.scout_tasks
set expires_at = coalesce(expires_at, created_at + interval '24 hours')
where expires_at is null;

alter table public.scout_tasks
  alter column expires_at set not null;

create index if not exists scout_tasks_job_created_idx
  on public.scout_tasks (job_id, created_at desc);

create index if not exists scout_tasks_expiry_idx
  on public.scout_tasks (expires_at)
  where quality_status = 'pending';

create unique index if not exists scout_tasks_terac_submission_hmac_uidx
  on public.scout_tasks (terac_submission_hmac)
  where terac_submission_hmac is not null;

create unique index if not exists scout_tasks_retry_request_uidx
  on public.scout_tasks (retry_request_id)
  where retry_request_id is not null;

comment on column public.scout_tasks.task_token_ciphertext is
  'Server-encrypted opaque scout token. Never return from public APIs except as its task URL.';

comment on column public.scout_tasks.confirmation_code_hash is
  'One-way hash of the deterministic PB-SCOUT fallback code. Plaintext is never stored.';

comment on column public.scout_tasks.terac_submission_hmac is
  'Optional HMAC of an external Terac submission ID. The raw identifier is never stored.';
