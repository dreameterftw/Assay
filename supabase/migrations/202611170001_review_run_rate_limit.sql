create table private.review_run_rate_limits (
  review_id uuid primary key references public.reviews(id) on delete cascade,
  last_run_at timestamptz not null
);

alter table private.review_run_rate_limits enable row level security;
revoke all on private.review_run_rate_limits from public, anon, authenticated;

create function public.assay_claim_review_run_slot(target_review uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare claimed boolean;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  insert into private.review_run_rate_limits(review_id, last_run_at)
  values (target_review, now())
  on conflict (review_id) do update
    set last_run_at = excluded.last_run_at
    where private.review_run_rate_limits.last_run_at <= now() - interval '10 seconds'
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

revoke all on function public.assay_claim_review_run_slot(uuid) from public, anon, authenticated;
grant execute on function public.assay_claim_review_run_slot(uuid) to service_role;
