import { escapeHtml } from '../../sanitizers/index.js';

export default function alertEmail({ heading, body, ctaLabel, ctaUrl } = {}) {
    const safeHeading = escapeHtml(heading || 'MyFinances Alert');
    const safeBody = escapeHtml(body || '');
    const hasCta = Boolean(ctaLabel && ctaUrl && /^https?:\/\//i.test(ctaUrl));
    const ctaHtml = hasCta
        ? `<p><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">${escapeHtml(ctaLabel)}</a></p>`
        : '';
    return {
        subject: safeHeading,
        html: `<h2>${safeHeading}</h2><p>${safeBody}</p>${ctaHtml}`,
        text: `${heading || 'MyFinances Alert'}\n\n${body || ''}${hasCta ? `\n\n${ctaLabel}: ${ctaUrl}` : ''}`
    };
}
