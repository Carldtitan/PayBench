-- PayBench contract v2. This migration is additive and intentionally contains
-- no Terac API identifiers or launch procedure. The only supported mode is mock.

alter table public.jobs
  add column if not exists target_customer_description text,
  add column if not exists target_customer_spec_json jsonb,
  add column if not exists screening_spec_json jsonb,
  add column if not exists source_bundle_hash text,
  add column if not exists artifact_bundle_hash text;

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check check (status in (
  'awaiting_confirmation', 'awaiting_payment', 'paid', 'capturing',
  'needs_scout', 'spec_ready', 'building_variants', 'quality_check',
  'qa_replay', 'awaiting_approvals', 'pilot', 'recruiting', 'testing',
  'analyzing', 'report_ready', 'delivered', 'failed'
));

alter table public.paywall_specs
  add column if not exists source_hash text,
  add column if not exists locked_facts_json jsonb,
  add column if not exists locked_facts_hash text,
  add column if not exists schema_version text not null default '2';

alter table public.variants
  add column if not exists spec_hash text,
  add column if not exists locked_facts_hash text,
  add column if not exists change_plan_hash text;

create table if not exists public.funding_quotes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  participant_count integer not null default 10 check (participant_count = 10),
  reward_cents integer not null default 500 check (reward_cents = 500),
  participant_subtotal_cents integer not null default 5000 check (participant_subtotal_cents = 5000),
  terac_platform_fee_cents integer not null check (terac_platform_fee_cents >= 0),
  total_required_cents integer generated always as (participant_subtotal_cents + terac_platform_fee_cents) stored,
  currency text not null default 'USD' check (currency = 'USD'),
  funding_source text not null default 'sponsor_credits' check (funding_source = 'sponsor_credits'),
  credits_confirmed boolean not null default false,
  quote_hash text not null,
  quoted_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists public.change_plans (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  source_spec_hash text not null,
  locked_facts_hash text not null,
  plan_json jsonb not null,
  plan_hash text not null,
  operation_count integer not null default 1 check (operation_count = 1),
  created_at timestamptz not null default now()
);

create table if not exists public.variant_work_surfaces (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  variant_label text not null check (variant_label in ('A', 'B')),
  superserve_sandbox_id text not null,
  preview_access text not null default 'operator_private' check (preview_access = 'operator_private'),
  latest_preview_path text,
  status text not null default 'queued' check (status in ('queued', 'working', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, variant_label)
);

create table if not exists public.quality_gate_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  artifact_bundle_hash text not null,
  checks_json jsonb not null,
  replay_run_id text,
  replay_run_url text,
  replay_blocking_findings integer not null default 0 check (replay_blocking_findings >= 0),
  gate_open boolean not null default false,
  checked_at timestamptz not null default now(),
  unique (job_id, artifact_bundle_hash)
);

create table if not exists public.operator_approvals (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  approval_kind text not null check (approval_kind in ('pages', 'terac_quote')),
  artifact_bundle_hash text not null,
  approved_by text not null,
  approved_at timestamptz not null default now(),
  invalidated_at timestamptz,
  unique (job_id, approval_kind, artifact_bundle_hash)
);

alter table public.studies
  add column if not exists opaque_token_hash text,
  add column if not exists token_expires_at timestamptz,
  add column if not exists target_customer_spec_json jsonb,
  add column if not exists screening_spec_json jsonb,
  add column if not exists audience_mode text not null default 'screened_target_customer',
  add column if not exists approved_reward_cents integer not null default 500,
  add column if not exists participant_budget_before_fees_cents integer not null default 5000,
  add column if not exists estimated_minutes integer not null default 10,
  add column if not exists evidence_standard text not null default 'directional_not_statistically_significant',
  add column if not exists phase text not null default 'locked',
  add column if not exists external_redirect_base_url text,
  add column if not exists artifact_bundle_hash text;

alter table public.studies drop constraint if exists studies_status_check;
alter table public.studies add constraint studies_status_check check (status in (
  'draft', 'qa', 'awaiting_approvals', 'pilot', 'recruiting', 'complete', 'insufficient_evidence', 'failed'
));
alter table public.studies add constraint studies_contract_v2_counts_check
  check (target_sample_size = 10 and minimum_valid_per_variant = 5);
alter table public.studies add constraint studies_contract_v2_economics_check
  check (approved_reward_cents = 500 and participant_budget_before_fees_cents = 5000 and estimated_minutes = 10);
alter table public.studies add constraint studies_contract_v2_audience_check
  check (audience_mode = 'screened_target_customer');
alter table public.studies add constraint studies_contract_v2_phase_check
  check (phase in ('locked', 'pilot', 'main', 'complete'));
alter table public.studies add constraint studies_contract_v2_evidence_check
  check (evidence_standard = 'directional_not_statistically_significant');
create unique index if not exists studies_opaque_token_hash_idx on public.studies (opaque_token_hash) where opaque_token_hash is not null;

create table if not exists public.study_assignment_slots (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies(id) on delete cascade,
  slot_number integer not null check (slot_number between 1 and 10),
  cohort text not null check (cohort in ('pilot', 'main')),
  variant_label text not null check (variant_label in ('A', 'B')),
  shuffle_key integer not null,
  claimed_session_id uuid,
  claimed_at timestamptz,
  unlocked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (study_id, slot_number)
);

alter table public.participant_sessions
  add column if not exists assignment_slot_id uuid references public.study_assignment_slots(id),
  add column if not exists session_cookie_hash text,
  add column if not exists terac_submission_hmac text,
  add column if not exists terac_submission_ciphertext text,
  add column if not exists completion_method text,
  add column if not exists redirect_state text not null default 'not_attempted',
  add column if not exists redirected_at timestamptz,
  add column if not exists decision text,
  add column if not exists decision_at timestamptz,
  add column if not exists survey_completed_at timestamptz,
  add column if not exists is_pilot boolean not null default false;

alter table public.participant_sessions drop constraint if exists participant_sessions_completion_method_check;
alter table public.participant_sessions add constraint participant_sessions_completion_method_check
  check (completion_method is null or completion_method in ('external_redirect', 'pb_fallback'));
alter table public.participant_sessions drop constraint if exists participant_sessions_redirect_state_check;
alter table public.participant_sessions add constraint participant_sessions_redirect_state_check
  check (redirect_state in ('not_attempted', 'mocked', 'failed', 'fallback_issued'));
alter table public.participant_sessions drop constraint if exists participant_sessions_decision_check;
alter table public.participant_sessions add constraint participant_sessions_decision_check
  check (decision is null or decision in ('continue', 'stop'));
create unique index if not exists participant_sessions_slot_idx on public.participant_sessions (assignment_slot_id) where assignment_slot_id is not null;
create unique index if not exists participant_sessions_cookie_idx on public.participant_sessions (session_cookie_hash) where session_cookie_hash is not null;
create unique index if not exists participant_sessions_terac_submission_idx on public.participant_sessions (terac_submission_hmac) where terac_submission_hmac is not null;

alter table public.reports drop constraint if exists reports_result_check;
alter table public.reports add constraint reports_result_check check (result in (
  'a_stronger_signal', 'b_stronger_signal', 'no_clear_signal', 'insufficient_evidence'
));
alter table public.reports
  add column if not exists directional_only boolean not null default true,
  add column if not exists valid_session_count integer not null default 0,
  add column if not exists a_valid_count integer not null default 0,
  add column if not exists b_valid_count integer not null default 0;
alter table public.reports add constraint reports_directional_only_check check (directional_only = true);
alter table public.reports add constraint reports_valid_counts_check check (
  valid_session_count between 0 and 10 and
  a_valid_count between 0 and 5 and
  b_valid_count between 0 and 5 and
  valid_session_count = a_valid_count + b_valid_count
);

create table if not exists public.terac_transport_settings (
  singleton boolean primary key default true check (singleton = true),
  mode text not null default 'mock' check (mode = 'mock'),
  live_disabled boolean not null default true check (live_disabled = true),
  updated_at timestamptz not null default now()
);
insert into public.terac_transport_settings (singleton, mode, live_disabled)
values (true, 'mock', true)
on conflict (singleton) do update set mode = 'mock', live_disabled = true, updated_at = now();

create or replace function public.claim_study_slot(
  requested_study_token_hash text,
  requested_session_cookie_hash text,
  requested_participant_token_hash text,
  requested_terac_submission_hmac text default null,
  requested_terac_submission_ciphertext text default null
)
returns table (participant_session_id uuid, assigned_variant_label text, pilot boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_study public.studies%rowtype;
  selected_slot public.study_assignment_slots%rowtype;
  selected_variant_id uuid;
  created_session_id uuid;
begin
  select * into selected_study
  from public.studies
  where opaque_token_hash = requested_study_token_hash
    and token_expires_at > now()
    and phase in ('pilot', 'main')
  for update;

  if not found then
    raise exception 'STUDY_NOT_AVAILABLE';
  end if;

  select * into selected_slot
  from public.study_assignment_slots
  where study_id = selected_study.id
    and claimed_session_id is null
    and unlocked_at is not null
    and cohort = case when selected_study.phase = 'pilot' then 'pilot' else 'main' end
  order by shuffle_key, slot_number
  for update skip locked
  limit 1;

  if not found then
    raise exception 'NO_STUDY_SLOTS_AVAILABLE';
  end if;

  select id into selected_variant_id
  from public.variants
  where job_id = selected_study.job_id and label = selected_slot.variant_label;

  if selected_variant_id is null then
    raise exception 'VARIANT_NOT_READY';
  end if;

  insert into public.participant_sessions (
    study_id,
    participant_token_hash,
    assigned_variant_id,
    assignment_slot_id,
    session_cookie_hash,
    terac_submission_hmac,
    terac_submission_ciphertext,
    is_pilot
  ) values (
    selected_study.id,
    requested_participant_token_hash,
    selected_variant_id,
    selected_slot.id,
    requested_session_cookie_hash,
    requested_terac_submission_hmac,
    requested_terac_submission_ciphertext,
    selected_slot.cohort = 'pilot'
  ) returning id into created_session_id;

  update public.study_assignment_slots
  set claimed_session_id = created_session_id, claimed_at = now()
  where id = selected_slot.id;

  return query select created_session_id, selected_slot.variant_label, selected_slot.cohort = 'pilot';
end;
$$;

revoke all on function public.claim_study_slot(text, text, text, text, text) from public, anon, authenticated;

create index if not exists funding_quotes_job_idx on public.funding_quotes (job_id);
create index if not exists quality_gate_runs_job_time_idx on public.quality_gate_runs (job_id, checked_at desc);
create index if not exists approvals_job_kind_idx on public.operator_approvals (job_id, approval_kind, approved_at desc);
create index if not exists assignment_slots_claim_idx on public.study_assignment_slots (study_id, cohort, unlocked_at, claimed_session_id);

alter table public.funding_quotes enable row level security;
alter table public.change_plans enable row level security;
alter table public.variant_work_surfaces enable row level security;
alter table public.quality_gate_runs enable row level security;
alter table public.operator_approvals enable row level security;
alter table public.study_assignment_slots enable row level security;
alter table public.terac_transport_settings enable row level security;

comment on table public.terac_transport_settings is 'Hard transport guard. Contract v2 supports mock mode only and has no Terac launch procedure.';
comment on column public.participant_sessions.terac_submission_ciphertext is 'Encrypted server-only value. Never return through public participant routes.';
comment on table public.variant_work_surfaces is 'Superserve surfaces are operator-only; participant pages are served by PayBench.';
