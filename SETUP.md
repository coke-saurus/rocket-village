# Team Rocket UnderWorld 사이트 설정 가이드

사이트 주소: https://team-rocket-underworld.vercel.app · 제작자 콜라 사우루스

순서대로 따라 하면 됩니다. 1~5단계를 마치면 사이트가 동작하고, 6단계(Microsoft 연동)는 Mojang 승인이 난 뒤에 해도 됩니다.

## 파일 구성

```
index.html           사이트 화면 (CONFIG만 채우면 됨)
assets/              로고, 파비콘, 골드 아이콘, 포켓몬 목록(pokemon.json), 배경 도시 그림(bg/)
api/_lib.js          서버 함수 공용 코드
api/notify.js        디스코드 알림 (DM, 채널)
api/ms-start.js      Microsoft 로그인 시작
api/ms-callback.js   Microsoft → 마인크래프트 닉네임 확인
api/keepalive.js     Supabase 잠김 방지 (매일 자동 실행)
api/admin-member.js  관리자: 회원 삭제 · 차단 해제
api/discord-member.js 회원의 뒷세계 디스코드 참가 여부 확인
vercel.json          매일 keepalive 실행 예약
package.json         서버 함수 설정 (이미 있으면 "type": "module"만 추가)
.vercelignore        아래 두 파일은 사이트에 공개하지 않음
supabase/schema.sql  DB 테이블과 권한 규칙
```

GitHub 저장소 최상위에 그대로 올리면 됩니다. Vercel 프로젝트 설정의 Framework Preset은 **Other**, Build Command는 비워 두세요.

---

## 업데이트 기록 (이미 설치한 사이트라면 이것만 실행)

| 파일 | 내용 | 실행 |
|---|---|---|
| `supabase/migrations/002_pokemon_deadlines.sql` | 포켓몬 상세 정보, 자동 마감 시각(PVP·경매는 비워 두면 7일), 의뢰 7일 마감·1인 1의뢰 | Supabase → SQL Editor에 전체 붙여넣고 Run (여러 번 실행해도 안전) |
| `supabase/migrations/003_admin_only_events.sql` | PVP 대회 · 경매 글은 관리자만 작성, 회원 삭제(글은 '탈퇴한 회원'으로 유지) · 차단 | 위와 같음 |

처음 설치하는 경우에는 아래 1단계의 `schema.sql`에 위 내용이 이미 들어 있으니 따로 실행하지 않아도 됩니다.

## 1. Supabase: 테이블 만들기

1. `supabase/schema.sql` 맨 위의 고정 관리자 닉네임이 `debug_stick`인지 확인합니다.
2. Supabase 대시보드 → **SQL Editor** → 전체 붙여넣기 → **Run**.
3. **Project Settings → API Keys**에서 두 개를 복사해 둡니다.
   - `anon` (또는 `publishable`) 키 → `index.html`에 넣을 것
   - `service_role` (또는 `secret`) 키 → Vercel 환경변수에만 넣을 것. **절대 HTML이나 GitHub에 올리지 마세요.**

## 2. 디스코드: 앱, 봇, 웹후크

[Discord Developer Portal](https://discord.com/developers/applications)에서 **New Application**을 만듭니다. 이 앱 하나로 로그인과 봇을 모두 처리합니다.

**로그인(OAuth2)**
1. **OAuth2** 탭에서 Client ID를 복사하고, Client Secret을 Reset으로 발급받아 복사합니다.
2. **Redirects**에 `https://<프로젝트ID>.supabase.co/auth/v1/callback`을 추가합니다.
3. Supabase → **Authentication → Sign In / Providers → Discord**를 켜고 Client ID와 Secret을 붙여넣습니다.
4. Supabase → **Authentication → URL Configuration**에서
   - Site URL: `https://team-rocket-underworld.vercel.app`
   - Redirect URLs: `https://team-rocket-underworld.vercel.app/**`

**봇 (DM 알림용)**
1. **Bot** 탭에서 Reset Token으로 봇 토큰을 발급받아 복사합니다 (`DISCORD_BOT_TOKEN`).
2. **OAuth2 → URL Generator**에서 scope `bot`만 체크하고(권한은 체크하지 않아도 됨), 생성된 링크로 봇을 마을 디스코드 서버에 초대합니다.
3. DM은 **봇과 같은 서버에 있는 사람**에게만 갈 수 있습니다. 서버 설정에서 "서버 멤버가 보내는 다이렉트 메시지 허용"이 꺼져 있으면 DM이 막힙니다.

**알림 채널 (새 글, 인증 요청 소식)**
- 알림 받을 채널의 **채널 편집 → 연동 → 웹후크 → 새 웹후크**에서 URL을 복사합니다 (`DISCORD_WEBHOOK_URL`).

## 3. index.html 설정 (이미 채워져 있음)

`index.html`의 `CONFIG`에 프로젝트 URL과 publishable 키가 이미 들어가 있습니다. 이 두 값은 원래 공개되는 값이라 GitHub에 올려도 괜찮고, 실제 보안은 schema.sql의 권한 규칙이 담당합니다.

첫 화면의 데모 버튼은 없앴지만, 개발·확인용 데모는 주소 뒤에 `?demo`를 붙이면 열립니다 (`https://team-rocket-underworld.vercel.app/?demo`). 가짜 데이터라 실제 DB에는 아무 영향이 없습니다.

## 4. Vercel 환경변수

Vercel 프로젝트 → **Settings → Environment Variables**:

| 이름 | 값 |
|---|---|
| `SUPABASE_URL` | `https://<프로젝트ID>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role(secret) 키 |
| `DISCORD_BOT_TOKEN` | 봇 토큰 |
| `DISCORD_WEBHOOK_URL` | 웹후크 URL |
| `SITE_URL` | `https://team-rocket-underworld.vercel.app` (끝에 / 없이) |
| `DISCORD_GUILD_ID` | (선택) 뒷세계 디스코드 서버 ID. 넣으면 서버에 없는 회원에게만 참가 안내가 보이고, 내 정보에 참가 여부가 표시됨. 없으면 모두에게 안내(닫기 가능) |
| `AUTH_STATE_SECRET` | 아무 긴 무작위 문자열 (예: 비밀번호 생성기로 40자) |
| `CRON_SECRET` | (선택) 아무 무작위 문자열. 넣으면 keepalive를 Vercel 크론만 호출할 수 있음 |

저장한 뒤 **Deployments → 최신 배포 → Redeploy**를 해야 반영됩니다.

## 5. 고정 관리자 등록 (처음 한 번)

1. 사이트에서 디스코드로 로그인합니다.
2. **내 정보**에서 본인 마인크래프트 닉네임을 저장합니다.
3. Supabase **SQL Editor**에서 아래를 실행합니다 (닉네임 부분 수정).
   ```sql
   -- 먼저 확인: 내 행이 맞는지 디스코드 이름을 보세요
   select id, discord_name, mc_name, mc_verified from profiles where lower(mc_name) = lower('내닉네임');

   -- 맞으면 인증
   update profiles set mc_verified = true, mc_verified_via = 'admin'
   where lower(mc_name) = lower('내닉네임') and discord_name = '내디스코드이름';
   ```
4. 사이트를 새로고침하면 **관리자** 탭이 보입니다.
5. 관리자 탭 맨 아래 **디스코드 봇 연결 테스트**를 꼭 한 번 누르세요. 디스코드는 봇이 처음 한 번 접속해야 메시지를 보낼 수 있는데, 이 버튼이 그 작업을 해 줍니다. 내 DM으로 테스트 메시지가 오면 성공입니다.

이후로는 관리자 탭에서 회원 닉네임을 **인증**하고, 권한을 **로켓단** 또는 **관리자**로 바꿔 주면 됩니다.

- 관리자 권한을 주거나 빼는 건 고정 관리자만 할 수 있습니다.
- 다른 관리자는 고정 관리자의 인증을 해제할 수 없습니다.
- 고정 관리자를 바꾸거나 추가하려면 Supabase의 `fixed_admins` 테이블을 수정하세요.

## 6. Microsoft로 닉네임 자동 인증 (완료 · 2026-11 Mojang 승인)

1. [Azure Portal](https://portal.azure.com) → **App registrations → New registration**
   - 이름: 아무거나. 단, Minecraft, Mojang, Microsoft 같은 단어는 빼야 합니다.
   - 지원 계정 유형: **Personal Microsoft accounts only**
   - Redirect URI: 플랫폼 **Web**, `https://team-rocket-underworld.vercel.app/api/ms-callback`
2. **Certificates & secrets → New client secret**으로 비밀값을 만들어 복사합니다.
3. [aka.ms/mce-reviewappid](https://aka.ms/mce-reviewappid)에 Application (client) ID와 Directory (tenant) ID를 제출해 Mojang 승인을 신청합니다.
   - 고정 관리자는 등록된 닉네임(`debug_stick`)과 같은 마인크래프트 계정으로만 연동됩니다. 다른 계정으로 로그인하면 거부되어 관리자 권한이 유지됩니다.
4. Vercel 환경변수에 `MS_CLIENT_ID`, `MS_CLIENT_SECRET`을 추가하고 Redeploy합니다.

회원은 로그인 후 안내 화면이나 **내 정보**에서 **Microsoft로 연동하기**를 누르기만 하면 됩니다. 실제 자바 닉네임이 등록되고 바로 인증됩니다. 같은 닉네임을 다른 계정이 관리자 인증으로 갖고 있었다면, 진짜 주인에게 넘어갑니다.

---

## 알림이 가는 경우

| 상황 | 알림 |
|---|---|
| 의뢰·대회·경매·공지 새 글 | 알림 채널 (웹후크) |
| 의뢰 수락 / 대회 참가 / 경매 참여 신청 | 글쓴이에게 DM |
| 로켓단 거래 예약 | **두 사람 모두에게 DM** (포켓몬, 주는 사람, 받는 사람, 전할 말) |
| 닉네임 저장 (인증 요청) | 알림 채널 |

DM을 못 받은 사람이 있으면 사이트에 경고가 뜹니다. 대부분 서버 미가입이나 DM 차단 때문입니다.

## 문제 해결

- **"프로필이 없어요"**: schema.sql을 실행하기 전에 가입한 계정입니다. Supabase → Authentication → Users에서 그 사용자를 지우고 다시 로그인하세요.
- **로그인 후 첫 화면으로 돌아옴**: Supabase URL Configuration의 Redirect URLs를 확인하세요.
- **알림이 안 옴**: Vercel → 프로젝트 → **Logs**에서 `/api/notify` 오류를 확인하세요. 환경변수를 바꾼 뒤 Redeploy를 했는지도 확인하세요.

## 정기 관리

- **Azure 클라이언트 암호**는 최대 24개월 뒤 만료됩니다. 만료 전에 Azure → 앱 등록 → 인증서 및 비밀에서 새 암호를 만들고 Vercel의 `MS_CLIENT_SECRET`을 바꾼 뒤 Redeploy하세요. 만료되면 Microsoft 연동이 멈춥니다.
