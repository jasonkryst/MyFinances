"""Measure the rendered WCAG contrast of an element's text (shared by UI tests).

The effective background is found by walking up from the element and
compositing every translucent `background-color` until an opaque one (or the
white canvas) is reached. The text colour's own alpha and every ancestor's
`opacity` are applied to the foreground before the ratio is computed, so a
label dimmed with `opacity` is measured as the user sees it.

Background images (gradients) are ignored; measure elements that sit on a
solid colour.
"""

_CONTRAST_JS = """
(el) => {
    const parse = (s) => {
        const m = s.match(/rgba?\\(([^)]+)\\)/);
        if (!m) return [0, 0, 0, 0];
        const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);
        return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    };
    const over = (top, under) => {
        const a = top[3];
        return [0, 1, 2].map(i => top[i] * a + under[i] * (1 - a)).concat(1);
    };
    const lum = (c) => {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const layers = [];
    let opacity = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const cs = getComputedStyle(n);
        opacity *= parseFloat(cs.opacity);
        const bg = parse(cs.backgroundColor);
        if (bg[3] > 0) layers.push(bg);
        if (bg[3] >= 1) break;
    }
    let bg = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    const fgRaw = parse(getComputedStyle(el).color);
    const fg = over([fgRaw[0], fgRaw[1], fgRaw[2], fgRaw[3] * opacity], bg);
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    return { ratio: (hi + 0.05) / (lo + 0.05), fg: fg.slice(0, 3), bg: bg.slice(0, 3), opacity };
}
"""


def text_contrast(locator):
    """{ratio, fg, bg, opacity} for the first element matched by `locator`."""
    return locator.first.evaluate(_CONTRAST_JS)


def color_contrast(c1, c2):
    """WCAG ratio between two 'rgb(...)'/'#rrggbb' colours (non-text checks)."""
    def to_rgb(c):
        c = c.strip()
        if c.startswith('#'):
            return [int(c[i:i + 2], 16) for i in (1, 3, 5)]
        return [float(v) for v in c[c.index('(') + 1:c.index(')')].replace('/', ',').split(',')[:3]]

    def lum(rgb):
        def f(v):
            v /= 255
            return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
        r, g, b = rgb
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)

    hi, lo = sorted([lum(to_rgb(c1)), lum(to_rgb(c2))], reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def set_theme(page, dark=False, high_contrast=False):
    page.evaluate(
        "([dark, hc]) => { document.body.classList.toggle('dark-mode', dark);"
        " document.body.classList.toggle('high-contrast-mode', hc); }",
        [dark, high_contrast])
