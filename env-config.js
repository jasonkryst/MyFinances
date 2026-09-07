// Placeholder for local dev and non-Docker static hosting (GitHub Pages, plain
// `python -m http.server`, etc.) -- analytics stays off since GA_MEASUREMENT_ID
// is absent. In the Docker image, nginx.conf's `location = /env-config.js`
// block aliases this URL straight to a file regenerated at container startup
// from the GA_MEASUREMENT_ID env var (docker-entrypoint.d/40-ga-env-config.sh),
// so this committed file is never actually served there.
window.__ENV__ = window.__ENV__ || {};
