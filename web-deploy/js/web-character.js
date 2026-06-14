/**
 * web-character.js - 인바디 → 캐릭터 매핑 + 표시
 *
 * 기존 character.js의 함수들을 재활용해서:
 *   1. 인바디 수치를 본 스케일로 변환 (성별별 평균치 기준)
 *   2. 지정 컨테이너에 캐릭터 렌더링 (성별별 모델)
 *   3. 단계별 스냅 애니메이션 (뚝!뚝!뚝!)
 *   4. 춤 애니메이션 재생
 *
 * 매핑 규칙:
 *   - Spine02     ← (오른팔 + 오른다리 + 몸통) 합 → 비율로 변환
 *   - RightUpLeg  ← 오른다리 근육량 → 비율로 변환
 *   - LeftUpLeg   ← 왼다리 근육량 → 비율로 변환
 *   - neck        ← Spine02 역수 (머리 크기 유지)
 *
 * 성별별 baseline:
 *   - male:   한국 성인 남성 평균 (Spine02 합 35, 한쪽 다리 9)
 *   - female: 한국 성인 여성 평균 (Spine02 합 25, 한쪽 다리 6)
 */
import {
  initCharacter,
  applyCustomization,
  playAnimationByRole,
  getModel,
  resetCharacter,
} from './character.js';

// 외부에서 세션 종료 시 호출할 수 있게 재export
export { resetCharacter };

/**
 * 성별별 본 매핑 설정
 * - baseline: 평균 측정값 (스케일 1.0이 되는 기준)
 * - weight:   변화 폭 가중치
 * - min/max:  스케일 클램핑 범위
 */
const BONE_CONFIG_BY_GENDER = {
  male: {
    Spine02:    { baseline: 35, weight: 0.75, min: 0.75, max: 1.3  },
    RightUpLeg: { baseline: 9,  weight: 1.75, min: 0.55, max: 1.8  },
    LeftUpLeg:  { baseline: 9,  weight: 1.75, min: 0.55, max: 1.8  },
  },
  female: {
    // 한국 여성 평균 (대략): 한쪽 팔 ~2, 한쪽 다리 ~6, 몸통 ~17 → 합 ~25
    Spine02:    { baseline: 25, weight: 0.75, min: 0.75, max: 1.3  },
    RightUpLeg: { baseline: 6,  weight: 1.75, min: 0.55, max: 1.8  },
    LeftUpLeg:  { baseline: 6,  weight: 1.75, min: 0.55, max: 1.8  },
  },
};

/**
 * 부위별 입력 없이 "전체 골격근량(muscle)"만으로 스케일을 결정할 때 쓰는 설정.
 * 입력값은 muscle 한 개지만, 적용 본별로 변화 폭을 따로 둠 — 부위별 모드의 본별
 * 차이(상체는 둔감, 다리는 민감)를 fallback에서도 동일하게 살리기 위함.
 *
 * baseline: 한국 성인 평균 골격근량 (kg)
 * weight:   변화 폭 가중치 (작을수록 차이가 적게 반영됨)
 * min/max:  스케일 클램핑 범위
 */
const MUSCLE_FALLBACK_BY_GENDER = {
  male: {
    Spine02:    { baseline: 33, weight: 1.5,  min: 0.7, max: 1.4 },  // 상체: 부위별 모드보다 살짝 강함
    RightUpLeg: { baseline: 33, weight: 1.75, min: 0.6, max: 1.8 },  // 다리: 부위별과 동일한 폭
    LeftUpLeg:  { baseline: 33, weight: 1.75, min: 0.6, max: 1.8 },
  },
  female: {
    Spine02:    { baseline: 24, weight: 1.5,  min: 0.7, max: 1.4 },
    RightUpLeg: { baseline: 24, weight: 1.75, min: 0.6, max: 1.8 },
    LeftUpLeg:  { baseline: 24, weight: 1.75, min: 0.6, max: 1.8 },
  },
};

// 생성 애니메이션 설정 (3단계 "뚝!뚝!뚝!")
const GENERATION_STEPS = 3;       // 단계 수
const STEP_INTERVAL = 1000;       // 단계 간 간격 (ms)
const SNAP_DURATION = 180;        // 각 단계 도달 시간 (ms)


/**
 * gender 정규화 ('female' 외엔 모두 'male')
 */
function getGender(inbody) {
  return inbody?.gender === 'female' ? 'female' : 'male';
}

/**
 * 인바디 값을 본 스케일로 변환
 * 1) value/baseline 으로 원본 비율 계산
 * 2) (비율-1) * weight 로 변화 폭 조정
 * 3) min/max 로 클램핑
 */
function toScale(value, config) {
  if (!value || !config?.baseline) return 1.0;
  const rawRatio = value / config.baseline;
  const weighted = 1 + (rawRatio - 1) * config.weight;
  return Math.max(config.min, Math.min(config.max, weighted));
}

/**
 * 부위별 입력값이 모두 들어있는지 확인 (네 부위 다 채워져있어야 정상 매핑)
 */
function hasDetailMuscle(inbody) {
  return Boolean(inbody.armR && inbody.legR && inbody.legL && inbody.trunk);
}

/**
 * 인바디 데이터를 본 스케일 객체로 변환 (성별 반영)
 *
 * 두 가지 경로:
 *   1) 부위별 근육량이 전부 있음 → 기존 로직 (Spine02는 상체합, 다리는 각자 따로)
 *   2) 부위별이 비어있음 → fallback: 전체 골격근량(muscle) 한 값으로 상/하체 전부 균등 스케일
 *
 * Spine02가 커지면 자식 본 neck/Head도 자동으로 같이 커진다.
 * 머리 크기를 원래 크기로 유지하려면 neck 스케일을 1/Spine02 로 역보정한다.
 *
 * @param {Object} inbody
 * @returns {Object} { Spine02, neck, RightUpLeg, LeftUpLeg }
 */
export function inbodyToBoneScales(inbody) {
  const gender = getGender(inbody);

  // 경로 1: 부위별 입력 있음 — 기존 정밀 매핑
  if (hasDetailMuscle(inbody)) {
    const config = BONE_CONFIG_BY_GENDER[gender];
    const upperTotal = inbody.armR + inbody.legR + inbody.trunk;
    const spine02 = toScale(upperTotal, config.Spine02);

    return {
      Spine02:    spine02,
      neck:       1 / spine02,
      RightUpLeg: toScale(inbody.legR, config.RightUpLeg),
      LeftUpLeg:  toScale(inbody.legL, config.LeftUpLeg),
    };
  }

  // 경로 2: 부위별 비어있음 — muscle 한 값을 본별 weight/max로 따로 적용
  // 다리는 상체보다 더 민감하게 반응 (부위별 모드와 동일한 의도)
  const fallback = MUSCLE_FALLBACK_BY_GENDER[gender];
  const spine02 = toScale(inbody.muscle, fallback.Spine02);

  return {
    Spine02:    spine02,
    neck:       1 / spine02,                                // 머리 크기 보존 위해 역수
    RightUpLeg: toScale(inbody.muscle, fallback.RightUpLeg),
    LeftUpLeg:  toScale(inbody.muscle, fallback.LeftUpLeg),
  };
}

/**
 * 모델이 로드될 때까지 기다림 (간단한 폴링)
 */
function waitForModel(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const model = getModel();
      if (model) return resolve(model);
      if (Date.now() - start > timeoutMs) return resolve(null);
      requestAnimationFrame(check);
    };
    check();
  });
}

/**
 * easeOutBack 보간 함수 (살짝 오버슈트하며 도달 - "스냅" 느낌)
 */
function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * 짧은 시간 동안 본 스케일을 빠르게 도달시킴 (스냅 효과)
 */
function snapBoneScales(model, fromScales, toScales, durationMs) {
  return new Promise((resolve) => {
    const startTime = performance.now();

    function step() {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / durationMs, 1);
      const eased = easeOutBack(t);

      for (const [boneName, target] of Object.entries(toScales)) {
        const start = fromScales[boneName] ?? 1.0;
        const value = start + (target - start) * eased;
        const bone = model.getObjectByName(boneName);
        if (bone) bone.scale.set(value, value, value);
      }

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        resolve();
      }
    }

    requestAnimationFrame(step);
  });
}

/**
 * 단계별 스냅 애니메이션
 * 시작값 → 1/3 지점 → 2/3 지점 → 목표값
 */
async function steppedSnapBoneScales(model, targetScales) {
  const startScales = {};
  for (const boneName of Object.keys(targetScales)) {
    const bone = model.getObjectByName(boneName);
    startScales[boneName] = bone ? bone.scale.x : 1.0;
  }

  for (let i = 1; i <= GENERATION_STEPS; i++) {
    const ratio = i / GENERATION_STEPS;
    const stepTarget = {};
    for (const [boneName, target] of Object.entries(targetScales)) {
      const start = startScales[boneName];
      stepTarget[boneName] = start + (target - start) * ratio;
    }

    await wait(STEP_INTERVAL - SNAP_DURATION);
    await snapBoneScales(model, getCurrentScales(model, targetScales), stepTarget, SNAP_DURATION);
  }
}

function getCurrentScales(model, scales) {
  const result = {};
  for (const boneName of Object.keys(scales)) {
    const bone = model.getObjectByName(boneName);
    result[boneName] = bone ? bone.scale.x : 1.0;
  }
  return result;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 인바디 데이터로 캐릭터를 생성하여 컨테이너에 표시
 * 성별에 따라 다른 모델/baseline/애니메이션이 적용됨.
 *
 * @param {string} containerId - 캐릭터를 띄울 DOM 요소 id
 * @param {Object} inbody - 인바디 입력값 (gender 포함)
 */
export async function generateCharacter(containerId, inbody) {
  const gender = getGender(inbody);

  // 성별 맞는 캐릭터 초기화 (이미 초기화돼있으면 무시됨)
  initCharacter(containerId, gender);

  const targetScales = inbodyToBoneScales(inbody);
  console.log(`[generateCharacter] gender=${gender}, 목표 스케일:`, targetScales);

  localStorage.setItem('customization', JSON.stringify(targetScales));

  const model = await waitForModel();
  if (!model) {
    console.warn('[generateCharacter] 모델 로드 실패');
    return;
  }

  // 일단 기본 스케일(1.0)로 리셋
  const reset = {};
  for (const boneName of Object.keys(targetScales)) reset[boneName] = 1.0;
  applyCustomization(reset);

  // 기본자세 재생 (성별에 맞는 클립이 자동 선택됨)
  playAnimationByRole('default');

  // 1) 상체 3단계 변화 ("뚝! 뚝! 뚝!")
  const upperBody = {
    Spine02: targetScales.Spine02,
    neck:    targetScales.neck,
  };
  await steppedSnapBoneScales(model, upperBody);

  // 2) 하체 3단계 변화
  const lowerBody = {
    RightUpLeg: targetScales.RightUpLeg,
    LeftUpLeg:  targetScales.LeftUpLeg,
  };
  await steppedSnapBoneScales(model, lowerBody);

  console.log('[generateCharacter] 상체+하체 단계별 스냅 완료');
}

/**
 * 춤 애니메이션 재생 (현재 성별에 맞는 클립)
 */
export function playDance() {
  playAnimationByRole('dance');
}

/**
 * 기본자세로 복귀 (현재 성별에 맞는 클립)
 */
export function playIdle() {
  playAnimationByRole('default');
}
