/**
 * web-main.js - Fake Door 페이지 메인 컨트롤러
 *
 * 5섹션 흐름 관리:
 *   Hero → Form → Result(캐릭터+춤) → Feedback → Thanks
 *
 * 담당:
 *   - 섹션 전환
 *   - 인바디 폼 검증 + 제출 (api 스텁 호출)
 *   - 캐릭터 생성/춤 트리거
 *   - 의견 폼 제출
 *   - session_id 관리 (localStorage)
 *   - 공유 / 다시 만들기
 */
import { recordVisit, markCharacter, markCommunity, markFinal, submitFeedback } from './web-api.js';
import { generateCharacter, playDance, playIdle, resetCharacter } from './web-character.js';
import { initComingSoonDance } from './web-coming-soon.js';
import { initFriendsSpace } from './web-space.js';

// ============== 세션 ID ==============
const SESSION_KEY = 'fakedoor_session_id';
let sessionId = localStorage.getItem(SESSION_KEY);
if (!sessionId) {
  sessionId = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, sessionId);
}

// 방문 기록 (세션 행 생성) — 페이지 들어온 순간 1회
recordVisit(sessionId);

// 캐릭터 생성에 사용된 닉네임 (Result 화면 인사말용)
let savedNickname = '';

// 성별 선택 화면에서 결정된 성별 ('male' | 'female' | '')
let selectedGender = '';

// ============== 섹션 전환 ==============
/**
 * 지정된 섹션으로 전환 (한 번에 한 섹션만 표시)
 * @param {string} id - 섹션 DOM id
 */
function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  // 화면 맨 위로 스크롤
  window.scrollTo({ top: 0, behavior: 'smooth' });
}


// ============== Hero 시작 버튼 ==============
// Hero → 성별 선택 화면
document.getElementById('btn-start').addEventListener('click', () => {
  showSection('gender-select');
});


// ============== 성별 선택 버튼 ==============
// 남자/여자 버튼 클릭 → 성별 저장 후 인바디 폼으로
document.querySelectorAll('.gender-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedGender = btn.dataset.gender;
    showSection('form');
  });
});


// ============== 부위별 근육량 토글 ==============
// 체크박스 켜면 부위별 입력칸 활성화, 끄면 흐리게 + disable.
// disable된 input은 form 데이터 수집 시 빠지므로 별도 분기 불필요.
const useDetailMuscle = document.getElementById('useDetailMuscle');
const detailMuscleSection = document.getElementById('detail-muscle');
const detailMuscleInputs = detailMuscleSection.querySelectorAll('input');

useDetailMuscle.addEventListener('change', () => {
  const enabled = useDetailMuscle.checked;
  detailMuscleSection.classList.toggle('disabled', !enabled);
  detailMuscleInputs.forEach(input => {
    input.disabled = !enabled;
  });
});


// ============== 인바디 폼 제출 ==============
const inbodyForm = document.getElementById('inbody-form');
inbodyForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  // 폼 데이터 수집
  const data = collectInbodyData();

  // 유효성 검증
  const error = validateInbody(data);
  if (error) {
    alert(error);
    return;
  }

  // 캐릭터 생성 단계 기록 (실제 "캐릭터 생성"을 누른 사람 기준)
  markCharacter(sessionId);

  // 닉네임 저장 (Result 화면 인사말에 사용)
  savedNickname = data.nickname || '';

  // Section 3로 전환 후 "생성중" 상태 표시
  showSection('result');
  setGeneratingState();

  // 섹션 표시 다음 프레임에 캐릭터 생성 시작 (컨테이너 크기 확정 후)
  await new Promise(r => requestAnimationFrame(r));
  await generateCharacter('character-stage', data);

  // 보간 완료 → 완료 상태로 전환
  setCompletedState();
});

/**
 * 결과 화면을 "생성중" 상태로 설정
 * - 타이틀과 인사말을 생성중 메시지로 변경
 * - 버튼들 숨김
 */
function setGeneratingState() {
  document.getElementById('result-title').innerHTML = '캐릭터 생성중<span class="dots">...</span>';
  document.getElementById('result-greeting').textContent = '잠시만 기다려주세요.';
  document.getElementById('result-actions').style.display = 'none';
}

/**
 * 결과 화면을 "생성 완료" 상태로 설정
 * - 타이틀과 인사말 변경
 * - 버튼들 다시 표시
 */
function setCompletedState() {
  document.getElementById('result-title').textContent = '당신의 전용 캐릭터가 완성됐어요!';
  document.getElementById('result-greeting').textContent =
    savedNickname ? `${savedNickname}님, 반가워요!` : '반가워요!';
  document.getElementById('result-actions').style.display = '';
}

/**
 * 인바디 폼 데이터 수집
 *
 * 부위별 입력칸이 disabled면 NaN이 나오는데, 캐릭터 매핑 쪽에서 빈 값 처리되므로
 * 그대로 넘김. useDetail 플래그로 검증/매핑 분기.
 */
function collectInbodyData() {
  const useDetail = document.getElementById('useDetailMuscle').checked;
  return {
    weight:    parseFloat(document.getElementById('weight').value),
    bodyFat:   parseFloat(document.getElementById('bodyFat').value),
    muscle:    parseFloat(document.getElementById('muscle').value),
    armR:      parseFloat(document.getElementById('armR').value),
    armL:      parseFloat(document.getElementById('armL').value),
    trunk:     parseFloat(document.getElementById('trunk').value),
    legR:      parseFloat(document.getElementById('legR').value),
    legL:      parseFloat(document.getElementById('legL').value),
    gender:    selectedGender,         // 성별 선택 화면에서 결정됨
    nickname:  document.getElementById('nickname').value.trim(),
    useDetail,                         // 부위별 입력 여부 (매핑 분기용)
  };
}

/**
 * 인바디 데이터 유효성 검증
 * 부위별 근육량은 체크박스가 켜진 경우에만 필수.
 * @returns {string|null} 에러 메시지 또는 null
 */
function validateInbody(d) {
  if (!d.weight || d.weight < 20 || d.weight > 300) return '체중이 올바르지 않아요. (20~300kg)';
  if (!d.bodyFat || d.bodyFat < 1 || d.bodyFat > 60) return '체지방률이 올바르지 않아요. (1~60%)';
  if (!d.muscle || d.muscle < 5 || d.muscle > 80) return '골격근량이 올바르지 않아요. (5~80kg)';
  // 체크박스 안 켰으면 부위별은 검증 패스 (전체 골격근량 fallback 사용)
  if (d.useDetail) {
    if (!d.armR || !d.armL) return '팔 근육량을 모두 입력해주세요.';
    if (!d.trunk) return '몸통 근육량을 입력해주세요.';
    if (!d.legR || !d.legL) return '다리 근육량을 모두 입력해주세요.';
  }
  return null;
}

// ============== Result 화면: 춤 / 다음 ==============
document.getElementById('btn-dance').addEventListener('click', () => {
  playDance();
});

// 결과 화면 → 친구들과의 공간
document.getElementById('btn-to-space').addEventListener('click', () => {
  markCommunity(sessionId);            // "친구들과의 공간으로 가기" 클릭 기록
  showSection('space');
  // 섹션이 보인 다음 프레임에 init (display:none이면 컨테이너 0×0).
  // 내 캐릭터 정보(성별 + 본 스케일)를 공간 씬에 전달해서 내 체형으로 입장.
  const boneScales = JSON.parse(localStorage.getItem('customization') || 'null');
  requestAnimationFrame(() => initFriendsSpace('space-stage', { gender: selectedGender, boneScales }));
});

// 친구 공간 → 의견 남기기
document.getElementById('btn-space-to-feedback').addEventListener('click', () => {
  markFinal(sessionId);                // "친구를 초대해서…" 클릭 기록
  showSection('feedback');
  // coming-soon 댄스 씬도 이 시점에 init (컨테이너 크기 확정 후). 중복 가드 있음.
  requestAnimationFrame(() => initComingSoonDance('dance-stage'));
});


// ============== 피드백 폼 제출 ==============
const feedbackForm = document.getElementById('feedback-form');
feedbackForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('email').value.trim();
  const feedbackText = document.getElementById('feedbackText').value.trim();

  if (!feedbackText) {
    alert('의견을 입력해주세요.');
    return;
  }

  // 이메일은 선택이지만 입력했다면 형식 체크
  if (email && !isValidEmail(email)) {
    alert('이메일 형식이 올바르지 않아요.');
    return;
  }

  await submitFeedback(sessionId, email, feedbackText);

  showSection('thanks');
});

/**
 * 이메일 형식 검증
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}


// ============== Thanks 화면: 공유 / 다시 ==============
document.getElementById('btn-share-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    alert('링크가 복사됐어요!');
  } catch {
    alert('복사 실패. 주소창에서 직접 복사해주세요.');
  }
});

document.getElementById('btn-restart').addEventListener('click', () => {
  // 폼 초기화
  inbodyForm.reset();
  feedbackForm.reset();
  // 캐릭터 커스터마이징도 초기화
  localStorage.removeItem('customization');
  // 세션 종료: 캔버스/씬/렌더러 통째로 dispose
  // 다음에 폼 제출하면 새 성별로 처음부터 다시 만들어짐
  resetCharacter();
  // 성별 선택 초기화 (다시 선택해야 함)
  selectedGender = '';
  showSection('hero');
});
