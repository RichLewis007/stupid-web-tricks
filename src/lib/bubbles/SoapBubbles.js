// Standalone Soap Bubbles Animation System

/**
 * Soap Bubbles Animation System
 * @class
 */
const LASER_COLLISION_PADDING_PX = 4;

export class SoapBubbles {
  /**
   * @constructor
   * @param {import('./types.js').SoapBubblesConfig} config - Configuration object
   */
  constructor(config) {
    this.config = config;
    this.canvas = document.getElementById(config.canvasId);
    if (!this.canvas) {
      console.warn(`SoapBubbles: Canvas element with id "${config.canvasId}" not found`);
      return;
    }

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      console.warn('SoapBubbles: Could not get 2D context');
      return;
    }

    this.ctx = ctx;
    this.shapes = [];
    this.isRunning = false;
    this.mouse = { x: 0, y: 0 };
    this.pendingTimeouts = [];
    this.maxPendingTimeouts = 50; // Limit pending timeouts to prevent memory leaks
    this.isDestroyed = false;
    this.animationFrameId = null;
    // Pop counters
    this.laserPopCount = 0;
    this.pointerPopCount = 0;
    this.baseBubbleCount = config.bubbleCount;
    this.dynamicBubbleCount = config.bubbleCount;
    this.minBubbleCount = Math.max(3, Math.floor(config.bubbleCount * 0.6));
    this.maxBubbleCount = Math.max(config.bubbleCount * 2, 18);
    this.populationDirty = true;
    this.performanceSamples = [];
    this.lastFrameTime = null;
    this.lastPerformanceCheck = typeof performance !== 'undefined' ? performance.now() : 0;
    this.reduceMotionMediaQuery = null;
    this.reduceMotionListener = null;
    this.spawnCount = 0;
    this.maxNormalRadius = 0;
    this.spawnSpeed = 1.2;
    this.isVisible = true;
    this.visibilityHandler = null;
    this.isOnScreen = true;
    this.tapAudioContext = null;

    // Bind handlers to preserve context
    this.resizeHandler = () => this.resizeCanvas();
    this.mouseMoveHandler = (e) => this.handleMouseMove(e);
    this.clickHandler = (e) => this.handleClick(e);

    this.initialized = true;
    this.init();
  }

  getEdgeSpawn(radius) {
    const width = this.canvas.width || (typeof window !== 'undefined' ? window.innerWidth : 1280);
    const height = this.canvas.height || (typeof window !== 'undefined' ? window.innerHeight : 720);
    const side = Math.floor(Math.random() * 3); // 0 left, 1 right, 2 bottom
    const inward = this.spawnSpeed || 1.2;
    let x = 0;
    let y = 0;
    let vx = 0;
    let vy = 0;
    const jitter = () => (Math.random() - 0.5) * inward * 0.5;

    switch (side) {
      case 0: // left
        x = -radius - 20;
        y = Math.random() * height;
        vx = inward * (1 + Math.random() * 0.5);
        vy = jitter();
        break;
      case 1: // right
        x = width + radius + 20;
        y = Math.random() * height;
        vx = -inward * (1 + Math.random() * 0.5);
        vy = jitter();
        break;
      case 2: // bottom
      default:
        x = Math.random() * width;
        y = height + radius + 20;
        vx = jitter();
        vy = -inward * (1 + Math.random() * 0.5);
        break;
    }

    return { x, y, vx, vy };
  }

  init() {
    this.resizeCanvas();
    this.dynamicBubbleCount = this.calculateAdaptiveBubbleCount();
    this.createShapes();
    this.populationDirty = false;
    this.bindEvents();
    this.startPhysics();
  }

  resizeCanvas() {
    this.container = document.querySelector(this.config.containerSelector);
    if (this.container) {
      const rect = this.container.getBoundingClientRect();
      this.canvas.width = rect.width;
      this.canvas.height = rect.height;

      // Ensure canvas is positioned correctly relative to container
      const canvasRect = this.canvas.getBoundingClientRect();
      const containerRect = this.container.getBoundingClientRect();
      if (canvasRect.left !== containerRect.left || canvasRect.top !== containerRect.top) {
        // Canvas might need to be repositioned - ensure it's inside the container
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
      }
    } else {
      console.warn(
        `SoapBubbles: Container "${this.config.containerSelector}" not found, using window size`,
      );
      // Fallback to window size
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    }

    const newTarget = this.calculateAdaptiveBubbleCount();
    if (newTarget !== this.dynamicBubbleCount) {
      this.dynamicBubbleCount = newTarget;
    }
    this.populationDirty = true;
  }

  // Default soap bubble color sets (pale, iridescent)
  getDefaultColorSets() {
    return [
      ['rgba(255, 230, 250, 0.15)', 'rgba(230, 250, 255, 0.18)', 'rgba(240, 255, 255, 0.12)'],
      ['rgba(240, 230, 255, 0.16)', 'rgba(230, 240, 255, 0.17)', 'rgba(230, 255, 250, 0.14)'],
      ['rgba(230, 245, 255, 0.17)', 'rgba(240, 255, 255, 0.16)', 'rgba(255, 240, 250, 0.15)'],
      ['rgba(235, 255, 240, 0.15)', 'rgba(230, 245, 255, 0.17)', 'rgba(245, 235, 255, 0.16)'],
      ['rgba(255, 250, 235, 0.14)', 'rgba(255, 235, 245, 0.16)', 'rgba(235, 245, 255, 0.15)'],
      ['rgba(235, 255, 255, 0.16)', 'rgba(245, 235, 255, 0.15)', 'rgba(255, 235, 250, 0.17)'],
    ];
  }

  createShapes() {
    if (this.canvas.width === 0 || this.canvas.height === 0) {
      this.resizeCanvas();
    }

    // Double-check canvas has valid dimensions
    if (this.canvas.width === 0 || this.canvas.height === 0) {
      console.warn('SoapBubbles: Canvas has zero dimensions, cannot create shapes');
      return;
    }

    const colorSets = this.getDefaultColorSets();
    const targetCount = this.dynamicBubbleCount;
    for (let i = 0; i < targetCount; i++) {
      this.createNewShape(true, colorSets[i % colorSets.length]);
    }
    this.populationDirty = false;
  }

  lightenColor(color, amount) {
    const rgba = color.match(/\d+/g);
    if (rgba) {
      const r = Math.min(255, parseInt(rgba[0]) + amount * 255);
      const g = Math.min(255, parseInt(rgba[1]) + amount * 255);
      const b = Math.min(255, parseInt(rgba[2]) + amount * 255);
      return `rgba(${r}, ${g}, ${b}, ${rgba[3] || 0.6})`;
    }
    return color;
  }

  calculateAdaptiveBubbleCount() {
    const canvasWidth = this.canvas
      ? this.canvas.width
      : typeof window !== 'undefined'
        ? window.innerWidth
        : 1280;
    const canvasHeight = this.canvas
      ? this.canvas.height
      : typeof window !== 'undefined'
        ? window.innerHeight
        : 720;
    const dpr =
      typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    const normalizedArea = canvasWidth * canvasHeight;

    let areaBased = Math.ceil(normalizedArea / (120000 * Math.min(dpr, 1.5)));
    if (!Number.isFinite(areaBased) || areaBased <= 0) {
      areaBased = this.baseBubbleCount;
    }

    if (canvasWidth < 420) {
      areaBased = Math.min(areaBased, 3);
    } else if (canvasWidth < 640) {
      areaBased = Math.min(areaBased, 5);
    } else if (canvasWidth < 1024) {
      areaBased = Math.min(areaBased, 7);
    }

    if (typeof navigator !== 'undefined') {
      const deviceMemory = navigator.deviceMemory ?? 4;
      if (deviceMemory <= 2) {
        areaBased = Math.min(areaBased, 4);
      }

      const cores = navigator.hardwareConcurrency ?? 4;
      if (cores <= 4) {
        areaBased = Math.min(areaBased, 6);
      }

      const connection =
        navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (connection && ['slow-2g', '2g'].includes(connection.effectiveType)) {
        areaBased = Math.min(areaBased, 3);
      }
    }

    if (typeof window !== 'undefined' && window.matchMedia) {
      try {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduceMotion) {
          areaBased = Math.min(areaBased, 4);
        }
      } catch (_) {
        // ignore
      }
    }

    areaBased = Math.max(this.minBubbleCount, areaBased);
    areaBased = Math.min(this.maxBubbleCount, areaBased);
    return areaBased;
  }

  getLiveBubbleCount() {
    if (!Array.isArray(this.shapes)) return 0;
    return this.shapes.reduce((count, shape) => {
      return shape && shape.life === undefined ? count + 1 : count;
    }, 0);
  }

  trimExcessBubbles(excess) {
    if (excess <= 0) return;
    for (let i = this.shapes.length - 1; i >= 0 && excess > 0; i--) {
      const shape = this.shapes[i];
      if (!shape || shape.life !== undefined || shape.isPopping) continue;
      this.shapes.splice(i, 1);
      excess--;
    }

    // If we still have excess (all remaining are popping/particles), remove whatever is left
    for (let i = this.shapes.length - 1; i >= 0 && excess > 0; i--) {
      const shape = this.shapes[i];
      if (!shape || shape.life !== undefined) continue;
      this.shapes.splice(i, 1);
      excess--;
    }
  }

  syncBubblePopulation() {
    if (!this.populationDirty) return;
    this.populationDirty = false;

    const target = this.dynamicBubbleCount;
    const liveCount = this.getLiveBubbleCount();

    if (liveCount > target) {
      this.trimExcessBubbles(liveCount - target);
    } else if (liveCount < target) {
      const deficit = target - liveCount;
      for (let i = 0; i < deficit; i++) {
        this.createNewShape(true);
      }
    }
  }

  recordPerformanceSample(delta) {
    if (typeof performance === 'undefined' || !delta || !isFinite(delta)) return;
    if (delta > 250) return; // Ignore long pauses (tab switches, throttling)

    const fps = 1000 / delta;
    this.performanceSamples.push(fps);
    if (this.performanceSamples.length > 120) {
      this.performanceSamples.shift();
    }

    const now = performance.now();
    if (now - this.lastPerformanceCheck >= 2000 && this.performanceSamples.length >= 20) {
      const avgFps =
        this.performanceSamples.reduce((sum, value) => sum + value, 0) /
        this.performanceSamples.length;
      const adaptiveTarget = this.calculateAdaptiveBubbleCount();

      if (avgFps < 42 && this.dynamicBubbleCount > this.minBubbleCount) {
        this.dynamicBubbleCount = Math.max(this.minBubbleCount, this.dynamicBubbleCount - 1);
        this.populationDirty = true;
      } else if (avgFps > 58 && this.dynamicBubbleCount < adaptiveTarget) {
        this.dynamicBubbleCount = Math.min(adaptiveTarget, this.dynamicBubbleCount + 1);
        this.populationDirty = true;
      }

      this.performanceSamples = [];
      this.lastPerformanceCheck = now;
    }
  }

  triggerPopSound(shape) {
    if (shape.hasTriggeredSound) return;
    // Don't play sounds when off screen
    if (!this.isOnScreen) return;
    shape.hasTriggeredSound = true;

    try {
      const detail = {
        id: shape.id,
        x: shape.x,
        y: shape.y,
        radius: shape.radius,
      };
      window.dispatchEvent(new CustomEvent('soapbubbles:pop', { detail }));
    } catch (error) {
      console.warn('SoapBubbles: Failed to dispatch pop sound event', error);
    }
  }

  playTapSound() {
    // Don't play sounds when off screen
    if (!this.isOnScreen) return;

    // Check if sounds are muted
    try {
      if (typeof window !== 'undefined') {
        const muted = localStorage.getItem('soundEffectsMuted') === 'true';
        if (muted) return;
      }
    } catch (error) {
      // Silently fail if localStorage is not available
    }

    try {
      if (!this.tapAudioContext) {
        const AudioContext = window.AudioContext || window['webkitAudioContext'];
        this.tapAudioContext = new AudioContext();
      }

      if (this.tapAudioContext.state === 'suspended') {
        this.tapAudioContext.resume();
      }

      const ctx = this.tapAudioContext;
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      const startTime = ctx.currentTime;
      const duration = 0.06;

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(220, startTime);

      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.08, startTime + 0.005);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    } catch (error) {
      console.debug('SoapBubbles: Could not play tap sound', error);
    }
  }

  handleMouseMove(e) {
    if (!this.config.enableMouseInteraction && !this.config.enableMousePop) return;

    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = e.clientX - rect.left;
    this.mouse.y = e.clientY - rect.top;
  }

  handleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    if (clickX < 0 || clickX > rect.width || clickY < 0 || clickY > rect.height) {
      return;
    }

    let didPop = false;
    // Find clicked bubble and trigger pop animation (don't explode immediately)
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const shape = this.shapes[i];
      if (shape.life !== undefined) continue;
      if (shape.isPopping) continue; // Already popping

      const distance = Math.sqrt(Math.pow(shape.x - clickX, 2) + Math.pow(shape.y - clickY, 2));

      if (distance < shape.radius) {
        e.preventDefault();
        // Trigger pop animation instead of exploding immediately
        // This ensures it goes through the same path as collision-based pops
        shape.isPopping = true;
        shape.popPhase = 0;
        shape.popReason = 'pointer'; // Track pop reason
        this.triggerPopSound(shape);
        didPop = true;
        break;
      }
    }

    if (!didPop) {
      this.playTapSound();
    }
  }

  bindEvents() {
    window.addEventListener('resize', this.resizeHandler);
    // Mouse move only needed for interaction (attraction), not for popping
    if (this.config.enableMouseInteraction) {
      document.addEventListener('mousemove', this.mouseMoveHandler);
    }
    // Click handler for popping bubbles
    if (this.config.enableMousePop) {
      document.addEventListener('click', this.clickHandler);
    }

    // Handle visibility changes to pause/resume animations
    if (typeof document !== 'undefined') {
      this.visibilityHandler = () => {
        this.isVisible = !document.hidden;
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    if (typeof window !== 'undefined' && window.matchMedia) {
      try {
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        this.reduceMotionMediaQuery = mediaQuery;
        this.reduceMotionListener = () => {
          const newTarget = this.calculateAdaptiveBubbleCount();
          if (newTarget !== this.dynamicBubbleCount) {
            this.dynamicBubbleCount = newTarget;
            this.populationDirty = true;
          }
        };

        if (mediaQuery.addEventListener) {
          mediaQuery.addEventListener('change', this.reduceMotionListener);
        }
      } catch (_) {
        this.reduceMotionMediaQuery = null;
        this.reduceMotionListener = null;
      }
    }
  }

  unbindEvents() {
    window.removeEventListener('resize', this.resizeHandler);
    document.removeEventListener('mousemove', this.mouseMoveHandler);
    document.removeEventListener('click', this.clickHandler);

    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }

    if (this.reduceMotionMediaQuery && this.reduceMotionListener) {
      if (this.reduceMotionMediaQuery.removeEventListener) {
        this.reduceMotionMediaQuery.removeEventListener('change', this.reduceMotionListener);
      }
    }
    this.reduceMotionMediaQuery = null;
    this.reduceMotionListener = null;
  }

  explodeShape(shape, index) {
    // Increment pop counters based on pop reason
    if (shape.popReason === 'laser') {
      this.laserPopCount++;
    } else if (shape.popReason === 'pointer') {
      this.pointerPopCount++;
    }
    // Note: 'collision' pops (with elements) are not counted

    // Create explosion particles (lighter burst when requested)
    const particleCount = shape.lightExplosion ? 8 : 12;
    // Limit total particles to prevent memory issues
    const currentParticles = this.shapes.filter((s) => s.life !== undefined).length;
    const maxParticles = 100; // Maximum particles allowed
    const actualParticleCount = Math.min(particleCount, maxParticles - currentParticles);

    for (let i = 0; i < actualParticleCount; i++) {
      const angle = (i / actualParticleCount) * Math.PI * 2;
      const distance = 60 + Math.random() * 40;
      const particle = {
        x: shape.x,
        y: shape.y,
        vx: Math.cos(angle) * (distance / 20),
        vy: Math.sin(angle) * (distance / 20),
        radius: 3,
        mass: 3,
        color: shape.color,
        originalColor: shape.color,
        hoverColor: shape.color,
        isHovered: false,
        pulse: 0,
        pulseSpeed: 0,
        id: Date.now() + i,
        life: shape.lightExplosion ? 40 : 60,
        size: 3,
      };
      this.shapes.push(particle);
    }

    // Remove the exploded shape by index (safer during iteration)
    if (index !== undefined && index >= 0 && index < this.shapes.length) {
      this.shapes.splice(index, 1);
    } else {
      // Fallback: find and remove by id
      const shapeIndex = this.shapes.findIndex((s) => s.id === shape.id);
      if (shapeIndex >= 0) {
        this.shapes.splice(shapeIndex, 1);
      }
    }

    // Schedule new shape creation
    const timeoutId = setTimeout(() => {
      if (!this.isDestroyed) {
        this.createNewShape();
      }
      // Remove timeout from pending list after it executes
      const timeoutIndex = this.pendingTimeouts.indexOf(timeoutId);
      if (timeoutIndex >= 0) {
        this.pendingTimeouts.splice(timeoutIndex, 1);
      }
    }, 1000);

    // Clean up old timeouts if we have too many
    if (this.pendingTimeouts.length >= this.maxPendingTimeouts) {
      const oldTimeout = this.pendingTimeouts.shift();
      clearTimeout(oldTimeout);
    }
    this.pendingTimeouts.push(timeoutId);
  }

  isPositionSafe(x, y, radius) {
    if (this.config.collisionSelectors.length === 0) return true;

    const canvasRect = this.canvas.getBoundingClientRect();
    const minDistance = radius + 20;

    // eslint-disable-next-line no-restricted-syntax
    for (const selector of this.config.collisionSelectors) {
      const element = document.querySelector(selector);
      if (!element) continue;

      const rect = element.getBoundingClientRect();
      const elementLeft = rect.left - canvasRect.left;
      const elementRight = rect.right - canvasRect.left;
      const elementTop = rect.top - canvasRect.top;
      const elementBottom = rect.bottom - canvasRect.top;
      const elementCenterX = (elementLeft + elementRight) / 2;
      const elementCenterY = (elementTop + elementBottom) / 2;

      const distanceToElement = Math.sqrt(
        Math.pow(x - elementCenterX, 2) + Math.pow(y - elementCenterY, 2),
      );

      const expandedWidth = (elementRight - elementLeft) / 2 + minDistance;
      const expandedHeight = (elementBottom - elementTop) / 2 + minDistance;

      if (distanceToElement < Math.max(expandedWidth, expandedHeight)) {
        return false;
      }
    }

    return true;
  }

  createNewShape(force = false) {
    if (this.isDestroyed) return;
    if (!force && this.getLiveBubbleCount() >= this.dynamicBubbleCount) {
      return;
    }
    const colorSets = this.getDefaultColorSets();
    const randomColors = colorSets[Math.floor(Math.random() * colorSets.length)];
    let radius =
      Math.random() * (this.config.maxRadius - this.config.minRadius) + this.config.minRadius;

    // Every 5th creation, make it match the largest normal bubble
    this.spawnCount += 1;
    const isSpecial = this.spawnCount % 5 === 0;
    if (isSpecial) {
      const baseline = this.maxNormalRadius || radius;
      radius = Math.max(radius, baseline);
    } else {
      this.maxNormalRadius = Math.max(this.maxNormalRadius, radius);
    }

    const spawn = this.getEdgeSpawn(radius);
    const x = spawn.x;
    const y = spawn.y;
    const vx = spawn.vx;
    const vy = spawn.vy;

    const newShape = {
      x: x,
      y: y,
      vx: vx,
      vy: vy,
      radius: radius,
      mass: radius,
      color: randomColors[0],
      colors: randomColors,
      originalColor: randomColors[0],
      hoverColor: this.lightenColor(randomColors[0], 0.3),
      isHovered: false,
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: Math.random() * 0.02 + 0.01,
      id: Date.now(),
      wobblePhase: Math.random() * Math.PI * 2,
      wobbleSpeed: Math.random() * 0.03 + 0.02,
      distortionSeed: Math.random() * 1000,
      reflectionAngle: Math.random() * Math.PI * 2,
      isPopping: false,
      popPhase: 0,
      hasTriggeredSound: false,
    };

    this.shapes.push(newShape);
  }

  startPhysics() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.physicsLoop();
  }

  pause() {
    this.isOnScreen = false;
  }

  resume() {
    this.isOnScreen = true;
  }

  physicsLoop() {
    if (!this.isRunning || this.isDestroyed) return;

    try {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const delta = this.lastFrameTime !== null ? now - this.lastFrameTime : 16;
      this.lastFrameTime = now;

      // Only update if visible (tab is active) and on screen
      if (this.isVisible && this.isOnScreen) {
        this.updatePhysics();
        this.drawShapes();
        this.recordPerformanceSample(delta);
        this.syncBubblePopulation();
      } else {
        // When tab is inactive or off screen, still clean up dead particles to prevent memory leaks
        this.cleanupDeadParticles();
      }

      this.animationFrameId = requestAnimationFrame(() => this.physicsLoop());
    } catch (error) {
      console.error('SoapBubbles: Error in physics loop:', error);
      // Continue the loop even if there's an error to prevent it from stopping
      this.animationFrameId = requestAnimationFrame(() => this.physicsLoop());
    }
  }

  cleanupDeadParticles() {
    // Remove dead particles when tab is inactive
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const shape = this.shapes[i];
      if (shape.life !== undefined && shape.life <= 0) {
        this.shapes.splice(i, 1);
      }
    }
  }

  /**
   * Get pop statistics
   * @returns {{laserPops: number, pointerPops: number, totalPops: number}}
   */
  getPopStats() {
    return {
      laserPops: this.laserPopCount,
      pointerPops: this.pointerPopCount,
      totalPops: this.laserPopCount + this.pointerPopCount,
    };
  }

  /**
   * Reset pop counters
   * @returns {void}
   */
  resetPopCounters() {
    this.laserPopCount = 0;
    this.pointerPopCount = 0;
  }

  destroy() {
    if (!this.initialized) return;

    this.isDestroyed = true;
    this.isRunning = false;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.pendingTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
    this.pendingTimeouts = [];

    if (this.unbindEvents) {
      this.unbindEvents();
    }

    this.shapes = [];
    this.spawnCount = 0;

    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    if (this.tapAudioContext && this.tapAudioContext.state !== 'closed') {
      this.tapAudioContext.close().catch(() => {});
      this.tapAudioContext = null;
    }
  }

  checkCollisionWithElements(shape) {
    if (this.config.collisionSelectors.length === 0) return false;

    // Disable collisions on screens smaller than desktop (1024px)
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      return false;
    }

    const canvasRect = this.canvas.getBoundingClientRect();

    const padding = Math.max(3, shape.radius * 0.15);
    for (const selector of this.config.collisionSelectors) {
      const element = document.querySelector(selector);
      if (!element) continue;

      const clientRects = element.getClientRects();
      const rectArray = clientRects.length
        ? Array.from(clientRects)
        : [element.getBoundingClientRect()];

      for (const rect of rectArray) {
        const elementLeft = rect.left - canvasRect.left - padding;
        const elementRight = rect.right - canvasRect.left + padding;
        const elementTop = rect.top - canvasRect.top - padding;
        const elementBottom = rect.bottom - canvasRect.top + padding;

        const bubbleLeft = shape.x - shape.radius;
        const bubbleRight = shape.x + shape.radius;
        const bubbleTop = shape.y - shape.radius;
        const bubbleBottom = shape.y + shape.radius;

        const horizontalOverlap = bubbleRight >= elementLeft && bubbleLeft <= elementRight;
        const verticalOverlap = bubbleBottom >= elementTop && bubbleTop <= elementBottom;

        if (horizontalOverlap && verticalOverlap) {
          const closestX = Math.max(elementLeft, Math.min(shape.x, elementRight));
          const closestY = Math.max(elementTop, Math.min(shape.y, elementBottom));
          const distance = Math.sqrt(
            Math.pow(shape.x - closestX, 2) + Math.pow(shape.y - closestY, 2),
          );
          if (distance <= shape.radius + padding) {
            return true;
          }
        }
      }
    }

    return false;
  }

  checkCollisionWithMouse(shape) {
    if (!this.config.enableMousePop) return false;

    const dx = this.mouse.x - shape.x;
    const dy = this.mouse.y - shape.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance <= shape.radius;
  }

  updatePhysics() {
    if (this.isDestroyed) return;
    const screenWidth = this.canvas.width;
    const screenHeight = this.canvas.height;
    const activeLaser = (typeof window !== 'undefined' && window.activeLaserSegment) || null;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const isLaserActive =
      activeLaser && (activeLaser.expires === undefined || now <= activeLaser.expires);

    // Limit shapes array size to prevent memory issues (safety check)
    const maxShapes = 200;
    if (this.shapes.length > maxShapes) {
      // Remove oldest particles first
      const particlesToRemove = this.shapes.length - maxShapes;
      for (let r = 0; r < particlesToRemove; r++) {
        const particleIndex = this.shapes.findIndex((s) => s.life !== undefined);
        if (particleIndex >= 0) {
          this.shapes.splice(particleIndex, 1);
        } else {
          break;
        }
      }
    }

    // Iterate backwards to safely remove items during iteration
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const shape = this.shapes[i];
      if (shape.forcePop) {
        // Ensure popReason is set for forcePop bubbles
        if (!shape.popReason) {
          shape.popReason = 'laser';
        }
        shape.isPopping = true;
        shape.popPhase = 0;
        shape.forcePop = false;
      }

      // Handle explosion particles
      if (shape.life !== undefined) {
        shape.life--;
        shape.x += shape.vx;
        shape.y += shape.vy;
        shape.vx *= 0.98;
        shape.vy *= 0.98;

        // Also check if particle is way off screen and remove it early
        const margin = 200;
        const isOffScreen =
          shape.x < -margin ||
          shape.x > screenWidth + margin ||
          shape.y < -margin ||
          shape.y > screenHeight + margin;

        if (shape.life <= 0 || isOffScreen) {
          this.shapes.splice(i, 1);
          continue;
        }
        continue;
      }

      // Handle forcePop (laser hits) - explode immediately
      if (shape.forcePop && !shape.isPopping) {
        // Ensure popReason is set if not already
        if (!shape.popReason) {
          shape.popReason = 'laser';
        }
        this.explodeShape(shape, i);
        continue;
      }

      // Handle pop animation
      if (shape.isPopping) {
        shape.popPhase = (shape.popPhase || 0) + 0.15;
        if (shape.popPhase >= 1) {
          // Explode immediately - particles added to end won't affect reverse iteration
          this.explodeShape(shape, i);
          continue;
        }
      }

      // Laser collision: pop if segment intersects
      if (isLaserActive && !shape.isPopping && !shape.forcePop) {
        const hit = this.segmentCircleHit(activeLaser.start, activeLaser.end, {
          x: shape.x,
          y: shape.y,
          r: (shape.radius || 0) + LASER_COLLISION_PADDING_PX,
        });
        if (hit) {
          shape.forcePop = true;
          shape.lightExplosion = true;
          shape.popReason = 'laser'; // Track pop reason
          this.triggerPopSound(shape);
          continue;
        }
      }

      // Note: Mouse collision popping removed - bubbles only pop on click now
      // The handleClick method handles clicking to pop bubbles

      if (!shape.isPopping && this.checkCollisionWithElements(shape)) {
        shape.isPopping = true;
        shape.popPhase = 0;
        shape.popReason = 'collision'; // Track pop reason (not counted as pointer)
        this.triggerPopSound(shape);
      }

      // Update wobble
      if (shape.wobblePhase !== undefined && shape.wobbleSpeed !== undefined) {
        shape.wobblePhase += shape.wobbleSpeed;
      }

      // Update reflection based on position
      const normalizedY = shape.y / this.canvas.height;
      if (shape.reflectionAngle !== undefined) {
        shape.reflectionAngle = normalizedY * 0.3 - 0.15;
      }

      // Update position
      shape.x += shape.vx;
      shape.y += shape.vy;

      // Check if off-screen
      const margin = shape.radius * 2 + 50;
      const isFullyOffScreen =
        shape.x + shape.radius < -margin ||
        shape.x - shape.radius > screenWidth + margin ||
        shape.y + shape.radius < -margin ||
        shape.y - shape.radius > screenHeight + margin;

      if (isFullyOffScreen) {
        this.shapes.splice(i, 1);
        this.createNewShape();
        continue;
      }

      // Mouse interaction
      if (this.config.enableMouseInteraction) {
        const dx = this.mouse.x - shape.x;
        const dy = this.mouse.y - shape.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 120 && distance > shape.radius + 5) {
          const force = (120 - distance) / 120;
          shape.vx += (dx / distance) * force * 0.0002;
          shape.vy += (dy / distance) * force * 0.0002;
        }

        shape.isHovered = distance < shape.radius;
      }

      // Update pulse
      shape.pulse += shape.pulseSpeed;
    }

    // Backfill any skipped spawns once laser is gone
    const shortage = Math.max(this.dynamicBubbleCount - this.getLiveBubbleCount(), 0);
    if (shortage > 0) {
      const toSpawn = Math.min(shortage, 3);
      for (let s = 0; s < toSpawn; s++) {
        this.createNewShape(true);
      }
    }
  }

  segmentCircleHit(a, b, circle) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = circle.x - a.x;
    const apy = circle.y - a.y;
    const abLenSq = abx * abx + aby * aby || 1;
    let t = (apx * abx + apy * aby) / abLenSq;
    t = Math.max(0, Math.min(1, t));
    const closestX = a.x + abx * t;
    const closestY = a.y + aby * t;
    const dx = circle.x - closestX;
    const dy = circle.y - closestY;
    return dx * dx + dy * dy <= circle.r * circle.r;
  }

  generateWobblyPath(shape) {
    const path = new Path2D();
    const baseRadius = shape.radius;
    const pulseSize = baseRadius + Math.sin(shape.pulse) * 0.5;
    path.arc(shape.x, shape.y, pulseSize, 0, Math.PI * 2);
    path.closePath();
    return path;
  }

  drawShapes() {
    if (!this.ctx || !this.canvas) return;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.shapes.length === 0) return;

    for (const shape of this.shapes) {
      if (shape.life !== undefined) {
        this.ctx.save();
        this.ctx.globalAlpha = shape.life / 60;
        this.ctx.fillStyle = shape.color;
        this.ctx.beginPath();
        this.ctx.arc(shape.x, shape.y, shape.size || 3, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.restore();
        continue;
      }

      if (shape.isPopping && (shape.popPhase || 0) >= 1) {
        continue;
      }

      this.ctx.save();

      const bubblePath = this.generateWobblyPath(shape);
      const baseRadius = shape.radius;
      const pulseSize = baseRadius + Math.sin(shape.pulse) * 0.5;
      const popPhase = shape.isPopping ? shape.popPhase || 0 : 0;
      const bubbleAlpha = 1 - popPhase;

      if (shape.colors && shape.colors.length >= 3) {
        const mainGradient = this.ctx.createRadialGradient(
          shape.x - pulseSize * 0.35,
          shape.y - pulseSize * 0.35,
          0,
          shape.x,
          shape.y,
          pulseSize,
        );
        mainGradient.addColorStop(0, `rgba(255, 255, 255, ${0.02 * bubbleAlpha})`);
        mainGradient.addColorStop(0.7, this.adjustAlpha(shape.colors[0], bubbleAlpha));
        mainGradient.addColorStop(0.85, this.adjustAlpha(shape.colors[1], bubbleAlpha));
        mainGradient.addColorStop(1, this.adjustAlpha(shape.colors[2], bubbleAlpha));

        this.ctx.fillStyle = mainGradient;
        this.ctx.fill(bubblePath);
      }

      const reflectionOffset = shape.reflectionAngle || 0;
      const reflectionX = shape.x + reflectionOffset * pulseSize * 0.2;
      const reflectionY = shape.y - pulseSize * 0.3 + reflectionOffset * pulseSize * 0.1;
      const primaryReflection = this.ctx.createRadialGradient(
        reflectionX,
        reflectionY,
        0,
        reflectionX,
        reflectionY,
        pulseSize * 0.4,
      );
      primaryReflection.addColorStop(0, `rgba(255, 255, 255, ${0.95 * bubbleAlpha})`);
      primaryReflection.addColorStop(0.25, `rgba(255, 255, 255, ${0.7 * bubbleAlpha})`);
      primaryReflection.addColorStop(0.5, `rgba(255, 255, 255, ${0.3 * bubbleAlpha})`);
      primaryReflection.addColorStop(0.75, `rgba(255, 255, 255, ${0.1 * bubbleAlpha})`);
      primaryReflection.addColorStop(1, 'rgba(255, 255, 255, 0)');
      this.ctx.fillStyle = primaryReflection;
      this.ctx.fill(bubblePath);

      const secondaryX = shape.x + reflectionOffset * pulseSize * 0.15;
      const secondaryY = shape.y - pulseSize * 0.15 + reflectionOffset * pulseSize * 0.08;
      const secondaryReflection = this.ctx.createRadialGradient(
        secondaryX,
        secondaryY,
        0,
        secondaryX,
        secondaryY,
        pulseSize * 0.25,
      );
      secondaryReflection.addColorStop(0, `rgba(255, 255, 255, ${0.6 * bubbleAlpha})`);
      secondaryReflection.addColorStop(0.5, `rgba(255, 255, 255, ${0.2 * bubbleAlpha})`);
      secondaryReflection.addColorStop(1, 'rgba(255, 255, 255, 0)');
      this.ctx.fillStyle = secondaryReflection;
      this.ctx.fill(bubblePath);

      this.ctx.shadowBlur = 10;
      this.ctx.shadowColor = `rgba(255, 255, 255, ${0.35 * bubbleAlpha})`;
      this.ctx.shadowOffsetX = 0;
      this.ctx.shadowOffsetY = 0;
      this.ctx.strokeStyle = `rgba(255, 255, 255, ${0.25 * bubbleAlpha})`;
      this.ctx.lineWidth = 0.5;
      this.ctx.stroke(bubblePath);

      this.ctx.shadowBlur = 0;
      this.ctx.shadowColor = 'transparent';

      this.ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 * bubbleAlpha})`;
      this.ctx.lineWidth = 0.3;
      this.ctx.stroke(bubblePath);

      if (shape.isPopping && popPhase > 0) {
        const particleCount = Math.floor(popPhase * 15);
        for (let i = 0; i < particleCount; i++) {
          const angle = (i / 15) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
          const dist = pulseSize * (0.3 + popPhase * 1.2);
          const px = shape.x + Math.cos(angle) * dist;
          const py = shape.y + Math.sin(angle) * dist;
          const particleSize = 2 + Math.random() * 3;
          const distanceFactor = Math.min(1, dist / (pulseSize * 1.5));
          const particleAlpha = (1 - distanceFactor * 0.7) * (1 - popPhase * 0.3);
          const particleColor = shape.colors ? shape.colors[i % shape.colors.length] : shape.color;
          this.ctx.fillStyle = this.adjustAlpha(particleColor, particleAlpha);
          this.ctx.beginPath();
          this.ctx.arc(px, py, particleSize, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }

      this.ctx.restore();
    }
  }

  adjustAlpha(color, alpha) {
    const match = color.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    if (match) {
      const r = match[1];
      const g = match[2];
      const b = match[3];
      const originalAlpha = parseFloat(match[4]);
      return `rgba(${r}, ${g}, ${b}, ${originalAlpha * alpha})`;
    }
    return color;
  }
}
