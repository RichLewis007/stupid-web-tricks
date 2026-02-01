// Laser Overlay - Draws laser beams that pop bubbles

import { randomEdgePoint, extendToBoundary, segmentCircleHit } from './helpers.js';

export const LASER_INTERVAL_MS = 10000; // every 10 seconds

const DEFAULT_DPR = 1;
const MAX_DPR = 2;

const LASER_INITIAL_FIRE_DELAY_MS = 3000;
const LASER_INTERVAL_MONITOR_START_DELAY_MS = 2000;
const LASER_INTERVAL_MONITOR_PERIOD_MS = 1000;

const LASER_FAST_INTERVAL_MS = LASER_INTERVAL_MS / 2; // 5 seconds
const LASER_VERY_FAST_INTERVAL_MS = LASER_INTERVAL_MS / 4; // 2.5 seconds
const LASER_FAST_THRESHOLD_POINTS = 10;
const LASER_VERY_FAST_THRESHOLD_POINTS = 20;

const LASER_EDGE_PADDING_PX = 60;
const LASER_TARGET_POOL_SIZE = 6;
const LASER_DIRECTION_MIN_COMPONENT = 1;
const LASER_DIRECTION_NUDGE = 0.5;
const LASER_DIRECTION_RANDOM_THRESHOLD = 0.5;

const LASER_ACTIVE_DURATION_MS = 1300;
const LASER_ACTIVE_CLEAR_DELAY_MS = 1400;

const LASER_LINE_WIDTH_PX = 2;
const LASER_SHADOW_BLUR_PX = 6;
const LASER_SHADOW_COLOR = 'rgba(255, 60, 60, 0.8)';
const LASER_GRADIENT_START = 'rgba(255, 120, 120, 0.7)';
const LASER_GRADIENT_MID_STOP = 0.5;
const LASER_GRADIENT_MID = 'rgba(255, 40, 40, 1)';
const LASER_GRADIENT_END = 'rgba(255, 120, 120, 0.7)';

const LASER_FADE_DELAY_MS = 200;
const LASER_FADE_DURATION_S = 0.8;
const LASER_CLEAR_DELAY_MS = 1100;

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
    this.currentInterval = LASER_INTERVAL_MS;
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
      gainNode.gain.exponentialRampToValueAtTime(
        LASER_SOUND_RELEASE_GAIN,
        startTime + duration,
      ); // Fade out at end

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

  /**
   * Monitor pop stats and adjust laser interval based on player performance
   * Once the laser speeds up, it NEVER slows down until laser score >= player score
   * @returns {void}
   */
  startIntervalMonitor() {
    const checkAndUpdateInterval = () => {
      const bubbles = window?.soapBubbles_floatingShapesCanvas;
      if (bubbles && typeof bubbles.getPopStats === 'function') {
        const stats = bubbles.getPopStats();
        const playerScore = stats.pointerPops;
        const laserScore = stats.laserPops;

        let newInterval = this.currentInterval; // Default: keep current rate

        // Only reduce firing rate (slow down) when laser score >= player score
        // AND we're currently at a faster rate
        if (
          laserScore >= playerScore &&
          laserScore > 0 &&
          this.currentInterval < LASER_INTERVAL_MS
        ) {
          // Laser has caught up or is ahead - slow down to normal rate
          newInterval = LASER_INTERVAL_MS; // Normal rate (10 seconds)
          console.log(
            `Laser caught up! (${laserScore} >= ${playerScore}) Slowing down from ${this.currentInterval}ms to ${newInterval}ms`,
          );
        }
        // Speed up based on point difference (only when laser is behind)
        // IMPORTANT: Once sped up, we NEVER slow down until laserScore >= playerScore
        else if (playerScore > laserScore) {
          const pointDifference = playerScore - laserScore;
          // If laser is behind by LASER_VERY_FAST_THRESHOLD_POINTS+, use very fast rate
          // Only speed up if not already at this rate or faster (smaller interval = faster)
          if (pointDifference >= LASER_VERY_FAST_THRESHOLD_POINTS) {
            if (this.currentInterval > LASER_VERY_FAST_INTERVAL_MS) {
              newInterval = LASER_VERY_FAST_INTERVAL_MS;
              console.log(
                `Laser behind by ${pointDifference} points, speeding up to very fast rate (${newInterval}ms)`,
              );
            }
            // Already at very fast or faster, keep it
          }
          // Else if laser is behind by LASER_FAST_THRESHOLD_POINTS+, use fast rate
          // Only speed up if currently at normal rate (not already at fast or very fast)
          else if (pointDifference >= LASER_FAST_THRESHOLD_POINTS) {
            if (this.currentInterval >= LASER_INTERVAL_MS) {
              newInterval = LASER_FAST_INTERVAL_MS;
              console.log(
                `Laser behind by ${pointDifference} points, speeding up to fast rate (${newInterval}ms)`,
              );
            }
            // Already at fast or very fast, keep it (never slow down)
          }
          // If player is ahead but by less than LASER_FAST_THRESHOLD_POINTS, keep current rate
          // This ensures we NEVER slow down until laserScore >= playerScore
        }
        // If scores are equal (both 0 or same value) and laser is at normal rate, keep it

        // Only update if interval changed
        if (newInterval !== this.currentInterval) {
          this.currentInterval = newInterval;
          this.startInterval(); // Restart interval with new timing
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
    if (!target) return;

    const start = randomEdgePoint(width, height, LASER_EDGE_PADDING_PX);
    let dir = { x: target.x - start.x, y: target.y - start.y };
    if (Math.abs(dir.x) < LASER_DIRECTION_MIN_COMPONENT) {
      dir.x +=
        (Math.random() > LASER_DIRECTION_RANDOM_THRESHOLD ? 1 : -1) *
        LASER_DIRECTION_NUDGE;
    }
    if (Math.abs(dir.y) < LASER_DIRECTION_MIN_COMPONENT) {
      dir.y +=
        (Math.random() > LASER_DIRECTION_RANDOM_THRESHOLD ? 1 : -1) *
        LASER_DIRECTION_NUDGE;
    }
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
