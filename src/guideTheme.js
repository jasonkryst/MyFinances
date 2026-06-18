(function () {
    var savedTheme = localStorage.getItem('debtTrackerTheme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
    }
}());
