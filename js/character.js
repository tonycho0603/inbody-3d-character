/**
 * character.js - 3D 캐릭터 관리 모듈
 *
 * Three.js를 사용하여 GLB 캐릭터를 로드하고 렌더링합니다.
 * 애니메이션 재생 및 본 커스터마이징 적용을 담당합니다.
 *
 * 성별 지원:
 *   - 'male'(default), 'female' 두 가지 모델 + 각자의 애니메이션 매핑
 *   - 인덱스가 아닌 이름(role) 기반 매핑이라 GLB 변경에 강건함
 *
 * 세션 라이프사이클:
 *   - initCharacter(containerId, gender): 캔버스 생성 + 모델 로드
 *   - resetCharacter():                   세션 종료 시 호출. 캔버스/씬/렌더러 통째로 dispose.
 *                                         다음 initCharacter는 처음부터 새로 만듦.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// 성별별 GLB 경로 (Violet Velocity 캐릭터, 병합 애니메이션 1파일)
const MODEL_PATHS = {
  male:   'asset/character/male/Meshy_AI_Violet_Velocity_Kid_biped_Meshy_AI_Meshy_Merged_Animations.glb',
  female: 'asset/character/female/Meshy_AI_Violet_Velocity_biped_Meshy_AI_Meshy_Merged_Animations.glb',
};

// 성별별 "역할(role) → 클립 이름" 매핑
//
// 병합 GLB 안의 클립 이름 (정상 이름으로 들어있음):
//   male:   ['All_Night_Dance','Idle_02','Running','Walking','Wave_for_Help_4']
//   female: ['Idle_02','Running','Superlove_Pop_Dance','Walking','Wave_for_Help_4']
// 이전 Meshy 함정(이름↔모션 불일치)과 달리 이름이 맞는 것으로 보이나,
// default/dance가 의도대로 재생되는지 한 번 시각 확인 권장.
const ANIMATION_MAP = {
  male: {
    default: 'Idle_02',
    dance:   'All_Night_Dance',
  },
  female: {
    default: 'Idle_02',
    dance:   'Superlove_Pop_Dance',
  },
};

// 캐릭터 상태 (모듈 전역)
let scene = null;
let camera = null;
let renderer = null;
let mixer = null;
let model = null;
let animations = [];
let currentAction = null;
let currentGender = 'male';
let animationFrameId = null;
let resizeHandler = null;
let footBones = [];                 // 바닥 고정용 발 본 캐시
const clock = new THREE.Clock();
const _footVec = new THREE.Vector3();


/**
 * gender 파라미터를 'male' | 'female'로 정규화.
 */
function normalizeGender(g) {
  return g === 'female' ? 'female' : 'male';
}


/**
 * 지정된 컨테이너에 3D 캐릭터를 초기화합니다.
 * @param {string} containerId - 캐릭터를 렌더링할 DOM 요소 id
 * @param {string} [gender='male'] - 'male' | 'female'
 */
export function initCharacter(containerId, gender = 'male') {
  const container = document.getElementById(containerId);

  // 이미 초기화된 경우 무시 (resetCharacter 호출 후엔 canvas 없으니 통과)
  if (!container || container.querySelector('canvas')) return;

  currentGender = normalizeGender(gender);

  // 씬
  scene = new THREE.Scene();
  scene.background = null;

  // 카메라
  camera = new THREE.PerspectiveCamera(
    30,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  );
  // z를 살짝 뒤로 빼서 머리 위쪽이 안 잘리게 (새 캐릭터 키 반영)
  // lookAt y를 올려 시선을 몸통 중앙으로 → 캐릭터가 네모 프레임 중앙에 오게
  camera.position.set(0, 1.7, 9);
  camera.lookAt(0, 1.25, 0);

  // 렌더러
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  // 조명
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(3, 5, 3);
  scene.add(dirLight);

  // GLB 모델 로드
  const loader = new GLTFLoader();
  loader.load(MODEL_PATHS[currentGender], (gltf) => {
    model = gltf.scene;
    scene.add(model);

    // 발 본 캐시 (다리 스케일 후 발을 바닥에 고정하는 데 사용)
    footBones = ['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot']
      .map(n => model.getObjectByName(n)).filter(Boolean);

    // 애니메이션 클립에서 스케일 트랙 제거
    gltf.animations.forEach((clip) => {
      clip.tracks = clip.tracks.filter(track => !track.name.endsWith('.scale'));
    });

    mixer = new THREE.AnimationMixer(model);
    animations = gltf.animations;

    console.log(`[character] ${currentGender} 모델 로드. 애니메이션:`,
      animations.map(a => a.name));

    // localStorage 커스터마이징 자동 적용
    const saved = localStorage.getItem('customization');
    if (saved) {
      applyCustomization(JSON.parse(saved));
    }

    // 기본자세 재생
    playAnimationByRole('default');
  });

  // 윈도우 리사이즈 대응
  resizeHandler = () => {
    if (!camera || !renderer) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener('resize', resizeHandler);

  // 렌더 루프
  function animate() {
    animationFrameId = requestAnimationFrame(animate);
    if (mixer) mixer.update(clock.getDelta());
    groundModel();                                   // 발을 바닥에 고정
    if (renderer && scene && camera) renderer.render(scene, camera);
  }
  animate();
}


/**
 * 캔버스/씬/렌더러를 모두 dispose하고 상태를 초기화합니다.
 * "다시 만들기" 같은 세션 종료 시점에 호출.
 *
 * 다음 initCharacter() 호출 시 처음부터 새로 만들게 됨.
 */
export function resetCharacter() {
  // 렌더 루프 정지
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  // 리사이즈 핸들러 제거
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }

  // 애니메이션 정지
  if (currentAction) currentAction.stop();
  currentAction = null;
  if (mixer) mixer.stopAllAction();
  mixer = null;
  animations = [];

  // 씬 안 리소스 dispose (geometry, material 등)
  if (scene) {
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
    scene.clear?.();
    scene = null;
  }

  // 렌더러 dispose + 캔버스 DOM 제거
  if (renderer) {
    renderer.dispose();
    if (renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
    renderer = null;
  }

  // 나머지 상태 초기화
  model = null;
  footBones = [];
  camera = null;

  console.log('[character] 캐릭터 리셋 완료. 다음 init 때 새로 만들어짐');
}


/**
 * 애니메이션 이름으로 재생합니다 (성별 무관).
 */
export function playAnimationByName(name) {
  if (!mixer || !animations.length) return;

  const clip = animations.find(a => a.name === name);
  if (!clip) {
    console.warn(`[character] 애니메이션 "${name}" 없음. 사용 가능:`,
      animations.map(a => a.name));
    return;
  }

  if (currentAction) currentAction.fadeOut(0.3);

  const action = mixer.clipAction(clip);
  action.reset();
  action.enabled = true;
  action.setEffectiveWeight(1);
  action.fadeIn(0.3);
  action.play();
  currentAction = action;
}


/**
 * 역할(role)로 재생합니다. 패턴 매칭으로 클립을 찾음 (성별 무관).
 * @param {string} role - 'default' | 'dance'
 */
export function playAnimationByRole(role) {
  const name = ANIMATION_MAP[currentGender]?.[role];
  if (!name) {
    console.warn(`[character] role "${role}" 매핑 없음 (gender=${currentGender})`);
    return;
  }
  playAnimationByName(name);
}


/**
 * 인덱스로 재생합니다 (구버전 호환용).
 */
export function playAnimation(index) {
  if (!mixer || !animations.length) return;
  if (currentAction) currentAction.fadeOut(0.3);

  const action = mixer.clipAction(animations[index]);
  action.reset();
  action.enabled = true;
  action.setEffectiveWeight(1);
  action.fadeIn(0.3);
  action.play();
  currentAction = action;
}


/**
 * 캐릭터를 바닥(y=0)에 고정합니다.
 * 다리 본을 키우면 발이 hip 기준 아래로 길어져 프레임에서 잘리므로,
 * 매 프레임 발 최저점을 y=0으로 올려 발이 항상 같은 바닥선에 닿게 함.
 */
function groundModel() {
  if (!model || !footBones.length) return;
  model.position.y = 0;
  model.updateMatrixWorld(true);
  let minY = Infinity;
  for (const b of footBones) {
    _footVec.setFromMatrixPosition(b.matrixWorld);
    if (_footVec.y < minY) minY = _footVec.y;
  }
  if (minY < Infinity) model.position.y = -minY;
}


/**
 * 본 스케일을 적용합니다.
 * @param {Object} data - { 본이름: 스케일값 }
 */
export function applyCustomization(data) {
  if (!model) return;
  for (const [boneName, scale] of Object.entries(data)) {
    const bone = model.getObjectByName(boneName);
    if (bone) {
      bone.scale.set(scale, scale, scale);
    }
  }
}


/**
 * 현재 로드된 모델 반환
 */
export function getModel() {
  return model;
}


/**
 * 현재 캐릭터 성별 반환
 */
export function getCurrentGender() {
  return currentGender;
}
