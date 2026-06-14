/**
 * web-coming-soon.js — Coming Soon 섹션의 "두 캐릭터 댄스 장면"
 *
 * 메인 캐릭터 생성(character.js)과 완전히 별개의 Three.js 씬.
 *   - 자체 scene/camera/renderer/mixer 사용 (싱글톤 character.js 안 건드림)
 *   - 평균 체형 그대로 (사용자 인바디 적용 X)
 *   - 두 모델(남/여) 좌우 배치 + 둘 다 dance 클립 무한 재생
 *
 * 카메라: 위에서 살짝 내려다보고 멀리 (사용자 요청)
 *
 * 같은 GLB 파일을 메인 캐릭터와 공유하지만, 브라우저 캐시 덕분에
 * 두 번째 로드부터는 네트워크 요청 없이 디스크에서 가져옴.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// 두 캐릭터 설정
// danceClip 이름은 character.js의 ANIMATION_MAP과 동일.
// (Meshy AI GLB는 클립 이름 ↔ 실제 모션이 어긋나서, 시각 검증된 이름 사용)
const MODELS = [
  {
    path:      'asset/character/male/Meshy_AI_male_biped_Meshy_AI_Meshy_Merged_Animations.glb',
    danceClip: 'Mirror_Viewing',    // 실제론 손인사 모션 (Meshy GLB 함정 — 메모리 검증)
    x:         -2.8,                // 왼쪽 (헤더 텍스트 바깥쪽)
  },
  {
    path:      'asset/character/female/Meshy_AI_female_biped_Meshy_AI_Meshy_Merged_Animations.glb',
    danceClip: 'Happy_jump_f',
    x:         2.8,                 // 오른쪽 (헤더 텍스트 바깥쪽)
  },
];

/**
 * 지정된 컨테이너에 두 캐릭터 댄스 씬을 띄움.
 * 페이지 로드 시 한 번만 호출하면 됨 (dispose 불필요 — 페이지 수명 동안 살아있음).
 *
 * @param {string} containerId - 캔버스를 넣을 DOM 요소 id
 */
export function initComingSoonDance(containerId) {
  const container = document.getElementById(containerId);
  if (!container || container.querySelector('canvas')) return; // 중복 init 방어

  // ===== 씬 =====
  const scene = new THREE.Scene();
  scene.background = null; // 페이지 배경 그대로 비치게

  // ===== 카메라 =====
  // 위에서 살짝 내려다보고, 멀리서 두 캐릭터를 한 화면에 담는 구도
  const camera = new THREE.PerspectiveCamera(
    28,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  );
  camera.position.set(0, 3.2, 9);
  camera.lookAt(0, 1, 0);

  // ===== 렌더러 =====
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  // ===== 조명 =====
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(3, 5, 3);
  scene.add(dirLight);

  // ===== 모델 로드 + 댄스 재생 =====
  const loader = new GLTFLoader();
  const mixers = [];     // 렌더 루프에서 update() 돌려야 함
  const clock = new THREE.Clock();

  MODELS.forEach((cfg) => {
    loader.load(cfg.path, (gltf) => {
      const model = gltf.scene;
      model.position.x = cfg.x;
      scene.add(model);

      // 애니메이션 목록을 콘솔에 노출 (다른 클립으로 바꿀 때 참고용)
      console.log(`[coming-soon] ${cfg.path.split('/').pop()} 애니메이션 목록:`,
        gltf.animations.map(a => a.name));

      // 클립 안의 .scale 트랙 제거 (캐릭터 본 스케일 보존)
      gltf.animations.forEach((clip) => {
        clip.tracks = clip.tracks.filter(t => !t.name.endsWith('.scale'));
      });

      // 댄스 클립 찾아서 무한 재생
      const mixer = new THREE.AnimationMixer(model);
      const clip = gltf.animations.find(a => a.name === cfg.danceClip);
      if (clip) {
        mixer.clipAction(clip).play();
      } else {
        console.warn(`[coming-soon] dance 클립 "${cfg.danceClip}" 없음. 사용 가능:`,
          gltf.animations.map(a => a.name));
      }
      mixers.push(mixer);
    });
  });

  // ===== 리사이즈 대응 =====
  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  // ===== 렌더 루프 =====
  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    mixers.forEach(m => m.update(delta));
    renderer.render(scene, camera);
  }
  animate();
}
