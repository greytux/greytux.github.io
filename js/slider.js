// slider.js
// Tabs + slider + swipe táctil
export function initSlider() {
    const tabs = document.querySelectorAll(".tab-btn");
    const slidesContainer = document.getElementById("slides");
    const sliderEl = document.querySelector(".slider");

    if (!tabs.length || !slidesContainer || !sliderEl) return;

    let currentSlideIndex = 0;
    const SWIPE_THRESHOLD = 50;

    function setSlide(index) {
        currentSlideIndex = index;
        slidesContainer.style.transform = `translateX(-${index * 100}%)`;
        tabs.forEach((t, i) => {
            t.classList.toggle("active", i === index);
        });
    }

    // Click en tabs
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            const idx = parseInt(tab.dataset.index, 10);
            if (!Number.isNaN(idx)) {
                setSlide(idx);
            }
        });
    });

    // Swipe táctil
    let touchStartX = 0;
    let touchEndX = 0;
    let isSwiping = false;

    sliderEl.addEventListener("touchstart", (e) => {
        if (!e.touches || e.touches.length === 0) return;
        isSwiping = true;
        touchStartX = e.touches[0].clientX;
        touchEndX = touchStartX;
    }, { passive: true });

    sliderEl.addEventListener("touchmove", (e) => {
        if (!isSwiping || !e.touches || e.touches.length === 0) return;
        touchEndX = e.touches[0].clientX;
    }, { passive: true });

    sliderEl.addEventListener("touchend", () => {
        if (!isSwiping) return;
        isSwiping = false;

        const deltaX = touchEndX - touchStartX;

        if (deltaX > SWIPE_THRESHOLD) {
            const prev = Math.max(0, currentSlideIndex - 1);
            if (prev !== currentSlideIndex) setSlide(prev);
        }

        if (deltaX < -SWIPE_THRESHOLD) {
            const next = Math.min(tabs.length - 1, currentSlideIndex + 1);
            if (next !== currentSlideIndex) setSlide(next);
        }
    });

    // Slide inicial
    setSlide(0);
}
