// slider.js
export function setupSlider(tabs, sliderEl, slidesContainer) {
    let currentSlideIndex = 0;

    function setSlide(index) {
        currentSlideIndex = index;
        slidesContainer.style.transform = `translateX(-${index * 100}%)`;
        tabs.forEach((t, i) => t.classList.toggle("active", i === index));
    }

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            setSlide(parseInt(tab.dataset.index, 10));
        });
    });

    let touchStartX = 0;
    let touchEndX = 0;
    let isSwiping = false;
    const SWIPE_THRESHOLD = 50;

    sliderEl.addEventListener(
        "touchstart",
        e => {
            isSwiping = true;
            touchStartX = touchEndX = e.touches[0].clientX;
        },
        { passive: true }
    );

    sliderEl.addEventListener(
        "touchmove",
        e => {
            if (isSwiping) touchEndX = e.touches[0].clientX;
        },
        { passive: true }
    );

    sliderEl.addEventListener("touchend", () => {
        if (!isSwiping) return;
        isSwiping = false;

        const delta = touchEndX - touchStartX;

        if (delta > SWIPE_THRESHOLD) {
            setSlide(Math.max(0, currentSlideIndex - 1));
        } else if (delta < -SWIPE_THRESHOLD) {
            setSlide(Math.min(tabs.length - 1, currentSlideIndex + 1));
        }
    });

    return { setSlide };
}
