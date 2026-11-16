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

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.assay_role not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create function public.assay_add_organization_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.organization_members(organization_id, user_id, role)
  values (new.id, new.owner_id, 'admin');
  return new;
end;
$$;
revoke all on function public.assay_add_organization_owner() from public, anon, authenticated;
create trigger organization_owner_membership after insert on public.organizations
for each row execute function public.assay_add_organization_owner();

-- SECURITY DEFINER is limited to these boolean membership lookups to avoid RLS recursion.
create function public.assay_is_member(target_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = target_org and m.user_id = (select auth.uid())
  );
$$;
create function public.assay_has_role(target_org uuid, allowed public.assay_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = target_org and m.user_id = (select auth.uid()) and m.role = any(allowed)
  );
$$;
revoke all on function public.assay_is_member(uuid) from public, anon;
revoke all on function public.assay_has_role(uuid, public.assay_role[]) from public, anon;
grant execute on function public.assay_is_member(uuid) to authenticated;
grant execute on function public.assay_has_role(uuid, public.assay_role[]) to authenticated;

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (length(email) between 3 and 320),
  role public.assay_role not null check (role <> 'admin'),
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id),
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
  category text not null check (category in ('terminology','required_language','claims','tone','visual','accessibility')),
  title text not null check (length(title) between 1 and 200),
  description text not null,
  source_label text not null default '',
  severity text not null check (severity in ('low','medium','high')),
  status public.assay_rule_status not null default 'draft',
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, rule_key, version)
);

create table public.approved_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  statement text not null,
  value text,
  evidence_label text not null,
  evidence_url text,
  owner_label text not null,
  reviewed_at date,
  expires_at date,
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
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
  assigned_reviewer uuid references auth.users(id),
  rule_set_version integer not null default 1,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
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
  author_id uuid not null references auth.users(id),
  body text not null check (length(body) between 1 and 10000),
  anchor jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (organization_id, review_id) references public.reviews(organization_id, id) on delete cascade,
  foreign key (organization_id, finding_id) references public.review_findings(organization_id, id) on delete set null (finding_id)
);

create table public.review_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  review_id uuid not null,
  actor_id uuid not null references auth.users(id),
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  rule_set_version integer not null,
  model_version text,
  created_at timestamptz not null default now(),
  foreign key (organization_id, review_id) references public.reviews(organization_id, id) on delete cascade
);

create table public.review_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  review_id uuid not null,
  author_id uuid not null references auth.users(id),
  content_snapshot text not null,
  label text not null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, review_id) references public.reviews(organization_id, id) on delete cascade
);

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

create policy organizations_select_member on public.organizations for select to authenticated
  using (public.assay_is_member(id));
create policy organizations_insert_owner on public.organizations for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy organizations_update_admin on public.organizations for update to authenticated
  using (public.assay_has_role(id, array['admin']::public.assay_role[]))
  with check (public.assay_has_role(id, array['admin']::public.assay_role[]));

create policy members_select_member on public.organization_members for select to authenticated
  using (public.assay_is_member(organization_id));
create policy members_update_admin on public.organization_members for update to authenticated
  using (public.assay_has_role(organization_id, array['admin']::public.assay_role[])
    and role <> 'admin' and user_id <> (select auth.uid()))
  with check (public.assay_has_role(organization_id, array['admin']::public.assay_role[])
    and role <> 'admin' and user_id <> (select auth.uid()));
create policy members_delete_admin on public.organization_members for delete to authenticated
  using (public.assay_has_role(organization_id, array['admin']::public.assay_role[])
    and role <> 'admin' and user_id <> (select auth.uid()));

create policy invitations_select_admin_manager on public.workspace_invitations for select to authenticated
  using (public.assay_has_role(organization_id, array['admin','manager']::public.assay_role[]));
create policy invitations_insert_admin_manager on public.workspace_invitations for insert to authenticated
  with check (invited_by = (select auth.uid())
    and public.assay_has_role(organization_id, array['admin','manager']::public.assay_role[]));
create policy invitations_delete_admin_manager on public.workspace_invitations for delete to authenticated
  using (public.assay_has_role(organization_id, array['admin','manager']::public.assay_role[]));
-- Invitation acceptance is deliberately not exposed as direct table writes; add a verified server flow later.

create policy rules_select_member on public.brand_rules for select to authenticated
  using (public.assay_is_member(organization_id));
create policy rules_insert_reviewer on public.brand_rules for insert to authenticated
  with check (created_by = (select auth.uid()) and public.assay_has_role(organization_id, array['admin','brand_reviewer']::public.assay_role[]));
create policy rules_update_reviewer on public.brand_rules for update to authenticated
  using (public.assay_has_role(organization_id, array['admin','brand_reviewer']::public.assay_role[]))
  with check (public.assay_has_role(organization_id, array['admin','brand_reviewer']::public.assay_role[]));
create policy rules_delete_admin on public.brand_rules for delete to authenticated
  using (public.assay_has_role(organization_id, array['admin']::public.assay_role[]));

create policy claims_select_member on public.approved_claims for select to authenticated
  using (public.assay_is_member(organization_id));
create policy claims_insert_reviewer on public.approved_claims for insert to authenticated
  with check (created_by = (select auth.uid()) and public.assay_has_role(organization_id, array['admin','brand_reviewer','legal_reviewer']::public.assay_role[]));
create policy claims_update_reviewer on public.approved_claims for update to authenticated
  using (public.assay_has_role(organization_id, array['admin','brand_reviewer','legal_reviewer']::public.assay_role[]))
  with check (public.assay_has_role(organization_id, array['admin','brand_reviewer','legal_reviewer']::public.assay_role[]));
create policy claims_delete_admin on public.approved_claims for delete to authenticated
  using (public.assay_has_role(organization_id, array['admin']::public.assay_role[]));

create policy reviews_select_member on public.reviews for select to authenticated
  using (public.assay_is_member(organization_id));
create policy reviews_insert_member on public.reviews for insert to authenticated
  with check (created_by = (select auth.uid()) and public.assay_is_member(organization_id));
create policy reviews_update_creator_manager_reviewer on public.reviews for update to authenticated
  using (
    public.assay_has_role(organization_id, array['admin','manager','brand_reviewer','legal_reviewer']::public.assay_role[])
    or (public.assay_has_role(organization_id, array['creator']::public.assay_role[])
      and created_by = (select auth.uid()) and status in ('draft','changes_requested'))
  )
  with check (
    public.assay_has_role(organization_id, array['admin','manager','brand_reviewer','legal_reviewer']::public.assay_role[])
    or (public.assay_has_role(organization_id, array['creator']::public.assay_role[])
      and created_by = (select auth.uid()) and status in ('draft','submitted','changes_requested'))
  );
create policy reviews_delete_admin on public.reviews for delete to authenticated
  using (public.assay_has_role(organization_id, array['admin']::public.assay_role[]));

create policy findings_select_member on public.review_findings for select to authenticated
  using (public.assay_is_member(organization_id));
create policy comments_select_member on public.review_comments for select to authenticated
  using (public.assay_is_member(organization_id));
create policy comments_insert_member on public.review_comments for insert to authenticated
  with check (author_id = (select auth.uid()) and public.assay_is_member(organization_id));
-- Comments, events, and revisions are append-only for authenticated clients.
create policy events_select_member on public.review_events for select to authenticated
  using (public.assay_is_member(organization_id));
create policy revisions_select_member on public.review_revisions for select to authenticated
  using (public.assay_is_member(organization_id));

revoke all on public.organizations, public.organization_members, public.workspace_invitations,
  public.brand_rules, public.approved_claims, public.reviews, public.review_findings,
  public.review_comments, public.review_events, public.review_revisions from anon, authenticated;
grant select, insert on public.organizations to authenticated;
grant update (name) on public.organizations to authenticated;
grant select, update, delete on public.organization_members to authenticated;
grant select, insert, delete on public.workspace_invitations to authenticated;
grant select, insert, update, delete on public.brand_rules, public.approved_claims, public.reviews to authenticated;
grant select on public.review_findings, public.review_events, public.review_revisions to authenticated;
grant select, insert on public.review_comments to authenticated;

create index organization_members_user on public.organization_members(user_id, organization_id);
create index rules_org_status on public.brand_rules(organization_id, status, rule_key, version desc);
create index claims_org_expiry on public.approved_claims(organization_id, expires_at) where active;
create index reviews_org_status_created on public.reviews(organization_id, status, created_at desc);
create index findings_org_review on public.review_findings(organization_id, review_id, created_at desc);
create index comments_org_review on public.review_comments(organization_id, review_id, created_at);
create index events_org_review on public.review_events(organization_id, review_id, created_at desc);

