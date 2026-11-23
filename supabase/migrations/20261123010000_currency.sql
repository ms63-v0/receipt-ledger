-- 외화 영수증 지원: 원래 통화·금액·적용 환율 (amount 는 항상 원화)
alter table public.transactions
  add column if not exists currency text not null default 'KRW',
  add column if not exists original_amount numeric,
  add column if not exists exchange_rate numeric;

select 'ok' as result;
