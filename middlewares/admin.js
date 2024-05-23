const jwt = require('jsonwebtoken');
const config = require('config');

module.exports = function admin(req, res, next) {
    console.log(req.user.isAdmin)
    if (!req.user.isAdmin) return res.status(403).send({message: "Access Forbidden: Admin Only!"})
    next()
}