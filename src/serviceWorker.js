// Service worker registration + update-prompt wiring. Feature-detected so
// unsupported browsers (or serviceWorker stubbed as undefined in tests) are
// a silent no-op -- the app never depends on this being present.
export function registerServiceWorker(app) {
    if (!navigator.serviceWorker) return;

    navigator.serviceWorker.register('/sw.js').then((registration) => {
        registration.addEventListener('updatefound', () => {
            const installingWorker = registration.installing;
            if (!installingWorker) return;
            installingWorker.addEventListener('statechange', () => {
                if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    app.showUpdateAvailableBanner(registration.waiting || installingWorker);
                }
            });
        });
    }).catch((err) => {
        console.error('[sw] registration failed', err);
    });

    let hasReloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hasReloaded) return;
        hasReloaded = true;
        window.location.reload();
    });
}
