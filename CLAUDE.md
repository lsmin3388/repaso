# Repaso — 스페인어 레슨 앱 (AI 작업 가이드)

빌드 도구 없는 정적 웹앱. GitHub Pages로 배포되고, `index.html`을 로컬에서 바로 열어도 동작한다.
**콘텐츠(문장·단어)는 사용자가 아니라 AI가 `data/sets/*.json`을 직접 편집해서 추가한다.** 앱에는 편집 UI가 없다.

## 파일 구조
```
index.html              껍데기 (폰트, css, bundle.js, app.js 로드)
assets/app.css          디자인 (Duolingo 풍, 라이트/다크)
assets/app.js           앱 로직 전부 (vanilla JS)
data/sets/<id>.json     문제 세트 원본 ← 콘텐츠는 여기만 고친다
data/bundle.js          자동 생성. 직접 고치지 말 것
scripts/build.js        세트 검사 + bundle.js 생성
.github/workflows/pages.yml  main 푸시 → 검사 → GitHub Pages 배포
```

## 새 세트 추가 / 기존 세트 수정 절차
1. `data/sets/<id>.json` 작성 (id = 파일 이름, 소문자·숫자·하이픈. 예: `por-para.json`)
2. `node scripts/build.js --coverage` → 오류(✖) 0개가 될 때까지 고친다. 경고(⚠︎)도 가능하면 해결
3. `ℹ︎ words 에 없는 문장 속 단어` 목록을 보고, 학습자가 모를 만한 단어는 `words`에 추가 (고유명사·복수형·활용형은 생략 가능)
4. 커밋 후 `git push` → Actions가 다시 검사하고 Pages에 배포 (1~2분)

## 세트 JSON 스키마
```jsonc
{
  "title": "por vs para",                 // 필수. 코스 카드 제목
  "description": "둘 다 '~위해/~로'?",       // 카드 부제
  "level": "A2",                          // 선택. 배지
  "icon": "🎯",                           // 이모지 1개
  "color": "blue",                        // green|blue|purple|orange|red|teal|pink|gold — 세트마다 다르게
  "order": 20,                            // 코스 목록 정렬 (작을수록 위). 10 단위로
  "confusables": [["por", "para"]],       // 헷갈리는 형태 묶음 (아래 설명)
  "rules": [                              // 문법 포인트 = 학습 경로의 레슨 노드 하나
    { "id": "por-1", "name": "por ① 원인·이유", "tip": "오답 화면과 레슨 시작 전에 보여줄 1~3문장 한국어 해설" }
  ],
  "sentences": [
    { "id": "s1", "es": "Gracias por la ayuda.", "ko": "도와줘서 고마워.", "rule": "por-1",
      "alt": ["Gracias por tu ayuda."] }   // alt: 선택. 문장 조립에서 함께 정답 처리할 다른 표현
  ],
  "words": [
    { "id": "w1", "es": "ayuda", "ko": "도움" },
    { "id": "w2", "es": "listo / lista", "ko": "준비된" }   // 성별·변형은 " / " 로 구분
  ]
}
```

### confusables가 하는 일 (세트의 핵심 문법을 여기에 넣는다)
- **알맞은 말 고르기**: 문장에서 confusable 단어를 빈칸으로 만들고, 같은 묶음 + 다른 묶음 단어를 보기로 낸다
- **문장 조립**: 같은 묶음의 다른 형태를 함정 타일로 섞는다
- **빈칸 쓰기**: confusable 단어를 우선 빈칸으로 만든다
- 묶음 안 단어는 한 단어(공백 없음), 소문자로. 활용형이라면 인칭별로 묶는다 (`["soy","estoy"]`, `["es","está"]`)
- 문장의 절반 이상에 confusable 단어가 들어가야 문제 품질이 좋다 (build.js가 경고)

## 콘텐츠 작성 규칙
- **id는 절대 바꾸거나 재사용하지 않는다** — 학습 기록 키(`s:<id>`, `w:<id>`)라서 바꾸면 기록이 끊긴다. 삭제한 id도 재사용 금지. 새 항목은 마지막 번호 다음부터 (`s51`, `w87` …)
- 세트 안에서 sentences·words id는 서로 겹치면 안 된다 (`s*` / `w*` 접두어 권장)
- `es`는 문장부호까지 정확히 (`¿ ? ¡ !`, 악센트 á é í ó ú ñ ü). 채점이 악센트까지 엄격하다
- 문장 안에 `/` 금지 (다른 정답은 `alt` 배열로)
- `ko`는 자연스러운 한국어. 성별·존댓말 구분이 필요하면 괄호로 (`그녀는 스페인 여자입니다.`)
- rule 하나당 문장 4~12개가 적당. 한 rule에 너무 많으면 rule을 쪼갠다
- 문장은 3~10단어. 1단어 문장은 조립 문제가 의미 없다
- 각 rule의 `tip`은 반드시 쓴다 — "왜 이 형태인가"를 대비 예문과 함께 짧게
- 세트의 words에는 그 세트 문장에 나오는 핵심 어휘를 넣는다 (rule 레슨에 자동으로 섞여 나옴)
- 큰 주제는 세트를 나눈다 (예: `present-ar`, `present-er-ir`). 한 세트 문장 60개 이하 권장

## 앱 동작 요약 (assets/app.js)
- 라우팅: `#/` 코스 목록 → `#/s/<set>` 학습 경로 → `#/s/<set>/<node>` 레슨
- 경로 노드 자동 생성: 유닛1 문장 연습(rule마다 1노드) → 유닛2 단어(15개씩) → 유닛3 복습(전체 / 틀린 문제)
- 레슨: 기본 10문제, rule 노드는 문장 약 70% + 그 문장에 나온 단어. 틀린 문제는 레슨 끝에 한 번 더
- 문제 유형: wordChoice, wordType, choose, build, blank (설정에서 켜고 끔)
- 출제 가중치: 처음 보는 것↑, 틀린 것↑, 2연속 맞힌 것(익힘)↓ — `weight()`
- 기록은 localStorage만: `repaso.v2.progress` (items/days/xp), `repaso.v2.opts`
- 발음: 브라우저 speechSynthesis (es-ES). 효과음: WebAudio

## 로컬 확인
`python3 -m http.server -d . 8765` 후 http://localhost:8765 (또는 index.html 더블클릭)
