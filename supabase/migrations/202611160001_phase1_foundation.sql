-- Assay Phase 1 foundation. Apply only after review in a non-production project.
-- Every tenant-owned row has an organization_id RLS boundary. No client snapshot RPC.
create extension if not exists pgcrypto;

create type public.assay_role as enum (
  'creator', 'manager', 'brand_reviewer', 'legal_reviewer', 'admin'
);
create type public.assay_rule_status as enum ('draft', 'approved', 'retired');
create type public.assay_review_status as enum (
  'draft', 'submitted', 'in_review', 'changes_requested', 'approved', 'waived'
);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  role public.assay_role not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create function private.assay_add_organization_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.organization_members(organization_id, user_id, role)
  values (new.id, new.owner_id, 'admin');
  return new;
end;
$$;
revoke all on function private.assay_add_organization_owner() from public, anon, authenticated;
create trigger organization_owner_membership after insert on public.organizations
for each row execute function private.assay_add_organization_owner();

-- SECURITY DEFINER is limited to these boolean membership lookups to avoid RLS recursion.
create function private.assay_is_member(target_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = target_org and m.user_id = (select auth.uid())
  );
$$;
create function private.assay_has_role(target_org uuid, allowed public.assay_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = target_org and m.user_id = (select auth.uid()) and m.role = any(allowed)
  );
$$;
revoke all on function private.assay_is_member(uuid) from public, anon;
revoke all on function private.assay_has_role(uuid, public.assay_role[]) from public, anon;
grant execute on function private.assay_is_member(uuid) to authenticated;
grant execute on function private.assay_has_role(uuid, public.assay_role[]) to authenticated;

create function private.assay_is_org_owner(target_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organizations o
    where o.id = target_org and o.owner_id = (select auth.uid()));
$$;
revoke all on function private.assay_is_org_owner(uuid) from public, anon;
grant execute on function private.assay_is_org_owner(uuid) to authenticated;

create function private.assay_can_view_review(target_org uuid, target_creator uuid, target_assignee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.assay_has_role(target_org,
      array['admin','manager','brand_reviewer','legal_reviewer']::public.assay_role[])
    or (private.assay_is_member(target_org)
      and (target_creator = (select auth.uid()) or target_assignee = (select auth.uid())));
$$;
revoke all on function private.assay_can_view_review(uuid, uuid, uuid) from public, anon;
grant execute on function private.assay_can_view_review(uuid, uuid, uuid) to authenticated;

create function private.assay_limit_org_creation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare recent_orgs integer;
begin
  if (select auth.uid()) is null then return new; end if;
  if new.owner_id <> (select auth.uid()) then raise exception 'Organization owner must be the signed-in user' using errcode = '42501'; end if;
  perform 1 from auth.users u where u.id = new.owner_id for update;
  select count(*) into recent_orgs from public.organizations o
    where o.owner_id = new.owner_id and o.created_at > now() - interval '24 hours';
  if recent_orgs >= 3 then raise exception 'Organization creation limit reached' using errcode = '54000'; end if;
  return new;
end;
$$;
revoke all on function private.assay_limit_org_creation() from public, anon, authenticated;
create trigger organizations_creation_limit before insert on public.organizations
  for each row execute function private.assay_limit_org_creation();

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (length(email) between 3 and 320 and email = lower(email)),
  role public.assay_role not null check (role <> 'admin'),
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id) on delete restrict,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);

create table public.brand_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_key text not null,
  version integer not null check (version > 0),
  match_text text not null default '' check (octet_length(match_text) <= 1000),
  category text not null check (category in ('terminology','required_language','claims','tone','visual','accessibility')),
  title text not null check (length(title) between 1 and 200),
  description text not null check (octet_length(description) <= 100000),
  source_label text not null default '',
  severity text not null check (severity in ('low','medium','high')),
  status public.assay_rule_status not null default 'draft',
  active boolean not null default true,
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, rule_key, version),
  check (octet_length(rule_key) <= 300),
  check (octet_length(source_label) <= 20000)
);

create table public.approved_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  statement text not null check (octet_length(statement) <= 20000),
  value text check (value is null or octet_length(value) <= 20000),
  evidence_label text not null check (octet_length(evidence_label) <= 20000),
  evidence_url text check (evidence_url is null or evidence_url ~* '^https?://[^[:space:]/?#]+([/?#]|$)'),
  owner_label text not null check (octet_length(owner_label) <= 500),
  reviewed_at date,
  expires_at date,
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  channel text not null default '',
  content text not null,
  status public.assay_review_status not null default 'draft',
  risk_tier text not null default 'standard' check (risk_tier in ('low','standard','high')),
  assigned_reviewer uuid,
  rule_set_version integer not null default 1,
  rule_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(rule_snapshot) = 'array'),
  archived_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  check (length(btrim(title)) between 1 and 300),
  check (octet_length(channel) <= 200),
  check (octet_length(content) <= 1048576),
  foreign key (organization_id, assigned_reviewer)
    references public.organization_members(organization_id, user_id) on delete set null (assigned_reviewer)
);

create table public.review_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  review_id uuid not null,
  source_kind text not null check (source_kind in ('rule','claim','image_check','ai_judgment')),
  rule_id uuid,
  claim_id uuid,
  category text not null,
  severity text not null check (severity in ('low','medium','high')),
  state text not null check (state in ('violation','likely','needs_human_judgement','cannot_verify')),
  title text not null,
  excerpt text not null default '',
  explanation text not null,
  confidence numeric check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  check (octet_length(explanation) <= 50000),
  check (octet_length(title) <= 500),
  check (octet_length(excerpt) <= 20000),
  foreign key (organization_id, review_id) references public.reviews(organization_id, id) on delete cascade,
  foreign key (organization_id, rule_id) references public.brand_rules(organization_id, id),
  foreign key (organization_id, claim_id) references public.approved_claims(organization_id, id),
  check ((source_kind <> 'rule' or rule_id is not null) and (source_kind <> 'claim' or claim_id is not null))
);

create table public.review_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  review_id uuid not null,
  finding_id uuid,
  author_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (length(body) between 1 and 10000),
  anchor jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (octet_length(body) <= 40000),
  unique (organization_id, id),
  foreign key (organization_id, review_id) references public.reviews(organization_id, id) on delete cascade,
  foreign key (organization_id, finding_id) references public.review_findings(organization_id, id) on delete set null (finding_id)
);

create table public.review_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  review_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  rule_set_version integer not null,
  model_version text,
  created_at timestamptz not null default now(),
  check (octet_length(action) <= 100),
  check (octet_length(detail::text) <= 50000),
  unique (organization_id, id),
  foreign key (organization_id, review_id) references public.reviews(organization_id, id) on delete restrict
);

create table public.review_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  review_id uuid not null,
  author_id uuid not null references auth.users(id) on delete restrict,
  content_snapshot text not null,
  label text not null,
  created_at timestamptz not null default now(),
  check (octet_length(content_snapshot) <= 1048576),
  check (octet_length(label) <= 200),
  unique (organization_id, id),
  foreign key (organization_id, review_id) references public.reviews(organization_id, id) on delete restrict
);

create table public.organization_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  subject_user_id uuid references auth.users(id) on delete restrict,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (octet_length(action) <= 100),
  check (octet_length(detail::text) <= 50000),
  unique (organization_id, id)
);

create function private.assay_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.assay_touch_updated_at() from public, anon, authenticated;
create trigger brand_rules_touch_updated_at before update on public.brand_rules
  for each row execute function private.assay_touch_updated_at();
create trigger approved_claims_touch_updated_at before update on public.approved_claims
  for each row execute function private.assay_touch_updated_at();

create function private.assay_guard_claim()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Claim identity, organization, creator, and creation time are immutable' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and new.created_by <> (select auth.uid()) then
    raise exception 'Claim creator must be the signed-in user' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.assay_guard_claim() from public, anon, authenticated;
create trigger approved_claims_guard before insert or update on public.approved_claims
  for each row execute function private.assay_guard_claim();

create function private.assay_set_member_role(target_org uuid, target_user uuid, new_role public.assay_role)
returns void language plpgsql security definer set search_path = '' as $$
declare current_owner uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select o.owner_id into current_owner from public.organizations o where o.id = target_org for update;
  if current_owner is distinct from (select auth.uid()) then raise exception 'Only the organization owner may assign roles' using errcode = '42501'; end if;
  if target_user = current_owner then raise exception 'The organization owner role is immutable' using errcode = '22023'; end if;
  update public.organization_members set role = new_role
    where organization_id = target_org and user_id = target_user;
  if not found then raise exception 'Membership not found' using errcode = 'P0002'; end if;
end;
$$;

create function private.assay_remove_member(target_org uuid, target_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare current_owner uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select o.owner_id into current_owner from public.organizations o where o.id = target_org for update;
  if current_owner is distinct from (select auth.uid()) then raise exception 'Only the organization owner may remove members' using errcode = '42501'; end if;
  if target_user = current_owner then raise exception 'Transfer ownership before removing the owner' using errcode = '22023'; end if;
  delete from public.organization_members where organization_id = target_org and user_id = target_user;
  if not found then raise exception 'Membership not found' using errcode = 'P0002'; end if;
end;
$$;

create function private.assay_transfer_organization_owner(target_org uuid, new_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare current_owner uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select o.owner_id into current_owner from public.organizations o where o.id = target_org for update;
  if current_owner is distinct from (select auth.uid()) then raise exception 'Only the current owner may transfer ownership' using errcode = '42501'; end if;
  if new_owner = current_owner or not exists (
    select 1 from public.organization_members m where m.organization_id = target_org and m.user_id = new_owner
  ) then raise exception 'New owner must be a different existing member' using errcode = '22023'; end if;
  update public.organization_members set role = 'admin' where organization_id = target_org and user_id = new_owner;
  update public.organization_members set role = 'manager' where organization_id = target_org and user_id = current_owner;
  update public.organizations set owner_id = new_owner where id = target_org;
  insert into public.organization_events(organization_id,actor_id,subject_user_id,action,detail)
  values (target_org,current_owner,new_owner,'ownership_transferred',jsonb_build_object('previous_owner',current_owner));
end;
$$;

revoke all on function private.assay_set_member_role(uuid,uuid,public.assay_role) from public, anon;
revoke all on function private.assay_remove_member(uuid,uuid) from public, anon;
revoke all on function private.assay_transfer_organization_owner(uuid,uuid) from public, anon;
grant execute on function private.assay_set_member_role(uuid,uuid,public.assay_role) to authenticated;
grant execute on function private.assay_remove_member(uuid,uuid) to authenticated;
grant execute on function private.assay_transfer_organization_owner(uuid,uuid) to authenticated;

create function private.assay_audit_membership_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare subject_user uuid; org_id uuid; operation text; role_value public.assay_role;
begin
  if tg_op = 'DELETE' then
    subject_user := old.user_id; org_id := old.organization_id; operation := 'member_removed'; role_value := old.role;
  elsif tg_op = 'INSERT' then
    subject_user := new.user_id; org_id := new.organization_id; operation := 'member_added'; role_value := new.role;
  else
    if new.role is not distinct from old.role then return new; end if;
    subject_user := new.user_id; org_id := new.organization_id; operation := 'member_role_changed'; role_value := new.role;
  end if;
  insert into public.organization_events(organization_id,actor_id,subject_user_id,action,detail)
  values (org_id,coalesce((select auth.uid()),subject_user),subject_user,operation,jsonb_build_object('role',role_value));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.assay_audit_membership_change() from public, anon, authenticated;
create trigger membership_audit after insert or update or delete on public.organization_members
  for each row execute function private.assay_audit_membership_change();

create function private.assay_guard_review()
returns trigger language plpgsql set search_path = '' as $$
declare can_review boolean;
begin
  if (select auth.uid()) is null then
    if tg_op = 'UPDATE' then new.updated_at := now(); end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.created_by <> (select auth.uid()) or new.status <> 'draft'
      or new.risk_tier <> 'standard' or new.assigned_reviewer is not null
      or new.rule_snapshot <> '[]'::jsonb or new.archived_at is not null then
      raise exception 'New reviews must start as unassigned standard-risk drafts' using errcode = '42501';
    end if;
    new.created_at := now();
    new.updated_at := now();
    new.rule_set_version := 1;
    return new;
  end if;

  if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
    or new.rule_set_version is distinct from old.rule_set_version then
    raise exception 'Review identity, organization, creator, and creation metadata are immutable' using errcode = '42501';
  end if;
  if new.archived_at is distinct from old.archived_at
    and not private.assay_has_role(new.organization_id, array['admin']::public.assay_role[]) then
    raise exception 'Only admins may archive a review' using errcode = '42501';
  end if;

  can_review := private.assay_has_role(new.organization_id,
    array['admin','manager','brand_reviewer','legal_reviewer']::public.assay_role[]);
  if not can_review then
    if not private.assay_has_role(new.organization_id, array['creator']::public.assay_role[])
      or new.created_by <> (select auth.uid())
      or old.status not in ('draft','changes_requested') then
      raise exception 'Creator may edit only their own draft or requested changes' using errcode = '42501';
    end if;
    if new.risk_tier is distinct from old.risk_tier
      or new.assigned_reviewer is distinct from old.assigned_reviewer then
      raise exception 'Only reviewers may change risk or assignment' using errcode = '42501';
    end if;
    if new.status is distinct from old.status
      and not (new.status = 'submitted' and old.status in ('draft','changes_requested')) then
      raise exception 'Creator may only submit a draft' using errcode = '42501';
    end if;
  end if;

  if old.status in ('approved','waived') and (
    new.status is distinct from old.status or new.title is distinct from old.title
    or new.channel is distinct from old.channel or new.content is distinct from old.content
    or new.risk_tier is distinct from old.risk_tier
    or new.assigned_reviewer is distinct from old.assigned_reviewer
  ) then
    raise exception 'Approved reviews are immutable' using errcode = '42501';
  end if;

  if new.status in ('approved','waived') and new.status is distinct from old.status then
    if new.created_by = (select auth.uid()) then
      raise exception 'Self-approval is not allowed' using errcode = '42501';
    end if;
    if new.risk_tier = 'high' and not private.assay_has_role(new.organization_id,
      array['admin','legal_reviewer']::public.assay_role[]) then
      raise exception 'High-risk reviews require legal approval' using errcode = '42501';
    end if;
  end if;

  if new.rule_snapshot is distinct from old.rule_snapshot then
    raise exception 'Rule snapshots are database-managed' using errcode = '42501';
  end if;
  if new.status = 'submitted' and old.status in ('draft','changes_requested') then
    select coalesce(jsonb_agg(jsonb_build_object('rule_id',r.id,'rule_key',r.rule_key,'version',r.version)
      order by r.rule_key, r.version), '[]'::jsonb)
      into new.rule_snapshot
      from public.brand_rules r
      where r.organization_id = new.organization_id and r.status = 'approved' and r.active;
  end if;

  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.assay_guard_review() from public, anon, authenticated;
create trigger reviews_guard before insert or update on public.reviews
  for each row execute function private.assay_guard_review();

create function private.assay_guard_brand_rule()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.created_by <> (select auth.uid()) or new.status <> 'draft'
      or new.approved_by is not null or new.approved_at is not null then
      raise exception 'New rules must be unapproved drafts' using errcode = '42501';
    end if;
    new.created_at := now();
    return new;
  end if;
  if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
    or new.version is distinct from old.version then
    raise exception 'Rule identity, organization, creator, version, and creation time are immutable' using errcode = '42501';
  end if;
  if old.status in ('approved','retired') and (
    new.rule_key is distinct from old.rule_key or new.version is distinct from old.version
    or new.category is distinct from old.category or new.title is distinct from old.title
    or new.description is distinct from old.description or new.source_label is distinct from old.source_label
    or new.severity is distinct from old.severity
  ) then
    raise exception 'Approved rules are immutable; create a new version' using errcode = '42501';
  end if;
  if old.status = 'approved' and new.status not in ('approved','retired') then
    raise exception 'Approved rules can only be retired' using errcode = '42501';
  end if;
  if old.status = 'retired' and (new.status is distinct from old.status or new.active is distinct from old.active) then
    raise exception 'Retired rules are immutable' using errcode = '42501';
  end if;
  if new.status = 'approved' and old.status <> 'approved' then
    if not private.assay_has_role(new.organization_id, array['admin','brand_reviewer']::public.assay_role[]) then
      raise exception 'Only a brand reviewer may approve a rule' using errcode = '42501';
    end if;
    new.approved_by := (select auth.uid());
    new.approved_at := now();
  elsif new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
    raise exception 'Rule approval metadata is database-managed' using errcode = '42501';
  end if;
  if new.status = 'retired' then new.active := false; end if;
  return new;
end;
$$;
revoke all on function private.assay_guard_brand_rule() from public, anon, authenticated;
create trigger brand_rules_guard before insert or update on public.brand_rules
  for each row execute function private.assay_guard_brand_rule();

create unique index brand_rules_one_active_approved_version
  on public.brand_rules(organization_id, rule_key) where status = 'approved' and active;

create function private.assay_record_review_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare event_action text;
begin
  if tg_op = 'INSERT' then
    event_action := 'created';
  elsif new.status is distinct from old.status then
    event_action := 'status_changed';
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
      'rule_snapshot',new.rule_snapshot),new.rule_set_version);
  if tg_op = 'UPDATE' and new.content is distinct from old.content then
    insert into public.review_revisions(organization_id,review_id,author_id,content_snapshot,label)
    values (old.organization_id,old.id,coalesce((select auth.uid()),old.created_by),old.content,'Before content update');
  end if;
  return new;
end;
$$;
revoke all on function private.assay_record_review_change() from public, anon, authenticated;
create trigger reviews_record_change after insert or update on public.reviews
  for each row execute function private.assay_record_review_change();

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.brand_rules enable row level security;
alter table public.approved_claims enable row level security;
alter table public.reviews enable row level security;
alter table public.review_findings enable row level security;
alter table public.review_comments enable row level security;
alter table public.review_events enable row level security;
alter table public.review_revisions enable row level security;
alter table public.organization_events enable row level security;

create policy organizations_select_member on public.organizations for select to authenticated
  using (private.assay_is_member(id) or owner_id = (select auth.uid()));
create policy organizations_insert_owner on public.organizations for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy organizations_update_admin on public.organizations for update to authenticated
  using (private.assay_has_role(id, array['admin']::public.assay_role[]))
  with check (private.assay_has_role(id, array['admin']::public.assay_role[]));

create policy members_select_member on public.organization_members for select to authenticated
  using (private.assay_is_member(organization_id));
create policy members_update_owner on public.organization_members for update to authenticated
  using (private.assay_is_org_owner(organization_id)
    and role <> 'admin' and user_id <> (select auth.uid()))
  with check (private.assay_is_org_owner(organization_id)
    and role <> 'admin' and user_id <> (select auth.uid()));
create policy members_leave_self on public.organization_members for delete to authenticated
  using (user_id = (select auth.uid()) and not private.assay_is_org_owner(organization_id));
create policy members_delete_owner on public.organization_members for delete to authenticated
  using (private.assay_is_org_owner(organization_id) and user_id <> (select auth.uid()));

create policy invitations_select_admin_manager on public.workspace_invitations for select to authenticated
  using (private.assay_has_role(organization_id, array['admin','manager']::public.assay_role[]));
create policy invitations_insert_admin_manager on public.workspace_invitations for insert to authenticated
  with check (invited_by = (select auth.uid())
    and private.assay_has_role(organization_id, array['admin','manager']::public.assay_role[]));
create policy invitations_delete_admin_manager on public.workspace_invitations for delete to authenticated
  using (private.assay_has_role(organization_id, array['admin','manager']::public.assay_role[]));
-- Invitation acceptance is deliberately not exposed as direct table writes; add a verified server flow later.

create policy rules_select_member on public.brand_rules for select to authenticated
  using (
    private.assay_has_role(organization_id, array['admin','manager','brand_reviewer','legal_reviewer']::public.assay_role[])
    or (private.assay_is_member(organization_id) and status = 'approved' and active)
  );
create policy rules_insert_reviewer on public.brand_rules for insert to authenticated
  with check (created_by = (select auth.uid()) and status = 'draft'
    and private.assay_has_role(organization_id, array['admin','brand_reviewer']::public.assay_role[]));
create policy rules_update_reviewer on public.brand_rules for update to authenticated
  using (private.assay_has_role(organization_id, array['admin','brand_reviewer']::public.assay_role[]))
  with check (private.assay_has_role(organization_id, array['admin','brand_reviewer']::public.assay_role[]));

create policy claims_select_member on public.approved_claims for select to authenticated
  using (private.assay_is_member(organization_id));
create policy claims_insert_reviewer on public.approved_claims for insert to authenticated
  with check (created_by = (select auth.uid()) and private.assay_has_role(organization_id, array['admin','brand_reviewer','legal_reviewer']::public.assay_role[]));
create policy claims_update_reviewer on public.approved_claims for update to authenticated
  using (private.assay_has_role(organization_id, array['admin','brand_reviewer','legal_reviewer']::public.assay_role[]))
  with check (private.assay_has_role(organization_id, array['admin','brand_reviewer','legal_reviewer']::public.assay_role[]));

create policy reviews_select_member on public.reviews for select to authenticated
  using (private.assay_can_view_review(organization_id, created_by, assigned_reviewer));
create policy reviews_insert_member on public.reviews for insert to authenticated
  with check (created_by = (select auth.uid()) and status = 'draft'
    and risk_tier = 'standard' and assigned_reviewer is null
    and rule_snapshot = '[]'::jsonb and private.assay_is_member(organization_id));
create policy reviews_update_creator_manager_reviewer on public.reviews for update to authenticated
  using (
    private.assay_has_role(organization_id, array['admin','manager','brand_reviewer','legal_reviewer']::public.assay_role[])
    or (private.assay_has_role(organization_id, array['creator']::public.assay_role[])
      and created_by = (select auth.uid()) and status in ('draft','changes_requested'))
  )
  with check (
    private.assay_has_role(organization_id, array['admin','manager','brand_reviewer','legal_reviewer']::public.assay_role[])
    or (private.assay_has_role(organization_id, array['creator']::public.assay_role[])
      and created_by = (select auth.uid()) and status in ('draft','submitted','changes_requested'))
  );
create policy findings_select_member on public.review_findings for select to authenticated
  using (exists (select 1 from public.reviews r
    where r.organization_id = review_findings.organization_id and r.id = review_findings.review_id));
create policy comments_select_member on public.review_comments for select to authenticated
  using (exists (select 1 from public.reviews r
    where r.organization_id = review_comments.organization_id and r.id = review_comments.review_id));
create policy comments_insert_member on public.review_comments for insert to authenticated
  with check (author_id = (select auth.uid()) and exists (select 1 from public.reviews r
    where r.organization_id = review_comments.organization_id and r.id = review_comments.review_id));
-- Comments, events, and revisions are append-only for authenticated clients.
create policy events_select_member on public.review_events for select to authenticated
  using (exists (select 1 from public.reviews r
    where r.organization_id = review_events.organization_id and r.id = review_events.review_id));
create policy revisions_select_member on public.review_revisions for select to authenticated
  using (exists (select 1 from public.reviews r
    where r.organization_id = review_revisions.organization_id and r.id = review_revisions.review_id));
create policy organization_events_select_admin on public.organization_events for select to authenticated
  using (private.assay_has_role(organization_id, array['admin']::public.assay_role[]));

revoke all on public.organizations, public.organization_members, public.workspace_invitations,
  public.brand_rules, public.approved_claims, public.reviews, public.review_findings,
  public.review_comments, public.review_events, public.review_revisions, public.organization_events from public, anon, authenticated;
grant select, insert on public.organizations to authenticated;
grant update (name) on public.organizations to authenticated;
grant select, delete on public.organization_members to authenticated;
grant update (role) on public.organization_members to authenticated;
grant select, insert, delete on public.workspace_invitations to authenticated;
grant select, insert, update on public.brand_rules, public.approved_claims to authenticated;
grant select, insert, update on public.reviews to authenticated;
grant select on public.review_findings, public.review_events, public.review_revisions to authenticated;
grant select, insert on public.review_comments to authenticated;
grant select on public.organization_events to authenticated;

create index organization_members_user on public.organization_members(user_id, organization_id);
create index rules_org_status on public.brand_rules(organization_id, status, rule_key, version desc);
create index claims_org_expiry on public.approved_claims(organization_id, expires_at) where active;
create index reviews_org_status_created on public.reviews(organization_id, status, created_at desc);
create index findings_org_review on public.review_findings(organization_id, review_id, created_at desc);
create index comments_org_review on public.review_comments(organization_id, review_id, created_at);
create index events_org_review on public.review_events(organization_id, review_id, created_at desc);

