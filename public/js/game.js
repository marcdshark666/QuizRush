// 3D Game Engine - Indiana Jones Runner
class GameEngine {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.clock = new THREE.Clock();
    this.running = false;
    this.speed = 0.15;
    this.baseSpeed = 0.15;
    this.boulderDistance = 50;
    this.minBoulderDistance = 5;

    // Game objects
    this.player = null;
    this.boulder = null;
    this.tunnel = [];
    this.torches = [];
    this.obstacles = [];
    this.particles = [];
    this.groundTiles = [];

    // Animation
    this.playerBob = 0;
    this.boulderRotation = 0;
    this.shakeAmount = 0;
    this.fogDensity = 0.015;
  }

  init() {
    const container = document.getElementById('game-canvas-container');

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0604);
    this.scene.fog = new THREE.FogExp2(0x0a0604, this.fogDensity);

    // Camera
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(0, 3.5, 8);
    this.camera.lookAt(0, 1, -10);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    container.innerHTML = '';
    container.appendChild(this.renderer.domElement);

    // Lights
    this.setupLights();

    // Build scene
    this.createTunnel();
    this.createPlayer();
    this.createBoulder();
    this.createParticleSystem();

    // Resize handler
    window.addEventListener('resize', () => this.onResize());

    this.running = true;
    this.animate();
  }

  setupLights() {
    // Ambient - very dim
    const ambient = new THREE.AmbientLight(0x1a1008, 0.3);
    this.scene.add(ambient);

    // Player torch light
    this.playerLight = new THREE.PointLight(0xff8c33, 2.5, 20);
    this.playerLight.position.set(0, 3, 4);
    this.playerLight.castShadow = true;
    this.playerLight.shadow.mapSize.set(512, 512);
    this.scene.add(this.playerLight);

    // Boulder glow (ominous red)
    this.boulderLight = new THREE.PointLight(0xff3311, 1.5, 25);
    this.scene.add(this.boulderLight);

    // Distant forward light
    const forwardLight = new THREE.SpotLight(0xffa040, 1, 60, Math.PI / 4);
    forwardLight.position.set(0, 8, -20);
    forwardLight.target.position.set(0, 0, 0);
    this.scene.add(forwardLight);
    this.scene.add(forwardLight.target);
  }

  createTunnel() {
    // Ground
    const groundGeo = new THREE.PlaneGeometry(8, 200);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x3e2f1e,
      roughness: 0.9,
      metalness: 0.1,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = -80;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;

    // Walls
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x2a1f14,
      roughness: 0.95,
      metalness: 0.05,
    });

    for (let side = -1; side <= 1; side += 2) {
      const wallGeo = new THREE.BoxGeometry(0.5, 5, 200);
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.set(side * 4, 2.5, -80);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.scene.add(wall);
    }

    // Ceiling
    const ceilGeo = new THREE.BoxGeometry(8.5, 0.5, 200);
    const ceil = new THREE.Mesh(ceilGeo, wallMat);
    ceil.position.set(0, 5, -80);
    ceil.receiveShadow = true;
    this.scene.add(ceil);

    // Stone details on walls (random bricks)
    const brickMat = new THREE.MeshStandardMaterial({ color: 0x352818, roughness: 1 });
    for (let i = 0; i < 80; i++) {
      const brickGeo = new THREE.BoxGeometry(
        0.1 + Math.random() * 0.1,
        0.2 + Math.random() * 0.4,
        0.3 + Math.random() * 0.6
      );
      const brick = new THREE.Mesh(brickGeo, brickMat);
      const side = Math.random() > 0.5 ? 3.7 : -3.7;
      brick.position.set(
        side + (Math.random() - 0.5) * 0.2,
        Math.random() * 4.5,
        Math.random() * -160
      );
      this.scene.add(brick);
    }

    // Torches on walls
    const torchMat = new THREE.MeshStandardMaterial({ color: 0x4a3520 });
    for (let z = -5; z > -160; z -= 15) {
      for (let side = -1; side <= 1; side += 2) {
        // Torch holder
        const holderGeo = new THREE.CylinderGeometry(0.05, 0.08, 0.5, 6);
        const holder = new THREE.Mesh(holderGeo, torchMat);
        holder.position.set(side * 3.5, 3, z);
        this.scene.add(holder);

        // Flame light
        const torchLight = new THREE.PointLight(0xff6620, 0.8, 8);
        torchLight.position.set(side * 3.3, 3.4, z);
        this.scene.add(torchLight);
        this.torches.push(torchLight);

        // Flame mesh
        const flameGeo = new THREE.SphereGeometry(0.12, 6, 6);
        const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8833 });
        const flame = new THREE.Mesh(flameGeo, flameMat);
        flame.position.copy(torchLight.position);
        this.scene.add(flame);
        this.torches.push({ mesh: flame, light: torchLight, baseY: 3.4 });
      }
    }

    // Ground details (cracks, rubble)
    const rubbleMat = new THREE.MeshStandardMaterial({ color: 0x2e2218, roughness: 1 });
    for (let i = 0; i < 60; i++) {
      const size = 0.05 + Math.random() * 0.15;
      const rubbleGeo = new THREE.DodecahedronGeometry(size, 0);
      const rubble = new THREE.Mesh(rubbleGeo, rubbleMat);
      rubble.position.set(
        (Math.random() - 0.5) * 7,
        size * 0.5,
        Math.random() * -160
      );
      rubble.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      this.scene.add(rubble);
    }
  }

  createPlayer() {
    const group = new THREE.Group();

    // Body (torso)
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.7 });
    const bodyGeo = new THREE.BoxGeometry(0.6, 0.8, 0.35);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.2;
    body.castShadow = true;
    group.add(body);

    // Head
    const headMat = new THREE.MeshStandardMaterial({ color: 0xd4a574, roughness: 0.6 });
    const headGeo = new THREE.SphereGeometry(0.22, 8, 8);
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.85;
    head.castShadow = true;
    group.add(head);

    // Hat (Indiana Jones fedora!)
    const hatMat = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.8 });
    // Hat brim
    const brimGeo = new THREE.CylinderGeometry(0.35, 0.38, 0.05, 12);
    const brim = new THREE.Mesh(brimGeo, hatMat);
    brim.position.y = 2.0;
    group.add(brim);
    // Hat top
    const topGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.2, 12);
    const top = new THREE.Mesh(topGeo, hatMat);
    top.position.y = 2.12;
    group.add(top);

    // Legs
    const legMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.8 });
    for (let side = -1; side <= 1; side += 2) {
      const legGeo = new THREE.BoxGeometry(0.2, 0.6, 0.25);
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(side * 0.15, 0.5, 0);
      leg.castShadow = true;
      group.add(leg);
      if (side === -1) this.leftLeg = leg;
      else this.rightLeg = leg;
    }

    // Arms
    const armMat = new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.7 });
    for (let side = -1; side <= 1; side += 2) {
      const armGeo = new THREE.BoxGeometry(0.15, 0.55, 0.2);
      const arm = new THREE.Mesh(armGeo, armMat);
      arm.position.set(side * 0.42, 1.15, 0);
      arm.castShadow = true;
      group.add(arm);
      if (side === -1) this.leftArm = arm;
      else this.rightArm = arm;
    }

    // Whip (trailing line)
    const whipCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.5, 1.2, 0),
      new THREE.Vector3(0.8, 1.0, 0.5),
      new THREE.Vector3(1.0, 0.8, 1.2),
      new THREE.Vector3(0.8, 0.6, 2.0),
    ]);
    const whipGeo = new THREE.TubeGeometry(whipCurve, 12, 0.015, 4, false);
    const whipMat = new THREE.MeshStandardMaterial({ color: 0x2a1506, roughness: 0.5 });
    this.whip = new THREE.Mesh(whipGeo, whipMat);
    group.add(this.whip);

    group.position.set(0, 0, 2);
    this.player = group;
    this.scene.add(group);
  }

  createBoulder() {
    const group = new THREE.Group();

    // Main boulder
    const boulderGeo = new THREE.IcosahedronGeometry(2.2, 2);
    const boulderMat = new THREE.MeshStandardMaterial({
      color: 0x4a4a4a,
      roughness: 0.85,
      metalness: 0.15,
    });

    // Deform vertices for more natural look
    const positions = boulderGeo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      const noise = 1 + (Math.sin(x * 3) * Math.cos(y * 2) * Math.sin(z * 4)) * 0.15;
      positions.setXYZ(i, x * noise, y * noise, z * noise);
    }
    boulderGeo.computeVertexNormals();

    const boulder = new THREE.Mesh(boulderGeo, boulderMat);
    boulder.castShadow = true;
    group.add(boulder);

    // Dust ring at base
    const ringGeo = new THREE.RingGeometry(2, 3.5, 16);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x8a7560,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -1.8;
    group.add(ring);
    this.dustRing = ring;

    group.position.set(0, 2.2, 2 - this.boulderDistance);
    this.boulder = group;
    this.scene.add(group);
  }

  createParticleSystem() {
    // Dust particles between player and boulder
    const particleCount = 200;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 6;
      positions[i * 3 + 1] = Math.random() * 4;
      positions[i * 3 + 2] = Math.random() * -40;
      sizes[i] = Math.random() * 0.1 + 0.02;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.PointsMaterial({
      color: 0xb8a080,
      size: 0.08,
      transparent: true,
      opacity: 0.4,
      sizeAttenuation: true,
    });

    this.particleSystem = new THREE.Points(geo, mat);
    this.scene.add(this.particleSystem);
  }

  setBoulderDistance(dist) {
    this.boulderDistance = Math.max(this.minBoulderDistance, Math.min(50, dist));
    if (this.boulder) {
      this.boulder.position.z = this.player.position.z - this.boulderDistance;
    }
  }

  // Boulder gets closer (danger increases)
  moveBoulderCloser(amount) {
    this.boulderDistance = Math.max(this.minBoulderDistance, this.boulderDistance - amount);
  }

  // Boulder gets pushed back (correct answer)
  pushBoulderBack(amount) {
    this.boulderDistance = Math.min(50, this.boulderDistance + amount);
  }

  setSpeed(speed) {
    this.speed = speed;
  }

  triggerShake(amount) {
    this.shakeAmount = amount;
  }

  animate() {
    if (!this.running) return;
    requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();
    const time = this.clock.getElapsedTime();

    // Player running animation
    this.playerBob += delta * 12;
    if (this.player) {
      this.player.position.y = Math.abs(Math.sin(this.playerBob)) * 0.15;

      // Leg animation
      if (this.leftLeg && this.rightLeg) {
        this.leftLeg.rotation.x = Math.sin(this.playerBob) * 0.6;
        this.rightLeg.rotation.x = -Math.sin(this.playerBob) * 0.6;
      }
      // Arm animation
      if (this.leftArm && this.rightArm) {
        this.leftArm.rotation.x = -Math.sin(this.playerBob) * 0.4;
        this.rightArm.rotation.x = Math.sin(this.playerBob) * 0.4;
      }
    }

    // Boulder rolling
    if (this.boulder) {
      this.boulderRotation += delta * this.speed * 8;
      this.boulder.rotation.x = this.boulderRotation;
      this.boulder.rotation.z = Math.sin(time * 2) * 0.05;

      // Update boulder position
      this.boulder.position.z = (this.player ? this.player.position.z : 2) - this.boulderDistance;

      // Boulder light
      this.boulderLight.position.copy(this.boulder.position);
      this.boulderLight.position.y += 3;

      // Boulder intensity based on distance
      const dangerFactor = 1 - (this.boulderDistance - this.minBoulderDistance) / 45;
      this.boulderLight.intensity = 0.5 + dangerFactor * 3;
      this.boulderLight.color.setHSL(0.05 - dangerFactor * 0.05, 1, 0.5);

      // Dust ring pulse
      if (this.dustRing) {
        this.dustRing.material.opacity = 0.2 + Math.sin(time * 4) * 0.1;
        this.dustRing.scale.setScalar(1 + Math.sin(time * 3) * 0.1);
      }
    }

    // Torch flicker
    this.torches.forEach(t => {
      if (t.light && t.baseY !== undefined) {
        t.light.intensity = 0.6 + Math.random() * 0.4;
        t.mesh.position.y = t.baseY + Math.sin(time * 8 + t.baseY) * 0.04;
        t.mesh.scale.setScalar(0.8 + Math.random() * 0.4);
      }
    });

    // Player torch flicker
    if (this.playerLight) {
      this.playerLight.intensity = 2.2 + Math.sin(time * 6) * 0.3 + Math.random() * 0.2;
      this.playerLight.position.set(
        Math.sin(time * 3) * 0.1,
        3 + Math.sin(time * 5) * 0.1,
        (this.player ? this.player.position.z : 2) + 2
      );
    }

    // Camera shake
    if (this.shakeAmount > 0) {
      this.camera.position.x = (Math.random() - 0.5) * this.shakeAmount;
      this.camera.position.y = 3.5 + (Math.random() - 0.5) * this.shakeAmount * 0.5;
      this.shakeAmount *= 0.92;
      if (this.shakeAmount < 0.01) this.shakeAmount = 0;
    } else {
      this.camera.position.x = 0;
      this.camera.position.y = 3.5;
    }

    // Particle animation
    if (this.particleSystem) {
      const positions = this.particleSystem.geometry.attributes.position.array;
      for (let i = 0; i < positions.length; i += 3) {
        positions[i + 1] += Math.sin(time + i) * 0.005;
        positions[i] += Math.cos(time * 0.5 + i) * 0.003;
        if (positions[i + 1] > 5) positions[i + 1] = 0;
      }
      this.particleSystem.geometry.attributes.position.needsUpdate = true;
      this.particleSystem.material.opacity = 0.2 + (1 - this.boulderDistance / 50) * 0.4;
    }

    // Fog density based on danger
    const danger = 1 - this.boulderDistance / 50;
    this.scene.fog.density = 0.012 + danger * 0.008;

    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    if (!this.camera || !this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  destroy() {
    this.running = false;
    if (this.renderer) {
      this.renderer.dispose();
    }
  }
}

// Export globally
window.GameEngine = GameEngine;
