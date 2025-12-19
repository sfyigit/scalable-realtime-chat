const bcrypt = require('bcryptjs');

module.exports.hashPassword = async (password) => {
    return await bcrypt.hash(password, 10);
}

module.exports.verifyPassword = async (password, hashedPassword) => {
    return await bcrypt.compare(password, hashedPassword);
}
