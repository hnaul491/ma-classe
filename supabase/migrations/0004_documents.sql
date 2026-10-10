-- Group the pages of one uploaded PDF into a single document.
alter table public.files add column if not exists document_id uuid;
alter table public.files add column if not exists page_index int not null default 0;
create index if not exists files_document on public.files (document_id);
