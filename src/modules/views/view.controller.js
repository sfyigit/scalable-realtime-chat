module.exports.getRegister = (req, res) => {
    res.render('register', { title: 'Register' });
}

module.exports.getLogin = (req, res) => {
    res.render('login', { title: 'Login' });
}

module.exports.getDashboard = (req, res) => {
    res.render('dashboard', { title: 'Dashboard' });
}