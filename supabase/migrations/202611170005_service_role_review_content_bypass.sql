create or replace function private.assay_restrict_reviewer_content_edits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.title is distinct from old.title or new.channel is distinct from old.channel or new.content is distinct from old.content)
    and (select auth.role()) is distinct from 'service_role'
    and (select auth.uid()) is not null
    and (select auth.uid()) is distinct from old.created_by then
    raise exception 'Only the review creator may edit review content' using errcode = '42501';
  end if;
  return new;
end;
$$;
