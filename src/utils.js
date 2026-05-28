// Formatting, date helpers, shared utilities


// Format a number as a USD currency string (e.g., 1234.5 → "$1,234.50")
export function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}
