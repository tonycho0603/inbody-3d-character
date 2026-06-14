/**
 * web-space.js — "친구들과의 공간" 3D 씬
 *
 * Fake Door 검증용 목업 메타버스 공간.
 *   - 실제 멀티플레이어/서버 없음. "이런 공간이 생길 거예요"를 보여주는 장면.
 *   - 중앙에 사용자가 방금 만든 캐릭터(인바디 본 스케일 반영)
 *   - 주변에 들러리 친구 캐릭터 몇 명 (평균 체형, 인사/춤 애니메이션)
 *   - 마우스 드래그로 공간을 둘러볼 수 있음 (OrbitControls, 제약 걸어둠)
 *
 * character.js(메인 결과 캐릭터)·web-coming-soon.js와 완전히 별개의 독립 씬.
 * 같은 GLB를 공유하지만 브라우저 캐시 덕에 추가 네트워크 비용 거의 없음.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// 성별별 모델 경로 (character.js와 동일 파일)
const MODEL_PATHS = {
  male:   'asset/character/male/Meshy_AI_male_biped_Meshy_AI_Meshy_Merged_Animations.glb',
  female: 'asset/character/female/Meshy_AI_female_biped_Meshy_AI_Meshy_Merged_Animations.glb',
};

// 성별별 "역할 → 클립 이름" (character.js의 ANIMATION_MAP과 동일하게 검증된 이름)
// Meshy GLB는 클립 이름 ↔ 실제 모션이 어긋나므로 시각 검증된 이름만 사용.
const CLIPS = {
  male:   { idle: 'Wave_for_Help_4', dance: 'Running' },              // dance 클립이 실제론 춤
  female: { idle: 'Idle_9',          dance: 'Superlove_Pop_Dance' },
};

// 들러리(친구) 캐릭터 배치.
// 내 캐릭터는 중앙 앞(0, 0, 1.2)에 두고, 친구들은 뒤쪽 반원으로 둘러서게 함.
// rotY: 살짝 안쪽(중앙)을 보도록 회전시켜 "모여있는" 느낌.
const DECOYS = [
  { gender: 'female', x: -2.6, z: -0.6, role: 'dance', rotY:  0.35 },
  { gender: 'male',   x:  2.6, z: -0.6, role: 'dance', rotY: -0.35 },
  { gender: 'male',   x: -1.4, z: -2.4, role: 'idle',  rotY:  0.20 },
  { gender: 'female', x:  1.4, z: -2.4, role: 'idle',  rotY: -0.20 },
];

/**
 * 본 스케일 객체를 모델에 적용 (인바디 반영).
 * scales 예: { Spine02, neck, RightUpLeg, LeftUpLeg }
 */
function applyBoneScales(model, scales) {
  if (!scales) return;
  for (const [boneName, value] of Object.entries(scales)) {
    const bone = model.getObjectByName(boneName);
    if (bone) bone.scale.set(value, value, value);
  }
}

/**
 * GLB 하나를 로드해 씬에 배치하고 지정 클립을 무한 재생.
 *
 * @param {GLTFLoader} loader
 * @param {THREE.Scene} scene
 * @param {THREE.AnimationMixer[]} mixers - 렌더 루프에서 update할 믹서 목록 (push됨)
 * @param {Object} opts - { gender, x, z, role, rotY, boneScales? }
 */
function spawnCharacter(loader, scene, mixers, opts) {
  const { gender, x, z, role, rotY = 0, boneScales = null } = opts;

  loader.load(MODEL_PATHS[gender], (gltf) => {
    const model = gltf.scene;
    model.position.set(x, 0, z);
    model.rotation.y = rotY;
    scene.add(model);

    // 인바디 본 스케일 적용 (내 캐릭터만 전달됨, 들러리는 null → 평균 체형)
    applyBoneScales(model, boneScales);

    // 클립의 .scale 트랙 제거 → 위에서 준 본 스케일이 애니메이션에 덮이지 않게
    gltf.animations.forEach((clip) => {
      clip.tracks = clip.tracks.filter(t => !t.name.endsWith('.scale'));
    });

    // 역할에 맞는 클립 재생
    const clipName = CLIPS[gender][role];
    const mixer = new THREE.AnimationMixer(model);
    const clip = gltf.animations.find(a => a.name === clipName);
    if (clip) {
      mixer.clipAction(clip).play();
    } else {
      console.warn(`[space] 클립 "${clipName}" 없음 (${gender}/${role}). 사용 가능:`,
        gltf.animations.map(a => a.name));
    }
    mixers.push(mixer);
  });
}

/**
 * "친구들과의 공간" 씬을 컨테이너에 띄움.
 * 섹션이 화면에 보인 뒤(컨테이너 크기 확정 후) 호출해야 함.
 * 내부에 중복 init 가드 있음.
 *
 * @param {string} containerId - 캔버스를 넣을 DOM 요소 id
 * @param {Object} userCharacter - { gender: 'male'|'female', boneScales: {...} }
 */
export function initFriendsSpace(containerId, userCharacter) {
  const container = document.getElementById(containerId);
  if (!container || container.querySelector('canvas')) return; // 중복 방어

  const gender = userCharacter?.gender === 'female' ? 'female' : 'male';
  const boneScales = userCharacter?.boneScales ?? null;

  // ===== 씬 =====
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x16162a);            // 사이트 다크톤과 어울리게
  scene.fog = new THREE.Fog(0x16162a, 8, 22);              // 멀수록 흐려져 깊이감

  // ===== 카메라 =====
  const camera = new THREE.PerspectiveCamera(
    35,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  );
  camera.position.set(0, 2.4, 6.5);

  // ===== 렌더러 =====
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  // ===== 둘러보기 컨트롤 (제약 걸어 시야 벗어남 방지) =====
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1, 0);
  controls.enablePan = false;                  // 평행이동 금지
  controls.minDistance = 4;                    // 너무 가까이 X
  controls.maxDistance = 9;                    // 너무 멀리 X
  controls.minPolarAngle = Math.PI * 0.25;     // 너무 위에서 내려다보기 방지
  controls.maxPolarAngle = Math.PI * 0.5;      // 바닥 아래로 못 내려가게
  controls.enableDamping = true;               // 부드러운 감속
  controls.autoRotate = true;                  // 자동 회전 (showcase 느낌)
  controls.autoRotateSpeed = 0.8;
  controls.update();

  // ===== 조명 =====
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
  dirLight.position.set(4, 8, 5);
  scene.add(dirLight);

  // ===== 바닥 + 그리드 (가상공간 느낌) =====
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x22223c, roughness: 1 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const grid = new THREE.GridHelper(40, 40, 0x667eea, 0x33335a);
  grid.position.y = 0.01;                       // z-파이팅 방지
  scene.add(grid);

  // ===== 캐릭터들 =====
  const loader = new GLTFLoader();
  const mixers = [];

  // 내 캐릭터: 중앙 앞, 카메라를 바라봄(기본 회전), 인사 모션 + 인바디 반영
  spawnCharacter(loader, scene, mixers, {
    gender,
    x: 0, z: 1.2, role: 'idle', rotY: 0,
    boneScales,
  });

  // 들러리 친구들
  DECOYS.forEach((d) => spawnCharacter(loader, scene, mixers, d));

  // ===== 리사이즈 대응 =====
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
    controls.update();                          // damping/autoRotate 반영
    renderer.render(scene, camera);
  }
  animate();
}
