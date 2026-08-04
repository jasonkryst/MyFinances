(function () {
    var savedTheme = localStorage.getItem('debtTrackerTheme');
    if (savedTheme === 'dark' || savedTheme === 'high-contrast') {
        document.body.classList.add('dark-mode');
    }
    if (savedTheme === 'high-contrast') {
        document.body.classList.add('high-contrast-mode');
    }
}());
