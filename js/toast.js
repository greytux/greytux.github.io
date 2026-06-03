// toast.js — notificaciones in-app (sustituyen a alert/confirm)

let containerEl = null;

function ensureContainer() {
    if (containerEl) return containerEl;
    containerEl = document.getElementById("toast-container");
    if (!containerEl) {
        containerEl = document.createElement("div");
        containerEl.id = "toast-container";
        document.body.appendChild(containerEl);
    }
    return containerEl;
}

export function toast(message, options = {}) {
    const {
        type = "info",
        duration = 3500,
        sticky = false,   // si true, no se cierra solo (hay que tocarlo)
        onClick = null    // callback al tocar el toast (además de cerrarlo)
    } = options;
    const c = ensureContainer();

    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    if (onClick) el.classList.add("toast-action");
    el.setAttribute("role", type === "error" ? "alert" : "status");
    el.textContent = message;
    c.appendChild(el);

    // Activar transición en el siguiente frame
    requestAnimationFrame(() => el.classList.add("toast-visible"));

    let timer = null;
    const dismiss = () => {
        if (timer) clearTimeout(timer);
        el.classList.remove("toast-visible");
        setTimeout(() => el.remove(), 200);
    };

    if (!sticky) {
        timer = setTimeout(dismiss, duration);
    }

    el.addEventListener("click", () => {
        if (onClick) {
            try { onClick(); } catch (e) { console.warn("toast onClick error", e); }
        }
        dismiss();
    });

    return dismiss;
}

export function confirmDialog(message, options = {}) {
    const {
        okText = "Aceptar",
        cancelText = "Cancelar",
        danger = false
    } = options;

    return new Promise(resolve => {
        const overlay = document.createElement("div");
        overlay.className = "confirm-overlay";
        overlay.innerHTML = `
            <div class="confirm-dialog" role="dialog" aria-modal="true">
                <div class="confirm-message"></div>
                <div class="confirm-actions">
                    <button type="button" class="confirm-btn confirm-cancel"></button>
                    <button type="button" class="confirm-btn confirm-ok${danger ? " confirm-danger" : ""}"></button>
                </div>
            </div>
        `;

        overlay.querySelector(".confirm-message").textContent = message;
        const cancelBtn = overlay.querySelector(".confirm-cancel");
        const okBtn = overlay.querySelector(".confirm-ok");
        cancelBtn.textContent = cancelText;
        okBtn.textContent = okText;

        const close = (val) => {
            document.removeEventListener("keydown", onKey);
            overlay.classList.remove("confirm-visible");
            setTimeout(() => overlay.remove(), 180);
            resolve(val);
        };

        const onKey = (e) => {
            if (e.key === "Escape") close(false);
            else if (e.key === "Enter") close(true);
        };

        cancelBtn.addEventListener("click", () => close(false));
        okBtn.addEventListener("click", () => close(true));
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) close(false);
        });
        document.addEventListener("keydown", onKey);

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add("confirm-visible"));
        setTimeout(() => okBtn.focus(), 0);
    });
}
