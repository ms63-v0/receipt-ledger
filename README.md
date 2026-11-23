# 영수증 가계부

**배포 주소:** https://ms63-v0.github.io/receipt-ledger/  
`main` 브랜치에 push하면 GitHub Actions가 자동으로 다시 배포합니다.

영수증 사진을 올리면 Gemini가 가게명, 날짜, 품목, 금액을 읽어 가계부에 채워 주는 웹앱입니다.

- **프론트**: Vite + React + TypeScript (디자인: 프로젝트 `DESIGN.md` 토큰 적용)
- **백엔드**: Supabase (Auth, Postgres + RLS, Storage, Edge Function)
- **영수증 인식**: Gemini API, Structured Output(JSON 스키마)으로 바로 구조화된 결과를 받음

## 기능

- 이메일/비밀번호 로그인, 본인 데이터만 보임 (RLS)
- 월간 달력 뷰: 날짜별 수입(+)·지출(−) 합계, 모바일에서는 점으로 표시
- 이번 달 요약: 지출, 수입, 남은 돈, 기록 건수
- 날짜별 내역 목록, 카테고리별 지출 막대
- 영수증 언어 선택(한국어·English·日本語·中文), 외화는 오늘 환율(Frankfurter/ECB)로 원화 환산
- Gemini 혼잡(503/429) 시 재시도 후 상위 모델로 자동 전환, thinking low·이미지 해상도 medium으로 토큰 절약
- 영수증 스캔: 촬영 또는 앨범 선택 → 브라우저에서 압축(긴 변 1600px JPEG) → Gemini 인식 → **확인·수정 화면** → 저장
- 품목 편집, 품목 합계와 총액이 다르면 알림
- 영수증 사진은 비공개 버킷에 저장, 서명 URL(10분)로만 열람
- **데모 모드**: `.env`가 비어 있으면 브라우저 저장소 + 예시 인식 결과로 바로 실행

## 폴더 구조

```
src/
  lib/api.ts              Supabase / 데모 백엔드 (같은 인터페이스)
  lib/image.ts            업로드 전 이미지 압축
  lib/types.ts            타입, 카테고리 목록
  components/             Ledger(메인), Calendar, DayPanel, TransactionForm, ReceiptScanner …
  styles.css              DESIGN.md 토큰 → CSS 변수
supabase/
  migrations/…_init.sql   테이블, RLS, 스토리지 버킷·정책
  functions/parse-receipt Gemini 호출 Edge Function
```

## 1분 만에 화면 보기 (데모 모드)

```bash
npm install
npm run dev
```

## 실제로 연결하기

### 1. Supabase 프로젝트

1. [supabase.com](https://supabase.com)에서 새 프로젝트를 만듭니다. (리전: Seoul 추천)
2. **SQL Editor**에 `supabase/migrations/` 의 SQL 파일들을 순서대로 붙여 넣고 실행합니다.
   (CLI를 쓴다면 `supabase link --project-ref <ref>` 후 `supabase db push`)
3. **Authentication → Providers → Email**이 켜져 있는지 확인합니다.
   혼자 쓰는 앱이라면 *Confirm email*을 꺼 두면 가입 즉시 로그인됩니다.

### 2. Gemini 키와 Edge Function

1. [Google AI Studio](https://aistudio.google.com/apikey)에서 API 키를 발급합니다.
2. Supabase CLI로 함수를 배포하고 시크릿을 설정합니다.

```bash
npm i -g supabase            # 또는 brew install supabase/tap/supabase
supabase login
supabase link --project-ref <프로젝트 ref>
supabase functions deploy parse-receipt
supabase secrets set GEMINI_API_KEY=발급받은_키
# (선택) 모델 변경: GEMINI_MODEL (기본 gemini-3.5-flash-lite), GEMINI_FALLBACK_MODEL (기본 gemini-3.8-flash)
```

> ⚠️ Gemini 키는 **절대 `.env`(프론트)에 넣지 마세요.** 브라우저에 그대로 노출됩니다.
> 함수는 로그인한 사용자 요청만 처리하도록 되어 있습니다.

### 3. 프론트 환경변수

`.env.example`을 `.env`로 복사하고 **Project Settings → API**의 값을 채웁니다.

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

`npm run dev`로 실행하면 로그인 화면이 나옵니다.

### 4. 배포

**Vercel (추천)**: GitHub에 push → Vercel에서 저장소 Import → 환경변수 2개 입력 → Deploy.

**GitHub Pages**: 정적 호스팅이라 그대로 동작합니다. (인식은 Edge Function이 처리)
`VITE_BASE=/저장소이름/ npm run build` 후 `dist/`를 Pages에 올리면 됩니다.

## 비용·한도 메모

- Supabase 무료 플랜: DB 500MB, 파일 1GB, 대역폭 5GB. 1주일 동안 활동이 없으면 프로젝트가 일시정지됩니다.
- 사진은 업로드 전에 압축되어 보통 150~400KB → 1GB에 수천 장.
- Gemini 비용은 사용량에 따라 다르니 AI Studio의 요금 페이지를 확인하세요.

## 다음에 해볼 만한 것

- 반복 수입/지출(월급, 구독료) 자동 등록
- 월 예산 설정과 초과 알림
- PWA(홈 화면 추가, 오프라인 캐시)
- 가족·커플 공유 가계부 (household 테이블 + 멤버십 기반 RLS)
- CSV 내보내기
