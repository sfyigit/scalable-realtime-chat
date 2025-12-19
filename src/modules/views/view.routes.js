const express = require('express');
const router = express.Router();
const { getRegister, getLogin, getDashboard } = require('./view.controller');

router.get('/register', getRegister);
router.get('/login', getLogin);
router.get('/dashboard', getDashboard);
router.get('/', (req, res) => res.redirect('/login'));

module.exports = router;