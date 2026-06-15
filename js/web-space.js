/**
 * web-space.js — "친구들과의 공간" 3D 씬 (인터랙티브)
 *
 * Fake Door 검증용 목업 메타버스 공간.
 *   - 서버/멀티플레이어 없음. "이런 공간이 생길 거예요"를 체험시키는 장면.
 *   - 내 캐릭터(인바디 체형)를 WASD/방향키/화면버튼으로 3인칭 조작
 *   - 이동 시 걷기, 멈추면 idle. 춤/인사 버튼으로 제스처 재생.
 *   - 들러리 친구 2명(남/여)이 함께 있음.
 *
 * character.js(메인 결과)·web-coming-soon.js와 완전히 별개의 독립 씬.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// 성별별 모델 경로 (Violet Velocity 병합 GLB)
const MODEL_PATHS = {
  male:   'asset/character/male/Meshy_AI_Violet_Velocity_Kid_biped_Meshy_AI_Meshy_Merged_Animations.glb',
  female: 'asset/character/female/Meshy_AI_Violet_Velocity_biped_Meshy_AI_Meshy_Merged_Animations.glb',
};

// 성별별 "역할 → 클립 이름" (병합 GLB 내부 클립)
const CLIPS = {
  male:   { idle: 'Idle_02', walk: 'Walking', dance: 'All_Night_Dance',     wave: 'Wave_for_Help_4' },
  female: { idle: 'Idle_02', walk: 'Walking', dance: 'Superlove_Pop_Dance', wave: 'Wave_for_Help_4' },
};

// 들러리(친구) 2명 — 남녀 1명씩
const DECOYS = [
  { gender: 'female', x: -3, z: -3, role: 'dance', rotY:  0.4 },
  { gender: 'male',   x:  3, z: -3, role: 'wave',  rotY: -0.4 },
];

// 이동 파라미터
const MOVE_SPEED = 2.6;     // units/sec
const TURN_LERP  = 0.2;     // 방향 전환 부드럽기
const BOUNDS     = 18;      // 바닥(40x40) 안쪽 이동 한계
const CAM_OFFSET = new THREE.Vector3(0, 3, 5.5);   // 3인칭 카메라 오프셋(캐릭터 기준)

// 발 본 (캐릭터를 바닥에 세우는 데 사용)
const FOOT_BONES = ['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot'];
const _footVec = new THREE.Vector3();

/** 본 스케일 객체를 모델에 적용 (인바디 반영) */
function applyBoneScales(model, scales) {
  if (!scales) return;
  for (const [boneName, value] of Object.entries(scales)) {
    const bone = model.getObjectByName(boneName);
    if (bone) bone.scale.set(value, value, value);
  }
}

/** 모델을 바닥(y=0)에 세움 (다리 스케일로 발이 내려가도 바닥에 닿게) */
function groundOnFloor(model) {
  model.updateMatrixWorld(true);
  let minY = Infinity;
  for (const n of FOOT_BONES) {
    const b = model.getObjectByName(n);
    if (b) {
      _footVec.setFromMatrixPosition(b.matrixWorld);
      if (_footVec.y < minY) minY = _footVec.y;
    }
  }
  if (minY < Infinity) model.position.y = -minY;
}

/** 클립 트랙에서 .scale 제거 (본 스케일이 애니메이션에 덮이지 않게) */
function stripScaleTracks(animations) {
  animations.forEach((clip) => {
    clip.tracks = clip.tracks.filter(t => !t.name.endsWith('.scale'));
  });
}

/** 각도 보간 (최단 회전) */
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * 들러리 캐릭터 1명 로드 + 지정 클립 재생.
 */
function spawnDecoy(loader, scene, mixers, cfg) {
  loader.load(MODEL_PATHS[cfg.gender], (gltf) => {
    const model = gltf.scene;
    model.position.set(cfg.x, 0, cfg.z);
    model.rotation.y = cfg.rotY;
    scene.add(model);
    groundOnFloor(model);

    stripScaleTracks(gltf.animations);
    const mixer = new THREE.AnimationMixer(model);
    const clipName = CLIPS[cfg.gender][cfg.role];
    const clip = gltf.animations.find(a => a.name === clipName);
    if (clip) mixer.clipAction(clip).play();
    mixers.push(mixer);
  });
}

/**
 * "친구들과의 공간" 씬을 컨테이너에 띄움. (섹션이 보인 뒤 호출)
 * @param {string} containerId
 * @param {Object} userCharacter - { gender, boneScales }
 */
export function initFriendsSpace(containerId, userCharacter) {
  const container = document.getElementById(containerId);
  if (!container || container.querySelector('canvas')) return; // 중복 방어

  const gender = userCharacter?.gender === 'female' ? 'female' : 'male';
  const boneScales = userCharacter?.boneScales ?? null;

  // ===== 씬 =====
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x16162a);
  scene.fog = new THREE.Fog(0x16162a, 12, 30);

  // ===== 카메라 (3인칭, 매 프레임 캐릭터 따라감) =====
  const camera = new THREE.PerspectiveCamera(
    40, container.clientWidth / container.clientHeight, 0.1, 100
  );

  // ===== 렌더러 =====
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  // ===== 조명 =====
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
  dirLight.position.set(4, 8, 5);
  scene.add(dirLight);

  // ===== 바닥 + 그리드 =====
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x22223c, roughness: 1 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const grid = new THREE.GridHelper(40, 40, 0x667eea, 0x33335a);
  grid.position.y = 0.01;
  scene.add(grid);

  // ===== 캐릭터 로드 =====
  const loader = new GLTFLoader();
  const mixers = [];

  // 들러리 2명
  DECOYS.forEach((d) => spawnDecoy(loader, scene, mixers, d));

  // 내 캐릭터 (조작 대상)
  let userModel = null;
  let userMixer = null;
  const actions = {};        // role -> AnimationAction
  let activeName = null;     // 현재 재생 중인 클립 role
  let gestureName = null;    // 'dance' | 'wave' | null (제스처 잠금)

  /** 액션 교체 (크로스페이드) */
  function crossfade(name) {
    if (activeName === name || !actions[name]) return;
    if (activeName && actions[activeName]) actions[activeName].fadeOut(0.2);
    actions[name].reset().setEffectiveWeight(1).fadeIn(0.2).play();
    activeName = name;
  }

  loader.load(MODEL_PATHS[gender], (gltf) => {
    userModel = gltf.scene;
    userModel.position.set(0, 0, 2);   // 카메라 앞 중앙
    userModel.rotation.y = 0;          // 처음엔 카메라를 바라봄(정면)
    scene.add(userModel);

    applyBoneScales(userModel, boneScales);
    groundOnFloor(userModel);

    stripScaleTracks(gltf.animations);
    userMixer = new THREE.AnimationMixer(userModel);

    // 역할별 액션 준비
    const map = CLIPS[gender];
    for (const [role, clipName] of Object.entries(map)) {
      const clip = gltf.animations.find(a => a.name === clipName);
      if (clip) actions[role] = userMixer.clipAction(clip);
    }
    // 인사는 1회 재생 후 멈춤
    if (actions.wave) {
      actions.wave.setLoop(THREE.LoopOnce);
      actions.wave.clampWhenFinished = true;
    }
    // 인사 끝나면 제스처 해제 → idle 복귀
    userMixer.addEventListener('finished', (e) => {
      if (e.action === actions.wave) gestureName = null;
    });

    crossfade('idle');
  });

  // ===== 입력 상태 =====
  const input = { forward: false, back: false, left: false, right: false };
  const _dir = new THREE.Vector3();

  // 키보드 (공간 섹션이 보일 때만 처리)
  const isActive = () => container.offsetParent !== null;
  const KEYMAP = {
    KeyW: 'forward', ArrowUp: 'forward',
    KeyS: 'back',    ArrowDown: 'back',
    KeyA: 'left',    ArrowLeft: 'left',
    KeyD: 'right',   ArrowRight: 'right',
  };
  window.addEventListener('keydown', (e) => {
    const dir = KEYMAP[e.code];
    if (!dir || !isActive()) return;
    input[dir] = true;
    if (e.code.startsWith('Arrow')) e.preventDefault(); // 화면 스크롤 방지
  });
  window.addEventListener('keyup', (e) => {
    const dir = KEYMAP[e.code];
    if (dir) input[dir] = false;
  });

  // 화면 버튼 (모바일/데스크탑 공용) — #space-stage 안에 있는 컨트롤들
  bindHoldButtons(container, input);
  bindGestureButtons(container, {
    wave: () => { if (actions.wave) { actions.wave.reset(); } gestureName = 'wave'; },
    dance: () => { gestureName = (gestureName === 'dance') ? null : 'dance'; },
  });

  // ===== 리사이즈 =====
  window.addEventListener('resize', () => {
    if (!container.clientWidth) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  // ===== 렌더 루프 =====
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    mixers.forEach(m => m.update(delta));
    if (userMixer) userMixer.update(delta);

    if (userModel) {
      // 입력 → 방향
      _dir.set(0, 0, 0);
      if (input.forward) _dir.z -= 1;
      if (input.back)    _dir.z += 1;
      if (input.left)    _dir.x -= 1;
      if (input.right)   _dir.x += 1;
      const moving = _dir.lengthSq() > 0;

      if (moving) {
        _dir.normalize();
        // 이동 + 경계 클램프
        userModel.position.x = THREE.MathUtils.clamp(
          userModel.position.x + _dir.x * MOVE_SPEED * delta, -BOUNDS, BOUNDS);
        userModel.position.z = THREE.MathUtils.clamp(
          userModel.position.z + _dir.z * MOVE_SPEED * delta, -BOUNDS, BOUNDS);
        // 이동 방향 바라보기 (기본 forward = +Z)
        const target = Math.atan2(_dir.x, _dir.z);
        userModel.rotation.y = lerpAngle(userModel.rotation.y, target, TURN_LERP);
        gestureName = null;       // 움직이면 제스처 취소
        crossfade('walk');
      } else if (gestureName) {
        crossfade(gestureName);
      } else {
        crossfade('idle');
      }

      // 3인칭 카메라 추적
      camera.position.set(
        userModel.position.x + CAM_OFFSET.x,
        CAM_OFFSET.y,
        userModel.position.z + CAM_OFFSET.z
      );
      camera.lookAt(userModel.position.x, 1.2, userModel.position.z);
    }

    renderer.render(scene, camera);
  }
  animate();
}

/**
 * 누르고 있는 동안 input[dir]=true 인 방향 버튼들 바인딩.
 * 버튼은 [data-dir="forward|back|left|right"] 속성으로 표시.
 */
function bindHoldButtons(container, input) {
  const btns = container.querySelectorAll('[data-dir]');
  btns.forEach((btn) => {
    const dir = btn.dataset.dir;
    const on  = (e) => { e.preventDefault(); input[dir] = true; };
    const off = (e) => { e.preventDefault(); input[dir] = false; };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointerleave', off);
    btn.addEventListener('pointercancel', off);
  });
}

/**
 * 제스처 버튼(춤/인사) 바인딩.
 * @param {Object} handlers - { wave, dance } 콜백
 */
function bindGestureButtons(container, handlers) {
  const wave  = container.querySelector('#btn-space-wave');
  const dance = container.querySelector('#btn-space-dance');
  if (wave)  wave.addEventListener('click', handlers.wave);
  if (dance) dance.addEventListener('click', handlers.dance);
}
