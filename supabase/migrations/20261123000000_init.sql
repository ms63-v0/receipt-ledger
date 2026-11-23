-- =====================================================================
-- 영수증 가계부 초기 스키마
--  - transactions       : 수입/지출 1건 (영수증 1장 = 거래 1건)
--  - transaction_items  : 영수증 품목 상세 (선택)
--  - storage 'receipts' : 영수증 사진 (비공개, 본인 폴더만 접근)
-- =====================================================================

create table if not exists public.transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type          text not null check (type in ('income', 'expense')),
  amount        bigint not null check (amount >= 0),          -- 원 단위 정수
  occurred_on   date not null,
  category      text not null default '기타',
  merchant      text,
  memo          text,
  payment_method text,
  receipt_path  text,                                         -- storage 경로: {user_id}/{uuid}.jpg
  source        text not null default 'manual' check (source in ('manual', 'receipt')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists transactions_user_date_idx
  on public.transactions (user_id, occurred_on);

create table if not exists public.transaction_items (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references public.transactions(id) on delete cascade,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name            text not null,
  quantity        numeric not null default 1,
  unit_price      bigint,
  amount          bigint not null default 0,
  position        int not null default 0
);

create index if not exists transaction_items_tx_idx
  on public.transaction_items (transaction_id);

-- updated_at 자동 갱신
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists transactions_touch on public.transactions;
create trigger transactions_touch
  before update on public.transactions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- RLS: 본인 데이터만
-- ---------------------------------------------------------------------
alter table public.transactions enable row level security;
alter table public.transaction_items enable row level security;

drop policy if exists "own transactions" on public.transactions;
create policy "own transactions" on public.transactions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "own items" on public.transaction_items;
create policy "own items" on public.transaction_items
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_id and t.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- Storage: 영수증 버킷 (비공개, 10MB, 이미지만)
-- 경로 규칙: {auth.uid()}/{파일명}
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "receipts read own" on storage.objects;
create policy "receipts read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "receipts insert own" on storage.objects;
create policy "receipts insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "receipts update own" on storage.objects;
create policy "receipts update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "receipts delete own" on storage.objects;
create policy "receipts delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
