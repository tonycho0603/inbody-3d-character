/**
 * web-api.js - Fake Door 백엔드 통신 (Google Apps Script 연동)
 *
 * 통신 방식: axios.get + 쿼리스트링 (수업 코드 동일 방식)
 *
 * 참고:
 *   - 콘솔에 CORS 에러가 빨간색으로 뜰 수 있지만 정상이다.
 *   - GET 요청은 CORS로 막혀도 서버까지는 도달해서 처리되므로
 *     시트에는 데이터가 정상적으로 저장됨. 응답만 못 읽을 뿐.
 *   - 만약 진짜로 데이터가 안 들어가면 그땐 Render.com 프록시 서버 필요.
 *
 * 두 가지 이벤트:
 *   - submitGeneration → "generations" 시트 탭 (캐릭터 생성)
 *   - submitFeedback   → "feedback"    시트 탭 (의견 제출)
 *
 * 시트 헤더 매칭:
 *   payload의 키가 시트 1행의 헤더와 일치해야 해당 컬럼에 값이 들어감.
 *   (Apps Script의 prepareRow가 헤더 순서대로 값을 정렬해서 appendRow)
 */

// 배포된 Apps Script Web App URL (/exec 로 끝남)
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz44SiJvhOq1EnMNZB6lOCZAXk3vCIThcg1ZF84TTQZ1XWu2mV9XhKAMB8ZDUQaXWUh/exec";


/**
 * 캐릭터 생성 이벤트 기록 → "generations" 시트에 1행 추가
 *
 * @param {Object} data - 인바디 수치 + 메타데이터
 * @returns {Promise<{ok: boolean}>}
 */
export async function submitGeneration(data) {
  const payload = {
    id: data.session_id,                    // 시트 id 컬럼 (session_id 재사용)
    timestamp: new Date().toISOString(),    // ISO 형식 (UTC)
    ...data,
  };
  console.log("[submitGeneration]", payload);
  return sendToSheet("generations", payload);
}


/**
 * 의견/이메일 제출 이벤트 기록 → "feedback" 시트에 1행 추가
 *
 * @param {Object} data - { session_id, email, feedback_text }
 * @returns {Promise<{ok: boolean}>}
 */
export async function submitFeedback(data) {
  const payload = {
    id: data.session_id,
    timestamp: new Date().toISOString(),
    ...data,
  };
  console.log("[submitFeedback]", payload);
  return sendToSheet("feedback", payload);
}


/**
 * Apps Script에 axios.get으로 insert 호출 (수업 방식)
 *
 * 쿼리스트링 형식: ?action=insert&table=<시트탭이름>&data=<JSON 문자열>
 *
 * @param {string} table - 시트 탭 이름 (generations | feedback)
 * @param {Object} data  - 헤더와 매칭되는 키를 가진 객체
 */
async function sendToSheet(table, data) {
  const url = `${APPS_SCRIPT_URL}?action=insert&table=${table}&data=${encodeURIComponent(JSON.stringify(data))}`;

  try {
    const response = await axios.get(url);
    console.log(`[api] ${table} 응답:`, response.data);
    return { ok: true };
  } catch (err) {
    // CORS 에러도 여기로 옴. 단, 그래도 서버엔 도달해서 시트는 저장될 수 있음.
    console.warn(`[api] ${table} 요청 결과 못 읽음 (CORS일 수 있음):`, err.message);
    return { ok: false };
  }
}
