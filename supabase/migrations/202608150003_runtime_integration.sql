alter table public.studies
  add column if not exists opaque_token_ciphertext text;

alter table public.reports
  add column if not exists public_token_ciphertext text;

comment on column public.studies.opaque_token_ciphertext is
  'Server-encrypted opaque participant token. Never return from public APIs.';

comment on column public.reports.public_token_ciphertext is
  'Server-encrypted founder report token. Never return from public APIs.';
