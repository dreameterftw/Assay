create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  updated_at timestamptz not null default now()
);

insert into public.profiles(id, display_name)
select u.id, coalesce(nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), nullif(split_part(u.email, '@', 1), ''), 'Workspace member')
from auth.users u
on conflict (id) do nothing;

create function private.assay_create_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), nullif(split_part(new.email, '@', 1), ''), 'Workspace member'))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function private.assay_create_profile() from public, anon, authenticated;
create trigger auth_user_create_profile after insert on auth.users
for each row execute function private.assay_create_profile();

alter table public.profiles enable row level security;
create policy profiles_select_colleagues on public.profiles for select to authenticated
  using (id = (select auth.uid()) or exists (
    select 1 from public.organization_members mine
    join public.organization_members colleague using (organization_id)
    where mine.user_id = (select auth.uid()) and colleague.user_id = profiles.id
  ));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

alter table public.review_comments
  add column visibility text not null default 'shared'
    check (visibility in ('internal', 'shared'));
drop policy comments_select_member on public.review_comments;
create policy comments_select_member on public.review_comments for select to authenticated
  using (exists (
    select 1 from public.reviews r where r.organization_id = review_comments.organization_id
      and r.id = review_comments.review_id
      and private.assay_can_view_review(r.organization_id, r.created_by, r.assigned_reviewer)
      and (review_comments.visibility = 'shared' or private.assay_has_role(r.organization_id,
        array['admin','manager','brand_reviewer','legal_reviewer']::public.assay_role[]))
  ));
drop policy comments_insert_member on public.review_comments;
create policy comments_insert_member on public.review_comments for insert to authenticated
  with check (author_id = (select auth.uid()) and exists (
    select 1 from public.reviews r where r.organization_id = review_comments.organization_id
      and r.id = review_comments.review_id
      and private.assay_can_view_review(r.organization_id, r.created_by, r.assigned_reviewer)
      and (review_comments.visibility = 'shared' or private.assay_has_role(r.organization_id,
        array['admin','manager','brand_reviewer','legal_reviewer']::public.assay_role[]))
  ));

alter table public.reviews
  add column waiver_reason text,
  add column waiver_expires_at date,
  add constraint reviews_waiver_details_required check (
    status <> 'waived'
    or (length(btrim(coalesce(waiver_reason, ''))) > 0 and waiver_expires_at is not null)
  );

create function private.assay_guard_waiver_details()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'waived' and (
    length(btrim(coalesce(new.waiver_reason, ''))) = 0 or new.waiver_expires_at is null
  ) then
    raise exception 'Waived reviews require a reason and an expiry date' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.assay_guard_waiver_details() from public, anon, authenticated;
create trigger reviews_waiver_details_guard before insert or update on public.reviews
for each row execute function private.assay_guard_waiver_details();

create function private.assay_publish_rule_version(
  target_org uuid,
  target_rule_key text,
  target_category text,
  target_title text,
  target_description text,
  target_source_label text,
  target_severity text,
  target_match_text text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  next_version integer;
  new_rule_id uuid := gen_random_uuid();
begin
  if actor_id is null or not private.assay_has_role(target_org,
    array['admin','brand_reviewer']::public.assay_role[]) then
    raise exception 'Only a brand reviewer may publish a rule version' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_org::text || ':' || target_rule_key, 0));
  select coalesce(max(r.version), 0) + 1 into next_version
    from public.brand_rules r where r.organization_id = target_org and r.rule_key = target_rule_key;

  update public.brand_rules set status = 'retired', active = false
    where organization_id = target_org and rule_key = target_rule_key
      and status = 'approved' and active;

  insert into public.brand_rules(
    id, organization_id, rule_key, version, category, title, description,
    source_label, severity, match_text, status, active, created_by
  ) values (
    new_rule_id, target_org, target_rule_key, next_version, target_category,
    target_title, target_description, target_source_label, target_severity,
    target_match_text, 'draft', true, actor_id
  );

  update public.brand_rules set status = 'approved'
    where organization_id = target_org and id = new_rule_id;

  insert into public.organization_events(organization_id, actor_id, action, detail)
  values (target_org, actor_id, 'rule_version_published',
    jsonb_build_object('rule_id', new_rule_id, 'rule_key', target_rule_key, 'version', next_version));

  return new_rule_id;
end;
$$;
revoke all on function private.assay_publish_rule_version(uuid,text,text,text,text,text,text,text) from public, anon;
grant execute on function private.assay_publish_rule_version(uuid,text,text,text,text,text,text,text) to authenticated;

create function public.assay_publish_rule_version(
  target_org uuid,
  target_rule_key text,
  target_category text,
  target_title text,
  target_description text,
  target_source_label text,
  target_severity text,
  target_match_text text
)
returns uuid
language sql
set search_path = ''
as $$
  select private.assay_publish_rule_version(
    target_org, target_rule_key, target_category, target_title,
    target_description, target_source_label, target_severity, target_match_text
  );
$$;
revoke all on function public.assay_publish_rule_version(uuid,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.assay_publish_rule_version(uuid,text,text,text,text,text,text,text) to authenticated;

create function private.assay_limit_review_assets()
returns trigger language plpgsql security definer set search_path = '' as $$
declare existing_assets integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.review_id::text, 0));
  select count(*) into existing_assets from public.review_assets a
    where a.organization_id = new.organization_id and a.review_id = new.review_id;
  if existing_assets >= 10 then
    raise exception 'A review may have at most 10 image assets' using errcode = '54000';
  end if;
  return new;
end;
$$;
revoke all on function private.assay_limit_review_assets() from public, anon, authenticated;
create trigger review_assets_limit before insert on public.review_assets
for each row execute function private.assay_limit_review_assets();
