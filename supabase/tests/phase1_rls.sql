-- Hosted SQL policy/trigger integration suite; no local Docker runtime required.
-- Run against a disposable Supabase project after applying migrations.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(1);

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')
  ) then
    raise exception 'A SECURITY DEFINER function in public is callable by anon';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname <> 'assay_review_has_current_run'
  ) then
    raise exception 'Unexpected SECURITY DEFINER function in public is callable by authenticated';
  end if;

  if not has_function_privilege('authenticated', 'public.assay_review_has_current_run(uuid)', 'execute') then
    raise exception 'Authenticated cannot execute the review visibility/current-run helper';
  end if;

  if has_function_privilege('authenticated', 'public.assay_review_run_inputs(uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.assay_claim_review_run_slot(uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.assay_accept_workspace_invitation(text,uuid,text,boolean)', 'execute')
    or has_function_privilege('authenticated', 'public.assay_create_invitation(uuid,uuid,text,text,text,timestamp with time zone,integer)', 'execute')
    or has_function_privilege('authenticated', 'public.assay_revoke_invitation(uuid,uuid)', 'execute')
    or exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'assay_commit_review_run'
        and has_function_privilege('authenticated', p.oid, 'execute')
    ) then
    raise exception 'Authenticated can execute a service-role-only RPC';
  end if;
end;
$$;

insert into auth.users (id,aud,role,email,encrypted_password,created_at,updated_at)
values
 ('10000000-0000-4000-8000-000000000001','authenticated','authenticated','admin-a@test.invalid','',now(),now()),
 ('10000000-0000-4000-8000-000000000002','authenticated','authenticated','creator-a@test.invalid','',now(),now()),
 ('10000000-0000-4000-8000-000000000003','authenticated','authenticated','manager-a@test.invalid','',now(),now()),
 ('10000000-0000-4000-8000-000000000004','authenticated','authenticated','brand-a@test.invalid','',now(),now()),
 ('10000000-0000-4000-8000-000000000005','authenticated','authenticated','legal-a@test.invalid','',now(),now()),
 ('10000000-0000-4000-8000-000000000006','authenticated','authenticated','creator-b@test.invalid','',now(),now()),
 ('10000000-0000-4000-8000-000000000007','authenticated','authenticated','invite@test.invalid','',now(),now()),
 ('10000000-0000-4000-8000-000000000008','authenticated','authenticated','expired@test.invalid','',now(),now()),
 ('20000000-0000-4000-8000-000000000002','authenticated','authenticated','admin-b2@test.invalid','',now(),now()),
 ('20000000-0000-4000-8000-000000000003','authenticated','authenticated','admin-b3@test.invalid','',now(),now()),
 ('20000000-0000-4000-8000-000000000004','authenticated','authenticated','admin-b4@test.invalid','',now(),now()),
 ('20000000-0000-4000-8000-000000000001','authenticated','authenticated','owner-b@test.invalid','',now(),now())
on conflict (id) do nothing;

insert into public.organizations(id,name,owner_id) values
 ('a0000000-0000-4000-8000-000000000001','Org A','10000000-0000-4000-8000-000000000001'),
 ('b0000000-0000-4000-8000-000000000001','Org B','20000000-0000-4000-8000-000000000001');
insert into public.organization_members(organization_id,user_id,role) values
 ('a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','creator'),
 ('a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','manager'),
 ('a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','brand_reviewer'),
 ('a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','legal_reviewer'),
 ('a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000006','creator');
insert into public.organization_members(organization_id,user_id,role) values
 ('b0000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','admin'),
 ('b0000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','admin'),
 ('b0000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004','admin');

insert into public.workspace_invitations(id,organization_id,email,role,token_hash,invited_by,expires_at)
values
 ('b1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','invite@test.invalid','creator',
   encode(sha256(convert_to('test-invite-token-abcdefghijklmnopqrstuvwxyz','utf8')),'hex'),'20000000-0000-4000-8000-000000000001',now()+interval '1 day'),
 ('b1000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001','expired@test.invalid','creator',
   encode(sha256(convert_to('expired-invite-token-abcdefghijklmnopqrstuvwxyz','utf8')),'hex'),'20000000-0000-4000-8000-000000000001',now()-interval '1 day');
insert into public.workspace_invitations(id,organization_id,email,role,token_hash,invited_by,expires_at,accepted_at,accepted_by)
values
 ('a1000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001','accepted-again@test.invalid','creator',
   encode(sha256(convert_to('accepted-again-token-abcdefghijklmnopqrstuvwxyz','utf8')),'hex'),'10000000-0000-4000-8000-000000000001',now()+interval '1 day',now()-interval '1 hour','10000000-0000-4000-8000-000000000007'),
 ('a1000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000001','expired-again@test.invalid','creator',
   encode(sha256(convert_to('expired-again-token-abcdefghijklmnopqrstuvwxyz','utf8')),'hex'),'10000000-0000-4000-8000-000000000001',now()-interval '1 day');
insert into public.brand_rules(id,organization_id,rule_key,version,category,title,description,severity,status,active,created_by)
values
 ('a2000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','approved-a',1,'tone','Approved A','Visible approved rule','low','approved',true,'10000000-0000-4000-8000-000000000001'),
 ('a2000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','draft-a',1,'tone','Draft A','Private draft rule','low','draft',true,'10000000-0000-4000-8000-000000000001'),
 ('a2000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001','retired-a',1,'tone','Retired A','Private retired rule','low','retired',false,'10000000-0000-4000-8000-000000000001'),
 ('b2000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','rule-b',1,'tone','B rule','Private Org B rule','high','approved',true,'20000000-0000-4000-8000-000000000001');
insert into public.approved_claims(id,organization_id,statement,evidence_label,owner_label,created_by)
values
 ('a3000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','Approved fact','A evidence','A owner','10000000-0000-4000-8000-000000000001'),
 ('b3000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','B claim','B evidence','B owner','20000000-0000-4000-8000-000000000001');
insert into public.reviews(id,organization_id,title,content,created_by)
values
 ('a4000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Creator A review','Creator private copy','10000000-0000-4000-8000-000000000002'),
 ('a4000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','Manager A review','Manager private copy','10000000-0000-4000-8000-000000000003'),
 ('a4000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000001','Manager own','Own copy','10000000-0000-4000-8000-000000000003'),
 ('a4000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000000001','Stale run','Stale copy','10000000-0000-4000-8000-000000000002'),
 ('a4000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000001','Other creator asset','Private asset','10000000-0000-4000-8000-000000000006'),
 ('b4000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','B review','Secret Org B content','20000000-0000-4000-8000-000000000001');
insert into public.reviews(id,organization_id,title,content,assigned_reviewer,created_by)
values ('a4000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000001','Assigned to Creator','Assigned copy','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003');
insert into public.review_runs(organization_id,review_id,requested_by,content_sha256,rule_snapshot,finding_count,engine_version)
values
 ('a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000003',encode(sha256(convert_to('Own copy','utf8')),'hex'),'[]',0,'test'),
 ('a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000002',encode(sha256(convert_to('Stale copy','utf8')),'hex'),'[]',0,'test');
insert into public.review_findings(id,organization_id,review_id,finding_key,source_kind,rule_id,category,severity,state,title,explanation)
values
 ('a5000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002','seed-manager-finding','rule','a2000000-0000-4000-8000-000000000001','tone','high','violation','Manager finding','Private finding'),
 ('a5000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000005','seed-assigned-finding','rule','a2000000-0000-4000-8000-000000000001','tone','low','likely','Assigned finding','Visible to assigned creator'),
 ('a5000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000006','seed-low-finding','rule','a2000000-0000-4000-8000-000000000001','tone','low','likely','Creator low finding','Dismissal requires a reason'),
 ('a5000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000006','seed-high-finding','rule','a2000000-0000-4000-8000-000000000001','tone','high','violation','High finding','Cannot be dismissed by its creator'),
 ('b5000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','seed-b-finding','rule','b2000000-0000-4000-8000-000000000001','tone','high','violation','B finding','Private Org B finding');
insert into public.review_assets(id,organization_id,review_id,object_path,filename,mime_type,size_bytes,width,height,uploaded_by)
values ('a9000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001/a4000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000002/a9000000-0000-4000-8000-000000000001.png',
  'private.png','image/png',1,1,1,'10000000-0000-4000-8000-000000000002');
insert into storage.objects(bucket_id,name)
values ('assay-review-assets','a0000000-0000-4000-8000-000000000001/a4000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000002/a9000000-0000-4000-8000-000000000001.png');
insert into public.review_assets(id,organization_id,review_id,object_path,filename,mime_type,size_bytes,width,height,uploaded_by)
values ('a9000000-0000-4000-8000-000000000012','a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000001/a4000000-0000-4000-8000-000000000002/10000000-0000-4000-8000-000000000002/a9000000-0000-4000-8000-000000000012.png',
  'cap-12.png','image/png',1,1,1,'10000000-0000-4000-8000-000000000002');
insert into public.review_assets(id,organization_id,review_id,object_path,filename,mime_type,size_bytes,width,height,uploaded_by)
select ('a9000000-0000-4000-8000-'||lpad(asset_no::text,12,'0'))::uuid,
  'a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000001/a4000000-0000-4000-8000-000000000002/10000000-0000-4000-8000-000000000002/'||
    ('a9000000-0000-4000-8000-'||lpad(asset_no::text,12,'0'))||'.png',
  'cap-'||asset_no||'.png','image/png',1,1,1,'10000000-0000-4000-8000-000000000002'
from generate_series(2,10) asset_no;
do $$
begin
  begin
    insert into public.review_assets(id,organization_id,review_id,object_path,filename,mime_type,size_bytes,width,height,uploaded_by)
    values ('a9000000-0000-4000-8000-000000000011','a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002',
      'a0000000-0000-4000-8000-000000000001/a4000000-0000-4000-8000-000000000002/10000000-0000-4000-8000-000000000002/a9000000-0000-4000-8000-000000000011.png',
      'over-cap.png','image/png',1,1,1,'10000000-0000-4000-8000-000000000002');
    raise exception 'Review asset cap was not enforced';
  exception when program_limit_exceeded then null;
  end;
end $$;
insert into public.review_comments(id,organization_id,review_id,author_id,body,visibility)
values
 ('a6000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','Private manager comment','internal'),
 ('a6000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000003','Assigned review comment','shared'),
 ('b6000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','B comment','shared');
insert into public.review_revisions(id,organization_id,review_id,author_id,content_snapshot,label)
values
 ('a8000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','Private manager snapshot','initial'),
 ('a8000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000003','Assigned snapshot','initial');

do $$
begin
  if not exists (select 1 from storage.buckets where id='assay-review-assets' and public=false
    and file_size_limit=5242880 and allowed_mime_types @> array['image/png','image/jpeg','image/webp']) then
    raise exception 'Private review asset bucket is missing or misconfigured';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid='storage.objects'::regclass) then
    raise exception 'Storage object RLS is not enabled';
  end if;
end $$;

set local role authenticated;
do $$
declare actor record; table_name text; visible_count bigint; changed_count bigint; denied boolean;
  target_org uuid; asset_review_id uuid; asset_id uuid;
  table_names text[] := array['organizations','organization_members','workspace_invitations','brand_rules',
    'approved_claims','reviews','review_findings','review_runs','review_comments','review_events','review_revisions','review_decisions','review_assets','organization_events'];
begin
  -- Cross-organization reads/writes for all five roles and the second org's owner.
  for actor in select * from (values
    ('10000000-0000-4000-8000-000000000001'::uuid,'admin','b0000000-0000-4000-8000-000000000001'::uuid),
    ('10000000-0000-4000-8000-000000000002'::uuid,'creator','b0000000-0000-4000-8000-000000000001'::uuid),
    ('10000000-0000-4000-8000-000000000003'::uuid,'manager','b0000000-0000-4000-8000-000000000001'::uuid),
    ('10000000-0000-4000-8000-000000000004'::uuid,'brand_reviewer','b0000000-0000-4000-8000-000000000001'::uuid),
    ('10000000-0000-4000-8000-000000000005'::uuid,'legal_reviewer','b0000000-0000-4000-8000-000000000001'::uuid),
    ('20000000-0000-4000-8000-000000000001'::uuid,'admin-b','a0000000-0000-4000-8000-000000000001'::uuid)
  ) as actors(id,role_name,forbidden_org)
  loop
    target_org := actor.forbidden_org;
    perform set_config('request.jwt.claim.sub',actor.id::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.id,'role','authenticated')::text,true);
    foreach table_name in array table_names loop
      if table_name = 'organizations' then
        select count(*) into visible_count from public.organizations where id = target_org;
      else
        execute format('select count(*) from public.%I where organization_id = $1',table_name)
          into visible_count using target_org;
      end if;
      if visible_count <> 0 then raise exception 'RLS read leak: % sees %',actor.role_name,table_name; end if;
    end loop;

    if target_org = 'b0000000-0000-4000-8000-000000000001'::uuid then
      update public.reviews set title = 'tampered' where id = 'b4000000-0000-4000-8000-000000000001';
      get diagnostics changed_count = row_count;
      if changed_count <> 0 then raise exception 'RLS update leak for %',actor.role_name; end if;
    end if;

    foreach table_name in array table_names loop
      if table_name <> 'organizations' then
        denied := false;
        begin
          case table_name
            when 'organization_members' then insert into public.organization_members(organization_id,user_id,role) values (target_org,actor.id,'creator');
            when 'workspace_invitations' then insert into public.workspace_invitations(organization_id,email,role,token_hash,invited_by,expires_at) values (target_org,actor.id::text||'@denied.invalid','creator',encode(sha256(convert_to(gen_random_uuid()::text,'utf8')),'hex'),actor.id,now()+interval '1 day');
            when 'brand_rules' then insert into public.brand_rules(organization_id,rule_key,version,category,title,description,severity,created_by) values (target_org,gen_random_uuid()::text,1,'tone','denied','denied','low',actor.id);
            when 'approved_claims' then insert into public.approved_claims(organization_id,statement,evidence_label,owner_label,created_by) values (target_org,'denied','denied','denied',actor.id);
            when 'reviews' then insert into public.reviews(organization_id,title,content,created_by) values (target_org,'denied','denied',actor.id);
            when 'review_findings' then insert into public.review_findings(organization_id,review_id,finding_key,source_kind,rule_id,category,severity,state,title,explanation) values (target_org,'b4000000-0000-4000-8000-000000000001','denied-'||actor.id::text,'rule','b2000000-0000-4000-8000-000000000001','tone','low','violation','denied','denied');
            when 'review_runs' then insert into public.review_runs(organization_id,review_id,requested_by,content_sha256,rule_snapshot,finding_count,engine_version) values (target_org,'b4000000-0000-4000-8000-000000000001',actor.id,repeat('0',64),'[]',0,'test');
            when 'review_comments' then insert into public.review_comments(organization_id,review_id,author_id,body) values (target_org,'b4000000-0000-4000-8000-000000000001',actor.id,'denied');
            when 'review_events' then insert into public.review_events(organization_id,review_id,actor_id,action,rule_set_version) values (target_org,'b4000000-0000-4000-8000-000000000001',actor.id,'denied',1);
            when 'review_revisions' then insert into public.review_revisions(organization_id,review_id,author_id,content_snapshot,label) values (target_org,'b4000000-0000-4000-8000-000000000001',actor.id,'denied','denied');
            when 'review_decisions' then insert into public.review_decisions(organization_id,review_id,finding_key,finding_title,action,actor_id) values (target_org,'b4000000-0000-4000-8000-000000000001','denied','denied','resolved',actor.id);
            when 'review_assets' then
              asset_id := gen_random_uuid();
              asset_review_id := case when target_org='b0000000-0000-4000-8000-000000000001'::uuid
                then 'b4000000-0000-4000-8000-000000000001'::uuid else 'a4000000-0000-4000-8000-000000000001'::uuid end;
              insert into public.review_assets(id,organization_id,review_id,object_path,filename,mime_type,size_bytes,width,height,uploaded_by)
                values (asset_id,target_org,asset_review_id,
                  target_org::text||'/'||asset_review_id::text||'/'||actor.id::text||'/'||asset_id::text||'.png',
                  'denied.png','image/png',1,1,1,actor.id);
            when 'organization_events' then insert into public.organization_events(organization_id,actor_id,action) values (target_org,actor.id,'denied');
          end case;
        exception when insufficient_privilege then denied := true;
        end;
        if not denied then raise exception 'RLS insert leak: % wrote %',actor.role_name,table_name; end if;
      end if;
      denied := false;
      begin
        if table_name = 'organizations' then
          update public.organizations set name = name where id = target_org;
        else
          execute format('update public.%I set created_at = created_at where organization_id = $1',table_name) using target_org;
        end if;
        get diagnostics changed_count = row_count;
        if changed_count <> 0 then raise exception 'RLS update leak: % wrote %',actor.role_name,table_name; end if;
      exception when insufficient_privilege then denied := true;
      end;
      denied := false;
      begin
        if table_name = 'organizations' then delete from public.organizations where id = target_org;
        else execute format('delete from public.%I where organization_id = $1',table_name) using target_org;
        end if;
        get diagnostics changed_count = row_count;
        if changed_count <> 0 then raise exception 'RLS delete leak: % deleted %',actor.role_name,table_name; end if;
      exception when insufficient_privilege then denied := true;
      end;
    end loop;
  end loop;

  -- A creator sees only their own/assigned reviews and child rows, and only active approved rules.
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
  perform set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
  if (select count(*) from public.reviews where organization_id='a0000000-0000-4000-8000-000000000001') <> 3 then raise exception 'Creator sees another review or cannot see an assigned review'; end if;
  if (select count(*) from public.reviews where id='a4000000-0000-4000-8000-000000000002') <> 0 then raise exception 'Creator sees another creator review'; end if;
  if (select count(*) from public.review_findings where organization_id='a0000000-0000-4000-8000-000000000001') <> 3 then raise exception 'Creator child finding scope is incorrect'; end if;
  if (select count(*) from public.review_comments where organization_id='a0000000-0000-4000-8000-000000000001') <> 1 then raise exception 'Creator child comment scope is incorrect'; end if;
  if (select count(*) from public.review_events where organization_id='a0000000-0000-4000-8000-000000000001') <> 4 then raise exception 'Creator child event scope is incorrect'; end if;
  if (select count(*) from public.review_revisions where organization_id='a0000000-0000-4000-8000-000000000001') <> 1 then raise exception 'Creator child revision scope is incorrect'; end if;
  if (select count(*) from public.brand_rules where organization_id='a0000000-0000-4000-8000-000000000001') <> 1 then raise exception 'Creator sees draft or retired rules'; end if;

  -- User-editable JWT role metadata does not grant privileges.
  perform set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"assay_role":"admin"},"user_metadata":{"role":"admin"}}',true);
  if private.assay_has_role('a0000000-0000-4000-8000-000000000001',array['admin']::public.assay_role[]) then raise exception 'Fake JWT metadata granted admin'; end if;
  if (select count(*) from public.reviews where id='a4000000-0000-4000-8000-000000000002') <> 0 then raise exception 'Fake JWT metadata bypassed review visibility'; end if;

  -- Review insert/workflow guard: draft-only insert, creator cannot self-approve or set risk/assignment.
  denied := false;
  begin
    insert into public.reviews(organization_id,title,content,status,created_by)
    values ('a0000000-0000-4000-8000-000000000001','bad approved','bad','approved','10000000-0000-4000-8000-000000000002');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Direct approved review insert succeeded'; end if;
  denied := false;
  begin
    insert into public.reviews(organization_id,title,content,status,created_by)
    values ('a0000000-0000-4000-8000-000000000001','bad waived','bad','waived','10000000-0000-4000-8000-000000000002');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Direct waived review insert succeeded'; end if;
  insert into public.reviews(id,organization_id,title,content,created_by)
  values ('a4000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001','Creator draft','New copy','10000000-0000-4000-8000-000000000002');
  denied := false;
  begin update public.reviews set status='submitted' where id='a4000000-0000-4000-8000-000000000003';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Creator submitted without a review run'; end if;
  update public.reviews set content='Changed after the check' where id='a4000000-0000-4000-8000-000000000006';
  denied := false;
  begin update public.reviews set status='submitted' where id='a4000000-0000-4000-8000-000000000006';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Creator submitted with a stale review run'; end if;
  denied := false;
  begin update public.reviews set risk_tier='high' where id='a4000000-0000-4000-8000-000000000003';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Creator changed risk tier'; end if;
  denied := false;
  begin update public.reviews set status='approved' where id='a4000000-0000-4000-8000-000000000003';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Creator self-approved'; end if;
  denied := false;
  begin update public.reviews set status='approved' where id='a4000000-0000-4000-8000-000000000003';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Creator self-approved a submitted review'; end if;
  denied := false;
  begin insert into public.review_findings(organization_id,review_id,finding_key,source_kind,category,severity,state,title,explanation)
    values ('a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000003','client-fake','image_check','visual','low','likely','fake','fake');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Client inserted a finding'; end if;
  denied := false;
  begin update public.review_findings set title='client update' where review_id='a4000000-0000-4000-8000-000000000005';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Client updated a finding'; end if;
  denied := false;
  begin delete from public.review_findings where review_id='a4000000-0000-4000-8000-000000000005';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Client deleted a finding'; end if;
  denied := false;
  begin insert into public.review_runs(organization_id,review_id,requested_by,content_sha256,rule_snapshot,finding_count,engine_version)
    values ('a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',repeat('0',64),'[]',0,'test');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Client inserted a review run'; end if;
  denied := false;
  begin update public.review_runs set finding_count=1 where review_id='a4000000-0000-4000-8000-000000000006';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Client updated a review run'; end if;
  denied := false;
  begin delete from public.review_runs where review_id='a4000000-0000-4000-8000-000000000006';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Client deleted a review run'; end if;
  insert into public.review_decisions(organization_id,review_id,finding_key,finding_title,action,actor_id)
    values ('a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000003','test-key','Test finding','resolved','10000000-0000-4000-8000-000000000002');
  denied := false;
  begin insert into public.review_decisions(organization_id,review_id,finding_key,finding_title,action,actor_id)
    values ('a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000006','seed-low-finding','Creator low finding','dismissed','10000000-0000-4000-8000-000000000002');
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'Dismissal without a reason succeeded'; end if;
  denied := false;
  begin update public.review_decisions set reason='tampered' where review_id='a4000000-0000-4000-8000-000000000003';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Review decisions were mutable'; end if;
  denied := false;
  begin delete from public.review_decisions where review_id='a4000000-0000-4000-8000-000000000003';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Review decisions were deletable'; end if;
  denied := false;
  begin insert into public.review_events(organization_id,review_id,actor_id,action,rule_set_version)
    values ('a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','fake',1);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Client inserted an audit event'; end if;
  denied := false;
  begin update public.review_events set action='tampered' where review_id='a4000000-0000-4000-8000-000000000005';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Client updated an audit event'; end if;
  denied := false;
  begin delete from public.review_events where review_id='a4000000-0000-4000-8000-000000000005';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Client deleted an audit event'; end if;
  denied := false;
  begin insert into public.review_decisions(organization_id,review_id,finding_key,finding_title,action,reason,actor_id)
    values ('a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000006','seed-high-finding','High finding','dismissed','not applicable','10000000-0000-4000-8000-000000000002');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Creator dismissed a high-severity finding'; end if;
  denied := false;
  begin insert into public.review_decisions(organization_id,review_id,finding_key,finding_title,action,reason,actor_id)
    values ('a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000006','made-up-key','Made up','dismissed','not applicable','10000000-0000-4000-8000-000000000002');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Creator dismissed a nonexistent finding key'; end if;
  denied := false;
  begin insert into storage.objects(bucket_id,name)
    values ('assay-review-assets','a0000000-0000-4000-8000-000000000001/a4000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000002/ffffffff-ffff-4fff-8fff-ffffffffffff.png');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Creator uploaded an object to a spoofed path'; end if;
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000006',true);
  perform set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
  if exists (select 1 from storage.objects where bucket_id='assay-review-assets'
    and name='a0000000-0000-4000-8000-000000000001/a4000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000002/a9000000-0000-4000-8000-000000000001.png') then
    raise exception 'Creator read another creator storage object';
  end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
update public.approved_claims set owner_label='Brand legal' where id='a3000000-0000-4000-8000-000000000002';
do $$
begin
  if (select version from public.approved_claims where id='a3000000-0000-4000-8000-000000000002') <> 2 then
    raise exception 'Claim updates did not increment the claim version';
  end if;
end;
$$;
insert into public.reviews(id,organization_id,title,content,created_by)
values
 ('a4000000-0000-4000-8000-000000000008','a0000000-0000-4000-8000-000000000001','Approval stale','Checked copy','10000000-0000-4000-8000-000000000002'),
 ('a4000000-0000-4000-8000-000000000009','a0000000-0000-4000-8000-000000000001','Waiver stale','Waiver copy','10000000-0000-4000-8000-000000000002'),
 ('a4000000-0000-4000-8000-000000000010','a0000000-0000-4000-8000-000000000001','Waiver asset stale','Asset waiver copy','10000000-0000-4000-8000-000000000002');
insert into public.review_assets(id,organization_id,review_id,object_path,filename,mime_type,size_bytes,width,height,alt_text,palette,uploaded_by)
values ('a9000000-0000-4000-8000-000000000020','a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000003',
  'a0000000-0000-4000-8000-000000000001/a4000000-0000-4000-8000-000000000003/10000000-0000-4000-8000-000000000002/a9000000-0000-4000-8000-000000000020.png',
  'missing-alt.png','image/png',1,100,100,'','[]','10000000-0000-4000-8000-000000000002');
set local role service_role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"service_role"}',true);
do $$
declare inputs jsonb; run_result jsonb; run_count bigint; finding_count bigint; event_count bigint;
begin
  inputs := public.assay_review_run_inputs('a4000000-0000-4000-8000-000000000003');
  if inputs->>'content' <> 'New copy' then raise exception 'Server did not load the review content'; end if;
  select count(*) into run_count from public.review_runs where review_id='a4000000-0000-4000-8000-000000000003';
  select count(*) into finding_count from public.review_findings where review_id='a4000000-0000-4000-8000-000000000003';
  select count(*) into event_count from public.review_events where review_id='a4000000-0000-4000-8000-000000000003';
  run_result := public.assay_commit_review_run(
    'a4000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',
    repeat('0',64),inputs->>'assets_sha256',inputs->>'rules_sha256',inputs->>'claims_sha256',inputs->>'input_sha256',
    '[]',inputs->'rules',inputs->'claims',inputs->'assets','test-engine'
  );
  if run_result->>'status' <> 'stale' then raise exception 'Stale content was not rejected'; end if;
  if (select count(*) from public.review_runs where review_id='a4000000-0000-4000-8000-000000000003') <> run_count
    or (select count(*) from public.review_findings where review_id='a4000000-0000-4000-8000-000000000003') <> finding_count
    or (select count(*) from public.review_events where review_id='a4000000-0000-4000-8000-000000000003') <> event_count then
    raise exception 'Stale run wrote findings, a run, or an event';
  end if;

  run_result := public.assay_commit_review_run(
    'a4000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',
    inputs->>'content_sha256',inputs->>'assets_sha256',inputs->>'rules_sha256',inputs->>'claims_sha256',inputs->>'input_sha256',
    jsonb_build_array(jsonb_build_object(
      'finding_key','server-test-finding','source_kind','rule',
      'rule_id','a2000000-0000-4000-8000-000000000001','claim_id',null,
      'category','tone','severity','low','state','likely','title','Server finding',
      'excerpt','New copy','explanation','Created in the atomic run transaction','confidence',null
    ),jsonb_build_object(
      'finding_key','server-image-finding','source_kind','image_check',
      'rule_id',null,'claim_id',null,'category','accessibility','severity','high',
      'state','violation','title','Add descriptive alt text',
      'excerpt','missing-alt.png','explanation','Server image finding','confidence',null
    )),
    inputs->'rules',
    inputs->'claims',
    inputs->'assets','test-engine'
  );
  if run_result->>'status' <> 'ok' then raise exception 'Atomic review run did not succeed'; end if;
  if not exists (select 1 from public.review_runs where review_id='a4000000-0000-4000-8000-000000000003'
    and snapshot_version=1 and jsonb_array_length(asset_snapshot)=1
    and asset_snapshot->0->>'id'='a9000000-0000-4000-8000-000000000020') then raise exception 'Run snapshot omitted asset state'; end if;
  if not exists (select 1 from public.review_runs where review_id='a4000000-0000-4000-8000-000000000003'
    and rule_snapshot->0->>'version'='1' and length(rule_snapshot->0->>'text_sha256')=64
    and claim_snapshot->0->>'version'='2' and length(claim_snapshot->0->>'text_sha256')=64
    and rules_sha256=inputs->>'rules_sha256' and claims_sha256=inputs->>'claims_sha256'
    and valid_until > now()) then
    raise exception 'Run snapshot omitted rule or claim versions and text hashes';
  end if;
  if not exists (select 1 from public.review_findings where review_id='a4000000-0000-4000-8000-000000000003'
    and finding_key='server-test-finding') then raise exception 'Atomic run omitted its finding'; end if;
  if not exists (select 1 from public.review_findings where review_id='a4000000-0000-4000-8000-000000000003'
    and finding_key='server-image-finding' and source_kind='image_check') then raise exception 'Atomic run omitted its image finding'; end if;
end;
$$;
reset role;
delete from private.review_run_rate_limits where review_id='a4000000-0000-4000-8000-000000000003';
set local role service_role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"service_role"}',true);
do $$
declare inputs jsonb; run_result jsonb;
begin
  inputs := public.assay_review_run_inputs('a4000000-0000-4000-8000-000000000003');
  run_result := public.assay_commit_review_run(
    'a4000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',
    inputs->>'content_sha256',inputs->>'assets_sha256',inputs->>'rules_sha256',inputs->>'claims_sha256',inputs->>'input_sha256',
    jsonb_build_array(jsonb_build_object(
      'finding_key','server-image-finding','source_kind','image_check',
      'rule_id',null,'claim_id',null,'category','accessibility','severity','high',
      'state','violation','title','Add descriptive alt text',
      'excerpt','missing-alt.png','explanation','Recomputed image finding','confidence',null
    )),
    inputs->'rules',
    inputs->'claims',
    inputs->'assets','test-engine'
  );
  if run_result->>'status' <> 'ok' then raise exception 'Image checks could not be recomputed'; end if;
  if exists (select 1 from public.review_findings where review_id='a4000000-0000-4000-8000-000000000003'
    and finding_key='server-test-finding') then raise exception 'Stale rule finding was not removed'; end if;
  if not exists (select 1 from public.review_findings where review_id='a4000000-0000-4000-8000-000000000003'
    and finding_key='server-image-finding' and source_kind='image_check') then raise exception 'Image finding disappeared on rerun'; end if;
end;
$$;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare inputs jsonb; run_result jsonb;
begin
  inputs := public.assay_review_run_inputs('a4000000-0000-4000-8000-000000000003');
  update public.brand_rules set status='retired', active=false
    where id='a2000000-0000-4000-8000-000000000001';
  run_result := public.assay_commit_review_run(
    'a4000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',
    inputs->>'content_sha256',inputs->>'assets_sha256',inputs->>'rules_sha256',inputs->>'claims_sha256',inputs->>'input_sha256',
    '[]',inputs->'rules',inputs->'claims',inputs->'assets','test-engine'
  );
  if run_result->>'status' <> 'stale' then raise exception 'Rule retirement did not stale a check'; end if;
  update public.brand_rules set status='approved', active=true
    where id='a2000000-0000-4000-8000-000000000001';

  inputs := public.assay_review_run_inputs('a4000000-0000-4000-8000-000000000003');
  update public.approved_claims set statement='Changed approved fact'
    where id='a3000000-0000-4000-8000-000000000002';
  run_result := public.assay_commit_review_run(
    'a4000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',
    inputs->>'content_sha256',inputs->>'assets_sha256',inputs->>'rules_sha256',inputs->>'claims_sha256',inputs->>'input_sha256',
    '[]',inputs->'rules',inputs->'claims',inputs->'assets','test-engine'
  );
  if run_result->>'status' <> 'stale' then raise exception 'Claim edit did not stale a check'; end if;
  update public.approved_claims set statement='Approved fact'
    where id='a3000000-0000-4000-8000-000000000002';

  insert into public.approved_claims(id,organization_id,statement,evidence_label,owner_label,expires_at,created_by)
  values ('a3000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001',
    'Temporary fact','Evidence','Owner',current_date+30,'10000000-0000-4000-8000-000000000001');
  inputs := public.assay_review_run_inputs('a4000000-0000-4000-8000-000000000003');
  update public.approved_claims set expires_at=current_date-1
    where id='a3000000-0000-4000-8000-000000000003';
  run_result := public.assay_commit_review_run(
    'a4000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',
    inputs->>'content_sha256',inputs->>'assets_sha256',inputs->>'rules_sha256',inputs->>'claims_sha256',inputs->>'input_sha256',
    '[]',inputs->'rules',inputs->'claims',inputs->'assets','test-engine'
  );
  if run_result->>'status' <> 'stale' then raise exception 'Claim expiry change did not stale a check'; end if;
  update public.approved_claims set active=false where id='a3000000-0000-4000-8000-000000000003';

  inputs := public.assay_review_run_inputs('a4000000-0000-4000-8000-000000000008');
  update public.reviews set content='Changed after the checked run'
    where id='a4000000-0000-4000-8000-000000000008';
  run_result := public.assay_commit_review_run(
    'a4000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000002',
    inputs->>'content_sha256',inputs->>'assets_sha256',inputs->>'rules_sha256',inputs->>'claims_sha256',inputs->>'input_sha256',
    '[]',inputs->'rules',inputs->'claims',inputs->'assets','test-engine'
  );
  if run_result->>'status' <> 'stale' then raise exception 'Content edit did not stale a check'; end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
do $$
declare inputs jsonb; run_result jsonb; run_input record;
begin
  if auth.uid() is not null then raise exception 'Server test context still has a user identity'; end if;

  insert into public.review_findings(organization_id,review_id,finding_key,source_kind,rule_id,category,severity,state,title,explanation)
  values ('a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000003','server-direct-finding','rule',
    'a2000000-0000-4000-8000-000000000001','tone','low','likely','Server finding','Created by postgres');
  delete from public.review_findings where review_id='a4000000-0000-4000-8000-000000000003'
    and finding_key='server-direct-finding';
  if not found then raise exception 'Postgres could not delete a finding'; end if;
end;
$$;
set local role service_role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"service_role"}',true);
do $$
declare inputs jsonb; run_result jsonb; run_input record;
begin
  for run_input in
    select * from (values
      ('a4000000-0000-4000-8000-000000000004'::uuid,'10000000-0000-4000-8000-000000000003'::uuid),
      ('a4000000-0000-4000-8000-000000000008'::uuid,'10000000-0000-4000-8000-000000000002'::uuid),
      ('a4000000-0000-4000-8000-000000000009'::uuid,'10000000-0000-4000-8000-000000000002'::uuid),
      ('a4000000-0000-4000-8000-000000000010'::uuid,'10000000-0000-4000-8000-000000000002'::uuid)
    ) as fixtures(review_id,requested_by)
  loop
    inputs := public.assay_review_run_inputs(run_input.review_id);
    run_result := public.assay_commit_review_run(
      run_input.review_id,run_input.requested_by,
      inputs->>'content_sha256',inputs->>'assets_sha256',inputs->>'rules_sha256',inputs->>'claims_sha256',inputs->>'input_sha256',
      '[]',inputs->'rules',inputs->'claims',inputs->'assets','test-engine'
    );
    if run_result->>'status' <> 'ok' then raise exception 'Could not create fixture review run'; end if;
  end loop;
  update public.review_runs set valid_until=now()-interval '1 second'
    where review_id='a4000000-0000-4000-8000-000000000009';
end;
$$;
do $$
declare result jsonb; invite_hash text; expired_hash text;
begin
  invite_hash := encode(sha256(convert_to('test-invite-token-abcdefghijklmnopqrstuvwxyz','utf8')),'hex');
  expired_hash := encode(sha256(convert_to('expired-invite-token-abcdefghijklmnopqrstuvwxyz','utf8')),'hex');
  result := public.assay_accept_workspace_invitation(invite_hash,'10000000-0000-4000-8000-000000000007','invite@test.invalid',false);
  if result->>'status' <> 'invalid' then raise exception 'Unconfirmed email accepted an invitation'; end if;
  result := public.assay_accept_workspace_invitation(invite_hash,'10000000-0000-4000-8000-000000000007','wrong@test.invalid',true);
  if result->>'status' <> 'invalid' then raise exception 'Invitation email mismatch was accepted'; end if;
  result := public.assay_accept_workspace_invitation(expired_hash,'10000000-0000-4000-8000-000000000008','expired@test.invalid',true);
  if result->>'status' <> 'invalid' then raise exception 'Expired invitation was accepted'; end if;
  result := public.assay_accept_workspace_invitation(invite_hash,'10000000-0000-4000-8000-000000000007','invite@test.invalid',true);
  if result->>'status' <> 'accepted' or result->>'role' <> 'creator' then raise exception 'Valid invitation was not accepted with its invited role'; end if;
  if not exists (select 1 from public.organization_members where organization_id='b0000000-0000-4000-8000-000000000001'
    and user_id='10000000-0000-4000-8000-000000000007' and role='creator') then raise exception 'Invitation membership was not created'; end if;
  result := public.assay_accept_workspace_invitation(invite_hash,'10000000-0000-4000-8000-000000000007','invite@test.invalid',true);
  if result->>'status' <> 'invalid' then raise exception 'Reused invitation token was accepted'; end if;
end;
$$;
do $$
declare result jsonb; created_id uuid; invite_number integer; actor_id uuid;
begin
  result := public.assay_create_invitation(
    'a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',
    'manager-legal@test.invalid','legal_reviewer',repeat('c',64),now()+interval '7 days',20
  );
  if result->>'status' <> 'forbidden' then raise exception 'Manager invited a legal reviewer through the server RPC'; end if;

  result := public.assay_create_invitation(
    'a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    'accepted-again@test.invalid','creator',repeat('d',64),now()+interval '7 days',20
  );
  if result->>'status' <> 'created' then raise exception 'Accepted invitation could not be re-invited'; end if;
  result := public.assay_create_invitation(
    'a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    'expired-again@test.invalid','creator',repeat('e',64),now()+interval '7 days',20
  );
  if result->>'status' <> 'created' then raise exception 'Expired invitation could not be re-invited'; end if;

  for invite_number in 1..5 loop
    result := public.assay_create_invitation(
      'a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',
      'burst-'||invite_number||'@test.invalid','creator',md5('burst-'||invite_number)||md5('burst-token-'||invite_number),
      now()+interval '7 days',20
    );
    if result->>'status' <> 'created' then raise exception 'Valid invitation burst item % was rejected',invite_number; end if;
  end loop;
  result := public.assay_create_invitation(
    'a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',
    'burst-six@test.invalid','creator',repeat('f',64),now()+interval '7 days',20
  );
  if result->>'status' <> 'rate_limited' then raise exception 'Per-actor invitation burst limit was not enforced'; end if;

  for invite_number in 1..20 loop
    actor_id := case (invite_number - 1) % 4
      when 0 then '20000000-0000-4000-8000-000000000001'::uuid
      when 1 then '20000000-0000-4000-8000-000000000002'::uuid
      when 2 then '20000000-0000-4000-8000-000000000003'::uuid
      else '20000000-0000-4000-8000-000000000004'::uuid
    end;
    result := public.assay_create_invitation(
      'b0000000-0000-4000-8000-000000000001',actor_id,
      'cap-'||invite_number||'@test.invalid','creator',md5('cap-'||invite_number)||md5('cap-token-'||invite_number),
      now()+interval '7 days',20
    );
    if result->>'status' <> 'created' then raise exception 'Invitation % before the daily cap was rejected',invite_number; end if;
    if invite_number = 1 then created_id := (result->>'invitation_id')::uuid; end if;
  end loop;
  perform public.assay_revoke_invitation('b0000000-0000-4000-8000-000000000001',created_id);
  result := public.assay_create_invitation(
    'b0000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    'cap-21@test.invalid','creator',repeat('a',64),now()+interval '7 days',20
  );
  if result->>'status' <> 'daily_limit' then raise exception 'Daily invitation cap did not block invitation 21'; end if;
end;
$$;
reset role;
set local role authenticated;
do $$
declare denied boolean; changed_count bigint;
begin
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
  perform set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
  update public.reviews set status='submitted' where id='a4000000-0000-4000-8000-000000000003';
  if not public.assay_review_has_current_run('a4000000-0000-4000-8000-000000000003') then raise exception 'Current run was not recognized'; end if;
  if (select jsonb_array_length(rule_snapshot) from public.reviews where id='a4000000-0000-4000-8000-000000000003') <> 1 then raise exception 'Submission did not snapshot approved rule ID/version'; end if;
  denied := false;
  changed_count := 0;
  begin
    update public.reviews set status='approved' where id='a4000000-0000-4000-8000-000000000003';
    get diagnostics changed_count = row_count;
  exception when insufficient_privilege then denied := true; end;
  if not denied and changed_count <> 0 then raise exception 'Creator self-approved a submitted review'; end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
do $$
declare denied boolean;
begin
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
  perform set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
  if (select count(*) from public.review_comments where visibility='internal') <> 1 then raise exception 'Reviewer cannot read internal notes'; end if;
  denied := false;
  begin insert into public.workspace_invitations(organization_id,email,role,token_hash,invited_by,expires_at)
    values ('a0000000-0000-4000-8000-000000000001','legal-invite@test.invalid','legal_reviewer',
      encode(sha256(convert_to('manager-legal-test','utf8')),'hex'),'10000000-0000-4000-8000-000000000003',now()+interval '1 day');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Manager invited a legal reviewer'; end if;
  insert into public.review_decisions(organization_id,review_id,finding_key,finding_title,action,reason,actor_id)
    values ('a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000006','seed-high-finding','High finding','dismissed','Manager reviewed the evidence','10000000-0000-4000-8000-000000000003');

  denied := false;
  begin update public.reviews set status='submitted' where id='a4000000-0000-4000-8000-000000000008';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Review was submitted after its content changed from the checked run'; end if;

  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
  perform set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
  update public.reviews set status='submitted' where id='a4000000-0000-4000-8000-000000000009';
  update public.reviews set status='submitted' where id='a4000000-0000-4000-8000-000000000010';
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',true);
  perform set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
  denied := false;
  begin update public.reviews set status='approved' where id='a4000000-0000-4000-8000-000000000009';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Legal approved a review after its run valid_until'; end if;
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
  perform set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',true);

  -- Manager cannot approve their own review; high risk requires legal/admin approval.
  update public.reviews set status='submitted' where id='a4000000-0000-4000-8000-000000000004';
  denied := false;
  begin update public.reviews set status='approved' where id='a4000000-0000-4000-8000-000000000004';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Manager approved their own review'; end if;
  denied := false;
  begin update public.reviews set assigned_reviewer='20000000-0000-4000-8000-000000000001' where id='a4000000-0000-4000-8000-000000000003';
  exception when foreign_key_violation then denied := true; end;
  if not denied then raise exception 'Cross-organization reviewer assignment succeeded'; end if;
  update public.reviews set risk_tier='high' where id='a4000000-0000-4000-8000-000000000003';
  denied := false;
  begin update public.reviews set status='approved' where id='a4000000-0000-4000-8000-000000000003';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Manager approved high-risk review without legal'; end if;
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',true);
  perform set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
  denied := false;
  begin update public.reviews set content='Changed during approval',status='approved' where id='a4000000-0000-4000-8000-000000000003';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Content changed during approval'; end if;
  update public.reviews set status='approved' where id='a4000000-0000-4000-8000-000000000003';
  if (select approved_content_sha256 from public.reviews where id='a4000000-0000-4000-8000-000000000003') <> encode(sha256(convert_to('New copy','utf8')),'hex') then raise exception 'Approved content hash was not stored'; end if;
  if (select approved_run_id from public.reviews where id='a4000000-0000-4000-8000-000000000003') is null then raise exception 'Approved run ID was not stored'; end if;
  denied := false;
  begin update public.reviews set approved_content_sha256=repeat('0',64) where id='a4000000-0000-4000-8000-000000000003';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Approved content hash was overwritten'; end if;
  update public.reviews set status='waived',waiver_reason='Temporary exception',waiver_expires_at=current_date+30 where id='a4000000-0000-4000-8000-000000000004';
  denied := false;
  begin update public.reviews set content='Edited after waiver' where id='a4000000-0000-4000-8000-000000000004';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Waived review was mutable'; end if;

  -- Approved rule content cannot be changed; approval is recorded by the database.
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
  perform set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
  update public.brand_rules set status='approved' where id='a2000000-0000-4000-8000-000000000002';
  if (select approved_by from public.brand_rules where id='a2000000-0000-4000-8000-000000000002') <> '10000000-0000-4000-8000-000000000004'::uuid then raise exception 'Rule approval actor missing'; end if;
  insert into public.brand_rules(id,organization_id,rule_key,version,category,title,description,severity,status,active,created_by)
    values ('a2000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000001','approved-a',2,'tone','Approved A v2','Second active version','low','draft',true,'10000000-0000-4000-8000-000000000004');
  denied := false;
  begin update public.brand_rules set status='approved' where id='a2000000-0000-4000-8000-000000000004';
  exception when unique_violation then denied := true; end;
  if not denied then raise exception 'Two active approved rule versions existed'; end if;
  denied := false;
  begin update public.brand_rules set title='mutated' where id='a2000000-0000-4000-8000-000000000002';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Approved rule content was edited in place'; end if;
  denied := false;
  begin insert into public.approved_claims(organization_id,statement,evidence_label,evidence_url,owner_label,created_by)
    values ('a0000000-0000-4000-8000-000000000001','unsafe link','proof','javascript:alert(1)','owner','10000000-0000-4000-8000-000000000004');
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'Unsafe evidence URL passed validation'; end if;

  -- Only the owner RPC can promote an admin; direct user_id/admin writes are blocked.
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
  denied := false;
  begin update public.organization_members set user_id='10000000-0000-4000-8000-000000000005' where organization_id='a0000000-0000-4000-8000-000000000001' and user_id='10000000-0000-4000-8000-000000000002';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Member user_id was mutable'; end if;
  denied := false;
  begin update public.organization_members set role='admin' where organization_id='a0000000-0000-4000-8000-000000000001' and user_id='10000000-0000-4000-8000-000000000002';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Direct admin promotion succeeded'; end if;
  perform private.assay_set_member_role('a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','admin');
  if (select count(*) from public.organization_events where organization_id='a0000000-0000-4000-8000-000000000001' and action='member_role_changed') = 0 then raise exception 'Admin promotion was not audited'; end if;

  -- Hard delete is unavailable; history remains.
  denied := false;
  begin delete from public.reviews where id='a4000000-0000-4000-8000-000000000003';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Review hard delete was available'; end if;
  if (select count(*) from public.review_events where review_id='a4000000-0000-4000-8000-000000000003') = 0 then raise exception 'Review audit trail missing'; end if;

  -- Ordinary members can leave; owner/admin memberships cannot be deleted directly.
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
  perform set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
  delete from public.organization_members where organization_id='a0000000-0000-4000-8000-000000000001' and user_id='10000000-0000-4000-8000-000000000002';
  if (select assigned_reviewer from public.reviews where id='a4000000-0000-4000-8000-000000000005') is not null then raise exception 'Leaving reviewer remained assigned'; end if;

  -- Ownership can be transferred only by the current owner and is audited.
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
  perform private.assay_transfer_organization_owner('a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003');
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
  perform set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
  if (select owner_id from public.organizations where id='a0000000-0000-4000-8000-000000000001') <> '10000000-0000-4000-8000-000000000003'::uuid then raise exception 'Ownership transfer failed'; end if;
  if (select count(*) from public.organization_events where organization_id='a0000000-0000-4000-8000-000000000001' and action='ownership_transferred') <> 1 then raise exception 'Ownership transfer was not audited'; end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
insert into public.review_assets(id,organization_id,review_id,object_path,filename,mime_type,size_bytes,width,height,uploaded_by)
values ('a9000000-0000-4000-8000-000000000021','a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000010',
  'a0000000-0000-4000-8000-000000000001/a4000000-0000-4000-8000-000000000010/10000000-0000-4000-8000-000000000002/a9000000-0000-4000-8000-000000000021.png',
  'waiver-asset.png','image/png',1,100,100,'10000000-0000-4000-8000-000000000002');
set local role authenticated;
do $$
declare denied boolean;
begin
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',true);
  perform set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
  if public.assay_review_has_current_run('a4000000-0000-4000-8000-000000000010') then
    raise exception 'Asset change did not stale the run';
  end if;
  denied := false;
  begin update public.reviews set status='waived',waiver_reason='Temporary exception',waiver_expires_at=current_date+30
    where id='a4000000-0000-4000-8000-000000000010';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Legal waived a review after its assets changed'; end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
insert into public.reviews(id,organization_id,title,content,created_by,created_at)
select ('d4000000-0000-4000-8000-'||lpad(page_number::text,12,'0'))::uuid,
  'a0000000-0000-4000-8000-000000000001',
  'pagination-'||page_number,
  'pagination content',
  '10000000-0000-4000-8000-000000000001',
  '2026-01-01 00:00:00+00'::timestamptz
from generate_series(1,51) page_number;
do $$
declare
  cursor_created_at timestamptz;
  cursor_id uuid;
  page_ids uuid[];
  all_ids uuid[] := '{}'::uuid[];
  distinct_count bigint;
begin
  loop
    select array_agg(page.id order by page.created_at desc, page.id desc)
      into page_ids
      from (
        select r.id, r.created_at
        from public.reviews r
        where r.organization_id='a0000000-0000-4000-8000-000000000001'
          and r.title like 'pagination-%'
          and (cursor_created_at is null
            or r.created_at < cursor_created_at
            or (r.created_at = cursor_created_at and r.id < cursor_id))
        order by r.created_at desc, r.id desc
        limit 25
      ) page;
    exit when coalesce(cardinality(page_ids),0)=0;
    all_ids := all_ids || page_ids;
    cursor_id := page_ids[cardinality(page_ids)];
    select r.created_at into cursor_created_at from public.reviews r where r.id=cursor_id;
  end loop;
  select count(distinct ids.id) into distinct_count from unnest(all_ids) as ids(id);
  if cardinality(all_ids) <> 51 or distinct_count <> 51 then
    raise exception 'Keyset pagination skipped or repeated reviews with duplicate timestamps';
  end if;
end;
$$;

-- anon has no table privileges, independently of RLS.
set local role anon;
do $$
declare t text;
begin
  foreach t in array array['organizations','organization_members','workspace_invitations','brand_rules','approved_claims','reviews','review_findings','review_runs','review_comments','review_events','review_revisions','review_decisions','review_assets','organization_events'] loop
    if has_table_privilege('anon','public.'||t,'select') or has_table_privilege('anon','public.'||t,'insert')
      or has_table_privilege('anon','public.'||t,'update') or has_table_privilege('anon','public.'||t,'delete') then
      raise exception 'anon has table privilege on %',t;
    end if;
    begin execute format('select count(*) from public.%I',t); raise exception 'anon read succeeded on %',t;
    exception when insufficient_privilege then null; end;
  end loop;
  begin insert into public.reviews(organization_id,title,content,created_by)
    values ('a0000000-0000-4000-8000-000000000001','anon','denied','10000000-0000-4000-8000-000000000002');
    raise exception 'anon write succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select ok(true, 'tenant isolation, creator privacy, workflow guards, rule immutability, audit, fake-role, anon, and membership cases passed');
select * from finish();
rollback;
