-- Run after migrations with `supabase test db` against an isolated test project.
-- This test deliberately exercises all five product roles from Org A against Org B.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(1);

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000001','authenticated','authenticated','assay-admin-a@test.invalid','',now(),now()),
  ('10000000-0000-4000-8000-000000000002','authenticated','authenticated','assay-creator-a@test.invalid','',now(),now()),
  ('10000000-0000-4000-8000-000000000003','authenticated','authenticated','assay-manager-a@test.invalid','',now(),now()),
  ('10000000-0000-4000-8000-000000000004','authenticated','authenticated','assay-brand-a@test.invalid','',now(),now()),
  ('10000000-0000-4000-8000-000000000005','authenticated','authenticated','assay-legal-a@test.invalid','',now(),now()),
  ('20000000-0000-4000-8000-000000000001','authenticated','authenticated','assay-owner-b@test.invalid','',now(),now())
on conflict (id) do nothing;

insert into public.organizations(id, name, owner_id) values
  ('a0000000-0000-4000-8000-000000000001','Org A','10000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000001','Org B','20000000-0000-4000-8000-000000000001');
insert into public.organization_members(organization_id,user_id,role) values
  ('a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','creator'),
  ('a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','manager'),
  ('a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','brand_reviewer'),
  ('a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','legal_reviewer');

insert into public.workspace_invitations(id,organization_id,email,role,token_hash,invited_by,expires_at)
values ('b1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','invite@test.invalid','creator','hash-b','20000000-0000-4000-8000-000000000001',now()+interval '1 day');
insert into public.brand_rules(id,organization_id,rule_key,version,category,title,description,severity,created_by)
values ('b2000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','rule-b',1,'tone','B rule','Private Org B rule','high','20000000-0000-4000-8000-000000000001');
insert into public.approved_claims(id,organization_id,statement,evidence_label,owner_label,created_by)
values ('b3000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','B claim','B evidence','B owner','20000000-0000-4000-8000-000000000001');
insert into public.reviews(id,organization_id,title,content,created_by)
values ('b4000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','B review','Secret Org B content','20000000-0000-4000-8000-000000000001');
insert into public.review_findings(id,organization_id,review_id,source_kind,rule_id,category,severity,state,title,explanation)
values ('b5000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','rule','b2000000-0000-4000-8000-000000000001','tone','high','violation','B finding','B explanation');
insert into public.review_comments(id,organization_id,review_id,author_id,body)
values ('b6000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','B comment');
insert into public.review_events(id,organization_id,review_id,actor_id,action,rule_set_version)
values ('b7000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','submitted',1);
insert into public.review_revisions(id,organization_id,review_id,author_id,content_snapshot,label)
values ('b8000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','B snapshot','initial');

set local role authenticated;
do $$
declare
  actor record;
  table_name text;
  visible_count bigint;
  changed_count bigint;
  denied boolean;
  org_b constant uuid := 'b0000000-0000-4000-8000-000000000001';
  review_b constant uuid := 'b4000000-0000-4000-8000-000000000001';
  table_names text[] := array[
    'organizations','organization_members','workspace_invitations','brand_rules',
    'approved_claims','reviews','review_findings','review_comments','review_events','review_revisions'
  ];
begin
  for actor in select id, role_name from (values
    ('10000000-0000-4000-8000-000000000001'::uuid,'admin'),
    ('10000000-0000-4000-8000-000000000002'::uuid,'creator'),
    ('10000000-0000-4000-8000-000000000003'::uuid,'manager'),
    ('10000000-0000-4000-8000-000000000004'::uuid,'brand_reviewer'),
    ('10000000-0000-4000-8000-000000000005'::uuid,'legal_reviewer')
  ) as actors(id, role_name)
  loop
    perform set_config('request.jwt.claim.sub', actor.id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub',actor.id,'role','authenticated')::text, true);
    foreach table_name in array table_names loop
      if table_name = 'organizations' then
        select count(*) into visible_count from public.organizations where id = org_b;
      else
        execute format('select count(*) from public.%I where organization_id = $1', table_name)
          into visible_count using org_b;
      end if;
      if visible_count <> 0 then
        raise exception 'RLS leak: role % can read Org B from %', actor.role_name, table_name;
      end if;
    end loop;

    select count(*) into visible_count from public.reviews where id = review_b;
    if visible_count <> 0 then raise exception 'RLS leak: role % can read Org B review', actor.role_name; end if;
    update public.reviews set title = 'tampered' where id = review_b;
    get diagnostics changed_count = row_count;
    if changed_count <> 0 then raise exception 'RLS write leak: role % changed Org B review', actor.role_name; end if;

    foreach table_name in array table_names loop
      if table_name <> 'organizations' then
        denied := false;
        begin
          case table_name
            when 'organization_members' then
              insert into public.organization_members(organization_id,user_id,role) values (org_b,actor.id,'creator');
            when 'workspace_invitations' then
              insert into public.workspace_invitations(organization_id,email,role,token_hash,invited_by,expires_at)
                values (org_b,actor.id::text||'@denied.invalid','creator',gen_random_uuid()::text,actor.id,now()+interval '1 day');
            when 'brand_rules' then
              insert into public.brand_rules(organization_id,rule_key,version,category,title,description,severity,created_by)
                values (org_b,gen_random_uuid()::text,1,'tone','unauthorized','denied','low',actor.id);
            when 'approved_claims' then
              insert into public.approved_claims(organization_id,statement,evidence_label,owner_label,created_by)
                values (org_b,'denied','denied','denied',actor.id);
            when 'reviews' then
              insert into public.reviews(organization_id,title,content,created_by) values (org_b,'unauthorized','denied',actor.id);
            when 'review_findings' then
              insert into public.review_findings(organization_id,review_id,source_kind,rule_id,category,severity,state,title,explanation)
                values (org_b,review_b,'rule','b2000000-0000-4000-8000-000000000001','tone','low','violation','denied','denied');
            when 'review_comments' then
              insert into public.review_comments(organization_id,review_id,author_id,body) values (org_b,review_b,actor.id,'denied');
            when 'review_events' then
              insert into public.review_events(organization_id,review_id,actor_id,action,rule_set_version) values (org_b,review_b,actor.id,'denied',1);
            when 'review_revisions' then
              insert into public.review_revisions(organization_id,review_id,author_id,content_snapshot,label) values (org_b,review_b,actor.id,'denied','denied');
          end case;
        exception when insufficient_privilege then denied := true;
        end;
        if not denied then raise exception 'RLS insert leak: role % inserted into Org B table %', actor.role_name, table_name; end if;
      end if;

      denied := false;
      begin
        if table_name = 'organizations' then
          update public.organizations set name = name where id = org_b;
        else
          execute format('update public.%I set created_at = created_at where organization_id = $1', table_name) using org_b;
        end if;
        get diagnostics changed_count = row_count;
        if changed_count <> 0 then raise exception 'RLS update leak: role % changed Org B table %', actor.role_name, table_name; end if;
      exception when insufficient_privilege then denied := true;
      end;

      denied := false;
      begin
        if table_name = 'organizations' then
          delete from public.organizations where id = org_b;
        else
          execute format('delete from public.%I where organization_id = $1', table_name) using org_b;
        end if;
        get diagnostics changed_count = row_count;
        if changed_count <> 0 then raise exception 'RLS delete leak: role % deleted Org B table %', actor.role_name, table_name; end if;
      exception when insufficient_privilege then denied := true;
      end;
    end loop;
  end loop;
end;
$$;

select ok(true, 'all five roles are isolated from every tenant-owned table');
select * from finish();

rollback;
