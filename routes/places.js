const express = require('express');
const router = express.Router();
const Joi = require('joi');
const pool = require('../db');
const auth = require('../middlewares/auth');
const admin = require('../middlewares/admin');

const placeSchema = Joi.object({
    airport_code: Joi.string().uppercase().min(2).max(10).required(),
    name: Joi.string().required(),
    city: Joi.string().required(),
    country: Joi.string().required()
});

// Add a place (admin only)
router.post('/', [auth, admin], async (req, res) => {
    const { error } = placeSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { airport_code, name, city, country } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO places (airport_code, name, city, country) VALUES ($1, $2, $3, $4) RETURNING *',
            [airport_code.toUpperCase(), name, city, country]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Airport code already exists' });
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// List all places
router.get('/', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM places ORDER BY country, city');
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Search places by city, country, or airport code
router.get('/search', auth, async (req, res) => {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
        return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    try {
        const pattern = `%${q.trim()}%`;
        const result = await pool.query(
            `SELECT * FROM places
             WHERE city ILIKE $1 OR country ILIKE $1 OR airport_code ILIKE $1 OR name ILIKE $1
             ORDER BY city`,
            [pattern]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Get flights departing from a place and arriving at another
// GET /api/places/flights?from=DEL&to=BOM   (airport codes or city names)
router.get('/flights', auth, async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) {
        return res.status(400).json({ error: 'from and to query params are required' });
    }

    try {
        const result = await pool.query(
            `SELECT f.* FROM flights f
             WHERE (f.departure_airport ILIKE $1 OR f.departure_airport ILIKE $2)
               AND (f.destination_airport ILIKE $3 OR f.destination_airport ILIKE $4)
               AND f.is_deleted = FALSE
               AND f.departure_time > NOW()
             ORDER BY f.departure_time`,
            [`%${from}%`, `%${from}%`, `%${to}%`, `%${to}%`]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Delete a place (admin only)
router.delete('/:id', [auth, admin], async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM places WHERE place_id = $1 RETURNING *',
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Place not found' });
        res.json({ message: 'Place deleted successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
