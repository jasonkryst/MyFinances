(function () {
    document.addEventListener('DOMContentLoaded', function () {
        initTocDropdown();
        initBackToTop();
    });

    function prefersReducedMotion() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function initTocDropdown() {
        var toggle = document.getElementById('tocToggle');
        var list = document.getElementById('tocList');
        if (!toggle || !list) return;

        function isOpen() {
            return list.classList.contains('toc-list--open');
        }

        function close(returnFocus) {
            list.classList.remove('toc-list--open');
            toggle.setAttribute('aria-expanded', 'false');
            if (returnFocus) toggle.focus();
        }

        function open() {
            list.classList.add('toc-list--open');
            toggle.setAttribute('aria-expanded', 'true');
            var firstLink = list.querySelector('a');
            if (firstLink) firstLink.focus();
        }

        toggle.addEventListener('click', function () {
            if (isOpen()) close(false); else open();
        });

        list.addEventListener('click', function (e) {
            if (e.target.closest('a')) close(false);
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && isOpen()) close(true);
        });

        document.addEventListener('click', function (e) {
            if (isOpen() && !e.target.closest('.toc')) close(false);
        });
    }

    function initBackToTop() {
        var btn = document.getElementById('backToTop');
        if (!btn) return;

        var SHOW_AFTER_PX = 400;

        function syncVisibility() {
            btn.classList.toggle('back-to-top--visible', window.scrollY > SHOW_AFTER_PX);
        }

        window.addEventListener('scroll', syncVisibility, { passive: true });
        syncVisibility();

        btn.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        });
    }
}());
