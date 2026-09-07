// Optional self-hosted Google Analytics (#131). Off by default everywhere --
// only fires when window.__ENV__.GA_MEASUREMENT_ID is present, which in a
// real deployment is written by a docker-entrypoint.d script from the
// GA_MEASUREMENT_ID env var (see env-config.js, generated at container
// startup). Local dev / tests never populate window.__ENV__, so this is a
// silent no-op there. Runs on both index.html and guide.html, which is why
// it self-invokes on load instead of being wired through DebtTrackerApp --
// guide.html has no app instance to call it with.
export function initGoogleAnalytics() {
    const measurementId = window.__ENV__ && window.__ENV__.GA_MEASUREMENT_ID;
    if (!measurementId) return;

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
        window.dataLayer.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', measurementId);
}

initGoogleAnalytics();
