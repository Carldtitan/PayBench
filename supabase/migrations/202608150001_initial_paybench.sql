create extension if not exists pgcrypto;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  linq_handle_hash text unique,
  stripe_email_hash text,
  created_at timestamptz not null default now(),
  last_active_at timestamptz,
  opt_out_status boolean not null default false
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  linq_chat_id text unique,
  state text not null default 'active',
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  submitted_url text not null,
  normalized_url text not null,
  status text not null check (status in (
    'awaiting_confirmation', 'awaiting_payment', 'paid', 'capturing',
    'needs_scout', 'spec_ready', 'building_variants', 'quality_check',
    'recruiting', 'testing', 'analyzing', 'replay_qa', 'report_ready',
    'delivered', 'failed'
  )),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'pending', 'paid', 'failed', 'refunded')),
  amount_paid_cents integer not null default 0 check (amount_paid_cents >= 0),
  currency text not null default 'USD' check (char_length(currency) = 3),
  stripe_checkout_session_id text unique,
  superserve_sandbox_id text,
  capture_confidence numeric(5, 4),
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.website_captures (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  final_url text not null,
  captured_at timestamptz not null,
  desktop_screenshot_path text,
  mobile_screenshot_path text,
  dom_path text,
  console_log_path text,
  checksum text not null,
  created_at timestamptz not null default now()
);

create table public.paywall_specs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  version integer not null,
  spec_json jsonb not null,
  source_evidence_json jsonb not null,
  confidence numeric(5, 4) not null,
  created_at timestamptz not null default now(),
  unique (job_id, version)
);

create table public.variants (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  label text not null check (label in ('A', 'B')),
  hypothesis text,
  component_tree_json jsonb not null,
  screenshot_path text,
  preview_path text,
  quality_status text not null default 'pending' check (quality_status in ('pending', 'valid', 'flagged', 'rejected', 'technical_failure')),
  created_at timestamptz not null default now(),
  unique (job_id, label)
);

create table public.studies (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  terac_study_id text unique,
  target_sample_size integer not null check (target_sample_size > 0),
  minimum_valid_per_variant integer not null check (minimum_valid_per_variant > 0),
  assignment_mode text not null default 'balanced_random',
  primary_metric text not null,
  status text not null default 'draft' check (status in ('draft', 'recruiting', 'complete', 'insufficient_sample', 'failed')),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.participant_sessions (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies(id) on delete cascade,
  participant_token_hash text not null unique,
  assigned_variant_id uuid not null references public.variants(id),
  confirmation_code_hash text unique,
  confirmation_code_used_at timestamptz,
  quality_status text not null default 'pending' check (quality_status in ('pending', 'valid', 'flagged', 'rejected', 'technical_failure')),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.behavior_events (
  id uuid primary key default gen_random_uuid(),
  participant_session_id uuid not null references public.participant_sessions(id) on delete cascade,
  variant_id uuid not null references public.variants(id),
  event_name text not null check (event_name in (
    'page_view', 'first_interaction', 'plan_selected', 'primary_action_clicked',
    'stop_action_clicked', 'field_focused', 'field_corrected', 'validation_error',
    'back_navigation', 'simulated_purchase_completed', 'survey_submitted', 'technical_error'
  )),
  event_time timestamptz not null,
  sequence_number integer not null check (sequence_number >= 0),
  element_key text,
  metadata_json jsonb not null default '{}'::jsonb,
  unique (participant_session_id, sequence_number)
);

create table public.participant_feedback (
  id uuid primary key default gen_random_uuid(),
  participant_session_id uuid not null unique references public.participant_sessions(id) on delete cascade,
  variant_id uuid not null references public.variants(id),
  understood_offer_text text not null,
  understood_price_terms_text text not null,
  hesitation_text text not null,
  clarity_score smallint not null check (clarity_score between 1 and 5),
  trust_score smallint not null check (trust_score between 1 and 5),
  would_continue_with_real_money boolean not null,
  continuation_reason_text text not null,
  created_at timestamptz not null default now()
);

create table public.scout_tasks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  terac_task_id text unique,
  task_token_hash text not null unique,
  target_url text not null,
  final_url text,
  click_path_json jsonb,
  visible_offer_text text,
  artifact_paths jsonb not null default '[]'::jsonb,
  blocker_text text,
  confirmation_code_hash text unique,
  quality_status text not null default 'pending' check (quality_status in ('pending', 'valid', 'flagged', 'rejected', 'technical_failure')),
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  result text not null check (result in ('a_wins', 'b_wins', 'no_clear_winner', 'insufficient_sample')),
  metrics_json jsonb not null,
  report_path text not null,
  public_token_hash text unique,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  request_id text not null unique,
  callback_id text unique,
  command_type text not null,
  result_type text,
  stage text not null,
  model text,
  input_artifact_paths jsonb not null default '[]'::jsonb,
  output_artifact_path text,
  prompt_version text,
  status text not null,
  error_code text,
  safe_progress_json jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.job_transitions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  from_status text,
  to_status text not null,
  stage text not null,
  actor text not null check (actor in ('paybench', 'stripe', 'superserve', 'terac', 'replay', 'linq')),
  reason_code text,
  safe_summary text not null check (char_length(safe_summary) between 1 and 120),
  idempotency_key text not null unique,
  occurred_at timestamptz not null default now()
);

create table public.webhook_events (
  provider text not null,
  external_event_id text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null,
  primary key (provider, external_event_id)
);

create index jobs_customer_updated_idx on public.jobs (customer_id, updated_at desc);
create index captures_job_idx on public.website_captures (job_id, captured_at desc);
create index sessions_study_quality_idx on public.participant_sessions (study_id, quality_status);
create index events_session_time_idx on public.behavior_events (participant_session_id, event_time);
create index transitions_job_time_idx on public.job_transitions (job_id, occurred_at desc);
create index agent_runs_job_time_idx on public.agent_runs (job_id, updated_at desc);

alter table public.customers enable row level security;
alter table public.conversations enable row level security;
alter table public.jobs enable row level security;
alter table public.website_captures enable row level security;
alter table public.paywall_specs enable row level security;
alter table public.variants enable row level security;
alter table public.studies enable row level security;
alter table public.participant_sessions enable row level security;
alter table public.behavior_events enable row level security;
alter table public.participant_feedback enable row level security;
alter table public.scout_tasks enable row level security;
alter table public.reports enable row level security;
alter table public.agent_runs enable row level security;
alter table public.job_transitions enable row level security;
alter table public.webhook_events enable row level security;

comment on table public.job_transitions is 'Append-only safe workflow events for orchestration and the internal dashboard.';
comment on column public.agent_runs.safe_progress_json is 'Allow-listed dashboard progress only; never secrets, raw codes, or survey free text.';
