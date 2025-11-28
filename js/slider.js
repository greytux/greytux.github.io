// js/slider.js
export function initSlider() {
    const tabs = document.querySelectorAll(".tab-btn");
    const slidesContainer = document.getElementById("slides");
    const sliderEl = document.querySelector(".slider");
    let currentSlideIndex = 0;
    const SWIPE_THRESHOLD = 50;
    let touchStartX = 0;
    let touchEndX = 0;
    let isSwiping = false;

    function setSlide(index) {
        currentSlideIndex = index;
        slidesContainer.style.transform = `translateX(-${index * 100}%)`;
        tabs.forEach((t, i) => t.classList.toggle("active", i === index));
        // devolvemos el índice por si main.js quiere saberlo
        return currentSlideIndex;
    }

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            const idx = parseInt(tab.dataset.index, 10);
            setSlide(idx);
        });
    });

    if (sliderEl) {
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
                setSlide(prev);
            } else if (deltaX < -SWIPE_THRESHOLD) {
                const next = Math.min(tabs.length - 1, currentSlideIndex + 1);
                setSlide(next);
            }
        });
    }

    return { getCurrentIndex: () => currentSlideIndex };
}
