// Period keys for job_runs (#579), in the server's local time zone (the TZ
// environment variable; UTC in the Docker image unless set).

const pad = n => String(n).padStart(2, '0');

// 'YYYY-MM'
export function monthPeriodKey(now) {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

// 'YYYY-MM-DDTHH'
export function hourPeriodKey(now) {
    return `${monthPeriodKey(now)}-${pad(now.getDate())}T${pad(now.getHours())}`;
}
