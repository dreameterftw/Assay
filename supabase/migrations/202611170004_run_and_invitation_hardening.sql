alter table public.review_runs
  add column rules_sha256 text not null default repeat('0', 64)
    check (rules_sha256 ~ '^[0-9a-f]{64}$'),
  add column claims_sha256 text not null default repeat('0', 64)
    check (claims_sha256 ~ '^[0-9a-f]{64}$'),
  add column valid_until timestamptz not null default now();

alter table public.reviews
  add column approved_run_id uuid references public.review_runs(id) on delete restrict;

alter table public.workspace_invitations
  drop constraint workspace_invitations_organization_id_email_key;
create unique index workspace_invitations_pending_email
  on public.workspace_invitations(organization_id, email)
  where accepted_at is null;

create function private.assay_review_rules_snapshot(target_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'rule_key', r.rule_key,
    'version', r.version,
    'category', r.category,
    'title', r.title,
    'description', r.description,
    'source_label', r.source_label,
    'severity', r.severity,
    'match_text', r.match_text,
    'active', r.active,
    'status', r.status,
    'text_sha256', encode(sha256(convert_to(
      jsonb_build_array(r.title, r.description, r.source_label, r.match_text)::text, 'utf8'
    )), 'hex')
  ) order by r.id), '[]'::jsonb)
  from public.brand_rules r
  where r.organization_id = target_org and r.status = 'approved' and r.active;
$$;

create function private.assay_review_claims_snapshot(target_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'version', c.version,
    'statement', c.statement,
    'value', c.value,
    'evidence_label', c.evidence_label,
    'evidence_url', c.evidence_url,
    'owner_label', c.owner_label,
    'reviewed_at', c.reviewed_at,
    'expires_at', c.expires_at,
    'active', c.active,
    'text_sha256', encode(sha256(convert_to(
      jsonb_build_array(c.statement, c.value, c.evidence_label, c.evidence_url,
        c.owner_label, c.reviewed_at, c.expires_at, c.active)::text, 'utf8'
    )), 'hex')
  ) order by c.id), '[]'::jsonb)
  from public.approved_claims c
  where c.organization_id = target_org and c.active;
$$;
revoke all on function private.assay_review_rules_snapshot(uuid) from public, anon, authenticated;
revoke all on function private.assay_review_claims_snapshot(uuid) from public, anon, authenticated;

create function private.assay_lock_organization_review_inputs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_org uuid;
begin
  target_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  perform 1 from public.organizations o where o.id = target_org for no key update;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.assay_lock_organization_review_inputs() from public, anon, authenticated;
create trigger brand_rules_lock_review_inputs
  before insert or update or delete on public.brand_rules
  for each row execute function private.assay_lock_organization_review_inputs();
create trigger approved_claims_lock_review_inputs
  before insert or update or delete on public.approved_claims
  for each row execute function private.assay_lock_organization_review_inputs();

create function private.assay_review_input_sha256(
  target_content_sha256 text,
  target_assets_sha256 text,
  target_rules_sha256 text,
  target_claims_sha256 text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'content_sha256', target_content_sha256,
    'assets_sha256', target_assets_sha256,
    'rules_sha256', target_rules_sha256,
    'claims_sha256', target_claims_sha256
  )::text, 'utf8')), 'hex');
$$;
revoke all on function private.assay_review_input_sha256(text,text,text,text) from public, anon, authenticated;

create or replace function private.assay_lock_review_asset()
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

  target_review := case when tg_op = 'DELETE' then old.review_id else new.review_id end;
  perform 1 from public.reviews r where r.id = target_review for no key update;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.assay_limit_review_assets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare existing_assets integer;
begin
  perform 1 from public.reviews r where r.id = new.review_id for no key update;
  select count(*) into existing_assets
    from public.review_assets a
    where a.organization_id = new.organization_id and a.review_id = new.review_id;
  if existing_assets >= 10 then
    raise exception 'A review may have at most 10 image assets' using errcode = '54000';
  end if;
  return new;
end;
$$;

create or replace function public.assay_review_run_inputs(target_review uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  review_row record;
  assets jsonb;
  rules jsonb;
  claims jsonb;
  content_hash text;
  assets_hash text;
  rules_hash text;
  claims_hash text;
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

  perform 1 from public.organizations o
    where o.id = review_row.organization_id for share;
  assets := private.assay_review_asset_snapshot(review_row.id);
  rules := private.assay_review_rules_snapshot(review_row.organization_id);
  claims := private.assay_review_claims_snapshot(review_row.organization_id);
  content_hash := private.assay_review_content_sha256(review_row.content);
  assets_hash := encode(sha256(convert_to(assets::text, 'utf8')), 'hex');
  rules_hash := encode(sha256(convert_to(rules::text, 'utf8')), 'hex');
  claims_hash := encode(sha256(convert_to(claims::text, 'utf8')), 'hex');

  return jsonb_build_object(
    'review_id', review_row.id,
    'organization_id', review_row.organization_id,
    'content', review_row.content,
    'status', review_row.status,
    'archived_at', review_row.archived_at,
    'rule_set_version', review_row.rule_set_version,
    'content_sha256', content_hash,
    'assets_sha256', assets_hash,
    'rules_sha256', rules_hash,
    'claims_sha256', claims_hash,
    'input_sha256', private.assay_review_input_sha256(content_hash, assets_hash, rules_hash, claims_hash),
    'valid_until', least(
      clock_timestamp() + interval '24 hours',
      coalesce((
        select min((c.expires_at + 1)::timestamp at time zone 'UTC')
        from public.approved_claims c
        where c.organization_id = review_row.organization_id and c.active and c.expires_at is not null
      ), 'infinity'::timestamptz)
    ),
    'assets', assets,
    'rules', rules,
    'claims', claims
  );
end;
$$;
revoke all on function public.assay_review_run_inputs(uuid) from public, anon, authenticated;
grant execute on function public.assay_review_run_inputs(uuid) to service_role;

create function public.assay_commit_review_run(
  target_review uuid,
  target_user uuid,
  expected_content_sha256 text,
  expected_assets_sha256 text,
  expected_rules_sha256 text,
  expected_claims_sha256 text,
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
  current_rules jsonb;
  current_claims jsonb;
  current_content_sha256 text;
  current_assets_sha256 text;
  current_rules_sha256 text;
  current_claims_sha256 text;
  current_input_sha256 text;
  current_valid_until timestamptz;
  run_id uuid;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if target_user is null
    or jsonb_typeof(target_findings) is distinct from 'array'
    or jsonb_typeof(target_rule_snapshot) is distinct from 'array'
    or jsonb_typeof(target_claim_snapshot) is distinct from 'array'
    or jsonb_typeof(target_asset_snapshot) is distinct from 'array'
    or jsonb_array_length(target_findings) > 500
    or octet_length(jsonb_build_array(target_findings, target_rule_snapshot, target_claim_snapshot, target_asset_snapshot)::text) > 8388608 then
    raise exception 'Invalid or oversized review run payload' using errcode = '22023';
  end if;

  select r.id, r.organization_id, r.content, r.status, r.archived_at, r.rule_set_version
    into review_row
    from public.reviews r
    where r.id = target_review
    for no key update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if review_row.archived_at is not null or review_row.status not in ('draft', 'changes_requested') then
    return jsonb_build_object('status', 'not_editable');
  end if;

  perform 1 from public.organizations o
    where o.id = review_row.organization_id for share;
  current_content_sha256 := private.assay_review_content_sha256(review_row.content);
  current_assets := private.assay_review_asset_snapshot(review_row.id);
  current_rules := private.assay_review_rules_snapshot(review_row.organization_id);
  current_claims := private.assay_review_claims_snapshot(review_row.organization_id);
  current_assets_sha256 := encode(sha256(convert_to(current_assets::text, 'utf8')), 'hex');
  current_rules_sha256 := encode(sha256(convert_to(current_rules::text, 'utf8')), 'hex');
  current_claims_sha256 := encode(sha256(convert_to(current_claims::text, 'utf8')), 'hex');
  current_input_sha256 := private.assay_review_input_sha256(
    current_content_sha256, current_assets_sha256, current_rules_sha256, current_claims_sha256
  );
  current_valid_until := least(
    clock_timestamp() + interval '24 hours',
    coalesce((
      select min((c.expires_at + 1)::timestamp at time zone 'UTC')
      from public.approved_claims c
      where c.organization_id = review_row.organization_id and c.active and c.expires_at is not null
    ), 'infinity'::timestamptz)
  );
  if expected_content_sha256 is distinct from current_content_sha256
    or expected_assets_sha256 is distinct from current_assets_sha256
    or expected_rules_sha256 is distinct from current_rules_sha256
    or expected_claims_sha256 is distinct from current_claims_sha256
    or expected_input_sha256 is distinct from current_input_sha256
    or target_asset_snapshot is distinct from current_assets
    or target_rule_snapshot is distinct from current_rules
    or target_claim_snapshot is distinct from current_claims then
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
    perform set_config('app.assay_system_event', 'true', true);
    update public.reviews set risk_tier = 'high'
      where id = review_row.id and organization_id = review_row.organization_id and risk_tier <> 'high';
    perform set_config('app.assay_system_event', 'false', true);
  end if;

  insert into public.review_runs(
    organization_id, review_id, requested_by, content_sha256, rule_snapshot,
    claim_snapshot, asset_snapshot, assets_sha256, rules_sha256, claims_sha256,
    input_sha256, valid_until, snapshot_version, finding_count, engine_version
  ) values (
    review_row.organization_id, review_row.id, target_user, current_content_sha256,
    current_rules, current_claims, current_assets, current_assets_sha256,
    current_rules_sha256, current_claims_sha256, current_input_sha256,
    current_valid_until, 1, jsonb_array_length(target_findings), target_engine_version
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
      'rules_sha256', current_rules_sha256,
      'claims_sha256', current_claims_sha256,
      'input_sha256', current_input_sha256,
      'asset_ids', (select coalesce(jsonb_agg(asset -> 'id' order by asset ->> 'id'), '[]'::jsonb)
        from jsonb_array_elements(current_assets) as assets(asset)),
      'finding_count', jsonb_array_length(target_findings),
      'engine_version', target_engine_version,
      'valid_until', current_valid_until
    ),
    review_row.rule_set_version
  );

  return jsonb_build_object(
    'status', 'ok',
    'run_id', run_id,
    'content_sha256', current_content_sha256,
    'assets_sha256', current_assets_sha256,
    'rules_sha256', current_rules_sha256,
    'claims_sha256', current_claims_sha256,
    'input_sha256', current_input_sha256,
    'valid_until', current_valid_until
  );
end;
$$;
revoke all on function public.assay_commit_review_run(uuid,uuid,text,text,text,text,text,jsonb,jsonb,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.assay_commit_review_run(uuid,uuid,text,text,text,text,text,jsonb,jsonb,jsonb,jsonb,text) to service_role;
drop function public.assay_commit_review_run(uuid,uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,text);

create or replace function public.assay_review_has_current_run(target_review uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  review_row record;
  current_assets_sha256 text;
  current_rules_sha256 text;
  current_claims_sha256 text;
  current_content_sha256 text;
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

  current_content_sha256 := private.assay_review_content_sha256(review_row.content);
  current_assets_sha256 := private.assay_review_assets_sha256(review_row.id);
  current_rules_sha256 := encode(sha256(convert_to(private.assay_review_rules_snapshot(review_row.organization_id)::text, 'utf8')), 'hex');
  current_claims_sha256 := encode(sha256(convert_to(private.assay_review_claims_snapshot(review_row.organization_id)::text, 'utf8')), 'hex');
  current_input_sha256 := private.assay_review_input_sha256(
    current_content_sha256, current_assets_sha256, current_rules_sha256, current_claims_sha256
  );
  return exists (
    select 1 from public.review_runs rr
    where rr.organization_id = review_row.organization_id
      and rr.review_id = review_row.id
      and rr.snapshot_version = 1
      and rr.content_sha256 = current_content_sha256
      and rr.assets_sha256 = current_assets_sha256
      and rr.rules_sha256 = current_rules_sha256
      and rr.claims_sha256 = current_claims_sha256
      and rr.input_sha256 = current_input_sha256
  );
end;
$$;
revoke all on function public.assay_review_has_current_run(uuid) from public, anon;
grant execute on function public.assay_review_has_current_run(uuid) to authenticated;
comment on function public.assay_review_has_current_run(uuid) is
  'Authenticated RPC intentionally exposes only whether the caller can view this review and whether its content, assets, rules, and claims match a current run; it returns false for missing or inaccessible reviews.';

create or replace function private.assay_guard_review_run_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_assets_sha256 text;
  current_rules_sha256 text;
  current_claims_sha256 text;
  current_content_sha256 text;
  current_input_sha256 text;
  matching_run public.review_runs;
begin
  if tg_op = 'INSERT' then
    if new.approved_content_sha256 is not null or new.approved_run_id is not null then
      raise exception 'Approved run details are database-managed' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.approved_run_id is distinct from old.approved_run_id
    and not (new.status in ('approved', 'waived') and new.status is distinct from old.status) then
    raise exception 'Approved run is database-managed' using errcode = '42501';
  end if;
  if new.approved_content_sha256 is distinct from old.approved_content_sha256
    and not (new.status in ('approved', 'waived') and new.status is distinct from old.status) then
    raise exception 'Approved content hash is database-managed' using errcode = '42501';
  end if;

  if new.status in ('submitted', 'approved', 'waived') and new.status is distinct from old.status then
    perform 1 from public.organizations o
      where o.id = new.organization_id for share;
    current_content_sha256 := private.assay_review_content_sha256(new.content);
    current_assets_sha256 := private.assay_review_assets_sha256(new.id);
    current_rules_sha256 := encode(sha256(convert_to(private.assay_review_rules_snapshot(new.organization_id)::text, 'utf8')), 'hex');
    current_claims_sha256 := encode(sha256(convert_to(private.assay_review_claims_snapshot(new.organization_id)::text, 'utf8')), 'hex');
    current_input_sha256 := private.assay_review_input_sha256(
      current_content_sha256, current_assets_sha256, current_rules_sha256, current_claims_sha256
    );
    select rr.* into matching_run
      from public.review_runs rr
      where rr.organization_id = new.organization_id
        and rr.review_id = new.id
        and rr.snapshot_version = 1
        and rr.content_sha256 = current_content_sha256
        and rr.assets_sha256 = current_assets_sha256
        and rr.rules_sha256 = current_rules_sha256
        and rr.claims_sha256 = current_claims_sha256
        and rr.input_sha256 = current_input_sha256
      order by rr.created_at desc, rr.id desc
      limit 1;
    if not found then
      raise exception 'Run the review on current content, assets, rules, and claims before continuing' using errcode = '42501';
    end if;
    if new.status in ('approved', 'waived') then
      if matching_run.valid_until <= clock_timestamp() then
        raise exception 'The review run has expired; run the check again before approval' using errcode = '42501';
      end if;
      new.approved_content_sha256 := current_content_sha256;
      new.approved_run_id := matching_run.id;
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.assay_record_review_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_action text;
  system_generated boolean := current_setting('app.assay_system_event', true) = 'true';
begin
  if tg_op = 'INSERT' then
    event_action := 'created';
  elsif new.status is distinct from old.status then
    event_action := 'status_changed';
  elsif system_generated and new.risk_tier is distinct from old.risk_tier then
    event_action := 'risk_escalated';
  elsif new.risk_tier is distinct from old.risk_tier or new.assigned_reviewer is distinct from old.assigned_reviewer then
    event_action := 'routing_changed';
  elsif new.content is distinct from old.content or new.title is distinct from old.title or new.channel is distinct from old.channel then
    event_action := 'content_changed';
  elsif new.archived_at is distinct from old.archived_at then
    event_action := 'archived';
  else
    return new;
  end if;
  insert into public.review_events(organization_id,review_id,actor_id,action,detail,rule_set_version)
  values (new.organization_id,new.id,coalesce((select auth.uid()),new.created_by),event_action,
    jsonb_build_object('status',new.status,'risk_tier',new.risk_tier,'assigned_reviewer',new.assigned_reviewer,
      'rule_snapshot',new.rule_snapshot,'system_generated',system_generated),new.rule_set_version);
  if tg_op = 'UPDATE' and (
    new.content is distinct from old.content
    or (new.status is distinct from old.status and new.status = 'changes_requested')
  ) then
    insert into public.review_revisions(organization_id,review_id,author_id,content_snapshot,label)
    values (old.organization_id,old.id,coalesce((select auth.uid()),old.created_by),old.content,
      case when new.content is distinct from old.content then 'Before content update' else 'Before changes requested' end);
  end if;
  return new;
end;
$$;

create function private.assay_restrict_reviewer_content_edits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.title is distinct from old.title or new.channel is distinct from old.channel or new.content is distinct from old.content)
    and (select auth.uid()) is not null
    and (select auth.uid()) is distinct from old.created_by then
    raise exception 'Only the review creator may edit submitted content' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.assay_restrict_reviewer_content_edits() from public, anon, authenticated;
create trigger reviews_creator_content_only
  before update on public.reviews
  for each row execute function private.assay_restrict_reviewer_content_edits();

drop function public.assay_accept_workspace_invitation(text,uuid,text);
drop function private.assay_accept_workspace_invitation(text,uuid,text);

create function private.assay_accept_workspace_invitation(
  target_token_hash text,
  target_user uuid,
  target_email text,
  target_email_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare invitation public.workspace_invitations;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if target_user is null or target_email is null or target_token_hash is null
    or target_email_confirmed is distinct from true
    or target_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select i.* into invitation
    from public.workspace_invitations i
    where i.token_hash = target_token_hash
    for update;
  if not found or invitation.accepted_at is not null
    or invitation.expires_at <= now()
    or invitation.email <> lower(btrim(target_email)) then
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
  update public.workspace_invitations
    set accepted_at = now(), accepted_by = target_user
    where id = invitation.id and accepted_at is null and expires_at > now();
  if not found then raise exception 'Invitation changed during acceptance' using errcode = '40001'; end if;
  insert into public.organization_events(organization_id, actor_id, subject_user_id, action, detail)
    values (invitation.organization_id, target_user, target_user, 'invitation_accepted',
      jsonb_build_object('invitation_id', invitation.id, 'role', invitation.role));
  return jsonb_build_object('status', 'accepted', 'organization_id', invitation.organization_id, 'role', invitation.role);
end;
$$;
revoke all on function private.assay_accept_workspace_invitation(text,uuid,text,boolean) from public, anon, authenticated;

create function public.assay_accept_workspace_invitation(
  target_token_hash text,
  target_user uuid,
  target_email text,
  target_email_confirmed boolean
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.assay_accept_workspace_invitation(
    target_token_hash, target_user, target_email, target_email_confirmed
  );
$$;
revoke all on function public.assay_accept_workspace_invitation(text,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.assay_accept_workspace_invitation(text,uuid,text,boolean) to service_role;

create function public.assay_create_invitation(
  target_org uuid,
  target_actor uuid,
  target_email text,
  target_role text,
  target_token_hash text,
  target_expires_at timestamptz,
  target_daily_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.assay_role;
  invitation_id uuid;
  day_start timestamptz := date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  invite_count integer;
  burst_count integer;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if target_org is null or target_actor is null or target_email is null or target_role is null
    or target_token_hash is null or target_expires_at is null or target_daily_limit is null
    or target_email <> lower(btrim(target_email))
    or target_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or target_role not in ('creator','manager','brand_reviewer','legal_reviewer')
    or target_token_hash !~ '^[0-9a-f]{64}$'
    or target_expires_at <= clock_timestamp()
    or target_daily_limit not between 1 and 1000 then
    return jsonb_build_object('status', 'invalid');
  end if;

  perform 1 from public.organizations o where o.id = target_org for no key update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select m.role into actor_role from public.organization_members m
    where m.organization_id = target_org and m.user_id = target_actor
    for share;
  if not found
    or not (actor_role = 'admin' or (actor_role = 'manager' and target_role = 'creator')) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select count(*) into invite_count
    from public.organization_events e
    where e.organization_id = target_org and e.action = 'invitation_created' and e.created_at >= day_start;
  if invite_count >= target_daily_limit then return jsonb_build_object('status', 'daily_limit'); end if;

  select count(*) into burst_count
    from public.organization_events e
    where e.organization_id = target_org and e.actor_id = target_actor
      and e.action = 'invitation_created' and e.created_at >= clock_timestamp() - interval '1 minute';
  if burst_count >= 5 then return jsonb_build_object('status', 'rate_limited'); end if;

  delete from public.workspace_invitations i
    where i.organization_id = target_org and i.email = target_email
      and (i.accepted_at is not null or i.expires_at <= clock_timestamp());
  if exists (
    select 1 from public.workspace_invitations i
    where i.organization_id = target_org and i.email = target_email and i.accepted_at is null
  ) then
    return jsonb_build_object('status', 'already_pending');
  end if;

  insert into public.workspace_invitations(
    organization_id, email, role, token_hash, invited_by, expires_at
  ) values (target_org, target_email, target_role::public.assay_role, target_token_hash, target_actor, target_expires_at)
  returning id into invitation_id;
  insert into public.organization_events(organization_id, actor_id, subject_user_id, action, detail)
    values (target_org, target_actor, null, 'invitation_created',
      jsonb_build_object('invitation_id', invitation_id, 'email', target_email, 'role', target_role));
  return jsonb_build_object('status', 'created', 'invitation_id', invitation_id);
end;
$$;
revoke all on function public.assay_create_invitation(uuid,uuid,text,text,text,timestamptz,integer) from public, anon, authenticated;
grant execute on function public.assay_create_invitation(uuid,uuid,text,text,text,timestamptz,integer) to service_role;

create function public.assay_revoke_invitation(target_org uuid, target_invitation uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  delete from public.workspace_invitations
    where organization_id = target_org and id = target_invitation and accepted_at is null;
  return found;
end;
$$;
revoke all on function public.assay_revoke_invitation(uuid,uuid) from public, anon, authenticated;
grant execute on function public.assay_revoke_invitation(uuid,uuid) to service_role;
