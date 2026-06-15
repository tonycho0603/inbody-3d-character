/**
 * web-api.js - Fake Door 백엔드 통신 (Google Apps Script 연동)
 *
 * 퍼널을 "세션당 한 행"으로 기록한다. 모두 같은 세션 id로 upsert
 * (행이 있으면 해당 필드만 갱신, 없으면 새 행 생성) → 한 행에 단계가 누적됨.
 *
 *   recordVisit(id)              방문 순간 → id, timestamp 행 생성
 *   markCharacter(id)            "캐릭터 생성"(폼 제출) → character = O
 *   markCommunity(id)            "친구들과의 공간으로 가기" 클릭 → community = O
 *   markFinal(id)                "친구를 초대해서…" 클릭 → final = O
 *   submitFeedback(id, e, f)     의견 제출 → email, feedback 채움
 *
 * 시트(sessions) 헤더: id | timestamp | character | community | final | email | feedback
 *
 * 통신: axios.get + 쿼리스트링 (수업 방식).
 *   - 콘솔에 CORS 에러가 빨간색으로 떠도 정상. GET은 서버까지 도달해
 *     시트에는 저장됨(응답만 못 읽음).
 */

// 배포된 Apps Script Web App URL (/exec 로 끝남)
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz44SiJvhOq1EnMNZB6lOCZAXk3vCIThcg1ZF84TTQZ1XWu2mV9XhKAMB8ZDUQaXWUh/exec";

// 단일 시트 탭 이름
const TABLE = 'sessions';


/**
 * 같은 id 행에 upsert (있으면 들어온 필드만 갱신, 없으면 새 행).
 * @param {Object} data - 반드시 id 포함. 갱신할 필드만 넣으면 됨.
 */
async function upsert(data) {
  const url = `${APPS_SCRIPT_URL}?action=upsert&table=${TABLE}&data=${encodeURIComponent(JSON.stringify(data))}`;
  try {
    const res = await axios.get(url);
    console.log('[api] upsert 응답:', res.data);
    return { ok: true };
  } catch (err) {
    console.warn('[api] upsert 결과 못 읽음 (CORS일 수 있음):', err.message);
    return { ok: false };
  }
}


/** 방문 기록 — 세션 행 생성 (id + timestamp) */
export function recordVisit(id) {
  return upsert({ id, timestamp: new Date().toISOString() });
}

/** "캐릭터 만들어볼래요?" 클릭 → character = O */
export function markCharacter(id) {
  return upsert({ id, character: 'O' });
}

/** "친구들과의 공간으로 가기" 클릭 → community = O */
export function markCommunity(id) {
  return upsert({ id, community: 'O' });
}

/** "친구를 초대해서 친구들과의 공간을 만드세요!" 클릭 → final = O */
export function markFinal(id) {
  return upsert({ id, final: 'O' });
}

/** 의견/이메일 제출 → email, feedback 채움 */
export function submitFeedback(id, email, feedback) {
  return upsert({ id, email, feedback });
}
