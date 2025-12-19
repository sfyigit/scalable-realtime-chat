const jwt = require("jsonwebtoken");
const config = require("../config");

module.exports = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Token required" });
  }

  try {
    console.log('Auth middleware - token:', token);
    console.log('Auth middleware - secret:', config.jwt.secret);
    const decoded = jwt.verify(token, config.jwt.secret);
    // Token'dan user bilgilerini çıkar ve req.user'a ekle
    console.log('Auth middleware - decoded:', decoded);
    req.user = {
      userId: decoded.userId || decoded.sub,
      email: decoded.email,
      role: decoded.role,
    };
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};
