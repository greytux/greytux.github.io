// slider.js
// Tabs + slider (sin swipe táctil: rompía la UX, sobre todo en el mapa)
export function initSlider() {
    const tabs = document.querySelectorAll(".tab-btn");
    const slidesContainer = document.getElementById("slides");
    const sliderEl = document.querySelector(".slider");

    if (!tabs.length || !slidesContainer || !sliderEl) return;

    function setSlide(index) {
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

    // Slide inicial
    setSlide(0);
}
