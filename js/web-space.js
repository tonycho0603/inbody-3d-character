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
  male:   { idle: 'Idle_02', walk: 'Walking', dance: 'Gangnam_Groove',      wave: 'Wave_for_Help_1' },
  female: { idle: 'Idle_02', walk: 'Walking', dance: 'Superlove_Pop_Dance', wave: 'Wave_for_Help_1' },
};

// 들러리(친구) 2명 — 남녀 1명씩
const DECOYS = [
  { gender: 'female', x: -3, z: -3, role: 'dance', rotY:  0.4 },
  { gender: 'male',   x:  3, z: -3, role: 'wave',  rotY: -0.4 },
];

// 이동 파라미터
const MOVE_SPEED = 2.6;     // units/sec
const TURN_LERP  = 0.2;     // 방향 전환 부드럽기
const BOUNDS     = 12;      // 바닥(30x30) 안쪽 이동 한계
const CAM_DIST   = 7;       // 캐릭터로부터 카메라 거리
const CAM_HEIGHT = 3.8;     // 카메라 높이
const DRAG_SENS  = 0.006;   // 드래그 회전 감도 (rad/px)

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
 * 텍스트 말풍선을 그린 캔버스를 텍스처로 쓰는 빌보드 Sprite 생성.
 * (HTML 오버레이가 아니라 3D 씬 안 객체라 깊이/위치가 자연스러움)
 */
function makeTextSprite(text) {
  const FONT = 48, PAD = 26, RADIUS = 30;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `800 ${FONT}px sans-serif`;
  const textW = Math.ceil(measure.measureText(text).width);

  const canvas = document.createElement('canvas');
  canvas.width  = textW + PAD * 2;
  canvas.height = FONT + PAD * 2;
  const c = canvas.getContext('2d');

  // 흰 라운드 박스
  c.fillStyle = '#fff';
  if (c.roundRect) { c.beginPath(); c.roundRect(0, 0, canvas.width, canvas.height, RADIUS); c.fill(); }
  else c.fillRect(0, 0, canvas.width, canvas.height);

  // 텍스트
  c.font = `800 ${FONT}px sans-serif`;
  c.fillStyle = '#1a1a2e';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
  );
  const h = 0.45;                                          // 월드 높이(m)
  sprite.scale.set(h * (canvas.width / canvas.height), h, 1);
  return sprite;
}

// 헬스 기구 배치 (파일별로 원본 스케일이 달라 '높이' 기준으로 정규화)
// targetH = 월드 기준 목표 높이(캐릭터 ~1.8). x/z = 바닥 위치. rotY = 회전(중앙 바라보게).
const OBJECT_DIR = 'asset/object/';
const OBJECTS = [
  { file: 'Meshy_AI_powerrack_0615164335_texture.glb',        targetH: 4.8,  x:  0, z: -9, rotY: 0 },
  { file: 'Meshy_AI_runnning_machine_0615164147_texture.glb', targetH: 2.4,  x: -8, z: -4, rotY: 0 },
  { file: 'Meshy_AI_runnning_machine_0615164147_texture.glb', targetH: 2.4,  x: -8, z:  1, rotY: 0 },
  { file: 'Meshy_AI_benchpress_0615164154_texture.glb',       targetH: 2.16, x:  8, z: -2, rotY: -Math.PI / 2 },
  { file: 'Meshy_AI_dumbbell_0615164546_texture.glb',         targetH: 0.6, x:  4, z:  4, rotY:  0.4 },
  { file: 'Meshy_AI_dumbbell_0615164546_texture.glb',         targetH: 0.6, x: -4, z:  4, rotY: -0.4 },
];

/** GLB 하나를 높이 정규화 + 바닥에 앉혀 배치 */
function loadObject(loader, scene, cfg) {
  loader.load(OBJECT_DIR + cfg.file, (gltf) => {
    const obj = gltf.scene;
    // 1) 원본 높이 측정 → targetH로 스케일
    const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
    obj.scale.setScalar(cfg.targetH / (size.y || 1));
    // 2) 스케일 후 다시 측정해 바닥(y=0)에 앉힘
    const minY = new THREE.Box3().setFromObject(obj).min.y;
    obj.position.set(cfg.x, -minY, cfg.z);
    obj.rotation.y = cfg.rotY || 0;
    scene.add(obj);
  });
}

/**
 * 공간 환경 구성 (바닥 + 러그 + 화분 + 벤치 + 분위기 조명).
 * 외부 에셋 없이 기본 도형으로만 절차적 생성.
 */
function buildEnvironment(scene) {
  // 바닥
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({ color: 0x2b2b40, roughness: 1 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // 중앙 러그(원형 플랫폼) — 바닥과 뚜렷이 다른 색으로 강조
  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(5.5, 48),
    new THREE.MeshStandardMaterial({ color: 0x4954a6, roughness: 0.9 })
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.02;
  scene.add(rug);

  // 은은한 그리드(깊이감)
  const grid = new THREE.GridHelper(30, 30, 0x556089, 0x333355);
  grid.position.y = 0.01;
  grid.material.transparent = true;
  grid.material.opacity = 0.25;
  scene.add(grid);

  // 분위기 포인트 라이트 (따뜻 + 시원)
  const warm = new THREE.PointLight(0xffd9a0, 0.6, 40);
  warm.position.set(-8, 5, -4);
  scene.add(warm);
  const cool = new THREE.PointLight(0x88aaff, 0.5, 40);
  cool.position.set(8, 5, 6);
  scene.add(cool);

  // 헬스 기구 배치
  const objLoader = new GLTFLoader();
  OBJECTS.forEach((cfg) => loadObject(objLoader, scene, cfg));
}

/**
 * 들러리 캐릭터 1명 로드 + 지정 클립 재생.
 */
function spawnDecoy(loader, scene, mixers, cfg, onLoaded) {
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

    if (onLoaded) onLoaded(model);
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

  // ===== 말풍선 시스템 (3D Sprite, 캐릭터 머리 위) =====
  // 캔버스 텍스처 Sprite를 씬에 띄우고, 매 프레임 대상 머리 본 위로 위치만 맞춘다.
  // Sprite는 항상 카메라를 바라봐서(빌보드) 시점 돌려도 글자가 정면으로 보임.
  const bubbles = [];
  const _bubblePos = new THREE.Vector3();
  function makeBubble(getHead) {
    const entry = { getHead, sprite: null, timer: null };
    bubbles.push(entry);
    return {
      show(text, ms) {
        if (entry.sprite) scene.remove(entry.sprite);
        entry.sprite = makeTextSprite(text);
        entry.sprite.visible = false;       // 위치 잡힌 다음 프레임에 표시
        entry.sprite.renderOrder = 999;     // 항상 위에
        scene.add(entry.sprite);
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          if (entry.sprite) { scene.remove(entry.sprite); entry.sprite = null; }
        }, ms);
      },
    };
  }
  function updateBubbles() {
    for (const b of bubbles) {
      if (!b.sprite) continue;
      const head = b.getHead();
      if (!head) continue;
      head.getWorldPosition(_bubblePos);
      b.sprite.position.set(_bubblePos.x, _bubblePos.y + 0.9, _bubblePos.z);
      b.sprite.visible = true;
    }
  }

  // ===== 조명 =====
  scene.add(new THREE.AmbientLight(0xffffff, 1.25));        // 전체 밝기 ↑
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
  dirLight.position.set(4, 8, 5);
  scene.add(dirLight);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.7); // 반대편 채움광
  fillLight.position.set(-5, 6, -4);
  scene.add(fillLight);

  // ===== 환경 (바닥 + 러그 + 화분 + 벤치 + 분위기 조명) =====
  buildEnvironment(scene);

  // ===== 캐릭터 로드 =====
  const loader = new GLTFLoader();
  const mixers = [];

  // 들러리 2명 + 입장 인사 말풍선
  const decoyHeads = {};       // gender -> Head 본
  DECOYS.forEach((d) => {
    spawnDecoy(loader, scene, mixers, d, (model) => {
      decoyHeads[d.gender] = model.getObjectByName('Head');
    });
  });
  const femaleBubble = makeBubble(() => decoyHeads.female);
  const maleBubble   = makeBubble(() => decoyHeads.male);
  // 인사 사이클: 여자 "안녕?" → 2초 뒤 남자 "반가워!". 7초마다 반복.
  function greetCycle() {
    femaleBubble.show('안녕?', 3000);
    setTimeout(() => maleBubble.show('반가워!', 3000), 2000);
  }
  function startGreeting() {
    if (decoyHeads.female && decoyHeads.male) {
      greetCycle();
      setInterval(greetCycle, 7000);
    } else {
      setTimeout(startGreeting, 200);   // 모델 로드 전이면 잠시 후 재시도
    }
  }
  startGreeting();

  // 내 캐릭터 (조작 대상)
  let userModel = null;
  let userMixer = null;
  let userHeadBone = null;   // 내 캐릭터 말풍선 기준 (머리 본)
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
    userHeadBone = userModel.getObjectByName('Head');   // 말풍선 기준

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
  const myBubble = makeBubble(() => userHeadBone);   // 내 캐릭터 말풍선
  bindGestureButtons(container, {
    wave: () => { if (actions.wave) { actions.wave.reset(); } gestureName = 'wave'; myBubble.show('안녕?', 2500); },
    dance: () => { gestureName = (gestureName === 'dance') ? null : 'dance'; },
  });

  // ===== 카메라 드래그 회전 (캐릭터 중심 궤도) =====
  // 빈 캔버스 영역에서 드래그하면 시점이 캐릭터 주위를 돈다.
  // (D-패드/제스처 버튼은 pointer-events로 따로 처리되어 충돌 안 함)
  let camYaw = 0;
  let dragging = false, lastX = 0;
  const canvasEl = renderer.domElement;
  canvasEl.style.touchAction = 'none';   // 터치 드래그가 스크롤로 새지 않게
  canvasEl.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    canvasEl.setPointerCapture(e.pointerId);
  });
  canvasEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    camYaw -= (e.clientX - lastX) * DRAG_SENS;
    lastX = e.clientX;
  });
  const endDrag = (e) => {
    dragging = false;
    if (e.pointerId != null) canvasEl.releasePointerCapture?.(e.pointerId);
  };
  canvasEl.addEventListener('pointerup', endDrag);
  canvasEl.addEventListener('pointercancel', endDrag);

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
      // 입력 → 카메라 기준 방향 (드래그로 돌린 시점이 곧 '앞')
      const f = (input.forward ? 1 : 0) - (input.back ? 1 : 0);   // 앞(+)/뒤(-)
      const s = (input.right ? 1 : 0) - (input.left ? 1 : 0);     // 오른쪽(+)/왼쪽(-)
      // 카메라가 보는 앞 = 캐릭터 - 카메라 = (-sin, -cos), 오른쪽 = (cos, -sin)
      const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
      const rx =  Math.cos(camYaw), rz = -Math.sin(camYaw);
      _dir.set(fx * f + rx * s, 0, fz * f + rz * s);
      const moving = _dir.lengthSq() > 0;

      if (moving) {
        _dir.normalize();
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

      // 3인칭 카메라: 캐릭터 중심으로 camYaw 각도에서 따라봄 (드래그로 회전)
      camera.position.set(
        userModel.position.x + Math.sin(camYaw) * CAM_DIST,
        CAM_HEIGHT,
        userModel.position.z + Math.cos(camYaw) * CAM_DIST
      );
      camera.lookAt(userModel.position.x, 1.2, userModel.position.z);
    }

    updateBubbles();
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
