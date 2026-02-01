// Laser Overlay - Draws laser beams that pop bubbles
// Summary:
// - Tuning knobs are grouped at the top; tweak numbers there to change behavior.
// - Firing rate uses 4 levels (slow -> fast), jumps up at score thresholds, and can auto-escalate if stuck.
// - Miss pattern is random per level based on misses-per-10-shots constants.

import { randomEdgePoint, extendToBoundary, segmentCircleHit } from './helpers.js';

// === Tuning: change numbers below to tweak behavior ===
// === Tuning: firing rates (slow -> fast) ===
export const LASER_INTERVAL_MS = 6000; // Base interval (Level 1)
// Keep 4 entries, ordered slow -> fast.
const LASER_RATE_LEVELS_MS = [
  LASER_INTERVAL_MS, // Level 1 (slowest)
  3000, // Level 2
  1000, // Level 3
  500, // Level 4 (fastest)
];
const LASER_RATE_MAX_LEVEL_INDEX = LASER_RATE_LEVELS_MS.length - 1;
const LASER_START_LEVEL_INDEX = 0;
const LASER_LEADING_RESET_LEVEL_INDEX = 0; // Reset to this level when laser leads
const LASER_LEVEL_STALE_MS = 10000; // Time at a level before auto-escalating
const LASER_LEAD_STEP_DOWN_MS = 10000; // Time leading before stepping down again
const LASER_LEVEL2_BEHIND_POINTS = 10;
const LASER_LEVEL3_BEHIND_POINTS = 15;
const LASER_LEVEL4_BEHIND_POINTS = 20;
const LASER_INITIAL_FIRE_DELAY_MS = 3000;
const LASER_INTERVAL_MONITOR_START_DELAY_MS = 2000;
const LASER_INTERVAL_MONITOR_PERIOD_MS = 1000;

// === Tuning: miss pattern ===
const LASER_MISS_SAMPLE_SHOTS = 10; // Misses are defined as counts per 10 shots
const LASER_MISS_FIRST_LEVEL_COUNT = 2; // First 2 levels use early miss rate
const LASER_MISS_COUNT_EARLY_LEVELS = 1; // Misses per 10 shots on levels 1-2
const LASER_MISS_COUNT_LATE_LEVELS = 2; // Misses per 10 shots on levels 3-4
const LASER_MISS_MAX_ATTEMPTS = 12; // Try this many lines to avoid bubbles
const LASER_MISS_CLEARANCE_PX = 4; // Extra padding to avoid near-misses

// === Tuning: targeting + aim nudges ===
const LASER_EDGE_PADDING_PX = 60;
const LASER_TARGET_POOL_SIZE = 6;
const LASER_DIRECTION_MIN_COMPONENT = 1;
const LASER_DIRECTION_NUDGE = 0.5;
const LASER_DIRECTION_RANDOM_THRESHOLD = 0.5;

// === Tuning: laser lifetime ===
const LASER_ACTIVE_DURATION_MS = 1300;
const LASER_ACTIVE_CLEAR_DELAY_MS = 1400;

// === Tuning: beam visuals ===
const LASER_LINE_WIDTH_PX = 2;
const LASER_SHADOW_BLUR_PX = 6;
const LASER_SHADOW_COLOR = 'rgba(255, 60, 60, 0.8)';
const LASER_GRADIENT_START = 'rgba(255, 120, 120, 0.7)';
const LASER_GRADIENT_MID_STOP = 0.5;
const LASER_GRADIENT_MID = 'rgba(255, 40, 40, 1)';
const LASER_GRADIENT_END = 'rgba(255, 120, 120, 0.7)';

// === Tuning: fade timing ===
const LASER_FADE_DELAY_MS = 200;
const LASER_FADE_DURATION_S = 0.8;
const LASER_CLEAR_DELAY_MS = 1100;

// === Tuning: laser sound ===
const LASER_SOUND_DURATION_S = 0.3;
const LASER_SOUND_START_FREQ_HZ = 3000;
const LASER_SOUND_END_FREQ_HZ = 1000;
const LASER_SOUND_ATTACK_TIME_S = 0.01;
const LASER_SOUND_ATTACK_GAIN = 0.15;
const LASER_SOUND_DECAY_TIME_S = 0.1;
const LASER_SOUND_DECAY_GAIN = 0.12;
const LASER_SOUND_SUSTAIN_TIME_S = 0.2;
const LASER_SOUND_SUSTAIN_GAIN = 0.12;
const LASER_SOUND_RELEASE_GAIN = 0.01;

// === Rendering ===
const DEFAULT_DPR = 1;
const MAX_DPR = 2;

const LASER_MISS_EVENT_NAME = 'laser:miss';

// Shared laser segment state so other systems can react
/** @type {import('./types.js').LaserSegment | null} */
let activeLaserSegment = null;

/**
 * Get the currently active laser segment
 * @returns {import('./types.js').LaserSegment | null} Active laser segment or null
 */
export function getActiveLaserSegment() {
  return activeLaserSegment;
}

/**
 * Laser Overlay - Draws laser beams that pop bubbles
 * @class
 */
export class LaserOverlay {
  /**
   * @constructor
   */
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.dpr = DEFAULT_DPR;
    this.intervalId = null;
    this.fadeTimeout = null;
    this.clearTimeout = null;
    this.resizeHandler = () => this.resize();
    this.isVisible = true;
    this.visibilityHandler = null;
    this.audioContext = null;
    this.isOnScreen = true;
    this.rateLevelsMs = LASER_RATE_LEVELS_MS;
    this.rateLevelIndex = LASER_START_LEVEL_INDEX;
    this.rateLevelStartTime = null;
    this.leadStepStartTime = null;
    this.currentInterval = LASER_RATE_LEVELS_MS[this.rateLevelIndex];
  }

  /**
   * Pause the laser overlay (stop sounds and prevent firing)
   * @returns {void}
   */
  pause() {
    this.isOnScreen = false;
    // Stop any ongoing sounds by closing audio context
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }

  /**
   * Resume the laser overlay
   * @returns {void}
   */
  resume() {
    this.isOnScreen = true;
  }

  /**
   * Play laser sound effect using Web Audio API
   * @returns {void}
   */
  playLaserSound() {
    // Don't play sound if hero is off screen
    if (!this.isOnScreen) return;

    // Check if sounds are muted
    try {
      // Import sound control utility
      if (typeof window !== 'undefined') {
        // Check localStorage for mute state
        const muted = localStorage.getItem('soundEffectsMuted') === 'true';
        if (muted) return;
      }
    } catch (error) {
      // Silently fail if localStorage is not available
    }

    try {
      // Create audio context if it doesn't exist
      if (!this.audioContext) {
        const AudioContext = window.AudioContext || window['webkitAudioContext'];
        this.audioContext = new AudioContext();
      }

      // Resume audio context if suspended (required for autoplay policies)
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      // Create oscillator for high-pitched sound
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      const duration = LASER_SOUND_DURATION_S; // Longer duration
      const startTime = this.audioContext.currentTime;

      // High-pitched frequency starts high and smoothly drops to lower pitch
      oscillator.frequency.setValueAtTime(LASER_SOUND_START_FREQ_HZ, startTime);
      // Smooth pitch drop from start to end over the entire duration
      oscillator.frequency.exponentialRampToValueAtTime(
        LASER_SOUND_END_FREQ_HZ,
        startTime + duration,
      );

      // Volume envelope: quick attack, sustain, fade out
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(
        LASER_SOUND_ATTACK_GAIN,
        startTime + LASER_SOUND_ATTACK_TIME_S,
      ); // Quick attack
      gainNode.gain.linearRampToValueAtTime(
        LASER_SOUND_DECAY_GAIN,
        startTime + LASER_SOUND_DECAY_TIME_S,
      ); // Slight decay
      gainNode.gain.setValueAtTime(
        LASER_SOUND_SUSTAIN_GAIN,
        startTime + LASER_SOUND_SUSTAIN_TIME_S,
      ); // Sustain
      gainNode.gain.exponentialRampToValueAtTime(LASER_SOUND_RELEASE_GAIN, startTime + duration); // Fade out at end

      // Use a sine wave for a clean, high-pitched tone
      oscillator.type = 'sine';

      // Play the sound
      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    } catch (error) {
      // Silently fail if audio context can't be created (e.g., autoplay restrictions)
      console.debug('LaserOverlay: Could not play laser sound', error);
    }
  }

  init() {
    const canvas = document.getElementById('heroLaser');
    if (!(canvas instanceof HTMLCanvasElement)) {
      console.warn('LaserOverlay: Canvas element "heroLaser" not found');
      return;
    }
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('LaserOverlay: Could not get 2D context from canvas');
      return;
    }
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', this.resizeHandler);

    // Handle visibility changes
    if (typeof document !== 'undefined') {
      this.visibilityHandler = () => {
        this.isVisible = !document.hidden;
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    this.startInterval();

    // Fire initial laser after a delay to ensure bubbles are ready
    // Only fire if bubbles are available at that time
    setTimeout(() => {
      if (this.isVisible && this.isOnScreen) {
        this.fire(); // fire() will return early if no bubbles are available
      }
    }, LASER_INITIAL_FIRE_DELAY_MS); // Wait for bubbles to initialize

    // Monitor pop stats and adjust interval dynamically
    this.startIntervalMonitor();
  }

  /**
   * Start the laser firing interval
   * @returns {void}
   */
  startInterval() {
    // Clear existing interval if any
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.intervalId = window.setInterval(() => {
      if (this.isVisible && this.isOnScreen) {
        this.fire();
      }
    }, this.currentInterval);
  }

  setRateLevel(levelIndex, now) {
    const clampedLevel = Math.max(0, Math.min(levelIndex, LASER_RATE_MAX_LEVEL_INDEX));
    this.rateLevelIndex = clampedLevel;
    this.currentInterval = LASER_RATE_LEVELS_MS[clampedLevel];
    this.rateLevelStartTime = now;
    this.startInterval(); // Restart interval with new timing
  }

  getMissCountForLevel(levelIndex) {
    return levelIndex < LASER_MISS_FIRST_LEVEL_COUNT
      ? LASER_MISS_COUNT_EARLY_LEVELS
      : LASER_MISS_COUNT_LATE_LEVELS;
  }

  shouldMissShot() {
    const missCount = this.getMissCountForLevel(this.rateLevelIndex);
    if (missCount <= 0) return false;
    const missChance = missCount / LASER_MISS_SAMPLE_SHOTS;
    return Math.random() < missChance;
  }

  emitMissEvent() {
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(new CustomEvent(LASER_MISS_EVENT_NAME));
    } catch (error) {
      console.debug('LaserOverlay: Could not dispatch miss event', error);
    }
  }

  findSafeMissEnd(start, width, height, bubbles) {
    const hasBubbles = Array.isArray(bubbles) && bubbles.length > 0;
    for (let attempt = 0; attempt < LASER_MISS_MAX_ATTEMPTS; attempt += 1) {
      const missPoint = { x: Math.random() * width, y: Math.random() * height };
      let missDir = { x: missPoint.x - start.x, y: missPoint.y - start.y };
      missDir = this.adjustDirection(missDir);
      const end = extendToBoundary(start, missDir, width, height, LASER_EDGE_PADDING_PX);
      if (!hasBubbles) return end;

      let hit = false;
      for (const b of bubbles) {
        const radius = (b?.radius || 0) + LASER_MISS_CLEARANCE_PX;
        if (segmentCircleHit(start, end, { x: b.x, y: b.y, r: radius })) {
          hit = true;
          break;
        }
      }
      if (!hit) return end;
    }
    return null;
  }

  getScoreLevel(pointDifference) {
    if (pointDifference >= LASER_LEVEL4_BEHIND_POINTS) return 3;
    if (pointDifference >= LASER_LEVEL3_BEHIND_POINTS) return 2;
    if (pointDifference >= LASER_LEVEL2_BEHIND_POINTS) return 1;
    return 0;
  }

  adjustDirection(dir) {
    if (Math.abs(dir.x) < LASER_DIRECTION_MIN_COMPONENT) {
      dir.x += (Math.random() > LASER_DIRECTION_RANDOM_THRESHOLD ? 1 : -1) * LASER_DIRECTION_NUDGE;
    }
    if (Math.abs(dir.y) < LASER_DIRECTION_MIN_COMPONENT) {
      dir.y += (Math.random() > LASER_DIRECTION_RANDOM_THRESHOLD ? 1 : -1) * LASER_DIRECTION_NUDGE;
    }
    return dir;
  }

  /**
   * Monitor pop stats and adjust laser interval based on player performance
   * Escalate based on score difference, and auto-escalate if stuck at a level.
   * @returns {void}
   */
  startIntervalMonitor() {
    const checkAndUpdateInterval = () => {
      const bubbles = window?.soapBubbles_floatingShapesCanvas;
      if (bubbles && typeof bubbles.getPopStats === 'function') {
        const stats = bubbles.getPopStats();
        const playerScore = stats.pointerPops;
        const laserScore = stats.laserPops;
        const now = performance.now();

        const laserLeading = laserScore > playerScore;
        const pointDifference = Math.max(0, playerScore - laserScore);
        const targetLevel = this.getScoreLevel(pointDifference);

        if (laserLeading) {
          if (this.leadStepStartTime === null) {
            this.leadStepStartTime = now;
            if (this.rateLevelIndex > LASER_LEADING_RESET_LEVEL_INDEX) {
              const previousLevel = this.rateLevelIndex;
              const nextLevel = this.rateLevelIndex - 1;
              this.setRateLevel(nextLevel, now);
              console.log(
                `Laser leading (${laserScore} > ${playerScore}) Stepping down from Level ${
                  previousLevel + 1
                } to Level ${nextLevel + 1} (${this.currentInterval}ms)`,
              );
            }
          } else {
            const leadElapsed = now - this.leadStepStartTime;
            if (
              leadElapsed >= LASER_LEAD_STEP_DOWN_MS &&
              this.rateLevelIndex > LASER_LEADING_RESET_LEVEL_INDEX
            ) {
              const previousLevel = this.rateLevelIndex;
              const nextLevel = this.rateLevelIndex - 1;
              this.setRateLevel(nextLevel, now);
              this.leadStepStartTime = now;
              console.log(
                `Laser still leading after ${LASER_LEAD_STEP_DOWN_MS}ms, stepping down from Level ${
                  previousLevel + 1
                } to Level ${nextLevel + 1} (${this.currentInterval}ms)`,
              );
            }
          }
          this.rateLevelStartTime = null;
        } else {
          this.leadStepStartTime = null;
          if (targetLevel > this.rateLevelIndex) {
            const previousLevel = this.rateLevelIndex;
            this.setRateLevel(targetLevel, now);
            console.log(
              `Laser behind by ${pointDifference} points, jumping from Level ${
                previousLevel + 1
              } to Level ${targetLevel + 1} (${this.currentInterval}ms)`,
            );
          } else {
            if (this.rateLevelStartTime === null) {
              this.rateLevelStartTime = now;
            }

            const elapsed = now - this.rateLevelStartTime;
            if (elapsed >= LASER_LEVEL_STALE_MS) {
              if (this.rateLevelIndex < LASER_RATE_MAX_LEVEL_INDEX) {
                const currentLevel = this.rateLevelIndex;
                const nextLevel = this.rateLevelIndex + 1;
                this.setRateLevel(nextLevel, now);
                console.log(
                  `Laser stuck at Level ${
                    currentLevel + 1
                  } for ${LASER_LEVEL_STALE_MS}ms, escalating to Level ${
                    nextLevel + 1
                  } (${this.currentInterval}ms)`,
                );
              } else {
                this.rateLevelStartTime = now;
              }
            }
          }
        }
      }

      // Check every second
      setTimeout(checkAndUpdateInterval, LASER_INTERVAL_MONITOR_PERIOD_MS);
    };

    // Start monitoring after a delay to ensure bubbles are initialized
    setTimeout(checkAndUpdateInterval, LASER_INTERVAL_MONITOR_START_DELAY_MS);
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || DEFAULT_DPR, MAX_DPR);
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  fire() {
    if (!this.canvas || !this.ctx) return;
    if (!this.isOnScreen) return;

    const width = this.canvas.width / this.dpr || this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.height / this.dpr || this.canvas.clientHeight || window.innerHeight;

    const soap = window?.soapBubbles_floatingShapesCanvas;
    if (!soap) return;

    const mainBubbles =
      soap?.shapes?.filter(
        (s) =>
          s &&
          !s.isPopping &&
          s.life === undefined &&
          Number.isFinite(s.radius) &&
          // Only consider bubbles fully on-screen
          s.x - s.radius >= 0 &&
          s.x + s.radius <= width &&
          s.y - s.radius >= 0 &&
          s.y + s.radius <= height,
      ) || [];

    // Only fire if there are bubbles fully on screen at this time
    // If no bubbles are available, skip this firing and wait for next interval
    if (!mainBubbles.length) {
      return;
    }

    const shouldMiss = this.shouldMissShot();
    const start = randomEdgePoint(width, height, LASER_EDGE_PADDING_PX);

    if (shouldMiss) {
      const missEnd = this.findSafeMissEnd(start, width, height, mainBubbles);
      if (!missEnd) return;
      this.playLaserSound();
      this.drawLaser(start, missEnd);
      this.emitMissEvent();
      return;
    }

    // largest of top pool
    const ranked = [...mainBubbles]
      .filter(
        (b) =>
          b.x >= -b.radius &&
          b.x <= width + b.radius &&
          b.y >= -b.radius &&
          b.y <= height + b.radius,
      )
      .sort((a, b) => b.radius - a.radius)
      .slice(0, LASER_TARGET_POOL_SIZE);
    const target = ranked[0];
    if (!target) {
      const missEnd = this.findSafeMissEnd(start, width, height, mainBubbles);
      if (!missEnd) return;
      this.playLaserSound();
      this.drawLaser(start, missEnd);
      this.emitMissEvent();
      return;
    }

    let dir = { x: target.x - start.x, y: target.y - start.y };
    dir = this.adjustDirection(dir);
    const end = extendToBoundary(start, dir, width, height, LASER_EDGE_PADDING_PX);

    this.playLaserSound();
    this.drawLaser(start, end);
    this.popBubbles(mainBubbles, target, start, end);

    // Sets an expiration timestamp in the future
    // Used to mark when the laser segment should no longer be considered active
    const expires = performance.now() + LASER_ACTIVE_DURATION_MS;
    activeLaserSegment = { start, end, expires };
    // Also stores it on window so other components (like SoapBubbles) can access it
    // The SoapBubbles component checks window.activeLaserSegment in its physics loop (around line 718-787) to detect if bubbles intersect the laser path
    window.activeLaserSegment = activeLaserSegment;
    // After the clear delay, clears both references
    // Clear delay is slightly longer than the active duration to ensure cleanup happens after the laser is no longer active
    setTimeout(() => {
      activeLaserSegment = null;
      window.activeLaserSegment = null;
    }, LASER_ACTIVE_CLEAR_DELAY_MS);
  }

  drawLaser(start, end) {
    if (!this.ctx || !this.canvas) return;
    this.ctx.clearRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
    const gradient = this.ctx.createLinearGradient(start.x, start.y, end.x, end.y);
    gradient.addColorStop(0, LASER_GRADIENT_START);
    gradient.addColorStop(LASER_GRADIENT_MID_STOP, LASER_GRADIENT_MID);
    gradient.addColorStop(1, LASER_GRADIENT_END);
    this.ctx.strokeStyle = gradient;
    this.ctx.lineWidth = LASER_LINE_WIDTH_PX;
    this.ctx.shadowBlur = LASER_SHADOW_BLUR_PX;
    this.ctx.shadowColor = LASER_SHADOW_COLOR;
    this.ctx.beginPath();
    this.ctx.moveTo(start.x, start.y);
    this.ctx.lineTo(end.x, end.y);
    this.ctx.stroke();

    // Make the streak visible, then fade it out
    this.canvas.style.transition = 'none';
    this.canvas.style.opacity = '1';
    // force reflow so the next transition applies
    void this.canvas.offsetWidth;
    this.canvas.style.transition = `opacity ${LASER_FADE_DURATION_S}s ease-out`; // fade duration is configurable
    if (this.fadeTimeout) clearTimeout(this.fadeTimeout);
    this.fadeTimeout = window.setTimeout(() => {
      this.canvas && (this.canvas.style.opacity = '0');
    }, LASER_FADE_DELAY_MS); // fade starts after delay (laser visible briefly)
    if (this.clearTimeout) clearTimeout(this.clearTimeout);
    this.clearTimeout = window.setTimeout(() => {
      if (this.ctx && this.canvas) {
        this.ctx.clearRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
      }
    }, LASER_CLEAR_DELAY_MS); // cleared after visible + fade + buffer
  }

  popBubbles(mainBubbles, target, start, end) {
    const hitList = [];
    mainBubbles.forEach((b) => {
      const hit = segmentCircleHit(start, end, { x: b.x, y: b.y, r: b.radius || 0 });
      if (hit || b === target) {
        b.forcePop = true;
        b.popReason = 'laser'; // Track pop reason for counter
        hitList.push(b);
      }
    });
    if (hitList.length) {
      requestAnimationFrame(() => {
        try {
          hitList.forEach((b) => {
            window.dispatchEvent(
              new CustomEvent('soapbubbles:pop', {
                detail: { id: b.id, x: b.x, y: b.y, radius: b.radius },
              }),
            );
          });
        } catch (_) {}
      });
    }
  }

  destroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.fadeTimeout) {
      clearTimeout(this.fadeTimeout);
      this.fadeTimeout = null;
    }
    if (this.clearTimeout) {
      clearTimeout(this.clearTimeout);
      this.clearTimeout = null;
    }
    window.removeEventListener('resize', this.resizeHandler);

    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }

    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    activeLaserSegment = null;
    window.activeLaserSegment = null;
  }
}
