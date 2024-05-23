const express = require('express');
const pool = require('../db');
const Joi = require('joi');
const userSchema = require('../schemas/userSchema');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('config');
const router = express.Router();
const _ = require('lodash');
const auth = require('../middlewares/auth')

router.get('/validate-token',auth, async (req, res) => {
    res.json({"success": true})
});

// User login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (user.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const validPassword = await bcrypt.compare(password, user.rows[0].password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jwt.sign({ userId: user.rows[0].user_id, isAdmin: user.rows[0].is_admin}, config.get('JWT_SECRET'), { expiresIn: '1h' });
        
        res.setHeader('auth-token', token);
        res.json({ message: 'User logged in successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
});


// Register a new user
router.post('/register', async (req, res) => {
    try {
        const { error } = userSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { username, email, password } = req.body;

        let existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'User already exists' });
        }

        existingUser = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const salt = await bcrypt.genSalt(10);
        const newPassword = await bcrypt.hash(password, salt);

        const newUser = await pool.query(
            'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING *',
            [username, email, newPassword]
        );

        const token = jwt.sign({ userId: newUser.rows[0].user_id, isAdmin: newUser.rows[0].is_admin}, config.get('JWT_SECRET'), { expiresIn: '1h' });

        res.setHeader('auth-token', token);
        res.send(_.pick(newUser.rows[0], ['username','email']));
    
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
