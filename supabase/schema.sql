-- Assay hosted workspace schema (PostgreSQL / Supabase Auth)
-- Apply through a reviewed migration. Never expose the service-role key to a browser.
create extension if not exists pgcrypto;

create type public.assay_workspace_role as enum ('owner', 'admin', 'creator', 'manager', 'brand_reviewer', 'legal_reviewer');
create type public.assay_rule_status as enum ('draft', 'approved', 'retired');
create type public.assay_review_status as enum ('draft', 'in_review', 'changes_requested', 'approved');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  owner_id uuid not null references auth.users(id) on delete restrict,
  model_policy jsonb not null default '{"external_allowed": false}'::jsonb,
  retention_days integer not null default 90 check (retention_days between 1 and 3650),
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.assay_workspace_role not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create or replace function public.assay_add_workspace_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger workspace_owner_membership
after insert on public.workspaces
for each row execute function public.assay_add_workspace_owner();

create table public.brand_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  rule_key text not null,
  category text not null check (category in ('terminology','required_language','claims','tone','visual','accessibility')),
  title text not null check (length(title) between 1 and 200),
  description text not null,
  source_label text not null default '',
  severity text not null check (severity in ('low','medium','high')),
  status public.assay_rule_status not null default 'draft',
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, rule_key, version)
);

create table public.approved_claims (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  statement text not null,
  evidence_label text not null,
  evidence_url text,
  owner_label text not null,
  reviewed_at date,
  expires_at date,
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  channel text not null default '',
  content text not null,
  creator_intent text not null default '',
  status public.assay_review_status not null default 'draft',
  risk_tier text not null default 'standard' check (risk_tier in ('low','standard','high')),
  assigned_reviewer uuid references auth.users(id),
  rule_set_version integer not null default 1,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.review_findings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  review_id uuid not null references public.reviews(id) on delete cascade,
  source_kind text not null check (source_kind in ('rule','claim','image_check','ai_judgment')),
  source_id text,
  category text not null,
  severity text not null check (severity in ('low','medium','high')),
  title text not null,
  excerpt text not null,
  explanation text not null,
  confidence numeric check (confidence between 0 and 1),
  resolution text not null default 'open' check (resolution in ('open','resolved','dismissed','waived')),
  resolution_reason text,
  created_at timestamptz not null default now()
);

create table public.review_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  review_id uuid not null references public.reviews(id) on delete cascade,
  finding_id uuid references public.review_findings(id) on delete set null,
  author_id uuid not null references auth.users(id),
  body text not null check (length(body) between 1 and 10000),
  created_at timestamptz not null default now()
);

create table public.review_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  review_id uuid not null references public.reviews(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  actor_role public.assay_workspace_role not null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.review_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  review_id uuid not null references public.reviews(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  label text not null,
  content_snapshot text not null,
  findings_snapshot jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.assay_is_member(target_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.assay_has_role(target_workspace uuid, allowed public.assay_workspace_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace and m.user_id = (select auth.uid()) and m.role = any(allowed)
  );
$$;

create or replace function public.assay_is_owner(target_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = target_workspace and w.owner_id = (select auth.uid())
  );
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.brand_rules enable row level security;
alter table public.approved_claims enable row level security;
alter table public.reviews enable row level security;
alter table public.review_findings enable row level security;
alter table public.review_comments enable row level security;
alter table public.review_events enable row level security;
alter table public.review_revisions enable row level security;

create policy workspace_read_members on public.workspaces for select to authenticated using (public.assay_is_member(id));
create policy workspace_create_self on public.workspaces for insert to authenticated with check (owner_id = (select auth.uid()));
create policy workspace_update_admin on public.workspaces for update to authenticated using (public.assay_has_role(id, array['owner','admin']::public.assay_workspace_role[])) with check (public.assay_has_role(id, array['owner','admin']::public.assay_workspace_role[]));

create policy member_read_workspace on public.workspace_members for select to authenticated using (public.assay_is_member(workspace_id));
create policy member_insert_admin on public.workspace_members for insert to authenticated with check (
  public.assay_has_role(workspace_id, array['owner','admin']::public.assay_workspace_role[])
  and (role <> 'owner' or public.assay_is_owner(workspace_id))
);
create policy member_update_admin on public.workspace_members for update to authenticated using (
  public.assay_has_role(workspace_id, array['owner','admin']::public.assay_workspace_role[])
  and (role <> 'owner' or public.assay_is_owner(workspace_id))
) with check (
  public.assay_has_role(workspace_id, array['owner','admin']::public.assay_workspace_role[])
  and (role <> 'owner' or public.assay_is_owner(workspace_id))
);
create policy member_delete_admin on public.workspace_members for delete to authenticated using (
  public.assay_has_role(workspace_id, array['owner','admin']::public.assay_workspace_role[])
  and (role <> 'owner' or public.assay_is_owner(workspace_id))
);

create policy rules_read_workspace on public.brand_rules for select to authenticated using (public.assay_is_member(workspace_id));
create policy rules_manage_reviewer on public.brand_rules for all to authenticated using (public.assay_has_role(workspace_id, array['owner','admin','brand_reviewer']::public.assay_workspace_role[])) with check (public.assay_has_role(workspace_id, array['owner','admin','brand_reviewer']::public.assay_workspace_role[]));
create policy claims_read_workspace on public.approved_claims for select to authenticated using (public.assay_is_member(workspace_id));
create policy claims_manage_reviewer on public.approved_claims for all to authenticated using (public.assay_has_role(workspace_id, array['owner','admin','brand_reviewer','legal_reviewer']::public.assay_workspace_role[])) with check (public.assay_has_role(workspace_id, array['owner','admin','brand_reviewer','legal_reviewer']::public.assay_workspace_role[]));

create policy reviews_read_workspace on public.reviews for select to authenticated using (public.assay_is_member(workspace_id));
create policy reviews_create_member on public.reviews for insert to authenticated with check (created_by = (select auth.uid()) and public.assay_is_member(workspace_id));
create policy reviews_update_member on public.reviews for update to authenticated using (public.assay_is_member(workspace_id)) with check (public.assay_is_member(workspace_id));
create policy findings_read_workspace on public.review_findings for select to authenticated using (public.assay_is_member(workspace_id));
create policy findings_create_reviewer on public.review_findings for insert to authenticated with check (public.assay_is_member(workspace_id));
create policy findings_update_reviewer on public.review_findings for update to authenticated using (public.assay_has_role(workspace_id, array['owner','admin','manager','brand_reviewer','legal_reviewer']::public.assay_workspace_role[])) with check (public.assay_has_role(workspace_id, array['owner','admin','manager','brand_reviewer','legal_reviewer']::public.assay_workspace_role[]));
create policy comments_read_workspace on public.review_comments for select to authenticated using (public.assay_is_member(workspace_id));
create policy comments_create_member on public.review_comments for insert to authenticated with check (author_id = (select auth.uid()) and public.assay_is_member(workspace_id));
create policy events_read_workspace on public.review_events for select to authenticated using (public.assay_is_member(workspace_id));
create policy events_create_member on public.review_events for insert to authenticated with check (actor_id = (select auth.uid()) and public.assay_is_member(workspace_id));
create policy revisions_read_workspace on public.review_revisions for select to authenticated using (public.assay_is_member(workspace_id));
create policy revisions_create_member on public.review_revisions for insert to authenticated with check (author_id = (select auth.uid()) and public.assay_is_member(workspace_id));

revoke update, delete on public.review_events from authenticated;
revoke update, delete on public.review_revisions from authenticated;

create index reviews_workspace_status_created on public.reviews(workspace_id, status, created_at desc);
create index findings_review_created on public.review_findings(review_id, created_at desc);
create index comments_review_created on public.review_comments(review_id, created_at);
create index events_review_created on public.review_events(review_id, created_at desc);

-- Reviewers should confirm RLS and role policy behavior in a non-production Supabase project before pilots.
