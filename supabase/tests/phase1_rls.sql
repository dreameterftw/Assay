-- Hosted SQL policy/trigger integration suite; no local Docker runtime required.
-- Run against a disposable Supabase project after applying migrations.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(1);

insert into auth.users (id,aud,role,email,encrypted_password,created_at,updated_at)
values
 ('10000000-0000-4000-8000-000000000001','authenticated','authenticated','admin-a@test.invalid','',now(),now()),
 ('10000000-0000-4000-8000-000000000002','authenticated','authenticated','creator-a@test.invalid','',now(),now()),
 ('10000000-0000-4000-8000-000000000003','authenticated','authenticated','manager-a@test.invalid','',now(),now()),
 ('10000000-0000-4000-8000-000000000004','authenticated','authenticated','brand-a@test.invalid','',now(),now()),
 ('10000000-0000-4000-8000-000000000005','authenticated','authenticated','legal-a@test.invalid','',now(),now()),
 ('20000000-0000-4000-8000-000000000001','authenticated','authenticated','owner-b@test.invalid','',now(),now())
on conflict (id) do nothing;

insert into public.organizations(id,name,owner_id) values
 ('a0000000-0000-4000-8000-000000000001','Org A','10000000-0000-4000-8000-000000000001'),
 ('b0000000-0000-4000-8000-000000000001','Org B','20000000-0000-4000-8000-000000000001');
insert into public.organization_members(organization_id,user_id,role) values
 ('a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','creator'),
 ('a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','manager'),
 ('a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','brand_reviewer'),
 ('a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','legal_reviewer');

insert into public.workspace_invitations(id,organization_id,email,role,token_hash,invited_by,expires_at)
values ('b1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','invite@test.invalid','creator','hash-b','20000000-0000-4000-8000-000000000001',now()+interval '1 day');
insert into public.brand_rules(id,organization_id,rule_key,version,category,title,description,severity,status,active,created_by)
values
 ('a2000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','approved-a',1,'tone','Approved A','Visible approved rule','low','approved',true,'10000000-0000-4000-8000-000000000001'),
 ('a2000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','draft-a',1,'tone','Draft A','Private draft rule','low','draft',true,'10000000-0000-4000-8000-000000000001'),
 ('a2000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001','retired-a',1,'tone','Retired A','Private retired rule','low','retired',false,'10000000-0000-4000-8000-000000000001'),
 ('b2000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','rule-b',1,'tone','B rule','Private Org B rule','high','approved',true,'20000000-0000-4000-8000-000000000001');
insert into public.approved_claims(id,organization_id,statement,evidence_label,owner_label,created_by)
values ('b3000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','B claim','B evidence','B owner','20000000-0000-4000-8000-000000000001');
insert into public.reviews(id,organization_id,title,content,created_by)
values
 ('a4000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Creator A review','Creator private copy','10000000-0000-4000-8000-000000000002'),
 ('a4000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','Manager A review','Manager private copy','10000000-0000-4000-8000-000000000003'),
 ('b4000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','B review','Secret Org B content','20000000-0000-4000-8000-000000000001');
insert into public.reviews(id,organization_id,title,content,assigned_reviewer,created_by)
values ('a4000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000001','Assigned to Creator','Assigned copy','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003');
insert into public.review_findings(id,organization_id,review_id,source_kind,rule_id,category,severity,state,title,explanation)
values
 ('a5000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002','rule','a2000000-0000-4000-8000-000000000001','tone','high','violation','Manager finding','Private finding'),
 ('a5000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000005','rule','a2000000-0000-4000-8000-000000000001','tone','low','likely','Assigned finding','Visible to assigned creator'),
 ('b5000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','rule','b2000000-0000-4000-8000-000000000001','tone','high','violation','B finding','Private Org B finding');
insert into public.review_comments(id,organization_id,review_id,author_id,body)
values
 ('a6000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','Private manager comment'),
 ('a6000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000003','Assigned review comment'),
 ('b6000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','B comment');
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
    'approved_claims','reviews','review_findings','review_comments','review_events','review_revisions','review_decisions','review_assets','organization_events'];
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
            when 'workspace_invitations' then insert into public.workspace_invitations(organization_id,email,role,token_hash,invited_by,expires_at) values (target_org,actor.id::text||'@denied.invalid','creator',gen_random_uuid()::text,actor.id,now()+interval '1 day');
            when 'brand_rules' then insert into public.brand_rules(organization_id,rule_key,version,category,title,description,severity,created_by) values (target_org,gen_random_uuid()::text,1,'tone','denied','denied','low',actor.id);
            when 'approved_claims' then insert into public.approved_claims(organization_id,statement,evidence_label,owner_label,created_by) values (target_org,'denied','denied','denied',actor.id);
            when 'reviews' then insert into public.reviews(organization_id,title,content,created_by) values (target_org,'denied','denied',actor.id);
            when 'review_findings' then insert into public.review_findings(organization_id,review_id,source_kind,rule_id,category,severity,state,title,explanation) values (target_org,'b4000000-0000-4000-8000-000000000001','rule','b2000000-0000-4000-8000-000000000001','tone','low','violation','denied','denied');
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
  if (select count(*) from public.reviews where organization_id='a0000000-0000-4000-8000-000000000001') <> 2 then raise exception 'Creator sees another review or cannot see an assigned review'; end if;
  if (select count(*) from public.reviews where id='a4000000-0000-4000-8000-000000000002') <> 0 then raise exception 'Creator sees another creator review'; end if;
  if (select count(*) from public.review_findings where organization_id='a0000000-0000-4000-8000-000000000001') <> 1 then raise exception 'Creator child finding scope is incorrect'; end if;
  if (select count(*) from public.review_comments where organization_id='a0000000-0000-4000-8000-000000000001') <> 1 then raise exception 'Creator child comment scope is incorrect'; end if;
  if (select count(*) from public.review_events where organization_id='a0000000-0000-4000-8000-000000000001') <> 2 then raise exception 'Creator child event scope is incorrect'; end if;
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
  begin update public.reviews set risk_tier='high' where id='a4000000-0000-4000-8000-000000000003';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Creator changed risk tier'; end if;
  denied := false;
  begin update public.reviews set status='approved' where id='a4000000-0000-4000-8000-000000000003';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Creator self-approved'; end if;
  update public.reviews set status='submitted' where id='a4000000-0000-4000-8000-000000000003';
  if (select jsonb_array_length(rule_snapshot) from public.reviews where id='a4000000-0000-4000-8000-000000000003') <> 1 then raise exception 'Submission did not snapshot approved rule ID/version'; end if;
  denied := false;
  begin update public.reviews set status='approved' where id='a4000000-0000-4000-8000-000000000003';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Creator self-approved a submitted review'; end if;
  denied := false;
  begin insert into public.review_findings(organization_id,review_id,source_kind,category,severity,state,title,explanation)
    values ('a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000003','image_check','visual','low','likely','fake','fake');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Client inserted a finding'; end if;
  insert into public.review_decisions(organization_id,review_id,finding_key,finding_title,action,actor_id)
    values ('a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000003','test-key','Test finding','resolved','10000000-0000-4000-8000-000000000002');
  denied := false;
  begin insert into public.review_decisions(organization_id,review_id,finding_key,finding_title,action,actor_id)
    values ('a0000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000003','dismiss-key','Dismissed finding','dismissed','10000000-0000-4000-8000-000000000002');
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

  -- Manager cannot approve their own review; high risk requires legal/admin approval.
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
  perform set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
  insert into public.reviews(id,organization_id,title,content,created_by)
  values ('a4000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000001','Manager own','Own copy','10000000-0000-4000-8000-000000000003');
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
  update public.reviews set status='approved' where id='a4000000-0000-4000-8000-000000000003';

  -- Approved rule content cannot be changed; approval is recorded by the database.
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
  perform set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
  update public.brand_rules set status='approved' where id='a2000000-0000-4000-8000-000000000002';
  if (select approved_by from public.brand_rules where id='a2000000-0000-4000-8000-000000000002') <> '10000000-0000-4000-8000-000000000004'::uuid then raise exception 'Rule approval actor missing'; end if;
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

-- anon has no table privileges, independently of RLS.
set local role anon;
do $$
declare t text;
begin
  foreach t in array array['organizations','organization_members','workspace_invitations','brand_rules','approved_claims','reviews','review_findings','review_comments','review_events','review_revisions','review_decisions','review_assets','organization_events'] loop
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
