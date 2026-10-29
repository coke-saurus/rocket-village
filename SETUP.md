# 로켓단 사이트 설정 가이드

순서대로 따라 하면 됩니다. 1~5단계를 마치면 사이트가 동작하고, 6단계(Microsoft 연동)는 Mojang 승인이 난 뒤에 해도 됩니다.

## 파일 구성

```
index.html           사이트 화면 (CONFIG만 채우면 됨)
api/_lib.js          서버 함수 공용 코드
api/notify.js        디스코드 알림 (DM, 채널)
api/ms-start.js      Microsoft 로그인 시작
api/ms-callback.js   Microsoft → 마인크래프트 닉네임 확인
api/keepalive.js     Supabase 잠김 방지 (매일 자동 실행)
vercel.json          매일 keepalive 실행 예약
package.json         서버 함수 설정 (이미 있으면 "type": "module"만 추가)
.vercelignore        아래 두 파일은 사이트에 공개하지 않음
supabase/schema.sql  DB 테이블과 권한 규칙
```

GitHub 저장소 최상위에 그대로 올리면 됩니다. Vercel 프로젝트 설정의 Framework Preset은 **Other**, Build Command는 비워 두세요.

---

## 1. Supabase: 테이블 만들기

1. `supabase/schema.sql`을 열고 맨 위의 `'YOUR_MC_NAME'`을 **본인 자바 닉네임**으로 바꿉니다.
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
   - Site URL: `https://<내사이트>.vercel.app`
   - Redirect URLs: `https://<내사이트>.vercel.app/**`

**봇 (DM 알림용)**
1. **Bot** 탭에서 Reset Token으로 봇 토큰을 발급받아 복사합니다 (`DISCORD_BOT_TOKEN`).
2. **OAuth2 → URL Generator**에서 scope `bot`만 체크하고(권한은 체크하지 않아도 됨), 생성된 링크로 봇을 마을 디스코드 서버에 초대합니다.
3. DM은 **봇과 같은 서버에 있는 사람**에게만 갈 수 있습니다. 서버 설정에서 "서버 멤버가 보내는 다이렉트 메시지 허용"이 꺼져 있으면 DM이 막힙니다.

**알림 채널 (새 글, 인증 요청 소식)**
- 알림 받을 채널의 **채널 편집 → 연동 → 웹후크 → 새 웹후크**에서 URL을 복사합니다 (`DISCORD_WEBHOOK_URL`).

## 3. index.html 설정 (이미 채워져 있음)

`index.html`의 `CONFIG`에 프로젝트 URL과 publishable 키가 이미 들어가 있습니다. 이 두 값은 원래 공개되는 값이라 GitHub에 올려도 괜찮고, 실제 보안은 schema.sql의 권한 규칙이 담당합니다.

| 설정 | 의미 |
|---|---|
| `MS_LINK_ENABLED` | Mojang 승인 후 `true`로 바꾸면 "Microsoft로 연동하기" 버튼이 켜짐 |
| `ALLOW_ADMIN_VERIFY` | `true`(기본): 승인 전까지 "닉네임 직접 등록 → 관리자 인증"으로 임시 활동 허용. `false`: Microsoft 연동만 허용 |
| `SHOW_DEMO_LINK` | 첫 화면에 "데모로 둘러보기" 버튼 표시 |

데모는 언제든 `https://<내사이트>.vercel.app/?demo`로 열 수 있습니다.

## 4. Vercel 환경변수

Vercel 프로젝트 → **Settings → Environment Variables**:

| 이름 | 값 |
|---|---|
| `SUPABASE_URL` | `https://<프로젝트ID>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role(secret) 키 |
| `DISCORD_BOT_TOKEN` | 봇 토큰 |
| `DISCORD_WEBHOOK_URL` | 웹후크 URL |
| `SITE_URL` | `https://<내사이트>.vercel.app` (끝에 / 없이) |
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

## 6. (나중에) Microsoft로 닉네임 자동 인증

1. [Azure Portal](https://portal.azure.com) → **App registrations → New registration**
   - 이름: 아무거나. 단, Minecraft, Mojang, Microsoft 같은 단어는 빼야 합니다.
   - 지원 계정 유형: **Personal Microsoft accounts only**
   - Redirect URI: 플랫폼 **Web**, `https://<내사이트>.vercel.app/api/ms-callback`
2. **Certificates & secrets → New client secret**으로 비밀값을 만들어 복사합니다.
3. [aka.ms/mce-reviewappid](https://aka.ms/mce-reviewappid)에 Application (client) ID와 Directory (tenant) ID를 제출해 Mojang 승인을 신청합니다. 승인 전에는 "아직 승인이 나지 않았다"는 안내가 뜹니다.
4. Vercel 환경변수에 `MS_CLIENT_ID`, `MS_CLIENT_SECRET`을 추가하고 Redeploy합니다.
5. 승인이 나면 `index.html`의 `MS_LINK_ENABLED`를 `true`로 바꿉니다.

승인 후에는 회원이 **내 정보 → Microsoft로 닉네임 자동 인증**을 누르기만 하면 됩니다. 실제 자바 닉네임이 등록되고 바로 인증됩니다. 같은 닉네임을 다른 계정이 관리자 인증으로 갖고 있었다면, 진짜 주인에게 넘어갑니다.

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
