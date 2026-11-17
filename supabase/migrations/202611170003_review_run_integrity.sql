alter table public.approved_claims
  add column version integer not null default 1 check (version > 0);

alter table public.workspace_invitations
  add column accepted_by uuid references auth.users(id) on delete restrict,
  add constraint workspace_invitation_token_hash_sha256
    check (token_hash ~ '^[0-9a-f]{64}$');

alter table public.review_runs
  add column asset_snapshot jsonb not null default '[]'::jsonb
    check (jsonb_typeof(asset_snapshot) = 'array'),
  add column assets_sha256 text not null default repeat('0', 64)
    check (assets_sha256 ~ '^[0-9a-f]{64}$'),
  add column input_sha256 text not null default repeat('0', 64)
    check (input_sha256 ~ '^[0-9a-f]{64}$'),
  add column snapshot_version integer not null default 0
    check (snapshot_version >= 0);

create function private.assay_review_asset_snapshot(target_review uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'bucket_id', a.bucket_id,
    'object_path', a.object_path,
    'filename', a.filename,
    'mime_type', a.mime_type,
    'size_bytes', a.size_bytes,
    'width', a.width,
    'height', a.height,
    'palette', a.palette,
    'alt_text', a.alt_text,
    'uploaded_by', a.uploaded_by,
    'created_at', to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ) order by a.id), '[]'::jsonb)
  from public.review_assets a
  where a.review_id = target_review;
$$;

create function private.assay_review_assets_sha256(target_review uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(sha256(convert_to(private.assay_review_asset_snapshot(target_review)::text, 'utf8')), 'hex');
$$;

create function private.assay_review_content_sha256(target_content text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(target_content, 'utf8')), 'hex');
$$;

create function private.assay_review_input_sha256(target_content_sha256 text, target_assets_sha256 text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'content_sha256', target_content_sha256,
    'assets_sha256', target_assets_sha256
  )::text, 'utf8')), 'hex');
$$;

revoke all on function private.assay_review_asset_snapshot(uuid) from public, anon, authenticated;
revoke all on function private.assay_review_assets_sha256(uuid) from public, anon, authenticated;
revoke all on function private.assay_review_content_sha256(text) from public, anon, authenticated;
revoke all on function private.assay_review_input_sha256(text,text) from public, anon, authenticated;

create function private.assay_lock_review_asset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_review uuid;
begin
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.review_id is distinct from old.review_id
    or new.object_path is distinct from old.object_path
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Asset identity and review assignment are immutable' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    target_review := old.review_id;
  else
    target_review := new.review_id;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_review::text, 0));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.assay_lock_review_asset() from public, anon, authenticated;
create trigger review_assets_lock_review
  before insert or update or delete on public.review_assets
  for each row execute function private.assay_lock_review_asset();

create function private.assay_increment_claim_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    return new;
  end if;

  new.version := old.version + case when
    new.statement is distinct from old.statement
    or new.value is distinct from old.value
    or new.evidence_label is distinct from old.evidence_label
    or new.evidence_url is distinct from old.evidence_url
    or new.owner_label is distinct from old.owner_label
    or new.reviewed_at is distinct from old.reviewed_at
    or new.expires_at is distinct from old.expires_at
    or new.active is distinct from old.active
  then 1 else 0 end;
  return new;
end;
$$;
revoke all on function private.assay_increment_claim_version() from public, anon, authenticated;
create trigger approved_claims_version
  before insert or update on public.approved_claims
  for each row execute function private.assay_increment_claim_version();

create function public.assay_review_run_inputs(target_review uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  review_row record;
  assets jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  select r.id, r.organization_id, r.content, r.status, r.archived_at, r.rule_set_version
    into review_row
    from public.reviews r
    where r.id = target_review
    for share;
  if not found then return null; end if;

  perform pg_advisory_xact_lock(hashtextextended(review_row.id::text, 0));
  assets := private.assay_review_asset_snapshot(review_row.id);

  return jsonb_build_object(
    'review_id', review_row.id,
    'organization_id', review_row.organization_id,
    'content', review_row.content,
    'status', review_row.status,
    'archived_at', review_row.archived_at,
    'rule_set_version', review_row.rule_set_version,
    'content_sha256', private.assay_review_content_sha256(review_row.content),
    'assets_sha256', encode(sha256(convert_to(assets::text, 'utf8')), 'hex'),
    'input_sha256', private.assay_review_input_sha256(
      private.assay_review_content_sha256(review_row.content),
      encode(sha256(convert_to(assets::text, 'utf8')), 'hex')
    ),
    'assets', assets
  );
end;
$$;
revoke all on function public.assay_review_run_inputs(uuid) from public, anon, authenticated;
grant execute on function public.assay_review_run_inputs(uuid) to service_role;

create or replace function public.assay_claim_review_run_slot(target_review uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare claimed boolean;
begin
  if (select auth.role()) is distinct from 'service_role' then
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

create function public.assay_commit_review_run(
  target_review uuid,
  target_user uuid,
  expected_content_sha256 text,
  expected_assets_sha256 text,
  expected_input_sha256 text,
  target_findings jsonb,
  target_rule_snapshot jsonb,
  target_claim_snapshot jsonb,
  target_asset_snapshot jsonb,
  target_engine_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  review_row record;
  current_assets jsonb;
  current_content_sha256 text;
  current_assets_sha256 text;
  current_input_sha256 text;
  run_id uuid;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if target_user is null
    or jsonb_typeof(target_findings) is distinct from 'array'
    or jsonb_typeof(target_rule_snapshot) is distinct from 'array'
    or jsonb_typeof(target_claim_snapshot) is distinct from 'array'
    or jsonb_typeof(target_asset_snapshot) is distinct from 'array' then
    raise exception 'Invalid review run payload' using errcode = '22023';
  end if;

  select r.id, r.organization_id, r.content, r.status, r.archived_at, r.rule_set_version
    into review_row
    from public.reviews r
    where r.id = target_review
    for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  perform pg_advisory_xact_lock(hashtextextended(review_row.id::text, 0));
  if review_row.archived_at is not null or review_row.status not in ('draft', 'changes_requested') then
    return jsonb_build_object('status', 'not_editable');
  end if;

  current_content_sha256 := private.assay_review_content_sha256(review_row.content);
  current_assets := private.assay_review_asset_snapshot(review_row.id);
  current_assets_sha256 := encode(sha256(convert_to(current_assets::text, 'utf8')), 'hex');
  current_input_sha256 := private.assay_review_input_sha256(current_content_sha256, current_assets_sha256);
  if expected_content_sha256 is distinct from current_content_sha256
    or expected_assets_sha256 is distinct from current_assets_sha256
    or expected_input_sha256 is distinct from current_input_sha256
    or target_asset_snapshot is distinct from current_assets then
    return jsonb_build_object('status', 'stale');
  end if;

  if not public.assay_claim_review_run_slot(target_review) then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  delete from public.review_findings f
    where f.organization_id = review_row.organization_id
      and f.review_id = review_row.id
      and f.source_kind in ('rule', 'claim', 'image_check')
      and not exists (
        select 1
        from jsonb_to_recordset(target_findings) as incoming(finding_key text)
        where incoming.finding_key = f.finding_key
      );

  insert into public.review_findings(
    organization_id, review_id, finding_key, source_kind, rule_id, claim_id,
    category, severity, state, title, excerpt, explanation, confidence
  )
  select
    review_row.organization_id, review_row.id, incoming.finding_key, incoming.source_kind,
    incoming.rule_id, incoming.claim_id, incoming.category, incoming.severity,
    incoming.state, incoming.title, incoming.excerpt, incoming.explanation, incoming.confidence
  from jsonb_to_recordset(target_findings) as incoming(
    finding_key text,
    source_kind text,
    rule_id uuid,
    claim_id uuid,
    category text,
    severity text,
    state text,
    title text,
    excerpt text,
    explanation text,
    confidence numeric
  )
  on conflict (organization_id, review_id, finding_key) do update set
    source_kind = excluded.source_kind,
    rule_id = excluded.rule_id,
    claim_id = excluded.claim_id,
    category = excluded.category,
    severity = excluded.severity,
    state = excluded.state,
    title = excluded.title,
    excerpt = excluded.excerpt,
    explanation = excluded.explanation,
    confidence = excluded.confidence;

  if exists (
    select 1 from jsonb_to_recordset(target_findings) as incoming(source_kind text)
    where incoming.source_kind = 'claim'
  ) then
    update public.reviews set risk_tier = 'high'
      where id = review_row.id and organization_id = review_row.organization_id and risk_tier <> 'high';
  end if;

  insert into public.review_runs(
    organization_id, review_id, requested_by, content_sha256, rule_snapshot,
    claim_snapshot, asset_snapshot, assets_sha256, input_sha256, snapshot_version,
    finding_count, engine_version
  ) values (
    review_row.organization_id, review_row.id, target_user, current_content_sha256,
    target_rule_snapshot, target_claim_snapshot, current_assets, current_assets_sha256, current_input_sha256,
    1, jsonb_array_length(target_findings), target_engine_version
  )
  returning id into run_id;

  insert into public.review_events(
    organization_id, review_id, actor_id, action, detail, rule_set_version
  ) values (
    review_row.organization_id, review_row.id, target_user, 'checks_run',
    jsonb_build_object(
      'run_id', run_id,
      'content_sha256', current_content_sha256,
      'assets_sha256', current_assets_sha256,
      'input_sha256', current_input_sha256,
      'asset_ids', (select coalesce(jsonb_agg(asset -> 'id' order by asset ->> 'id'), '[]'::jsonb)
        from jsonb_array_elements(current_assets) as assets(asset)),
      'finding_count', jsonb_array_length(target_findings),
      'engine_version', target_engine_version
    ),
    review_row.rule_set_version
  );

  return jsonb_build_object(
    'status', 'ok',
    'run_id', run_id,
    'content_sha256', current_content_sha256,
    'assets_sha256', current_assets_sha256,
    'input_sha256', current_input_sha256
  );
end;
$$;
revoke all on function public.assay_commit_review_run(uuid,uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.assay_commit_review_run(uuid,uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,text) to service_role;

create function public.assay_review_has_current_run(target_review uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  review_row record;
  current_assets_sha256 text;
  current_input_sha256 text;
begin
  select r.id, r.organization_id, r.created_by, r.assigned_reviewer, r.content
    into review_row
    from public.reviews r
    where r.id = target_review;
  if not found then return false; end if;
  if not private.assay_can_view_review(
    review_row.organization_id, review_row.created_by, review_row.assigned_reviewer
  ) then return false; end if;

  current_assets_sha256 := private.assay_review_assets_sha256(review_row.id);
  current_input_sha256 := private.assay_review_input_sha256(
    private.assay_review_content_sha256(review_row.content), current_assets_sha256
  );
  return exists (
    select 1 from public.review_runs rr
    where rr.organization_id = review_row.organization_id
      and rr.review_id = review_row.id
      and rr.snapshot_version = 1
      and rr.content_sha256 = private.assay_review_content_sha256(review_row.content)
      and rr.assets_sha256 = current_assets_sha256
      and rr.input_sha256 = current_input_sha256
  );
end;
$$;
revoke all on function public.assay_review_has_current_run(uuid) from public, anon;
grant execute on function public.assay_review_has_current_run(uuid) to authenticated;

create function private.assay_guard_review_run_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_assets_sha256 text;
  current_content_sha256 text;
  current_input_sha256 text;
begin
  if tg_op = 'INSERT' then
    if new.approved_content_sha256 is not null then
      raise exception 'Approved content hash is database-managed' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.approved_content_sha256 is distinct from old.approved_content_sha256
    and not (new.status in ('approved', 'waived') and new.status is distinct from old.status) then
    raise exception 'Approved content hash is database-managed' using errcode = '42501';
  end if;

  if new.status in ('submitted', 'approved', 'waived') and new.status is distinct from old.status then
    perform pg_advisory_xact_lock(hashtextextended(new.id::text, 0));
    current_content_sha256 := private.assay_review_content_sha256(new.content);
    current_assets_sha256 := private.assay_review_assets_sha256(new.id);
    current_input_sha256 := private.assay_review_input_sha256(current_content_sha256, current_assets_sha256);
    if not exists (
      select 1 from public.review_runs rr
      where rr.organization_id = new.organization_id
        and rr.review_id = new.id
        and rr.snapshot_version = 1
        and rr.content_sha256 = current_content_sha256
        and rr.assets_sha256 = current_assets_sha256
        and rr.input_sha256 = current_input_sha256
    ) then
      raise exception 'Run the review on the current content and assets before continuing' using errcode = '42501';
    end if;
    if new.status in ('approved', 'waived') then
      new.approved_content_sha256 := current_content_sha256;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.assay_guard_review_run_integrity() from public, anon, authenticated;
create trigger reviews_run_integrity
  before update on public.reviews
  for each row execute function private.assay_guard_review_run_integrity();

create function private.assay_accept_workspace_invitation(
  target_token_hash text,
  target_user uuid,
  target_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.workspace_invitations;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if target_user is null or target_email is null or target_token_hash is null
    or target_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;

  select i.* into invitation
    from public.workspace_invitations i
    where i.token_hash = target_token_hash
    for update;
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  if invitation.accepted_at is not null then
    if invitation.accepted_by = target_user
      and exists (select 1 from public.organization_members m
        where m.organization_id = invitation.organization_id and m.user_id = target_user) then
      return jsonb_build_object(
        'status', 'accepted',
        'organization_id', invitation.organization_id,
        'role', invitation.role
      );
    end if;
    return jsonb_build_object('status', 'invalid');
  end if;
  if invitation.expires_at <= now() or invitation.email <> lower(btrim(target_email)) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if exists (
    select 1 from public.organization_members m
    where m.organization_id = invitation.organization_id and m.user_id = target_user
  ) then
    return jsonb_build_object('status', 'already_member');
  end if;

  insert into public.organization_members(organization_id, user_id, role)
    values (invitation.organization_id, target_user, invitation.role);
  update public.workspace_invitations set accepted_at = now(), accepted_by = target_user where id = invitation.id;
  insert into public.organization_events(organization_id, actor_id, subject_user_id, action, detail)
    values (invitation.organization_id, target_user, target_user, 'invitation_accepted',
      jsonb_build_object('invitation_id', invitation.id, 'role', invitation.role));

  return jsonb_build_object(
    'status', 'accepted',
    'organization_id', invitation.organization_id,
    'role', invitation.role
  );
end;
$$;
revoke all on function private.assay_accept_workspace_invitation(text,uuid,text) from public, anon, authenticated;

create function public.assay_accept_workspace_invitation(
  target_token_hash text,
  target_user uuid,
  target_email text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.assay_accept_workspace_invitation(target_token_hash, target_user, target_email);
$$;
revoke all on function public.assay_accept_workspace_invitation(text,uuid,text) from public, anon, authenticated;
grant execute on function public.assay_accept_workspace_invitation(text,uuid,text) to service_role;
