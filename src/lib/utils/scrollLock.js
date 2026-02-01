/**
 * Scroll lock utility
 * Prevents scrolling when hero section is fully visible
 * Only allows scrolling via the "Explore Tricks" button
 * Works across all modern browsers including Firefox
 */

let isScrollLocked = false;
let heroSection = null;
let categoriesSection = null;
let scrollCheckInterval = null;
let eventListeners = [];
let resizeHandler = null;
let justUnlocked = false; // Flag to prevent immediate re-locking after unlock

/**
 * Initialize scroll lock
 * @returns {void}
 */
export function initScrollLock() {
  if (typeof window === 'undefined') return;

  // Wait for DOM to be ready
  const init = () => {
    heroSection = document.querySelector('.hero-section');
    categoriesSection = document.querySelector('#categories');

    if (!heroSection) {
      console.warn('ScrollLock: Hero section not found, retrying...');
      setTimeout(init, 100);
      return;
    }

    // Lock scroll initially
    lockScroll();

    // Continuously enforce scroll lock and check for auto-unlock/re-lock
    scrollCheckInterval = setInterval(() => {
      // Don't check if we just unlocked (give time for scroll to happen)
      if (justUnlocked) {
        return; // Don't clear the flag here - let the timeout in unlockScroll handle it
      }

      const scrollY =
        window.scrollY ||
        window.pageYOffset ||
        document.documentElement.scrollTop ||
        document.body.scrollTop ||
        0;
      const heroHeight = heroSection ? heroSection.offsetHeight : 0;

      if (isScrollLocked) {
        // Auto-unlock if scrolled past hero (e.g., via browser back button)
        if (scrollY > heroHeight * 0.1) {
          unlockScroll();
        } else if (scrollY > 0) {
          // Force scroll back to top if still locked
          window.scrollTo(0, 0);
          document.documentElement.scrollTop = 0;
          document.body.scrollTop = 0;
        }
      } else {
        // Re-lock if scrolled back to top (hero fully visible)
        // But only if we've been unlocked for a bit (not immediately after unlock)
        if (scrollY === 0 || scrollY < heroHeight * 0.1) {
          lockScroll();
        }
      }
    }, 16); // ~60fps

    // Prevent wheel events
    const preventWheel = (e) => {
      if (isScrollLocked) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };

    // Prevent touch scrolling
    let touchStartY = 0;
    const preventTouchStart = (e) => {
      if (isScrollLocked) {
        touchStartY = e.touches[0].clientY;
      }
    };
    const preventTouchMove = (e) => {
      if (isScrollLocked) {
        const touchY = e.touches[0].clientY;
        if (touchY < touchStartY) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      }
    };

    // Prevent keyboard scrolling
    const preventKeyDown = (e) => {
      if (isScrollLocked) {
        if (
          ['ArrowDown', 'PageDown', 'Space'].includes(e.key) ||
          (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA')
        ) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      }
    };

    // Add event listeners and store references for cleanup
    const wheelOptions = { passive: false, capture: true };
    const touchMoveOptions = { passive: false, capture: true };
    const keyDownOptions = { passive: false, capture: true };
    const touchStartOptions = { passive: true };

    document.addEventListener('wheel', preventWheel, wheelOptions);
    document.addEventListener('touchstart', preventTouchStart, touchStartOptions);
    document.addEventListener('touchmove', preventTouchMove, touchMoveOptions);
    document.addEventListener('keydown', preventKeyDown, keyDownOptions);

    // Also add to window for Firefox
    window.addEventListener('wheel', preventWheel, wheelOptions);

    // Store listeners for cleanup
    eventListeners = [
      { target: document, type: 'wheel', handler: preventWheel, options: wheelOptions },
      {
        target: document,
        type: 'touchstart',
        handler: preventTouchStart,
        options: touchStartOptions,
      },
      { target: document, type: 'touchmove', handler: preventTouchMove, options: touchMoveOptions },
      { target: document, type: 'keydown', handler: preventKeyDown, options: keyDownOptions },
      { target: window, type: 'wheel', handler: preventWheel, options: wheelOptions },
    ];

    // Handle scroll events - re-lock when scrolled back to top
    const handleScroll = () => {
      // Don't re-lock if we just unlocked
      if (justUnlocked) return;

      if (!isScrollLocked) {
        const scrollY =
          window.scrollY ||
          window.pageYOffset ||
          document.documentElement.scrollTop ||
          document.body.scrollTop ||
          0;
        const heroHeight = heroSection ? heroSection.offsetHeight : 0;

        // Re-lock if scrolled back to top (hero fully visible)
        if (scrollY === 0 || scrollY < heroHeight * 0.1) {
          lockScroll();
        }
      }
    };

    // Handle window resize - re-check scroll position
    resizeHandler = () => {
      if (!isScrollLocked) {
        // Check if we should lock again (e.g., if user scrolled back to top)
        const scrollY =
          window.scrollY ||
          window.pageYOffset ||
          document.documentElement.scrollTop ||
          document.body.scrollTop ||
          0;
        const heroHeight = heroSection ? heroSection.offsetHeight : 0;

        if (scrollY === 0 || scrollY < heroHeight * 0.1) {
          lockScroll();
        }
      }
    };

    // Add scroll listener to re-lock when scrolled back to top
    window.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', resizeHandler);

    // Store scroll handler for cleanup
    eventListeners.push(
      { target: window, type: 'scroll', handler: handleScroll, options: { passive: true } },
      { target: document, type: 'scroll', handler: handleScroll, options: { passive: true } },
    );

    // The scrollCheckInterval already checks scroll position, so we can use it
    // to also auto-unlock if scrolled past hero (e.g., via browser back button)
    // This is already handled in the existing interval above
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 100);
  }
}

/**
 * Lock scroll (prevent scrolling)
 * @returns {void}
 */
export function lockScroll() {
  if (isScrollLocked) return;

  isScrollLocked = true;

  // Apply CSS lock
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
  document.documentElement.classList.add('scroll-locked');
  document.body.classList.add('scroll-locked');

  // Force scroll to top immediately
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  // Use requestAnimationFrame to ensure it sticks
  requestAnimationFrame(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  });
}

/**
 * Unlock scroll (allow normal scrolling)
 * @returns {void}
 */
export function unlockScroll() {
  if (!isScrollLocked) return;

  isScrollLocked = false;
  justUnlocked = true; // Set flag to prevent immediate re-locking

  // Remove ALL CSS lock styles completely
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
  document.documentElement.style.position = '';
  document.body.style.position = '';
  document.documentElement.style.width = '';
  document.body.style.width = '';
  document.documentElement.style.height = '';
  document.body.style.height = '';
  document.documentElement.style.top = '';
  document.body.style.top = '';
  document.documentElement.style.left = '';
  document.body.style.left = '';
  document.documentElement.classList.remove('scroll-locked');
  document.body.classList.remove('scroll-locked');

  // Clear the flag after a delay to allow scrolling
  setTimeout(() => {
    justUnlocked = false;
  }, 2000); // 2 seconds should be enough for smooth scroll to complete
}

/**
 * Scroll to categories section (unlocks scroll)
 * @returns {void}
 */
export function scrollToCategories() {
  // Unlock scroll first
  unlockScroll();

  // Re-find the categories section in case it wasn't found initially
  if (!categoriesSection) {
    categoriesSection = document.querySelector('#categories');
  }

  // Wait a bit longer for unlock to fully take effect
  setTimeout(() => {
    // Ensure we're still unlocked
    if (isScrollLocked) {
      unlockScroll();
    }

    // Force remove ALL CSS lock styles completely
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    document.documentElement.style.position = '';
    document.body.style.position = '';
    document.documentElement.style.width = '';
    document.body.style.width = '';
    document.documentElement.style.height = '';
    document.body.style.height = '';
    document.documentElement.style.top = '';
    document.body.style.top = '';
    document.documentElement.style.left = '';
    document.body.style.left = '';
    document.documentElement.classList.remove('scroll-locked');
    document.body.classList.remove('scroll-locked');

    if (categoriesSection) {
      // Scroll to the categories section
      const rect = categoriesSection.getBoundingClientRect();
      const scrollTop =
        window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
      const targetY = scrollTop + rect.top - 20; // 20px offset from top

      // Use smooth scroll
      window.scrollTo({ top: targetY, behavior: 'smooth' });

      // Fallback: if smooth scroll doesn't work after a delay, use instant scroll
      setTimeout(() => {
        const currentScroll =
          window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
        if (Math.abs(currentScroll - targetY) > 50) {
          // Smooth scroll didn't work, use instant
          window.scrollTo(0, targetY);
        }
      }, 300);
    } else {
      // Fallback: scroll down by hero height
      const heroHeight = heroSection ? heroSection.offsetHeight : window.innerHeight;
      window.scrollTo({ top: heroHeight, behavior: 'smooth' });
    }
  }, 200); // Wait 200ms for unlock to take effect
}

/**
 * Cleanup scroll lock - removes all event listeners and clears intervals
 * @returns {void}
 */
export function cleanupScrollLock() {
  // Remove all event listeners
  eventListeners.forEach(({ target, type, handler, options }) => {
    target.removeEventListener(type, handler, options);
  });
  eventListeners = [];

  // Remove resize handler
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }

  // Unlock and clear intervals
  unlockScroll();
}
