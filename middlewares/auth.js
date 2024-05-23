const jwt = require('jsonwebtoken');
const config = require('config');

module.exports = function auth(req, res, next) {
    const token = req.header('auth-token');
    if (!token) return res.status(401).send({message: 'Access denied. No token provided!'});
    try {
        const decoded = jwt.verify(token, config.get('JWT_SECRET'));
        req.user = decoded;
        next();
    } catch (ex) {
        res.status(400).send({message: 'Access denied. Invalid Token'});
    }
}